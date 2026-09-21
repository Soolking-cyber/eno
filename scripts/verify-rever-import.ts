/**
 * Read-only check on the Rever reference-listing import.
 *
 * ⛔ THE THREE INVARIANTS ARE ASSERTED HERE, NOT ASSUMED. Each has a silent failure mode:
 * a missing `affiliateUrl` turns an un-owned row into one buyers can message into a void;
 * `negotiable: true` (the schema DEFAULT, so it is what you get by forgetting) shows an offer UI
 * whose POST the server 409s, docking the buyer's trust; and any `listingType` other than 'rent'
 * drops the row into `feedListingTypes()` and ships it to the Meta catalogue.
 *
 * Run: set -a; . ./.env; set +a; npx tsx scripts/verify-rever-import.ts
 */
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL }),
  log: ['warn', 'error'],
})

/** ⛔ PINNED BY ID. `Seller.name` is not unique and is user-settable, so selecting by name could
 *  read (or vouch for) a real person's shop. Must match SELLER_ID in import-rever-rentals.ts. */
const SELLER_ID = 'cmub0wead0000zrq418bqq27m'

async function main() {
  const where = { sellerId: SELLER_ID }
  const total = await db.listing.count({ where })
  const active = await db.listing.count({ where: { ...where, status: 'active' } })
  console.log(`  rever rows            ${total}  (active ${active}, retired ${total - active})`)

  /**
   * ⛔ EVERY CHECK BELOW IS A COUNT OF BAD ROWS, SO ZERO ROWS SCORES A PERFECT PASS. Point this at
   * a seller id that does not exist, or one whose listings were deleted, and it prints "ok" six
   * times and exits 0 — the classic vacuous guard. Assert the subject exists first.
   */
  const sellerRow = await db.seller.findUnique({ where: { id: SELLER_ID }, select: { name: true } })
  let vacuous: string | null = null
  if (!sellerRow) vacuous = `seller ${SELLER_ID} does not exist`
  else if (sellerRow.name !== 'Rever.vn') vacuous = `seller ${SELLER_ID} is named "${sellerRow.name}", not "Rever.vn"`
  else if (total === 0) vacuous = `seller ${SELLER_ID} has no listings — nothing to verify`
  if (vacuous) {
    console.error(`  PRECONDITION FAILED: ${vacuous}`)
    await db.$disconnect()
    process.exitCode = 1
    return
  }

  const noAffiliate = await db.listing.count({ where: { ...where, affiliateUrl: null } })
  const negotiable = await db.listing.count({ where: { ...where, negotiable: true } })
  const notRent = await db.listing.count({ where: { ...where, listingType: { not: 'rent' } } })
  /**
   * ⛔ THIS ASSERTION WAS BACKWARDS AND IT PASSED WHILE THE SITE SHOWED "0 listings".
   * `verified` is the PUBLICATION GATE (`feed-query.ts` pins `verifiedFilter = true` for every
   * public caller), so `false` means invisible, not "modestly unbadged". The check must be that
   * NONE are held back. The trust signal that must stay false is `Seller.verified`, checked below.
   */
  const held = await db.listing.count({ where: { ...where, status: 'active', verified: false } })
  const sellerVerified = await db.seller.count({ where: { id: SELLER_ID, OR: [{ verified: true }, { verifiedSeller: true }, { officialPartner: true }] } })
  /** ⚠️ An owned seller means a real person receives these enquiries and can edit the rows. */
  const owned = await db.seller.count({ where: { id: SELLER_ID, ownerId: { not: null } } })
  console.log(`  missing affiliateUrl  ${noAffiliate}   ${noAffiliate ? 'FAIL' : 'ok'}`)
  console.log(`  negotiable=true       ${negotiable}   ${negotiable ? 'FAIL' : 'ok'}`)
  console.log(`  listingType != rent   ${notRent}   ${notRent ? 'FAIL' : 'ok'}`)
  /**
   * ⛔ A FEW HELD ROWS ARE MODERATION WORKING; ALL OF THEM HELD IS THE BUG THIS CHECK EXISTS FOR.
   * The importer leaves `verified` create-only precisely so a moderator can hold a row, so failing
   * on `held > 0` would make this script go red every time moderation did its job — a reviewer
   * caught that my two changes contradicted each other. The failure worth catching is the one that
   * actually happened: EVERY row held, so the category renders empty while the data looks fine.
   */
  /** ⚠️ `held === active` let 1,099 of 1,100 held slip through as "not a failure" — a reviewer's
   *  edge case. A supermajority held is the same outage as all of them. */
  const allHeld = active > 0 && held >= active * 0.9
  console.log(`  held (verified=false) ${held}${allHeld ? '   FAIL — ALL rows held, category renders empty' : held ? '   (moderator holds — not a failure)' : '   ok'}`)
  console.log(`  seller badged         ${sellerVerified}   ${sellerVerified ? 'FAIL — implies we vetted them' : 'ok'}`)
  console.log(`  seller has an owner   ${owned}   ${owned ? 'FAIL — a real person receives these enquiries' : 'ok'}`)

  /**
   * ⛔ THE EXIT CODE IS THE POINT — printing "FAIL" and exiting 0 is a check that cannot fail.
   * A reviewer caught that every invariant below could be violated and any pipeline running this
   * would still report success. `failures` is tallied and surfaced as the exit status.
   */
  const failures = noAffiliate + negotiable + notRent + (allHeld ? held : 0) + sellerVerified + owned

  const dupes = await db.listing.groupBy({
    by: ['externalId'], where, _count: { externalId: true },
    having: { externalId: { _count: { gt: 1 } } },
  })
  console.log(`  duplicate externalIds ${dupes.length}   ${dupes.length ? 'FAIL' : 'ok'}`)

  const s = await db.listing.findFirst({
    where,
    select: {
      title: true, titleVi: true, price: true, district: true, city: true,
      subcategorySlug: true, areaM2: true, attributes: true, affiliateUrl: true,
      images: true, lat: true, lng: true, status: true, searchText: true,
    },
  })
  if (s) {
    const imgs = JSON.parse(s.images) as string[]
    console.log('\n  ── one row as stored ──')
    console.log(`  title        ${s.title}`)
    console.log(`  titleVi      ${s.titleVi}`)
    console.log(`  price        ${s.price}  ${s.district}, ${s.city}`)
    console.log(`  subcategory  ${s.subcategorySlug}   areaM2 ${s.areaM2}   attrs ${s.attributes}`)
    console.log(`  coords       ${s.lat}, ${s.lng}`)
    console.log(`  affiliateUrl ${s.affiliateUrl}`)
    console.log(`  images       ${imgs.length}  ${imgs[0]?.slice(0, 60)}…`)
    console.log(`  searchText   ${s.searchText.slice(0, 90)}…`)
  }
  await db.$disconnect()
  const total_failures = failures + dupes.length
  if (total_failures) {
    console.error(`\n  ${total_failures} INVARIANT FAILURE(S) — exiting non-zero`)
    process.exitCode = 1
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
