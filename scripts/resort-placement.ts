/**
 * Re-file imported listings whose placement predates a taxonomy rule change.
 *
 *   npx tsx scripts/resort-placement.ts                     # DRY RUN — the full transition table
 *   npx tsx scripts/resort-placement.ts --apply
 *   npx tsx scripts/resort-placement.ts --only electronics/cameras     # one source shelf
 *   npx tsx scripts/resort-placement.ts --restore data/resort-placement-snapshot-….jsonl
 *
 * ⛔ THIS EXISTS BECAUSE `refreshPlacement` PINS A ROW ONCE IT HAS A SUBCATEGORY. That is correct
 * for the importer — a nightly feed must not undo a deliberate re-file — but it means a RULE FIX
 * reaches future imports only. When `pc-components` and `security-cameras` were added on
 * 2026-09-20, the ~1,640 rows the new shelves were built for stayed pinned to `laptops-pcs` and
 * `cameras`, and both new facets rendered as browsable, near-empty category pages. Ten review
 * rounds raised that gap every single round. This script is the other half of that change.
 *
 * ⛔ IT DELIBERATELY BYPASSES `refreshPlacement`, WHICH IS THE ONLY REASON IT IS DANGEROUS. Every
 * guard below exists to bound that:
 *
 *   1. IMPORTER-OWNED ROWS ONLY — `externalId != null` AND the seller has no `ownerId`. A row with
 *      an owner belongs to a real person who chose where to file it; nothing here may touch it.
 *      `Seller.name` is NOT unique (anyone can open a storefront called "CellphoneS"), so the
 *      ownerId test is the one that actually means something — same reasoning as the importer's.
 *   2. A CEILING. If more than MAX_MOVE_FRACTION of the eligible rows would move, the script
 *      REFUSES rather than applying, because a rule regression looks exactly like a big backfill.
 *      A 5% backfill is a fix; a 60% one is the table having changed meaning under you.
 *   3. A SNAPSHOT of every row it is about to change, written BEFORE the first write.
 *   4. IT NEVER INVENTS A PLACEMENT. A title the rules cannot classify (`subcategoryFor` → null)
 *      is left exactly where it is. Unsorted-but-untouched beats confidently wrong.
 *
 * ⚠️ `attributes` IS `String?`, NOT `Json?`, SO `attributes: null` IS CORRECT. Both review seats
 * called it a `PrismaClientValidationError` that would abort the first batch, and both were wrong —
 * the Json-column rule they were quoting (`Prisma.DbNull`) does not apply to a nullable String.
 * Checked in prisma/schema.prisma before changing anything; classify-by-breadcrumb.ts has written
 * it this way for months. Recorded here because it is the kind of claim that sounds authoritative.
 *
 * ⚠️ ATTRIBUTES ARE CLEARED ON ANY PLACEMENT CHANGE, for the reason classify-by-breadcrumb.ts
 * records: a spec is only meaningful under the subcategory that offers it, so a row re-filed from
 * `cables-chargers` to `laptops-pcs` must lose its `wattage`. Re-run enrich-electronics.ts after.
 */
import 'dotenv/config'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { db } from '../src/lib/db'
import { categoryFor, subcategoryFor } from '../src/lib/feed-taxonomy'

const APPLY = process.argv.includes('--apply')
/**
 * ⚠️ SAME MISSING-VALUE GUARD AS `--restore`, AND FOR THE WORSE DIRECTION. `--only` typed without a
 * value leaves `ONLY` undefined, the filter silently DISAPPEARS, and an operator who asked for one
 * shelf gets a catalogue-wide re-file; `--only --apply` sets it to "--apply", which matches no
 * `from` and reports "Nothing to do" — a silent no-op that reads as success. opus caught that the
 * fix written ten lines above had not been applied to its neighbour.
 */
const WANTS_ONLY = process.argv.includes('--only')
const ONLY = (() => { const i = process.argv.indexOf('--only'); return i >= 0 ? process.argv[i + 1] : undefined })()
if (WANTS_ONLY && (!ONLY || ONLY.startsWith('--'))) {
  console.error('⛔ --only needs a shelf: --only electronics/cameras   (category/subcategory, or category/— for none)')
  process.exit(1)
}
/**
 * ⛔ THE FLAG'S PRESENCE IS READ SEPARATELY FROM ITS VALUE. `--restore` typed last (or with the
 * filename forgotten) made `process.argv[i + 1]` undefined, `if (RESTORE)` false, and execution
 * fell straight through into the FORWARD migration — with `--apply` already set, an operator
 * asking for a rollback would have got another catalogue-wide re-file. agy caught it. A missing
 * value must stop the script, never select the opposite behaviour.
 */
const WANTS_RESTORE = process.argv.includes('--restore')
const RESTORE = (() => { const i = process.argv.indexOf('--restore'); return i >= 0 ? process.argv[i + 1] : undefined })()
if (WANTS_RESTORE && (!RESTORE || RESTORE.startsWith('--'))) {
  console.error('⛔ --restore needs a snapshot file: --restore data/resort-placement-snapshot-….jsonl')
  process.exit(1)
}

/**
 * ⚠️ THE BRAKE MEASURES THE WHOLE CATALOGUE, SO AN `--only` RUN IS EFFECTIVELY UNBRAKED — a single
 * shelf is a small fraction of everything and will not trip the ceiling however completely it
 * moves. That is deliberate (the alternative refused the flag's only use case) but it means
 * `--only` trades the automatic guard for the operator having named the shelf on purpose. opus
 * raised it; it is a limitation, not a defect, and it belongs in writing either way.
 *
 * ⚠️ 0.25 IS A BRAKE, NOT A TARGET. The 2026-09-20 backfill was expected to move ~1,640 of ~48,000
 * eligible rows (~3.4%). A number far above that means the rules changed meaning rather than gained
 * two shelves, and the right response is to read the transition table, not to raise this constant.
 */
const MAX_MOVE_FRACTION = 0.25

/**
 * ⛔ THE DEFAULT RUN MOVES ROWS ONLY *INTO* THESE SHELVES, AND THAT NARROWING IS THE WHOLE POINT.
 * Without it the script did what its name says rather than what its header promises: a
 * catalogue-wide re-classification from the TITLE, overruling every row that
 * `classify-by-breadcrumb.ts` had placed from the merchant's own category path — which is strictly
 * better evidence than a title heuristic — and wiping each one's attributes on the way past. The
 * 25% brake never trips on that, because it is a few percent at a time. opus caught the gap
 * between the stated scope and the actual one.
 *
 * ⚠️ `--any-target` widens it back to every disagreement. That is a real operation after a bigger
 * rule change, so the flag exists; it is not the default, it says so on the way past, and the
 * breadcrumb caveat above is the reason to think twice before using it.
 */
const NEW_SHELVES = new Set(['pc-components', 'security-cameras'])
const ANY_TARGET = process.argv.includes('--any-target')

type Move = {
  id: string; categoryId: string; subcategorySlug: string | null
  clearAttrs: boolean; from: string; to: string; title: string
}

/**
 * ⛔ THE SNAPSHOT IS ONLY A ROLLBACK IF SOMETHING CAN READ IT BACK. opus pointed out the diff
 * shipped a JSONL nobody could apply; writing the restore path now, beside the thing that produces
 * it, is the only time it is certain to match the format.
 */
async function restore(file: string) {
  if (!existsSync(file)) { console.error(`no such snapshot: ${file}`); process.exit(1) }
  type Snap = { id: string; categoryId: string; subcategorySlug: string | null; attributes: string | null }
  const rows: Snap[] = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))

  /**
   * ⛔ RE-CHECK ELIGIBILITY AT RESTORE TIME. opus's case: a seller CLAIMS an imported listing
   * between the resort and the rollback, and a blind restore then overwrites the placement that
   * real person chose with importer state — the one thing guard 1 exists to prevent, undone by the
   * rollback path. Ownership is a fact about NOW, not about when the snapshot was written.
   */
  const stillEligible = new Set((await db.listing.findMany({
    where: { id: { in: rows.map((r) => r.id) }, externalId: { not: null }, listingType: 'sell', seller: { ownerId: null } },
    select: { id: true },
  })).map((r) => r.id))
  const claimed = rows.filter((r) => !stillEligible.has(r.id))
  const restorable = rows.filter((r) => stillEligible.has(r.id))
  console.log(`${rows.length} in snapshot · ${restorable.length} restorable · ${claimed.length} now owned or ineligible (SKIPPED)`)
  if (claimed.length) for (const r of claimed.slice(0, 10)) console.log(`  skip ${r.id}`)

  // ⚠️ A restore is a write, so it takes the same dry-run discipline as the forward path.
  if (!APPLY) { console.log('DRY RUN — pass --apply to write.'); await db.$disconnect(); return }
  if (!restorable.length) { console.log('Nothing to restore.'); await db.$disconnect(); return }

  // ⛔ SNAPSHOT THE CURRENT STATE BEFORE UNDOING — a rollback that cannot itself be rolled back is
  // a second one-way door, not a safety net.
  mkdirSync('data', { recursive: true })
  const pre = `data/resort-placement-pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`
  const now = await db.listing.findMany({
    where: { id: { in: restorable.map((r) => r.id) } },
    select: { id: true, categoryId: true, subcategorySlug: true, attributes: true },
  })
  writeFileSync(pre, now.map((r) => JSON.stringify(r)).join('\n') + '\n')
  console.log(`pre-restore snapshot: ${pre}`)

  for (let i = 0; i < restorable.length; i += 25) {
    const batch = restorable.slice(i, i + 25)
    // ⚠️ Same reason as the forward path: a 200-row interactive transaction exceeds Prisma's 5s
    // ceiling. Per-row updates are atomic and the pre-restore snapshot is the undo.
    await Promise.all(batch.map((r) =>
      db.listing.update({ where: { id: r.id }, data: { categoryId: r.categoryId, subcategorySlug: r.subcategorySlug, attributes: r.attributes } })))
    process.stdout.write(`\r  restored ${Math.min(i + 25, restorable.length)}/${restorable.length}`)
  }
  console.log('\ndone.')
  await db.$disconnect()
}

async function main() {
  if (RESTORE) return restore(RESTORE)
  const cats = await db.category.findMany({ select: { id: true, slug: true } })
  const catId = new Map(cats.map((c) => [c.slug, c.id]))
  const slugOf = new Map(cats.map((c) => [c.id, c.slug]))

  const rows = await db.listing.findMany({
    /**
     * ⛔ `listingType: 'sell'` IS THE LEGAL GUARD, NOT A TIDINESS FILTER. The visa desk and the trip
     * desk are ONE shared `Seller` whose `ownerId` IS NULL, so guard 1 does not exclude them — and
     * their rows are `listingType: 'service'`. product-feed.ts keeps them out of the ad catalogue
     * with exactly this test, for exactly this reason (CLAUDE.md: eno.vn is a licensed sàn TMĐT and
     * may not advertise visa or itinerary services at all). opus found the gap. Re-filing a visa
     * product into a marketplace shelf would put it on eno.vn's browse pages permanently.
     */
    where: { externalId: { not: null }, listingType: 'sell', seller: { ownerId: null } },
    select: { id: true, title: true, categoryId: true, subcategorySlug: true, attributes: true },
  })
  console.log(`${rows.length} importer-owned listings eligible\n`)

  const moves: Move[] = []
  let already = 0, unclassified = 0, noCategory = 0, skipped = 0, outOfScope = 0

  for (const r of rows) {
    const from = `${slugOf.get(r.categoryId) ?? '?'}/${r.subcategorySlug ?? '—'}`
    if (ONLY && from !== ONLY) { skipped++; continue }

    const category = categoryFor(r.title)
    const subcategory = subcategoryFor(category, r.title)

    // ⛔ GUARD 4. A rule that cannot place this title has no opinion about it — that is not the
    // same as an opinion that it belongs nowhere, and overwriting a real shelf with `null` would
    // empty facets rather than fill them.
    if (!subcategory) { unclassified++; continue }

    const targetCat = catId.get(category)
    if (!targetCat) { noCategory++; continue }

    const to = `${category}/${subcategory}`
    if (from === to) { already++; continue }
    // ⛔ THE SCOPE GUARD. A row only moves if it is moving INTO one of the shelves this backfill
    // exists for — unless the operator asked for everything, knowingly.
    if (!ANY_TARGET && !NEW_SHELVES.has(subcategory)) { outOfScope++; continue }

    moves.push({
      id: r.id, categoryId: targetCat, subcategorySlug: subcategory, title: r.title,
      clearAttrs: !!r.attributes, from, to,
    })
  }

  // ⛔ THE CEILING IS A FRACTION OF THE WHOLE CATALOGUE, NOT OF THE FILTER. Dividing by the
  // `--only` subset made the documented single-shelf backfill refuse itself at ~100% every time —
  // the one case the flag exists for. Both seats found it. `considered` is for the report; the
  // brake below uses `rows.length`, so narrowing the filter can only ever make it easier to pass,
  // never harder, and the brake keeps meaning "how much of the catalogue is moving".
  const considered = rows.length - skipped
  console.log(`${considered} considered · ${already} already correct · ${unclassified} no rule (left alone) · ${noCategory} unknown category`)
  console.log(ANY_TARGET
    ? `⚠️  --any-target: EVERY disagreement moves, including rows placed from merchant breadcrumbs.`
    : `${outOfScope} would move elsewhere and are LEFT ALONE (default scope: → ${[...NEW_SHELVES].join(', ')}; use --any-target to widen)`)
  console.log(`${moves.length} would move (${((moves.length / Math.max(considered, 1)) * 100).toFixed(1)}% of considered)\n`)

  /**
   * ⚠️ PRINT EVERY TRANSITION, NOT A TOP-N. classify-by-breadcrumb.ts records what a silent
   * truncation cost: nine microwaves sitting in `audio` fell below a top-22 cut, so the table read
   * as complete and sent the reader looking for a bug in the mapping that was never there.
   */
  const tally = new Map<string, number>()
  for (const m of moves) tally.set(`${m.from}  ->  ${m.to}`, (tally.get(`${m.from}  ->  ${m.to}`) ?? 0) + 1)
  const ranked = [...tally].sort((a, b) => b[1] - a[1])
  console.log(`${ranked.length} distinct transitions:`)
  for (const [move, n] of ranked) console.log(`  ${String(n).padStart(6)}  ${move}`)

  console.log('\nA sample of what moves, so the table is not the only evidence:')
  for (const m of moves.slice(0, 12)) console.log(`  ${m.from} -> ${m.to}   ${m.title.slice(0, 74)}`)

  if (!APPLY) { console.log('\nDRY RUN — nothing written.'); await db.$disconnect(); return }

  // ⛔ GUARD 2 — the ceiling. Checked at APPLY time, after the table has been printed, so the
  // operator sees WHAT would have moved before being told it is refused.
  const fraction = moves.length / Math.max(rows.length, 1)
  if (fraction > MAX_MOVE_FRACTION) {
    console.error(`\n⛔ REFUSING: ${(fraction * 100).toFixed(1)}% of ALL ${rows.length} eligible rows would move, over the ${(MAX_MOVE_FRACTION * 100).toFixed(0)}% ceiling.`)
    console.error('   A backfill this size is a rule regression until proven otherwise. Read the table above.')
    await db.$disconnect()
    process.exit(1)
  }
  if (!moves.length) { console.log('\nNothing to do.'); await db.$disconnect(); return }

  // ⛔ GUARD 3 — snapshot BEFORE the first write, so a half-finished run is still reversible.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  // ⚠️ `data/` is gitignored operational output and a fresh checkout has none, so writeFileSync
  // would ENOENT — after the guards passed and immediately before the writes. agy caught it.
  mkdirSync('data', { recursive: true })
  const snap = `data/resort-placement-snapshot-${stamp}.jsonl`
  const byId = new Map(rows.map((r) => [r.id, r]))
  writeFileSync(snap, moves.map((m) => {
    const r = byId.get(m.id)!
    return JSON.stringify({ id: r.id, categoryId: r.categoryId, subcategorySlug: r.subcategorySlug, attributes: r.attributes })
  }).join('\n') + '\n')
  console.log(`\nsnapshot: ${snap}  (${moves.length} rows)`)

  /**
   * ⛔ NOT `$transaction`. Measured against production: 200 updates in one interactive transaction
   * blew Prisma's 5s ceiling at 5140ms and the whole run aborted with zero rows written — and over
   * an SSH tunnel every round trip is slower still, so the ceiling is easy to hit and the batch
   * size that triggers it is not predictable.
   * ⚠️ AND THE TRANSACTION WAS NEVER THE SAFETY MECHANISM. The SNAPSHOT is: it is written before
   * the first write and `--restore` replays it. Each update is atomic by itself, a partial run
   * leaves rows correctly placed rather than half-placed, and re-running simply moves the rest.
   * classify-by-breadcrumb.ts has written its batches this way for months.
   *
   * ⛔ BATCH 25, NOT 200, BECAUSE `Promise.all` IS CONCURRENT WHERE `$transaction` WAS SEQUENTIAL.
   * Both seats made this point and it is the right one: Prisma's pool defaults to about
   * `num_cpus * 2 + 1`, so 200 simultaneous updates queue against a 10s `pool_timeout` — and the
   * slow tunnel that caused the original 5140ms is exactly what makes that queue drain slowly.
   * Swapping a transaction timeout for a P2024 would have been no trade at all. 25 stays under the
   * pool on any machine this runs from.
   * ⚠️ MEASURED BEFORE AND AFTER: the 444-row production backfill completed 444/444 with no pool
   * error even at 200, so this is hardening against a larger run, not a fix for an observed
   * failure. agy also asserted that array transactions do not use the 5s interactive ceiling —
   * the error text says otherwise verbatim: "The timeout for this transaction was 5000 ms,
   * however 5140 ms passed since the start of the transaction."
   */
  let done = 0
  for (let i = 0; i < moves.length; i += 25) {
    const batch = moves.slice(i, i + 25)
    await Promise.all(batch.map((m) => db.listing.update({
      where: { id: m.id },
      data: {
        categoryId: m.categoryId,
        subcategorySlug: m.subcategorySlug,
        // ⚠️ `null`, NOT `undefined` — in Prisma `undefined` means "leave this column alone", so
        // the clear would have silently done nothing and left stale specs on every re-filed row.
        ...(m.clearAttrs ? { attributes: null } : {}),
      },
    })))
    done += batch.length
    process.stdout.write(`\r  written ${done}/${moves.length}`)
  }
  console.log('\ndone.')
  console.log('⚠️ TWO THINGS ARE NOW STALE AND NEITHER FIXES ITSELF:')
  console.log('   1. specs — re-run `npx tsx scripts/enrich-electronics.ts` for the new placements;')
  console.log('   2. ISR — the category pages still serve the OLD shelf contents. Purge via')
  console.log('      revalidatePublicPath() (CLAUDE.md: a bare revalidatePath purges nothing under')
  console.log('      src/app/[lang]), then purge Cloudflare with purge_everything — purge-by-URL')
  console.log('      silently no-ops on cached HTML.')
  await db.$disconnect()
}

main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1) })
