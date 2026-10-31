-- CreateTable
CREATE TABLE "PlanningPeriodGoal" (
    "id" TEXT NOT NULL,
    "planningPeriodId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanningPeriodGoal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanningPeriodGoal_goalId_idx" ON "PlanningPeriodGoal"("goalId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanningPeriodGoal_planningPeriodId_goalId_key" ON "PlanningPeriodGoal"("planningPeriodId", "goalId");

-- AddForeignKey
ALTER TABLE "PlanningPeriodGoal" ADD CONSTRAINT "PlanningPeriodGoal_planningPeriodId_fkey" FOREIGN KEY ("planningPeriodId") REFERENCES "PlanningPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningPeriodGoal" ADD CONSTRAINT "PlanningPeriodGoal_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
