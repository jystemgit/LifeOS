import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.TASK_MANAGEMENT_TEST_DATABASE_URL;
const removalMigration = "20261031000000_remove_unused_modules";
const removedTables = [
  "Contact", "Interaction", "Routine", "RoutineActivity", "RoutineLog", "RoutineActivityLog",
  "JournalEntry", "JournalTag", "JournalEntryTag", "JournalRevision", "PersonalEvent",
  "Habit", "HabitLog", "DailyLog", "DailyLogGoal", "DailyLogTask", "Project", "ProjectGoal",
  "LifeArea", "DailyActivity", "DailyPlanTemplate",
];

describe.skipIf(!databaseUrl)("controlled module-removal migration", () => {
  it("deletes only authorized structures/data, rolls back failures and preserves shared records", async () => {
    const admin = new Client({ connectionString: databaseUrl! });
    const database = `lifeos_removal_${randomUUID().replaceAll("-", "")}`;
    const url = new URL(databaseUrl!); url.pathname = `/${database}`;
    let db: Client | undefined, created = false;
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE "${database}"`); created = true;
      db = new Client({ connectionString: url.href }); await db.connect();
      const directory = join(process.cwd(), "prisma/migrations");
      for (const migration of (await readdir(directory)).filter((name) => /^\d/.test(name)).sort()) {
        if (migration >= removalMigration) break;
        await db.query(await readFile(join(directory, migration, "migration.sql"), "utf8"));
      }
      const insert = async (table: string, values: Record<string, unknown>) => {
        const columns = (await db!.query<{ column_name: string }>(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [table],
        )).rows.map((row) => row.column_name);
        const data = { ...values, ...(columns.includes("updatedAt") ? { updatedAt: new Date("2026-10-30T00:00:00Z") } : {}) };
        const keys = Object.keys(data);
        await db!.query(`INSERT INTO "${table}" (${keys.map((key) => `"${key}"`).join(",")}) VALUES (${keys.map((_, index) => `$${index + 1}`).join(",")})`,
          Object.values(data));
      };
      await insert("user", { id: "owner", name: "Migration fixture", email: "removal@example.invalid", twoFactorEnabled: true });
      await insert("account", { id: "credential", userId: "owner", accountId: "owner", providerId: "credential", password: "retained-hash" });
      await insert("session", { id: "session", userId: "owner", token: "retained-session", expiresAt: new Date("2030-01-01") });
      await insert("twoFactor", { id: "2fa", userId: "owner", secret: "encrypted-fixture", backupCodes: "encrypted-codes" });
      await insert("LifeArea", { id: "area", slug: "removed", name: "Removed", description: "", sortOrder: 0 });
      await insert("Goal", { id: "goal", userId: "owner", lifeAreaId: "area", type: "OUTCOME", name: "Retained goal" });
      await insert("PlanningPeriod", { id: "period", userId: "owner", type: "ANNUAL", name: "Retained period", startDate: "2026-01-01", endDate: "2026-12-31" });
      await insert("PlanningPeriodGoal", { id: "period-goal", planningPeriodId: "period", goalId: "goal" });
      await insert("Project", { id: "project", userId: "owner", lifeAreaId: "area", name: "Removed project", category: "Personal" });
      await insert("ProjectGoal", { id: "project-goal", projectId: "project", goalId: "goal" });
      await insert("Milestone", { id: "goal-milestone", goalId: "goal", name: "Keep shared milestone" });
      await insert("Milestone", { id: "project-milestone", projectId: "project", name: "Remove project milestone" });
      await insert("Habit", { id: "habit", userId: "owner", goalId: "goal", lifeAreaId: "area", name: "Removed habit" });
      await insert("HabitLog", { id: "habit-log", habitId: "habit", date: "2026-10-30" });
      await insert("TaskList", { id: "list", userId: "owner", name: "Retained list" });
      await insert("Task", { id: "task", userId: "owner", title: "Keep task", goalId: "goal", projectId: "project", habitId: "habit", lifeAreaId: "area", listId: "list" });
      await insert("Task", { id: "step", userId: "owner", parentTaskId: "task", title: "Keep subtask" });
      await insert("TaskActivityHistory", { id: "history", taskId: "task", userId: "owner", type: "MODIFIED",
        before: JSON.stringify({ projectId: "project", notes: "Keep notes" }), after: JSON.stringify({ goalId: "goal", title: "Keep task" }) });
      await insert("TaskActivityHistory", { id: "scalar-history", taskId: "task", userId: "owner", type: "FIXTURE",
        before: JSON.stringify("Keep scalar"), after: JSON.stringify({ habitId: "habit", status: "TODO" }) });
      await insert("TaskSavedView", { id: "view", userId: "owner", name: "Retain view", query: "?view=unlinked&area=area&project=project&goal=goal&q=keep&status=TODO" });
      await insert("TaskSavedView", { id: "view-first", userId: "owner", name: "First obsolete filter", query: "?area=area&project=project&goal=goal&q=keep" });
      await insert("TaskAttachment", { id: "file", taskId: "task", userId: "owner", name: "Keep.bin", mimeType: "application/octet-stream", size: 3, content: Buffer.from([0, 128, 255]) });
      await insert("TaskDailyAssignment", { id: "assignment", taskId: "task", userId: "owner", date: "2026-10-29", titleSnapshot: "Keep task", statusSnapshot: "TODO" });
      const hours = Array.from({ length: 24 }, (_, hour) => hour === 9 ? "Keep publication" : "");
      await insert("DailyPlan", { id: "published", userId: "owner", date: "2026-10-30", publishedHours: JSON.stringify(hours) });
      await insert("DailyPlan", { id: "legacy", userId: "owner", date: "2026-10-29" });
      await insert("DailyActivity", { id: "activity", userId: "owner", dailyPlanId: "legacy", title: "Remove executed block", startMinute: 60, endMinute: 120,
        taskId: "task", habitId: "habit", goalId: "goal", projectId: "project", lifeAreaId: "area", status: "COMPLETED" });
      await insert("DailyPlanTemplate", { id: "template", userId: "owner", name: "Remove template", activities: "[]" });
      await insert("DailyLog", { id: "log", userId: "owner", date: "2026-10-30" });
      await insert("DailyLogTask", { id: "log-task", dailyLogId: "log", userId: "owner", taskId: "task" });
      await insert("DailyLogGoal", { id: "log-goal", dailyLogId: "log", userId: "owner", goalId: "goal" });
      await insert("JournalEntry", { id: "entry", userId: "owner", entryDate: "2026-10-30", title: "Removed", content: "Removed" });
      await insert("JournalTag", { id: "tag", userId: "owner", name: "Removed", normalizedName: "removed" });
      await insert("JournalEntryTag", { id: "entry-tag", userId: "owner", entryId: "entry", tagId: "tag" });
      await insert("JournalRevision", { id: "revision", userId: "owner", entryId: "entry", version: 0, entryDate: "2026-10-30", title: "Removed", content: "Removed", category: "General" });
      await insert("PersonalEvent", { id: "event", userId: "owner", eventDate: "2026-10-30", category: "PERSONAL", title: "Removed", lifeAreaId: "area" });
      await insert("Contact", { id: "contact", userId: "owner", fullName: "Removed", category: "FRIEND" });
      await insert("Interaction", { id: "interaction", userId: "owner", contactId: "contact", occurredAt: new Date(), type: "CALL", description: "Removed" });
      await insert("Routine", { id: "routine", userId: "owner", name: "Removed", lifeAreaId: "area" });
      await insert("RoutineActivity", { id: "routine-activity", routineId: "routine", habitId: "habit", taskId: "task", name: "Removed" });
      await insert("RoutineLog", { id: "routine-log", routineId: "routine", date: "2026-10-30", expectedActivityCount: 1 });
      await insert("RoutineActivityLog", { id: "routine-activity-log", routineId: "routine", routineLogId: "routine-log", routineActivityId: "routine-activity" });
      const retained = ["user", "account", "session", "twoFactor", "TaskList", "TaskAttachment", "TaskDailyAssignment", "PlanningPeriod", "PlanningPeriodGoal"];
      const snapshots = new Map<string, unknown>();
      for (const table of retained) snapshots.set(table, (await db.query(`SELECT * FROM "${table}" ORDER BY id`)).rows);
      const taskBefore = (await db.query(`SELECT to_jsonb(t) - ARRAY['goalId','habitId','lifeAreaId','projectId'] AS value FROM "Task" t ORDER BY id`)).rows;
      const planBefore = (await db.query(`SELECT to_jsonb(t) - ARRAY['status','notes','version'] AS value FROM "DailyPlan" t WHERE id='published'`)).rows;
      const migration = await readFile(join(directory, removalMigration, "migration.sql"), "utf8");
      await db.query(`CREATE FUNCTION removal_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected removal failure'; END; $$;
        CREATE TRIGGER removal_fault BEFORE DELETE ON "Milestone" FOR EACH ROW EXECUTE FUNCTION removal_fault();`);
      await expect(db.query(migration)).rejects.toThrow("Injected removal failure");
      await db.query("ROLLBACK");
      expect((await db.query(`SELECT count(*)::int AS count FROM "Project"`)).rows[0].count).toBe(1);
      expect((await db.query(`SELECT count(*)::int AS count FROM "Milestone"`)).rows[0].count).toBe(2);
      await db.query(`DROP TRIGGER removal_fault ON "Milestone"; DROP FUNCTION removal_fault();`);
      await db.query(migration);
      for (const table of removedTables) expect((await db.query("SELECT to_regclass($1) AS table", [`public."${table}"`])).rows[0].table).toBeNull();
      for (const table of retained) expect((await db.query(`SELECT * FROM "${table}" ORDER BY id`)).rows, table).toEqual(snapshots.get(table));
      expect((await db.query(`SELECT to_jsonb(t) - 'eisenhowerClassified' AS value FROM "Task" t ORDER BY id`)).rows).toEqual(taskBefore);
      expect((await db.query(`SELECT to_jsonb(t) AS value FROM "DailyPlan" t`)).rows).toEqual(planBefore);
      expect((await db.query(`SELECT id FROM "Milestone"`)).rows).toEqual([{ id: "goal-milestone" }]);
      expect((await db.query(`SELECT "query" FROM "TaskSavedView" WHERE id='view'`)).rows[0].query).toBe("?view=all&q=keep&status=TODO");
      expect((await db.query(`SELECT "query" FROM "TaskSavedView" WHERE id='view-first'`)).rows[0].query).toBe("?q=keep");
      expect((await db.query(`SELECT to_regprocedure('preserve_daily_execution()') AS function`)).rows[0].function).toBeNull();
      expect((await db.query(`SELECT typname FROM pg_type WHERE typname = ANY($1)`, [[
        "DailyActivityStatus", "DailyPlanStatus", "HabitTrackingType", "InteractionType",
        "PersonalEventCategory", "ProjectStatus", "RelationshipCategory", "RelationshipStatus",
      ]])).rows).toEqual([]);
      expect((await db.query(`SELECT "before","after" FROM "TaskActivityHistory" WHERE id='history'`)).rows[0]).toEqual({
        before: { notes: "Keep notes" }, after: { title: "Keep task" },
      });
      expect((await db.query(`SELECT "before","after" FROM "TaskActivityHistory" WHERE id='scalar-history'`)).rows[0]).toEqual({
        before: "Keep scalar", after: { status: "TODO" },
      });
      expect((await db.query(`SELECT count(*)::int AS count FROM pg_constraint WHERE contype='f' AND NOT convalidated`)).rows[0].count).toBe(0);
      await db.query(await readFile(join(directory, "20261031010000_remove_goals_and_periods", "migration.sql"), "utf8"));
      for (const table of ["Goal", "GoalRelationship", "Milestone", "PlanningPeriod", "PlanningPeriodGoal"]) {
        expect((await db.query("SELECT to_regclass($1) AS table", [`public."${table}"`])).rows[0].table).toBeNull();
      }
      for (const table of retained.filter((name) => !["PlanningPeriod", "PlanningPeriodGoal"].includes(name))) {
        expect((await db.query(`SELECT * FROM "${table}" ORDER BY id`)).rows, table).toEqual(snapshots.get(table));
      }
      expect((await db.query(`SELECT to_jsonb(t) - 'eisenhowerClassified' AS value FROM "Task" t ORDER BY id`)).rows).toEqual(taskBefore);
      expect((await db.query(`SELECT to_jsonb(t) AS value FROM "DailyPlan" t`)).rows).toEqual(planBefore);
      expect((await db.query(`SELECT typname FROM pg_type WHERE typname = ANY($1)`, [[
        "GoalType", "GoalStatus", "GoalPriority", "GoalRelationshipType", "PlanningPeriodType",
      ]])).rows).toEqual([]);
    } finally {
      await db?.end();
      if (created) await admin.query(`DROP DATABASE "${database}"`);
      await admin.end();
    }
  }, 60000);
});
