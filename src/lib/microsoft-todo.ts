import "server-only";
import { openIntegration, sealIntegration } from "./integration-tokens";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import { graphTaskSchema, graphInstant, graphTaskSource, graphTaskLink, fromGraphTask, toGraphTask, syncDecision, microsoftOwnsRecurrence, graphRecurrence, fromGraphRecurrence, type MappedTask, type GraphTask } from "@/domain/microsoft-todo";
import { recurrenceSchema, type TaskRecurrence } from "@/domain/task-management";
import { dateValue, taskHistory, TaskManagementError, statusSideEffects, microsoftRecurrenceTakenOver, lockMicrosoftRecurrence } from "@/lib/task-management";
import { getCalendarDate } from "@/domain/calendar-date";
import { OWNER_TIME_ZONE } from "@/domain/daily-planning";
import { syncMicrosoftChecklist, microsoftChecklistLocalChanged, microsoftChecklistRemoteChanged } from "./microsoft-checklist";

export const MICROSOFT_SCOPES = "offline_access Tasks.ReadWrite User.Read";

export function sealMicrosoft(value: string) {
  return sealIntegration("microsoft", value);
}
export function openMicrosoft(value: string) {
  return openIntegration("microsoft", value);
}
export function microsoftConfig() {
  const clientId = process.env.MICROSOFT_CLIENT_ID, clientSecret = process.env.MICROSOFT_CLIENT_SECRET, redirectUri = process.env.MICROSOFT_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) throw new TaskManagementError("Configura la aplicación Microsoft Entra antes de conectar");
  const tenant = process.env.MICROSOFT_TENANT_ID ?? "common";
  if (!/^[a-zA-Z0-9.-]+$/.test(tenant)) throw new Error("Invalid Microsoft tenant");
  return { clientId, clientSecret, redirectUri, tenant };
}
export async function exchangeMicrosoft(parameters: Record<string, string>) {
  const config = microsoftConfig();
  const response = await fetch(`https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, ...parameters }),
    signal: AbortSignal.timeout(20000), cache: "no-store", redirect: "error",
  });
  if (!response.ok) throw new TaskManagementError(`Microsoft no autorizó el acceso (${response.status}) Vuelve a conectar`);
  return z.object({ access_token: z.string(), refresh_token: z.string().optional() }).parse(await response.json());
}
export class GraphClient {
  constructor(private token: string, private request: typeof fetch = fetch, private beforeRequest?: () => Promise<void>) {}
  async call(path: string, method = "GET", data?: unknown): Promise<unknown> {
    const url = new URL(path, "https://graph.microsoft.com/v1.0/");
    if (url.origin !== "https://graph.microsoft.com" || !url.pathname.startsWith("/v1.0/")) throw new Error("Untrusted Microsoft Graph URL");
    await this.beforeRequest?.();
    const response = await this.request(url, { method, headers: { Authorization: `Bearer ${this.token}`, ...(data === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(20000), cache: "no-store", redirect: "error" });
    if (response.status === 404 && method === "DELETE") return null;
    if (response.status === 404) throw new TaskManagementError("El registro de Microsoft ya no existe Vuelve a sincronizar");
    if (!response.ok) throw new TaskManagementError(`Microsoft Graph devolvió ${response.status}${response.status === 429 ? ` Reintenta después de ${response.headers.get("Retry-After") ?? "unos"} segundos` : ""}`);
    return response.status === 204 ? null : response.json();
  }
  async collection(path: string): Promise<unknown[]> {
    const values: unknown[] = []; let next: string | undefined = path; const visited = new Set<string>();
    while (next) {
      if (visited.has(next) || visited.size > 1000) throw new Error("Microsoft Graph pagination loop");
      visited.add(next);
      const result = z.object({ value: z.array(z.unknown()), "@odata.nextLink": z.string().optional() }).parse(await this.call(next));
      values.push(...result.value); next = result["@odata.nextLink"];
    }
    return values;
  }
}
export async function microsoftAccount(graph: GraphClient) {
  return z.object({ id: z.string().min(1) }).parse(await graph.call("me?$select=id")).id;
}
type SyncFields = MappedTask & { deleted: boolean; nativeRecurrence?: TaskRecurrence | null };
function graphFields(fields: SyncFields) {
  return { ...toGraphTask(fields), ...(fields.nativeRecurrence !== undefined ? { recurrence: graphRecurrence(fields.nativeRecurrence) } : {}) };
}
function nativeSuccessor(record: { baseline: unknown; task: { externalIds: unknown } }, previous: GraphTask | undefined, remote: GraphTask) {
  const completedBaseline = z.object({ status: z.literal("COMPLETED") }).safeParse(record.baseline).success;
  return microsoftOwnsRecurrence(record.task.externalIds) && !!remote.recurrence && remote.status !== "completed" &&
    (previous?.status === "completed" || completedBaseline);
}
export async function syncMicrosoft(userId: string, resolution?: "local" | "remote") {
  const db = getPrisma();
  const connection = await db.microsoftConnection.findUnique({ where: { userId } });
  if (!connection?.refreshToken) throw new TaskManagementError("Conecta Microsoft To Do primero");
  let lease = new Date(Date.now() + 15 * 60000);
  const claimed = await db.$transaction(async (tx) => {
    await lockMicrosoftRecurrence(tx, userId);
    return tx.microsoftConnection.updateMany({ where: { userId, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] }, data: { lockedUntil: lease } });
  }, { timeout: 20000 });
  if (!claimed.count) throw new TaskManagementError("Ya hay una sincronización en curso");
  async function renewLease() {
    const now = new Date(), next = new Date(now.getTime() + 15 * 60000);
    const result = await db.microsoftConnection.updateMany({ where: { userId, AND: [{ lockedUntil: lease }, { lockedUntil: { gt: now } }] }, data: { lockedUntil: next } });
    if (result.count !== 1) throw new TaskManagementError("La sincronización perdió su bloqueo Actualiza antes de continuar");
    lease = next;
  }
  try {
    const token = await exchangeMicrosoft({ grant_type: "refresh_token", refresh_token: openMicrosoft(connection.refreshToken), scope: MICROSOFT_SCOPES });
    const graph = new GraphClient(token.access_token, fetch, renewLease);
    const accountId = await microsoftAccount(graph);
    if (connection.accountId && connection.accountId !== accountId)
      throw new TaskManagementError("Vuelve a conectar la cuenta Microsoft original antes de sincronizar");
    const bound = await db.microsoftConnection.updateMany({
      where: { userId, accountId: connection.accountId, refreshToken: connection.refreshToken, lockedUntil: lease },
      data: { accountId, ...(token.refresh_token ? { refreshToken: sealMicrosoft(token.refresh_token) } : {}) },
    });
    if (bound.count !== 1) throw new TaskManagementError("La conexión cambió Actualiza antes de continuar");
    const appOrigin = new URL(microsoftConfig().redirectUri).origin;
    async function markSource(remote: GraphTask, taskId: string, listId: string) {
      if (graphTaskSource(remote) === taskId) return;
      const path = `me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(remote.id)}/linkedResources`;
      for (const link of remote.linkedResources.filter((r) => r.applicationName === "LIFE OS")) {
        if (!link.id) throw new Error("Microsoft source link ID is missing");
        await graph.call(`${path}/${encodeURIComponent(link.id)}`, "DELETE");
      }
      await graph.call(path, "POST", graphTaskLink(taskId, appOrigin));
    }
    const remoteLists = z.array(z.object({ id: z.string(), displayName: z.string().min(1).max(120), wellknownListName: z.string().optional() })).parse(await graph.collection("me/todo/lists"));
    let conflicts = 0;
    const issues: string[] = [];
    const takenOver = await db.task.findMany({ where: { userId, parentTaskId: null }, select: { id: true, externalIds: true, archivedAt: true, list: { select: { archivedAt: true } } } });
    const takenOverIds = new Set(takenOver.filter((task) => microsoftRecurrenceTakenOver(task.externalIds)).map((task) => task.id));
    const protectedIds = new Set(takenOver.filter((task) => takenOverIds.has(task.id) || task.archivedAt || task.list?.archivedAt).map((task) => task.id));
    for (const pending of await db.taskListSynchronizationRecord.findMany({ where: { userId, externalId: { startsWith: "pending:" } } })) {
      const base = z.object({ name: z.string(), knownIds: z.array(z.string()) }).parse(pending.baseline);
      const candidates = remoteLists.filter((l) => l.displayName === base.name && !base.knownIds.includes(l.id));
      if (candidates.length !== 1) throw new TaskManagementError("Hay una creación de lista sin confirmar en Microsoft Revisa el resultado remoto antes de volver a sincronizar");
      await db.taskListSynchronizationRecord.update({ where: { id: pending.id }, data: { externalId: candidates[0].id, baseline: { name: base.name }, conflict: Prisma.DbNull } });
    }
    for (const remote of remoteLists.filter((l) => l.wellknownListName !== "flaggedEmails")) {
      const mapping = await db.taskListSynchronizationRecord.findUnique({ where: { userId_externalId: { userId, externalId: remote.id } }, include: { list: true } });
      if (mapping?.list.archivedAt) continue;
      if (!mapping) {
        await db.taskList.create({ data: { userId, name: remote.displayName.slice(0, 120), sync: { create: { externalId: remote.id, baseline: { name: remote.displayName } } } } });
      } else {
        const base = z.object({ name: z.string() }).parse(mapping.baseline);
        const decision = syncDecision(base, { name: mapping.list.name }, { name: remote.displayName });
        if (mapping.list.deletedAt) {
          let remoteChanged = base.name !== remote.displayName;
          const contents = z.array(graphTaskSchema).parse(await graph.collection(`me/todo/lists/${encodeURIComponent(remote.id)}/tasks`));
          for (const task of contents) {
            const record = await db.taskSynchronizationRecord.findUnique({ where: { userId_externalListId_externalId: { userId, externalListId: remote.id, externalId: task.id } }, include: { task: true } });
            try {
              const fields = { ...fromGraphTask(task), deleted: false,
                ...(record && microsoftOwnsRecurrence(record.task.externalIds) ? { nativeRecurrence: fromGraphRecurrence(task.recurrence) } : {}) };
              if (!record || syncDecision(record.baseline, record.baseline, fields) !== "same" ||
                await microsoftChecklistRemoteChanged(db, graph, record)) remoteChanged = true;
            } catch (error) {
              console.error("Microsoft list deletion needs review of unsupported task content", error);
              remoteChanged = true;
            }
          }
          if (remoteChanged && !resolution) {
            await db.taskListSynchronizationRecord.update({ where: { id: mapping.id }, data: { conflict: { reason: "Local list deletion conflicts with remote changes", remote: remote.displayName } } });
            conflicts++; continue;
          }
          if (remoteChanged && resolution === "remote") {
            await db.$transaction(async (tx) => {
              await tx.taskList.update({ where: { id: mapping.listId, userId }, data: { name: remote.displayName, deletedAt: null } });
              for (const record of await tx.taskSynchronizationRecord.findMany({ where: { userId, externalListId: remote.id }, include: { task: true } })) {
                if (protectedIds.has(record.taskId)) continue;
                if (!record.task.listId && !record.task.deletedAt) {
                  await tx.task.update({ where: { id: record.taskId, userId, version: record.task.version }, data: { listId: mapping.listId, version: { increment: 1 } } });
                  await taskHistory(tx, userId, record.taskId, "MICROSOFT_LIST_RESTORED", { listId: null }, { listId: mapping.listId });
                }
              }
              await tx.taskListSynchronizationRecord.update({ where: { id: mapping.id }, data: { baseline: { name: remote.displayName }, conflict: Prisma.DbNull } });
            });
          } else {
            // Deleting a list preserves its local tasks, even though Graph deletes its contents.
            await graph.call(`me/todo/lists/${encodeURIComponent(remote.id)}`, "DELETE");
            await db.$transaction(async (tx) => {
              await tx.taskSynchronizationRecord.deleteMany({ where: { userId, externalListId: remote.id } });
              await tx.taskListSynchronizationRecord.update({ where: { id: mapping.id }, data: { baseline: { name: mapping.list.name, deleted: true }, conflict: Prisma.DbNull } });
            });
            remoteLists.splice(remoteLists.findIndex((l) => l.id === remote.id), 1);
          }
          continue;
        } else if (decision === "conflict" && !resolution) {
          await db.taskListSynchronizationRecord.update({ where: { id: mapping.id }, data: { conflict: { local: mapping.list.name, remote: remote.displayName } } }); conflicts++;
        } else {
          const localWins = decision === "push" || decision === "conflict" && resolution === "local";
          const name = localWins ? mapping.list.name : remote.displayName;
          if (localWins) await graph.call(`me/todo/lists/${encodeURIComponent(remote.id)}`, "PATCH", { displayName: name });
          await db.taskList.update({ where: { id: mapping.listId }, data: { name: name.slice(0, 120) } });
          await db.taskListSynchronizationRecord.update({ where: { id: mapping.id }, data: { baseline: { name }, conflict: Prisma.DbNull } });
        }
      }
    }
    const initialMappings = await db.taskListSynchronizationRecord.findMany({ where: { userId, list: { deletedAt: null, archivedAt: null } } });
    const snapshots = new Map<string, GraphTask[]>();
    const blockedMoves = new Set<string>();
    for (const list of initialMappings) {
      if (remoteLists.some((l) => l.id === list.externalId))
        snapshots.set(list.externalId, z.array(graphTaskSchema).parse(await graph.collection(`me/todo/lists/${encodeURIComponent(list.externalId)}/tasks?$expand=linkedResources`)));
    }
    // Reconcile native moves before deleting missing lists: provider moves change task IDs.
    for (const list of initialMappings) {
      for (const remote of snapshots.get(list.externalId) ?? []) {
        const source = graphTaskSource(remote);
        if (!source) continue;
        const record = await db.taskSynchronizationRecord.findUnique({ where: { taskId: source }, include: { task: true } });
        if (!record || record.userId !== userId || record.externalId.startsWith("pending:")) continue;
        if (protectedIds.has(record.taskId)) continue;
        if (record.externalListId === list.externalId && record.externalId === remote.id) continue;
        const previous = (snapshots.get(record.externalListId) ?? []).find((t) => t.id === record.externalId);
        if (nativeSuccessor(record, previous, remote) || previous) continue;
        const oldList = initialMappings.find((l) => l.externalId === record.externalListId);
        if (!oldList) continue;
        if (record.task.listId !== oldList.listId && record.task.listId !== list.listId && !resolution) {
          await db.taskSynchronizationRecord.update({ where: { id: record.id }, data: { conflict: { reason: "Concurrent task list moves", remoteListId: list.listId } } });
          blockedMoves.add(record.taskId); conflicts++; continue;
        }
        await db.$transaction(async (tx) => {
          if (record.task.listId === oldList.listId || resolution === "remote") {
            await tx.task.update({ where: { id: record.taskId, userId, version: record.task.version }, data: { listId: list.listId, version: { increment: 1 } } });
            await taskHistory(tx, userId, record.taskId, "MICROSOFT_LIST_MOVED", { listId: oldList.listId }, { listId: list.listId });
          }
          await tx.taskSynchronizationRecord.update({ where: { id: record.id }, data: { externalListId: list.externalId, externalId: remote.id } });
        });
      }
    }
    for (const mapping of await db.taskListSynchronizationRecord.findMany({ where: { userId, externalId: { not: { startsWith: "pending:" } } }, include: { list: true } })) {
          if (mapping.list.archivedAt) continue;
          if (remoteLists.some((l) => l.id === mapping.externalId)) continue;
          const base = z.object({ name: z.string(), deleted: z.boolean().default(false) }).parse(mapping.baseline);
          if (mapping.list.deletedAt) {
            await db.taskListSynchronizationRecord.update({ where: { id: mapping.id }, data: { baseline: { name: mapping.list.name, deleted: true }, conflict: Prisma.DbNull } });
            continue;
          }
          let localChanged = mapping.list.name !== base.name;
          for (const record of await db.taskSynchronizationRecord.findMany({ where: { userId, externalListId: mapping.externalId }, include: { task: true } })) {
            if (protectedIds.has(record.taskId)) { localChanged = true; continue; }
            const local: SyncFields = { title: record.task.title, description: record.task.description,
              status: record.task.status === "INBOX" || record.task.status === "CANCELLED" ? "TODO" : record.task.status,
              important: record.task.important, deadline: record.task.deadline?.toISOString().slice(0, 10) ?? null,
              reminderAt: record.task.reminderAt?.toISOString() ?? null, deleted: !!record.task.deletedAt,
              ...(microsoftOwnsRecurrence(record.task.externalIds) ? { nativeRecurrence: record.task.recurrence ? recurrenceSchema.parse(record.task.recurrence) : null } : {}) };
            if (record.task.listId !== mapping.listId || syncDecision(record.baseline, local, record.baseline) !== "same" ||
              await microsoftChecklistLocalChanged(db, userId, record.taskId)) localChanged = true;
          }
          if (await db.task.count({ where: { userId, listId: mapping.listId, deletedAt: null, parentTaskId: null, sync: null } })) localChanged = true;
          if (base.deleted || resolution === "local") {
            // A restored list receives a new provider ID; its local ID and contents survive.
            await db.$transaction(async (tx) => {
              await tx.taskSynchronizationRecord.deleteMany({ where: { userId, externalListId: mapping.externalId } });
              await tx.taskListSynchronizationRecord.delete({ where: { id: mapping.id } });
            });
          } else if (localChanged && !resolution) {
            await db.taskListSynchronizationRecord.update({ where: { id: mapping.id }, data: { conflict: { reason: "Remote list deletion conflicts with local changes", local: mapping.list.name } } });
            conflicts++;
          } else {
            await db.$transaction(async (tx) => {
              for (const task of await tx.task.findMany({ where: { userId, listId: mapping.listId } })) {
                await tx.task.update({ where: { id: task.id, userId, version: task.version }, data: { listId: null, version: { increment: 1 } } });
                await taskHistory(tx, userId, task.id, "MICROSOFT_LIST_DELETED", { listId: mapping.listId }, { listId: null });
              }
              await tx.taskSynchronizationRecord.deleteMany({ where: { userId, externalListId: mapping.externalId } });
              await tx.taskList.update({ where: { id: mapping.listId, userId }, data: { deletedAt: new Date() } });
              await tx.taskListSynchronizationRecord.update({ where: { id: mapping.id }, data: { baseline: { name: mapping.list.name, deleted: true }, conflict: Prisma.DbNull } });
            });
      }
    }
    const localLists = await db.taskList.findMany({ where: { userId, deletedAt: null, archivedAt: null }, include: { sync: true } });
    for (const list of localLists) {
      if (!list.sync) {
        const pending = await db.taskListSynchronizationRecord.create({ data: { userId, listId: list.id, externalId: `pending:${list.id}`,
          baseline: { name: list.name, knownIds: remoteLists.map((l) => l.id) } } });
        const remote = z.object({ id: z.string() }).parse(await graph.call("me/todo/lists", "POST", { displayName: list.name }));
        await db.taskListSynchronizationRecord.update({ where: { id: pending.id }, data: { externalId: remote.id, baseline: { name: list.name } } });
        remoteLists.push({ id: remote.id, displayName: list.name });
      }
    }
    const mappings = await db.taskListSynchronizationRecord.findMany({ where: { userId, list: { deletedAt: null, archivedAt: null } } });
    for (const list of mappings) {
      if (!snapshots.has(list.externalId) && remoteLists.some((l) => l.id === list.externalId))
        snapshots.set(list.externalId, z.array(graphTaskSchema).parse(await graph.collection(`me/todo/lists/${encodeURIComponent(list.externalId)}/tasks?$expand=linkedResources`)));
    }
    for (const list of mappings) {
      const remoteTasks = snapshots.get(list.externalId);
      if (!remoteTasks) continue;
      for (const pending of await db.taskSynchronizationRecord.findMany({ where: { userId, externalListId: list.externalId, externalId: { startsWith: "pending:" } } })) {
        if (protectedIds.has(pending.taskId)) continue;
        const base = z.object({ knownIds: z.array(z.string()), moveFrom: z.object({ listId: z.string(), taskId: z.string() }).optional(),
          moveChecklist: z.array(z.unknown()).optional() }).passthrough().parse(pending.baseline);
        const native = z.object({ nativeRecurrence: recurrenceSchema.nullable() }).safeParse(base.local).success;
        const candidates = remoteTasks.filter((r) => graphTaskSource(r) === pending.taskId ||
          !base.knownIds.includes(r.id) && syncDecision(base.local, base.local, { ...fromGraphTask(r), deleted: false,
            ...(native ? { nativeRecurrence: fromGraphRecurrence(r.recurrence) } : {}) }) === "same");
        if (candidates.length !== 1) throw new TaskManagementError("Hay una creación de tarea sin confirmar en Microsoft Revisa el resultado remoto antes de volver a sincronizar");
        if (base.moveFrom) {
          if (base.moveChecklist && (snapshots.get(base.moveFrom.listId) ?? []).some((task) => task.id === base.moveFrom!.taskId)) {
            const current = await graph.collection(`me/todo/lists/${encodeURIComponent(base.moveFrom.listId)}/tasks/${encodeURIComponent(base.moveFrom.taskId)}/checklistItems`);
            if (syncDecision(base.moveChecklist, base.moveChecklist, current) !== "same")
              throw new TaskManagementError("The source checklist changed during an interrupted move Preserve both provider tasks and reconcile before retrying");
          }
          const stepIssues = await syncMicrosoftChecklist(db, graph, { ...pending, externalId: candidates[0].id }, resolution);
          if (stepIssues.length) throw new TaskManagementError(stepIssues.join(" · "));
          await graph.call(`me/todo/lists/${encodeURIComponent(base.moveFrom.listId)}/tasks/${encodeURIComponent(base.moveFrom.taskId)}`, "DELETE");
          const source = snapshots.get(base.moveFrom.listId);
          if (source) snapshots.set(base.moveFrom.listId, source.filter((r) => r.id !== base.moveFrom!.taskId));
        }
        await db.taskSynchronizationRecord.update({ where: { id: pending.id }, data: { externalId: candidates[0].id, baseline: base.local as Prisma.InputJsonValue, conflict: Prisma.DbNull } });
      }
    }
    for (const list of mappings) {
      if (!remoteLists.some((l) => l.id === list.externalId)) {
        await db.taskListSynchronizationRecord.update({ where: { id: list.id }, data: { conflict: { reason: "Remote list missing Local list and tasks retained" } } });
        conflicts++; continue;
      }
      const remoteTasks = snapshots.get(list.externalId)!;
      const seen = new Set(remoteTasks.map((task) => task.id));
      for (const remote of [...remoteTasks]) {
        await renewLease();
        const mapping = await db.taskSynchronizationRecord.findUnique({ where: { userId_externalListId_externalId: { userId, externalListId: list.externalId, externalId: remote.id } }, include: { task: true } });
        if (mapping && (blockedMoves.has(mapping.taskId) || protectedIds.has(mapping.taskId))) continue;
        const sourceId = graphTaskSource(remote);
        if (sourceId && takenOverIds.has(sourceId)) continue;
        if (!mapping && remote.recurrence && takenOverIds.size) {
          issues.push(`${remote.title}: Reconcile unlinked Microsoft recurrence after native takeover before importing`);
          conflicts++; continue;
        }
        let fields: MappedTask;
        const native = mapping ? microsoftOwnsRecurrence(mapping.task.externalIds) : !!remote.recurrence;
        let nativeRule: TaskRecurrence | null = null;
        try {
          if (remote.recurrence && !native) throw new Error("Do not enable Microsoft recurrence on a LIFE OS-managed occurrence");
          if (native) nativeRule = fromGraphRecurrence(remote.recurrence);
          fields = fromGraphTask(remote);
        } catch (error) {
          console.error("Microsoft task mapping unsupported", error);
          issues.push(`${remote.title.slice(0, 100)} (${remote.id}): ${error instanceof Error ? error.message : "Unsupported task mapping"}`);
          if (mapping) await db.taskSynchronizationRecord.update({ where: { id: mapping.id }, data: { conflict: { reason: "Unsupported recurrence, list movement or body format", remoteId: remote.id } } });
          conflicts++; continue;
        }
        const remoteFields: SyncFields = { ...fields, deleted: false, ...(native ? { nativeRecurrence: nativeRule } : {}) };
        if (!mapping) {
          const source = graphTaskSource(remote);
          if (source) {
            const previous = await db.taskSynchronizationRecord.findFirst({ where: { userId, taskId: source }, include: { task: true } });
            if (previous && !nativeSuccessor(previous, (snapshots.get(previous.externalListId) ?? []).find((t) => t.id === previous.externalId), remote)) {
              conflicts++; continue;
            }
          }
          const taskId = await db.$transaction(async (tx) => {
            const task = await tx.task.create({ data: { userId, listId: list.listId, title: fields.title.slice(0, 200) || "Microsoft To Do", description: fields.description.slice(0, 2000),
              status: fields.status === "COMPLETED" ? "COMPLETED" : fields.status === "IN_PROGRESS" ? "IN_PROGRESS" : "TODO", important: fields.important,
              deadline: dateValue(fields.deadline), reminderAt: fields.reminderAt ? new Date(fields.reminderAt) : null,
              completedAt: fields.status === "COMPLETED" && remote.completedDateTime ? new Date(graphInstant(remote.completedDateTime)!) : null,
              recurrence: nativeRule ?? Prisma.DbNull, externalIds: native ? { microsoftRecurrenceAuthority: true } : {},
              sync: { create: { externalId: remote.id, externalListId: list.externalId, baseline: remoteFields } } } });
            await taskHistory(tx, userId, task.id, "MICROSOFT_IMPORTED", undefined, { ...remoteFields, completedAt: task.completedAt });
            return task.id;
          });
          await markSource(remote, taskId, list.externalId);
          continue;
        }
        const local: SyncFields = { title: mapping.task.title, description: mapping.task.description, status: mapping.task.status === "INBOX" || mapping.task.status === "CANCELLED" ? "TODO" : mapping.task.status,
          important: mapping.task.important, deadline: mapping.task.deadline?.toISOString().slice(0, 10) ?? null, reminderAt: mapping.task.reminderAt?.toISOString() ?? null, deleted: !!mapping.task.deletedAt,
          ...(native ? { nativeRecurrence: mapping.task.recurrence ? recurrenceSchema.parse(mapping.task.recurrence) : null } : {}) };
        if (mapping.task.listId !== list.listId) {
          const destination = mappings.find((l) => l.listId === mapping.task.listId);
          const targetTasks = destination ? snapshots.get(destination.externalId) : undefined;
          const remoteChanged = syncDecision(mapping.baseline, mapping.baseline, remoteFields) !== "same";
          if (!destination || !targetTasks || remote.hasAttachments || remote.recurrence || local.nativeRecurrence || local.deleted ||
            remoteChanged && resolution !== "local") {
            await db.taskSynchronizationRecord.update({ where: { id: mapping.id }, data: { conflict: { reason: "Task move needs review of remote changes, attachments or list mapping" } } });
            conflicts++; continue;
          }
          const attachments = await graph.collection(`me/todo/lists/${encodeURIComponent(list.externalId)}/tasks/${encodeURIComponent(remote.id)}/attachments`);
          const foreignLinks = remote.linkedResources.filter((r) => r.applicationName !== "LIFE OS");
          if (foreignLinks.length || attachments.length) {
            await db.taskSynchronizationRecord.update({ where: { id: mapping.id }, data: { conflict: { reason: "Task move has provider attachments or external links Preserve them before moving" } } });
            conflicts++; continue;
          }
          const stepIssues = await syncMicrosoftChecklist(db, graph, mapping, resolution);
          if (stepIssues.length) {
            await db.taskSynchronizationRecord.update({ where: { id: mapping.id }, data: { conflict: { reason: "Resolve checklist conflicts before moving", issues: stepIssues } } });
            conflicts++; continue;
          }
          const moveChecklist = await graph.collection(`me/todo/lists/${encodeURIComponent(list.externalId)}/tasks/${encodeURIComponent(remote.id)}/checklistItems`);
          await db.taskSynchronizationRecord.update({ where: { id: mapping.id }, data: {
            externalId: `pending:${mapping.taskId}`, externalListId: destination.externalId,
            baseline: { local, knownIds: targetTasks.map((t) => t.id), moveFrom: { listId: list.externalId, taskId: remote.id }, moveChecklist: moveChecklist as Prisma.InputJsonValue }, conflict: Prisma.DbNull,
          } });
          const created = graphTaskSchema.parse(await graph.call(`me/todo/lists/${encodeURIComponent(destination.externalId)}/tasks`, "POST", {
            ...toGraphTask(local), categories: remote.categories, startDateTime: remote.startDateTime ?? null,
            importance: !local.important && remote.importance === "low" ? "low" : toGraphTask(local).importance,
            completedDateTime: local.status === "COMPLETED" ? remote.completedDateTime ?? null : null, linkedResources: [graphTaskLink(mapping.taskId, appOrigin)],
          }));
          const destinationStepIssues = await syncMicrosoftChecklist(db, graph, { ...mapping, externalListId: destination.externalId, externalId: created.id }, resolution);
          if (destinationStepIssues.length) throw new TaskManagementError(destinationStepIssues.join(" · "));
          const currentChecklist = await graph.collection(`me/todo/lists/${encodeURIComponent(list.externalId)}/tasks/${encodeURIComponent(remote.id)}/checklistItems`);
          if (syncDecision(moveChecklist, moveChecklist, currentChecklist) !== "same")
            throw new TaskManagementError("The source checklist changed during an interrupted move Preserve both provider tasks and reconcile before retrying");
          await graph.call(`me/todo/lists/${encodeURIComponent(list.externalId)}/tasks/${encodeURIComponent(remote.id)}`, "DELETE");
          await db.taskSynchronizationRecord.update({ where: { id: mapping.id }, data: { externalId: created.id, baseline: local } });
          targetTasks.push(created);
          continue;
        }
        const checklistDeletionConflict = local.deleted && await microsoftChecklistRemoteChanged(db, graph, mapping);
        const decision = checklistDeletionConflict ? "conflict" : syncDecision(mapping.baseline, local, remoteFields);
        if (decision === "conflict" && !resolution) { await db.taskSynchronizationRecord.update({ where: { id: mapping.id }, data: { conflict: {
          local, remote: remoteFields, ...(checklistDeletionConflict ? { reason: "Task deletion conflicts with remote checklist changes" } : {}),
        } } }); conflicts++; continue; }
        const push = decision === "push" || decision === "conflict" && resolution === "local";
        const chosen = push ? local : remoteFields;
        if (push) {
          if (local.deleted) await graph.call(`me/todo/lists/${encodeURIComponent(list.externalId)}/tasks/${encodeURIComponent(remote.id)}`, "DELETE");
          else await graph.call(`me/todo/lists/${encodeURIComponent(list.externalId)}/tasks/${encodeURIComponent(remote.id)}`, "PATCH", graphFields(local));
        } else if (decision === "pull" || decision === "conflict") {
          await db.$transaction(async (tx) => {
            const updated = await tx.task.update({ where: { id: mapping.taskId, userId, version: mapping.task.version }, data: {
              title: fields.title.slice(0, 200), description: fields.description.slice(0, 2000), important: fields.important,
              status: fields.status === "COMPLETED" ? "COMPLETED" : fields.status === "IN_PROGRESS" ? "IN_PROGRESS" : "TODO",
              deadline: dateValue(fields.deadline), reminderAt: fields.reminderAt ? new Date(fields.reminderAt) : null, deletedAt: null,
              completedAt: fields.status === "COMPLETED" ? (remote.completedDateTime ? new Date(graphInstant(remote.completedDateTime)!) : mapping.task.completedAt) : null, version: { increment: 1 },
              ...(native ? { recurrence: nativeRule ?? Prisma.DbNull } : {}),
            } });
            await taskHistory(tx, userId, updated.id, "MICROSOFT_UPDATED", mapping.task, updated);
            if (updated.status !== mapping.task.status) await statusSideEffects(tx, updated, mapping.task.status);
            await tx.taskDailyAssignment.updateMany({ where: { userId, taskId: updated.id, date: { gte: dateValue(getCalendarDate(OWNER_TIME_ZONE))! } },
              data: { titleSnapshot: updated.title, statusSnapshot: updated.status, completedAt: updated.completedAt } });
          });
        }
        await db.taskSynchronizationRecord.update({ where: { id: mapping.id }, data: { baseline: chosen, conflict: Prisma.DbNull } });
        if (!(push && local.deleted)) await markSource(remote, mapping.taskId, list.externalId);
      }
      const localTasks = await db.task.findMany({ where: { userId, listId: list.listId, parentTaskId: null }, include: { sync: true } });
      for (const task of localTasks) {
        await renewLease();
        if (protectedIds.has(task.id)) continue;
        if (blockedMoves.has(task.id)) continue;
        if (task.sync && task.sync.externalListId !== list.externalId) {
          if (mappings.some((l) => l.externalId === task.sync!.externalListId)) continue;
          await db.taskSynchronizationRecord.update({ where: { id: task.sync.id }, data: { conflict: { reason: "Task moved between lists Resolve list mapping before synchronization" } } }); conflicts++; continue;
        }
        if (task.sync && !seen.has(task.sync.externalId) && !task.deletedAt) {
          const base = z.object({ title: z.string(), description: z.string(), status: z.string(), important: z.boolean(), deadline: z.string().nullable(), reminderAt: z.string().nullable(), deleted: z.boolean(), nativeRecurrence: recurrenceSchema.nullable().optional() }).parse(task.sync.baseline);
          const local: SyncFields = { title: task.title, description: task.description, status: task.status === "INBOX" || task.status === "CANCELLED" ? "TODO" : task.status, important: task.important, deadline: task.deadline?.toISOString().slice(0, 10) ?? null, reminderAt: task.reminderAt?.toISOString() ?? null, deleted: false,
            ...(microsoftOwnsRecurrence(task.externalIds) ? { nativeRecurrence: task.recurrence ? recurrenceSchema.parse(task.recurrence) : null } : {}) };
          const recreate = base.deleted || resolution === "local";
          if (!recreate && !resolution && (syncDecision(base, local, { ...base, deleted: true }) === "conflict" ||
            await microsoftChecklistLocalChanged(db, userId, task.id))) {
            await db.taskSynchronizationRecord.update({ where: { id: task.sync.id }, data: { conflict: { reason: "Remote deletion conflicts with local task", local } } }); conflicts++;
          } else if (recreate) {
            if (local.nativeRecurrence && local.status === "COMPLETED") {
              await db.taskSynchronizationRecord.update({ where: { id: task.sync.id }, data: { conflict: { reason: "Reopen the native recurring occurrence before recreating it Microsoft may generate another occurrence on completed-series creation" } } });
              conflicts++; continue;
            }
            const payload = graphFields(local);
            await db.taskSynchronizationRecord.update({ where: { id: task.sync.id }, data: { externalId: `pending:${task.id}`, baseline: { local, knownIds: [...seen] }, conflict: Prisma.DbNull } });
            const remote = z.object({ id: z.string() }).parse(await graph.call(`me/todo/lists/${encodeURIComponent(list.externalId)}/tasks`, "POST", { ...payload, linkedResources: [graphTaskLink(task.id, appOrigin)] }));
            await db.taskSynchronizationRecord.update({ where: { id: task.sync.id }, data: { externalId: remote.id, baseline: local } });
            seen.add(remote.id);
          } else {
            await db.$transaction(async (tx) => {
              await tx.task.update({ where: { id: task.id, version: task.version }, data: { deletedAt: new Date(), version: { increment: 1 } } });
              await taskHistory(tx, userId, task.id, "MICROSOFT_DELETED", task);
              await tx.taskSynchronizationRecord.update({ where: { id: task.sync!.id }, data: { baseline: { ...base, deleted: true }, conflict: Prisma.DbNull } });
            });
          }
        } else if (!task.sync && !task.deletedAt) {
          // Local series export independent occurrences; imported series retain provider authority.
          const local: SyncFields = { title: task.title, description: task.description, status: task.status === "INBOX" || task.status === "CANCELLED" ? "TODO" : task.status,
            important: task.important, deadline: task.deadline?.toISOString().slice(0, 10) ?? null, reminderAt: task.reminderAt?.toISOString() ?? null, deleted: false,
            ...(microsoftOwnsRecurrence(task.externalIds) ? { nativeRecurrence: task.recurrence ? recurrenceSchema.parse(task.recurrence) : null } : {}) };
          if (local.nativeRecurrence && local.status === "COMPLETED") {
            issues.push(`${task.title}: Reopen the completed native recurring occurrence before recreating it`);
            conflicts++; continue;
          }
          const payload = graphFields(local);
          const pending = await db.taskSynchronizationRecord.create({ data: { userId, taskId: task.id, externalId: `pending:${task.id}`, externalListId: list.externalId,
            baseline: { local, knownIds: [...seen] } } });
          const remote = z.object({ id: z.string() }).parse(await graph.call(`me/todo/lists/${encodeURIComponent(list.externalId)}/tasks`, "POST", { ...payload, linkedResources: [graphTaskLink(task.id, appOrigin)] }));
          await db.taskSynchronizationRecord.update({ where: { id: pending.id }, data: { externalId: remote.id, baseline: local } });
          seen.add(remote.id);
        }
      }
    }
    for (const mapping of await db.taskSynchronizationRecord.findMany({
      where: { userId, conflict: { equals: Prisma.DbNull }, externalId: { not: { startsWith: "pending:" } },
        task: { deletedAt: null, parentTaskId: null, list: { deletedAt: null, archivedAt: null } } },
    })) {
      if (protectedIds.has(mapping.taskId)) continue;
      const stepIssues = await syncMicrosoftChecklist(db, graph, mapping, resolution);
      if (stepIssues.length) {
        await db.taskSynchronizationRecord.update({ where: { id: mapping.id }, data: { conflict: { reason: "Checklist synchronization needs review", issues: stepIssues } } });
        conflicts++; issues.push(...stepIssues);
      }
    }
    const error = conflicts ? `${conflicts} conflictos o capacidades no compatibles Revisa antes de resolver No se sobrescribieron los campos avanzados${issues.length ? ` · ${issues.slice(0, 3).join(" · ").slice(0, 1500)}` : ""}` : null;
    const finished = await db.microsoftConnection.updateMany({ where: { userId, lockedUntil: lease }, data: { lastSyncAt: new Date(), error } });
    if (finished.count !== 1) throw new TaskManagementError("La conexión cambió Actualiza antes de continuar");
    if (error) throw new TaskManagementError(error);
  } catch (error) {
    await db.microsoftConnection.updateMany({ where: { userId, lockedUntil: lease }, data: { error: error instanceof TaskManagementError ? error.message : "La sincronización falló Revisa la conexión antes de reintentar" } });
    throw error;
  } finally { await db.microsoftConnection.updateMany({ where: { userId, lockedUntil: lease }, data: { lockedUntil: null } }); }
}
