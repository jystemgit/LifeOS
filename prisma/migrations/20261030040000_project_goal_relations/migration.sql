CREATE TABLE "ProjectGoal" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectGoal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectGoal_projectId_goalId_key"
ON "ProjectGoal"("projectId", "goalId");

CREATE INDEX "ProjectGoal_goalId_idx" ON "ProjectGoal"("goalId");

ALTER TABLE "ProjectGoal"
ADD CONSTRAINT "ProjectGoal_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectGoal"
ADD CONSTRAINT "ProjectGoal_goalId_fkey"
FOREIGN KEY ("goalId") REFERENCES "Goal"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
