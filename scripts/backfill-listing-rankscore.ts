// Recompute Listing.rankScore for EVERY row from the single-source formula
// (src/lib/ranking-formula.ts). Replaces the old .mjs whose inline SQL had drifted
// to the retired floor-40/span-120 calibration (audit Phase 1) — a backfill that
// silently re-ranked the whole feed on stale math.
//
// Run:  npx tsx --env-file=.env scripts/backfill-listing-rankscore.ts
import pg from 'pg'
import { rankScoreExprSql } from '../src/lib/ranking-formula'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL / DATABASE_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })
await client.connect()
const res = await client.query(`UPDATE "Listing" SET "rankScore" = ${rankScoreExprSql()}`)
console.log(`backfilled rankScore on ${res.rowCount} listing(s) with the live formula`)
await client.end()
