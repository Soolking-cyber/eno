/**
 * Hide imported reference listings that have no photo.
 * Owner, 2026-09-22: "MANY PROPERTIES DONT HAVE IMAGES FIX IT".
 *
 * ⛔ WHY HIDE RATHER THAN FETCH: THE PHOTOS DO NOT EXIST TO FETCH. Of the 4,184 Batdongsan rows
 * still without an image, 2,122 have NOTHING in the scrape — no local file and no remote url — and
 * the rest had only 200x200 agent avatars, which are photographs of real people and are refused on
 * purpose (see attach-batdongsan-photos.ts). Batdongsan's own pages are behind a Cloudflare
 * interstitial, so nothing can be re-fetched automatically either. A re-scrape is the only way to
 * close the gap; until then a card with no photo is the honest state, and it should not be
 * interleaved through a grid of real ones.
 *
 * ⚠️ HIDDEN, NOT DELETED, AND THE DIFFERENCE MATTERS. `status: 'hidden'` removes them from every
 * public surface (`feed-query` pins `status: 'active'`) while keeping the row, its externalId and
 * its coordinates. When a richer scrape lands, attach-batdongsan-photos.ts fills the images and
 * `--restore` here puts them straight back — nothing is re-imported and no id changes.
 * ⚠️ THE COST IS REAL: district counts and map pins lose these rows while they are hidden. Gò Vấp
 * and the other districts this import unblocked will read lower.
 *
 * Run:
 *   set -a; . ./.env; set +a; npx tsx scripts/hide-imageless-imports.ts [--apply]
 *   …                                                                  --restore [--apply]
 */
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
// Every seller whose rows are imported reference listings, pinned by id. ⚠️ THE LIST LIVES IN ONE
// MODULE NOW: it was a literal here, and the nhatot, muaban and honeycomb importers all shipped
// seller ids it did not carry. src/lib/import-sellers.test.ts fails when an importer's id is missing.
import { IMPORT_SELLERS } from '../src/lib/import-sellers'

const APPLY = process.argv.includes('--apply')
const RESTORE = process.argv.includes('--restore')

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL }),
  log: ['warn', 'error'],
})

async function main() {
  const base = { sellerId: { in: [...IMPORT_SELLERS] } }
  /** `images` is a TEXT column holding a JSON array; '[]' and '' are both "no photo". */
  const imageless = { OR: [{ images: '[]' }, { images: '' }] }

  /**
   * ⛔ RESTORE ONLY WHAT THIS SCRIPT HID. Matching every `status:'hidden'` row for these sellers
   * would also un-hide a Rever row the retire pass hid because the property was let, and any row a
   * moderator held — republishing a dead outbound link or a decision a human made. The marker is
   * the row's own state: it was hidden BY US only if it is still imageless, so `--restore` targets
   * rows that now HAVE a photo, which only this pipeline can have given them.
   * ⚠️ A moderator-hidden row that later gains a photo would also come back. That is the residual
   * gap; closing it properly needs a `hiddenBy` marker, which is a schema change.
   */
  if (RESTORE) {
    const n = await db.listing.count({ where: { ...base, status: 'hidden', NOT: imageless } })
    console.log(`  hidden rows that NOW have a photo: ${n}`)
    if (!APPLY) { console.log('\n  DRY RUN — re-run with --apply to restore them.'); await db.$disconnect(); return }
    const r = await db.listing.updateMany({ where: { ...base, status: 'hidden', NOT: imageless }, data: { status: 'active' } })
    console.log(`  restored ${r.count}`)
    await db.$disconnect(); return
  }

  const total = await db.listing.count({ where: base })
  const target = await db.listing.count({ where: { ...base, status: 'active', ...imageless } })
  const keep = await db.listing.count({ where: { ...base, status: 'active', NOT: imageless } })
  console.log(`  imported listings        ${total}`)
  console.log(`  active WITH a photo      ${keep}`)
  console.log(`  active WITHOUT a photo   ${target}   <- to hide`)
  console.log(`  mode                     ${APPLY ? 'APPLY — WRITES TO PRODUCTION' : 'DRY RUN'}`)

  if (!APPLY) { console.log('\n  DRY RUN — nothing written. Re-run with --apply.'); await db.$disconnect(); return }
  const r = await db.listing.updateMany({ where: { ...base, status: 'active', ...imageless }, data: { status: 'hidden' } })
  const left = await db.listing.count({ where: { ...base, status: 'active' } })
  console.log(`\n  hidden ${r.count}   still live: ${left}`)
  console.log(`\nROLLBACK — ⚠️ BLUNT: un-hides EVERY hidden row for these sellers, including ones the`)
  console.log(`  Rever retire pass or a moderator hid. Prefer \`--restore\`, which only brings back rows`)
  console.log(`  that now have a photo:`)
  console.log(`  UPDATE "Listing" SET status='active' WHERE "sellerId" IN ('${IMPORT_SELLERS.join("','")}') AND status='hidden';`)
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
