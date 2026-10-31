import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getCalendarDate } from "@/domain/calendar-date";
import { OWNER_TIME_ZONE, shiftDate } from "@/domain/daily-planning";
import { googleEventSchema, toGoogleEvent, type GoogleEvent } from "@/domain/google-calendar";
import { persistManagedTask, readManagedTask } from "./task-management";
const mocks = vi.hoisted(() => ({ db: null as PrismaClient | null }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.db! }));
vi.mock("server-only", () => ({}));
import { syncGoogleCalendar } from "./google-calendar";
import { sealIntegration } from "./integration-tokens";

const databaseUrl = process.env.TASK_MANAGEMENT_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("Google Calendar PostgreSQL synchronization", () => {
  let db: PrismaClient, userId: string, subject: string;
  const today = getCalendarDate(OWNER_TIME_ZONE), tomorrow = shiftDate(today, 1);
  let events: Map<string, GoogleEvent>, calendars: { id: string; description: string }[];
  let failCreate: boolean, failCalendar: boolean, request: ReturnType<typeof vi.fn<typeof fetch>>;
  beforeEach(async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "fixture-encryption-key-never-use-in-production");
    vi.stubEnv("GOOGLE_CLIENT_ID", "fixture"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "fixture-secret");
    vi.stubEnv("GOOGLE_REDIRECT_URI", "http://localhost:3001/api/integrations/google/callback");
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl!, options: "-c timezone=UTC" }) });
    mocks.db = db; userId = `google-test-${randomUUID()}`; subject = "fixture-subject";
    events = new Map(); calendars = []; failCreate = false; failCalendar = false;
    await db.user.create({ data: { id: userId, name: "Google fixture", email: `${userId}@example.invalid` } });
    await db.googleCalendarConnection.create({ data: { userId, subject, refreshToken: sealIntegration("google", "fixture-refresh") } });
    request = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input)), method = init?.method ?? "GET";
      if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "fixture-access" });
      if (url.hostname === "openidconnect.googleapis.com") return Response.json({ sub: subject });
      expect(url.origin).toBe("https://www.googleapis.com");
      const path = url.pathname;
      if (path.endsWith("/users/me/calendarList")) return Response.json({ items: calendars });
      if (path === "/calendar/v3/calendars") {
        const calendar = { id: "dedicated-calendar", ...JSON.parse(String(init?.body)) };
        calendars.push(calendar);
        if (failCalendar) { failCalendar = false; throw new Error("Ambiguous calendar create"); }
        return Response.json(calendar);
      }
      if (path.endsWith("/events") && method === "GET") return Response.json({ items: [...events.values()] });
      if (path.endsWith("/events") && method === "POST") {
        const event = googleEventSchema.parse({ etag: '"initial"', ...JSON.parse(String(init?.body)) });
        if (events.has(event.id)) return new Response(null, { status: 409 });
        events.set(event.id, event);
        if (failCreate) { failCreate = false; throw new Error("Ambiguous event create"); }
        return Response.json(event);
      }
      const id = decodeURIComponent(path.split("/").at(-1)!), existing = events.get(id);
      if (method === "GET") return existing ? Response.json(existing) : new Response(null, { status: 404 });
      if (!existing) return new Response(null, { status: 404 });
      const etag = (init?.headers as Record<string, string>)["If-Match"];
      if (etag && etag !== existing.etag) return new Response(null, { status: 412 });
      if (method === "DELETE") { events.set(id, { id, status: "cancelled", etag: '"deleted"' }); return new Response(null, { status: 204 }); }
      if (method === "PATCH") {
        const event = googleEventSchema.parse({ ...existing, ...JSON.parse(String(init?.body)), etag: `"${randomUUID()}"` });
        events.set(id, event); return Response.json(event);
      }
      throw new Error(`Unexpected Google request ${method} ${path}`);
    });
    vi.stubGlobal("fetch", request);
  });
  afterEach(async () => {
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
    await db.user.delete({ where: { id: userId } });
    await db.$disconnect();
  });
  const get = async (id: string) => (await readManagedTask(db, userId, id))!;
  const eventFor = async (taskId: string) => events.get((await db.googleTaskEvent.findUniqueOrThrow({ where: { taskId } })).externalId)!;
  it("pauses archived tasks and archived lists without deleting provider events or changing scheduling", async () => {
    const list = await db.taskList.create({ data: { userId, name: "Archive fixture" } });
    const id = await persistManagedTask(db, userId, { title: "Archived calendar task", scheduledDate: today, listId: list.id });
    await syncGoogleCalendar(userId);
    const event = await eventFor(id);
    events.set(event.id, { ...event, summary: "Remote archive edit", start: { date: tomorrow }, end: { date: shiftDate(tomorrow, 1) } });
    await db.task.update({ where: { id }, data: { archivedAt: new Date() } });
    const before = await db.task.findUniqueOrThrow({ where: { id } });
    await syncGoogleCalendar(userId);
    expect(await db.task.findUniqueOrThrow({ where: { id } })).toEqual(before);
    expect(events.get(event.id)?.status).not.toBe("cancelled");
    await db.task.update({ where: { id }, data: { archivedAt: null } });
    await db.taskList.update({ where: { id: list.id }, data: { archivedAt: new Date() } });
    await syncGoogleCalendar(userId);
    expect((await get(id)).scheduledDate).toBe(today);
    await db.taskList.update({ where: { id: list.id }, data: { archivedAt: null } });
    await syncGoogleCalendar(userId);
    expect((await get(id)).scheduledDate).toBe(tomorrow);
  });
  it("syncs all-day and timed tasks, imports existing events and keeps one underlying task", async () => {
    const id = await persistManagedTask(db, userId, { title: "Local calendar task", scheduledDate: today, notes: "Local only", urgent: true });
    await syncGoogleCalendar(userId);
    expect(calendars).toHaveLength(1);
    expect(events.size).toBe(1);
    const event = await eventFor(id);
    expect(event.start).toEqual({ date: today });
    events.set(event.id, { ...event, summary: "Remote title", start: { date: tomorrow }, end: { date: shiftDate(tomorrow, 1) } });
    await syncGoogleCalendar(userId);
    expect(await get(id)).toMatchObject({ title: "Remote title", scheduledDate: tomorrow, notes: "Local only", urgent: true });
    expect(await db.taskDailyAssignment.count({ where: { taskId: id } })).toBe(1);
    await persistManagedTask(db, userId, { ...await get(id), startTime: "09:00", endTime: "10:00" });
    const withPrivate = await eventFor(id);
    events.set(withPrivate.id, { ...withPrivate, extendedProperties: { private: { lifeosTaskId: id, partnerMetadata: "must survive" } } });
    await syncGoogleCalendar(userId);
    expect((await eventFor(id)).start?.dateTime).toContain("12:00:00");
    expect((await eventFor(id)).extendedProperties?.private?.partnerMetadata).toBe("must survive");
    events.set("imported", googleEventSchema.parse({ id: "imported", ...toGoogleEvent({ title: "Imported", description: "", scheduledDate: tomorrow, startTime: "11:00", endTime: "12:00" }, "unused"), extendedProperties: undefined }));
    await syncGoogleCalendar(userId); await syncGoogleCalendar(userId);
    expect(await db.task.count({ where: { userId, title: "Imported" } })).toBe(1);
    expect(await db.dailyPlan.count({ where: { userId } })).toBe(0);
  });
  it("detects concurrent changes, applies explicit resolution and unschedules remote deletions without Trash", async () => {
    const id = await persistManagedTask(db, userId, { title: "Original", scheduledDate: today });
    await syncGoogleCalendar(userId);
    const event = await eventFor(id);
    await persistManagedTask(db, userId, { ...await get(id), title: "Local" });
    events.set(event.id, { ...event, summary: "Remote" });
    await expect(syncGoogleCalendar(userId)).rejects.toThrow("conflictos");
    expect((await get(id)).title).toBe("Local");
    await syncGoogleCalendar(userId, "remote");
    expect((await get(id)).title).toBe("Remote");
    events.set(event.id, { id: event.id, status: "cancelled" });
    await syncGoogleCalendar(userId);
    expect(await get(id)).toMatchObject({ scheduledDate: null, deletedAt: null });
    expect(await db.taskDailyAssignment.count({ where: { taskId: id } })).toBe(0);
    await persistManagedTask(db, userId, { ...await get(id), scheduledDate: tomorrow });
    await syncGoogleCalendar(userId);
    expect((await eventFor(id)).id).not.toBe(event.id);
    expect(await db.task.count({ where: { userId } })).toBe(1);
  });
  it("recovers ambiguous calendar and event creation without duplicates", async () => {
    const id = await persistManagedTask(db, userId, { title: "Recover", scheduledDate: today });
    failCalendar = true;
    await expect(syncGoogleCalendar(userId)).rejects.toThrow("Ambiguous calendar");
    failCreate = true;
    await expect(syncGoogleCalendar(userId)).rejects.toThrow("conflictos");
    await syncGoogleCalendar(userId);
    expect(calendars).toHaveLength(1); expect(events.size).toBe(1);
    expect((await eventFor(id)).summary).toBe("Recover");
    expect((await db.googleTaskEvent.findUniqueOrThrow({ where: { taskId: id } })).conflict).toBeNull();
  });
  it("rejects account changes, respects the lease, and imports task times independently of hourly planning", async () => {
    subject = "different-account";
    await expect(syncGoogleCalendar(userId)).rejects.toThrow("cuenta");
    expect(calendars).toHaveLength(0);
    subject = "fixture-subject";
    await db.googleCalendarConnection.update({ where: { userId }, data: { lockedUntil: new Date(Date.now() + 600000) } });
    await expect(syncGoogleCalendar(userId)).rejects.toThrow("en curso");
    await db.googleCalendarConnection.update({ where: { userId }, data: { lockedUntil: null } });
    await persistManagedTask(db, userId, { title: "Existing block", scheduledDate: tomorrow, startTime: "09:00", endTime: "10:00" });
    events.set("overlap", googleEventSchema.parse({ id: "overlap", ...toGoogleEvent({ title: "Independent imported task", description: "", scheduledDate: tomorrow, startTime: "09:30", endTime: "10:30" }, "unused"), extendedProperties: undefined }));
    await syncGoogleCalendar(userId);
    expect(await db.task.count({ where: { userId, title: "Independent imported task" } })).toBe(1);
    expect(await db.googleTaskEvent.count({ where: { userId, externalId: "overlap" } })).toBe(1);
    expect(await db.dailyPlan.count({ where: { userId } })).toBe(0);
    expect((await db.googleCalendarConnection.findUniqueOrThrow({ where: { userId } })).lockedUntil).toBeNull();
  });
  it("lets Google reschedule independent tasks without changing published hourly content or local metadata", async () => {
    const id = await persistManagedTask(db, userId, { title: "Executed task", scheduledDate: today, startTime: "08:00", endTime: "09:00", important: true });
    await syncGoogleCalendar(userId);
    const event = await eventFor(id);
    const hours = Array.from({ length: 24 }, (_, hour) => hour === 8 ? "Independent published text" : "");
    const plan = await db.dailyPlan.create({ data: { userId, date: new Date(`${today}T00:00:00Z`), publishedHours: hours } });
    events.set(event.id, googleEventSchema.parse({ ...event,
      ...toGoogleEvent({ title: "Changed remotely", description: "", scheduledDate: tomorrow, startTime: "08:00", endTime: "09:00" }, id) }));
    await syncGoogleCalendar(userId);
    expect(await get(id)).toMatchObject({ title: "Changed remotely", scheduledDate: tomorrow, startTime: "08:00", important: true });
    expect(await db.taskDailyAssignment.count({ where: { taskId: id } })).toBe(1);
    expect(await db.dailyPlan.findUniqueOrThrow({ where: { id: plan.id } })).toEqual(plan);
    const record = await db.googleTaskEvent.findUniqueOrThrow({ where: { taskId: id } });
    expect(record.conflict).toBeNull();
  });
  it("keeps local Trash independent and recreates restored events exactly once after interrupted writes", async () => {
    const id = await persistManagedTask(db, userId, { title: "Restore calendar task", scheduledDate: tomorrow });
    await syncGoogleCalendar(userId);
    const original = await eventFor(id);
    await db.task.update({ where: { id }, data: { deletedAt: new Date(), version: { increment: 1 } } });
    await syncGoogleCalendar(userId);
    expect(events.get(original.id)?.status).toBe("cancelled");
    await db.task.update({ where: { id }, data: { deletedAt: null, version: { increment: 1 } } });
    failCreate = true;
    await expect(syncGoogleCalendar(userId)).rejects.toThrow("conflictos");
    await syncGoogleCalendar(userId); await syncGoogleCalendar(userId);
    expect([...events.values()].filter((e) => e.status !== "cancelled")).toHaveLength(1);
    expect((await eventFor(id)).id).not.toBe(original.id);
    expect(await db.task.count({ where: { userId } })).toBe(1);
  });
});
