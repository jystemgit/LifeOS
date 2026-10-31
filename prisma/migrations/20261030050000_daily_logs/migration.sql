-- CreateTable
CREATE TABLE "DailyLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "workHours" DECIMAL(5,2),
    "studyHours" DECIMAL(5,2),
    "trainingMinutes" INTEGER,
    "sleepHours" DECIMAL(4,2),
    "nutrition" TEXT NOT NULL DEFAULT '',
    "mood" INTEGER,
    "energy" INTEGER,
    "learning" TEXT NOT NULL DEFAULT '',
    "problems" TEXT NOT NULL DEFAULT '',
    "importantEvents" TEXT NOT NULL DEFAULT '',
    "reflection" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DailyLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyLogGoal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dailyLogId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyLogGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyLogTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dailyLogId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyLogTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyLog_userId_date_idx" ON "DailyLog"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyLog_userId_date_key" ON "DailyLog"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyLog_id_userId_key" ON "DailyLog"("id", "userId");

-- CreateIndex
CREATE INDEX "DailyLogGoal_goalId_userId_idx" ON "DailyLogGoal"("goalId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyLogGoal_dailyLogId_goalId_key" ON "DailyLogGoal"("dailyLogId", "goalId");

-- CreateIndex
CREATE INDEX "DailyLogTask_taskId_userId_idx" ON "DailyLogTask"("taskId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyLogTask_dailyLogId_taskId_key" ON "DailyLogTask"("dailyLogId", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "Goal_id_userId_key" ON "Goal"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Task_id_userId_key" ON "Task"("id", "userId");

-- AddCheckConstraint
ALTER TABLE "DailyLog" ADD CONSTRAINT "DailyLog_hours_valid_check"
CHECK (
    ("workHours" IS NULL OR "workHours" BETWEEN 0 AND 24)
    AND ("studyHours" IS NULL OR "studyHours" BETWEEN 0 AND 24)
    AND ("sleepHours" IS NULL OR "sleepHours" BETWEEN 0 AND 24)
);

-- AddCheckConstraint
ALTER TABLE "DailyLog" ADD CONSTRAINT "DailyLog_training_minutes_valid_check"
CHECK ("trainingMinutes" IS NULL OR "trainingMinutes" BETWEEN 0 AND 1440);

-- AddCheckConstraint
ALTER TABLE "DailyLog" ADD CONSTRAINT "DailyLog_ratings_valid_check"
CHECK (
    ("mood" IS NULL OR "mood" BETWEEN 1 AND 5)
    AND ("energy" IS NULL OR "energy" BETWEEN 1 AND 5)
);

-- AddForeignKey
ALTER TABLE "DailyLog" ADD CONSTRAINT "DailyLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLogGoal" ADD CONSTRAINT "DailyLogGoal_dailyLogId_userId_fkey" FOREIGN KEY ("dailyLogId", "userId") REFERENCES "DailyLog"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLogGoal" ADD CONSTRAINT "DailyLogGoal_goalId_userId_fkey" FOREIGN KEY ("goalId", "userId") REFERENCES "Goal"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLogTask" ADD CONSTRAINT "DailyLogTask_dailyLogId_userId_fkey" FOREIGN KEY ("dailyLogId", "userId") REFERENCES "DailyLog"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLogTask" ADD CONSTRAINT "DailyLogTask_taskId_userId_fkey" FOREIGN KEY ("taskId", "userId") REFERENCES "Task"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
