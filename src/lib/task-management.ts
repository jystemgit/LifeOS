import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getCalendarDate } from "@/domain/calendar-date";
import { OWNER_TIME_ZONE, shiftDate, calendarDateSchema } from "@/domain/daily-planning";
import { managedTaskSchema, nextOccurrence, recurrenceSchema, listSchema, type TaskSummary, type TaskCompletionAnalysis } from "@/domain/task-management";
import { microsoftOwnsRecurrence } from "@/domain/microsoft-todo";

export class TaskManagementError extends Error {}
type Tx = Prisma.TransactionClient;
export const dateValue = (value: string | null) => value ? new Date(`${value}T00:00:00Z`) : null;
const includeTask = {
  list: true,
  assignments: true,
  subtasks: { where: { deletedAt: null }, orderBy: [{ position: "asc" as const }, { createdAt: "asc" as const }] },
};
type StoredTask = Prisma.TaskGetPayload<{ include: typeof includeTask }>;

export function serializeTask(task: StoredTask): TaskSummary {
  const fields: Record<string, string> = {};
  if (task.customFields && typeof task.customFields === "object" && !Array.isArray(task.customFields))
    for (const [key, value] of Object.entries(task.customFields)) if (typeof value === "string") fields[key] = value;
  return {
    ...task, deadline: task.deadline?.toISOString().slice(0, 10) ?? null,
    scheduledDate: task.scheduledDate?.toISOString().slice(0, 10) ?? null,
    createdAt: task.createdAt.toISOString(), completedAt: task.completedAt?.toISOString() ?? null,
    deletedAt: task.deletedAt?.toISOString() ?? null, reminderAt: task.reminderAt?.toISOString() ?? null,
    archivedAt: task.archivedAt?.toISOString() ?? null,
    listName: task.list?.name ?? null, folderId: task.list?.folderId ?? null,
    listArchived: !!task.list?.archivedAt, customFields: fields,
    recurrence: task.recurrence ? recurrenceSchema.parse(task.recurrence) : null,
    recurrenceAuthority: microsoftOwnsRecurrence(task.externalIds) ? "MICROSOFT" : "LIFE_OS",
    assignments: task.assignments.map((a) => ({ date: a.date.toISOString().slice(0, 10), position: a.position,
      titleSnapshot: a.titleSnapshot, statusSnapshot: a.statusSnapshot, completedAt: a.completedAt?.toISOString() ?? null })),
    steps: task.subtasks.map((a) => ({ id: a.id, title: a.title, status: a.status, version: a.version, position: a.position })),
  };
}
export async function readManagedTasks(db: PrismaClient, userId: string) {
  return (await db.task.findMany({ where: { userId, parentTaskId: null }, include: includeTask, orderBy: [{ position: "asc" }, { createdAt: "desc" }] })).map(serializeTask);
}
export async function readTaskCompletionAnalysis(db: PrismaClient, userId: string, today: string): Promise<TaskCompletionAnalysis> {
  calendarDateSchema.parse(today);
  const rows = await db.$queryRaw<TaskCompletionAnalysis>`
    WITH recorded AS (
      SELECT h.id, h."taskId", h."createdAt", h."after",
        COALESCE((h."after"->>'completedAt')::timestamptz, h."createdAt") AS occurred
      FROM "TaskActivityHistory" h
      JOIN "Task" t ON t.id = h."taskId" AND t."userId" = h."userId"
      WHERE h."userId" = ${userId} AND t."parentTaskId" IS NULL
        AND h."createdAt" >= (${shiftDate(today, -29)}::date::timestamp AT TIME ZONE ${OWNER_TIME_ZONE})
        AND h."after"->>'status' = 'COMPLETED'
        AND COALESCE(h."before"->>'status', '') <> 'COMPLETED'
        AND (h.type <> 'MICROSOFT_IMPORTED' OR h."after"->>'completedAt' IS NOT NULL)
    ), events AS (
      SELECT id, "taskId", "createdAt", "after",
        (occurred AT TIME ZONE ${OWNER_TIME_ZONE})::date AS day
      FROM recorded
      WHERE occurred >= (${shiftDate(today, -29)}::date::timestamp AT TIME ZONE ${OWNER_TIME_ZONE})
        AND occurred < (${shiftDate(today, 1)}::date::timestamp AT TIME ZONE ${OWNER_TIME_ZONE})
    ), completions AS (
      SELECT DISTINCT ON ("taskId", day)
        day, "after"->>'important' AS important, "after"->>'urgent' AS urgent,
        "after"->>'eisenhowerClassified' AS classified
      FROM events ORDER BY "taskId", day, "createdAt" DESC, id DESC
    )
    SELECT CASE
      WHEN classified = 'false' THEN 'UNCLASSIFIED'
      WHEN important = 'true' AND urgent = 'true' THEN 'DO'
      WHEN important = 'true' AND urgent = 'false' THEN 'SCHEDULE'
      WHEN important = 'false' AND urgent = 'true' THEN 'DELEGATE'
      WHEN important = 'false' AND urgent = 'false' THEN 'ELIMINATE'
      ELSE 'UNCLASSIFIED'
    END AS quadrant,
      (COUNT(*) FILTER (WHERE day >= ${shiftDate(today, -6)}::date))::integer AS "last7Days",
      COUNT(*)::integer AS "last30Days"
    FROM completions GROUP BY quadrant
  `;
  return (["DO", "SCHEDULE", "DELEGATE", "ELIMINATE", "UNCLASSIFIED"] as const).map((key) => {
    const row = rows.find((r) => r.quadrant === key);
    return row ?? { quadrant: key, last7Days: 0, last30Days: 0 };
  });
}
export async function readManagedTask(db: PrismaClient, userId: string, id: string) {
  const task = await db.task.findFirst({ where: { userId, id, deletedAt: null }, include: includeTask });
  return task ? serializeTask(task) : null;
}
export async function taskHistory(tx: Tx, userId: string, taskId: string, type: string, before?: unknown, after?: unknown) {
  const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  await tx.taskActivityHistory.create({ data: { userId, taskId, type,
    ...(before === undefined ? {} : { before: json(before) }), ...(after === undefined ? {} : { after: json(after) }) } });
}

export async function persistManagedTask(db: PrismaClient | Tx, userId: string, raw: unknown) {
  const result = managedTaskSchema.safeParse(raw);
  if (!result.success) throw new TaskManagementError(result.error.issues[0].message);
  const { id, version, ...input } = result.data;
  const persist = async (tx: Tx) => {
    const existing = id ? await tx.task.findFirst({ where: { id, userId, deletedAt: null } }) : null;
    if (id && (!existing || existing.version !== version)) throw new TaskManagementError("La tarea cambió o no está disponible Actualiza antes de guardar");
    const checks: [string | null, () => Promise<unknown>][] = [
      [input.listId, () => tx.taskList.findFirst({ where: { id: input.listId!, userId, deletedAt: null } })],
    ];
    for (const [value, check] of checks) if (value && !await check()) throw new TaskManagementError("Uno de los vínculos seleccionados no está disponible");
    const today = getCalendarDate(OWNER_TIME_ZONE);
    const previousDate = existing?.scheduledDate?.toISOString().slice(0, 10) ?? null;
    const list = input.listId ? await tx.taskList.findFirst({ where: { id: input.listId, userId } }) : null;
    const scheduleChanged = previousDate !== input.scheduledDate || (existing?.startTime ?? null) !== input.startTime || (existing?.endTime ?? null) !== input.endTime;
    if ((existing?.archivedAt || list?.archivedAt) && scheduleChanged)
      throw new TaskManagementError("Restaura la tarea o su lista antes de planificar");
    if (previousDate !== input.scheduledDate) {
      if (previousDate && previousDate < today || input.scheduledDate && input.scheduledDate < today)
        throw new TaskManagementError("Las selecciones históricas están protegidas");
      if (existing && previousDate) {
        await tx.taskDailyAssignment.deleteMany({ where: { userId, taskId: existing.id, date: dateValue(previousDate)! } });
      }
    }
    const { recurrence, ...rest } = input;
    const data = { ...rest, scheduledDate: dateValue(input.scheduledDate), deadline: dateValue(input.deadline),
      eisenhowerClassified: input.eisenhowerClassified ?? (input.important || input.urgent || existing?.eisenhowerClassified || false),
      reminderAt: input.reminderAt ? new Date(input.reminderAt) : null,
      recurrence: recurrence ?? Prisma.DbNull,
      completedAt: input.status === "COMPLETED" ? existing?.completedAt ?? new Date() : null,
    };
    const task = existing ? await tx.task.update({ where: { id: existing.id, userId, version }, data: { ...data, version: { increment: 1 } } })
      : await tx.task.create({ data: { ...data, userId } });
    await taskHistory(tx, userId, task.id, existing ? "MODIFIED" : "CREATED", existing ?? undefined, task);
    if (!existing || existing.status !== task.status) await statusSideEffects(tx, task, existing?.status ?? null);
    await tx.taskDailyAssignment.updateMany({ where: { taskId: task.id, date: { gte: dateValue(today)! } },
      data: { titleSnapshot: task.title, statusSnapshot: task.status, completedAt: task.completedAt } });
    if (input.scheduledDate && input.scheduledDate >= today) {
      await tx.taskDailyAssignment.upsert({
        where: { taskId_date: { taskId: task.id, date: dateValue(input.scheduledDate)! } },
        create: { taskId: task.id, userId, date: dateValue(input.scheduledDate)!, titleSnapshot: task.title, statusSnapshot: task.status, completedAt: task.completedAt },
        update: {},
      });
    }
    return task.id;
  };
  return "$transaction" in db ? db.$transaction(persist, { timeout: 20000 }) : persist(db);
}

type BasicTask = Prisma.TaskGetPayload<object>;
export async function statusSideEffects(tx: Tx, task: BasicTask, previousStatus: string | null) {
  const today = getCalendarDate(OWNER_TIME_ZONE);
  await tx.taskDailyAssignment.updateMany({ where: { taskId: task.id, date: { gte: dateValue(today)! } },
    data: { statusSnapshot: task.status, completedAt: task.completedAt } });
  if (task.status !== "COMPLETED" || previousStatus === "COMPLETED" || !task.recurrence || task.parentTaskId || task.archivedAt) return;
  if (task.listId && (await tx.taskList.findUnique({ where: { id: task.listId, userId: task.userId } }))?.archivedAt) return;
  if (microsoftOwnsRecurrence(task.externalIds)) return;
  const rule = recurrenceSchema.parse(task.recurrence);
  const next = nextOccurrence(rule, task.occurrenceDate?.toISOString().slice(0, 10) ?? task.scheduledDate?.toISOString().slice(0, 10) ?? today);
  if (!next) return;
  const sourceId = task.recurrenceSourceId ?? task.id;
  const { id: _id, createdAt: _created, updatedAt: _updated, completedAt: _completed, version: _version,
    externalIds: _external, deletedAt: _deleted, occurrenceDate: _date, ...copy } = task;
  void _id; void _created; void _updated; void _completed; void _version; void _external; void _deleted; void _date;
  const occurrence = await tx.task.upsert({
    where: { recurrenceSourceId_occurrenceDate: { recurrenceSourceId: sourceId, occurrenceDate: dateValue(next)! } },
    create: { ...copy, id: randomUUID(), customFields: task.customFields ?? {}, recurrence: rule,
      status: "TODO", completedAt: null, scheduledDate: dateValue(next),
      deadline: task.deadline ? dateValue(next) : null, reminderAt: null,
      reminderAcknowledgedAt: null,
      externalIds: microsoftRecurrenceTakenOver(task.externalIds) ? { microsoftRecurrenceTakenOver: true } : {},
      recurrenceSourceId: sourceId, occurrenceDate: dateValue(next) },
    update: {},
  });
  await taskHistory(tx, task.userId, occurrence.id, "RECURRENCE_CREATED", undefined, { sourceId, date: next });
  const steps = await tx.task.findMany({ where: { parentTaskId: task.id, deletedAt: null } });
  if (!await tx.task.count({ where: { parentTaskId: occurrence.id } })) {
    for (const step of steps) await tx.task.create({ data: { userId: task.userId, parentTaskId: occurrence.id, title: step.title, position: step.position, status: "TODO" } });
  }
}

export function microsoftRecurrenceTakenOver(externalIds: unknown): boolean {
  return !!externalIds && typeof externalIds === "object" && !Array.isArray(externalIds) &&
    "microsoftRecurrenceTakenOver" in externalIds && externalIds.microsoftRecurrenceTakenOver === true;
}

export async function lockMicrosoftRecurrence(tx: Tx, userId: string) {
  // Also serializes lease acquisition when no connection row existed at takeover.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`microsoft-recurrence:${userId}`}, 0))`;
}

export async function takeOverTaskRecurrence(db: PrismaClient, userId: string, raw: unknown) {
  const input = zTakeover.parse(raw);
  return db.$transaction(async (tx) => {
    await lockMicrosoftRecurrence(tx, userId);
    const connection = await tx.microsoftConnection.findUnique({ where: { userId } });
    if (connection?.lockedUntil && connection.lockedUntil > new Date())
      throw new TaskManagementError("Espera a que termine la sincronización antes de transferir la serie");
    if (connection) {
      const claimed = await tx.microsoftConnection.updateMany({ where: { userId, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] },
        data: { lockedUntil: new Date(Date.now() + 60000) } });
      if (claimed.count !== 1) throw new TaskManagementError("Espera a que termine la sincronización antes de transferir la serie");
    }
    const task = await tx.task.findFirst({ where: { id: input.id, userId, version: input.version, deletedAt: null, parentTaskId: null } });
    if (!task || !microsoftOwnsRecurrence(task.externalIds) || !task.recurrence)
      throw new TaskManagementError("La serie cambió o no está administrada por Microsoft");
    recurrenceSchema.parse(task.recurrence);
    const sourceId = task.recurrenceSourceId ?? task.id;
    const ids = task.externalIds && typeof task.externalIds === "object" && !Array.isArray(task.externalIds) ? task.externalIds : {};
    const updated = await tx.task.update({ where: { id: task.id, userId, version: input.version }, data: {
      externalIds: { ...ids, microsoftRecurrenceAuthority: false, microsoftRecurrenceTakenOver: true },
      recurrenceSourceId: sourceId,
      version: { increment: 1 },
    } });
    await taskHistory(tx, userId, task.id, "RECURRENCE_TAKEN_OVER", { authority: "MICROSOFT" }, {
      authority: "LIFE_OS", sourceId: updated.recurrenceSourceId, recurrence: updated.recurrence,
    });
    const related = await tx.task.findMany({ where: { userId, parentTaskId: null, id: { not: updated.id },
      OR: [{ recurrenceSourceId: sourceId }, { id: sourceId }] } });
    for (const occurrence of related) {
      const metadata = occurrence.externalIds && typeof occurrence.externalIds === "object" && !Array.isArray(occurrence.externalIds) ? occurrence.externalIds : {};
      await tx.task.update({ where: { id: occurrence.id, userId, version: occurrence.version }, data: {
        externalIds: { ...metadata, microsoftRecurrenceAuthority: false, microsoftRecurrenceTakenOver: true }, version: { increment: 1 },
      } });
      await taskHistory(tx, userId, occurrence.id, "RECURRENCE_TAKEN_OVER", undefined, { sourceId: updated.recurrenceSourceId, authority: "LIFE_OS" });
    }
    if (updated.status === "COMPLETED") await statusSideEffects(tx, updated, "TODO");
    if (connection) await tx.microsoftConnection.update({ where: { userId }, data: { lockedUntil: null } });
    return updated.id;
  }, { timeout: 20000 });
}

const zTakeover = z.object({ id: z.string().min(1).max(64), version: z.number().int().min(0), confirmed: z.literal(true) });
const duplicateSchema = z.object({
  id: z.string().min(1).max(64), version: z.number().int().min(0),
  subtasks: z.boolean(), deadline: z.boolean(), scheduledDate: z.boolean(), timeWindow: z.boolean(), reminder: z.boolean(),
}).refine((input) => !input.timeWindow || input.scheduledDate, "Copia la fecha antes de copiar el horario");

export async function duplicateManagedTask(db: PrismaClient, userId: string, raw: unknown) {
  const input = duplicateSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const source = await tx.task.findFirst({ where: { id: input.id, userId, version: input.version, parentTaskId: null, deletedAt: null } });
    if (!source) throw new TaskManagementError("La tarea cambió o no está disponible Actualiza antes de guardar");
    const created = await persistManagedTask(tx, userId, {
      title: source.title, description: source.description, notes: source.notes, listId: source.listId,
      eisenhowerClassified: source.eisenhowerClassified,
      important: source.important, urgent: source.urgent, priority: source.priority, tags: source.tags, category: source.category,
      links: source.links, customFields: source.customFields, estimatedMinutes: source.estimatedMinutes, status: "TODO",
      deadline: input.deadline ? source.deadline?.toISOString().slice(0, 10) ?? null : null,
      scheduledDate: input.scheduledDate ? source.scheduledDate?.toISOString().slice(0, 10) ?? null : null,
      startTime: input.timeWindow ? source.startTime : null, endTime: input.timeWindow ? source.endTime : null,
      reminderAt: input.reminder ? source.reminderAt?.toISOString() ?? null : null,
    });
    if (input.subtasks) {
      for (const step of await tx.task.findMany({ where: { userId, parentTaskId: source.id, deletedAt: null }, orderBy: { position: "asc" } }))
        await tx.task.create({ data: { userId, parentTaskId: created, title: step.title, notes: step.notes, position: step.position, status: "TODO" } });
    }
    await taskHistory(tx, userId, created, "DUPLICATED", undefined, { sourceId: source.id, options: input });
    return created;
  }, { timeout: 20000 });
}

export async function persistTaskList(db: PrismaClient, userId: string, raw: unknown) {
  const parsed = listSchema.safeParse(raw);
  if (!parsed.success) throw new TaskManagementError("Revisa el nombre y la configuración de la lista");
  const { id, ...data } = parsed.data;
  if (data.folderId && !await db.taskFolder.findFirst({ where: { id: data.folderId, userId } })) throw new TaskManagementError("La carpeta no está disponible");
  if (id) {
    const updated = await db.taskList.updateMany({ where: { id, userId }, data });
    if (updated.count !== 1) throw new TaskManagementError("La lista no está disponible");
    return id;
  }
  return (await db.taskList.create({ data: { ...data, userId, position: await db.taskList.count({ where: { userId } }) } })).id;
}
