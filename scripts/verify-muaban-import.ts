/**
 * Read-only check on the muaban.net reference-listing import (scripts/import-muaban-net.ts).
 * verify-rever-import.ts parametrised for this seller, plus what this source adds: the outbound host
 * and listing pin, photos that are OURS (overlay URLs, never a cloud.muaban.net hotlink), in-country
 * coordinates, an outbound URL that links BY ID (never the poster's title slug, which carries house
 * numbers and phones), the app's rent unit, the ONE vn-units spelling of each city ('Hồ Chí Minh'),
 * no house/street number in `location`, and a postedAt that is the source's date (never later than
 * the row's own creation).
 *
 * Run: set -a; . ./.env; set +a; npx tsx scripts/verify-muaban-import.ts
 * ⛔ THE EXIT STATUS IS THE VERDICT: non-zero on a failed precondition OR any invariant failure.
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { isOverlayImageUrl } from '../src/lib/image-mark-url'
import {
  CITIES, EXTERNAL_PREFIX, RENT_PRICE_UNIT, SELLER_ID, SELLER_NAME, affiliateUrlFor, locationIsSafe, postedAtProblem, sellerRefusal,
} from './muaban-net-map'

/** Read-only AT THE DATABASE, whatever the caller's environment says. */
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL, options: '-c default_transaction_read_only=on' }),
  log: ['warn', 'error'],
})

async function main() {
  const where = { sellerId: SELLER_ID }
  const total = await db.listing.count({ where })
  const active = await db.listing.count({ where: { ...where, status: 'active' } })
  console.log(`  muaban rows           ${total}  (active ${active}, hidden/other ${total - active})`)

  /** ⛔ Every check below counts BAD rows, so zero rows would pass them all. Assert the subject. */
  const seller = await db.seller.findUnique({
    where: { id: SELLER_ID },
    select: { name: true, ownerId: true, verified: true, verifiedSeller: true, officialPartner: true, avatarUrl: true },
  })
  let vacuous: string | null = null
  if (!seller) vacuous = `seller ${SELLER_ID} does not exist`
  else if (seller.name !== SELLER_NAME) vacuous = `seller ${SELLER_ID} is named "${seller.name}", not "${SELLER_NAME}"`
  else if (total === 0) vacuous = `seller ${SELLER_ID} has no listings — nothing to verify`
  if (vacuous || !seller) {
    console.error(`  PRECONDITION FAILED: ${vacuous}`)
    await db.$disconnect()
    process.exitCode = 1
    return
  }

  const noAffiliate = await db.listing.count({ where: { ...where, affiliateUrl: null } })
  const negotiable = await db.listing.count({ where: { ...where, negotiable: true } })
  const notRent = await db.listing.count({ where: { ...where, listingType: { not: 'rent' } } })
  /** `verified` is the PUBLICATION GATE: a few held rows are moderation, ≥90% held is an outage. */
  const held = await db.listing.count({ where: { ...where, status: 'active', verified: false } })
  const allHeld = active > 0 && held >= active * 0.9
  const badged = seller.verified || seller.verifiedSeller || seller.officialPartner ? 1 : 0
  const owned = seller.ownerId ? 1 : 0
  /** The importer's own refusal rule, so verify and --apply can never disagree about the seller. */
  const refusal = sellerRefusal(seller)
  const zeroRank = await db.listing.count({ where: { ...where, status: 'active', rankScore: 0 } })

  /** Row-level checks the column filters cannot express. */
  const rows = await db.listing.findMany({
    where,
    select: {
      externalId: true, affiliateUrl: true, images: true, lat: true, lng: true, status: true, priceUnit: true, city: true, location: true,
      district: true, postedAt: true, createdAt: true,
    },
  })
  /** `city` must be exactly one of the vn-units Vietnamese names — the one spelling per city every
   *  other row uses ('Hồ Chí Minh'), never the English 'Ho Chi Minh' a first cut stored. */
  const cityNames = new Set(Object.values(CITIES).map((c) => c.city))
  let badTarget = 0, badImages = 0, noImagesActive = 0, badCoords = 0, badExternal = 0
  let badUnit = 0, badCity = 0, unsafeLocation = 0, thuDucSpelling = 0, badPostedAt = 0
  for (const r of rows) {
    if (r.priceUnit !== RENT_PRICE_UNIT) badUnit++
    if (!cityNames.has(r.city ?? '')) badCity++
    else if (!r.location || !locationIsSafe(r.location, r.city!)) unsafeLocation++
    if (postedAtProblem(r.postedAt, r.createdAt)) badPostedAt++
    /** One stored form for Thủ Đức ('TP. Thủ Đức'), never muaban's 'TP. Thủ Đức - Quận 9'. */
    if (r.district && /Thủ Đức/.test(r.district) && r.district !== 'TP. Thủ Đức') thuDucSpelling++
    const id = String(r.externalId ?? '').replace(new RegExp(`^${EXTERNAL_PREFIX}:`), '')
    if (!/^\d+$/.test(id) || r.externalId !== `${EXTERNAL_PREFIX}:${id}`) badExternal++
    if (!r.affiliateUrl || affiliateUrlFor(id, r.affiliateUrl) !== r.affiliateUrl) badTarget++
    let imgs: unknown = []
    try { imgs = JSON.parse(r.images || '[]') } catch { imgs = null }
    if (!Array.isArray(imgs) || imgs.some((u) => typeof u !== 'string' || !isOverlayImageUrl(u))) badImages++
    else if (!imgs.length && r.status === 'active') noImagesActive++
    const hasLat = r.lat !== null, hasLng = r.lng !== null
    if (hasLat !== hasLng || (hasLat && !(r.lat! >= 8 && r.lat! <= 24 && r.lng! >= 102 && r.lng! <= 110))) badCoords++
  }
  const dupes = await db.listing.groupBy({
    by: ['externalId'], where, _count: { externalId: true },
    having: { externalId: { _count: { gt: 1 } } },
  })

  const line = (label: string, n: number, why = '') => console.log(`  ${label.padEnd(22)}${n}   ${n ? `FAIL${why ? ` — ${why}` : ''}` : 'ok'}`)
  line('missing affiliateUrl', noAffiliate)
  line('affiliateUrl not pinned', badTarget, "not this listing's id-only link on https://muaban.net/bat-dong-san/ (a title slug carries house numbers)")
  line('negotiable=true', negotiable)
  line('listingType != rent', notRent, 'would reach the Meta/Google feeds')
  console.log(`  held (verified=false) ${held}${allHeld ? '   FAIL — ≥90% held, category renders empty' : held ? '   (moderator holds — not a failure)' : '   ok'}`)
  line('seller badged', badged, 'implies we vetted them')
  line('seller has an owner', owned, 'a real person receives these enquiries')
  line('non-overlay images', badImages, 'a hotlink or a burned/foreign URL; the eno.vn mark will not draw')
  line('active without photos', noImagesActive, 'scripts/hide-imageless-imports.ts hides them (this seller is in src/lib/import-sellers.ts)')
  line('coords off-country', badCoords)
  line('bad externalId', badExternal)
  line('duplicate externalIds', dupes.length)
  line('active rankScore = 0', zeroRank, 'dead last until the nightly recompute')
  line(`priceUnit != ${RENT_PRICE_UNIT}`, badUnit, 'cards lose the "/ month" suffix')
  line('city spelling', badCity, `not one of ${[...cityNames].map((c) => `'${c}'`).join(', ')} — a second spelling of the city`)
  line('unsafe location', unsafeLocation, 'a part that is not ward/district/city — a street or house number may be published')
  line('Thủ Đức spelling', thuDucSpelling, "store 'TP. Thủ Đức' only")
  line('postedAt not source', badPostedAt, 'over 5 min later than the row\'s createdAt, or before 2010 — not a clamped muaban publish_at')
  console.log(`  seller refusal        ${refusal ?? 'none'}`)
  console.log(`  seller avatar         ${seller.avatarUrl ? 'set' : 'NONE (set-partner-avatar.ts; never --official)'}`)

  await db.$disconnect()
  const failures = noAffiliate + badTarget + negotiable + notRent + (allHeld ? held : 0) + badged + owned
    + badImages + noImagesActive + badCoords + badExternal + dupes.length + zeroRank
    + badUnit + badCity + unsafeLocation + thuDucSpelling + badPostedAt + (refusal ? 1 : 0)
  if (failures) {
    console.error(`\n  ${failures} INVARIANT FAILURE(S) — exiting non-zero`)
    process.exitCode = 1
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
