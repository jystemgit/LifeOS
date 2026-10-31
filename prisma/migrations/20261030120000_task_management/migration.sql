-- AlterTable
-- Existing tasks and their IDs remain intact; new organization is optional.
ALTER TABLE "Task" ADD COLUMN     "category" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "customFields" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "endTime" TEXT,
ADD COLUMN     "habitId" TEXT,
ADD COLUMN     "important" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "links" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "listId" TEXT,
ADD COLUMN     "notes" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "occurrenceDate" DATE,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "recurrence" JSONB,
ADD COLUMN     "recurrenceSourceId" TEXT,
ADD COLUMN     "reminderAt" TIMESTAMPTZ(3),
ADD COLUMN     "startTime" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "urgent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Task" ADD CONSTRAINT "Task_time_window_check" CHECK (
  ("startTime" IS NULL AND "endTime" IS NULL) OR
  ("startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND ("endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR "endTime" = '24:00')
    AND "startTime" < "endTime")
);

-- CreateTable
CREATE TABLE "TaskFolder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TaskFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskList" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "folderId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "icon" TEXT NOT NULL DEFAULT 'list',
    "color" TEXT NOT NULL DEFAULT 'neutral',
    "position" INTEGER NOT NULL DEFAULT 0,
    "defaultSort" TEXT NOT NULL DEFAULT 'position',
    "defaultView" TEXT NOT NULL DEFAULT 'standard',
    "showCompleted" BOOLEAN NOT NULL DEFAULT true,
    "showDetails" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TaskList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskDailyAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "titleSnapshot" TEXT NOT NULL,
    "statusSnapshot" "TaskStatus" NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskDailyAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskActivityHistory" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskActivityHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAttachment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskAttachment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_size_check"
  CHECK ("size" > 0 AND "size" <= 5242880 AND octet_length("content") = "size");

-- CreateTable
CREATE TABLE "TaskSavedView" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,

    CONSTRAINT "TaskSavedView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MicrosoftConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "lastSyncAt" TIMESTAMPTZ(3),
    "error" TEXT,
    "lockedUntil" TIMESTAMPTZ(3),

    CONSTRAINT "MicrosoftConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskListSynchronizationRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "baseline" JSONB NOT NULL,
    "deltaLink" TEXT,
    "conflict" JSONB,

    CONSTRAINT "TaskListSynchronizationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskSynchronizationRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalListId" TEXT NOT NULL,
    "baseline" JSONB NOT NULL,
    "conflict" JSONB,

    CONSTRAINT "TaskSynchronizationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskFolder_userId_position_idx" ON "TaskFolder"("userId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "TaskFolder_id_userId_key" ON "TaskFolder"("id", "userId");

-- CreateIndex
CREATE INDEX "TaskList_userId_position_idx" ON "TaskList"("userId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "TaskList_id_userId_key" ON "TaskList"("id", "userId");

-- CreateIndex
CREATE INDEX "TaskDailyAssignment_userId_date_position_idx" ON "TaskDailyAssignment"("userId", "date", "position");

-- CreateIndex
CREATE UNIQUE INDEX "TaskDailyAssignment_taskId_date_key" ON "TaskDailyAssignment"("taskId", "date");

-- CreateIndex
CREATE INDEX "TaskActivityHistory_taskId_createdAt_idx" ON "TaskActivityHistory"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskAttachment_taskId_userId_idx" ON "TaskAttachment"("taskId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskSavedView_userId_name_key" ON "TaskSavedView"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "MicrosoftConnection_userId_key" ON "MicrosoftConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskListSynchronizationRecord_listId_key" ON "TaskListSynchronizationRecord"("listId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskListSynchronizationRecord_userId_externalId_key" ON "TaskListSynchronizationRecord"("userId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskListSynchronizationRecord_listId_userId_key" ON "TaskListSynchronizationRecord"("listId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskSynchronizationRecord_taskId_key" ON "TaskSynchronizationRecord"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskSynchronizationRecord_userId_externalListId_externalId_key" ON "TaskSynchronizationRecord"("userId", "externalListId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskSynchronizationRecord_taskId_userId_key" ON "TaskSynchronizationRecord"("taskId", "userId");

-- CreateIndex
CREATE INDEX "Task_listId_position_idx" ON "Task"("listId", "position");

-- CreateIndex
CREATE INDEX "Task_userId_important_urgent_idx" ON "Task"("userId", "important", "urgent");

-- CreateIndex
CREATE INDEX "Task_userId_reminderAt_idx" ON "Task"("userId", "reminderAt");

-- CreateIndex
CREATE UNIQUE INDEX "Task_recurrenceSourceId_occurrenceDate_key" ON "Task"("recurrenceSourceId", "occurrenceDate");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_listId_userId_fkey" FOREIGN KEY ("listId", "userId") REFERENCES "TaskList"("id", "userId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_habitId_userId_fkey" FOREIGN KEY ("habitId", "userId") REFERENCES "Habit"("id", "userId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskFolder" ADD CONSTRAINT "TaskFolder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskList" ADD CONSTRAINT "TaskList_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskList" ADD CONSTRAINT "TaskList_folderId_userId_fkey" FOREIGN KEY ("folderId", "userId") REFERENCES "TaskFolder"("id", "userId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDailyAssignment" ADD CONSTRAINT "TaskDailyAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDailyAssignment" ADD CONSTRAINT "TaskDailyAssignment_taskId_userId_fkey" FOREIGN KEY ("taskId", "userId") REFERENCES "Task"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskActivityHistory" ADD CONSTRAINT "TaskActivityHistory_taskId_userId_fkey" FOREIGN KEY ("taskId", "userId") REFERENCES "Task"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskActivityHistory" ADD CONSTRAINT "TaskActivityHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_taskId_userId_fkey" FOREIGN KEY ("taskId", "userId") REFERENCES "Task"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskSavedView" ADD CONSTRAINT "TaskSavedView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MicrosoftConnection" ADD CONSTRAINT "MicrosoftConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskListSynchronizationRecord" ADD CONSTRAINT "TaskListSynchronizationRecord_listId_userId_fkey" FOREIGN KEY ("listId", "userId") REFERENCES "TaskList"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskSynchronizationRecord" ADD CONSTRAINT "TaskSynchronizationRecord_taskId_userId_fkey" FOREIGN KEY ("taskId", "userId") REFERENCES "Task"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
