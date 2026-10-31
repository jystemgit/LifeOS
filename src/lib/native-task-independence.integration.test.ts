import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getCalendarDate } from "@/domain/calendar-date";
import { OWNER_TIME_ZONE, shiftDate } from "@/domain/daily-planning";
import { filterTasks } from "@/domain/task-management";
import { persistManagedTask, readManagedTasks, duplicateManagedTask, takeOverTaskRecurrence } from "./task-management";
import { readHourlyPlan } from "./hourly-planning";
import { readDueTaskReminders, acknowledgeTaskReminder } from "./task-reminders";
import { sealMicrosoft, syncMicrosoft } from "./microsoft-todo";
import { graphRecurrence } from "@/domain/microsoft-todo";
import { recurrenceSchema } from "@/domain/task-management";
const mocks = vi.hoisted(() => ({ db: null as PrismaClient | null, owner: "" }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.db! }));
vi.mock("@/lib/require-owner", () => ({ requireOwnerId: async () => mocks.owner }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { manageTasks, manageOrganization } from "@/app/tasks/manage-actions";

const databaseUrl = process.env.TASK_MANAGEMENT_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("native independence PostgreSQL workflows", () => {
  let db: PrismaClient, userId: string;
  const today = getCalendarDate(OWNER_TIME_ZONE), tomorrow = shiftDate(today, 1);
  beforeEach(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl!, options: "-c timezone=UTC" }) });
    mocks.db = db; userId = `native-test-${randomUUID()}`; mocks.owner = userId;
    await db.user.create({ data: { id: userId, name: "Native fixture", email: `${userId}@example.invalid` } });
  });
  afterEach(async () => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); await db.dailyPlan.deleteMany({ where: { userId } }); await db.user.delete({ where: { id: userId } }); await db.$disconnect(); });
  const read = () => readManagedTasks(db, userId);
  const source = () => db.task.create({ data: {
    userId, title: "Native takeover", status: "TODO", notes: "Preserve notes", scheduledDate: new Date(`${today}T00:00:00Z`),
    recurrence: { frequency: "DAILY", interval: 1, startDate: today, endDate: null, weekdays: [] },
    externalIds: { microsoftRecurrenceAuthority: true, unrelated: "preserve" },
  } });
  it("explicitly takes over while disconnected, retains identities/history and generates once", async () => {
    const original = await source();
    await db.taskSynchronizationRecord.create({ data: { userId, taskId: original.id, externalId: "original-provider", externalListId: "provider-list", baseline: {} } });
    await expect(takeOverTaskRecurrence(db, userId, { id: original.id, version: 0, confirmed: false })).rejects.toThrow();
    const competing = await Promise.allSettled([
      takeOverTaskRecurrence(db, userId, { id: original.id, version: 0, confirmed: true }),
      takeOverTaskRecurrence(db, userId, { id: original.id, version: 0, confirmed: true }),
    ]);
    expect(competing.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await read()).find((task) => task.id === original.id)).toMatchObject({ recurrenceAuthority: "LIFE_OS", notes: "Preserve notes" });
    await manageTasks({ ids: [original.id], action: "complete" });
    await manageTasks({ ids: [original.id], action: "reopen" });
    await manageTasks({ ids: [original.id], action: "complete" });
    expect(await db.task.count({ where: { userId, parentTaskId: null } })).toBe(2);
    expect(await db.taskSynchronizationRecord.count({ where: { userId } })).toBe(1);
    expect(await db.taskActivityHistory.count({ where: { taskId: original.id, type: "RECURRENCE_TAKEN_OVER" } })).toBe(1);
    expect(await db.task.findFirstOrThrow({ where: { recurrenceSourceId: original.id } })).toMatchObject({ externalIds: expect.objectContaining({ microsoftRecurrenceTakenOver: true }) });
  });
  it("preserves known future occurrences and rolls back rejected or competing transfers", async () => {
    const original = await source();
    await db.microsoftConnection.create({ data: { userId, refreshToken: "", lockedUntil: new Date(Date.now() + 60000) } });
    await expect(takeOverTaskRecurrence(db, userId, { id: original.id, version: 0, confirmed: true })).rejects.toThrow("sincronización");
    expect((await db.task.findUniqueOrThrow({ where: { id: original.id } })).version).toBe(0);
    await db.microsoftConnection.update({ where: { userId }, data: { lockedUntil: null } });
    const future = await db.task.create({ data: { userId, title: "Known future", recurrenceSourceId: original.id, occurrenceDate: new Date(`${tomorrow}T00:00:00Z`), recurrence: original.recurrence!, externalIds: original.externalIds! } });
    await db.task.update({ where: { id: original.id }, data: { status: "COMPLETED" } });
    await takeOverTaskRecurrence(db, userId, { id: original.id, version: 0, confirmed: true });
    expect(await db.task.count({ where: { userId } })).toBe(2);
    expect((await read()).find((task) => task.id === future.id)?.recurrenceAuthority).toBe("LIFE_OS");
    await expect(takeOverTaskRecurrence(db, userId, { id: original.id, version: 0, confirmed: true })).rejects.toThrow();
    expect((await db.microsoftConnection.findUniqueOrThrow({ where: { userId } })).lockedUntil).toBeNull();
  });
  it("rolls back authority, version and sync lease when a database failure occurs after the authority update", async () => {
    const original = await source();
    await db.microsoftConnection.create({ data: { userId, refreshToken: "" } });
    const name = `takeover_failure_${randomUUID().replaceAll("-", "")}`;
    await db.$executeRawUnsafe(`CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."userId" = '${userId}' AND NEW.type = 'RECURRENCE_TAKEN_OVER' THEN RAISE EXCEPTION 'Injected acceptance failure'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER "${name}" BEFORE INSERT ON "TaskActivityHistory" FOR EACH ROW EXECUTE FUNCTION "${name}"()`);
    try {
      await expect(takeOverTaskRecurrence(db, userId, { id: original.id, version: 0, confirmed: true })).rejects.toThrow();
      expect(await db.task.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
      expect((await db.microsoftConnection.findUniqueOrThrow({ where: { userId } })).lockedUntil).toBeNull();
      expect(await db.taskActivityHistory.count({ where: { taskId: original.id } })).toBe(0);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER "${name}" ON "TaskActivityHistory"`);
      await db.$executeRawUnsafe(`DROP FUNCTION "${name}"()`);
    }
    await takeOverTaskRecurrence(db, userId, { id: original.id, version: 0, confirmed: true });
    expect((await read()).find((task) => task.id === original.id)?.recurrenceAuthority).toBe("LIFE_OS");
  });
  it("reconnects without reimporting, exporting or regenerating taken-over records, including unlinked provider successors", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "native-independence-test-secret-at-least-32-characters");
    vi.stubEnv("MICROSOFT_CLIENT_ID", "test-client");
    vi.stubEnv("MICROSOFT_CLIENT_SECRET", "test-client-secret");
    vi.stubEnv("MICROSOFT_REDIRECT_URI", "http://localhost:3001/api/integrations/microsoft/callback");
    const list = await db.taskList.create({ data: { userId, name: "Provider list", sync: { create: { externalId: "provider-list", baseline: { name: "Provider list" } } } } });
    const original = await source();
    await db.task.update({ where: { id: original.id }, data: { listId: list.id } });
    await db.taskSynchronizationRecord.create({ data: { userId, taskId: original.id, externalId: "provider-task", externalListId: "provider-list", baseline: {} } });
    await takeOverTaskRecurrence(db, userId, { id: original.id, version: 0, confirmed: true });
    await manageTasks({ ids: [original.id], action: "complete" });
    const archived = await db.task.create({ data: { userId, title: "Archived provider task", listId: list.id, archivedAt: new Date() } });
    await db.taskSynchronizationRecord.create({ data: { userId, taskId: archived.id, externalId: "missing-archived-task", externalListId: "provider-list", baseline: {} } });
    await db.microsoftConnection.create({ data: { userId, accountId: "original-account", refreshToken: sealMicrosoft("test-refresh") } });
    const requests: string[] = [];
    let visible = true;
    const recurrence = graphRecurrence(recurrenceSchema.parse(original.recurrence));
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input)), method = init?.method ?? "GET";
      requests.push(`${method} ${url.pathname}`);
      if (url.hostname === "login.microsoftonline.com") return Response.json({ access_token: "test-access" });
      if (url.pathname === "/v1.0/me") return Response.json({ id: "original-account" });
      if (url.pathname === "/v1.0/me/todo/lists") return Response.json({ value: [{ id: "provider-list", displayName: "Provider list" }] });
      if (url.pathname === "/v1.0/me/todo/lists/provider-list/tasks" && method === "GET") return Response.json({ value: visible ? [
        { id: "provider-task", title: "Remote changed title", status: "notStarted", recurrence },
        { id: "unlinked-successor", title: "Native takeover", status: "notStarted", recurrence },
        { id: "linked-successor", title: "Native takeover", status: "notStarted", recurrence,
          linkedResources: [{ applicationName: "LIFE OS", externalId: original.id, webUrl: `http://localhost:3001/tasks?task=${original.id}` }] },
      ] : [] });
      throw new Error(`Unexpected provider mutation ${method} ${url.pathname}`);
    }));
    const before = await db.task.findMany({ where: { userId }, orderBy: { id: "asc" } });
    await expect(syncMicrosoft(userId)).rejects.toThrow("Reconcile unlinked Microsoft recurrence");
    visible = false;
    await expect(syncMicrosoft(userId)).resolves.toBeUndefined();
    expect(await db.task.findMany({ where: { userId }, orderBy: { id: "asc" } })).toEqual(before);
    expect(requests.filter((request) => !request.startsWith("GET") && !request.includes("oauth2"))).toEqual([]);
    expect(await db.taskSynchronizationRecord.count({ where: { userId } })).toBe(2);
  });
  it("duplicates independently with selectable fields and steps, without history or provider identity", async () => {
    const original = await persistManagedTask(db, userId, { title: "Duplicate", notes: "Notes", tags: ["context"], category: "Home", status: "COMPLETED", deadline: tomorrow, scheduledDate: tomorrow, reminderAt: new Date().toISOString() });
    await db.task.create({ data: { userId, parentTaskId: original, title: "Step", status: "COMPLETED", position: 3 } });
    await db.task.update({ where: { id: original }, data: { externalIds: { microsoftRecurrenceAuthority: true } } });
    const input = { id: original, version: 0, subtasks: true, deadline: true, scheduledDate: false, timeWindow: false, reminder: false };
    const copyId = await duplicateManagedTask(db, userId, input);
    const copy = await db.task.findUniqueOrThrow({ where: { id: copyId }, include: { subtasks: true, sync: true, history: true } });
    expect(copyId).not.toBe(original);
    expect(copy).toMatchObject({ status: "TODO", completedAt: null, deadline: new Date(`${tomorrow}T00:00:00Z`), scheduledDate: null, reminderAt: null, externalIds: {}, sync: null, notes: "Notes", tags: ["context"], recurrence: null });
    expect(copy.subtasks[0]).toMatchObject({ status: "TODO", position: 3 });
    expect(copy.history.map((item) => item.type).sort()).toEqual(["CREATED", "DUPLICATED"]);
    const noSteps = await duplicateManagedTask(db, userId, { ...input, subtasks: false });
    expect(await db.task.count({ where: { parentTaskId: noSteps } })).toBe(0);
    await expect(duplicateManagedTask(db, "another-owner", input)).rejects.toThrow();
    await expect(duplicateManagedTask(db, userId, { ...input, timeWindow: true })).rejects.toThrow();
  });
  it("copies selected task timing without generating a daily plan or overlap workflow", async () => {
    const original = await persistManagedTask(db, userId, { title: "Timed copy", scheduledDate: tomorrow, startTime: "09:00", endTime: "10:00" });
    const input = { id: original, version: 0, subtasks: false, deadline: false, scheduledDate: true, timeWindow: true, reminder: false };
    const timedCopy = await duplicateManagedTask(db, userId, input);
    expect(await db.task.findUniqueOrThrow({ where: { id: timedCopy } })).toMatchObject({ startTime: "09:00", endTime: "10:00" });
    expect(await db.dailyPlan.count({ where: { userId } })).toBe(0);
    const copy = await duplicateManagedTask(db, userId, { ...input, timeWindow: false });
    expect(await db.taskDailyAssignment.count({ where: { taskId: copy } })).toBe(1);
  });
  it("archives without deleting or changing execution and hides task/list archives from every active view", async () => {
    const list = await db.taskList.create({ data: { userId, name: "Archived list" } });
    const id = await persistManagedTask(db, userId, { title: "Archive", listId: list.id, scheduledDate: today, deadline: today, important: true, urgent: true, startTime: "08:00", endTime: "09:00" });
    await manageTasks({ ids: [id], action: "archive" });
    for (const view of ["all", "today", "important", "planned", "upcoming", "overdue", "matrix"]) expect(filterTasks(await read(), { view }, today)).toEqual([]);
    expect(filterTasks(await read(), { view: "archived" }, today)).toHaveLength(1);
    expect(await db.taskDailyAssignment.count({ where: { taskId: id } })).toBe(1);
    const archivedTask = (await read()).find((task) => task.id === id)!;
    await expect(persistManagedTask(db, userId, { ...archivedTask, scheduledDate: tomorrow })).rejects.toThrow("Restaura");
    expect((await manageTasks({ ids: [id], action: "assign", date: tomorrow })).error).toMatch("Restaura");
    await manageTasks({ ids: [id], action: "unarchive" });
    await manageOrganization({ kind: "list", id: list.id, action: "archive" });
    expect(filterTasks(await read(), { view: "all" }, today)).toEqual([]);
    await manageOrganization({ kind: "list", id: list.id, action: "restore" });
    expect(filterTasks(await read(), { view: "today" }, today)).toHaveLength(1);
    expect(await db.task.count({ where: { userId } })).toBe(1);
  });
  it("reading and reopening across midnight never carries unfinished tasks forward", async () => {
    const id = await persistManagedTask(db, userId, { title: "Remain on date", scheduledDate: today });
    const before = await db.task.findUniqueOrThrow({ where: { id } });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${tomorrow}T03:00:01Z`));
    for (let i = 0; i < 3; i++) { await read(); await readHourlyPlan(db, userId, today); }
    expect(filterTasks(await read(), { view: "today" }, tomorrow)).toEqual([]);
    expect(await db.task.findUniqueOrThrow({ where: { id } })).toMatchObject({ scheduledDate: before.scheduledDate, version: before.version, updatedAt: before.updatedAt });
    expect(await db.taskDailyAssignment.count({ where: { taskId: id, date: new Date(`${tomorrow}T00:00:00Z`) } })).toBe(0);
    vi.useRealTimers();
    await manageTasks({ ids: [id], action: "reschedule", fromDate: today, date: tomorrow });
    expect((await db.task.findUniqueOrThrow({ where: { id } })).scheduledDate).toEqual(new Date(`${tomorrow}T00:00:00Z`));
  });
  it("acknowledges reminders durably and idempotently, rejects stale/foreign acknowledgements and ignores archives", async () => {
    const now = new Date(), reminderAt = new Date(now.getTime() - 1000).toISOString();
    const id = await persistManagedTask(db, userId, { title: "Reminder", reminderAt });
    expect(await readDueTaskReminders(db, userId, now)).toHaveLength(1);
    await acknowledgeTaskReminder(db, userId, { id, reminderAt });
    await acknowledgeTaskReminder(db, userId, { id, reminderAt });
    expect(await readDueTaskReminders(db, userId, now)).toEqual([]);
    expect(await db.taskActivityHistory.count({ where: { taskId: id, type: "REMINDER_ACKNOWLEDGED" } })).toBe(1);
    await expect(acknowledgeTaskReminder(db, "another-owner", { id, reminderAt })).rejects.toThrow();
    const newTime = new Date(now.getTime() - 500).toISOString();
    await db.task.update({ where: { id }, data: { reminderAt: new Date(newTime) } });
    await expect(acknowledgeTaskReminder(db, userId, { id, reminderAt })).rejects.toThrow();
    expect(await readDueTaskReminders(db, userId, now)).toHaveLength(1);
    await manageTasks({ ids: [id], action: "archive" });
    expect(await readDueTaskReminders(db, userId, now)).toEqual([]);
  });
  it("delivers due boundaries and oldest-first backlog without exposing another owner's or archived-list reminders", async () => {
    const now = new Date("2026-10-30T03:00:00Z");
    const list = await db.taskList.create({ data: { userId, name: "Hidden reminders", archivedAt: now } });
    await db.task.createMany({ data: [
      ...Array.from({ length: 31 }, (_, i) => ({ id: `reminder-${userId}-${i}`, userId, title: `${i}`, reminderAt: new Date(now.getTime() - (31 - i) * 1000) })),
      { userId, title: "At boundary", reminderAt: now },
      { userId, title: "Future", reminderAt: new Date(now.getTime() + 1) },
      { userId, title: "Archived list", listId: list.id, reminderAt: now },
      { userId, title: "Completed", status: "COMPLETED", reminderAt: now },
    ] });
    expect(await readDueTaskReminders(db, "another-owner", now)).toEqual([]);
    const first = await readDueTaskReminders(db, userId, now);
    expect(first).toHaveLength(30);
    expect(first[0].title).toBe("0");
    for (const reminder of first) await acknowledgeTaskReminder(db, userId, reminder);
    expect((await readDueTaskReminders(db, userId, now)).map((reminder) => reminder.title)).toEqual(["30", "At boundary"]);
  });
});
