"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import { requireOwnerId } from "@/lib/require-owner";
import { persistManagedTask, persistTaskList, TaskManagementError, taskHistory, statusSideEffects, dateValue, takeOverTaskRecurrence, duplicateManagedTask } from "@/lib/task-management";
import { calendarDateSchema, OWNER_TIME_ZONE } from "@/domain/daily-planning";
import { getCalendarDate } from "@/domain/calendar-date";
import { taskStatuses } from "@/domain/task-management";
import { acknowledgeTaskReminder } from "@/lib/task-reminders";

export type TaskActionResult = { error?: string; id?: string; saved?: boolean };
export async function acknowledgeReminder(raw: unknown): Promise<TaskActionResult> {
  const userId = await requireOwnerId();
  try { await acknowledgeTaskReminder(getPrisma(), userId, raw); return { saved: true }; }
  catch (error) { return failure(error); }
}
export async function refreshTaskSurfaces() {
  for (const path of ["/tasks", "/"]) revalidatePath(path);
}
function failure(error: unknown): TaskActionResult {
  if (error instanceof TaskManagementError) return { error: error.message };
  if (error instanceof z.ZodError) return { error: error.issues[0]?.message ?? "Revisa los datos" };
  if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2025", "P2034"].includes(error.code))
    return { error: "El registro cambió o ya existe Actualiza antes de continuar" };
  console.error("Task management failed", error);
  throw error;
}
export async function saveManagedTask(raw: unknown): Promise<TaskActionResult> {
  const userId = await requireOwnerId();
  try { const id = await persistManagedTask(getPrisma(), userId, raw); await refreshTaskSurfaces(); return { id, saved: true }; }
  catch (error) { return failure(error); }
}
export async function saveManagedList(raw: unknown): Promise<TaskActionResult> {
  const userId = await requireOwnerId();
  try { const id = await persistTaskList(getPrisma(), userId, raw); await refreshTaskSurfaces(); return { id, saved: true }; }
  catch (error) { return failure(error); }
}
export async function manageRecurrenceLocally(raw: unknown): Promise<TaskActionResult> {
  const userId = await requireOwnerId();
  try { const id = await takeOverTaskRecurrence(getPrisma(), userId, raw); await refreshTaskSurfaces(); return { id, saved: true }; }
  catch (error) { return failure(error); }
}
export async function duplicateTask(raw: unknown): Promise<TaskActionResult> {
  const userId = await requireOwnerId();
  try { const id = await duplicateManagedTask(getPrisma(), userId, raw); await refreshTaskSurfaces(); return { id, saved: true }; }
  catch (error) { return failure(error); }
}
const taskCommandSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(200),
  action: z.enum(["complete", "reopen", "delete", "restore", "archive", "unarchive", "important", "urgent", "quadrant", "status", "move", "assign", "unassign", "position", "reschedule"]),
  value: z.string().max(100).default(""),
  date: calendarDateSchema.optional(),
  fromDate: calendarDateSchema.optional(),
});
export async function manageTasks(raw: unknown): Promise<TaskActionResult> {
  const userId = await requireOwnerId();
  try {
    const input = taskCommandSchema.parse(raw);
    const today = getCalendarDate(OWNER_TIME_ZONE);
    const selectedDate = input.date ?? today;
    const db = getPrisma();
    await db.$transaction(async (tx) => {
      if (input.action === "move" && input.value && !await tx.taskList.findFirst({ where: { id: input.value, userId, deletedAt: null } }))
        throw new TaskManagementError("La lista no está disponible");
      for (const id of [...new Set(input.ids)]) {
        const task = await tx.task.findFirst({ where: { id, userId, ...(input.action === "restore" ? {} : { deletedAt: null }) } });
        if (!task) throw new TaskManagementError("La tarea no está disponible");
        if (input.action === "assign" || input.action === "reschedule") {
          const list = task.listId ? await tx.taskList.findUnique({ where: { id: task.listId, userId } }) : null;
          if (task.archivedAt || list?.archivedAt) throw new TaskManagementError("Restaura la tarea o su lista antes de planificar");
        }
        if (input.action === "reschedule") {
          if (!input.fromDate || input.fromDate < today || selectedDate < today) throw new TaskManagementError("Las selecciones históricas están protegidas");
          if (selectedDate === input.fromDate) continue;
          await tx.taskDailyAssignment.deleteMany({ where: { taskId: id, userId, date: dateValue(input.fromDate)! } });
          await tx.taskDailyAssignment.upsert({ where: { taskId_date: { taskId: id, date: dateValue(selectedDate)! } },
            create: { userId, taskId: id, date: dateValue(selectedDate)!, titleSnapshot: task.title, statusSnapshot: task.status, completedAt: task.completedAt }, update: {} });
          if (task.scheduledDate?.toISOString().slice(0, 10) === input.fromDate) {
            await tx.task.update({ where: { id, userId, version: task.version }, data: { scheduledDate: dateValue(selectedDate), version: { increment: 1 } } });
          }
          await taskHistory(tx, userId, id, "RESCHEDULED", { date: input.fromDate }, { date: selectedDate });
          continue;
        }
        if (input.action === "assign" || input.action === "unassign") {
          if (selectedDate < today) throw new TaskManagementError("Las selecciones históricas están protegidas");
          if (input.action === "assign") {
            await tx.taskDailyAssignment.upsert({
              where: { taskId_date: { taskId: id, date: dateValue(selectedDate)! } },
              create: { taskId: id, userId, date: dateValue(selectedDate)!, titleSnapshot: task.title, statusSnapshot: task.status, completedAt: task.completedAt,
                position: await tx.taskDailyAssignment.count({ where: { userId, date: dateValue(selectedDate)! } }) },
              update: {},
            });
          } else {
            await tx.taskDailyAssignment.deleteMany({ where: { taskId: id, userId, date: dateValue(selectedDate)! } });
            if (task.scheduledDate?.toISOString().slice(0, 10) === selectedDate)
              await tx.task.update({ where: { id, userId, version: task.version }, data: { scheduledDate: null, startTime: null, endTime: null, version: { increment: 1 } } });
          }
          await taskHistory(tx, userId, id, input.action.toUpperCase(), undefined, { date: selectedDate });
          continue;
        }
        const data: Prisma.TaskUncheckedUpdateManyInput = { version: { increment: 1 } };
        if (input.action === "complete") { data.status = "COMPLETED"; data.completedAt = task.completedAt ?? new Date(); }
        if (input.action === "reopen") { data.status = "TODO"; data.completedAt = null; }
        if (input.action === "delete") data.deletedAt = new Date();
        if (input.action === "restore") data.deletedAt = null;
        if (input.action === "archive") data.archivedAt = new Date();
        if (input.action === "unarchive") data.archivedAt = null;
        if (input.action === "important") { data.important = !task.important; data.eisenhowerClassified = true; }
        if (input.action === "urgent") { data.urgent = !task.urgent; data.eisenhowerClassified = true; }
        if (input.action === "move") data.listId = input.value || null;
        if (input.action === "position") {
          if (input.date && input.date < today) throw new TaskManagementError("Las selecciones históricas están protegidas");
          const position = z.coerce.number().int().min(0).max(1000000).parse(input.value);
          data.position = position;
          if (input.date) await tx.taskDailyAssignment.updateMany({ where: { taskId: id, userId, date: dateValue(input.date)! }, data: { position } });
        }
        if (input.action === "quadrant") {
          const quadrant = z.enum(["", "DO", "SCHEDULE", "DELEGATE", "ELIMINATE"]).parse(input.value);
          data.important = quadrant === "DO" || quadrant === "SCHEDULE";
          data.urgent = quadrant === "DO" || quadrant === "DELEGATE";
          data.eisenhowerClassified = quadrant !== "";
        }
        if (input.action === "status") {
          data.status = z.enum(taskStatuses).parse(input.value);
          data.completedAt = data.status === "COMPLETED" ? task.completedAt ?? new Date() : null;
        }
        const updated = await tx.task.update({ where: { id, userId, version: task.version }, data });
        await taskHistory(tx, userId, id, input.action.toUpperCase(), task, updated);
        if (updated.status !== task.status) await statusSideEffects(tx, updated, task.status);
      }
    }, { timeout: 20000 });
    await refreshTaskSurfaces();
    return { saved: true };
  } catch (error) { return failure(error); }
}

export async function reorderTasks(raw: unknown): Promise<TaskActionResult> {
  const userId = await requireOwnerId();
  try {
    const input = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(1000), date: calendarDateSchema.optional() }).parse(raw);
    if (new Set(input.ids).size !== input.ids.length) throw new TaskManagementError("Orden de tareas inválido");
    if (input.date && input.date < getCalendarDate(OWNER_TIME_ZONE)) throw new TaskManagementError("Las selecciones históricas están protegidas");
    await getPrisma().$transaction(async (tx) => {
      if (await tx.task.count({ where: { id: { in: input.ids }, userId, deletedAt: null, parentTaskId: null } }) !== input.ids.length)
        throw new TaskManagementError("La tarea no está disponible");
      for (const [position, id] of input.ids.entries()) {
        if (input.date) {
          const task = await tx.task.findUniqueOrThrow({ where: { id, userId } });
          await tx.taskDailyAssignment.upsert({ where: { taskId_date: { taskId: id, date: dateValue(input.date)! } },
            create: { userId, taskId: id, date: dateValue(input.date)!, titleSnapshot: task.title, statusSnapshot: task.status, completedAt: task.completedAt, position },
            update: { position } });
        } else await tx.task.update({ where: { id, userId }, data: { position, version: { increment: 1 } } });
      }
    }, { timeout: 20000 });
    await refreshTaskSurfaces(); return { saved: true };
  } catch (error) { return failure(error); }
}

export async function manageOrganization(raw: unknown): Promise<TaskActionResult> {
  const userId = await requireOwnerId();
  try {
    const input = z.object({
      kind: z.enum(["folder", "list"]),
      action: z.enum(["save", "delete", "archive", "restore", "duplicate", "position", "swap"]),
      id: z.string().max(64).default(""), name: z.string().trim().max(120).default(""),
      otherId: z.string().min(1).max(64).optional(),
      position: z.number().int().min(0).max(1000000).default(0),
    }).parse(raw);
    const db = getPrisma();
    await db.$transaction(async (tx) => {
      if (input.action === "swap") {
        if (!input.otherId || input.otherId === input.id) throw new TaskManagementError("Orden inválido");
        if (input.kind === "folder") {
          const records = await tx.taskFolder.findMany({ where: { userId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
          const a = records.findIndex((r) => r.id === input.id), b = records.findIndex((r) => r.id === input.otherId);
          if (a < 0 || b < 0) throw new TaskManagementError("La carpeta no está disponible");
          [records[a], records[b]] = [records[b], records[a]];
          for (const [position, record] of records.entries()) await tx.taskFolder.update({ where: { id: record.id }, data: { position } });
        } else {
          const records = await tx.taskList.findMany({ where: { userId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
          const a = records.findIndex((r) => r.id === input.id), b = records.findIndex((r) => r.id === input.otherId);
          if (a < 0 || b < 0) throw new TaskManagementError("La lista no está disponible");
          [records[a], records[b]] = [records[b], records[a]];
          for (const [position, record] of records.entries()) await tx.taskList.update({ where: { id: record.id }, data: { position } });
        }
        return;
      }
      if (input.kind === "folder") {
        if (input.action === "save") {
          if (!input.name) throw new TaskManagementError("Escribe un nombre de carpeta");
          if (input.id) {
            const result = await tx.taskFolder.updateMany({ where: { id: input.id, userId }, data: { name: input.name } });
            if (!result.count) throw new TaskManagementError("La carpeta no está disponible");
          } else await tx.taskFolder.create({ data: { userId, name: input.name, position: await tx.taskFolder.count({ where: { userId } }) } });
        } else {
          const folder = await tx.taskFolder.findFirst({ where: { id: input.id, userId } });
          if (!folder) throw new TaskManagementError("La carpeta no está disponible");
          if (input.action === "delete") {
            await tx.taskList.updateMany({ where: { folderId: folder.id, userId }, data: { folderId: null } });
            await tx.taskFolder.delete({ where: { id: folder.id } });
          } else if (input.action === "position") await tx.taskFolder.update({ where: { id: folder.id }, data: { position: input.position } });
          else throw new TaskManagementError("Operación de carpeta no compatible");
        }
      } else {
        const list = await tx.taskList.findFirst({ where: { id: input.id, userId } });
        if (!list) throw new TaskManagementError("La lista no está disponible");
        if (input.action === "delete") {
          // Removing a list never deletes its tasks.
          const tasks = await tx.task.findMany({ where: { listId: list.id, userId } });
          for (const task of tasks) {
            await tx.task.update({ where: { id: task.id }, data: { listId: null, version: { increment: 1 } } });
            await taskHistory(tx, userId, task.id, "LIST_REMOVED", { listId: list.id }, { listId: null });
          }
          await tx.taskList.update({ where: { id: list.id }, data: { deletedAt: new Date() } });
        } else if (input.action === "archive" || input.action === "restore") {
          await tx.taskList.update({ where: { id: list.id }, data: { archivedAt: input.action === "archive" ? new Date() : null, deletedAt: null } });
        } else if (input.action === "position") await tx.taskList.update({ where: { id: list.id }, data: { position: input.position } });
        else if (input.action === "duplicate") {
          const { id: _id, createdAt: _created, updatedAt: _updated, ...data } = list;
          void _id; void _created; void _updated;
          const copy = await tx.taskList.create({ data: { ...data, name: `${list.name} — copia`, archivedAt: null, deletedAt: null, position: list.position + 1 } });
          const tasks = await tx.task.findMany({ where: { listId: list.id, userId, parentTaskId: null, deletedAt: null }, include: { subtasks: { where: { deletedAt: null } } } });
          for (const task of tasks) {
            const created = await tx.task.create({ data: {
              userId, listId: copy.id, title: task.title, description: task.description, notes: task.notes, important: task.important, urgent: task.urgent,
              priority: task.priority, tags: task.tags, category: task.category, customFields: task.customFields ?? {}, links: task.links,
              eisenhowerClassified: task.eisenhowerClassified, position: task.position,
              estimatedMinutes: task.estimatedMinutes, status: "TODO",
            } });
            for (const step of task.subtasks) await tx.task.create({ data: { userId, parentTaskId: created.id, title: step.title, position: step.position, status: "TODO" } });
            await taskHistory(tx, userId, created.id, "LIST_DUPLICATE", undefined, { sourceId: task.id });
          }
        } else throw new TaskManagementError("Operación de lista no compatible");
      }
    }, { timeout: 20000 });
    await refreshTaskSurfaces(); return { saved: true };
  } catch (error) { return failure(error); }
}

export async function manageStep(raw: unknown): Promise<TaskActionResult> {
  const userId = await requireOwnerId();
  try {
    const input = z.object({
      taskId: z.string().min(1).max(64), id: z.string().max(64).optional(),
      title: z.string().trim().min(1).max(200), position: z.number().int().min(0).max(100000).default(0),
      completed: z.boolean().default(false), deleted: z.boolean().default(false),
      swapWithId: z.string().min(1).max(64).optional(),
    }).parse(raw);
    const db = getPrisma();
    await db.$transaction(async (tx) => {
      const task = await tx.task.findFirst({ where: { id: input.taskId, userId, parentTaskId: null, deletedAt: null } });
      if (!task) throw new TaskManagementError("La tarea no está disponible");
      if (input.swapWithId) {
        const steps = await tx.task.findMany({ where: { parentTaskId: task.id, userId, deletedAt: null }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
        const a = steps.findIndex((s) => s.id === input.id), b = steps.findIndex((s) => s.id === input.swapWithId);
        if (a < 0 || b < 0 || a === b) throw new TaskManagementError("El paso no está disponible");
        [steps[a], steps[b]] = [steps[b], steps[a]];
        for (const [position, step] of steps.entries()) await tx.task.update({ where: { id: step.id }, data: { position, version: { increment: 1 } } });
        await taskHistory(tx, userId, task.id, "STEPS_REORDERED", undefined, { ids: steps.map((s) => s.id) });
        return;
      }
      const data = { title: input.title, position: input.position, status: input.completed ? "COMPLETED" as const : "TODO" as const,
        completedAt: input.completed ? new Date() : null, deletedAt: input.deleted ? new Date() : null };
      if (input.id) {
        const updated = await tx.task.updateMany({ where: { id: input.id, parentTaskId: input.taskId, userId }, data: { ...data, version: { increment: 1 } } });
        if (!updated.count) throw new TaskManagementError("El paso no está disponible");
      } else await tx.task.create({ data: { ...data, userId, parentTaskId: input.taskId } });
      await taskHistory(tx, userId, input.taskId, "STEP_CHANGED", undefined, input);
    });
    await refreshTaskSurfaces(); return { saved: true };
  } catch (error) { return failure(error); }
}

export async function saveTaskView(raw: unknown): Promise<TaskActionResult> {
  const userId = await requireOwnerId();
  try {
    const input = z.object({ name: z.string().trim().min(1).max(120), query: z.string().max(3000) }).parse(raw);
    if (!input.query.startsWith("?")) throw new TaskManagementError("Vista inválida");
    const params = new URLSearchParams(input.query);
    if (["area", "project", "goal"].some((key) => params.has(key)) || params.get("view") === "unlinked") {
      throw new TaskManagementError("Vista inválida");
    }
    await getPrisma().taskSavedView.upsert({ where: { userId_name: { userId, name: input.name } }, create: { userId, ...input }, update: { query: input.query } });
    revalidatePath("/tasks"); return { saved: true };
  } catch (error) { return failure(error); }
}

export async function deleteTaskView(raw: unknown): Promise<TaskActionResult> {
  const userId = await requireOwnerId();
  try {
    const id = z.string().min(1).max(64).parse(raw);
    const result = await getPrisma().taskSavedView.deleteMany({ where: { id, userId } });
    if (!result.count) throw new TaskManagementError("La vista no está disponible");
    revalidatePath("/tasks"); return { saved: true };
  } catch (error) { return failure(error); }
}

export async function uploadTaskAttachment(form: FormData): Promise<TaskActionResult> {
  const userId = await requireOwnerId();
  try {
    const id = z.string().min(1).max(64).parse(form.get("taskId"));
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 5 * 1024 * 1024) throw new TaskManagementError("Selecciona un archivo de hasta 5 MB");
    if (!await getPrisma().task.findFirst({ where: { id, userId, deletedAt: null } })) throw new TaskManagementError("La tarea no está disponible");
    await getPrisma().$transaction(async (tx) => {
      await tx.taskAttachment.create({ data: { userId, taskId: id, name: file.name.slice(0, 200), mimeType: file.type || "application/octet-stream", size: file.size, content: Buffer.from(await file.arrayBuffer()) } });
      await taskHistory(tx, userId, id, "ATTACHMENT_ADDED", undefined, { name: file.name });
    });
    revalidatePath("/tasks"); return { saved: true };
  } catch (error) { return failure(error); }
}

export async function removeTaskAttachment(id: string): Promise<TaskActionResult> {
  const userId = await requireOwnerId();
  try {
    const attachment = await getPrisma().taskAttachment.findFirst({ where: { id, userId } });
    if (!attachment) throw new TaskManagementError("El archivo no está disponible");
    await getPrisma().$transaction(async (tx) => {
      await tx.taskAttachment.delete({ where: { id } });
      await taskHistory(tx, userId, attachment.taskId, "ATTACHMENT_REMOVED", { name: attachment.name });
    });
    revalidatePath("/tasks"); return { saved: true };
  } catch (error) { return failure(error); }
}
