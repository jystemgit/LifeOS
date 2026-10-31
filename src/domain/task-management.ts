import { z } from "zod";
import { calendarDateSchema, shiftDate } from "./daily-planning";
import { getCalendarDate } from "./calendar-date";
import { OWNER_TIME_ZONE } from "./daily-planning";

export const taskStatuses = ["INBOX", "TODO", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export const priorities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const TASK_STATUS_LABELS = { INBOX: "Bandeja de entrada", TODO: "Pendiente", IN_PROGRESS: "En curso", COMPLETED: "Completada", CANCELLED: "Cancelada" };
export const TASK_SORT_LABELS = { position: "Orden personalizado", priority: "Prioridad", deadline: "Fecha límite", createdAt: "Creación", title: "Alfabético" };
export const TASK_VIEW_LABELS = { standard: "Lista", compact: "Compacta", detailed: "Detallada", board: "Tablero", matrix: "Matriz Eisenhower", calendar: "Calendario", agenda: "Agenda" };
export const QUADRANTS = {
  DO: { label: "Q1 — Hacer", important: true, urgent: true },
  SCHEDULE: { label: "Q2 — Programar", important: true, urgent: false },
  DELEGATE: { label: "Q3 — Delegar", important: false, urgent: true },
  ELIMINATE: { label: "Q4 — Eliminar", important: false, urgent: false },
} as const;
export type Quadrant = keyof typeof QUADRANTS;
export function quadrant(task: { important: boolean; urgent: boolean }): Quadrant {
  return task.important ? task.urgent ? "DO" : "SCHEDULE" : task.urgent ? "DELEGATE" : "ELIMINATE";
}
export function taskQuadrant(task: { important: boolean; urgent: boolean; eisenhowerClassified?: boolean }): Quadrant | null {
  return task.eisenhowerClassified === false ? null : quadrant(task);
}
export function taskCalendarMonth(date: string) {
  calendarDateSchema.parse(date);
  const first = `${date.slice(0, 7)}-01`;
  const anchor = new Date(`${first}T12:00:00Z`);
  const weekday = anchor.getUTCDay() || 7;
  const start = new Date(anchor);
  start.setUTCDate(2 - weekday);
  const next = new Date(`${first}T12:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const previous = new Date(anchor);
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  const last = new Date(next);
  last.setUTCDate(0);
  const count = Math.ceil((weekday - 1 + last.getUTCDate()) / 7) * 7;
  const days = Array.from({ length: count }, (_, index) => {
    const day = new Date(start);
    day.setUTCDate(day.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  }).filter((day) => calendarDateSchema.safeParse(day).success);
  const validMonth = (instant: Date) => {
    const value = instant.toISOString().slice(0, 10);
    return calendarDateSchema.safeParse(value).success ? value : first;
  };
  return { first, previous: validMonth(previous), next: validMonth(next), days };
}
export type TaskCompletionAnalysis = {
  quadrant: Quadrant | "UNCLASSIFIED"; last7Days: number; last30Days: number;
}[];
const nullableId = z.string().min(1).max(64).nullable().default(null);
const nullableDate = calendarDateSchema.nullable().default(null);
const optionalTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable().default(null);
export const recurrenceSchema = z.object({
  frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]),
  interval: z.number().int().min(1).max(365),
  startDate: calendarDateSchema,
  endDate: calendarDateSchema.nullable().default(null),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
}).refine((rule) => !rule.endDate || rule.endDate >= rule.startDate, "El final de repetición debe ser posterior al inicio");
export type TaskRecurrence = z.infer<typeof recurrenceSchema>;
export const managedTaskSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  version: z.number().int().min(0).optional(),
  title: z.string().trim().min(1, "Escribe un título").max(200),
  description: z.string().max(2000).default(""),
  notes: z.string().max(10000).default(""),
  listId: nullableId,
  status: z.enum(taskStatuses).default("INBOX"),
  priority: z.enum(priorities).default("MEDIUM"),
  important: z.boolean().default(false), urgent: z.boolean().default(false),
  eisenhowerClassified: z.boolean().optional(),
  scheduledDate: nullableDate, deadline: nullableDate,
  startTime: optionalTime,
  endTime: z.union([z.literal("24:00"), z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)]).nullable().default(null),
  estimatedMinutes: z.number().int().min(1).max(1440).nullable().default(null),
  reminderAt: z.string().datetime().nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(50)).max(30).transform((tags) => [...new Set(tags)]).default([]),
  category: z.string().max(80).default(""),
  customFields: z.record(z.string().min(1).max(60), z.string().max(500)).refine((obj) => Object.keys(obj).length <= 30).default({}),
  links: z.array(z.string().url().max(2000).refine((url) => ["https:", "http:"].includes(new URL(url).protocol), "Usa enlaces HTTP o HTTPS")).max(20).default([]),
  recurrence: recurrenceSchema.nullable().default(null),
}).superRefine((task, ctx) => {
  if ((task.startTime === null) !== (task.endTime === null) || (task.startTime && task.endTime && task.startTime >= task.endTime))
    ctx.addIssue({ code: "custom", message: "Indica inicio y fin válidos El final debe ser posterior al inicio" });
  if (task.startTime && !task.scheduledDate) ctx.addIssue({ code: "custom", message: "Selecciona la fecha del bloque horario" });
  if (task.id && task.version === undefined) ctx.addIssue({ code: "custom", message: "Actualiza la tarea antes de editar" });
});
export type ManagedTaskInput = z.infer<typeof managedTaskSchema>;
export const listSchema = z.object({
  id: z.string().max(64).optional(), name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).default(""), folderId: nullableId,
  icon: z.enum(["list", "book", "briefcase", "home", "target"]).default("list"),
  color: z.enum(["neutral", "black", "gray", "white"]).default("neutral"),
  defaultSort: z.enum(["position", "priority", "deadline", "createdAt", "title"]).default("position"),
  defaultView: z.enum(["standard", "compact", "detailed", "board"]).default("standard"),
  showCompleted: z.boolean().default(true), showDetails: z.boolean().default(true),
});

export function nextOccurrence(rule: TaskRecurrence, afterDate: string): string | null {
  recurrenceSchema.parse(rule); calendarDateSchema.parse(afterDate);
  const start = new Date(`${rule.startDate}T12:00:00Z`);
  const after = afterDate < rule.startDate ? shiftDate(rule.startDate, -1) : afterDate;
  // Bounded search includes leap-day yearly and long interval rules without infinite loops.
  for (let i = 1; i <= 146400; i++) {
    const date = shiftDate(after, i);
    if (rule.endDate && date > rule.endDate) return null;
    const candidate = new Date(`${date}T12:00:00Z`);
    const elapsedDays = Math.round((candidate.getTime() - start.getTime()) / 86400000);
    const day = candidate.getUTCDay() || 7;
    if (rule.frequency === "DAILY" && elapsedDays % rule.interval === 0 && (!rule.weekdays.length || rule.weekdays.includes(day))) return date;
    if (rule.frequency === "WEEKLY") {
      const startWeek = start.getTime() - ((start.getUTCDay() || 7) - 1) * 86400000;
      const week = Math.floor((candidate.getTime() - startWeek) / (7 * 86400000));
      if (week % rule.interval === 0 && (rule.weekdays.length ? rule.weekdays : [start.getUTCDay() || 7]).includes(day)) return date;
    }
    if (rule.frequency === "MONTHLY") {
      const months = (candidate.getUTCFullYear() - start.getUTCFullYear()) * 12 + candidate.getUTCMonth() - start.getUTCMonth();
      const lastDay = new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, 0)).getUTCDate();
      if (months % rule.interval === 0 && candidate.getUTCDate() === Math.min(start.getUTCDate(), lastDay)) return date;
    }
    if (rule.frequency === "YEARLY" && (candidate.getUTCFullYear() - start.getUTCFullYear()) % rule.interval === 0 &&
      candidate.getUTCMonth() === start.getUTCMonth()) {
      const lastDay = new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, 0)).getUTCDate();
      if (candidate.getUTCDate() === Math.min(start.getUTCDate(), lastDay)) return date;
    }
  }
  return null;
}

export const WORKSPACE_VIEWS = {
  active: "Tareas activas", today: "Mi día", all: "Todas las tareas", important: "Importantes", planned: "Planificadas",
  upcoming: "Próximas", overdue: "Vencidas", unscheduled: "Sin programar", completed: "Completadas",
  matrix: "Matriz Eisenhower", lists: "Mis listas", inbox: "Bandeja",
  noDue: "Sin fecha límite", recent: "Completadas recientemente", archived: "Tareas archivadas", trash: "Papelera",
} as const;
export type WorkspaceView = keyof typeof WORKSPACE_VIEWS;
export type TaskSummary = {
  id: string; version: number; title: string; description: string; notes: string;
  status: typeof taskStatuses[number]; priority: typeof priorities[number]; important: boolean; urgent: boolean;
  eisenhowerClassified?: boolean;
  listId: string | null; listName: string | null; folderId: string | null; listArchived: boolean;
  scheduledDate: string | null; deadline: string | null; startTime: string | null; endTime: string | null;
  estimatedMinutes: number | null; reminderAt: string | null; tags: string[]; category: string;
  customFields: Record<string, string>; links: string[]; recurrence: TaskRecurrence | null;
  recurrenceAuthority?: "LIFE_OS" | "MICROSOFT";
  archivedAt?: string | null;
  createdAt: string; completedAt: string | null; deletedAt: string | null; position: number;
  assignments: { date: string; position: number; titleSnapshot: string; statusSnapshot: string; completedAt: string | null }[];
  steps: { id: string; title: string; status: string; version: number; position: number }[];
};
export type TaskFilters = {
  view?: string; q?: string; list?: string; folder?: string; quadrant?: string; important?: string; urgent?: string;
  priority?: string; status?: string; due?: string; scheduled?: string; recurrence?: string;
};
export function isTaskArchived(task: Pick<TaskSummary, "archivedAt" | "listArchived">) {
  return !!task.archivedAt || task.listArchived;
}
export function filterTasks(tasks: TaskSummary[], filter: TaskFilters, date: string, currentDate = date): TaskSummary[] {
  const view = filter.view ?? "all";
  const open = (a: TaskSummary) => !["COMPLETED", "CANCELLED"].includes(a.status);
  return tasks.filter((a) => {
    const historicalSelection = view === "today" && date < currentDate && a.assignments.some((d) => d.date === date);
    const historicalSnapshot = historicalSelection ? a.assignments.find((d) => d.date === date) : null;
    if (view === "trash" ? !a.deletedAt : !!a.deletedAt && !historicalSelection) return false;
    if (view === "archived" ? !isTaskArchived(a) : view !== "trash" && isTaskArchived(a) && !historicalSelection) return false;
    const allocated = a.assignments.some((d) => d.date === date) || a.scheduledDate === date;
    if (view === "today" && !allocated) return false;
    if (view === "active" && !open(a)) return false;
    if (view === "important" && (!a.important || !open(a))) return false;
    if (view === "inbox" && a.status !== "INBOX") return false;
    if (view === "planned" && (!a.scheduledDate && !a.deadline && !a.assignments.some((d) => d.date >= date) || !open(a))) return false;
    if (view === "upcoming" && (!open(a) || !((a.scheduledDate && a.scheduledDate > date) || (a.deadline && a.deadline > date) || a.assignments.some((d) => d.date > date)))) return false;
    if (view === "overdue" && (!open(a) || !a.deadline || a.deadline >= date)) return false;
    if (view === "unscheduled" && (a.scheduledDate || a.assignments.some((d) => d.date >= date) || !open(a))) return false;
    if (view === "completed" && a.status !== "COMPLETED") return false;
    if (view === "recent" && (a.status !== "COMPLETED" || !a.completedAt ||
      getCalendarDate(OWNER_TIME_ZONE, new Date(a.completedAt)) < shiftDate(date, -7) ||
      getCalendarDate(OWNER_TIME_ZONE, new Date(a.completedAt)) > date)) return false;
    if (view === "noDue" && (a.deadline || !open(a))) return false;
    if (view === "matrix" && !open(a)) return false;
    if (filter.q && ![a.title, a.description, a.notes, a.listName ?? "", ...a.tags].join(" ").toLocaleLowerCase().includes(filter.q.toLocaleLowerCase())) return false;
    if (filter.list && a.listId !== filter.list) return false;
    if (filter.folder && a.folderId !== filter.folder) return false;
    if (filter.quadrant && (filter.quadrant === "none" ? taskQuadrant(a) !== null : taskQuadrant(a) !== filter.quadrant)) return false;
    if (filter.important && a.important !== (filter.important === "true")) return false;
    if (filter.urgent && a.urgent !== (filter.urgent === "true")) return false;
    if (filter.priority && a.priority !== filter.priority) return false;
    if (filter.status && (historicalSnapshot?.statusSnapshot ?? a.status) !== filter.status) return false;
    if (filter.due && a.deadline !== filter.due) return false;
    if (filter.scheduled && a.scheduledDate !== filter.scheduled && !a.assignments.some((d) => d.date === filter.scheduled)) return false;
    if (filter.recurrence && !!a.recurrence !== (filter.recurrence === "true")) return false;
    return true;
  });
}
