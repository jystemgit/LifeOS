import "server-only";
import { z } from "zod";
import type { PrismaClient, TaskSynchronizationRecord } from "@/generated/prisma/client";
import { syncDecision } from "@/domain/microsoft-todo";
import { taskHistory, TaskManagementError } from "./task-management";

type ChecklistClient = {
  call(path: string, method?: string, data?: unknown): Promise<unknown>;
  collection(path: string): Promise<unknown[]>;
};
const fieldsSchema = z.object({ title: z.string().trim().min(1).max(200), completed: z.boolean(), deleted: z.boolean() });
const itemSchema = z.object({
  id: z.string().min(1), displayName: z.string(), isChecked: z.boolean(),
  checkedDateTime: z.iso.datetime({ offset: true }).nullish(),
});
type Fields = z.infer<typeof fieldsSchema>;
const fields = (item: z.infer<typeof itemSchema>): Fields => fieldsSchema.parse({ title: item.displayName, completed: item.isChecked, deleted: false });
const payload = (value: Fields) => ({ displayName: value.title, isChecked: value.completed });
const stepFields = (step: { title: string; status: string; deletedAt: Date | null }): Fields =>
  ({ title: step.title, completed: step.status === "COMPLETED", deleted: !!step.deletedAt });

export async function microsoftChecklistLocalChanged(db: PrismaClient, userId: string, taskId: string) {
  const steps = await db.task.findMany({ where: { userId, parentTaskId: taskId }, include: { microsoftStep: true } });
  return steps.some((step) => !step.microsoftStep ? !step.deletedAt :
    syncDecision(step.microsoftStep.baseline, step.microsoftStep.baseline, stepFields(step)) !== "same");
}

export async function microsoftChecklistRemoteChanged(db: PrismaClient, graph: ChecklistClient, parent: TaskSynchronizationRecord) {
  const path = `me/todo/lists/${encodeURIComponent(parent.externalListId)}/tasks/${encodeURIComponent(parent.externalId)}/checklistItems`;
  const remote = z.array(itemSchema).parse(await graph.collection(path));
  const mappings = await db.microsoftChecklistMapping.findMany({ where: { userId: parent.userId, parentTaskId: parent.taskId } });
  if (remote.some((item) => !mappings.some((mapping) => mapping.externalId === item.id))) return true;
  return mappings.some((mapping) => {
    const baseline = fieldsSchema.safeParse(mapping.baseline);
    if (!baseline.success || mapping.externalTaskId !== parent.externalId) return true;
    const item = remote.find((entry) => entry.id === mapping.externalId);
    return syncDecision(baseline.data, baseline.data, item ? fields(item) : { ...baseline.data, deleted: true }) !== "same";
  });
}

export async function syncMicrosoftChecklist(db: PrismaClient, graph: ChecklistClient, parent: TaskSynchronizationRecord, resolution?: "local" | "remote") {
  const { userId, taskId } = parent;
  const path = `me/todo/lists/${encodeURIComponent(parent.externalListId)}/tasks/${encodeURIComponent(parent.externalId)}/checklistItems`;
  const remote = z.array(itemSchema).parse(await graph.collection(path));
  if (new Set(remote.map((item) => item.id)).size !== remote.length) throw new TaskManagementError("Microsoft returned duplicate checklist IDs");
  let mappings = await db.microsoftChecklistMapping.findMany({ where: { userId, parentTaskId: taskId } });
  if (mappings.some((mapping) => mapping.externalTaskId !== parent.externalId)) {
    if (remote.length) {
      const active = mappings.filter((mapping) => !fieldsSchema.safeParse(mapping.baseline).data?.deleted);
      if (!active.length || mappings.some((mapping) => mapping.externalId.startsWith("pending:")) ||
        active.some((mapping) => !remote.some((item) => item.id === mapping.externalId)))
        return ["Checklist identity changed with its parent task Review before synchronizing steps"];
      await db.$transaction(async (tx) => {
        await tx.microsoftChecklistMapping.updateMany({ where: { userId, parentTaskId: taskId }, data: { externalTaskId: parent.externalId } });
        await taskHistory(tx, userId, taskId, "MICROSOFT_STEPS_RELINKED", undefined, {
          externalTaskId: parent.externalId, stepIds: mappings.map((mapping) => mapping.stepId),
        });
      });
      mappings = mappings.map((mapping) => ({ ...mapping, externalTaskId: parent.externalId }));
    } else {
      await db.microsoftChecklistMapping.deleteMany({ where: { userId, parentTaskId: taskId } });
      mappings = [];
    }
  }
  for (const mapping of mappings.filter((entry) => entry.externalId.startsWith("pending:"))) {
    const pending = z.object({ local: fieldsSchema, knownIds: z.array(z.string()) }).parse(mapping.baseline);
    const matches = remote.filter((item) => !pending.knownIds.includes(item.id) && syncDecision(pending.local, pending.local, fields(item)) === "same");
    if (matches.length !== 1) return [`${pending.local.title}: Unconfirmed Microsoft checklist creation Review remote items before retrying`];
    await db.microsoftChecklistMapping.update({ where: { id: mapping.id }, data: { externalId: matches[0].id, baseline: pending.local } });
  }
  mappings = await db.microsoftChecklistMapping.findMany({ where: { userId, parentTaskId: taskId } });
  const issues: string[] = [];
  for (const item of remote) {
    const parsed = fieldsSchema.safeParse({ title: item.displayName, completed: item.isChecked, deleted: false });
    if (!parsed.success) { issues.push(`${item.id}: Checklist title exceeds LIFE OS limits`); continue; }
    if (mappings.some((mapping) => mapping.externalId === item.id)) continue;
    await db.$transaction(async (tx) => {
      const last = await tx.task.aggregate({ where: { userId, parentTaskId: taskId }, _max: { position: true } });
      const step = await tx.task.create({ data: {
        userId, parentTaskId: taskId, title: parsed.data.title, status: item.isChecked ? "COMPLETED" : "TODO",
        completedAt: item.isChecked && item.checkedDateTime ? new Date(item.checkedDateTime) : null,
        position: (last._max.position ?? -1) + 1,
      } });
      await tx.microsoftChecklistMapping.create({ data: { userId, parentTaskId: taskId, stepId: step.id, externalTaskId: parent.externalId, externalId: item.id, baseline: parsed.data } });
      await taskHistory(tx, userId, taskId, "MICROSOFT_STEP_IMPORTED", undefined, { stepId: step.id, ...parsed.data });
    });
  }
  const steps = await db.task.findMany({ where: { userId, parentTaskId: taskId }, include: { microsoftStep: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
  for (const step of steps) {
    const local = stepFields(step);
    const mapping = step.microsoftStep;
    async function create() {
      const baseline = { local, knownIds: remote.map((item) => item.id) };
      const pending = mapping
        ? await db.microsoftChecklistMapping.update({ where: { id: mapping.id }, data: { externalId: `pending:${step.id}`, baseline } })
        : await db.microsoftChecklistMapping.create({ data: { userId, parentTaskId: taskId, stepId: step.id, externalTaskId: parent.externalId, externalId: `pending:${step.id}`, baseline } });
      const created = itemSchema.parse(await graph.call(path, "POST", payload(local)));
      // Capture the actual response so provider normalization remains a visible edit.
      fields(created);
      await db.microsoftChecklistMapping.update({ where: { id: pending.id }, data: { externalId: created.id, baseline: local } });
      remote.push(created);
    }
    if (!mapping) { if (!local.deleted) await create(); continue; }
    const baseline = fieldsSchema.parse(mapping.baseline);
    const item = remote.find((entry) => entry.id === mapping.externalId);
    if (!item && !local.deleted && (baseline.deleted || resolution === "local")) { await create(); continue; }
    const parsedRemote = item ? fieldsSchema.safeParse({ title: item.displayName, completed: item.isChecked, deleted: false }) : null;
    if (parsedRemote && !parsedRemote.success) continue;
    const remoteFields = parsedRemote?.success ? parsedRemote.data : { ...baseline, deleted: true };
    const decision = syncDecision(baseline, local, remoteFields);
    if (decision === "conflict" && !resolution) { issues.push(`${step.title}: Concurrent checklist edits or deletion`); continue; }
    const push = decision === "push" || decision === "conflict" && resolution === "local";
    const chosen = push ? local : remoteFields;
    if (push) {
      if (local.deleted) await graph.call(`${path}/${encodeURIComponent(mapping.externalId)}`, "DELETE");
      else if (item) await graph.call(`${path}/${encodeURIComponent(item.id)}`, "PATCH", payload(local));
      else { await create(); continue; }
    } else if (decision === "pull" || decision === "conflict") {
      await db.$transaction(async (tx) => {
        const updated = await tx.task.update({ where: { id: step.id, userId, parentTaskId: taskId, version: step.version }, data: {
          title: chosen.title, status: chosen.completed ? "COMPLETED" : "TODO", deletedAt: chosen.deleted ? new Date() : null,
          completedAt: chosen.completed ? item?.checkedDateTime ? new Date(item.checkedDateTime) : step.completedAt : null,
          version: { increment: 1 },
        } });
        await taskHistory(tx, userId, taskId, "MICROSOFT_STEP_UPDATED", step, updated);
        await tx.microsoftChecklistMapping.update({ where: { id: mapping.id }, data: { baseline: chosen } });
      });
      continue;
    }
    await db.microsoftChecklistMapping.update({ where: { id: mapping.id }, data: { baseline: chosen } });
  }
  return issues;
}
