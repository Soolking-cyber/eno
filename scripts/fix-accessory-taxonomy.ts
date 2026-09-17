/**
 * Re-file imported listings whose SHELF was decided by the device they merely fit.
 *
 *   npx tsx scripts/fix-accessory-taxonomy.ts                 # DRY RUN (prints every change)
 *   npx tsx scripts/fix-accessory-taxonomy.ts --apply
 *   npx tsx scripts/fix-accessory-taxonomy.ts --seller "Thế Giới Di Động" --apply
 *   npx tsx scripts/fix-accessory-taxonomy.ts --undo /tmp/fix-accessory-taxonomy-3219.json --apply
 *   npx tsx scripts/fix-accessory-taxonomy.ts --host-brands            # the second repair, below
 *
 * ⛔ WHY THIS EXISTS. `src/lib/feed-taxonomy.ts` tested `iphone|ipad|…` BEFORE `ốp lưng|case`, so
 * every accessory whose title names its host device was filed as that device. Measured on live rows
 * 2026-09-17: **95 of the 127 "iPhone 18" listings were cases, tempered glass and protector combos
 * sitting in `phones-tablets`** — and 79 of them carried `Listing.model = "iPhone 18 Pro Max"`, so
 * the phone model facet, the brand/model browse view and the iPhone 18 landing page's rail were all
 * three-quarters phone cases. The rules are fixed; this repairs the rows they already wrote.
 *
 * ⚠️ SHELF ONLY — THE AISLE IS NOT TOUCHED. The new rules are re-run inside each row's EXISTING
 * category, never against `categoryFor()`. A category move relocates a listing between top-level
 * pages (`/c/<category>`, its sitemap entry, its rails) and the measured category diff is a
 * different, larger question; this script's blast radius stops at the subcategory.
 *
 * ⚠️ COMPATIBILITY IS MIGRATED, NOT DELETED (astra + agy, both independently). `model` on a case
 * means "fits this phone", and clearing it would throw away the only machine-readable record of
 * that. It moves to `attributes.compatibleWith` first — the same JSON column the browse feed filters
 * with `attr_compatibleWith=…`, so the signal stays queryable — and only then is `model` cleared, so
 * a ₫500,000 case stops sharing a price band with a ₫39,000,000 phone (`src/lib/price-stat.ts` keys
 * bands on brand+model+shelf, and a branded accessory would otherwise land in the phone's band).
 *
 * ⚠️ IMPORTED SHOPS ONLY (`seller.ownerId IS NULL`). A human seller's own filing is theirs.
 */
import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { db } from '../src/lib/db'
import { categoryFor, subcategoryFor, brandFor, HOST_BRANDS } from '../src/lib/feed-taxonomy'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
const SELLER = arg('seller')
const LIMIT = Number(arg('limit') ?? 0)

/** Shelves that describe an accessory rather than a device. A row landing here must not keep a
 *  `model` that names a phone — that is the mis-filing, restated one level down. */
const ACCESSORY_SHELVES = new Set(['phone-cases', 'screen-protectors', 'cables-chargers', 'power-banks', 'accessories'])

/**
 * A model value that names a HOST DEVICE rather than the accessory's own product line.
 *
 * ⚠️ NOT "every model on an accessory shelf". The dry run wanted to clear `HP21PBKGL-95` off "Balo
 * công nghệ Hyperpack Go Beyond" — that is the backpack's OWN model number, and losing it would be
 * the same kind of damage this script exists to undo, pointed the other way. Only a model that
 * names somebody else's phone, tablet, watch or laptop moves to `compatibleWith`.
 */
const HOST_DEVICE_MODEL = new RegExp(
  // ⚠️ BUILT FROM THE SHARED SET, because a hand-typed copy had already drifted: `honor`, `oneplus`,
  // `motorola`, `asus` and `sony` were in `HOST_BRANDS` and missing here, so a OnePlus or ROG case
  // moved to `phone-cases` while keeping `model = "OnePlus 12"` — half a repair, and the half left
  // behind is the one that pollutes the price band (agy).
  // ⚠️ LETTER *AND* DIGIT BOUNDARIES, not `\b`. Generated from the brand set, `hp` matched inside
  // the SKUs "HPW-MA01S-BLK" and "HP21PBKGL-95" and was about to clear two accessories' own model
  // numbers — the same damage this script exists to undo, pointed the other way. `\b` would have
  // stopped the first and not the second, because a digit is a word character.
  `(?<![\\p{L}\\p{N}])(${[...HOST_BRANDS, 'iphone', 'ipad', 'macbook', 'airpods', 'apple watch', 'galaxy', 'redmi', 'pixel', 'surface', 'switch', 'playstation', 'xbox'].join('|')})(?![\\p{L}\\p{N}])`,
  'iu',
)

/** Shelves that name a DEVICE. A row here that the rules now read as an accessory is the bug. */
const DEVICE_SHELVES = new Set(['phones-tablets', 'laptops-pcs', 'tv-monitors', 'smartwatch', 'cameras', 'audio', 'gaming', 'networking', 'storage', 'printers', 'keyboards-mice'])

type Change = {
  id: string
  title: string
  from: string | null
  to: string | null
  /** true when this row's shelf actually moves (vs. only its model/brand being repaired). */
  shelf: boolean
  model: string | null
  brandFrom: string | null
  brandTo: string | null
}

/**
 * ⛔ A SNAPSHOT RESTORES THE FIELDS IT ACTUALLY HOLDS, AND NOTHING ELSE. Both external reviewers
 * found the same defect here independently: `--host-brands` wrote `{ model: null, attributes: null }`
 * as filler (it never reads those columns), and an unconditional restore then wrote those nulls back
 * over 496 rows — erasing the `compatibleWith` the other pass had just migrated. A rollback that
 * destroys more than the change it reverses is worse than no rollback, so the fields are optional
 * and only a present key is written.
 */
type Snapshot = { id: string; subcategorySlug?: string | null; model?: string | null; brandSlug?: string | null; attributes?: string | null }

async function undo(path: string) {
  const rows = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(path, 'utf8'))) as Snapshot[]
  const fields = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => k !== 'id')
  console.log(`restoring ${rows.length} rows from ${path} — fields: ${fields.join(', ')}${APPLY ? '' : ' (DRY RUN)'}`)
  if (!APPLY) return
  for (const r of rows) {
    const data: Record<string, string | null> = {}
    if ('subcategorySlug' in r) data.subcategorySlug = r.subcategorySlug ?? null
    if ('model' in r) data.model = r.model ?? null
    if ('brandSlug' in r) data.brandSlug = r.brandSlug ?? null
    if ('attributes' in r) data.attributes = r.attributes ?? null
    await db.listing.update({ select: { id: true }, where: { id: r.id }, data })
  }
  console.log('restored.')
}

/**
 * The same mis-filing one column over: an accessory wearing the brand of the device it fits.
 *
 * ⛔ 914 LIVE ROWS, FOUND BY BOTH EXTERNAL REVIEWERS ON THE DIFF. "Miếng Dán Cường Lực Camera Lens
 * Dành Cho Samsung Galaxy S23 Ultra Zeelot" is a Zeelot product filed under `samsung`, so the
 * Samsung and Apple brand pages — and the brand facet the iPhone 18 landing page's CTA uses — fill
 * with other companies' cases. `brandFor` no longer infers a host brand from an accessory title;
 * this rewrites the rows written before it stopped.
 *
 * ⚠️ IT ONLY EVER REMOVES A BRAND THE CORRECTED RULE DISAGREES WITH, and only on imported rows. A
 * row whose title names a real accessory maker keeps it (the rule returns that maker); a row the
 * rule can no longer justify goes back to null, which is what "we do not know" looks like here.
 */
async function hostBrands() {
  // ⚠️ THE OPERATOR'S SCOPE APPLIES HERE TOO. This pass ignored --seller and --limit, so a run
  // written as "one shop, ten rows" rewrote brands across every imported seller (astra).
  const rows = await db.listing.findMany({
    where: { seller: { ownerId: null, ...(SELLER ? { name: SELLER } : {}) }, brandSlug: { not: null } },
    select: { id: true, title: true, titleVi: true, brandSlug: true, subcategorySlug: true },
    ...(LIMIT ? { take: LIMIT } : {}),
  })
  /**
   * ⛔ CASES AND PROTECTORS ONLY, AND THE WIDER SWEEP IS WHY. Re-deriving the brand of every
   * imported row disagreed on 2,132 of them — "Mực in cho máy in HP" resolving to canon, AppleCare+
   * contracts losing `apple`, laptop batteries "cho laptop Dell" unbranded. Those are arguable at
   * best. A row filed as a CASE or a SCREEN PROTECTOR carrying a phone maker's brand is not
   * arguable: the product is somebody else's cover for that phone.
   */
  const changes = rows
    .filter((r) => r.subcategorySlug === 'phone-cases' || r.subcategorySlug === 'screen-protectors')
    .map((r) => ({ ...r, next: brandFor(r.titleVi || r.title) }))
    .filter((r) => r.next !== r.brandSlug && HOST_BRANDS.has(r.brandSlug ?? ''))
  console.log(`branded imported rows: ${rows.length}; the corrected rule disagrees on ${changes.length}`)
  const by = new Map<string, number>()
  for (const c of changes) by.set(`${c.brandSlug} → ${c.next ?? 'null'}`, (by.get(`${c.brandSlug} → ${c.next ?? 'null'}`) ?? 0) + 1)
  for (const [k, n] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${k.padEnd(26)} ${n}`)
  for (const c of changes.slice(0, 8)) console.log(`   · ${c.brandSlug} → ${c.next ?? 'null'}  ${(c.titleVi || c.title).slice(0, 78)}`)
  if (!APPLY) { console.log('\nDRY RUN — nothing written.'); return }
  const snapPath = arg('snapshot') ?? `/tmp/fix-host-brands-${changes.length}-${process.pid}.json`
  // Only `brandSlug` is touched by this pass, so only `brandSlug` is snapshotted — see the Snapshot note.
  writeFileSync(snapPath, JSON.stringify(changes.map((c) => ({ id: c.id, brandSlug: c.brandSlug }))))
  console.log(`before-values written to ${snapPath}`)
  let n = 0
  for (const c of changes) {
    await db.listing.update({ select: { id: true }, where: { id: c.id }, data: { brandSlug: c.next } })
    if (++n % 200 === 0) console.log(`  … ${n}/${changes.length}`)
  }
  console.log(`\nwrote ${n} rows.`)
}

/**
 * ⚠️ IMPORTED, NOT RETYPED. The first cut kept a private copy of this set and it was already five
 * brands behind the rule it mirrors (`honor`, `oneplus`, `motorola`, `msi`, `acer`) — so accessories
 * misbranded with those makers were skipped by the repair while the rule went on rejecting them.
 * agy caught the drift on review; one exported set cannot drift from itself.
 */

async function main() {
  if (process.argv.includes('--host-brands')) { await hostBrands(); await db.$disconnect(); return }
  const undoPath = arg('undo')
  if (undoPath) { await undo(undoPath); await db.$disconnect(); return }
  const rows = await db.listing.findMany({
    where: {
      seller: { ownerId: null, ...(SELLER ? { name: SELLER } : {}) },
    },
    select: {
      id: true, title: true, titleVi: true, model: true, brandSlug: true, subcategorySlug: true,
      attributes: true, category: { select: { slug: true } },
    },
    ...(LIMIT ? { take: LIMIT } : {}),
  })
  console.log(`imported-shop listings: ${rows.length}${SELLER ? ` (seller ${SELLER})` : ''}`)

  const changes: Change[] = []
  for (const r of rows) {
    // The Vietnamese title is the SOURCE — `title` is machine-translated English, and the rules are
    // written against both, but the original is the one the importer classified.
    const name = r.titleVi || r.title
    const categorySlug = r.category?.slug ?? categoryFor(name)
    const next = subcategoryFor(categorySlug, name)
    /**
     * ⛔ ONLY "DEVICE SHELF → ACCESSORY SHELF", NEVER ANYTHING ELSE, AND THE FIRST CUT PROVED WHY.
     * Re-deriving every shelf from the title touched **9,583 rows**: 1,244 phones-tablets → null,
     * 534 white-goods → null, 252 tables-desks → sofa-seating. Those shelves were not written by
     * these rules — the partner-shop importer maps each shop's own category tree — so re-deriving
     * them is not a repair, it is a second importer overwriting the first with a worse answer.
     * A row is only ever moved ONTO an accessory shelf here, and never to `null`.
     */
    if (!next || !ACCESSORY_SHELVES.has(next)) continue
    /**
     * ⚠️ AND ONLY OFF A *DEVICE* SHELF (or off none at all). The narrowed run still proposed 132
     * `bags-sleeves → accessories` moves — "Balo công nghệ Hyperpack" is a backpack, already on a
     * better shelf than the generic `accessories` bucket the `balo` fallback rule would give it.
     * Shuffling a row between two accessory shelves is not this bug and is usually a downgrade;
     * the bug is a row sitting on the shelf of the DEVICE it fits.
     */
    const shelfChanged = next !== r.subcategorySlug
      && (r.subcategorySlug === null || DEVICE_SHELVES.has(r.subcategorySlug))
    /**
     * ⛔ THIS SCRIPT NO LONGER SETS A BRAND. It did, for 30 rows, until a dry run showed the next 47
     * were laptop sleeves about to be branded `apple` off the word "macbook". Brand inference for
     * imported rows belongs to scripts/backfill-brands.ts, which resolves against the Brand
     * catalogue rather than a title regex; `--host-brands` below only ever REMOVES a brand that a
     * case or protector cannot have. Two writers of one column is how a column starts disagreeing
     * with itself.
     */
    const brandTo: string | null = null
    const clearsModel = Boolean(r.model && HOST_DEVICE_MODEL.test(r.model))
    if (!shelfChanged && !clearsModel && !brandTo) continue
    changes.push({ id: r.id, title: name.slice(0, 96), from: r.subcategorySlug, to: next, shelf: shelfChanged, model: clearsModel ? r.model : null, brandFrom: r.brandSlug, brandTo })
  }

  const byMove = new Map<string, number>()
  for (const c of changes) {
    const k = c.shelf ? `${c.from ?? 'null'} → ${c.to ?? 'null'}` : `${c.from ?? 'null'} (shelf kept)`
    byMove.set(k, (byMove.get(k) ?? 0) + 1)
  }
  console.log(`\nrows to change: ${changes.length}  (models cleared: ${changes.filter((c) => c.model).length}, brands set: ${changes.filter((c) => c.brandTo).length})`)
  for (const [k, n] of [...byMove].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(34)} ${n}`)
  for (const c of changes.slice(0, 12)) console.log(`   · ${c.from ?? 'null'} → ${c.to ?? 'null'}  ${c.model ? `[model ${c.model} → compatibleWith]` : ''} ${c.title}`)

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply.')
    await db.$disconnect()
    return
  }

  /**
   * ⚠️ THE OLD VALUES GO TO DISK BEFORE THE FIRST WRITE. 3,219 rows is past the size where "it is
   * re-derivable" is a comfort: the rules that would re-derive them are the ones being changed.
   * `--undo <file>` replays this snapshot verbatim.
   */
  /**
   * ⚠️ PER ROW, ONLY THE COLUMNS THAT ROW ACTUALLY CHANGES. Snapshotting all four for every change
   * makes `--undo` a whole-table rewind: a row whose shelf moved would also have its `brandSlug`
   * restored, undoing the `--host-brands` pass that ran after it. agy caught the cross-pass clobber
   * on the diff review — the same defect the host-brands snapshot had already been fixed for.
   */
  const snapshot = changes.map((c) => {
    const row = rows.find((r) => r.id === c.id)!
    return {
      id: c.id,
      ...(c.shelf ? { subcategorySlug: row.subcategorySlug } : {}),
      ...(c.model ? { model: row.model, attributes: row.attributes } : {}),
      ...(c.brandTo ? { brandSlug: row.brandSlug } : {}),
    }
  })
  // ⚠️ THE PID KEEPS TWO RUNS APART. Keyed on the row count alone, a second run that converged on
  // the same number silently overwrote the only rollback file for the first (opus).
  const snapPath = arg('snapshot') ?? `/tmp/fix-accessory-taxonomy-${snapshot.length}-${process.pid}.json`
  writeFileSync(snapPath, JSON.stringify(snapshot))
  console.log(`\nbefore-values written to ${snapPath}`)

  let written = 0
  for (const c of changes) {
    const row = rows.find((r) => r.id === c.id)!
    // `attributes` is a String column holding serialized JSON (the same shape the wizard writes and
    // `feed-query.ts` substring-matches); parse defensively — a malformed blob must not lose a row.
    /**
     * ⛔ A ROW WHOSE ATTRIBUTES CANNOT BE READ IS SKIPPED, NOT RESET. The first version fell back to
     * `{}` on a parse failure and then wrote that back — erasing every attribute the row had to
     * record one compatibility value. JSON `null` and arrays were worse: the assignment threw or was
     * dropped by `JSON.stringify`, and `model` was cleared with nothing saved (astra). An existing
     * `compatibleWith` is kept, because a human or the partner API put it there first.
     */
    let attrs: Record<string, unknown> = {}
    if (row.attributes) {
      let parsed: unknown
      try { parsed = JSON.parse(row.attributes) } catch { parsed = undefined }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        console.log(`  ⚠️ skipped ${c.id}: attributes are not a JSON object`)
        continue
      }
      attrs = parsed as Record<string, unknown>
    }
    const existing = attrs.compatibleWith
    const hasCompat = typeof existing === 'string' ? existing.trim() !== '' : existing != null
    if (c.model && !hasCompat) attrs.compatibleWith = c.model
    await db.listing.update({
      /**
       * ⚠️ `select` IS NOT OPTIONAL HERE. Prisma's default RETURNING lists every scalar in the
       * SCHEMA, and the schema can be ahead of the database — on 2026-09-17 a parallel branch added
       * `Listing.facetTokens` whose DDL had not been applied yet, and every update in this script
       * died with `P2022 … column does not exist` while every read kept working. Naming one column
       * back makes the write depend on the columns it writes, not on the whole model.
       */
      select: { id: true },
      where: { id: c.id },
      data: {
        ...(c.shelf ? { subcategorySlug: c.to } : {}),
        ...(c.model ? { model: null, attributes: JSON.stringify(attrs) } : {}),
        ...(c.brandTo ? { brandSlug: c.brandTo } : {}),
      },
    })
    written++
    if (written % 200 === 0) console.log(`  … ${written}/${changes.length}`)
  }
  console.log(`\nwrote ${written} rows.`)
  console.log('⚠️ Browse pages are ISR-cached — run scripts/purge-isr-listings.mjs (needs ENO_ISR_PG=1) or wait out the window.')
  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
