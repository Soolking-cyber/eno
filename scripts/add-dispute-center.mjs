// Dispute center DDL (2026-07-07) — idempotent mirror of the Supabase migration
// `add_dispute_center`, for DB resets. Threaded case room on Report: DisputeMessage
// table + evidence-window/AI-cache/decision columns on Report.
// Run with the DIRECT (non-pooled) connection:
//   set -a; . ./.env; set +a; export DATABASE_URL="$DIRECT_URL"; node scripts/add-dispute-center.mjs
import pg from 'pg'

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()

const SQL = `
ALTER TABLE public."Report" ADD COLUMN IF NOT EXISTS "evidenceUntil" timestamp(3) without time zone;
ALTER TABLE public."Report" ADD COLUMN IF NOT EXISTS "lastMessageAt" timestamp(3) without time zone;
ALTER TABLE public."Report" ADD COLUMN IF NOT EXISTS "aiAnalysis" text;
ALTER TABLE public."Report" ADD COLUMN IF NOT EXISTS "aiAnalyzedAt" timestamp(3) without time zone;
ALTER TABLE public."Report" ADD COLUMN IF NOT EXISTS "decisionNote" text;

CREATE TABLE IF NOT EXISTS public."DisputeMessage" (
  "id" text NOT NULL,
  "reportId" text NOT NULL,
  "senderProfileId" uuid,
  "senderRole" text NOT NULL,
  "body" text NOT NULL,
  "images" text,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DisputeMessage_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DisputeMessage_reportId_fkey') THEN
    ALTER TABLE public."DisputeMessage"
      ADD CONSTRAINT "DisputeMessage_reportId_fkey"
      FOREIGN KEY ("reportId") REFERENCES public."Report"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "DisputeMessage_reportId_createdAt_idx"
  ON public."DisputeMessage"("reportId", "createdAt");
`

await client.query(SQL)
console.log('dispute-center DDL applied (idempotent)')
await client.end()
