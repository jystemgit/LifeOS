import { describe, expect, it } from "vitest";
import { fromGoogleEvent, toGoogleEvent, googleEventSchema } from "./google-calendar";

describe("Google task calendar mappings", () => {
  const task = { title: "Focus", description: "Notes", scheduledDate: "2026-10-30", startTime: null, endTime: null };
  it("uses exclusive all-day ends and preserves the same date", () => {
    const event = toGoogleEvent(task, "local");
    expect(event.end).toEqual({ date: "2026-10-31" });
    expect(fromGoogleEvent(googleEventSchema.parse({ id: "event", ...event }))).toEqual(task);
  });
  it("round-trips owner-local timed tasks and midnight endpoints", () => {
    for (const [startTime, endTime] of [["09:00", "10:00"], ["23:00", "24:00"]]) {
      const timed = { ...task, startTime, endTime };
      expect(fromGoogleEvent(googleEventSchema.parse({ id: "event", ...toGoogleEvent(timed, "local") }))).toEqual(timed);
    }
  });
  it("converts explicit offsets and named timezones to the owner day", () => {
    const event = googleEventSchema.parse({ id: "event", summary: "Focus",
      start: { dateTime: "2026-10-31T01:00:00+02:00" }, end: { dateTime: "2026-10-31T02:00:00+02:00" } });
    expect(fromGoogleEvent(event)).toMatchObject({ scheduledDate: "2026-10-30", startTime: "20:00", endTime: "21:00" });
    expect(fromGoogleEvent({ ...event, start: { dateTime: "2026-10-30T09:00:00", timeZone: "America/Argentina/Buenos_Aires" },
      end: { dateTime: "2026-10-30T10:00:00", timeZone: "America/Argentina/Buenos_Aires" } })).toMatchObject({ startTime: "09:00", endTime: "10:00" });
  });
  it("rejects lossy recurrence, multi-day, subminute, blank and oversized imports", () => {
    const event = googleEventSchema.parse({ id: "event", ...toGoogleEvent(task, "local") });
    for (const update of [{ recurrence: ["RRULE:FREQ=DAILY"] }, { recurringEventId: "series" },
      { end: { date: "2026-11-02" } }, { summary: "" }, { description: "x".repeat(2001) },
      { start: { dateTime: "2026-10-30T12:00:01Z" }, end: { dateTime: "2026-10-30T13:00:00Z" } },
      { start: { dateTime: "2026-10-30T12:00:01", timeZone: "UTC" }, end: { dateTime: "2026-10-30T13:00:00", timeZone: "UTC" } },
      { start: { dateTime: "2026-02-30T12:00:00Z" }, end: { dateTime: "2026-03-02T13:00:00Z" } }])
      expect(() => fromGoogleEvent({ ...event, ...update })).toThrow();
  });
});
