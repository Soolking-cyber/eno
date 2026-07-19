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

// ── 4. EnforcementAction: one ACTIVE silent flag per (profile, reason) ──
// Backstop for flagForReview's findFirst→create dedup (concurrent detectors could
// double-flag). Scoped to the FLAG reasons only — ladder actions (warned/held/…) may
// legitimately repeat a reason. Dedup keeps the earliest active flag; flag rows are
// pure admin-console annotations, so deleting a duplicate has no side effects.
const FLAG_REASONS = `('velocity_review','ban_evasion_email')`
await run('dedupe active EnforcementAction flags', `
  DELETE FROM "EnforcementAction" a
  USING "EnforcementAction" keep
  WHERE a."profileId" = keep."profileId"
    AND a.reason = keep.reason
    AND a.status = 'active' AND keep.status = 'active'
    AND a.reason IN ${FLAG_REASONS}
    AND (a."createdAt" > keep."createdAt"
         OR (a."createdAt" = keep."createdAt" AND a.id > keep.id));
`)
await run('create partial unique index on active EnforcementAction flags', `
  CREATE UNIQUE INDEX IF NOT EXISTS "EnforcementAction_active_flag_unique"
  ON "EnforcementAction" ("profileId", reason)
  WHERE status = 'active' AND reason IN ${FLAG_REASONS};
`)

// ── 5. Report: one OPEN report per reporter per SURFACE ──
// Backstop for the report route's findFirst→create dupe suppression. The surface is
// the highest-priority non-null key (conversation > listing > profile > seller) —
// each partial index replicates exactly that hierarchy, so a chat report and a
// listing report about the same listing stay independently filable (as the app
// allows). NO dedupe here: an open duplicate may own a dispute room — creating the
// index over existing dupes is warned about and skipped, never destructive.
const reportSurfaces = [
  ['Report_open_conversation_unique', `"reporterProfileId", "conversationId"`,
    `"status" = 'open' AND "reporterProfileId" IS NOT NULL AND "conversationId" IS NOT NULL`],
  ['Report_open_listing_unique', `"reporterProfileId", "listingId"`,
    `"status" = 'open' AND "reporterProfileId" IS NOT NULL AND "listingId" IS NOT NULL AND "conversationId" IS NULL`],
  ['Report_open_profile_unique', `"reporterProfileId", "targetProfileId"`,
    `"status" = 'open' AND "reporterProfileId" IS NOT NULL AND "targetProfileId" IS NOT NULL AND "listingId" IS NULL AND "conversationId" IS NULL`],
  ['Report_open_seller_unique', `"reporterProfileId", "targetSellerId"`,
    `"status" = 'open' AND "reporterProfileId" IS NOT NULL AND "targetSellerId" IS NOT NULL AND "targetProfileId" IS NULL AND "listingId" IS NULL AND "conversationId" IS NULL`],
]
for (const [name, cols, where] of reportSurfaces) {
  try {
    await run(`create partial unique index ${name}`, `
      CREATE UNIQUE INDEX IF NOT EXISTS "${name}" ON "Report" (${cols}) WHERE ${where};
    `)
  } catch (e) {
    // ONLY 23505 (existing duplicate open reports) is skippable: leave those rows
    // for manual admin triage (they may own dispute rooms) — the app-level findFirst
    // still suppresses new dupes. Anything else is a real failure and must surface.
    if (e.code !== '23505') throw e
    console.warn(`⚠ skipped ${name} (duplicate open reports exist — triage manually): ${e.message}`)
  }
}

// Sanity: list which of the expected indexes actually exist (report-surface ones
// may be legitimately absent after a 23505 skip above — the printout is the audit).
const EXPECTED = [
  'TrustEvent_one_time_reason_unique', 'SavedSearch_profile_params_unique',
  'EnforcementAction_active_flag_unique', ...reportSurfaces.map(([name]) => name),
]
const { rows } = await client.query(`
  SELECT indexname FROM pg_indexes
  WHERE indexname = ANY($1)
  ORDER BY indexname;
`, [EXPECTED])
const missing = EXPECTED.filter((n) => !rows.some((r) => r.indexname === n))
if (missing.length) console.warn('⚠ missing indexes:', missing.join(', '))
console.log('\n✓ indexes present:', rows.map((r) => r.indexname).join(', ') || 'NONE')
await client.end()
