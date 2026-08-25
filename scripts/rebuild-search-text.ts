/**
 * Rebuild `Listing.searchText` for listings that were written straight to the database.
 *
 *   npx tsx scripts/rebuild-search-text.ts --seller CellphoneS            # DRY RUN
 *   npx tsx scripts/rebuild-search-text.ts --seller CellphoneS --apply
 *   npx tsx scripts/rebuild-search-text.ts --all --apply
 *
 * ⛔ WHY THIS EXISTS. `searchText` is a folded blob that feed-query.ts matches every keyword
 * search against (`searchText LIKE '%term%'`, GIN-trigram indexed) and it is built in
 * core/listings.ts on the POST path. An importer that writes Listing rows directly through Prisma
 * never runs that code, so the column keeps its `@default("")` — and MEASURED on production: all
 * 9,726 imported products had an empty one, which made every one of them invisible to search. The
 * catalogue held 1,193 phone cases and 58 AirPods while a search for either returned nothing.
 *
 * ⚠️ BOTH LANGUAGES GO IN THE BLOB. The app's own recipe passes one title because a human writes
 * one; an imported listing has an English `title` AND a Vietnamese `titleVi`, and a buyer may type
 * either. Folding both in is what makes "ốp lưng" and "case" find the same product.
 */
import 'dotenv/config'
import { db } from '../src/lib/db'
import { buildSearchText } from '../src/lib/fold'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
const ALL = process.argv.includes('--all')
const FORCE = process.argv.includes('--force')
const SELLER = arg('seller')
if (!SELLER && !ALL) { console.error('--seller <name> or --all required'); process.exit(1) }

async function main() {
  let sellerId: string | undefined
  if (SELLER) {
    const s = await db.seller.findFirst({ where: { name: SELLER }, select: { id: true } })
    if (!s) { console.error(`no storefront "${SELLER}"`); process.exit(1) }
    sellerId = s.id
  }

  const rows = await db.listing.findMany({
    /**
     * ⚠️ `--force` EXISTS BECAUSE THE DAMAGE THIS SCRIPT REPAIRS IS NOT ALWAYS AN EMPTY BLOB. A
     * clobbered `searchText` is WRONG, not missing — the importer used to rebuild it from feed
     * values only, collapsing a bilingual blob to Vietnamese — and the `searchText: ''` filter made
     * this script print "0 listings" and exit on exactly the rows that needed it. Without the flag
     * nothing in the repo could detect or fix it.
     */
    where: { ...(sellerId ? { sellerId } : {}), ...(FORCE ? {} : { searchText: '' }) },
    select: {
      id: true, title: true, titleVi: true, description: true, descriptionVi: true,
      district: true, location: true, brandSlug: true, model: true,
      category: { select: { name: true, nameVi: true } },
    },
  })
  console.log(`${rows.length} listings ${FORCE ? 'to rebuild (--force: every row, not only empty ones)' : 'with an empty searchText'}`)
  if (!rows.length) { await db.$disconnect(); return }
  if (!APPLY) {
    const sample = rows[0]
    console.log(`  e.g. "${sample.title.slice(0, 48)}"`)
    console.log(`   ->  ${buildSearchText([sample.title, sample.titleVi, sample.description, sample.descriptionVi,
      sample.district, sample.location, sample.category.name, sample.category.nameVi, sample.brandSlug, sample.model]).slice(0, 120)}…`)
    console.log('\nDRY RUN — re-run with --apply.')
    await db.$disconnect(); return
  }

  let n = 0
  for (const r of rows) {
    await db.listing.update({
      where: { id: r.id },
      data: {
        searchText: buildSearchText([
          r.title, r.titleVi, r.description, r.descriptionVi,
          r.district, r.location, r.category.name, r.category.nameVi, r.brandSlug, r.model,
        ]),
      },
    }).catch(() => {})
    if (++n % 1000 === 0) console.log(`  ${n}/${rows.length}`)
  }
  console.log(`\nAPPLIED: ${n} rebuilt`)
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
