import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { googleEventSchema, fromGoogleEvent, toGoogleEvent, calendarTaskSchema, type CalendarTask } from "@/domain/google-calendar";
import { syncDecision } from "@/domain/microsoft-todo";
import { getCalendarDate } from "@/domain/calendar-date";
import { OWNER_TIME_ZONE } from "@/domain/daily-planning";
import { getPrisma } from "./prisma";
import { openIntegration, sealIntegration } from "./integration-tokens";
import { persistManagedTask, readManagedTask, readManagedTasks, TaskManagementError } from "./task-management";

export const GOOGLE_SCOPES = "openid https://www.googleapis.com/auth/calendar.app.created https://www.googleapis.com/auth/calendar.calendarlist.readonly";
export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID, clientSecret = process.env.GOOGLE_CLIENT_SECRET, redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) throw new TaskManagementError("Configura Google Calendar antes de conectar");
  return { clientId, clientSecret, redirectUri };
}
export async function exchangeGoogle(parameters: Record<string, string>) {
  const config = googleConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, ...parameters }),
    signal: AbortSignal.timeout(20000), cache: "no-store", redirect: "error" });
  if (!response.ok) throw new TaskManagementError(`Google OAuth ${response.status}`);
  return z.object({ access_token: z.string(), refresh_token: z.string().optional() }).parse(await response.json());
}
export async function googleSubject(token: string) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new TaskManagementError(`Google identity ${response.status}`);
  return z.object({ sub: z.string().min(1) }).parse(await response.json()).sub;
}
export class GoogleCalendarClient {
  constructor(private token: string, private request: typeof fetch = fetch, private beforeRequest?: () => Promise<void>) {}
  async call(path: string, method = "GET", data?: unknown, etag?: string): Promise<unknown> {
    const url = new URL(path, "https://www.googleapis.com/calendar/v3/");
    if (url.origin !== "https://www.googleapis.com" || !url.pathname.startsWith("/calendar/v3/")) throw new Error("Untrusted Google Calendar URL");
    await this.beforeRequest?.();
    const response = await this.request(url, { method, headers: { Authorization: `Bearer ${this.token}`,
      ...(data === undefined ? {} : { "Content-Type": "application/json" }), ...(etag ? { "If-Match": etag } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000) });
    if ((response.status === 404 || response.status === 410) && method === "DELETE") return null;
    if (response.status === 404 && method === "GET") return null;
    if (!response.ok) throw new TaskManagementError(`Google Calendar ${response.status}${response.status === 429 ? ` Retry-After: ${response.headers.get("Retry-After") ?? "60"}` : ""}`);
    return response.status === 204 ? null : response.json();
  }
  async collection(path: string) {
    const items: unknown[] = [], seen = new Set<string>();
    let token: string | undefined;
    do {
      const url = new URL(path, "https://www.googleapis.com/calendar/v3/");
      if (token) url.searchParams.set("pageToken", token);
      const result = z.object({ items: z.array(z.unknown()).default([]), nextPageToken: z.string().optional() }).parse(await this.call(url.href));
      items.push(...result.items); token = result.nextPageToken;
      if (token && (seen.has(token) || seen.size >= 1000)) throw new Error("Google Calendar pagination loop");
      if (token) seen.add(token);
    } while (token);
    return items;
  }
}
export function googleEventId(taskId: string, generation = "") {
  return createHash("sha256").update(`lifeos:${taskId}:${generation}`).digest("hex");
}
const baselineSchema = z.object({ fields: calendarTaskSchema, deleted: z.boolean() });
type Baseline = z.infer<typeof baselineSchema>;
function localFields(task: CalendarTask & { deletedAt: string | null }): Baseline {
  return { fields: calendarTaskSchema.parse(task), deleted: !!task.deletedAt || !task.scheduledDate };
}
export async function syncGoogleCalendar(userId: string, resolution?: "local" | "remote") {
  const db = getPrisma();
  const connection = await db.googleCalendarConnection.findUnique({ where: { userId } });
  if (!connection?.refreshToken) throw new TaskManagementError("Conecta Google Calendar primero");
  let lease = new Date(Date.now() + 15 * 60000);
  const claimed = await db.googleCalendarConnection.updateMany({ where: { userId, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] }, data: { lockedUntil: lease } });
  if (claimed.count !== 1) throw new TaskManagementError("Ya hay una sincronización en curso");
  async function renew() {
    const next = new Date(Date.now() + 15 * 60000);
    const result = await db.googleCalendarConnection.updateMany({ where: { userId, refreshToken: { not: "" }, lockedUntil: lease, AND: [{ lockedUntil: { gt: new Date() } }] }, data: { lockedUntil: next } });
    if (result.count !== 1) throw new TaskManagementError("La sincronización perdió su bloqueo Actualiza antes de continuar");
    lease = next;
  }
  try {
    const tokens = await exchangeGoogle({ grant_type: "refresh_token", refresh_token: openIntegration("google", connection.refreshToken) });
    if (await googleSubject(tokens.access_token) !== connection.subject) throw new TaskManagementError("La cuenta de Google cambió Vuelve a conectar la cuenta original");
    if (tokens.refresh_token) {
      const rotated = await db.googleCalendarConnection.updateMany({ where: { userId, lockedUntil: lease }, data: { refreshToken: sealIntegration("google", tokens.refresh_token) } });
      if (rotated.count !== 1) throw new TaskManagementError("La sincronización perdió su bloqueo Actualiza antes de continuar");
    }
    const client = new GoogleCalendarClient(tokens.access_token, fetch, renew);
    let calendarId = connection.calendarId;
    if (!calendarId) {
      const marker = `LIFE OS ${createHash("sha256").update(userId).digest("hex")}`;
      const calendars = z.array(z.object({ id: z.string(), description: z.string().optional() })).parse(await client.collection("users/me/calendarList?minAccessRole=owner"));
      const matches = calendars.filter((c) => c.description === marker);
      if (matches.length > 1 || connection.calendarPending && matches.length !== 1)
        throw new TaskManagementError("Revisa la creación pendiente del calendario de Google antes de reintentar");
      if (matches.length === 1) calendarId = matches[0].id;
      else {
        await db.googleCalendarConnection.update({ where: { userId }, data: { calendarPending: true } });
        const calendar = z.object({ id: z.string() }).parse(await client.call("calendars", "POST", { summary: "LIFE OS", description: marker, timeZone: OWNER_TIME_ZONE }));
        calendarId = calendar.id;
      }
      await db.googleCalendarConnection.update({ where: { userId }, data: { calendarId, calendarPending: false } });
    }
    const root = `calendars/${encodeURIComponent(calendarId)}/events`;
    const events = z.array(googleEventSchema).parse(await client.collection(`${root}?showDeleted=true&maxResults=2500`));
    const today = getCalendarDate(OWNER_TIME_ZONE);
    let conflicts = 0;
    const issues: string[] = [];
    for (const event of events) {
      await renew();
      const mapping = await db.googleTaskEvent.findUnique({ where: { userId_externalId: { userId, externalId: event.id } } });
      if (mapping || event.status === "cancelled") continue;
      try {
        const fields = fromGoogleEvent(event);
        if (fields.scheduledDate! < today) continue;
        const source = event.extendedProperties?.private?.lifeosTaskId;
        if (source) {
          // A marker with no mapping is not permission to overwrite an existing task.
          throw new TaskManagementError("Un evento de Google tiene un identificador LIFE OS sin correspondencia");
        }
        await db.$transaction(async (tx) => {
          // Reserve the remote ID before importing so a failed import never creates duplicates.
          const taskId = await persistManagedTask(tx, userId, fields);
          await tx.googleTaskEvent.create({ data: { userId, taskId, externalId: event.id, baseline: { fields, deleted: false } } });
        });
      } catch (error) {
        console.error("Google event import failed", error instanceof Error ? error.message : "Unknown event error");
        issues.push(`${event.id}: ${error instanceof Error ? error.message : "Unknown event error"}`);
        conflicts++;
      }
    }
    for (const task of await readManagedTasks(db, userId)) {
      await renew();
      if (task.archivedAt || task.listArchived) continue;
      if (task.scheduledDate && task.scheduledDate < today) continue;
      let mapping = await db.googleTaskEvent.findUnique({ where: { taskId: task.id } });
      const local = localFields(task);
      if (!mapping && local.deleted) continue;
      if (!mapping) mapping = await db.googleTaskEvent.create({ data: { userId, taskId: task.id, externalId: googleEventId(task.id),
        baseline: { fields: local.fields, deleted: true } } });
      try {
        const base = baselineSchema.parse(mapping.baseline);
        const externalId = mapping.externalId;
        const raw = events.find((e) => e.id === externalId);
        const remote = raw && raw.status !== "cancelled" ? { fields: fromGoogleEvent(raw), deleted: false } : { fields: base.fields, deleted: true };
        let decision = syncDecision(base, local, remote);
        if (decision === "conflict" && !resolution) {
          await db.googleTaskEvent.update({ where: { id: mapping.id }, data: { conflict: { local, remote } } });
          conflicts++; continue;
        }
        if (decision === "same") {
          await db.googleTaskEvent.update({ where: { id: mapping.id }, data: { baseline: local, conflict: Prisma.DbNull } });
          continue;
        }
        if (decision === "conflict") decision = resolution === "local" ? "push" : "pull";
        if (decision === "push") {
          if (local.deleted) {
            if (raw && raw.status !== "cancelled" && !raw.etag) throw new Error("Google event etag is missing");
            if (raw?.status !== "cancelled") await client.call(`${root}/${encodeURIComponent(mapping.externalId)}`, "DELETE", undefined, raw?.etag);
          } else if (raw && raw.status !== "cancelled") {
            if (!raw.etag) throw new Error("Google event etag is missing");
            const payload = toGoogleEvent(local.fields, task.id);
            await client.call(`${root}/${encodeURIComponent(mapping.externalId)}`, "PATCH", { ...payload,
              extendedProperties: { private: { ...raw.extendedProperties?.private, ...payload.extendedProperties.private } } }, raw.etag);
          } else {
            if (raw?.status === "cancelled" || !base.deleted) {
              const externalId = googleEventId(task.id, randomUUID());
              mapping = await db.googleTaskEvent.update({ where: { id: mapping.id }, data: { externalId, baseline: { fields: local.fields, deleted: true } } });
            }
            const existing = await client.call(`${root}/${encodeURIComponent(mapping.externalId)}`);
            if (existing) {
              const candidate = googleEventSchema.parse(existing);
              if (candidate.extendedProperties?.private?.lifeosTaskId !== task.id ||
                syncDecision(local.fields, local.fields, fromGoogleEvent(candidate)) !== "same")
                throw new Error("Google event ID exists with different content");
            } else await client.call(root, "POST", { id: mapping.externalId, ...toGoogleEvent(local.fields, task.id) });
          }
          await db.googleTaskEvent.update({ where: { id: mapping.id }, data: { baseline: local, conflict: Prisma.DbNull } });
        } else {
          if (task.deletedAt) throw new TaskManagementError("Restaura la tarea antes de recuperar su programación de Google");
          await persistManagedTask(db, userId, { ...task, ...remote.fields,
            ...(remote.deleted ? { scheduledDate: null, startTime: null, endTime: null } : {}) });
          const updated = await readManagedTask(db, userId, task.id);
          if (!updated) throw new Error("Google scheduled task disappeared");
          await db.googleTaskEvent.update({ where: { id: mapping.id }, data: { baseline: localFields(updated), conflict: Prisma.DbNull } });
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unknown Google event failure";
        console.error("Google task synchronization failed", reason);
        await db.googleTaskEvent.update({ where: { id: mapping.id }, data: { conflict: { reason } } });
        conflicts++;
      }
    }
    const error = conflicts ? `${conflicts} conflictos de Google Calendar Revisa las tareas antes de resolver${issues.length ? ` · ${issues.slice(0, 3).join(" · ").slice(0, 1500)}` : ""}` : null;
    await db.googleCalendarConnection.update({ where: { userId }, data: { lastSyncAt: new Date(), error } });
    if (error) throw new TaskManagementError(error);
  } catch (error) {
    await db.googleCalendarConnection.updateMany({ where: { userId, lockedUntil: lease }, data: { error: error instanceof TaskManagementError ? error.message : "No se pudo sincronizar Google Calendar" } });
    throw error;
  } finally {
    await db.googleCalendarConnection.updateMany({ where: { userId, lockedUntil: lease }, data: { lockedUntil: null } });
  }
}
