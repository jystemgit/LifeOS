import { describe, expect, it } from "vitest";
import { filterTasks, managedTaskSchema, listSchema, nextOccurrence, quadrant, taskQuadrant, recurrenceSchema, taskCalendarMonth, type TaskSummary } from "./task-management";

const date = "2026-10-30";
describe("task month calendar", () => {
  it("uses whole Monday-first weeks across month and year boundaries", () => {
    const month = taskCalendarMonth("2026-01-31");
    expect(month.previous).toBe("2025-12-01");
    expect(month.next).toBe("2026-02-01");
    expect(month.days[0]).toBe("2025-12-29");
    expect(month.days.at(-1)).toBe("2026-02-01");
    expect(month.days).toHaveLength(35);
  });
  it("includes leap days, six-week months and rejects invalid dates", () => {
    expect(taskCalendarMonth("2024-02-10").days).toContain("2024-02-29");
    expect(taskCalendarMonth("2026-03-01").days).toHaveLength(42);
    expect(() => taskCalendarMonth("2026-02-30")).toThrow();
  });
  it("keeps navigation and cells within supported calendar-date boundaries", () => {
    const earliest = taskCalendarMonth("0001-01-01"), latest = taskCalendarMonth("9999-12-31");
    expect(earliest.previous).toBe("0001-01-01");
    expect(earliest.days[0]).toBe("0001-01-01");
    expect(latest.next).toBe("9999-12-01");
    expect(latest.days.at(-1)).toBe("9999-12-31");
  });
});
function task(update: Partial<TaskSummary> = {}): TaskSummary {
  return { ...managedTaskSchema.parse({ title: "Test" }), id: "task", version: 0, position: 0,
    listName: null, folderId: null, listArchived: false, createdAt: `${date}T12:00:00Z`, completedAt: null, deletedAt: null,
    assignments: [], steps: [], ...update };
}
describe("managed task validation", () => {
  it("supports title-only capture and rejects blank tasks", () => {
    expect(managedTaskSchema.parse({ title: "  Capture  " })).toMatchObject({ title: "Capture", important: false, urgent: false, status: "INBOX", tags: [] });
    expect(managedTaskSchema.safeParse({ title: " " }).success).toBe(false);
  });
  it("requires versions for edits and validates linked time windows", () => {
    expect(managedTaskSchema.safeParse({ id: "1", title: "Edit" }).success).toBe(false);
    for (const data of [{ startTime: "08:00" }, { startTime: "10:00", endTime: "09:00", scheduledDate: date },
      { startTime: "10:00", endTime: "11:00" }, { scheduledDate: "2026-02-30" }])
      expect(managedTaskSchema.safeParse({ title: "Invalid", ...data }).success).toBe(false);
    expect(managedTaskSchema.parse({ title: "Late", startTime: "23:00", endTime: "24:00", scheduledDate: date }).endTime).toBe("24:00");
  });
  it("validates organization data without accepting executable links", () => {
    expect(managedTaskSchema.safeParse({ title: "X", links: ["javascript:alert(1)"] }).success).toBe(false);
    expect(managedTaskSchema.parse({ title: "X", tags: [" a ", "a"] }).tags).toEqual(["a"]);
    expect(listSchema.safeParse({ name: "List", color: "red" }).success).toBe(false);
    expect(listSchema.parse({ name: "List" })).toMatchObject({ defaultView: "standard", defaultSort: "position", showCompleted: true });
  });
});
describe("strategic classification and shared views", () => {
  it("uses owner-local completion dates on both sides of midnight", () => {
    const beforeMidnight = task({ status: "COMPLETED", completedAt: "2026-10-23T02:59:59Z" });
    const afterMidnight = task({ status: "COMPLETED", completedAt: "2026-10-23T03:00:00Z" });
    expect(filterTasks([beforeMidnight, afterMidnight], { view: "recent" }, date)).toEqual([afterMidnight]);
    expect(filterTasks([task({ status: "COMPLETED", completedAt: "2026-10-31T03:00:00Z" })], { view: "recent" }, date)).toEqual([]);
  });
  it.each([
    [true, true, "DO"], [true, false, "SCHEDULE"], [false, true, "DELEGATE"], [false, false, "ELIMINATE"],
  ] as const)("classifies independent importance %s and urgency %s", (important, urgent, expected) => {
    expect(quadrant(task({ important, urgent, deadline: "2000-01-01", priority: "CRITICAL" }))).toBe(expected);
  });
  it("uses assignments, not duplicated task records, across My Day, planned and upcoming", () => {
    const tasks = [task({ assignments: [{ date, position: 0, titleSnapshot: "Snapshot", statusSnapshot: "TODO", completedAt: null },
      { date: "2026-11-02", position: 0, titleSnapshot: "Snapshot", statusSnapshot: "TODO", completedAt: null }] })];
    for (const view of ["today", "planned", "upcoming", "all"]) expect(filterTasks(tasks, { view }, date)).toEqual(tasks);
    expect(filterTasks(tasks, { view: "unscheduled" }, date)).toEqual([]);
    expect(tasks).toHaveLength(1);
  });
  it("combines text, entity, quadrant and boolean filters", () => {
    const a = task({ important: true, urgent: false, notes: "Research", tags: ["Deep"], listId: "l", listName: "Books", folderId: "f" });
    expect(filterTasks([a], { q: "books", quadrant: "SCHEDULE", important: "true", urgent: "false", folder: "f" }, date)).toEqual([a]);
    expect(filterTasks([a], { q: "DEEP" }, date)).toEqual([a]);
    expect(filterTasks([a], { urgent: "true" }, date)).toEqual([]);
  });
  it("distinguishes no classification from explicit Q4 and never derives urgency from dates", () => {
    const none = task({ eisenhowerClassified: false, deadline: "2000-01-01" });
    const q4 = task({ eisenhowerClassified: true });
    expect(taskQuadrant(none)).toBeNull();
    expect(taskQuadrant(q4)).toBe("ELIMINATE");
    expect(filterTasks([none, q4], { quadrant: "none" }, date)).toEqual([none]);
    expect(filterTasks([none, q4], { quadrant: "ELIMINATE" }, date)).toEqual([q4]);
  });
  it("keeps active and completed tasks in distinct simple views", () => {
    const active = task({ id: "active", status: "INBOX" });
    const completed = task({ id: "completed", status: "COMPLETED" });
    const cancelled = task({ id: "cancelled", status: "CANCELLED" });
    expect(filterTasks([active, completed, cancelled], { view: "active" }, date)).toEqual([active]);
    expect(filterTasks([active, completed, cancelled], { view: "completed" }, date)).toEqual([completed]);
  });
  it("excludes completed/cancelled from active smart views and keeps Trash isolated", () => {
    const done = task({ status: "COMPLETED", completedAt: `${date}T12:00:00Z`, deadline: "2020-01-01", important: true });
    for (const view of ["important", "matrix", "overdue", "planned", "upcoming"]) expect(filterTasks([done], { view }, date)).toEqual([]);
    expect(filterTasks([done], { view: "recent" }, date)).toEqual([done]);
    const deleted = task({ deletedAt: `${date}T12:00:00Z` });
    expect(filterTasks([deleted], { view: "all" }, date)).toEqual([]);
    expect(filterTasks([deleted], { view: "trash" }, date)).toEqual([deleted]);
  });
  it("distinguishes unscheduled from no deadline and today's due date from overdue", () => {
    const due = task({ deadline: date });
    expect(filterTasks([due], { view: "overdue" }, date)).toEqual([]);
    expect(filterTasks([due], { view: "unscheduled" }, date)).toEqual([due]);
    expect(filterTasks([due], { view: "noDue" }, date)).toEqual([]);
  });
});
describe("independent recurring occurrences", () => {
  const rule = (data: object) => recurrenceSchema.parse({ frequency: "DAILY", interval: 1, startDate: date, ...data });
  it("supports interval, start boundary and end boundary", () => {
    expect(nextOccurrence(rule({ interval: 3 }), date)).toBe("2026-11-02");
    expect(nextOccurrence(rule({}), "2026-10-01")).toBe(date);
    expect(nextOccurrence(rule({ endDate: date }), date)).toBeNull();
  });
  it("supports weekly weekdays and aligned multiweek intervals", () => {
    expect(nextOccurrence(rule({ frequency: "WEEKLY", weekdays: [1, 5], interval: 2 }), date)).toBe("2026-11-09");
    expect(nextOccurrence(rule({ weekdays: [1] }), date)).toBe("2026-11-02");
  });
  it("clamps month-end and leap-day without shifting the original anchor", () => {
    const monthly = rule({ frequency: "MONTHLY", startDate: "2026-01-31" });
    expect(nextOccurrence(monthly, "2026-01-31")).toBe("2026-02-28");
    expect(nextOccurrence(monthly, "2026-02-28")).toBe("2026-03-31");
    expect(nextOccurrence(rule({ frequency: "YEARLY", startDate: "2024-02-29" }), "2024-02-29")).toBe("2025-02-28");
  });
  it("rejects inverted ranges and invalid weekdays", () => {
    expect(() => rule({ endDate: "2020-01-01" })).toThrow();
    expect(() => rule({ weekdays: [0] })).toThrow();
  });
});
