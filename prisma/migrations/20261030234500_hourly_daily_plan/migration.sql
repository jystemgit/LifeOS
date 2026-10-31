ALTER TABLE "DailyPlan" ADD COLUMN "publishedHours" JSONB;

ALTER TABLE "DailyPlan" ADD CONSTRAINT "DailyPlan_publishedHours_check" CHECK (
  "publishedHours" IS NULL OR (
    jsonb_typeof("publishedHours") = 'array'
    AND jsonb_array_length("publishedHours") = 24
    AND NOT jsonb_path_exists("publishedHours", '$[*] ? (@.type() != "string")')
  )
);

CREATE OR REPLACE FUNCTION preserve_daily_execution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Explicit hourly publication replaces the retired schedule for this date.
    IF EXISTS (
      SELECT 1 FROM "DailyPlan"
      WHERE "id" = OLD."dailyPlanId" AND "userId" = OLD."userId" AND "publishedHours" IS NOT NULL
    ) THEN
      RETURN OLD;
    END IF;
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
