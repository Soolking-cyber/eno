/**
 * Create or update the VinWonders partner storefront and its attraction-ticket listings.
 *
 *   npx tsx scripts/seed-vinwonders.ts            # DRY RUN — reports, writes nothing
 *   npx tsx scripts/seed-vinwonders.ts --apply    # performs the writes
 *
 * ⛔ IT SKIPS ANY DESTINATION MISSING affiliateUrl, priceFromVnd OR images, AND SAYS SO. A listing
 * with no link is a dead end, a listing with no price cannot satisfy Product/Offer structured data
 * (Google drops the rich result), and the publish gate requires photos. Publishing a placeholder
 * would put a broken product page in the sitemap and in the Merchant feed, which is worse than
 * publishing nothing — so incompleteness is reported, never rendered.
 *
 * ⚠️ PRICE IS "FROM", IN VND, ALWAYS. The partner sets and changes the real price at checkout, so
 * this is a starting point, and displaying a price in USD is sanctionable under ND 340/2025.
 *
 * ⚠️ IDEMPOTENT BY (sellerId, title) — NOT by an id column, and the difference matters. There is no
 * unique constraint behind it, so RENAMING a destination in the JSON makes the next run create a
 * second listing rather than update the first. Rename deliberately, or delete the old row.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { db } from '../src/lib/db'

async function main() {
  const APPLY = process.argv.includes('--apply')
  const data = JSON.parse(readFileSync(new URL('../data/vinwonders-destinations.json', import.meta.url), 'utf8'))
  const { partner, destinations } = data


  // The category every one of these belongs in. It already exists — attraction tickets are not a new
  // taxonomy, and inventing one would fragment the browse rails for 19 listings.
  const CATEGORY_SLUG = 'tickets-travel'

  /**
   * ⛔ A PRICE OF 0 IS NOT "UNKNOWN" ON THIS SITE — IT IS "FREE". src/components/marketplace/price.tsx
   * renders `price === 0` as "Free / Miễn phí" in 3xl bold, deliberately, for the trip-planning
   * service that genuinely costs nothing. Seeding an attraction ticket at 0 would therefore
   * advertise free entry to VinWonders on 17 product pages. So a missing price BLOCKS the listing
   * rather than defaulting; there is no safe placeholder.
   */
  const priceOk = (d: { priceFromVnd?: number | null }) => typeof d.priceFromVnd === 'number' && d.priceFromVnd > 0
  const ready = destinations.filter((d) => d.affiliateUrl && priceOk(d) && d.images?.length)
  const blocked = destinations.filter((d) => !(d.affiliateUrl && priceOk(d) && d.images?.length))

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${ready.length} ready, ${blocked.length} incomplete\n`)
  for (const d of blocked) {
    const why = [
      !d.affiliateUrl ? 'affiliateUrl' : null,
      !priceOk(d) ? (d.priceFromVnd === 0 ? 'priceFromVnd (0 renders as "Free")' : 'priceFromVnd') : null,
      !d.images?.length ? 'images' : null,
    ].filter(Boolean).join(', ')
    console.log(`  skip  ${d.slug.padEnd(30)} missing: ${why}`)
  }
  if (ready.length) {
    console.log('')
    for (const d of ready) console.log(`  ready ${d.slug.padEnd(30)} ${d.priceFromVnd.toLocaleString('vi-VN')} đ`)
  }

  const category = await db.category.findUnique({ where: { slug: CATEGORY_SLUG }, select: { id: true, name: true } })
  if (!category) {
    console.error(`\nCategory "${CATEGORY_SLUG}" not found — refusing to guess a different one.`)
    await db.$disconnect()
    process.exit(1)
  }
  console.log(`\nCategory: ${category.name} (${CATEGORY_SLUG})`)

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply once the blocked entries above are filled in.')
    await db.$disconnect()
    process.exit(0)
  }

  if (!ready.length) {
    console.error('\nNothing is ready to publish — refusing to create an empty storefront.')
    await db.$disconnect()
    process.exit(1)
  }

  // ── the partner storefront ─────────────────────────────────────────────────────────────────────
  // ⚠️ ownerId stays NULL. Seller.ownerId is @unique and a partner storefront has no eno account
  // behind it; binding it to a real Profile would consume that person's one-storefront slot.
  // ⚠️ FIND-THEN-WRITE, NOT upsert(). `Seller.name` is not a unique column — only id, ownerId and
  // phone are — so `upsert({ where: { name } })` does not typecheck and, more importantly, there is
  // nothing at the database level stopping a second "VinWonders" row. Matching on name explicitly
  // and refusing when it is ambiguous keeps a re-run from quietly creating a duplicate storefront
  // with its own 19 listings.
  const existingSellers = await db.seller.findMany({
    where: { name: partner.name },
    select: { id: true, name: true, ownerId: true },
  })
  /**
   * ⛔ A STOREFRONT WITH AN OWNER IS SOMEBODY'S ACCOUNT, NOT OUR PARTNER. Matching on name alone
   * means anyone who registers a shop called "VinWonders" would be silently adopted here — and
   * this script then stamps officialPartner=true on it and hangs 19 listings off it. Refuse and
   * make a human look, rather than promote an impersonator to verified partner.
   */
  const owned = existingSellers.find((x) => x.ownerId)
  if (owned) {
    console.error(`\nA seller named "${partner.name}" already exists and is OWNED by a user account (${owned.id}).`)
    console.error('Refusing to promote it to official partner. Investigate before re-running.')
    await db.$disconnect()
    process.exit(1)
  }
  if (existingSellers.length > 1) {
    console.error(`\n${existingSellers.length} sellers already named "${partner.name}" — refusing to guess which one is the partner.`)
    await db.$disconnect()
    process.exit(1)
  }
  /**
   * ⛔ THE OPTIMISTIC DEFAULTS ARE OVERRIDDEN ON PURPOSE. Seller defaults to `rating 5`,
   * `responseRate 100` and `trustScore 100` — numbers that mean "measured and excellent" to a
   * buyer. A brand-new partner storefront has no reviews, no replies and no history, so shipping
   * those defaults would put a fabricated 5-star rating on 19 product pages. The schema itself
   * calls responseRate=100 "the fabricated default". Start at zero and let the real signals arrive.
   */
  const partnerFields = {
    officialPartner: true,
    rating: 0,
    reviewCount: 0,
    affiliateDiscountCode: partner.discountCode,
    affiliateDiscountPercent: partner.discountPercent,
    bio: partner.about,
  }
  const seller = existingSellers[0]
    ? await db.seller.update({ where: { id: existingSellers[0].id }, data: partnerFields, select: { id: true, name: true } })
    : await db.seller.create({ data: { name: partner.name, ...partnerFields }, select: { id: true, name: true } })

  console.log(`\nPartner storefront: ${seller.name} (${seller.id})`)

  let created = 0
  let updated = 0
  for (const d of ready) {
    const existing = await db.listing.findFirst({
      where: { sellerId: seller.id, title: d.name },
      select: { id: true },
    })
    const payload = {
      title: d.name,
      description: d.description ?? `${d.name} — book tickets on ${partner.name}. Entry is scanned from the ticket issued at checkout.`,
      price: d.priceFromVnd,
      priceUnit: 'VND',
      currency: '₫',
      location: d.location,
      city: d.city,
      images: JSON.stringify(d.images),
      categoryId: category.id,
      sellerId: seller.id,
      affiliateUrl: d.affiliateUrl,
      verified: true,
      status: 'active',
    }
    if (existing) {
      await db.listing.update({ where: { id: existing.id }, data: payload })
      updated++
    } else {
      await db.listing.create({ data: payload })
      created++
    }
  }
  console.log(`Listings: ${created} created, ${updated} updated.`)
  await db.$disconnect()

}

main().catch((e) => { console.error(e); process.exit(1) })