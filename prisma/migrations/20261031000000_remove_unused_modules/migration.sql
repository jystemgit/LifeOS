BEGIN;

-- Keep shared goal milestones; delete only milestones owned exclusively by projects.
DELETE FROM "Milestone" WHERE "projectId" IS NOT NULL AND "goalId" IS NULL;
ALTER TABLE "Milestone" DROP CONSTRAINT "Milestone_projectId_fkey",
  DROP CONSTRAINT "Milestone_exactly_one_parent_check",
  DROP COLUMN "projectId",
  ADD CONSTRAINT "Milestone_goal_required_check" CHECK ("goalId" IS NOT NULL);
ALTER TABLE "Goal" DROP CONSTRAINT "Goal_lifeAreaId_fkey", DROP COLUMN "lifeAreaId";
ALTER TABLE "Task"
  DROP CONSTRAINT "Task_goalId_fkey",
  DROP CONSTRAINT "Task_habitId_userId_fkey",
  DROP CONSTRAINT "Task_lifeAreaId_fkey",
  DROP CONSTRAINT "Task_projectId_fkey",
  DROP COLUMN "goalId", DROP COLUMN "habitId", DROP COLUMN "lifeAreaId", DROP COLUMN "projectId",
  ADD COLUMN "eisenhowerClassified" BOOLEAN NOT NULL DEFAULT false;

-- Existing quadrant assignments remain visible; newly created tasks may be unclassified.
UPDATE "Task" SET "eisenhowerClassified" = true;
UPDATE "TaskActivityHistory"
SET "before" = CASE WHEN jsonb_typeof("before") = 'object'
      THEN "before" - ARRAY['goalId', 'habitId', 'lifeAreaId', 'projectId'] ELSE "before" END,
    "after" = CASE WHEN jsonb_typeof("after") = 'object'
      THEN "after" - ARRAY['goalId', 'habitId', 'lifeAreaId', 'projectId'] ELSE "after" END
WHERE jsonb_typeof("before") = 'object' OR jsonb_typeof("after") = 'object';
UPDATE "TaskSavedView"
SET "query" = replace(trim(both '&' from regexp_replace(
  regexp_replace("query", '(^|[?&])(area|project|goal)=[^&]*', '\1', 'g'), '&+', '&', 'g')), '?&', '?');
UPDATE "TaskSavedView"
SET "query" = regexp_replace("query", '(^|[?&])view=unlinked(&|$)', '\1view=all\2', 'g');

-- Drop the explicitly enumerated module graph together; never cascade into retained tables.
DROP TABLE "Contact", "Interaction",
  "Routine", "RoutineActivity", "RoutineLog", "RoutineActivityLog",
  "JournalEntry", "JournalTag", "JournalEntryTag", "JournalRevision",
  "PersonalEvent", "Habit", "HabitLog", "DailyLog", "DailyLogGoal", "DailyLogTask",
  "Project", "ProjectGoal", "LifeArea", "DailyActivity", "DailyPlanTemplate";
DROP FUNCTION preserve_daily_execution();
DELETE FROM "DailyPlan" WHERE "publishedHours" IS NULL;
ALTER TABLE "DailyPlan" DROP COLUMN "notes", DROP COLUMN "status", DROP COLUMN "version";
DROP TYPE "DailyActivityStatus", "DailyPlanStatus", "HabitTrackingType", "InteractionType",
  "PersonalEventCategory", "ProjectStatus", "RelationshipCategory", "RelationshipStatus";

COMMIT;
