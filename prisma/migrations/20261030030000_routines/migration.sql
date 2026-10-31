-- CreateTable
CREATE TABLE "Routine" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lifeAreaId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "daysOfWeek" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6, 7]::INTEGER[],
    "startTime" TEXT,
    "endTime" TEXT,
    "priority" "GoalPriority" NOT NULL DEFAULT 'MEDIUM',
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Routine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutineActivity" (
    "id" TEXT NOT NULL,
    "routineId" TEXT NOT NULL,
    "habitId" TEXT,
    "taskId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "startTime" TEXT,
    "endTime" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RoutineActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutineLog" (
    "id" TEXT NOT NULL,
    "routineId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "expectedActivityCount" INTEGER NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RoutineLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutineActivityLog" (
    "id" TEXT NOT NULL,
    "routineId" TEXT NOT NULL,
    "routineLogId" TEXT NOT NULL,
    "routineActivityId" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RoutineActivityLog_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Routine" ALTER COLUMN "daysOfWeek" SET NOT NULL;

-- AddCheckConstraint
ALTER TABLE "Routine" ADD CONSTRAINT "Routine_daysOfWeek_valid_check"
CHECK (
    cardinality("daysOfWeek") BETWEEN 1 AND 7
    AND "daysOfWeek" <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::INTEGER[]
);

-- AddCheckConstraint
ALTER TABLE "Routine" ADD CONSTRAINT "Routine_times_valid_check"
CHECK (
    ("startTime" IS NULL OR "startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
    AND ("endTime" IS NULL OR "endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);

-- AddCheckConstraint
ALTER TABLE "RoutineActivity" ADD CONSTRAINT "RoutineActivity_position_valid_check"
CHECK ("position" >= 0);

-- AddCheckConstraint
ALTER TABLE "RoutineActivity" ADD CONSTRAINT "RoutineActivity_times_valid_check"
CHECK (
    ("startTime" IS NULL OR "startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
    AND ("endTime" IS NULL OR "endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);

-- AddCheckConstraint
ALTER TABLE "RoutineLog" ADD CONSTRAINT "RoutineLog_expectedActivityCount_positive_check"
CHECK ("expectedActivityCount" > 0);

-- AddCheckConstraint
ALTER TABLE "RoutineActivityLog" ADD CONSTRAINT "RoutineActivityLog_completion_consistent_check"
CHECK (
    ("completed" AND "completedAt" IS NOT NULL)
    OR (NOT "completed" AND "completedAt" IS NULL)
);

-- CreateIndex
CREATE INDEX "Routine_userId_archivedAt_idx" ON "Routine"("userId", "archivedAt");

-- CreateIndex
CREATE INDEX "Routine_lifeAreaId_idx" ON "Routine"("lifeAreaId");

-- CreateIndex
CREATE INDEX "RoutineActivity_habitId_idx" ON "RoutineActivity"("habitId");

-- CreateIndex
CREATE INDEX "RoutineActivity_taskId_idx" ON "RoutineActivity"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "RoutineActivity_routineId_position_key" ON "RoutineActivity"("routineId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "RoutineActivity_id_routineId_key" ON "RoutineActivity"("id", "routineId");

-- CreateIndex
CREATE INDEX "RoutineLog_routineId_date_idx" ON "RoutineLog"("routineId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "RoutineLog_routineId_date_key" ON "RoutineLog"("routineId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "RoutineLog_id_routineId_key" ON "RoutineLog"("id", "routineId");

-- CreateIndex
CREATE INDEX "RoutineActivityLog_routineActivityId_idx" ON "RoutineActivityLog"("routineActivityId");

-- CreateIndex
CREATE UNIQUE INDEX "RoutineActivityLog_routineLogId_routineActivityId_key" ON "RoutineActivityLog"("routineLogId", "routineActivityId");

-- AddForeignKey
ALTER TABLE "Routine" ADD CONSTRAINT "Routine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Routine" ADD CONSTRAINT "Routine_lifeAreaId_fkey" FOREIGN KEY ("lifeAreaId") REFERENCES "LifeArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineActivity" ADD CONSTRAINT "RoutineActivity_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "Routine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineActivity" ADD CONSTRAINT "RoutineActivity_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineActivity" ADD CONSTRAINT "RoutineActivity_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineLog" ADD CONSTRAINT "RoutineLog_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "Routine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineActivityLog" ADD CONSTRAINT "RoutineActivityLog_routineLogId_routineId_fkey" FOREIGN KEY ("routineLogId", "routineId") REFERENCES "RoutineLog"("id", "routineId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineActivityLog" ADD CONSTRAINT "RoutineActivityLog_routineActivityId_routineId_fkey" FOREIGN KEY ("routineActivityId", "routineId") REFERENCES "RoutineActivity"("id", "routineId") ON DELETE CASCADE ON UPDATE CASCADE;
