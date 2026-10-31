-- CreateEnum
CREATE TYPE "HabitTrackingType" AS ENUM ('CHECK', 'QUANTITY', 'DURATION');

-- CreateTable
CREATE TABLE "Habit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lifeAreaId" TEXT,
    "goalId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "trackingType" "HabitTrackingType" NOT NULL DEFAULT 'CHECK',
    "targetValue" DECIMAL(14,3),
    "unit" TEXT,
    "daysOfWeek" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6, 7]::INTEGER[],
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Habit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HabitLog" (
    "id" TEXT NOT NULL,
    "habitId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "measuredValue" DECIMAL(14,3),
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "HabitLog_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Habit" ALTER COLUMN "daysOfWeek" SET NOT NULL;

-- AddCheckConstraint
ALTER TABLE "Habit" ADD CONSTRAINT "Habit_daysOfWeek_valid_check"
CHECK (
    cardinality("daysOfWeek") BETWEEN 1 AND 7
    AND "daysOfWeek" <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::INTEGER[]
);

-- AddCheckConstraint
ALTER TABLE "Habit" ADD CONSTRAINT "Habit_tracking_configuration_check"
CHECK (
    (
        "trackingType" = 'CHECK'
        AND "targetValue" IS NULL
        AND "unit" IS NULL
    )
    OR (
        "trackingType" IN ('QUANTITY', 'DURATION')
        AND "targetValue" > 0
        AND "unit" IS NOT NULL
        AND btrim("unit") <> ''
    )
);

-- AddCheckConstraint
ALTER TABLE "HabitLog" ADD CONSTRAINT "HabitLog_measuredValue_nonnegative_check"
CHECK ("measuredValue" IS NULL OR "measuredValue" >= 0);

-- CreateIndex
CREATE INDEX "Habit_userId_archivedAt_idx" ON "Habit"("userId", "archivedAt");

-- CreateIndex
CREATE INDEX "Habit_lifeAreaId_idx" ON "Habit"("lifeAreaId");

-- CreateIndex
CREATE INDEX "Habit_goalId_idx" ON "Habit"("goalId");

-- CreateIndex
CREATE INDEX "HabitLog_habitId_date_idx" ON "HabitLog"("habitId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "HabitLog_habitId_date_key" ON "HabitLog"("habitId", "date");

-- AddForeignKey
ALTER TABLE "Habit" ADD CONSTRAINT "Habit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Habit" ADD CONSTRAINT "Habit_lifeAreaId_fkey" FOREIGN KEY ("lifeAreaId") REFERENCES "LifeArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Habit" ADD CONSTRAINT "Habit_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HabitLog" ADD CONSTRAINT "HabitLog_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
