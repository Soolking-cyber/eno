// One-off repair for storefronts stuck at Seller.trustScore's v1 @default(100) (audit 2026-09-23, #13).
//
// Run (DRY by default — prints what it would change and writes nothing):
//   npx tsx --env-file=.env scripts/resync-seller-trust.ts [--apply] [--sample 20]
//
// ─── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────
// Every Seller create omitted trustScore/trustTier, so a new storefront took the v1 column
// default (100) while trust v2 starts accounts at 60. recomputeTrust mirrored the owner's score
// onto the storefront ONLY when the owner's PROFILE score changed, so an owner whose score had
// already settled never re-mirrored — new and guest storefronts showed a blue "100 Trusted" shield
// for good. The code is fixed (initialSellerTrust at every create + an always-on guarded mirror in
// recomputeTrust, which self-heals every owned storefront on the next daily pass). This script is
// for the rows that exist today, and for ownerless storefronts, which no recompute ever reaches.
//
// ─── WHAT IT TOUCHES, AND WHAT IT DELIBERATELY DOES NOT ──────────────────────────────────────
//   1. OWNED storefronts whose trustScore/trustTier differ from the owner Profile → set to the
//      Profile's values. The Profile is the authority (recomputeTrust writes it); this is exactly
//      the mirror the daily pass would now do, done at once.
//   2. OWNERLESS storefronts still at the untouched v1 default (100 / 'standard') → the v2 guest
//      base (GUEST_SELLER_TRUST, 60 / 'standard').
//      ⛔ EXCEPT official partners and any storefront carrying affiliate listings. Those are
//      storefronts eno created on purpose (partners, imported catalogues, reference listings), and
//      their 100 feeds rankScore — moving them re-ranks the whole browse feed, which is a product
//      decision for the owner, not a data repair. They are COUNTED and reported, never written.
//   For every storefront it writes, Listing.sellerTrustScore is re-mirrored with a guarded RAW
//   update — ⛔ never a Prisma updateMany, which restamps Listing.updatedAt and corrupts trust's
//   sale timing (audit #26) — and rankScore is re-blended for the ACTIVE listings with the live
//   formula (ranking-formula.ts, the same source the app uses).
//
// Idempotent: every UPDATE is guarded by IS DISTINCT FROM / the exact stale values, so a re-run
// after --apply finds nothing to do.
import pg from 'pg'
import { GUEST_SELLER_TRUST } from '../src/lib/trust-math'
import { rankScoreExprSql } from '../src/lib/ranking-formula'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL / DATABASE_URL'); process.exit(1) }

const APPLY = process.argv.includes('--apply')
const sampleArg = process.argv.indexOf('--sample')
const SAMPLE = sampleArg > -1 ? Math.max(0, Number(process.argv[sampleArg + 1]) || 0) : 10
const V1_DEFAULT = { trustScore: 100, trustTier: 'standard' } as const

type Fix = { id: string; name: string; from: string; toScore: number; toTier: string; kind: 'owned' | 'guest' }

// Wrapped in main(): tsx's cjs output rejects top-level await (see backfill-listing-rankscore.ts).
async function main() {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    const owned = await client.query<{ id: string; name: string; ts: number; tt: string; ps: number; pt: string }>(
      `SELECT s.id, s.name, s."trustScore" AS ts, s."trustTier" AS tt, p."trustScore" AS ps, p."trustTier" AS pt
         FROM "Seller" s JOIN "Profile" p ON p.id = s."ownerId"
        WHERE s."trustScore" IS DISTINCT FROM p."trustScore" OR s."trustTier" IS DISTINCT FROM p."trustTier"`,
    )
    const guestBase = `s."ownerId" IS NULL AND s."trustScore" = $1 AND s."trustTier" = $2`
    const catalogue = `(s."officialPartner" OR EXISTS (SELECT 1 FROM "Listing" l WHERE l."sellerId" = s.id AND l."affiliateUrl" IS NOT NULL))`
    const guests = await client.query<{ id: string; name: string }>(
      `SELECT s.id, s.name FROM "Seller" s WHERE ${guestBase} AND NOT ${catalogue}`,
      [V1_DEFAULT.trustScore, V1_DEFAULT.trustTier],
    )
    const skipped = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM "Seller" s WHERE ${guestBase} AND ${catalogue}`,
      [V1_DEFAULT.trustScore, V1_DEFAULT.trustTier],
    )

    const fixes: Fix[] = [
      ...owned.rows.map((r) => ({ id: r.id, name: r.name, from: `${r.ts}/${r.tt}`, toScore: r.ps, toTier: r.pt, kind: 'owned' as const })),
      ...guests.rows.map((r) => ({
        id: r.id, name: r.name, from: `${V1_DEFAULT.trustScore}/${V1_DEFAULT.trustTier}`,
        toScore: GUEST_SELLER_TRUST.trustScore, toTier: GUEST_SELLER_TRUST.trustTier, kind: 'guest' as const,
      })),
    ]

    console.log(`owned storefronts out of sync with their owner: ${owned.rowCount}`)
    console.log(`ownerless storefronts at the v1 default (→ ${GUEST_SELLER_TRUST.trustScore}/${GUEST_SELLER_TRUST.trustTier}): ${guests.rowCount}`)
    console.log(`ownerless PARTNER/CATALOGUE storefronts at 100 — left alone (owner decision): ${skipped.rows[0]?.n ?? '0'}`)
    for (const f of fixes.slice(0, SAMPLE)) console.log(`  [${f.kind}] ${f.id} "${f.name}": ${f.from} → ${f.toScore}/${f.toTier}`)
    if (fixes.length > SAMPLE) console.log(`  … and ${fixes.length - SAMPLE} more`)

    if (!APPLY) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply to write.')
      return
    }

    let sellers = 0
    let listings = 0
    let reranked = 0
    for (const f of fixes) {
      await client.query('BEGIN')
      try {
        // Guarded on the values read above: a storefront the app re-synced in between is left alone.
        const s = f.kind === 'owned'
          ? await client.query(
              `UPDATE "Seller" s SET "trustScore" = p."trustScore", "trustTier" = p."trustTier"
                 FROM "Profile" p
                WHERE s.id = $1 AND p.id = s."ownerId"
                  AND (s."trustScore" IS DISTINCT FROM p."trustScore" OR s."trustTier" IS DISTINCT FROM p."trustTier")`,
              [f.id],
            )
          : await client.query(
              `UPDATE "Seller" SET "trustScore" = $2, "trustTier" = $3
                WHERE id = $1 AND "ownerId" IS NULL AND "trustScore" = $4 AND "trustTier" = $5`,
              [f.id, f.toScore, f.toTier, V1_DEFAULT.trustScore, V1_DEFAULT.trustTier],
            )
        if (!s.rowCount) { await client.query('ROLLBACK'); continue }
        sellers += s.rowCount
        // Mirror onto the listings from the row just written — RAW, so updatedAt is untouched (#26).
        const l = await client.query(
          `UPDATE "Listing" l SET "sellerTrustScore" = s."trustScore"
             FROM "Seller" s
            WHERE s.id = $1 AND l."sellerId" = s.id AND l."sellerTrustScore" IS DISTINCT FROM s."trustScore"`,
          [f.id],
        )
        listings += l.rowCount ?? 0
        if (l.rowCount) {
          const r = await client.query(`UPDATE "Listing" SET "rankScore" = ${rankScoreExprSql()} WHERE "sellerId" = $1 AND status = 'active'`, [f.id])
          reranked += r.rowCount ?? 0
        }
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      }
    }
    console.log(`\nAPPLIED: ${sellers} storefront(s), ${listings} listing mirror(s), ${reranked} active listing(s) re-ranked.`)
  } finally {
    await client.end()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
