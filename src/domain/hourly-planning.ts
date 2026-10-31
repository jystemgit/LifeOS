import { z } from "zod";
import { calendarDateSchema } from "./daily-planning";

export const hourlyEntriesSchema = z.array(z.string().trim().max(2000)).length(24);
export const hourlyPlanSchema = z.object({
  date: calendarDateSchema,
  hours: hourlyEntriesSchema,
});
export type HourlyPlan = z.infer<typeof hourlyPlanSchema>;
export type HourlyPlanResult = { plan: HourlyPlan; error?: never } | { error: string; plan?: never };

export function emptyHours(): string[] {
  return Array.from({ length: 24 }, () => "");
}

export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}
