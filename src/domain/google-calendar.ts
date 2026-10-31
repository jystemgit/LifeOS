import { z } from "zod";
import { getCalendarDate } from "./calendar-date";
import { calendarDateSchema, localMinute, minuteLabel, OWNER_TIME_ZONE, shiftDate, timeMinute, zonedDateTime } from "./daily-planning";

const eventTime = z.object({ date: calendarDateSchema.optional(), dateTime: z.string().optional(), timeZone: z.string().optional() });
export const googleEventSchema = z.object({
  id: z.string().min(1), etag: z.string().optional(), status: z.string().default("confirmed"),
  summary: z.string().optional(), description: z.string().optional(),
  start: eventTime.optional(), end: eventTime.optional(),
  recurrence: z.array(z.string()).optional(), recurringEventId: z.string().optional(),
  extendedProperties: z.object({ private: z.record(z.string(), z.string()).optional() }).optional(),
});
export type GoogleEvent = z.infer<typeof googleEventSchema>;
export const calendarTaskSchema = z.object({
  title: z.string().trim().min(1).max(200), description: z.string().max(2000),
  scheduledDate: calendarDateSchema.nullable(), startTime: z.string().nullable(), endTime: z.string().nullable(),
});
export type CalendarTask = z.infer<typeof calendarTaskSchema>;
export function fromGoogleEvent(event: GoogleEvent): CalendarTask {
  if (event.recurrence?.length || event.recurringEventId) throw new Error("Manage recurring Google events as independent LIFE OS occurrences");
  if (!event.start || !event.end) throw new Error("Google event dates are missing");
  let date: string, startTime: string | null = null, endTime: string | null = null;
  if (event.start.date && event.end.date) {
    date = event.start.date;
    if (event.end.date !== shiftDate(date, 1)) throw new Error("Multi-day Google events need separate daily tasks");
  } else {
    if (!event.start.dateTime || !event.end.dateTime) throw new Error("Mixed Google event date types");
    const instant = (value: string, zone?: string) => {
      const parts = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/i.exec(value);
      if (!parts) throw new Error("Google event datetime is invalid");
      calendarDateSchema.parse(parts[1].slice(0, 10)); timeMinute(parts[1].slice(11));
      if (parts[2] && parts[2] !== "00" || parts[3] && Number(parts[3]) !== 0) throw new Error("Google event times must use whole minutes");
      if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return new Date(value);
      if (!zone) throw new Error("Google event timezone is missing");
      const converted = zonedDateTime(value.slice(0, 16), zone);
      if (!converted) throw new Error("Google event time is invalid");
      return new Date(converted);
    };
    const start = instant(event.start.dateTime, event.start.timeZone), end = instant(event.end.dateTime, event.end.timeZone);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new Error("Google event time range is invalid");
    if (start.getUTCSeconds() || end.getUTCSeconds() || start.getUTCMilliseconds() || end.getUTCMilliseconds())
      throw new Error("Google event times must use whole minutes");
    date = getCalendarDate(OWNER_TIME_ZONE, start);
    const endDate = getCalendarDate(OWNER_TIME_ZONE, end), endMinute = localMinute(end);
    if (endDate !== date && !(endDate === shiftDate(date, 1) && endMinute === 0)) throw new Error("Google event crosses the daily planning boundary");
    startTime = minuteLabel(localMinute(start));
    endTime = endDate === date ? minuteLabel(endMinute) : "24:00";
    if (startTime >= endTime) throw new Error("Google event local time range is invalid");
  }
  return calendarTaskSchema.parse({ title: event.summary, description: event.description ?? "", scheduledDate: date, startTime, endTime });
}
export function toGoogleEvent(task: CalendarTask, taskId: string) {
  if (!task.scheduledDate) throw new Error("An unscheduled task has no Google event");
  const date = task.scheduledDate;
  return {
    summary: task.title, description: task.description,
    start: task.startTime ? { dateTime: zonedDateTime(`${date}T${task.startTime}`), timeZone: OWNER_TIME_ZONE } : { date },
    end: task.endTime ? { dateTime: task.endTime === "24:00" ? zonedDateTime(`${shiftDate(date, 1)}T00:00`) : zonedDateTime(`${date}T${task.endTime}`), timeZone: OWNER_TIME_ZONE } : { date: shiftDate(date, 1) },
    extendedProperties: { private: { lifeosTaskId: taskId } },
  };
}
