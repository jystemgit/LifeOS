import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type TaskSynchronizationRecord } from "@/generated/prisma/client";
vi.mock("server-only", () => ({}));
import { syncMicrosoftChecklist, microsoftChecklistLocalChanged, microsoftChecklistRemoteChanged } from "./microsoft-checklist";

const databaseUrl = process.env.TASK_MANAGEMENT_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("Microsoft checklist PostgreSQL synchronization", () => {
  let db: PrismaClient, userId: string, parent: TaskSynchronizationRecord;
  type Item = { id: string; displayName: string; isChecked: boolean; checkedDateTime?: string };
  let items: Item[], failCreate: boolean;
  const graph = {
    collection: vi.fn(async () => items.map((item) => ({ ...item }))),
    call: vi.fn(async (path: string, method = "GET", data?: unknown): Promise<unknown> => {
      if (method === "POST") {
        const item = { id: randomUUID(), ...data as Omit<Item, "id"> };
        items.push(item);
        if (failCreate) { failCreate = false; throw new Error("Ambiguous checklist create"); }
        return { ...item };
      }
      const id = decodeURIComponent(path.split("/").at(-1)!);
      const index = items.findIndex((item) => item.id === id);
      if (method === "DELETE") { if (index >= 0) items.splice(index, 1); return null; }
      if (method === "PATCH" && index >= 0) { Object.assign(items[index], data); return { ...items[index] }; }
      throw new Error(`Unexpected checklist request ${method} ${path}`);
    }),
  };
  beforeEach(async () => {
    vi.clearAllMocks(); items = []; failCreate = false;
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl!, options: "-c timezone=UTC" }) });
    userId = `checklist-test-${randomUUID()}`;
    await db.user.create({ data: { id: userId, name: "Checklist fixture", email: `${userId}@example.invalid` } });
    const task = await db.task.create({ data: { userId, title: "Checklist parent", notes: "Keep private parent metadata" } });
    parent = await db.taskSynchronizationRecord.create({ data: { userId, taskId: task.id, externalId: "provider-parent", externalListId: "provider-list", baseline: {} } });
  });
  afterEach(async () => {
    await db.user.delete({ where: { id: userId } });
    await db.$disconnect();
  });
  const step = (title: string, position = 0) => db.task.create({ data: { userId, parentTaskId: parent.taskId, title, position, notes: "Keep private step metadata" } });
  const sync = (resolution?: "local" | "remote") => syncMicrosoftChecklist(db, graph, parent, resolution);
  const stored = (id: string) => db.task.findUniqueOrThrow({ where: { id } });

  it("exports and imports steps independently with stable identities, completion instants and local order", async () => {
    const local = await step("Local step", 7);
    items.push({ id: "remote-step", displayName: "Provider step", isChecked: true, checkedDateTime: "2026-10-30T12:00:00Z" });
    expect(await sync()).toEqual([]);
    expect(items).toHaveLength(2);
    const imported = await db.task.findFirstOrThrow({ where: { parentTaskId: parent.taskId, title: "Provider step" } });
    expect(imported).toMatchObject({ status: "COMPLETED", completedAt: new Date("2026-10-30T12:00:00Z"), position: 8 });
    await sync(); await sync();
    expect(await db.task.count({ where: { parentTaskId: parent.taskId } })).toBe(2);
    expect(await stored(local.id)).toMatchObject({ position: 7, notes: "Keep private step metadata" });
    expect((await stored(parent.taskId)).status).toBe("INBOX");
    expect(await db.taskActivityHistory.count({ where: { taskId: parent.taskId, type: "MICROSOFT_STEP_IMPORTED" } })).toBe(1);
  });

  it("synchronizes edits and completion both ways without overwriting local-only metadata", async () => {
    const local = await step("First");
    await sync();
    await db.task.update({ where: { id: local.id }, data: { title: "Local renamed", status: "COMPLETED", version: { increment: 1 } } });
    await sync();
    expect(items[0]).toMatchObject({ displayName: "Local renamed", isChecked: true });
    items[0].displayName = "Provider renamed"; items[0].isChecked = false;
    await sync();
    expect(await stored(local.id)).toMatchObject({ title: "Provider renamed", status: "TODO", completedAt: null, notes: "Keep private step metadata" });
  });

  it("reports concurrent edits and resolves explicitly to either side", async () => {
    const local = await step("Baseline");
    await sync();
    await db.task.update({ where: { id: local.id }, data: { title: "Local choice", version: { increment: 1 } } });
    items[0].displayName = "Provider choice";
    expect(await sync()).toEqual(["Local choice: Concurrent checklist edits or deletion"]);
    expect(items[0].displayName).toBe("Provider choice");
    expect((await stored(local.id)).title).toBe("Local choice");
    expect(await sync("local")).toEqual([]);
    expect(items[0].displayName).toBe("Local choice");
    await db.task.update({ where: { id: local.id }, data: { title: "Another local choice", version: { increment: 1 } } });
    items[0].displayName = "Final provider choice";
    expect(await sync("remote")).toEqual([]);
    expect((await stored(local.id)).title).toBe("Final provider choice");
  });

  it("propagates deletions, retains local history and recreates restored steps under new provider IDs", async () => {
    const local = await step("Restore me");
    await sync();
    const original = items[0].id;
    await db.task.update({ where: { id: local.id }, data: { deletedAt: new Date(), version: { increment: 1 } } });
    await sync();
    expect(items).toHaveLength(0);
    await sync();
    await db.task.update({ where: { id: local.id }, data: { deletedAt: null, version: { increment: 1 } } });
    await sync();
    expect(items).toHaveLength(1); expect(items[0].id).not.toBe(original);
    items = [];
    await sync();
    expect((await stored(local.id)).deletedAt).not.toBeNull();
    expect(await db.taskActivityHistory.count({ where: { taskId: parent.taskId, type: "MICROSOFT_STEP_UPDATED" } })).toBe(1);
    expect((await stored(parent.taskId)).deletedAt).toBeNull();
  });

  it("protects edits against remote deletion until the user chooses recreation or deletion", async () => {
    const local = await step("Baseline");
    await sync();
    items = [];
    await db.task.update({ where: { id: local.id }, data: { title: "Keep edited", version: { increment: 1 } } });
    expect(await sync()).toHaveLength(1);
    expect((await stored(local.id)).deletedAt).toBeNull();
    expect(await sync("local")).toEqual([]);
    expect(items[0].displayName).toBe("Keep edited");
    items = [];
    await db.task.update({ where: { id: local.id }, data: { title: "Another edit", version: { increment: 1 } } });
    await sync("remote");
    expect((await stored(local.id)).deletedAt).not.toBeNull();
  });

  it("reconciles an interrupted create without duplicating a provider step", async () => {
    const local = await step("Create once"); failCreate = true;
    await expect(sync()).rejects.toThrow("Ambiguous checklist create");
    expect(items).toHaveLength(1);
    expect((await db.microsoftChecklistMapping.findUniqueOrThrow({ where: { stepId: local.id } })).externalId).toBe(`pending:${local.id}`);
    expect(await sync()).toEqual([]);
    expect(items).toHaveLength(1);
    expect((await db.microsoftChecklistMapping.findUniqueOrThrow({ where: { stepId: local.id } })).externalId).toBe(items[0].id);
  });

  it("stops an ambiguous recovery instead of importing or creating duplicates", async () => {
    await step("Identical"); failCreate = true;
    await expect(sync()).rejects.toThrow();
    items.push({ ...items[0], id: "concurrent-identical-item" });
    expect(await sync()).toEqual(["Identical: Unconfirmed Microsoft checklist creation Review remote items before retrying"]);
    expect(items).toHaveLength(2);
    expect(await db.task.count({ where: { parentTaskId: parent.taskId } })).toBe(1);
  });

  it("reexports active steps after parent replacement but refuses uncertain native-move identities", async () => {
    const local = await step("Survive parent restoration");
    await sync();
    parent = await db.taskSynchronizationRecord.update({ where: { id: parent.id }, data: { externalId: "restored-provider-parent" } });
    items[0].id = "regenerated-checklist-identity";
    expect(await sync()).toEqual(["Checklist identity changed with its parent task Review before synchronizing steps"]);
    expect(items).toHaveLength(1);
    items = [];
    expect(await sync()).toEqual([]);
    expect(items).toHaveLength(1);
    expect((await db.microsoftChecklistMapping.findUniqueOrThrow({ where: { stepId: local.id } })).externalTaskId).toBe("restored-provider-parent");
    expect((await stored(local.id)).notes).toBe("Keep private step metadata");
  });

  it("relinks a native move only through retained provider checklist IDs and preserves three-way conflicts", async () => {
    const first = await step("Same title", 4), second = await step("Same title", 8);
    await sync();
    const before = await db.microsoftChecklistMapping.findMany({ where: { parentTaskId: parent.taskId }, orderBy: { stepId: "asc" } });
    graph.call.mockClear();
    parent = await db.taskSynchronizationRecord.update({ where: { id: parent.id }, data: { externalId: "native-moved-parent", externalListId: "native-destination" } });
    const firstMapping = before.find((mapping) => mapping.stepId === first.id)!;
    items.find((item) => item.id === firstMapping.externalId)!.displayName = "Provider edit while moving";
    await db.task.update({ where: { id: first.id }, data: { title: "Local edit while moving", version: { increment: 1 } } });
    expect(await sync()).toEqual(["Local edit while moving: Concurrent checklist edits or deletion"]);
    expect(graph.call).not.toHaveBeenCalledWith(expect.anything(), "POST", expect.anything());
    const after = await db.microsoftChecklistMapping.findMany({ where: { parentTaskId: parent.taskId }, orderBy: { stepId: "asc" } });
    expect(after.map((mapping) => [mapping.id, mapping.stepId, mapping.externalId, mapping.baseline])).toEqual(before.map((mapping) => [mapping.id, mapping.stepId, mapping.externalId, mapping.baseline]));
    expect(after.every((mapping) => mapping.externalTaskId === "native-moved-parent")).toBe(true);
    await sync("remote");
    expect(await stored(first.id)).toMatchObject({ title: "Provider edit while moving", notes: "Keep private step metadata", position: 4 });
    expect(await stored(second.id)).toMatchObject({ title: "Same title", position: 8 });
    expect(await db.taskActivityHistory.count({ where: { taskId: parent.taskId, type: "MICROSOFT_STEPS_RELINKED" } })).toBe(1);
    expect(items).toHaveLength(2);
  });

  it("does not partially rebind native checklists when some provider IDs were regenerated", async () => {
    await step("First"); await step("Second");
    await sync();
    parent = await db.taskSynchronizationRecord.update({ where: { id: parent.id }, data: { externalId: "partially-moved-parent" } });
    items[0].id = "regenerated-first";
    expect(await sync()).toEqual(["Checklist identity changed with its parent task Review before synchronizing steps"]);
    expect((await db.microsoftChecklistMapping.findMany({ where: { parentTaskId: parent.taskId } })).every((mapping) => mapping.externalTaskId === "provider-parent")).toBe(true);
    expect(await db.task.count({ where: { parentTaskId: parent.taskId } })).toBe(2);
  });

  it("rejects malformed or oversized provider values without truncation or inferred completion times", async () => {
    items.push({ id: "oversized", displayName: "x".repeat(201), isChecked: false });
    expect(await sync()).toEqual(["oversized: Checklist title exceeds LIFE OS limits"]);
    expect(await db.task.count({ where: { parentTaskId: parent.taskId } })).toBe(0);
    items = [{ id: "unknown-time", displayName: "Completed without timestamp", isChecked: true }];
    await sync();
    expect(await db.task.findFirstOrThrow({ where: { parentTaskId: parent.taskId } })).toMatchObject({ status: "COMPLETED", completedAt: null });
    items = [{ id: "broken", displayName: "Invalid timestamp", isChecked: true, checkedDateTime: "not-a-date" }];
    await expect(sync()).rejects.toThrow();
    expect(await db.task.count({ where: { parentTaskId: parent.taskId } })).toBe(1);
  });

  it("detects checklist-only edits for parent and list deletion safeguards", async () => {
    const local = await step("Protect checklist");
    expect(await microsoftChecklistLocalChanged(db, userId, parent.taskId)).toBe(true);
    await sync();
    expect(await microsoftChecklistLocalChanged(db, userId, parent.taskId)).toBe(false);
    expect(await microsoftChecklistRemoteChanged(db, graph, parent)).toBe(false);
    items[0].displayName = "Provider changed only its step";
    expect(await microsoftChecklistRemoteChanged(db, graph, parent)).toBe(true);
    await sync();
    await db.task.update({ where: { id: local.id }, data: { title: "Local changed only its step", version: { increment: 1 } } });
    expect(await microsoftChecklistLocalChanged(db, userId, parent.taskId)).toBe(true);
    expect(await microsoftChecklistLocalChanged(db, "another-owner", parent.taskId)).toBe(false);
  });

  it("keeps legitimate same-title steps independent rather than matching by title", async () => {
    await step("Same title"); await step("Same title");
    items = [{ id: "provider-same-title", displayName: "Same title", isChecked: false }];
    await sync(); await sync();
    expect(items).toHaveLength(3);
    expect(await db.task.count({ where: { userId, parentTaskId: parent.taskId } })).toBe(3);
    expect(await db.microsoftChecklistMapping.count({ where: { userId, parentTaskId: parent.taskId } })).toBe(3);
  });

  it("enforces owner-scoped step references and clears only mappings when the parent provider mapping is removed", async () => {
    const otherId = `checklist-other-${randomUUID()}`;
    await db.user.create({ data: { id: otherId, name: "Other fixture", email: `${otherId}@example.invalid` } });
    try {
      const foreign = await db.task.create({ data: { userId: otherId, title: "Other owner task" } });
      await expect(db.microsoftChecklistMapping.create({ data: {
        userId, parentTaskId: parent.taskId, stepId: foreign.id, externalId: "foreign-step", externalTaskId: parent.externalId, baseline: {},
      } })).rejects.toThrow();
      const local = await step("Preserved after parent unmapping");
      await sync();
      await db.taskSynchronizationRecord.delete({ where: { id: parent.id } });
      expect(await db.microsoftChecklistMapping.count({ where: { userId } })).toBe(0);
      expect((await stored(local.id)).parentTaskId).toBe(parent.taskId);
      expect((await stored(foreign.id)).userId).toBe(otherId);
    } finally { await db.user.delete({ where: { id: otherId } }); }
  });
});
