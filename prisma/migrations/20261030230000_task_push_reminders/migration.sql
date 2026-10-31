CREATE TYPE "TaskPushDeliveryStatus" AS ENUM ('PENDING', 'RETRY', 'ACCEPTED', 'CANCELLED', 'FAILED');

CREATE TABLE "TaskPushSubscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "vapidPublicKey" TEXT NOT NULL,
  "locale" TEXT NOT NULL DEFAULT 'es',
  "expiresAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "TaskPushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskPushDelivery" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "reminderAt" TIMESTAMPTZ(3) NOT NULL,
  "status" "TaskPushDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedUntil" TIMESTAMPTZ(3),
  "leaseToken" TEXT,
  "acceptedAt" TIMESTAMPTZ(3),
  "lastError" TEXT,
  "httpStatus" INTEGER,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "TaskPushDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskPushWorkerState" (
  "id" TEXT NOT NULL,
  "lastStartedAt" TIMESTAMPTZ(3),
  "lastSuccessAt" TIMESTAMPTZ(3),
  "lockedUntil" TIMESTAMPTZ(3),
  "leaseToken" TEXT,
  "lastError" TEXT,
  CONSTRAINT "TaskPushWorkerState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaskPushSubscription_endpoint_key" ON "TaskPushSubscription"("endpoint");
CREATE INDEX "TaskPushSubscription_userId_revokedAt_idx" ON "TaskPushSubscription"("userId", "revokedAt");
CREATE UNIQUE INDEX "TaskPushSubscription_id_userId_key" ON "TaskPushSubscription"("id", "userId");
CREATE INDEX "TaskPushDelivery_status_availableAt_idx" ON "TaskPushDelivery"("status", "availableAt");
CREATE UNIQUE INDEX "TaskPushDelivery_taskId_reminderAt_subscriptionId_key" ON "TaskPushDelivery"("taskId", "reminderAt", "subscriptionId");

ALTER TABLE "TaskPushSubscription" ADD CONSTRAINT "TaskPushSubscription_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskPushDelivery" ADD CONSTRAINT "TaskPushDelivery_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskPushDelivery" ADD CONSTRAINT "TaskPushDelivery_taskId_userId_fkey"
  FOREIGN KEY ("taskId", "userId") REFERENCES "Task"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskPushDelivery" ADD CONSTRAINT "TaskPushDelivery_subscriptionId_userId_fkey"
  FOREIGN KEY ("subscriptionId", "userId") REFERENCES "TaskPushSubscription"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
