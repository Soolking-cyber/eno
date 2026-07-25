#!/usr/bin/env node
// Seed the trip desk's listing — the marketed product AND the chat anchor, deliberately ONE row.
//
// WHY ONE ROW: a Conversation requires a listing (Conversation.listingId is NOT NULL) and the
// table carries @@unique([listingId, buyerProfileId]) — one thread per buyer per listing.
// bindTripThread() looks the thread up by exactly that composite. So if the listing a traveller
// MESSAGES is the same row the assistance flow anchors to, their marketing enquiry and their
// assistance case land in the SAME thread. Two rows would mean two threads and a traveller
// wondering why the quote arrived somewhere else. The row is found by
// externalId='trip-assistance-anchor' (src/lib/trips/dm-thread.ts), which has no status filter,
// so the same marker serves whether the listing is live or hidden.
//
// ⚠️ NOTHING HERE IS RE-IMPLEMENTED. The publish gate, the searchText recipe and the rankScore
// formula are imported from the app, exactly as scripts/seed-visa-shop.mjs does. A seed that
// writes rows the app itself would reject is how a storefront ends up with listings that cannot
// be edited, or that never surface because their search text was built by a different recipe.
//
// ⚠️ THE OWNER IS RESOLVED BY EMAIL, the way the app resolves it. Verified against the live
// database: support@eno.forum HAS a Profile and owns the storefront; support@eno.vn has NO
// Profile row. The .vn address is the visa ADMIN AUTH identity — a different thing — and
// pointing the desk at it reproduces the 2026-07-22 outage where the visa surface went silently
// dead while its products sat published.
//
// Idempotent: upserts on (sellerId, externalId).
//
//   node --env-file=.env scripts/seed-trip-desk.mjs [--dry-run] [--hidden] [--image=<url>]

import { Client } from 'pg'
import { buildSearchText } from '../src/lib/fold.ts'
import { rankScoreExprSql } from '../src/lib/ranking-formula.ts'
// publish-guard is imported LAZILY and may be unavailable: it reaches its neighbours without
// file extensions, which plain Node ESM cannot resolve, so the gate only runs under a TS loader
// (`npx tsx scripts/seed-trip-desk.mjs`). Same handling as seed-visa-shop.mjs:454-465 — the check
// is SKIPPED and said out loud, never faked. Re-implementing the gate here is the drift this repo
// keeps getting bitten by.

const argv = process.argv.slice(2)
const DRY = argv.includes('--dry-run')
const HIDDEN = argv.includes('--hidden')
const IMAGE_ARG = argv.find((a) => a.startsWith('--image='))?.slice('--image='.length)

const MARKER = 'trip-assistance-anchor'
const CATEGORY_SLUG = 'services'
// No travel/tours subcategory exists in the taxonomy (services holds visa-legal, airport-transfer,
// cleaning, photography, … and service-other). service-other is the honest home rather than
// mislabelling this as visa-legal. ⚠️ Discoverability cost: a dedicated `travel-planning`
// subcategory would market better — that is a taxonomy change (scripts/sync-categories.ts), not
// something to smuggle in here.
const SUBCATEGORY_SLUG = 'service-other'
// Same administrative unit the desk's other listings carry, so one storefront reads consistently.
// The gate rejects a listing with no district (location_required) even when the service is online.
const CITY = 'Hồ Chí Minh'
const DISTRICT = 'An Khánh'
const EMAILS = (process.env.TRIP_DESK_OWNER_EMAIL || 'support@eno.forum')
  .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)

const TITLE = 'Vietnam trip planning — free itinerary, and we can book it for you'
const TITLE_VI = 'Lên lịch trình Việt Nam — miễn phí, và chúng tôi có thể đặt giúp bạn'
// ⚠️ The 10% is disclosed in the copy itself, not only in chat. eno arranges; the traveller pays
// each supplier directly — the fee wording must keep those two facts together, because that
// separation is what keeps this an assistance service rather than a travel agency sale.
const DESCRIPTION = [
  'Tell us where you want to go and we build you a day-by-day Vietnam itinerary — free, in minutes, with every stop on a map.',
  '',
  'Want it booked? Message us here and our local team arranges the stays, transport and tours on your plan, and stays on the other end of this chat while you travel.',
  '',
  'How the fee works: planning is free. If you ask us to arrange bookings we charge 10% of the total, quoted in writing in this chat before anything is booked. You pay each hotel, driver and guide directly at their own price — we are not a travel agency and we do not take payment for the travel itself.',
].join('\n')
const DESCRIPTION_VI = [
  'Cho chúng tôi biết bạn muốn đi đâu, chúng tôi sẽ lên lịch trình Việt Nam theo từng ngày — miễn phí, trong vài phút, kèm bản đồ đầy đủ các điểm dừng.',
  '',
  'Muốn đặt luôn? Nhắn tin tại đây, đội ngũ địa phương của chúng tôi sẽ sắp xếp chỗ ở, di chuyển và tour theo lịch trình của bạn, và luôn sẵn sàng trong khung chat này suốt chuyến đi.',
  '',
  'Về phí dịch vụ: lên lịch trình là miễn phí. Nếu bạn nhờ chúng tôi sắp xếp đặt chỗ, phí dịch vụ là 10% tổng chi phí, được báo bằng văn bản trong khung chat này trước khi đặt bất kỳ dịch vụ nào. Bạn thanh toán trực tiếp cho từng khách sạn, tài xế và hướng dẫn viên theo giá của họ — chúng tôi không phải công ty lữ hành và không thu tiền cho phần dịch vụ du lịch.',
].join('\n')

const client = new Client({ connectionString: process.env.DIRECT_URL })
await client.connect()
const q = async (sql, params = []) => (await client.query(sql, params)).rows

try {
  const [seller] = await q(
    `select s.id, s.name, s."trustScore", p.email
       from "Seller" s join "Profile" p on p.id = s."ownerId"
      where lower(p.email) = any($1::text[])
      order by s."memberSince" asc limit 1`,
    [EMAILS],
  )
  if (!seller) { console.error(`✗ no Seller owned by any of: ${EMAILS.join(', ')}`); process.exit(1) }

  const [category] = await q(`select id, name, "nameVi" from "Category" where slug = $1`, [CATEGORY_SLUG])
  if (!category) { console.error(`✗ category "${CATEGORY_SLUG}" not found`); process.exit(1) }

  const [existing] = await q(
    `select id, images, status from "Listing" where "sellerId" = $1 and "externalId" = $2`,
    [seller.id, MARKER],
  )

  // Image: an explicit --image wins; otherwise keep whatever the row already has; otherwise
  // borrow one from the desk's own storefront. ⚠️ Borrowing is the OWNER'S CHOICE (asked and
  // answered 2026-07-25) — the e-Visa artwork says E-VISA on it, so it reads oddly on a
  // trip-planning card. Swap it any time with:
  //   node --env-file=.env scripts/seed-trip-desk.mjs --image=<supabase-url>
  let images = existing?.images && JSON.parse(existing.images).length ? JSON.parse(existing.images) : []
  if (IMAGE_ARG) images = [IMAGE_ARG]
  if (!images.length) {
    const [donor] = await q(
      `select images from "Listing" where "sellerId" = $1 and status = 'active' and images <> '[]'
       order by "createdAt" asc limit 1`, [seller.id],
    )
    const urls = donor ? JSON.parse(donor.images) : []
    if (urls[0]) images = [urls[0]]
  }

  // THE APP'S OWN GATE, before any write. A row this rejects must never reach the table.
  let guard
  try { guard = await import('../src/lib/publish-guard.ts') } catch { /* see the import note */ }
  if (guard) {
    try {
      guard.assertPublishable({
        trustTier: 'standard',
        images,
        texts: [TITLE, DESCRIPTION, TITLE_VI],
        categorySlug: CATEGORY_SLUG,
        // ⚠️ district is REQUIRED (location_required) even for an online service — the gate
        // wants a real administrative unit, not just a city string. Mirrors the desk's other
        // listings so the storefront reads consistently.
        district: DISTRICT,
      })
      guard.assertCleanTexts([TITLE, DESCRIPTION, TITLE_VI, DESCRIPTION_VI])
      console.log('  publish gate: PASSED')
    } catch (e) {
      console.error(`✗ publish gate refused this listing: ${e?.code || e?.message || e}`)
      console.error(`  (images=${images.length}, district=${DISTRICT}, category=${CATEGORY_SLUG})`)
      process.exit(1)
    }
  } else {
    console.log('  ⚠️ publish-gate self-check SKIPPED — re-run under `npx tsx` to enable it')
  }

  const searchText = buildSearchText([TITLE, DESCRIPTION, null, category.name, category.nameVi, null, null])
  const status = HIDDEN ? 'hidden' : 'active'
  const fields = [
    // ⚠️ Listing has titleVi but NO descriptionVi column — the Vietnamese description comes from
    // the app's translation layer at render time, not from a stored column. DESCRIPTION_VI is
    // still written above and run through the banned-word gate, so the wording is reviewed and
    // ready if a column is ever added; it is deliberately NOT inserted.
    ['title', TITLE], ['titleVi', TITLE_VI],
    ['description', DESCRIPTION],
    // Planning is free and the 10% has no fixed đồng amount, so the card carries no price.
    // priceUnit stays empty: <Price> appends " / <unit>" for anything else.
    ['price', 0], ['priceUnit', ''], ['currency', '₫'],
    ['location', DISTRICT], ['district', DISTRICT], ['city', CITY],
    ['images', JSON.stringify(images)],
    ['categoryId', category.id], ['subcategorySlug', SUBCATEGORY_SLUG], ['listingType', 'service'],
    ['attributes', JSON.stringify({ serviceLocation: 'online', providerType: 'business' })],
    ['searchText', searchText],
    ['sellerTrustScore', seller.trustScore],
    ['status', status],
    ['externalId', MARKER],
  ]

  if (DRY) {
    console.log(`dry run — would ${existing ? 'update' : 'create'} on ${seller.name}`)
    console.log(`  status=${status} price=0 images=${images.length} subcat=${SUBCATEGORY_SLUG}`)
    process.exit(0)
  }

  let id
  if (existing) {
    const setSql = fields.map(([c], i) => `"${c}" = $${i + 1}`).join(', ')
    // negotiable=false: there is no price to haggle over, and an offer on a fixed-price listing
    // is rejected server-side (409) and docks the buyer's trust, so the offer UI must stay hidden.
    await q(`UPDATE "Listing" SET ${setSql}, negotiable = false, verified = true, "updatedAt" = now()
             WHERE id = $${fields.length + 1}`, [...fields.map(([, v]) => v), existing.id])
    id = existing.id
    console.log(`✓ updated ${id} (was ${existing.status} → ${status})`)
  } else {
    const all = [...fields, ['sellerId', seller.id]]
    await q(
      `INSERT INTO "Listing" (id, ${all.map(([c]) => `"${c}"`).join(', ')}, negotiable, verified, "rankScore", "postedAt", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, ${all.map((_, i) => `$${i + 1}`).join(', ')}, false, true, 0, now(), now(), now())
       RETURNING id`, all.map(([, v]) => v),
    )
    ;[{ id }] = await q(`select id from "Listing" where "sellerId" = $1 and "externalId" = $2`, [seller.id, MARKER])
    console.log(`✓ created ${id} (status=${status})`)
  }

  // rankScore from the ONE shared formula, never re-typed here.
  await q(`UPDATE "Listing" SET "rankScore" = ${rankScoreExprSql()} WHERE id = $1`, [id])
  console.log(`  storefront: ${seller.name} · https://eno.vn/listings/${id}`)
} finally {
  await client.end()
}
