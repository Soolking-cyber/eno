-- Import from Facebook's tables. Idempotent and additive: run BEFORE the deploy that carries the feature (prisma/CLAUDE.md), through infra/vn-node/apply-fb-import.sh.
CREATE TABLE IF NOT EXISTS "FacebookImportJob" (
  "id" TEXT PRIMARY KEY,
  "profileId" UUID NOT NULL REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "fbName" TEXT NOT NULL,
  "pictureShas" TEXT[] NOT NULL,
  "leaseId" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "FacebookImportJob_status_createdAt_idx" ON "FacebookImportJob"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "FacebookImportJob_profileId_createdAt_idx" ON "FacebookImportJob"("profileId", "createdAt");
CREATE TABLE IF NOT EXISTS "FacebookImportItem" (
  "id" TEXT PRIMARY KEY,
  "jobId" TEXT NOT NULL REFERENCES "FacebookImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "fbItemId" TEXT NOT NULL,
  "raw" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'raw',
  "categorySlug" TEXT,
  "subcategorySlug" TEXT,
  "listingType" TEXT,
  "title" TEXT,
  "description" TEXT,
  "price" DOUBLE PRECISION,
  "district" TEXT,
  "city" TEXT,
  "condition" TEXT,
  "brand" TEXT,
  "model" TEXT,
  "attributes" JSONB,
  "specs" JSONB,
  "reason" TEXT,
  "listingId" TEXT,
  "publishingSince" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "FacebookImportItem_jobId_fbItemId_key" ON "FacebookImportItem"("jobId", "fbItemId");
CREATE INDEX IF NOT EXISTS "FacebookImportItem_status_updatedAt_idx" ON "FacebookImportItem"("status", "updatedAt");
-- 2026-11-06: the Vietnamese pair of the AI's English title and description (owner: "at least 2 proper translations vietnamese english"). Additive and nullable: an older row just has none.
ALTER TABLE "FacebookImportItem" ADD COLUMN IF NOT EXISTS "titleVi" TEXT;
ALTER TABLE "FacebookImportItem" ADD COLUMN IF NOT EXISTS "descriptionVi" TEXT;
-- The server reads these through Prisma. A seller's raw listings have no business on PostgREST: the event trigger already does this (rls-guard.sql); said here so a restore without it can't open them.
ALTER TABLE "FacebookImportJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FacebookImportItem" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "FacebookImportJob", "FacebookImportItem" FROM anon, authenticated;
