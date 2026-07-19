// Optional defense-in-depth: hard DB guards behind the app-level idempotency
// already shipped (recomputeTrust one-time dedupe + saved-search findFirst).
// IDEMPOTENT — safe to re-run, and MUST be re-applied after any `prisma db push`
// (Prisma doesn't manage these raw/partial indexes, like profile_auth_fk).
//
// Run:  cd /Users/mk1e3/eno.vn && DIRECT_URL="$DIRECT_URL" node scripts/unique-constraints.mjs
//   (DIRECT_URL is read from .env — never hardcode the prod DB password in this file.)
//
// What it does:
//   1. TrustEvent: dedupe existing one-time events (keep earliest), then a PARTIAL
//      unique index on (subjectProfileId, reason) for the one-time reasons only —
//      so the -40 new-account deficit (and the +bonuses) can never double-apply,
//      while engagement/transaction/report events (which repeat) stay unconstrained.
//   2. SavedSearch: dedupe identical (profileId, params), then a unique index so a
//      double-save can't create a duplicate the alerts cron amplifies forever.
//
// ⚠️ A former step recomputed Profile.trustScore as `100 + SUM(delta)` — the RETIRED
// Trust v1 formula. Since Trust v2 (composeScore, base 60 — src/lib/trust-math.ts)
// that recompute CORRUPTED every displayed score each time this script ran after a
// `prisma db push`, until the nightly cron converged (audit 2026-07-18, P0). It is
// deliberately GONE: score recomputation belongs to recomputeTrust()/the cron only.
// Never reintroduce a score formula here.
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL / DATABASE_URL'); process.exit(1) }

const ONE_TIME = `('new_account','phone_verified','zalo_linked','kyc','profile_complete')`

const client = new pg.Client({ connectionString: url })
await client.connect()

const run = async (label, sql) => {
  const res = await client.query(sql)
  console.log(`✓ ${label}${res.rowCount != null ? ` (${res.rowCount} rows)` : ''}`)
  return res
}

// ── 1. TrustEvent: dedupe one-time events (keep the earliest per subject+reason) ──
await run('dedupe TrustEvent one-time events', `
  DELETE FROM "TrustEvent" t
  USING "TrustEvent" keep
  WHERE t."subjectProfileId" = keep."subjectProfileId"
    AND t.reason = keep.reason
    AND t.reason IN ${ONE_TIME}
    AND (t."createdAt" > keep."createdAt"
         OR (t."createdAt" = keep."createdAt" AND t.id > keep.id));
`)

await run('create partial unique index on TrustEvent one-time reasons', `
  CREATE UNIQUE INDEX IF NOT EXISTS "TrustEvent_one_time_reason_unique"
  ON "TrustEvent" ("subjectProfileId", reason)
  WHERE reason IN ${ONE_TIME};
`)

// ── 2. SavedSearch: dedupe identical saves, then enforce uniqueness ──
await run('dedupe SavedSearch identical (profileId, params)', `
  DELETE FROM "SavedSearch" s
  USING "SavedSearch" keep
  WHERE s."profileId" = keep."profileId"
    AND s.params = keep.params
    AND (s."createdAt" > keep."createdAt"
         OR (s."createdAt" = keep."createdAt" AND s.id > keep.id));
`)
await run('create unique index on SavedSearch (profileId, params)', `
  CREATE UNIQUE INDEX IF NOT EXISTS "SavedSearch_profile_params_unique"
  ON "SavedSearch" ("profileId", params);
`)

// ── 3. Handle: XOR owner CHECK — a row belongs to EXACTLY ONE of profileId/sellerId ──
// (Prisma can't express this; src/lib/handle.ts enforces it app-side, this is the
// DB backstop. Idempotent via the duplicate_object guard.)
await run('add Handle owner XOR check', `
  DO $$ BEGIN
    ALTER TABLE "Handle" ADD CONSTRAINT handle_owner_xor
      CHECK (("profileId" IS NULL) <> ("sellerId" IS NULL));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;
`)

// Sanity: confirm both indexes exist.
const { rows } = await client.query(`
  SELECT indexname FROM pg_indexes
  WHERE indexname IN ('TrustEvent_one_time_reason_unique','SavedSearch_profile_params_unique')
  ORDER BY indexname;
`)
console.log('\n✓ indexes present:', rows.map((r) => r.indexname).join(', ') || 'NONE')
await client.end()
