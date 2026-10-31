import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { TaskManagementError, taskHistory } from "./task-management";

export async function readDueTaskReminders(db: PrismaClient, userId: string, now = new Date()) {
  const rows = await db.$queryRaw<{ id: string; title: string; reminderAt: Date }[]>`
    SELECT t.id, t.title, t."reminderAt" FROM "Task" t
    LEFT JOIN "TaskList" l ON l.id = t."listId" AND l."userId" = t."userId"
    WHERE t."userId" = ${userId} AND t."deletedAt" IS NULL AND t."archivedAt" IS NULL
      AND l."archivedAt" IS NULL AND t.status NOT IN ('COMPLETED', 'CANCELLED')
      AND t."reminderAt" <= ${now}
      AND (t."reminderAcknowledgedAt" IS NULL OR t."reminderAcknowledgedAt" <> t."reminderAt")
    ORDER BY t."reminderAt", t.id LIMIT 30
  `;
  return rows.map((row) => ({ ...row, reminderAt: row.reminderAt.toISOString() }));
}

export async function acknowledgeTaskReminder(db: PrismaClient, userId: string, raw: unknown) {
  const input = z.object({ id: z.string().min(1).max(64), reminderAt: z.iso.datetime() }).parse(raw);
  await db.$transaction(async (tx) => {
    const task = await tx.task.findFirst({ where: { id: input.id, userId, deletedAt: null, reminderAt: new Date(input.reminderAt) } });
    if (!task) throw new TaskManagementError("El recordatorio cambió Actualiza antes de continuar");
    if (task.reminderAcknowledgedAt?.getTime() === task.reminderAt?.getTime()) return;
    await tx.task.update({ where: { id: task.id, userId, version: task.version }, data: {
      reminderAcknowledgedAt: task.reminderAt, version: { increment: 1 },
    } });
    await taskHistory(tx, userId, task.id, "REMINDER_ACKNOWLEDGED", undefined, { reminderAt: input.reminderAt });
  });
}
