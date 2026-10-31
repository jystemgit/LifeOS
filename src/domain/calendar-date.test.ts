import { describe, expect, it } from "vitest";
import { getCalendarDate, getISOWeekday } from "./calendar-date";

describe("calendar date helpers", () => {
  it("uses the requested time zone to determine the calendar day", () => {
    const instant = new Date("2026-10-30T02:00:00.000Z");
    expect(getCalendarDate("America/Argentina/Buenos_Aires", instant)).toBe(
      "2026-10-29",
    );
    expect(getCalendarDate("UTC", instant)).toBe("2026-10-30");
  });

  it("maps ISO weekdays from Monday 1 through Sunday 7", () => {
    expect(getISOWeekday("2026-10-26")).toBe(1);
    expect(getISOWeekday("2026-11-01")).toBe(7);
    expect(() => getISOWeekday("2026-02-29")).toThrow();
  });
});
