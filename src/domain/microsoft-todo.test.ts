import { describe, expect, it } from "vitest";
import { fromGraphTask, toGraphTask, graphInstant, graphRecurrence, fromGraphRecurrence, syncDecision, graphTaskLink, graphTaskSource, graphTaskSchema } from "./microsoft-todo";
import { recurrenceSchema } from "./task-management";

describe("Microsoft Graph task field mapping", () => {
  it("round-trips supported fields without touching LIFE OS strategic fields", () => {
    const task = { title: "Read", description: "Notes", status: "COMPLETED", important: true, deadline: "2026-11-01", reminderAt: "2026-11-01T12:30:00.000Z" };
    const graph = toGraphTask(task);
    expect(fromGraphTask({ id: "graph-task", ...graph })).toEqual(task);
    expect(graph).not.toHaveProperty("urgent");
    expect(graph).not.toHaveProperty("priority");
    expect(graph).not.toHaveProperty("goalId");
  });
  it("does not import HTML as plain text", () => {
    expect(() => fromGraphTask({ id: "x", title: "HTML", body: { contentType: "html", content: "<p>Body</p>" } })).toThrow("HTML");
  });
  it("converts supported Microsoft and IANA timezones and rejects unknown zones", () => {
    expect(graphInstant({ dateTime: "2026-11-01T09:30:00", timeZone: "Argentina Standard Time" })).toBe("2026-11-01T12:30:00.000Z");
    expect(graphInstant({ dateTime: "2026-11-01T12:30:00.0000000", timeZone: "UTC" })).toBe("2026-11-01T12:30:00.000Z");
    expect(() => graphInstant({ dateTime: "2026-11-01T09:30:00", timeZone: "Invalid Zone" })).toThrow();
  });
  it.each(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"])("maps the supported %s recurrence shape", (frequency) => {
    const rule = recurrenceSchema.parse({ frequency, interval: 2, startDate: "2026-11-02", endDate: "2027-11-02", weekdays: frequency === "WEEKLY" ? [1, 3] : [] });
    expect(fromGraphRecurrence(graphRecurrence(rule))).toEqual(rule);
  });
  it("rejects recurrence patterns with no exact local equivalent", () => {
    expect(() => graphRecurrence(recurrenceSchema.parse({ frequency: "DAILY", interval: 1, startDate: "2026-11-02", weekdays: [1] }))).toThrow("local-only");
    expect(() => fromGraphRecurrence({ pattern: { type: "relativeMonthly", interval: 1 }, range: { type: "noEnd", startDate: "2026-11-02" } })).toThrow();
  });
  it("rejects mismatched recurrence anchors rather than changing the provider rule", () => {
    expect(() => fromGraphRecurrence({ pattern: { type: "absoluteMonthly", interval: 1, dayOfMonth: 15 }, range: { type: "noEnd", startDate: "2026-11-02" } })).toThrow("anchor");
    expect(() => fromGraphRecurrence({ pattern: { type: "absoluteYearly", interval: 1, dayOfMonth: 2, month: 12 }, range: { type: "noEnd", startDate: "2026-11-02" } })).toThrow("anchor");
    expect(() => fromGraphRecurrence({ pattern: { type: "weekly", interval: 2, daysOfWeek: ["monday"] }, range: { type: "noEnd", startDate: "2026-11-02" } })).toThrow("boundary");
    expect(fromGraphRecurrence({ pattern: { type: "weekly", interval: 1, daysOfWeek: ["monday"], firstDayOfWeek: "sunday" }, range: { type: "noEnd", startDate: "2026-11-02" } })).toMatchObject({ frequency: "WEEKLY", weekdays: [1] });
  });
  it("identifies moved tasks by their stable source, not changing Graph IDs", () => {
    const link = graphTaskLink("local-task", "https://lifeos.example");
    expect(link.webUrl).toBe("https://lifeos.example/tasks?task=local-task");
    expect(graphTaskSource(graphTaskSchema.parse({ id: "moved-task", linkedResources: [link] }))).toBe("local-task");
    expect(() => graphTaskSource(graphTaskSchema.parse({ id: "ambiguous", linkedResources: [link, graphTaskLink("other", "https://lifeos.example")] }))).toThrow("Ambiguous");
  });
});
describe("three-way synchronization decisions", () => {
  const base = { title: "Original", important: false, deleted: false };
  it("distinguishes unchanged, local-only, remote-only and concurrent edits", () => {
    expect(syncDecision(base, base, base)).toBe("same");
    expect(syncDecision(base, { ...base, title: "Local" }, base)).toBe("push");
    expect(syncDecision(base, base, { ...base, title: "Remote" })).toBe("pull");
    expect(syncDecision(base, { ...base, title: "Local" }, { ...base, title: "Remote" })).toBe("conflict");
  });
  it("does not silently overwrite edits when the remote task is deleted", () => {
    expect(syncDecision(base, { ...base, title: "Edited" }, { ...base, deleted: true })).toBe("conflict");
    expect(syncDecision(base, base, { ...base, deleted: true })).toBe("pull");
  });
  it("compares JSON values independently of database object key order", () => {
    expect(syncDecision(base, base, { deleted: false, important: false, title: "Original" })).toBe("same");
  });
});
