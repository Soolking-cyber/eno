#!/usr/bin/env node
// Seed the trip desk's ANCHOR LISTING — the row that lets a trip-assistance case have a chat
// thread at all.
//
// WHY THIS EXISTS: Conversation.listingId is NOT NULL and the table carries
// @@unique([listingId, buyerProfileId]) — one thread per buyer per listing. Trip assistance is
// not a marketplace product, so it has no listing of its own; every assistance thread instead
// hangs off ONE anchor listing on the desk's storefront, found by the marker
// `externalId = 'trip-assistance-anchor'` (src/lib/trips/dm-thread.ts).
// Until this row exists, bindTripThread() fails closed with `listing_unavailable` and the whole
// assistance feature is inert. That is deliberate — it fails soft, nothing 500s — but it also
// means the feature looks configured while doing nothing, which is exactly how the visa surface
// went silently dead in prod on 2026-07-22.
//
// ⚠️ STATUS IS `hidden`, NOT `active`. The anchor is plumbing, not a product: it must never
// appear in the public feed or on the storefront next to the real visa listings.
// getTripAssistanceListingId() looks the row up by (sellerId, externalId) with NO status filter,
// so a hidden row anchors threads perfectly while staying invisible. Seeding it `active` would
// publish a fake product on a live storefront.
//
// ⚠️ THE OWNER IS RESOLVED THE SAME WAY THE APP RESOLVES IT — by email, against Profile, using
// the same TRIP_DESK_OWNER_EMAIL env and the same 'support@eno.forum' default. Verified in the
// live database before writing this: support@eno.forum HAS a Profile (and owns the storefront
// carrying the 14 visa listings); support@eno.vn has NO Profile row at all. Do not "correct" the
// address to the .vn one — that is the visa ADMIN AUTH identity, a different thing from the
// storefront owner, and pointing the desk at it reproduces the 2026-07-22 outage exactly.
//
// Idempotent: upserts on (sellerId, externalId), so re-running updates the same row.
//
//   node --env-file=.env scripts/seed-trip-desk.mjs [--dry-run]

import { Client } from 'pg'

const DRY = process.argv.includes('--dry-run')
const MARKER = 'trip-assistance-anchor'
const EMAILS = (process.env.TRIP_DESK_OWNER_EMAIL || 'support@eno.forum')
  .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)

const client = new Client({ connectionString: process.env.DIRECT_URL })
await client.connect()
const q = async (sql, params = []) => (await client.query(sql, params)).rows

try {
  // 1. The desk storefront, resolved exactly as getTripDesk() does: by owner email, oldest first
  //    so a duplicated support identity resolves deterministically rather than by insertion luck.
  const [seller] = await q(
    `select s.id, s.name, p.email
       from "Seller" s join "Profile" p on p.id = s."ownerId"
      where lower(p.email) = any($1::text[])
      order by s."memberSince" asc
      limit 1`,
    [EMAILS],
  )
  if (!seller) {
    console.error(`✗ no Seller owned by any of: ${EMAILS.join(', ')}`)
    console.error('  The desk cannot be seeded until that account has a storefront.')
    process.exit(1)
  }
  console.log(`desk storefront: ${seller.name} (${seller.id}) ← ${seller.email}`)

  // 2. A category is required (non-null FK). 'services' is where the visa products already sit.
  const [category] = await q(`select id, slug from "Category" where slug = 'services'`)
  if (!category) { console.error('✗ category "services" not found'); process.exit(1) }

  const existing = await q(
    `select id, status, title from "Listing" where "sellerId" = $1 and "externalId" = $2`,
    [seller.id, MARKER],
  )
  if (existing.length) {
    console.log(`already seeded: ${existing[0].id} (status=${existing[0].status})`)
    if (existing[0].status !== 'hidden') {
      console.warn(`⚠️ status is "${existing[0].status}", expected "hidden" — the anchor is PUBLIC.`)
    }
    process.exit(0)
  }
  if (DRY) { console.log('dry run — would create the anchor listing'); process.exit(0) }

  // 3. price 0: nothing is sold here. The 10% service fee is quoted by an operator in chat and
  //    invoiced out of band — this row must never look like a purchasable product.
  const [created] = await q(
    `insert into "Listing"
       (id, title, description, price, currency, location, city, images,
        "categoryId", "sellerId", "externalId", status, verified, negotiable, "createdAt", "updatedAt")
     values (gen_random_uuid()::text, $1, $2, 0, '₫', $3, $3, '[]',
             $4, $5, $6, 'hidden', false, false, now(), now())
     returning id, status`,
    [
      'Trip assistance desk',
      'Internal anchor for trip-assistance chat threads. Not a product, not for sale, and hidden from the public feed — see scripts/seed-trip-desk.mjs.',
      'Ho Chi Minh City',
      category.id,
      seller.id,
      MARKER,
    ],
  )
  console.log(`✓ created anchor listing ${created.id} (status=${created.status})`)
} finally {
  await client.end()
}
