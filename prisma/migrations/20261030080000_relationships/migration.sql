-- CreateEnum
CREATE TYPE "RelationshipCategory" AS ENUM ('FAMILY', 'FRIEND', 'PROFESSIONAL', 'ACADEMIC', 'MENTOR', 'NETWORKING', 'OTHER');

-- CreateEnum
CREATE TYPE "RelationshipStatus" AS ENUM ('ACTIVE', 'DORMANT', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "InteractionType" AS ENUM ('CALL', 'MEETING', 'MESSAGE', 'EVENT', 'INTRODUCTION', 'OTHER');

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "photoUrl" TEXT,
    "category" "RelationshipCategory" NOT NULL,
    "organization" TEXT NOT NULL DEFAULT '',
    "profession" TEXT NOT NULL DEFAULT '',
    "importantDates" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT NOT NULL DEFAULT '',
    "relationshipStatus" "RelationshipStatus" NOT NULL DEFAULT 'ACTIVE',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "type" "InteractionType" NOT NULL,
    "description" TEXT NOT NULL,
    "context" TEXT NOT NULL DEFAULT '',
    "followUp" TEXT NOT NULL DEFAULT '',
    "importantNotes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Interaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Contact_userId_relationshipStatus_fullName_idx" ON "Contact"("userId", "relationshipStatus", "fullName");

-- CreateIndex
CREATE INDEX "Contact_userId_category_idx" ON "Contact"("userId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_id_userId_key" ON "Contact"("id", "userId");

-- CreateIndex
CREATE INDEX "Interaction_contactId_occurredAt_idx" ON "Interaction"("contactId", "occurredAt");

-- CreateIndex
CREATE INDEX "Interaction_userId_occurredAt_idx" ON "Interaction"("userId", "occurredAt");

-- AddCheckConstraint
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_name_valid_check"
CHECK (length(btrim("fullName")) > 0);

-- AddCheckConstraint
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_description_valid_check"
CHECK (length(btrim("description")) > 0);

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_contactId_userId_fkey" FOREIGN KEY ("contactId", "userId") REFERENCES "Contact"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
