import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getCalendarDate } from "@/domain/calendar-date";
import { OWNER_TIME_ZONE, shiftDate } from "@/domain/daily-planning";
import { filterTasks } from "@/domain/task-management";
import { graphRecurrence } from "@/domain/microsoft-todo";
import { recurrenceSchema } from "@/domain/task-management";
import { persistManagedTask, persistTaskList, readManagedTasks, readTaskCompletionAnalysis } from "./task-management";

const mocks = vi.hoisted(() => ({ db: null as PrismaClient | null, owner: "" }));
vi.mock("@/lib/require-owner", () => ({ requireOwnerId: async () => mocks.owner }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.db! }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));
import { manageTasks, manageOrganization, manageStep, reorderTasks, uploadTaskAttachment, removeTaskAttachment, saveTaskView, deleteTaskView } from "@/app/tasks/manage-actions";
import { sealMicrosoft, syncMicrosoft } from "./microsoft-todo";
import { disconnectMicrosoft } from "@/app/tasks/microsoft-actions";

const databaseUrl = process.env.TASK_MANAGEMENT_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("task management PostgreSQL workflows", () => {
  let db: PrismaClient;
  const userId = `tasks-test-${randomUUID()}`, otherId = `tasks-other-${randomUUID()}`;
  const today = getCalendarDate(OWNER_TIME_ZONE), tomorrow = shiftDate(today, 1);
  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl!, options: "-c timezone=UTC" }) });
    mocks.db = db; mocks.owner = userId;
    await db.user.createMany({ data: [userId, otherId].map((id) => ({ id, name: "Task fixture", email: `${id}@example.invalid` })) });
  });
  afterAll(async () => {
    if (!db) return;
    await db.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await db.$disconnect();
  });
  async function get(id: string) { return (await readManagedTasks(db, userId)).find((task) => task.id === id)!; }
  it("persists quick capture, edits and history with optimistic and owner isolation", async () => {
    const id = await persistManagedTask(db, userId, { title: "Capture" });
    const initial = await get(id);
    await persistManagedTask(db, userId, { ...initial, title: "Edited", important: true, urgent: false, deadline: today });
    expect(await get(id)).toMatchObject({ title: "Edited", important: true, urgent: false, version: 1 });
    await expect(persistManagedTask(db, userId, { ...initial, title: "Stale" })).rejects.toThrow("cambió");
    await expect(persistManagedTask(db, otherId, { ...await get(id), title: "Forbidden" })).rejects.toThrow("cambió");
    expect(await db.taskActivityHistory.count({ where: { taskId: id } })).toBe(2);
  });
  it("uses completion-time quadrant snapshots and owner-local dates in historical analysis", async () => {
    const snapshot = await persistManagedTask(db, userId, { title: "History quadrant", important: true, urgent: true });
    await manageTasks({ ids: [snapshot], action: "complete" });
    await manageTasks({ ids: [snapshot], action: "important" });
    await manageTasks({ ids: [snapshot], action: "urgent" });
    const historical = await persistManagedTask(db, userId, { title: "Older completion" });
    const before = { status: "TODO" };
    const completion = (important: boolean, urgent: boolean) => ({ status: "COMPLETED", important, urgent });
    const instant = (days: number, hour = 12) => new Date(`${shiftDate(today, days)}T${String(hour).padStart(2, "0")}:00:00Z`);
    await db.taskActivityHistory.createMany({ data: [
      { userId, taskId: historical, type: "COMPLETE", before, after: completion(true, false), createdAt: instant(-10) },
      { userId, taskId: historical, type: "COMPLETE", before, after: completion(false, true), createdAt: instant(-6, 1) },
      { userId, taskId: historical, type: "COMPLETE", before, after: { status: "COMPLETED" }, createdAt: instant(-8) },
      { userId, taskId: historical, type: "COMPLETE", before, after: completion(false, false), createdAt: instant(-31) },
      { userId, taskId: historical, type: "MICROSOFT_IMPORTED", after: { ...completion(false, false), completedAt: instant(-40).toISOString() } },
      { userId, taskId: historical, type: "MICROSOFT_IMPORTED", after: { ...completion(false, false), completedAt: null } },
    ] });
    expect(await db.$queryRaw`SELECT "createdAt"::text, ("createdAt" AT TIME ZONE ${OWNER_TIME_ZONE})::date::text AS day FROM "TaskActivityHistory" WHERE "taskId" = ${historical} AND type = 'COMPLETE' ORDER BY "createdAt"`).toEqual(expect.arrayContaining([expect.objectContaining({ day: shiftDate(today, -7) })]));
    const other = await persistManagedTask(db, otherId, { title: "Other owner", status: "COMPLETED", important: false, urgent: false });
    const step = await db.task.create({ data: { userId, title: "Step, not a task", parentTaskId: snapshot } });
    await db.taskActivityHistory.create({ data: { userId, taskId: step.id, type: "COMPLETE", before, after: completion(false, false) } });
    const analysis = await readTaskCompletionAnalysis(db, userId, today);
    expect(analysis.find((r) => r.quadrant === "DO")).toMatchObject({ last7Days: 1, last30Days: 1 });
    expect(analysis.find((r) => r.quadrant === "SCHEDULE")).toMatchObject({ last7Days: 0, last30Days: 1 });
    expect(analysis.find((r) => r.quadrant === "DELEGATE")).toMatchObject({ last7Days: 0, last30Days: 1 });
    expect(analysis.find((r) => r.quadrant === "ELIMINATE")).toMatchObject({ last7Days: 0, last30Days: 0 });
    expect(analysis.find((r) => r.quadrant === "UNCLASSIFIED")).toMatchObject({ last7Days: 0, last30Days: 1 });
    const otherAnalysis = await readTaskCompletionAnalysis(db, otherId, today);
    expect(otherAnalysis.find((r) => r.quadrant === "ELIMINATE")?.last7Days).toBe(0);
    expect(otherAnalysis.find((r) => r.quadrant === "UNCLASSIFIED")?.last7Days).toBe(1);
    expect(await db.task.count({ where: { id: other } })).toBe(1);
  });
  it("selects, reorders, removes, trashes and restores the same underlying records", async () => {
    const a = await persistManagedTask(db, userId, { title: "Day A" }), b = await persistManagedTask(db, userId, { title: "Day B" });
    expect(await manageTasks({ ids: [a, b], action: "assign", date: today })).toEqual({ saved: true });
    expect(await manageTasks({ ids: [a], action: "assign", date: today })).toEqual({ saved: true });
    expect(await db.taskDailyAssignment.count({ where: { taskId: a } })).toBe(1);
    expect(await reorderTasks({ ids: [b, a], date: today })).toEqual({ saved: true });
    expect((await get(a)).assignments[0].position).toBe(1);
    await manageTasks({ ids: [a], action: "unassign", date: today });
    expect((await get(a)).assignments).toEqual([]);
    await manageTasks({ ids: [a], action: "delete" });
    expect(filterTasks([await get(a)], { view: "trash" }, today)).toHaveLength(1);
    await manageTasks({ ids: [a], action: "restore" });
    expect((await get(a)).deletedAt).toBeNull();
    expect(await db.task.count({ where: { id: { in: [a, b] } } })).toBe(2);
  });
  it("keeps historical daily snapshots when completing and renaming tasks today", async () => {
    const id = await persistManagedTask(db, userId, { title: "Original" });
    const yesterday = shiftDate(today, -1);
    await db.taskDailyAssignment.create({ data: { userId, taskId: id, date: new Date(`${yesterday}T00:00:00Z`), titleSnapshot: "Original", statusSnapshot: "TODO" } });
    await manageTasks({ ids: [id], action: "assign", date: today });
    await manageTasks({ ids: [id], action: "complete" });
    await persistManagedTask(db, userId, { ...await get(id), title: "New title" });
    const stored = await get(id);
    expect(stored.assignments.find((d) => d.date === yesterday)).toMatchObject({ titleSnapshot: "Original", statusSnapshot: "TODO", completedAt: null });
    expect(stored.assignments.find((d) => d.date === today)).toMatchObject({ titleSnapshot: "New title", statusSnapshot: "COMPLETED" });
    expect((await manageTasks({ ids: [id], action: "unassign", date: yesterday })).error).toMatch("históricas");
    expect((await reorderTasks({ ids: [id], date: yesterday })).error).toMatch("históricas");
    await expect(db.taskDailyAssignment.updateMany({ where: { taskId: id, date: new Date(`${yesterday}T00:00:00Z`) }, data: { titleSnapshot: "Corrupted" } })).rejects.toThrow();
    await manageTasks({ ids: [id], action: "delete" });
    expect(filterTasks([await get(id)], { view: "today" }, yesterday, today)).toHaveLength(1);
  });
  it("moves and clears task timing without creating hourly plan entries", async () => {
    const id = await persistManagedTask(db, userId, { title: "Scheduled", scheduledDate: today, startTime: "08:00", endTime: "09:00" });
    await persistManagedTask(db, userId, { ...await get(id), scheduledDate: tomorrow });
    expect(await db.dailyPlan.count({ where: { userId } })).toBe(0);
    await manageTasks({ ids: [id], action: "complete" });
    expect((await get(id)).status).toBe("COMPLETED");
    await persistManagedTask(db, userId, { ...await get(id), startTime: null, endTime: null });
    expect(await db.task.count({ where: { id } })).toBe(1);
  });
  it("allows independent task time ranges without an hourly-plan conflict workflow", async () => {
    const a = await persistManagedTask(db, userId, { title: "Block A", scheduledDate: tomorrow, startTime: "10:00", endTime: "11:00" });
    const b = await persistManagedTask(db, userId, { title: "Block B", scheduledDate: today, startTime: "10:00", endTime: "11:00" });
    const result = await manageTasks({ ids: [b], action: "reschedule", fromDate: today, date: tomorrow });
    expect(result).toEqual({ saved: true });
    expect((await get(b)).scheduledDate).toBe(tomorrow);
    expect((await get(b)).assignments.map((d) => d.date)).toEqual([tomorrow]);
    expect(await db.task.count({ where: { id: { in: [a, b] } } })).toBe(2);
  });
  it("persists and clears optional Eisenhower classification without inferring urgency", async () => {
    const id = await persistManagedTask(db, userId, { title: "Optional classification", deadline: today });
    expect(await get(id)).toMatchObject({ important: false, urgent: false, eisenhowerClassified: false });
    for (const [value, important, urgent] of [["DO", true, true], ["SCHEDULE", true, false], ["DELEGATE", false, true], ["ELIMINATE", false, false]] as const) {
      expect(await manageTasks({ ids: [id], action: "quadrant", value })).toEqual({ saved: true });
      expect(await get(id)).toMatchObject({ important, urgent, eisenhowerClassified: true });
    }
    expect(await manageTasks({ ids: [id], action: "quadrant", value: "" })).toEqual({ saved: true });
    expect(await get(id)).toMatchObject({ important: false, urgent: false, eisenhowerClassified: false });
  });
  it("generates one independent recurring occurrence and fresh steps even after reopen", async () => {
    const id = await persistManagedTask(db, userId, { title: "Recurring", scheduledDate: today,
      recurrence: { frequency: "DAILY", interval: 1, startDate: today } });
    await manageStep({ taskId: id, title: "Step one", position: 0, completed: true });
    await manageTasks({ ids: [id], action: "complete" });
    await manageTasks({ ids: [id], action: "reopen" });
    await manageTasks({ ids: [id], action: "complete" });
    const occurrences = await db.task.findMany({ where: { recurrenceSourceId: id }, include: { subtasks: true } });
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({ status: "TODO", completedAt: null, scheduledDate: new Date(`${tomorrow}T00:00:00Z`) });
    expect(occurrences[0].subtasks[0]).toMatchObject({ title: "Step one", status: "TODO" });
    expect((await get(id)).status).toBe("COMPLETED");
  });
  it("supports folders, list customization/duplication/archive and non-destructive deletion", async () => {
    await manageOrganization({ kind: "folder", action: "save", name: "Folder fixture" });
    const folder = await db.taskFolder.findFirstOrThrow({ where: { userId, name: "Folder fixture" } });
    const id = await persistTaskList(db, userId, { name: "Custom list", folderId: folder.id, color: "gray", defaultView: "board" });
    const taskId = await persistManagedTask(db, userId, { title: "List task", listId: id });
    await manageStep({ taskId, title: "Clone step", position: 0 });
    await manageOrganization({ kind: "list", id, action: "duplicate" });
    const duplicate = await db.taskList.findFirstOrThrow({ where: { userId, id: { not: id }, name: { startsWith: "Custom list" } } });
    expect(await db.task.count({ where: { listId: duplicate.id } })).toBe(1);
    const copied = (await readManagedTasks(db, userId)).find((t) => t.listId === duplicate.id)!;
    expect(copied.steps).toHaveLength(1);
    await manageOrganization({ kind: "list", id, action: "archive" });
    expect((await db.taskList.findUniqueOrThrow({ where: { id } })).archivedAt).not.toBeNull();
    await manageOrganization({ kind: "list", id, action: "restore" });
    await manageOrganization({ kind: "folder", id: folder.id, action: "delete" });
    expect((await db.taskList.findUniqueOrThrow({ where: { id } })).folderId).toBeNull();
    await manageOrganization({ kind: "list", id, action: "delete" });
    expect((await get(taskId)).listId).toBeNull();
    expect((await get(taskId)).deletedAt).toBeNull();
  });
  it("persists attachments and saved views, with owner-bound bulk actions", async () => {
    const id = await persistManagedTask(db, userId, { title: "Attachment" });
    const form = new FormData(); form.set("taskId", id); form.set("file", new File(["private fixture"], "fixture.txt"));
    expect(await uploadTaskAttachment(form)).toEqual({ saved: true });
    const file = await db.taskAttachment.findFirstOrThrow({ where: { taskId: id } });
    expect(Buffer.from(file.content).toString()).toBe("private fixture");
    expect(await saveTaskView({ name: "Fixture view", query: "?view=important" })).toEqual({ saved: true });
    const view = await db.taskSavedView.findUniqueOrThrow({ where: { userId_name: { userId, name: "Fixture view" } } });
    mocks.owner = otherId;
    expect((await deleteTaskView(view.id)).error).toMatch("disponible");
    expect((await manageTasks({ ids: [id], action: "delete" })).error).toMatch("disponible");
    expect((await removeTaskAttachment(file.id)).error).toMatch("disponible");
    mocks.owner = userId;
    expect(await deleteTaskView(view.id)).toEqual({ saved: true });
    expect(await db.taskSavedView.count({ where: { id: view.id } })).toBe(0);
    expect(await removeTaskAttachment(file.id)).toEqual({ saved: true });
    expect(await db.taskAttachment.count({ where: { id: file.id } })).toBe(0);
  });
  it("synchronizes supported Graph fields, protects advanced data, resolves conflicts and reconciles ambiguous creates", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "test-only-microsoft-key-never-use-in-production");
    vi.stubEnv("MICROSOFT_CLIENT_ID", "fixture-client");
    vi.stubEnv("MICROSOFT_CLIENT_SECRET", "fixture-client-secret");
    vi.stubEnv("MICROSOFT_REDIRECT_URI", "http://localhost:3001/api/integrations/microsoft/callback");
    type Remote = { id: string; title: string; body: { contentType: string; content: string }; status: string; importance: string; recurrence?: unknown; hasAttachments?: boolean; linkedResources?: { id?: string; applicationName: string; externalId: string }[] };
    const lists = [{ id: "remote-list", displayName: "Imported list" }];
    const records = new Map<string, Remote[]>([["remote-list", [{ id: "remote-task", title: "Imported task", body: { contentType: "text", content: "Body" }, status: "notStarted", importance: "normal" }]]]);
    const checklists = new Map<string, { id: string; displayName: string; isChecked: boolean }[]>();
    let interrupted = false, failNextCreate = false, failNextDelete = false, failNextChecklistCreate = false;
    let changeSourceDuringChecklistCreate: string | null = null;
    let microsoftAccountId = "fixture-microsoft-account";
    const request = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input)), method = init?.method ?? "GET";
      if (url.hostname === "login.microsoftonline.com") return Response.json({ access_token: "mock-access-token", refresh_token: "rotated-fixture-token" });
      expect(url.origin).toBe("https://graph.microsoft.com");
      if (url.pathname === "/v1.0/me") return Response.json({ id: microsoftAccountId });
      const segments = url.pathname.split("/").filter(Boolean);
      if (segments.length === 4 && segments[3] === "lists") {
        if (method === "GET") return Response.json({ value: lists });
        const body = JSON.parse(String(init?.body)) as { displayName: string };
        const list = { id: randomUUID(), displayName: body.displayName };
        lists.push(list); records.set(list.id, []); return Response.json(list);
      }
      const listId = segments[4], tasks = records.get(listId)!;
      if (segments.length === 5 && method === "DELETE") {
        const index = lists.findIndex((l) => l.id === listId);
        if (index < 0) return new Response(null, { status: 404 });
        lists.splice(index, 1); records.delete(listId);
        return new Response(null, { status: 204 });
      }
      if (segments.length === 5 && method === "PATCH") {
        const list = lists.find((l) => l.id === listId)!;
        Object.assign(list, JSON.parse(String(init?.body)));
        return Response.json(list);
      }
      if (segments[5] === "tasks") {
        if (segments[7] === "attachments" && method === "GET") return Response.json({ value: [] });
        if (segments[7] === "checklistItems") {
          const items = checklists.get(segments[6]) ?? [];
          if (method === "GET") return Response.json({ value: items });
          if (method === "POST") {
            const item = { id: randomUUID(), ...JSON.parse(String(init?.body)) };
            items.push(item); checklists.set(segments[6], items);
            if (changeSourceDuringChecklistCreate) {
              checklists.get(changeSourceDuringChecklistCreate)![0].displayName = "Source edited during successful destination copy";
              changeSourceDuringChecklistCreate = null;
            }
            if (failNextChecklistCreate) { failNextChecklistCreate = false; throw new Error("Ambiguous moved checklist creation"); }
            return Response.json(item);
          }
          const index = items.findIndex((item) => item.id === segments[8]);
          if (method === "DELETE") { if (index >= 0) items.splice(index, 1); return new Response(null, { status: 204 }); }
          if (method === "PATCH" && index >= 0) { Object.assign(items[index], JSON.parse(String(init?.body))); return Response.json(items[index]); }
          return new Response(null, { status: 404 });
        }
        if (segments[7] === "linkedResources" && method === "POST") {
          const task = tasks.find((t) => t.id === segments[6])!;
          const link = { id: randomUUID(), ...JSON.parse(String(init?.body)) } as { id: string; applicationName: string; externalId: string };
          task.linkedResources = [...task.linkedResources ?? [], link];
          return Response.json(link);
        }
        if (segments[7] === "linkedResources" && method === "DELETE") {
          const task = tasks.find((t) => t.id === segments[6])!;
          task.linkedResources = task.linkedResources?.filter((link) => link.id !== segments[8]);
          return new Response(null, { status: 204 });
        }
        if (segments.length === 6 && method === "GET") return Response.json({ value: tasks });
        if (method === "POST") {
          const item = { id: randomUUID(), ...JSON.parse(String(init?.body)) } as Remote;
          item.linkedResources = item.linkedResources?.map((link) => ({ ...link, id: randomUUID() }));
          tasks.push(item);
          if (failNextCreate) { failNextCreate = false; interrupted = true; throw new Error("Ambiguous Graph write"); }
          return Response.json(item);
        }
        const taskId = segments[6], index = tasks.findIndex((t) => t.id === taskId);
        if (method === "DELETE") {
          if (index < 0) return new Response(null, { status: 404 });
          tasks.splice(index, 1);
          if (failNextDelete) { failNextDelete = false; throw new Error("Ambiguous Graph deletion"); }
          return new Response(null, { status: 204 });
        }
        if (method === "PATCH") {
          const wasCompleted = tasks[index].status === "completed";
          Object.assign(tasks[index], JSON.parse(String(init?.body)));
          if (!wasCompleted && tasks[index].status === "completed" && tasks[index].recurrence)
            tasks.push({ ...tasks[index], id: randomUUID(), status: "notStarted", linkedResources: tasks[index].linkedResources?.map((link) => ({ ...link, id: randomUUID() })) });
          return Response.json(tasks[index]);
        }
      }
      throw new Error(`Unexpected Graph fixture request ${method} ${url.pathname}`);
    });
    vi.stubGlobal("fetch", request);
    try {
      await db.microsoftConnection.create({ data: { userId, refreshToken: sealMicrosoft("fixture-refresh-token") } });
      const listId = await persistTaskList(db, userId, { name: "Sync fixture" });
      const id = await persistManagedTask(db, userId, { title: "Local task", listId, urgent: true, priority: "HIGH", notes: "Private LIFE OS notes", tags: ["Keep"] });
      await syncMicrosoft(userId);
      expect(await db.task.count({ where: { userId, title: "Imported task" } })).toBe(1);
      const map = await db.taskSynchronizationRecord.findUniqueOrThrow({ where: { taskId: id } });
      const remote = records.get(map.externalListId)!.find((t) => t.id === map.externalId)!;
      remote.title = "Remote edit"; remote.importance = "high";
      await syncMicrosoft(userId);
      expect(await get(id)).toMatchObject({ title: "Remote edit", important: true, urgent: true, priority: "HIGH", notes: "Private LIFE OS notes", tags: ["Keep"] });
      await persistManagedTask(db, userId, { ...await get(id), title: "Local concurrent edit" });
      remote.title = "Remote concurrent edit";
      await expect(syncMicrosoft(userId)).rejects.toThrow("conflictos");
      expect((await get(id)).title).toBe("Local concurrent edit");
      expect(remote.title).toBe("Remote concurrent edit");
      await syncMicrosoft(userId, "local");
      expect(remote.title).toBe("Local concurrent edit");
      const moveListId = await persistTaskList(db, userId, { name: "Move destination" });
      await syncMicrosoft(userId);
      expect(await manageTasks({ ids: [id], action: "move", value: moveListId })).toEqual({ saved: true });
      remote.hasAttachments = true;
      await expect(syncMicrosoft(userId)).rejects.toThrow("conflictos");
      expect(records.get(map.externalListId)!.some((t) => t.id === map.externalId)).toBe(true);
      remote.hasAttachments = false;
      remote.linkedResources = [...remote.linkedResources ?? [], { id: "foreign-link", applicationName: "Another application", externalId: "foreign" }];
      await expect(syncMicrosoft(userId)).rejects.toThrow("conflictos");
      expect(records.get(map.externalListId)!.some((t) => t.id === map.externalId)).toBe(true);
      remote.linkedResources = remote.linkedResources.filter((link) => link.id !== "foreign-link");
      failNextDelete = true;
      await expect(syncMicrosoft(userId)).rejects.toThrow("Ambiguous Graph deletion");
      await syncMicrosoft(userId);
      const moved = await db.taskSynchronizationRecord.findUniqueOrThrow({ where: { taskId: id } });
      expect(moved.externalListId).not.toBe(map.externalListId);
      expect(records.get(map.externalListId)!.some((t) => t.id === map.externalId)).toBe(false);
      expect(await db.task.count({ where: { id, userId, listId: moveListId } })).toBe(1);
      const movedRemote = records.get(moved.externalListId)!.find((t) => t.id === moved.externalId)!;
      records.get(moved.externalListId)!.splice(records.get(moved.externalListId)!.indexOf(movedRemote), 1);
      records.get(map.externalListId)!.push({ ...movedRemote, id: "native-moved-id" });
      await syncMicrosoft(userId);
      expect((await get(id)).listId).toBe(listId);
      expect((await db.taskSynchronizationRecord.findUniqueOrThrow({ where: { taskId: id } })).externalId).toBe("native-moved-id");
      expect(await db.task.count({ where: { userId, title: "Local concurrent edit" } })).toBe(1);
      const uncertain = await persistManagedTask(db, userId, { title: "Ambiguous create fixture", listId });
      failNextCreate = true;
      await expect(syncMicrosoft(userId)).rejects.toThrow("Ambiguous");
      expect(interrupted).toBe(true);
      await syncMicrosoft(userId);
      expect(records.get(map.externalListId)!.filter((t) => t.title === "Ambiguous create fixture")).toHaveLength(1);
      expect((await db.taskSynchronizationRecord.findUniqueOrThrow({ where: { taskId: uncertain } })).externalId).not.toMatch(/^pending:/);
      await manageTasks({ ids: [id], action: "delete" });
      await syncMicrosoft(userId);
      expect(records.get(map.externalListId)!.some((t) => t.id === "native-moved-id")).toBe(false);
      await manageTasks({ ids: [id], action: "restore" });
      await syncMicrosoft(userId);
      const restored = await db.taskSynchronizationRecord.findUniqueOrThrow({ where: { taskId: id } });
      expect(restored.externalId).not.toBe("native-moved-id");
      expect(records.get(map.externalListId)!.some((t) => t.id === restored.externalId)).toBe(true);
      await persistManagedTask(db, userId, { ...await get(id), title: "Keep after remote deletion" });
      records.get(map.externalListId)!.splice(records.get(map.externalListId)!.findIndex((t) => t.id === restored.externalId), 1);
      await expect(syncMicrosoft(userId)).rejects.toThrow("conflictos");
      expect((await get(id)).deletedAt).toBeNull();
      await syncMicrosoft(userId, "local");
      expect(records.get(map.externalListId)!.filter((t) => t.title === "Keep after remote deletion")).toHaveLength(1);
      const secondRestore = await db.taskSynchronizationRecord.findUniqueOrThrow({ where: { taskId: id } });
      records.get(map.externalListId)!.splice(records.get(map.externalListId)!.findIndex((t) => t.id === secondRestore.externalId), 1);
      await persistManagedTask(db, userId, { ...await get(id), title: "Discard this concurrent edit" });
      await syncMicrosoft(userId, "remote");
      expect((await get(id)).deletedAt).not.toBeNull();
      await manageOrganization({ kind: "list", id: listId, action: "delete" });
      await syncMicrosoft(userId);
      expect(lists.some((l) => l.id === map.externalListId)).toBe(false);
      expect((await get(uncertain)).listId).toBeNull();
      expect((await get(uncertain)).deletedAt).toBeNull();
      await manageOrganization({ kind: "list", id: listId, action: "restore" });
      await syncMicrosoft(userId);
      expect((await db.taskListSynchronizationRecord.findUniqueOrThrow({ where: { listId } })).externalId).not.toBe(map.externalListId);
      const imported = await db.taskListSynchronizationRecord.findUniqueOrThrow({ where: { userId_externalId: { userId, externalId: "remote-list" } } });
      lists.splice(lists.findIndex((l) => l.id === "remote-list"), 1); records.delete("remote-list");
      await syncMicrosoft(userId);
      expect((await db.taskList.findUniqueOrThrow({ where: { id: imported.listId } })).deletedAt).not.toBeNull();
      expect(await db.task.count({ where: { userId, title: "Imported task", listId: null, deletedAt: null } })).toBe(1);
      const conflictList = await persistTaskList(db, userId, { name: "Deletion conflict" });
      const conflictTask = await persistManagedTask(db, userId, { title: "Preserved deletion task", listId: conflictList });
      await syncMicrosoft(userId);
      const conflictMap = await db.taskListSynchronizationRecord.findUniqueOrThrow({ where: { listId: conflictList } });
      await manageOrganization({ kind: "list", id: conflictList, action: "delete" });
      records.get(conflictMap.externalId)![0].title = "Concurrent provider edit";
      await expect(syncMicrosoft(userId)).rejects.toThrow("conflictos");
      expect(lists.some((l) => l.id === conflictMap.externalId)).toBe(true);
      await syncMicrosoft(userId, "remote");
      expect(await get(conflictTask)).toMatchObject({ title: "Concurrent provider edit", listId: conflictList, deletedAt: null });
      await persistManagedTask(db, userId, { ...await get(conflictTask), title: "Concurrent local edit" });
      lists.splice(lists.findIndex((l) => l.id === conflictMap.externalId), 1); records.delete(conflictMap.externalId);
      await expect(syncMicrosoft(userId)).rejects.toThrow("conflictos");
      expect((await get(conflictTask)).listId).toBe(conflictList);
      await syncMicrosoft(userId, "local");
      const recreatedMap = await db.taskListSynchronizationRecord.findUniqueOrThrow({ where: { listId: conflictList } });
      expect(recreatedMap.externalId).not.toBe(conflictMap.externalId);
      expect(records.get(recreatedMap.externalId)!.map((t) => t.title)).toEqual(["Concurrent local edit"]);
      // Moving the task and deleting its source list remotely must not duplicate it.
      const nativeMove = records.get(recreatedMap.externalId)![0];
      const destinationId = (await db.taskListSynchronizationRecord.findUniqueOrThrow({ where: { listId: moveListId } })).externalId;
      records.get(destinationId)!.push({ ...nativeMove, id: "move-and-delete-list" });
      lists.splice(lists.findIndex((l) => l.id === recreatedMap.externalId), 1); records.delete(recreatedMap.externalId);
      await syncMicrosoft(userId);
      expect((await get(conflictTask)).listId).toBe(moveListId);
      expect(await db.task.count({ where: { userId, title: "Concurrent local edit" } })).toBe(1);
      const stepList = await persistTaskList(db, userId, { name: "Checklist deletion protection" });
      const stepParent = await persistManagedTask(db, userId, { title: "Protect checklist changes", listId: stepList });
      await manageStep({ taskId: stepParent, title: "Protected step" });
      await syncMicrosoft(userId);
      let stepParentMapping = await db.taskSynchronizationRecord.findUniqueOrThrow({ where: { taskId: stepParent } });
      let providerStep = checklists.get(stepParentMapping.externalId)![0];
      providerStep.displayName = "Remote checklist edit";
      await manageTasks({ ids: [stepParent], action: "delete" });
      await expect(syncMicrosoft(userId)).rejects.toThrow("conflictos");
      expect(records.get(stepParentMapping.externalListId)!.some((task) => task.id === stepParentMapping.externalId)).toBe(true);
      await syncMicrosoft(userId, "remote");
      expect((await get(stepParent)).deletedAt).toBeNull();
      expect((await get(stepParent)).steps[0].title).toBe("Remote checklist edit");
      const localStepId = (await get(stepParent)).steps[0].id;
      records.get(stepParentMapping.externalListId)!.splice(records.get(stepParentMapping.externalListId)!.findIndex((task) => task.id === stepParentMapping.externalId), 1);
      await manageStep({ taskId: stepParent, id: localStepId, title: "Local checklist edit" });
      await expect(syncMicrosoft(userId)).rejects.toThrow("conflictos");
      expect((await get(stepParent)).deletedAt).toBeNull();
      await syncMicrosoft(userId, "local");
      stepParentMapping = await db.taskSynchronizationRecord.findUniqueOrThrow({ where: { taskId: stepParent } });
      providerStep = checklists.get(stepParentMapping.externalId)![0];
      expect(providerStep.displayName).toBe("Local checklist edit");
      await manageOrganization({ kind: "list", id: stepList, action: "delete" });
      providerStep.displayName = "Remote edit before list deletion";
      await expect(syncMicrosoft(userId)).rejects.toThrow("conflictos");
      expect(lists.some((list) => list.id === stepParentMapping.externalListId)).toBe(true);
      await syncMicrosoft(userId, "remote");
      expect((await get(stepParent)).listId).toBe(stepList);
      expect((await get(stepParent)).steps[0]).toMatchObject({ id: localStepId, title: "Remote edit before list deletion" });
      await manageTasks({ ids: [stepParent], action: "move", value: moveListId });
      failNextChecklistCreate = true;
      await expect(syncMicrosoft(userId)).rejects.toThrow("Ambiguous moved checklist creation");
      expect(records.get(stepParentMapping.externalListId)!.some((task) => task.id === stepParentMapping.externalId)).toBe(true);
      const pendingStepMove = await db.taskSynchronizationRecord.findUniqueOrThrow({ where: { taskId: stepParent } });
      expect(pendingStepMove.externalId).toBe(`pending:${stepParent}`);
      providerStep.displayName = "Concurrent source change during move";
      await expect(syncMicrosoft(userId)).rejects.toThrow("source checklist changed during an interrupted move");
      expect(records.get(stepParentMapping.externalListId)!.some((task) => task.id === stepParentMapping.externalId)).toBe(true);
      providerStep.displayName = "Remote edit before list deletion";
      await syncMicrosoft(userId);
      const movedStepParent = await db.taskSynchronizationRecord.findUniqueOrThrow({ where: { taskId: stepParent } });
      expect(checklists.get(movedStepParent.externalId)).toHaveLength(1);
      expect(checklists.get(movedStepParent.externalId)![0].displayName).toBe("Remote edit before list deletion");
      expect(records.get(stepParentMapping.externalListId)!.some((task) => task.id === stepParentMapping.externalId)).toBe(false);
      expect((await get(stepParent)).steps[0].id).toBe(localStepId);
      const beforeNativeStepMove = await db.taskSynchronizationRecord.findUniqueOrThrow({ where: { taskId: stepParent } });
      const nativeStepRemote = records.get(beforeNativeStepMove.externalListId)!.find((task) => task.id === beforeNativeStepMove.externalId)!;
      records.get(beforeNativeStepMove.externalListId)!.splice(records.get(beforeNativeStepMove.externalListId)!.indexOf(nativeStepRemote), 1);
      records.get(destinationId)!.push({ ...nativeStepRemote, id: "native-moved-checklist-parent" });
      checklists.set("native-moved-checklist-parent", checklists.get(beforeNativeStepMove.externalId)!.map((item) => ({ ...item })));
      const stableStepMapping = await db.microsoftChecklistMapping.findUniqueOrThrow({ where: { stepId: localStepId } });
      await syncMicrosoft(userId);
      expect((await get(stepParent)).listId).toBe(moveListId);
      expect((await get(stepParent)).steps[0].id).toBe(localStepId);
      expect(await db.microsoftChecklistMapping.findUniqueOrThrow({ where: { stepId: localStepId } })).toMatchObject({
        id: stableStepMapping.id, externalId: stableStepMapping.externalId, externalTaskId: "native-moved-checklist-parent",
      });
      await syncMicrosoft(userId);
      expect(checklists.get(movedStepParent.externalId)).toHaveLength(1);
      await manageTasks({ ids: [stepParent], action: "move", value: stepList });
      changeSourceDuringChecklistCreate = "native-moved-checklist-parent";
      await expect(syncMicrosoft(userId)).rejects.toThrow("source checklist changed during an interrupted move");
      expect(records.get(destinationId)!.some((task) => task.id === "native-moved-checklist-parent")).toBe(true);
      checklists.get("native-moved-checklist-parent")![0].displayName = "Remote edit before list deletion";
      await syncMicrosoft(userId);
      expect(records.get(destinationId)!.some((task) => task.id === "native-moved-checklist-parent")).toBe(false);
      expect((await get(stepParent)).steps[0].id).toBe(localStepId);
      const recurringId = await persistManagedTask(db, userId, { title: "Synced recurring occurrence", listId: moveListId,
        scheduledDate: today, recurrence: { frequency: "DAILY", interval: 1, startDate: today } });
      await syncMicrosoft(userId);
      await manageTasks({ ids: [recurringId], action: "complete" });
      await syncMicrosoft(userId);
      const occurrences = await db.task.findMany({ where: { userId, OR: [{ id: recurringId }, { recurrenceSourceId: recurringId }] }, include: { sync: true } });
      expect(occurrences).toHaveLength(2);
      expect(occurrences.every((t) => !!t.sync)).toBe(true);
      expect(records.get(destinationId)!.filter((t) => t.title === "Synced recurring occurrence")).toHaveLength(2);
      await manageTasks({ ids: [recurringId], action: "reopen" });
      await manageTasks({ ids: [recurringId], action: "complete" });
      await syncMicrosoft(userId);
      expect(records.get(destinationId)!.filter((t) => t.title === "Synced recurring occurrence")).toHaveLength(2);
      const next = occurrences.find((t) => t.id !== recurringId)!;
      const nextRemote = records.get(destinationId)!.find((t) => t.id === next.sync!.externalId)!;
      nextRemote.status = "completed";
      await syncMicrosoft(userId);
      expect(await db.task.count({ where: { userId, recurrenceSourceId: recurringId } })).toBe(2);
      await syncMicrosoft(userId);
      expect(records.get(destinationId)!.filter((t) => t.title === "Synced recurring occurrence")).toHaveLength(3);
      records.get(destinationId)!.push({ id: "native-series-first", title: "Native weekly series", body: { contentType: "text", content: "Provider notes" },
        status: "notStarted", importance: "normal", recurrence: graphRecurrence(recurrenceSchema.parse({ frequency: "WEEKLY", interval: 1, startDate: today, weekdays: [1, 5] })) });
      await syncMicrosoft(userId);
      const importedNative = (await readManagedTasks(db, userId)).find((task) => task.title === "Native weekly series")!;
      expect(importedNative.recurrenceAuthority).toBe("MICROSOFT");
      expect(importedNative.recurrence).toMatchObject({ frequency: "WEEKLY", weekdays: [1, 5] });
      await manageTasks({ ids: [importedNative.id], action: "complete" });
      expect(await db.task.count({ where: { userId, title: "Native weekly series" } })).toBe(1);
      await syncMicrosoft(userId); await syncMicrosoft(userId);
      const nativeOccurrences = (await readManagedTasks(db, userId)).filter((task) => task.title === "Native weekly series");
      expect(nativeOccurrences).toHaveLength(2);
      expect(nativeOccurrences.filter((task) => task.status === "COMPLETED")).toHaveLength(1);
      const nativeNext = nativeOccurrences.find((task) => task.status !== "COMPLETED")!;
      expect(nativeNext.recurrenceAuthority).toBe("MICROSOFT");
      await persistManagedTask(db, userId, { ...nativeNext, notes: "Retain local native-series data", recurrence: { ...nativeNext.recurrence!, interval: 2 } });
      await syncMicrosoft(userId);
      const nativeMapping = await db.taskSynchronizationRecord.findUniqueOrThrow({ where: { taskId: nativeNext.id } });
      expect(records.get(destinationId)!.find((task) => task.id === nativeMapping.externalId)?.recurrence).toMatchObject({ pattern: { interval: 2 } });
      await syncMicrosoft(userId);
      expect(await db.task.count({ where: { userId, title: "Native weekly series" } })).toBe(2);
      expect((await get(nativeNext.id)).notes).toBe("Retain local native-series data");
      const nativeRemote = records.get(destinationId)!.find((task) => task.id === nativeMapping.externalId)!;
      nativeRemote.recurrence = graphRecurrence({ ...nativeNext.recurrence!, interval: 3 });
      await syncMicrosoft(userId);
      expect((await get(nativeNext.id)).recurrence?.interval).toBe(3);
      nativeRemote.status = "completed";
      records.get(destinationId)!.push({ ...nativeRemote, id: "native-series-third", status: "notStarted", linkedResources: [] });
      await syncMicrosoft(userId); await syncMicrosoft(userId);
      const finalNative = (await readManagedTasks(db, userId)).filter((task) => task.title === "Native weekly series");
      expect(finalNative).toHaveLength(3);
      expect(finalNative.filter((task) => task.status === "COMPLETED")).toHaveLength(2);
      expect(finalNative.every((task) => task.recurrenceAuthority === "MICROSOFT")).toBe(true);
      lists.splice(lists.findIndex((list) => list.id === destinationId), 1); records.delete(destinationId);
      await syncMicrosoft(userId);
      expect((await get(nativeNext.id)).listId).toBeNull();
      expect(await db.taskSynchronizationRecord.count({ where: { taskId: { in: finalNative.map((task) => task.id) } } })).toBe(0);
      const recoveryList = await persistTaskList(db, userId, { name: "Native recurrence recovery" });
      const activeNative = finalNative.find((task) => task.status !== "COMPLETED")!;
      for (const taskId of [nativeNext.id, activeNative.id])
        await persistManagedTask(db, userId, { ...await get(taskId), listId: recoveryList });
      await expect(syncMicrosoft(userId)).rejects.toThrow("Reopen the completed native recurring occurrence");
      expect(await db.taskSynchronizationRecord.count({ where: { taskId: nativeNext.id } })).toBe(0);
      const recoveredNative = await db.taskSynchronizationRecord.findUniqueOrThrow({ where: { taskId: activeNative.id } });
      expect(records.get(recoveredNative.externalListId)!.find((task) => task.id === recoveredNative.externalId)?.recurrence).toMatchObject({ pattern: { type: "weekly", interval: 3 } });
      expect((await get(nativeNext.id)).notes).toBe("Retain local native-series data");
      await persistManagedTask(db, userId, { ...await get(nativeNext.id), listId: null });
      await syncMicrosoft(userId);
      expect(await db.task.count({ where: { userId, title: "Native weekly series" } })).toBe(3);
      records.get(recoveredNative.externalListId)!.push({ id: "unsupported-native", title: "Unsupported native recurrence", body: { contentType: "text", content: "" },
        status: "notStarted", importance: "normal", recurrence: { pattern: { type: "relativeMonthly", interval: 1 }, range: { type: "noEnd", startDate: today } } });
      await expect(syncMicrosoft(userId)).rejects.toThrow("Unsupported native recurrence");
      expect(await db.task.count({ where: { userId, title: "Unsupported native recurrence" } })).toBe(0);
      const beforeMismatch = JSON.stringify([...records]), beforeTaskCount = await db.task.count({ where: { userId } });
      microsoftAccountId = "different-microsoft-account";
      await expect(syncMicrosoft(userId)).rejects.toThrow("cuenta Microsoft original");
      expect(JSON.stringify([...records])).toBe(beforeMismatch);
      expect(await db.task.count({ where: { userId } })).toBe(beforeTaskCount);
      expect((await db.microsoftConnection.findUniqueOrThrow({ where: { userId } })).accountId).toBe("fixture-microsoft-account");
      mocks.owner = otherId;
      expect(await disconnectMicrosoft()).toEqual({ saved: true });
      expect((await db.microsoftConnection.findUniqueOrThrow({ where: { userId } })).refreshToken).not.toBe("");
      mocks.owner = userId;
      expect(await disconnectMicrosoft()).toEqual({ saved: true });
      expect(await db.microsoftConnection.findUniqueOrThrow({ where: { userId } })).toMatchObject({ accountId: "fixture-microsoft-account", refreshToken: "", lockedUntil: null });
      expect(await db.taskSynchronizationRecord.count({ where: { userId } })).toBeGreaterThan(0);
      const callsBeforeDisconnectedSync = request.mock.calls.length;
      await expect(syncMicrosoft(userId)).rejects.toThrow("Conecta Microsoft");
      expect(request).toHaveBeenCalledTimes(callsBeforeDisconnectedSync);
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  }, 20000);
});
