#!/usr/bin/env node
/**
 * THE TRIP DESK'S ANCHOR LISTING — one hidden, free listing that every itinerary conversation
 * hangs off.
 *
 * ⚠️ AN ITINERARY IS NOT A PRODUCT, AND THIS ROW IS NOT ONE EITHER. `getTripAssistanceListingId()`
 * (src/lib/trips/dm-thread.ts) resolves the desk by `(seller, externalId)` and every trip thread is
 * anchored on the listing it returns. The row exists so a conversation has a truthful listing to
 * sit on — the same shape the visa desk uses. It is `status='hidden'` and `price=0` by design, so
 * it can never be browsed, never be charged, and never appear in a feed, a rail or the sitemap.
 *
 * ⛔ WHY IT MOVES TO GMBR (owner, 2026-08-14). The anchor has lived on eno's own support account
 * since the trip service was eno's. It is now GMBR's — "Eno plans it. GMBR books it" — so the
 * anchor belongs on GMBR's storefront, exactly as the e-visa catalogue moved to VietKite. Anchoring
 * a partner's conversations on eno's own listing would make eno the counterparty to a service a
 * licensed partner is providing.
 *
 * ⚠️ THE ENV MUST FOLLOW, AND IN ONE WRITE. Creating this row changes nothing on its own:
 * `getTripDesk()` reads TRIP_DESK_OWNER_EMAIL, which still says support@eno.forum. Repoint it in
 * the same change, and check HIDDEN_DESK_OWNER_EMAILS first — that variable is the LICENSING
 * hide-list, and putting a partner's address in it deletes their storefront from the marketplace.
 * See the note at the head of src/lib/edition-scope.ts. GMBR has no other listings today, so the
 * blast radius is smaller than VietKite's was — but the rule is the rule.
 *
 * Idempotent: `@@unique([sellerId, externalId])` means a second run updates rather than duplicates.
 * DRY RUN BY DEFAULT.
 *
 *   node scripts/seed-trip-desk.mjs                # plan only
 *   node scripts/seed-trip-desk.mjs --execute      # create/update the anchor
 */
import fs from 'node:fs'
import pg from 'pg'

const EXECUTE = process.argv.includes('--execute')
const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')] }),
)

/** ⚠️ MUST match TRIP_ASSISTANCE_LISTING_EXTERNAL_ID in src/lib/trips/dm-thread.ts, or the desk
 *  resolves to null and every trip thread fails to bind. It is the join key, not a label. */
const EXTERNAL_ID = 'trip-assistance-anchor'
const DESK_EMAIL = 'info@giacmobayre.com'

const db = new pg.Client({ connectionString: env.DIRECT_URL || env.DATABASE_URL, connectionTimeoutMillis: 15000 })
await db.connect()

const seller = (await db.query(
  `select s.id, s.name, p.email from "Seller" s join "Profile" p on p.id = s."ownerId" where p.email = $1`,
  [DESK_EMAIL],
)).rows[0]
if (!seller) {
  console.error(`\n✗ No storefront owned by ${DESK_EMAIL}. The desk must have a Seller row first.`)
  process.exit(1)
}

const existing = (await db.query(
  `select id, title, status, price, "sellerId" from "Listing" where "externalId" = $1`, [EXTERNAL_ID],
)).rows

console.log(`\n══ TRIP DESK ANCHOR ${EXECUTE ? '(EXECUTING)' : '(DRY RUN)'}`)
console.log(`desk storefront : ${seller.name} <${seller.email}>  id=${seller.id}`)
console.log(`external id     : ${EXTERNAL_ID}`)
if (existing.length) {
  console.log('\nexisting anchor rows:')
  console.table(existing.map((r) => ({ id: r.id, title: r.title.slice(0, 40), status: r.status, price: r.price, onThisDesk: r.sellerId === seller.id })))
} else {
  console.log('\nno anchor row exists yet')
}

const CATEGORY = (await db.query(`select id from "Category" where slug = 'services' limit 1`)).rows[0]
if (!CATEGORY) { console.error('✗ no "services" category'); process.exit(1) }

if (!EXECUTE) {
  console.log('\nWould create/move the anchor onto this desk, hidden and free.')
  console.log('Re-run with --execute. Then set, in ONE secret version:')
  console.log(`  TRIP_DESK_OWNER_EMAIL=${DESK_EMAIL}`)
  console.log('  ITINERARY_THREADS_ENABLED=true      # only once a build with the .svc. routes is serving')
  await db.end(); process.exit(0)
}

const onThisDesk = existing.find((r) => r.sellerId === seller.id)
if (onThisDesk) {
  await db.query(`update "Listing" set status='hidden', price=0, verified=true, "updatedAt"=now() where id=$1`, [onThisDesk.id])
  console.log(`\n✓ anchor already on this desk — normalised (hidden, free, verified): ${onThisDesk.id}`)
} else {
  /**
   * ⛔ CLONED FROM THE EXISTING ANCHOR, NOT HAND-WRITTEN — a reviewer caught the first version
   * inventing a row and getting it wrong. A Listing carries invariants that are invisible until
   * something breaks: `priceUnit` must be '' and NOT 'total', because <Price> appends "/ <unit>"
   * and a free listing would read "0 ₫ / total"; `searchText` feeds the trigram index; `rankScore`
   * feeds ordering; `location`/`city`/`district` are read by surfaces that assume they exist. The
   * live row already satisfies every one of them, so copying it is strictly safer than restating
   * them and hoping the list is complete.
   *
   * ⚠️ THREE COLUMNS ARE OVERRIDDEN RATHER THAN INHERITED, and a reviewer caught each one:
   *   · `negotiable = false` — the Counter/offer control gates on `negotiable !== false`, so an
   *     inherited default would grow an offer UI on a hidden ₫0 anchor in every GMBR thread, and an
   *     offer on a fixed-price listing 409s server-side and docks the buyer's trust score.
   *   · `titleVi = NULL` — the source row's Vietnamese title still says "we can book it for you",
   *     which is eno's old first-person framing and wrong for a partner-run desk. Null renders the
   *     English title rather than a contradicting translation.
   *   · `searchText` is set from the new title, not inherited, so it cannot describe the old copy.
   *     (It is a hidden row that no search reaches — corrected because a stale index entry is the
   *     kind of thing that surfaces years later, not because it costs anything today.)
   *
   * ⚠️ A NEW ROW, not a re-parent. eno's own anchor keeps eno.forum's existing trip threads
   * resolvable; moving it would strand every conversation already bound to it.
   */
  const src = existing[0]
  if (!src) {
    console.error('\n✗ No anchor row exists anywhere to clone from. Seed the trip desk on eno.forum first.')
    process.exit(1)
  }
  const r = await db.query(
    `insert into "Listing" (
       id, "sellerId", "externalId", title, "titleVi", description, price, currency, "priceUnit",
       images, "categoryId", "subcategorySlug", "listingType", location, city, district,
       "rankScore", "searchText", negotiable, attributes, status, verified, "postedAt", "updatedAt")
     select gen_random_uuid()::text, $1, "externalId", $2, NULL, $3, 0, currency, "priceUnit",
       images, "categoryId", "subcategorySlug", "listingType", location, city, district,
       "rankScore", $2, false, attributes, 'hidden', true, now(), now()
     from "Listing" where id = $4
     returning id, "priceUnit", location, "rankScore"`,
    [
      seller.id,
      'Vietnam trip planning — free itinerary, arranged in chat',
      'Tell us your dates, budget and interests in chat and a day-by-day itinerary is built with you. '
      + 'Planning is free. Flights, hotels, insurance and tickets are booked by GMBR, who quote you directly.',
      src.id,
    ],
  )
  console.log(`\n✓ anchor cloned onto ${seller.name}: ${r.rows[0].id}`)
  console.log('  inherited:', JSON.stringify({ priceUnit: r.rows[0].priceUnit, location: r.rows[0].location, rankScore: r.rows[0].rankScore }))
}

console.log('\nNext, in ONE secret version (order matters — see the header):')
console.log(`  TRIP_DESK_OWNER_EMAIL=${DESK_EMAIL}`)
console.log('  ITINERARY_THREADS_ENABLED=true       # only after a build carrying the .svc. trip routes is live')
await db.end()
