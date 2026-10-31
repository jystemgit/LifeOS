import { describe, expect, it } from "vitest";
import { emptyHours, hourlyPlanSchema } from "./hourly-planning";

describe("hourly publication validation", () => {
  it("accepts an entirely blank plan and normalizes whitespace", () => {
    const hours = emptyHours();
    hours[9] = "  Study  ";
    hours[10] = "   ";
    expect(hourlyPlanSchema.parse({ date: "2026-10-30", hours }).hours.slice(9, 11)).toEqual(["Study", ""]);
    expect(hourlyPlanSchema.parse({ date: "2026-10-30", hours: emptyHours() }).hours).toHaveLength(24);
  });
  it("rejects malformed dates, nontext entries, missing hours and excessive text", () => {
    for (const raw of [
      { date: "2026-02-30", hours: emptyHours() },
      { date: "2026-10-30", hours: ["Only one"] },
      { date: "2026-10-30", hours: [...emptyHours(), "Extra"] },
      { date: "2026-10-30", hours: emptyHours().map(() => 12) },
      { date: "2026-10-30", hours: emptyHours().map(() => "x".repeat(2001)) },
    ]) expect(hourlyPlanSchema.safeParse(raw).success).toBe(false);
  });
});
