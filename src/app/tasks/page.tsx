import { AppShell } from "@/components/app-shell";
import { TaskWorkspace } from "@/components/task-workspace";
import { requireOwnerId } from "@/lib/require-owner";
import { getPrisma } from "@/lib/prisma";
import { readManagedTasks, readTaskCompletionAnalysis } from "@/lib/task-management";
import { OWNER_TIME_ZONE, calendarDateSchema } from "@/domain/daily-planning";
import { getCalendarDate } from "@/domain/calendar-date";
import { Prisma } from "@/generated/prisma/client";
import { TaskPushSettings } from "@/components/task-push-settings";

export const instant = false;

export default async function TasksPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const userId = await requireOwnerId();
  const params = await searchParams;
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) if (typeof value === "string") query[key] = value.slice(0, 3000);
  const today = getCalendarDate(OWNER_TIME_ZONE);
  const date = calendarDateSchema.safeParse(query.date).success ? query.date : today;
  const db = getPrisma();
  const [tasks, lists, folders, savedViews, history, attachments, microsoft, completionAnalysis, google, googleConflicts, microsoftTaskConflicts, microsoftListConflicts] = await Promise.all([
    readManagedTasks(db, userId),
    db.taskList.findMany({ where: { userId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    db.taskFolder.findMany({ where: { userId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    db.taskSavedView.findMany({ where: { userId }, orderBy: { name: "asc" } }),
    query.task ? db.taskActivityHistory.findMany({ where: { userId, taskId: query.task }, orderBy: { createdAt: "desc" }, take: 200 }) : [],
    query.task ? db.taskAttachment.findMany({ where: { userId, taskId: query.task }, select: { id: true, name: true, size: true } }) : [],
    db.microsoftConnection.findUnique({ where: { userId }, select: { lastSyncAt: true, error: true, refreshToken: true } }),
    readTaskCompletionAnalysis(db, userId, today),
    db.googleCalendarConnection.findUnique({ where: { userId }, select: { refreshToken: true, lastSyncAt: true, error: true } }),
    db.googleTaskEvent.findMany({ where: { userId, conflict: { not: Prisma.DbNull } }, select: { taskId: true, conflict: true, task: { select: { title: true } } } }),
    db.taskSynchronizationRecord.findMany({ where: { userId, conflict: { not: Prisma.DbNull } }, select: { taskId: true, conflict: true, task: { select: { title: true } } } }),
    db.taskListSynchronizationRecord.findMany({ where: { userId, conflict: { not: Prisma.DbNull } }, select: { listId: true, conflict: true, list: { select: { name: true } } } }),
  ]);
  const workspaceKey = JSON.stringify(Object.fromEntries(Object.entries(query).filter(([key]) => key !== "task").sort(([a], [b]) => a.localeCompare(b))));
  return <AppShell><TaskWorkspace key={workspaceKey} tasks={tasks} today={today} date={date} query={query} completionAnalysis={completionAnalysis}
    options={{
      lists: lists.map((l) => ({ ...l, archivedAt: l.archivedAt?.toISOString() ?? null, deletedAt: l.deletedAt?.toISOString() ?? null, createdAt: l.createdAt.toISOString(), updatedAt: l.updatedAt.toISOString() })),
      folders: folders.map((f) => ({ id: f.id, name: f.name, position: f.position })),
      savedViews: savedViews.map((v) => ({ id: v.id, name: v.name, query: v.query })),
    }}
    history={history.map((h) => ({ id: h.id, type: h.type, createdAt: h.createdAt.toISOString(), before: JSON.stringify(h.before, null, 2), after: JSON.stringify(h.after, null, 2) }))}
    attachments={attachments}
    google={{ configured: !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET && !!process.env.GOOGLE_REDIRECT_URI,
      connected: !!google?.refreshToken, lastSyncAt: google?.lastSyncAt?.toISOString() ?? null, error: google?.error ?? query.googleError ?? null,
      conflicts: googleConflicts.map((c) => ({ taskId: c.taskId, title: c.task.title, detail: JSON.stringify(c.conflict, null, 2) })) }}
    microsoft={{ configured: !!process.env.MICROSOFT_CLIENT_ID && !!process.env.MICROSOFT_CLIENT_SECRET && !!process.env.MICROSOFT_REDIRECT_URI,
      connected: !!microsoft?.refreshToken, lastSyncAt: microsoft?.lastSyncAt?.toISOString() ?? null, error: microsoft?.error ?? query.microsoftError ?? null,
      conflicts: [
        ...microsoftTaskConflicts.map((c) => ({ id: c.taskId, taskId: c.taskId, title: c.task.title, detail: JSON.stringify(c.conflict, null, 2) })),
        ...microsoftListConflicts.map((c) => ({ id: c.listId, listId: c.listId, title: c.list.name, detail: JSON.stringify(c.conflict, null, 2) })),
      ] }}
  /><TaskPushSettings /></AppShell>;
}
