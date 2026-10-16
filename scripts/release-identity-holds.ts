// Release EVERY listing the seller identity gate parked (identityHold = true) — by hand.
//   set -a; . ./.env; set +a; npx tsx scripts/release-identity-holds.ts                          # dry run
//   set -a; . ./.env; set +a; npx tsx scripts/release-identity-holds.ts --apply --gate-is-off     # write
//
// WHEN TO RUN IT: after IDENTITY_GATE_ENFORCED has been switched OFF again (a VNPT outage, a legal
// change, a rollback). While the gate was on, admin approvals, enforcement lifts, publish-held.ts and
// guest-storefront claims PARKED listings of unverified owners instead of publishing them; each of
// those was a decision to publish that only the identity gate stood in front of. Switching the gate
// off does not revisit them — releaseIdentityHolds() only runs when an owner becomes verified — so
// without this script they would stay hidden for as long as their owners never verify.
//
// ⚠️ WHAT IT DOES NOT DO: it never touches a row whose `identityHold` is false. A listing a
// moderator, the AI/provenance auto-holds or the enforcement ladder pulled has identityHold=false
// (every takedown write clears it — see prisma/schema.prisma on Listing.identityHold), so this
// cannot republish a takedown. It also leaves `status` alone: a parked row the seller has since
// hidden or sold becomes verified but stays out of the feed, which is what they asked for.
//
// ⛔ --apply REQUIRES --gate-is-off, AN ACKNOWLEDGEMENT, NOT A READING OF THIS SHELL. Releasing
// everyone while production enforces the gate publishes exactly the listings it exists to hold. The
// first version asked identityGateEnforced() instead — which is true only when
// NEXT_PUBLIC_ENO_EDITION=marketplace AND IDENTITY_GATE_ENFORCED=1 are set in THIS process, and
// neither is in .env: the deployed switch lives in Secret Manager (eno-root-env). So under the
// documented invocation the safety check could never fire. Check eno-root-env, then say so.
// As a second fence, it still refuses if this shell DOES read the gate as on.
//
// ⚠️ SEARCH IS NOT REFRESHED BY THIS SCRIPT. Parking dropped these listings from the Vertex AI
// Search index (the app's reindex deletes non-public rows); a raw UPDATE does not put them back.
// It prints the released ids and the backfill to run afterwards.
//
// ⛔ AN e-VISA / LEGAL & PERMITS ROW eno HAS NOT CHECKED STAYS PARKED (owner, 2026-10-14 — src/lib/licence-stamp.ts),
// exactly as releaseIdentityHolds() leaves it: the gate being off says nothing about the provider's licence. Only rows
// licenceCleared() passes are released, and the UPDATE ANDs licenceClearedSql against an edit between the read and the
// write. No desk exemption in a script (it cannot resolve the desk): an unstamped desk row stays parked — fail closed.
// Those rows go live through Admin › Catalogue › Licence checks.
import pg from 'pg'
import { identityGateEnforced } from '../src/lib/compliance/account-state'
import { licenceCleared, licenceClearedSql } from '../src/lib/licence-stamp'

const APPLY = process.argv.includes('--apply')
const ACK_OFF = process.argv.includes('--gate-is-off')

;(async () => {
  const c = new pg.Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL })
  await c.connect()
  try {
    const { rows } = await c.query(
      `SELECT l.status, count(*)::int AS n, count(DISTINCT l."sellerId")::int AS sellers
         FROM "Listing" l WHERE l."identityHold" GROUP BY l.status ORDER BY l.status`,
    )
    const total = rows.reduce((a, r) => a + r.n, 0)
    console.log(`identity-held listings: ${total}`)
    for (const r of rows) console.log(`  ${String(r.status).padEnd(8)} ${r.n}  (${r.sellers} seller(s))`)
    if (!total) return

    // The licence check, per row (header): only what licenceCleared() passes is released.
    const held = await c.query(
      `SELECT l.id, l."sellerId", l."subcategorySlug", l.attributes, l."verificationMethod", cat.slug AS "categorySlug"
         FROM "Listing" l JOIN "Category" cat ON cat.id = l."categoryId" WHERE l."identityHold"`,
    )
    const releasable = held.rows
      .filter((r) => licenceCleared({ categorySlug: r.categorySlug, subcategorySlug: r.subcategorySlug, sellerId: r.sellerId, attributes: r.attributes, verificationMethod: r.verificationMethod }, { desk: false }))
      .map((r) => r.id as string)
    const waiting = held.rows.length - releasable.length
    if (waiting) console.log(`${waiting} stay parked: waiting for a licence check (approve under Catalogue › Licence checks)`)
    if (!releasable.length) return

    if (!APPLY) {
      console.log(`(dry run — re-run with --apply to publish ${releasable.length})`)
      return
    }
    if (!ACK_OFF) {
      console.error('⛔ --apply needs --gate-is-off: confirm IDENTITY_GATE_ENFORCED is unset in the DEPLOYED env (Secret Manager eno-root-env) first. This shell cannot tell.')
      process.exitCode = 1
      return
    }
    if (identityGateEnforced()) {
      console.error('⛔ This shell reads the identity gate as ENFORCED, contradicting --gate-is-off. Refusing — resolve which is true first.')
      process.exitCode = 1
      return
    }
    // SET LOCAL inside a transaction: a bare SET does not survive statement to statement on the pooled
    // DATABASE_URL, and an UPDATE queued behind a long transaction must give up, not stall the site.
    await c.query('BEGIN')
    await c.query(`SET LOCAL lock_timeout = '5s'`)
    const res = await c.query(`UPDATE "Listing" SET verified = true, "identityHold" = false, "verificationNotes" = NULL WHERE "identityHold" AND id = ANY($1::text[]) AND ${licenceClearedSql()} RETURNING id`, [releasable])
    await c.query('COMMIT')
    const ids = res.rows.map((r) => r.id as string)
    console.log(`RELEASED ${res.rowCount} listing(s):`)
    for (const id of ids) console.log(`  ${id}`)
    console.log('NEXT, both required:')
    console.log('  1. Purge the CDN (a tag purge of eno-html,eno-public, both zones) so the pages re-render.')
    console.log('  2. Re-add them to AI search — parking removed them from the Vertex index:')
    console.log('       set -a; . ./.env; set +a; node scripts/vertex-backfill.mjs')
    console.log('     (or POST https://eno.vn/api/admin/vertex-backfill with an admin session).')
  } finally {
    await c.end()
  }
})()
