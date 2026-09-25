// RE-DERIVE ROOM COUNTS for imported rentals (2026-09-25) — bedrooms 1…5 exact and 6+, plus bathrooms.
// DRY RUN by default — prints what would change. `--apply` writes. IDEMPOTENT: a row is written
// only when its stored `attributes` differ from the derived value, and only if they have not changed
// since this run read them.
//
// Run:  set -a; . ./.env; set +a; npx tsx scripts/backfill-room-counts.ts            # report
//       set -a; . ./.env; set +a; npx tsx scripts/backfill-room-counts.ts --apply    # write
//
// ⛔ WHY. Until 2026-09-25 every importer stored `Math.min(beds, 3)`, so the bedrooms facet could
// only say 1, 2 or "3+" — a 4-bedroom house and a 9-bedroom villa were the same row to the filter.
// The owner asked for 1…5 and 6+. The exact count was never lost: every imported rental carries its
// source's fact lines in the description, ONE PER LINE ("Bedrooms: 4" then "Bathrooms: 3" on the next
// line — measured 2026-09-25: 19,282 rentals store a bedroom value and all 19,282 carry the line;
// 18,984 carry a newline-led "Bathrooms: N" and 0 a pipe-led one), so this reads it back and stores it
// through the SAME clamp the importers now use (`roomCountValue`, src/lib/taxonomy.ts): exact up to
// 5, '6' for six or more. Until it runs, the new 4 / 5 / 6+ chips are empty and hidden (the rail
// hides empty options) and "3 BR" still returns the old 3-or-more rows.
//
// Two rules, both the importers' own:
//  · BEDROOMS are re-derived only where a bedroom value is already stored — which subcategories get
//    the facet (not offices, not land) was the importer's decision and is not re-made here.
//  · BATHROOMS are added where the bedroom facet's subcategories offer the new bathroom facet
//    (apartment, house, room) and the line states a positive count; a missing count stays missing.
//
// ⚠️ RAW SQL ON PURPOSE: `@updatedAt` is applied by the Prisma client, and a re-derived facet is
// not an edit — restamping 19k rows would reorder "newest" and every recency-weighted rank.
// ⚠️ The write is conditional on the value this run read (`attributes IS NOT DISTINCT FROM $3`), so
// an importer or a seller writing the same row mid-run wins and the row is simply skipped.
import pg from 'pg'
import { invokedDirectly } from '../src/lib/cli-entry'
import { roomCountValue } from '../src/lib/taxonomy'

const BATH_SUBCATS = new Set(['apartment-rental', 'house-rental', 'room-rental'])

/** The number on a `Label: N` fact line, or null. Anchored on the line so prose cannot match. */
function factCount(text: string | null, label: string): number | null {
  const m = new RegExp(`(?:^|\\n)${label}: (\\d{1,3})(?:\\||\\n|$)`).exec(text ?? '')
  return m ? Number(m[1]) : null
}

/** The attributes a row should hold, or null when this backfill has nothing to say about it. */
export function derivedAttributes(row: { subcategorySlug: string | null; attributes: string | null; description: string | null }): string | null {
  let parsed: Record<string, string> = {}
  try {
    parsed = row.attributes ? JSON.parse(row.attributes) : {}
  } catch {
    return null // not ours to repair
  }
  const next: Record<string, string> = { ...parsed }
  if (parsed.bedrooms !== undefined) {
    const v = roomCountValue(factCount(row.description, 'Bedrooms'))
    if (v) next.bedrooms = v
  }
  if (row.subcategorySlug && BATH_SUBCATS.has(row.subcategorySlug) && parsed.bathrooms === undefined) {
    const v = roomCountValue(factCount(row.description, 'Bathrooms'))
    if (v) next.bathrooms = v
  }
  return Object.keys(next).length ? JSON.stringify(next) : null
}

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!url) throw new Error('Set DIRECT_URL (or DATABASE_URL) — `set -a; . ./.env; set +a` first')
  const apply = process.argv.includes('--apply')
  // A report cannot write: without --apply the session itself is read-only.
  const c = new pg.Client({ connectionString: url, ...(apply ? {} : { options: '-c default_transaction_read_only=on' }) })
  await c.connect()
  try {
    const { rows } = await c.query<{ id: string; subcategorySlug: string | null; attributes: string | null; description: string | null }>(`
      SELECT l.id, l."subcategorySlug", l.attributes, l.description
      FROM "Listing" l JOIN "Category" cat ON cat.id = l."categoryId"
      WHERE cat.slug = 'rentals'
        AND (l.attributes LIKE '%"bedrooms"%' OR l."subcategorySlug" = ANY($1))`, [[...BATH_SUBCATS]])
    const changes: { id: string; from: string | null; to: string }[] = []
    const tally = new Map<string, number>()
    for (const r of rows) {
      const to = derivedAttributes(r)
      if (!to || to === r.attributes) continue
      changes.push({ id: r.id, from: r.attributes, to })
      const k = `${r.attributes ?? 'null'} → ${to}`
      tally.set(k, (tally.get(k) ?? 0) + 1)
    }
    console.log(`${rows.length} rentals read, ${changes.length} would change`)
    for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(n).padStart(6)}  ${k}`)
    if (!apply) {
      console.log('dry run — re-run with --apply to write them')
      return
    }
    let written = 0
    for (let i = 0; i < changes.length; i += 500) {
      const batch = changes.slice(i, i + 500)
      await c.query('BEGIN')
      try {
        for (const ch of batch) {
          const r = await c.query(`UPDATE "Listing" SET attributes = $2 WHERE id = $1 AND attributes IS NOT DISTINCT FROM $3`, [ch.id, ch.to, ch.from])
          written += r.rowCount ?? 0
        }
        await c.query('COMMIT')
      } catch (e) {
        await c.query('ROLLBACK')
        throw e
      }
    }
    console.log(`wrote ${written} row(s); ${changes.length - written} skipped because they changed mid-run`)
  } finally {
    await c.end()
  }
}

// Imported by the unit test for `derivedAttributes`; only a direct run touches the database.
if (invokedDirectly(import.meta.url)) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
