import { z } from "zod";
import { zonedDateTime } from "./daily-planning";
import { recurrenceSchema, type TaskRecurrence } from "./task-management";

const graphDate = z.object({ dateTime: z.string(), timeZone: z.string() });
export const graphTaskSchema = z.object({
  id: z.string(), title: z.string().default(""),
  body: z.object({ content: z.string().default(""), contentType: z.string().default("text") }).optional(),
  status: z.string().default("notStarted"), importance: z.string().default("normal"),
  dueDateTime: graphDate.nullish(), startDateTime: graphDate.nullish(),
  isReminderOn: z.boolean().default(false), reminderDateTime: graphDate.nullish(),
  completedDateTime: graphDate.nullish(), recurrence: z.unknown().optional(),
  hasAttachments: z.boolean().default(false),
  categories: z.array(z.string()).default([]),
  linkedResources: z.array(z.object({ id: z.string().optional(), applicationName: z.string().optional(), externalId: z.string().optional() })).default([]),
});
export type GraphTask = z.infer<typeof graphTaskSchema>;
export function microsoftOwnsRecurrence(externalIds: unknown): boolean {
  return z.object({ microsoftRecurrenceAuthority: z.literal(true) }).safeParse(externalIds).success;
}
export function graphTaskSource(task: GraphTask): string | null {
  const ids = [...new Set(task.linkedResources.filter((r) => r.applicationName === "LIFE OS" && r.externalId).map((r) => r.externalId!))];
  if (ids.length > 1) throw new Error("Ambiguous LIFE OS source IDs on Microsoft task");
  return ids[0] ?? null;
}
export function graphTaskLink(taskId: string, origin: string) {
  const url = new URL("/tasks", origin);
  url.searchParams.set("task", taskId);
  return { applicationName: "LIFE OS", displayName: "LIFE OS task", externalId: taskId, webUrl: url.href };
}
export type MappedTask = {
  title: string; description: string; status: string; important: boolean;
  deadline: string | null; reminderAt: string | null;
};
export function graphInstant(value: z.infer<typeof graphDate> | null | undefined): string | null {
  if (!value) return null;
  if (value.timeZone === "UTC") return new Date(`${value.dateTime.replace(/Z$/, "")}Z`).toISOString();
  const zone = value.timeZone === "Argentina Standard Time" ? "America/Argentina/Buenos_Aires" : value.timeZone;
  return zonedDateTime(value.dateTime.slice(0, 16), zone);
}
export function fromGraphTask(raw: unknown): MappedTask {
  const task = graphTaskSchema.parse(raw);
  if (!task.title.trim() || task.title.length > 200 || (task.body?.content.length ?? 0) > 2000)
    throw new Error("Microsoft content exceeds LIFE OS task limits Resolve before synchronizing");
  if (!["notStarted", "inProgress", "completed"].includes(task.status)) throw new Error("Microsoft status has no exact LIFE OS equivalent");
  if (task.body?.contentType.toLowerCase() === "html") throw new Error("Microsoft task contains HTML notes Resolve or convert to plain text before synchronizing");
  return { title: task.title, description: task.body?.content ?? "",
    status: task.status === "completed" ? "COMPLETED" : task.status === "inProgress" ? "IN_PROGRESS" : "TODO",
    important: task.importance === "high", deadline: task.dueDateTime?.dateTime.slice(0, 10) ?? null,
    reminderAt: task.isReminderOn ? graphInstant(task.reminderDateTime) : null };
}
export function toGraphTask(task: MappedTask) {
  return { title: task.title, body: { contentType: "text", content: task.description },
    status: task.status === "COMPLETED" ? "completed" : task.status === "IN_PROGRESS" ? "inProgress" : "notStarted",
    importance: task.important ? "high" : "normal",
    dueDateTime: task.deadline ? { dateTime: `${task.deadline}T00:00:00`, timeZone: "Argentina Standard Time" } : null,
    isReminderOn: !!task.reminderAt,
    reminderDateTime: task.reminderAt ? { dateTime: task.reminderAt.replace(/Z$/, ""), timeZone: "UTC" } : null };
}
export function graphRecurrence(rule: TaskRecurrence | null) {
  if (!rule) return null;
  const days = ["", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const date = new Date(`${rule.startDate}T12:00:00Z`);
  if (rule.frequency === "DAILY" && rule.weekdays.length) throw new Error("Daily recurrence with weekday restrictions is local-only");
  return {
    pattern: { type: ({ DAILY: "daily", WEEKLY: "weekly", MONTHLY: "absoluteMonthly", YEARLY: "absoluteYearly" } as const)[rule.frequency],
      interval: rule.interval,
      ...(rule.frequency === "WEEKLY" ? { daysOfWeek: (rule.weekdays.length ? rule.weekdays : [date.getUTCDay() || 7]).map((d) => days[d]), firstDayOfWeek: "monday" } : {}),
      ...(["MONTHLY", "YEARLY"].includes(rule.frequency) ? { dayOfMonth: date.getUTCDate() } : {}),
      ...(rule.frequency === "YEARLY" ? { month: date.getUTCMonth() + 1 } : {}),
    },
    range: { type: rule.endDate ? "endDate" : "noEnd", startDate: rule.startDate,
      ...(rule.endDate ? { endDate: rule.endDate } : {}), recurrenceTimeZone: "Argentina Standard Time" },
  };
}
export function fromGraphRecurrence(raw: unknown): TaskRecurrence | null {
  if (!raw) return null;
  const parsed = z.object({
    pattern: z.object({ type: z.enum(["daily", "weekly", "absoluteMonthly", "absoluteYearly"]), interval: z.number(),
      daysOfWeek: z.array(z.string()).optional(), dayOfMonth: z.number().int().min(1).max(31).optional(),
      month: z.number().int().min(1).max(12).optional(), firstDayOfWeek: z.string().optional() }),
    range: z.object({ type: z.enum(["noEnd", "endDate"]), startDate: z.string(), endDate: z.string().optional() }),
  }).parse(raw);
  const anchor = new Date(`${parsed.range.startDate}T12:00:00Z`);
  if (["absoluteMonthly", "absoluteYearly"].includes(parsed.pattern.type) && parsed.pattern.dayOfMonth !== anchor.getUTCDate() ||
    parsed.pattern.type === "absoluteYearly" && parsed.pattern.month !== anchor.getUTCMonth() + 1)
    throw new Error("Microsoft recurrence pattern differs from its start-date anchor");
  if (parsed.pattern.type === "weekly" && parsed.pattern.interval > 1 && (parsed.pattern.firstDayOfWeek ?? "sunday") !== "monday")
    throw new Error("Microsoft weekly recurrence uses a different week boundary");
  if (parsed.range.type === "endDate" && !parsed.range.endDate)
    throw new Error("Microsoft recurrence end date is missing");
  const days = ["", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  return recurrenceSchema.parse({
    frequency: ({ daily: "DAILY", weekly: "WEEKLY", absoluteMonthly: "MONTHLY", absoluteYearly: "YEARLY" } as const)[parsed.pattern.type],
    interval: parsed.pattern.interval, startDate: parsed.range.startDate,
    endDate: parsed.range.type === "endDate" ? parsed.range.endDate : null,
    weekdays: parsed.pattern.daysOfWeek?.map((d) => days.indexOf(d)) ?? [],
  });
}
export function syncDecision(baseline: unknown, local: unknown, remote: unknown): "same" | "push" | "pull" | "conflict" {
  const canonical = (value: unknown) => JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
  const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
  if (same(local, remote)) return "same";
  const localChanged = !same(baseline, local), remoteChanged = !same(baseline, remote);
  return localChanged && remoteChanged ? "conflict" : localChanged ? "push" : "pull";
}
