/**
 * Re-file imported listings using the MERCHANT'S OWN category path.
 *
 *   npx tsx scripts/classify-by-breadcrumb.ts            # DRY RUN
 *   npx tsx scripts/classify-by-breadcrumb.ts --apply
 *
 * Reads data/cellphones-breadcrumbs.jsonl (produced by the product-page crawl) and moves each
 * listing to the category/subcategory the retailer itself files it under. See merchant-taxonomy.ts
 * for why that beats classifying from the title.
 *
 * ⛔ SNAPSHOT FIRST, AND IT WRITES ONLY THE TWO PLACEMENT COLUMNS. Nothing else on the row is
 * touched — not the title, not the price, not the attributes, not the description.
 * ⚠️ Attributes are DELETED when the subcategory changes, because a spec is only meaningful under
 * the subcategory that offers it: a MacBook re-filed from cables-chargers to laptops-pcs must lose
 * its `wattage` and `compatibleWith`, and re-running enrich-electronics.ts afterwards will give it
 * the laptop specs it should have had. Leaving them would keep a laptop advertising itself as a
 * 30W accessory that fits a MacBook.
 */
import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import { db } from '../src/lib/db'
import { existsSync } from 'node:fs'
import { placementForCrumbs, placementFromTitle } from '../src/lib/merchant-taxonomy'

const APPLY = process.argv.includes('--apply')
const FILE = 'data/cellphones-breadcrumbs.jsonl'

async function main() {
  // ⚠️ The crawl output is gitignored operational data, not source — a fresh checkout has no copy.
  // Say that, rather than dying on ENOENT and reading as a broken script.
  if (!existsSync(FILE)) {
    console.error(`${FILE} is missing. It is produced by the product-page crawl and is deliberately`)
    console.error('gitignored (local operational data, not source). Run the crawl before this script.')
    process.exit(1)
  }
  const crumbsById = new Map<string, string[]>()
  for (const line of readFileSync(FILE, 'utf8').trim().split('\n')) {
    try { const o = JSON.parse(line); if (o.externalId && Array.isArray(o.crumbs)) crumbsById.set(String(o.externalId), o.crumbs) } catch {}
  }
  console.log(`${crumbsById.size} products have a merchant breadcrumb\n`)

  const cats = await db.category.findMany({ select: { id: true, slug: true } })
  const catId = new Map(cats.map((c) => [c.slug, c.id]))

  const rows = await db.listing.findMany({
    // ⛔ `ownerId: null`. `Seller.name` IS NOT UNIQUE — anyone can open a storefront called
    // "CellphoneS". A storefront with an owner belongs to a real person, and this script rewrites
    // placement and attributes in bulk; the importer refuses owned storefronts for the same reason.
    where: { seller: { name: 'CellphoneS', ownerId: null }, externalId: { not: null } },
    select: { id: true, externalId: true, title: true, categoryId: true, subcategorySlug: true, attributes: true },
  })

  const moves: { id: string; categoryId: string; subcategorySlug: string | null; clearAttrs: boolean; from: string; to: string; title: string }[] = []
  let noCrumb = 0, noRule = 0, already = 0
  const slugOf = new Map(cats.map((c) => [c.id, c.slug]))

  for (const r of rows) {
    const from0 = `${slugOf.get(r.categoryId) ?? '?'}/${r.subcategorySlug ?? '—'}`
    const crumbs = crumbsById.get(r.externalId!)
    /**
     * ⚠️ THE TITLE OVERRIDE RUNS EVEN WITHOUT A BREADCRUMB. 4,000+ rows are still uncrawled, and
     * one misfiling is bad enough to fix from the name alone: an Apple Watch is sold as
     * "… 40mm (5G) Aluminum Case Rubber Band", so the word "Case" put watches in the Cases &
     * covers aisle. See placementFromTitle for why it is deliberately narrow.
     */
    const byTitle = placementFromTitle(r.title, { category: from0.split('/')[0], subcategory: r.subcategorySlug })
    const place = crumbs ? placementForCrumbs(crumbs) ?? byTitle : byTitle
    if (!crumbs && !byTitle) { noCrumb++; continue }
    if (!place) { noRule++; continue }
    const targetCat = catId.get(place.category)
    if (!targetCat) { noRule++; continue }
    const from = `${slugOf.get(r.categoryId) ?? '?'}/${r.subcategorySlug ?? '—'}`
    const to = `${place.category}/${place.subcategory ?? '—'}`
    if (from === to) { already++; continue }
    moves.push({
      id: r.id, categoryId: targetCat, subcategorySlug: place.subcategory, title: r.title,
      /*
       * ⛔ ANY PLACEMENT CHANGE CLEARS THE SPECS, not just a subcategory change. Keying on
       * `subcategorySlug !== place.subcategory` alone got both edges wrong: moving an
       * unclassified row (null) INTO a subcategory needlessly wiped attributes, and moving one
       * into `services` — whose subcategory is also null — compared `null !== null`, kept the
       * stale electronics specs, and left 30 AppleCare plans advertising a wattage.
       * Re-running enrich-electronics.ts afterwards restores whatever the new placement supports.
       */
      clearAttrs: (from !== to) && !!r.attributes,
      from, to,
    })
  }

  console.log(`${rows.length} listings · ${already} already correct · ${noCrumb} not yet crawled · ${noRule} no rule`)
  console.log(`${moves.length} would move\n`)
  const tally = new Map<string, number>()
  for (const m of moves) tally.set(`${m.from}  ->  ${m.to}`, (tally.get(`${m.from}  ->  ${m.to}`) ?? 0) + 1)
  console.table([...tally].sort((a, b) => b[1] - a[1]).slice(0, 22).map(([move, n]) => ({ move, n })))

  if (!APPLY) { console.log('DRY RUN — nothing written.'); await db.$disconnect(); return }

  const snap = `data/reclassify-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`
  writeFileSync(snap, rows.filter((r) => moves.some((m) => m.id === r.id))
    .map((r) => JSON.stringify({ id: r.id, categoryId: r.categoryId, subcategorySlug: r.subcategorySlug, attributes: r.attributes })).join('\n'))
  console.log(`snapshot: ${snap}`)

  for (let i = 0; i < moves.length; i += 200) {
    await Promise.all(moves.slice(i, i + 200).map((m) => db.listing.update({
      where: { id: m.id },
      data: { categoryId: m.categoryId, subcategorySlug: m.subcategorySlug, ...(m.clearAttrs ? { attributes: null } : {}) },
    })))
    if (i % 1000 === 0) console.log(`  ${Math.min(i + 200, moves.length)}/${moves.length}`)
  }
  console.log(`\nAPPLIED: ${moves.length} listings re-filed`)
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
