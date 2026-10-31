import { describe, expect, it } from "vitest";
import { calendarDateSchema, localMinute, minuteLabel, shiftDate, timeMinute, zonedDateTime } from "./daily-planning";

describe("shared owner date/time helpers", () => {
  it("validates real dates and shifts calendar dates without host timezone dependence", () => {
    expect(calendarDateSchema.safeParse("2028-02-29").success).toBe(true);
    expect(calendarDateSchema.safeParse("2026-02-29").success).toBe(false);
    expect(shiftDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("converts owner-local reminder times and midnight boundaries", () => {
    expect(zonedDateTime("2026-10-30T00:00")).toBe("2026-10-30T03:00:00.000Z");
    expect(localMinute(new Date("2026-10-31T02:59:00Z"))).toBe(1439);
    expect(localMinute(new Date("2026-10-31T03:00:00Z"))).toBe(0);
    expect(zonedDateTime("")).toBeNull();
    expect(() => zonedDateTime("2026-02-30T10:00")).toThrow();
    expect(() => timeMinute("25:00")).toThrow();
    expect(minuteLabel(timeMinute("24:00"))).toBe("24:00");
  });
});
