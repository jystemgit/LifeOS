ALTER TABLE "Task" ADD COLUMN "archivedAt" TIMESTAMPTZ(3);
ALTER TABLE "Task" ADD COLUMN "reminderAcknowledgedAt" TIMESTAMPTZ(3);
CREATE INDEX "Task_userId_archivedAt_idx" ON "Task"("userId", "archivedAt");
