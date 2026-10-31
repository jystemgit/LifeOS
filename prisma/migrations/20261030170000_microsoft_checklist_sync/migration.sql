CREATE TABLE "MicrosoftChecklistMapping" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "parentTaskId" TEXT NOT NULL,
  "stepId" TEXT NOT NULL,
  "externalTaskId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "baseline" JSONB NOT NULL,
  CONSTRAINT "MicrosoftChecklistMapping_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MicrosoftChecklistMapping_stepId_key" ON "MicrosoftChecklistMapping"("stepId");
CREATE UNIQUE INDEX "MicrosoftChecklistMapping_stepId_userId_key" ON "MicrosoftChecklistMapping"("stepId", "userId");
CREATE UNIQUE INDEX "MicrosoftChecklistMapping_parentTaskId_externalId_key" ON "MicrosoftChecklistMapping"("parentTaskId", "externalId");
ALTER TABLE "MicrosoftChecklistMapping" ADD CONSTRAINT "MicrosoftChecklistMapping_parentTaskId_userId_fkey"
  FOREIGN KEY ("parentTaskId", "userId") REFERENCES "TaskSynchronizationRecord"("taskId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MicrosoftChecklistMapping" ADD CONSTRAINT "MicrosoftChecklistMapping_stepId_userId_fkey"
  FOREIGN KEY ("stepId", "userId") REFERENCES "Task"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
