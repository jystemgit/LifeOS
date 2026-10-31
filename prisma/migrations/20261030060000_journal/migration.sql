-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entryDate" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalTag" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntryTag" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntryTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalRevision" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "entryDate" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tagNames" JSONB NOT NULL DEFAULT '[]',
    "snapshotAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JournalEntry_userId_entryDate_idx" ON "JournalEntry"("userId", "entryDate");

-- CreateIndex
CREATE INDEX "JournalEntry_userId_category_entryDate_idx" ON "JournalEntry"("userId", "category", "entryDate");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_id_userId_key" ON "JournalEntry"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalTag_userId_normalizedName_key" ON "JournalTag"("userId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "JournalTag_id_userId_key" ON "JournalTag"("id", "userId");

-- CreateIndex
CREATE INDEX "JournalEntryTag_tagId_userId_idx" ON "JournalEntryTag"("tagId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntryTag_entryId_tagId_key" ON "JournalEntryTag"("entryId", "tagId");

-- CreateIndex
CREATE INDEX "JournalRevision_userId_entryId_snapshotAt_idx" ON "JournalRevision"("userId", "entryId", "snapshotAt");

-- CreateIndex
CREATE UNIQUE INDEX "JournalRevision_entryId_version_key" ON "JournalRevision"("entryId", "version");

-- AddCheckConstraint
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_content_valid_check"
CHECK (
    length(btrim("title")) > 0
    AND length(btrim("content")) > 0
    AND length(btrim("category")) > 0
    AND "version" >= 0
);

-- AddCheckConstraint
ALTER TABLE "JournalRevision" ADD CONSTRAINT "JournalRevision_version_valid_check"
CHECK ("version" >= 0);

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalTag" ADD CONSTRAINT "JournalTag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntryTag" ADD CONSTRAINT "JournalEntryTag_entryId_userId_fkey" FOREIGN KEY ("entryId", "userId") REFERENCES "JournalEntry"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntryTag" ADD CONSTRAINT "JournalEntryTag_tagId_userId_fkey" FOREIGN KEY ("tagId", "userId") REFERENCES "JournalTag"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalRevision" ADD CONSTRAINT "JournalRevision_entryId_userId_fkey" FOREIGN KEY ("entryId", "userId") REFERENCES "JournalEntry"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
