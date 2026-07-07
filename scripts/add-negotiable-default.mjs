// Negotiable-price feature (2026-07-07) — mirror of the Supabase migration
// `negotiable_default_true_backfill`, for fresh DBs / resets. Flips
// Listing.negotiable's default to true and, ONE TIME, backfills legacy rows to
// negotiable (preserving the pre-feature "offers work everywhere" behavior; the
// column is only honored from this feature on). Safe to re-run.
// Run with the DIRECT connection:
//   set -a; . ./.env; set +a; export DATABASE_URL="$DIRECT_URL"; node scripts/add-negotiable-default.mjs
import pg from 'pg'

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()

// Idempotent: setting the column default is always safe to repeat.
await client.query(`ALTER TABLE public."Listing" ALTER COLUMN "negotiable" SET DEFAULT true;`)

// Self-disabling backfill. Post-feature, negotiable=false is a DELIBERATE seller
// choice ("Giá cố định") — a blanket false→true would silently un-fix every such
// listing. So only run the mass-flip in the PRE-FEATURE state, detected by "no
// listing is negotiable yet". The instant any row is true (this ran once, or a
// fresh DB created rows under the new default), the WHERE NOT EXISTS makes it a
// no-op forever after. This is what makes re-running the script harmless.
const r = await client.query(`
  UPDATE public."Listing" SET "negotiable" = true
  WHERE "negotiable" = false
    AND NOT EXISTS (SELECT 1 FROM public."Listing" WHERE "negotiable" = true);
`)
console.log(
  r.rowCount
    ? `negotiable default set true; one-time backfill flipped ${r.rowCount} legacy rows → negotiable`
    : `negotiable default set true; backfill skipped (already applied — deliberate fixed-price rows preserved)`,
)
await client.end()
