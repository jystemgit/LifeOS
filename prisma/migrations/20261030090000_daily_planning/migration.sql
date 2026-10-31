CREATE TYPE "DailyActivityStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');
CREATE TYPE "DailyPlanStatus" AS ENUM ('DRAFT', 'READY');

CREATE TABLE "DailyPlan" (
  "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "date" DATE NOT NULL,
  "status" "DailyPlanStatus" NOT NULL DEFAULT 'DRAFT', "notes" TEXT NOT NULL DEFAULT '',
  "version" INTEGER NOT NULL DEFAULT 0 CHECK ("version" >= 0),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE "DailyActivity" (
  "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "dailyPlanId" TEXT NOT NULL,
  "title" TEXT NOT NULL CHECK (length(trim("title")) BETWEEN 1 AND 200),
  "description" TEXT NOT NULL DEFAULT '', "startMinute" INTEGER NOT NULL,
  "endMinute" INTEGER NOT NULL, "category" TEXT NOT NULL DEFAULT 'Personal',
  "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM', "notes" TEXT NOT NULL DEFAULT '',
  "taskId" TEXT, "habitId" TEXT, "goalId" TEXT, "projectId" TEXT, "lifeAreaId" TEXT,
  "calendarEventId" TEXT,
  "status" "DailyActivityStatus" NOT NULL DEFAULT 'SCHEDULED',
  "actualStart" TIMESTAMPTZ(3), "actualEnd" TIMESTAMPTZ(3),
  "nonCompletionReason" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "DailyActivity_time_check" CHECK ("startMinute" >= 0 AND "startMinute" < "endMinute" AND "endMinute" <= 1440),
  CONSTRAINT "DailyActivity_actual_check" CHECK ("actualEnd" IS NULL OR ("actualStart" IS NOT NULL AND "actualEnd" >= "actualStart")),
  CONSTRAINT "DailyActivity_status_check" CHECK (
    ("status" = 'SCHEDULED' AND "actualStart" IS NULL AND "actualEnd" IS NULL) OR
    ("status" = 'IN_PROGRESS' AND "actualStart" IS NOT NULL AND "actualEnd" IS NULL) OR
    ("status" = 'COMPLETED' AND (("actualStart" IS NULL AND "actualEnd" IS NULL) OR ("actualStart" IS NOT NULL AND "actualEnd" IS NOT NULL))) OR
    ("status" = 'SKIPPED' AND length(trim("nonCompletionReason")) > 0)
  )
);
CREATE TABLE "DailyPlanTemplate" (
  "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "notes" TEXT NOT NULL DEFAULT '', "activities" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE UNIQUE INDEX "DailyPlan_userId_date_key" ON "DailyPlan"("userId", "date");
CREATE UNIQUE INDEX "DailyPlan_id_userId_key" ON "DailyPlan"("id", "userId");
CREATE INDEX "DailyActivity_dailyPlanId_startMinute_idx" ON "DailyActivity"("dailyPlanId", "startMinute");
CREATE INDEX "DailyActivity_taskId_userId_idx" ON "DailyActivity"("taskId", "userId");
CREATE INDEX "DailyActivity_habitId_userId_idx" ON "DailyActivity"("habitId", "userId");
CREATE INDEX "DailyActivity_goalId_userId_idx" ON "DailyActivity"("goalId", "userId");
CREATE INDEX "DailyActivity_projectId_userId_idx" ON "DailyActivity"("projectId", "userId");
CREATE INDEX "DailyActivity_calendarEventId_userId_idx" ON "DailyActivity"("calendarEventId", "userId");
CREATE UNIQUE INDEX "DailyPlanTemplate_userId_name_key" ON "DailyPlanTemplate"("userId", "name");
CREATE UNIQUE INDEX "Habit_id_userId_key" ON "Habit"("id", "userId");
CREATE UNIQUE INDEX "PersonalEvent_id_userId_key" ON "PersonalEvent"("id", "userId");
CREATE UNIQUE INDEX "Project_id_userId_key" ON "Project"("id", "userId");
ALTER TABLE "DailyPlan" ADD CONSTRAINT "DailyPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyActivity" ADD CONSTRAINT "DailyActivity_dailyPlanId_userId_fkey" FOREIGN KEY ("dailyPlanId", "userId") REFERENCES "DailyPlan"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyActivity" ADD CONSTRAINT "DailyActivity_taskId_userId_fkey" FOREIGN KEY ("taskId", "userId") REFERENCES "Task"("id", "userId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "DailyActivity" ADD CONSTRAINT "DailyActivity_habitId_userId_fkey" FOREIGN KEY ("habitId", "userId") REFERENCES "Habit"("id", "userId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "DailyActivity" ADD CONSTRAINT "DailyActivity_goalId_userId_fkey" FOREIGN KEY ("goalId", "userId") REFERENCES "Goal"("id", "userId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "DailyActivity" ADD CONSTRAINT "DailyActivity_projectId_userId_fkey" FOREIGN KEY ("projectId", "userId") REFERENCES "Project"("id", "userId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "DailyActivity" ADD CONSTRAINT "DailyActivity_lifeAreaId_fkey" FOREIGN KEY ("lifeAreaId") REFERENCES "LifeArea"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "DailyActivity" ADD CONSTRAINT "DailyActivity_calendarEventId_userId_fkey" FOREIGN KEY ("calendarEventId", "userId") REFERENCES "PersonalEvent"("id", "userId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "DailyPlanTemplate" ADD CONSTRAINT "DailyPlanTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "DailyActivity" ADD CONSTRAINT "DailyActivity_no_overlap"
  EXCLUDE USING gist ("dailyPlanId" WITH =, int4range("startMinute", "endMinute", '[)') WITH &&)
  DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION preserve_daily_execution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'SCHEDULED' OR OLD."actualStart" IS NOT NULL THEN
      RAISE EXCEPTION 'Executed daily activities cannot be deleted' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF (OLD."status" <> 'SCHEDULED' OR OLD."actualStart" IS NOT NULL) AND
    ROW(NEW."dailyPlanId", NEW."userId", NEW."title", NEW."description", NEW."startMinute", NEW."endMinute",
        NEW."category", NEW."priority", NEW."notes", NEW."taskId", NEW."habitId", NEW."goalId", NEW."projectId", NEW."lifeAreaId", NEW."calendarEventId")
    IS DISTINCT FROM
    ROW(OLD."dailyPlanId", OLD."userId", OLD."title", OLD."description", OLD."startMinute", OLD."endMinute",
        OLD."category", OLD."priority", OLD."notes", OLD."taskId", OLD."habitId", OLD."goalId", OLD."projectId", OLD."lifeAreaId", OLD."calendarEventId") THEN
    RAISE EXCEPTION 'Original executed schedule is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "DailyActivity_preserve_execution" BEFORE UPDATE OR DELETE ON "DailyActivity"
FOR EACH ROW EXECUTE FUNCTION preserve_daily_execution();
