CREATE TABLE "GoogleCalendarConnection" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "refreshToken" TEXT NOT NULL,
  "calendarId" TEXT,
  "calendarPending" BOOLEAN NOT NULL DEFAULT false,
  "lockedUntil" TIMESTAMPTZ(3),
  "lastSyncAt" TIMESTAMPTZ(3),
  "error" TEXT,
  CONSTRAINT "GoogleCalendarConnection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GoogleCalendarConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GoogleCalendarConnection_userId_key" ON "GoogleCalendarConnection"("userId");

CREATE TABLE "GoogleTaskEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "baseline" JSONB NOT NULL,
  "conflict" JSONB,
  CONSTRAINT "GoogleTaskEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GoogleTaskEvent_taskId_userId_fkey" FOREIGN KEY ("taskId", "userId") REFERENCES "Task"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GoogleTaskEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GoogleTaskEvent_taskId_key" ON "GoogleTaskEvent"("taskId");
CREATE UNIQUE INDEX "GoogleTaskEvent_userId_externalId_key" ON "GoogleTaskEvent"("userId", "externalId");
