-- Preserve the existing schedule as an initial adoption snapshot, without cloning tasks.
INSERT INTO "TaskDailyAssignment"
  ("id", "userId", "taskId", "date", "position", "titleSnapshot", "statusSnapshot", "completedAt")
SELECT 'legacy:' || md5(t."id" || ':' || t."scheduledDate"::text),
  t."userId", t."id", t."scheduledDate", t."position", t."title", t."status", t."completedAt"
FROM "Task" t
WHERE t."scheduledDate" IS NOT NULL AND t."parentTaskId" IS NULL AND t."deletedAt" IS NULL
ON CONFLICT ("taskId", "date") DO NOTHING;

INSERT INTO "TaskDailyAssignment"
  ("id", "userId", "taskId", "date", "titleSnapshot", "statusSnapshot", "completedAt")
SELECT DISTINCT ON (t."id", p."date")
  'plan:' || md5(t."id" || ':' || p."date"::text), t."userId", t."id",
  p."date", t."title", t."status", t."completedAt"
FROM "DailyActivity" a
JOIN "DailyPlan" p ON p."id" = a."dailyPlanId"
JOIN "Task" t ON t."id" = a."taskId" AND t."userId" = a."userId"
WHERE t."parentTaskId" IS NULL AND t."deletedAt" IS NULL
ORDER BY t."id", p."date", a."createdAt"
ON CONFLICT ("taskId", "date") DO NOTHING;

CREATE FUNCTION protect_task_daily_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."date" < (CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
    AND EXISTS (SELECT 1 FROM "user" WHERE "id" = OLD."userId") THEN
    RAISE EXCEPTION 'Historical task daily selections are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "TaskDailyAssignment_protect_history"
BEFORE UPDATE OR DELETE ON "TaskDailyAssignment"
FOR EACH ROW EXECUTE FUNCTION protect_task_daily_history();
