-- CreateEnum
CREATE TYPE "PersonalEventCategory" AS ENUM ('ACHIEVEMENT', 'GOAL', 'DECISION', 'MILESTONE', 'PERSONAL', 'ACADEMIC', 'PROFESSIONAL');

-- CreateTable
CREATE TABLE "PersonalEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lifeAreaId" TEXT,
    "eventDate" DATE NOT NULL,
    "category" "PersonalEventCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PersonalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalEvent_userId_eventDate_idx" ON "PersonalEvent"("userId", "eventDate");

-- CreateIndex
CREATE INDEX "PersonalEvent_lifeAreaId_eventDate_idx" ON "PersonalEvent"("lifeAreaId", "eventDate");

-- AddCheckConstraint
ALTER TABLE "PersonalEvent" ADD CONSTRAINT "PersonalEvent_title_valid_check"
CHECK (length(btrim("title")) > 0);

-- AddForeignKey
ALTER TABLE "PersonalEvent" ADD CONSTRAINT "PersonalEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalEvent" ADD CONSTRAINT "PersonalEvent_lifeAreaId_fkey" FOREIGN KEY ("lifeAreaId") REFERENCES "LifeArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;
