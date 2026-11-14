/**
 * SEED THE AI SEAT'S DEMO LISTINGS — the sample data the AI-app marketplace reviewers (OpenAI's ChatGPT apps, Muse,
 * Claude's connector directory) find in the shop once they have signed in as the AI seat (ai-review@eno.vn,
 * scripts/review-seats.mjs) and connected eno's Partner MCP server through "Sign in with eno". Three ordinary
 * second-hand listings on the seat's own storefront, created UNVERIFIED and HIDDEN — the reviewer's own create_listing
 * and set_listing_status supply the other statuses — plus the storefront's location and one-line bio, which get_shop
 * reports. The shop's own MCP tools read the listings; nothing public lists them.
 *
 *   node --env-file=.env scripts/seed-ai-review-listings.mjs            # dry run (read-only)
 *   node --env-file=.env scripts/seed-ai-review-listings.mjs --apply
 *
 * Run it AFTER the AI seat exists (its storefront owns the listings):
 *   node --env-file=.env scripts/register-play-reviewer.mjs --for=ai --apply
 *   node --env-file=.env scripts/set-official-partner.mjs <sellerId it printed> --apply
 *
 * WHAT IT WRITES: the three "Listing" rows of LISTINGS below and the storefront's `location` + `bio` (STOREFRONT, only
 * while BOTH are still null — never an overwrite), in ONE transaction (all or none), and nothing else — no account, no
 * new storefront, no auth user, no storage object. CREATE-ONLY: it refuses when the storefront already holds a
 * row it seeded (an externalId starting `seed-ai-review-listings:`), in ANY status, a tombstone included. Changing the
 * seeded content is the REVERSAL and a fresh seat, never an update in place.
 *
 * ⚠️ WHY HIDDEN — MEASURED 2026-11-14 by reading every public reader, not assumed. A listing is public only while
 * `verified AND status = 'active'` (a sold one also opens its own page), and there is no central read-side predicate
 * (src/lib/compliance/public-state-writes.test.ts says so), so each surface was read on its own:
 *   · browse and search — buildFeedFilters (src/app/api/listings/feed-query.ts) pushes `verified: true` and
 *     `status: 'active'` into the one filter the feed, its count, its facets and both semantic-search paths share; the
 *     by-id path (/saved, recently viewed) answers a hidden id as `gone`, exactly like an id that never existed;
 *   · the search box — /api/search/suggest and /api/search/resolve: verified + active;
 *   · the sitemap — every listing URL and every storefront URL is derived from submittedListingWhere (src/lib/sitemap.ts:
 *     verified + active), so neither these rows nor the seat's storefront is ever submitted;
 *   · the Google / Meta feeds — src/app/api/feeds/{google-shopping,facebook-catalog,facebook-rentals}: verified + active;
 *   · the home shelves — the home feed ((home)/page.tsx `publicScope`), "Outstanding businesses" (core/business-rail.ts),
 *     trending (core/trending-rail.ts), the teacher shelf (core/teacher-shelf.ts): verified + active;
 *   · the seller page — /sellers/<id> and /<handle> (seller-storefront.tsx loadSeller) and GET /api/sellers/<id>: their
 *     grids and counts are verified + active;
 *   · the PDP — the layout 404s anything but verified + active|sold (get-listing.ts isListingViewable). A hidden row
 *     escapes that only as a "gone" page when its id is in the owner's 2026-10 cleanup journal (isJournaledGone), which
 *     no seeded id is; GET /api/listings/<id> (the apps' PDP) 404s anything not verified + active. So /listings/<id> is a
 *     404 for EVERYONE, the seat included: its reviewer sees these in Dashboard › Listings ("Hidden") and through the MCP;
 *   · the public MCP search server (/api/mcp/search) — search_listings IS that feed; get_listing_details applies
 *     listingIsViewable.
 *   Every one of them is ALSO closed by `verified = false` (next paragraph), so either flag alone keeps a row off it.
 *
 * ⚠️ WHY ALSO UNVERIFIED. The reviewers exercise the WRITE tools as well. set_listing_status 'active' (MCP), the partner
 * API's status change and the dashboard's Activate all run setStatusCore (src/lib/core/listings.ts), which writes
 * `status` and NEVER `verified` — as does confirmCore. So a demo row a reviewer "activates" stays unpublished: "Held" in
 * the dashboard, `verified: false` in the MCP ("waits for eno's check"), rather than a not-for-sale item with a price
 * going out on browse, the sitemap and the Merchant feed (the risk the Apple seed avoided by creating its row sold).
 * It then shows in the admin's pending count (admin/page.tsx: verified false + active) — ⛔ never approve, verify or
 * activate these from the admin console; Hide them back. Nothing automatic publishes an unverified row: no update path
 * re-verifies one (updateListingCore's "no auto-republish" note), releaseIdentityHolds needs identityHold (never set
 * here), and scripts/publish-held.ts is an operator's run over ACTIVE rows only.
 *
 * ⚠️ AND THE MCP DOES READ A SHOP'S OWN HIDDEN, UNVERIFIED LISTINGS — MEASURED, the property this seed exists for:
 *   · list_listings — `{ sellerId, NOT_REMOVED, [status] }`: every status but a tombstone, and `status: 'hidden'` is one
 *     of the filters it offers (src/lib/mcp/tools.ts);
 *   · get_listing — ownedListing → listingOwnedBy (src/lib/api/auth.ts): the shop's own row in any status but 'removed';
 *   · analytics_summary — `{ sellerId, NOT_REMOVED }`, counted under `hidden`; analytics_listings — getListingAnalytics
 *     (src/lib/listing-analytics.ts), `{ sellerId, NOT_REMOVED }`; the REST twin GET /api/v1/listings, the same;
 *   · get_shop answers for a storefront with no public listing: an OWNED storefront is never "gone" (storefront-gone.ts).
 *   None of them filters on `verified`. A sign-in token is re-checked against eligibleShop on every call
 *   (resolveApiKey), so the seat must stay a business account that owns this storefront and is not held or suspended.
 *
 * ⚠️ NOT A LISTING, ACCEPTED (codex/opus review, 2026-11-14):
 *   · THE STOREFRONT ITSELF IS REACHABLE at /sellers/<id> (an owned storefront is never "gone", storefront-gone.ts):
 *     unlinked and outside the sitemap, it shows the seat's name, this bio and location, the Business chip and the
 *     partner badge — the exposure register-play-reviewer.mjs's header measures for every seat.
 *
 * ⚠️ NOT COVERED HERE — THE REVIEWERS' OWN WRITES. create_listing, bulk_create_listings and sync_catalogue go through
 * the app's create path, which writes verified + active: a listing a reviewer creates is PUBLIC at once (browse, the
 * sitemap, the feeds — and it makes the seat eligible for the home "Outstanding businesses" rail, see
 * register-play-reviewer.mjs). Nothing in a seed can stop that; hide or delete what a review created.
 *
 * NO --gate FLAG, unlike the Apple seed: that one writes a public (sold, verified) row past the seller identity gate,
 * so its operator must state the gate. Nothing here publishes, and a later relist asks the gate itself
 * (identityGateForRevive inside setStatusCore).
 *
 * The content is held to the app's own publish screens by src/lib/app-review-seat.test.ts — the publish gate, the
 * taxonomy, the area table, the photo rules — so a copy edit the app would refuse fails there. The photos are the Apple
 * seed's approach: the repo's own seed images (public/listings/*.png), served same-origin — nothing uploaded, nothing
 * hotlinked, not storage objects, so no erasure or storage sweep can ever delete them. Each photo shows what its
 * listing names, and the text says they are illustrative.
 *
 * Dry run by default, and the dry run reads inside a READ ONLY transaction — a bug in it cannot write.
 *
 * REVERSAL — the whole seat, listings included: /admin/users/<the seat's profile id> → Erase (retype ai-review@eno.vn) —
 * eraseAccount (src/lib/core/account-erasure.ts), the one erasure path: listings, storefront, API keys and sign-in
 * grants, Profile and the Supabase auth user, with the audit row; then shred .env.ai-review.local. ⚠️ Never admin
 * "Delete" one listing: that is a TOMBSTONE (status 'removed', kept a year under Law 122/2025 Art 17.1(e)) that keeps
 * its (seller, externalId) slot — and this script then refuses to run on that storefront.
 */
import { randomBytes } from 'node:crypto'
import { REVIEW_SEATS } from './review-seats.mjs'
import { invokedDirectly, listedIn } from './seed-app-review-thread.mjs'

/** Every seeded row's externalId starts with `${SEED_TAG}:` — what a re-run looks for, in any status. */
export const SEED_TAG = 'seed-ai-review-listings'

/** The seat whose storefront owns the listings — created by `register-play-reviewer.mjs --for=ai`. */
export const SEAT = REVIEW_SEATS.ai

/**
 * The statuses a seeded row may be written with — each listing names its own; today all three are hidden. ⛔ NOT
 * 'sold' (gate review, 2026-11-14): the trust maths counts a sold row as a completed sale with no verified check
 * (computeTrustV2, src/lib/trust.ts; sellerTransactionCount, src/lib/enforcement.ts), so a seeded sold row would put a
 * made-up sale into a public trust score. And never 'active' — rowFor refuses anything else.
 */
export const SEED_STATUSES = Object.freeze(['hidden'])
export const SEED_VERIFIED = false

/**
 * The storefront's own profile, as get_shop reports it (bio, location). PUBLIC on /sellers/<id> (unlinked, see
 * register-play-reviewer.mjs), so it says plainly what the shop is. Written only while both columns are null.
 */
export const STOREFRONT = Object.freeze({
  location: 'Thảo Điền, Thủ Đức',
  bio: 'Test shop that eno gives AI app reviewers. Its listings are demos, not for sale.',
})

/**
 * The seat's lookup: by Profile.email, EXACT. The email is stored lowercase (register-play-reviewer.mjs writes it so,
 * and the password route's partner lookup is an exact match on it too), so no lower(), no ILIKE, no domain match:
 * a near-miss address must find nothing rather than someone else's storefront. Left-joined so "no storefront" is
 * told apart from "no account".
 */
export const SEAT_QUERY = Object.freeze({
  text: `select p.id, p."accountType", p."enforcementState",
                s.id as "sellerId", s.name as "sellerName", s."officialPartner", s."trustScore", s."trustTier",
                s.location as "sellerLocation", s.bio as "sellerBio"
           from "Profile" p left join "Seller" s on s."ownerId" = p.id
          where p.email = $1`,
  values: Object.freeze([SEAT.email]),
})

/**
 * The listings — the shape the post wizard sends for an ordinary used item (src/components/marketplace/post-wizard.tsx):
 * area = the 2025 ward name as district and location, the province name as city; condition 'used'; listingType 'sell'.
 * ⚠️ `title` IS WHAT AN AI REVIEWER READS FIRST (list_listings), so it says "(demo)"; the description says, in both
 * languages, that it is a demo listing, not for sale, with illustrative photos.
 */
const demoEn = (what) =>
  `Demo listing: it belongs to the test account eno gives AI app reviewers. The ${what} not for sale and the ` +
  'photos are illustrative, so please do not contact the seller.'
const demoVi = (what) =>
  `Tin đăng mẫu: tin này thuộc tài khoản thử nghiệm mà eno cấp cho người duyệt ứng dụng AI. ${what} không bán và ` +
  'ảnh chỉ mang tính minh họa, vui lòng không liên hệ người bán.'

export const LISTINGS = Object.freeze([
  Object.freeze({
    externalId: `${SEED_TAG}:sofa`,
    title: 'Beige fabric sofa with cushions (demo)',
    status: 'hidden',
    titleVi: 'Sofa vải màu be kèm gối (tin mẫu)',
    description: `Three-seater sofa in beige fabric with its cushions, used. Pick-up in An Khánh, Hồ Chí Minh City.\n\n${demoEn('sofa is')}`,
    descriptionVi: `Sofa vải 3 chỗ màu be kèm gối, đã qua sử dụng. Nhận hàng tại An Khánh, TP. Hồ Chí Minh.\n\n${demoVi('Sofa')}`,
    price: 4_200_000,
    categorySlug: 'furniture-appliances',
    subcategorySlug: 'sofa-seating',
    listingType: 'sell',
    condition: 'used',
    city: 'Hồ Chí Minh',
    district: 'An Khánh',
    location: 'An Khánh',
    // Three DISTINCT photos (publish-guard.ts MIN_IMAGE_ANGLES), each a beige fabric sofa.
    images: Object.freeze(['/listings/furniture-sofa.png', '/listings/apartment-thaodien.png', '/listings/apartment-phumyhung.png']),
  }),
  Object.freeze({
    externalId: `${SEED_TAG}:moving-sale-furniture`,
    title: 'Moving sale: bed, sofa and coffee table (demo)',
    status: 'hidden',
    titleVi: 'Thanh lý chuyển nhà: giường, sofa và bàn trà (tin mẫu)',
    description: `Moving out: a wooden double bed, a beige sofa and a wooden coffee table, sold together, used. Pick-up in Bình Thạnh, Hồ Chí Minh City.\n\n${demoEn('furniture is')}`,
    descriptionVi: `Chuyển nhà nên thanh lý: giường gỗ đôi, sofa màu be và bàn trà gỗ, bán cả bộ, đã qua sử dụng. Nhận hàng tại Bình Thạnh, TP. Hồ Chí Minh.\n\n${demoVi('Bộ đồ nội thất')}`,
    price: 9_500_000,
    categorySlug: 'moving-sale',
    subcategorySlug: 'furniture',
    listingType: 'sell',
    condition: 'used',
    city: 'Hồ Chí Minh',
    district: 'Bình Thạnh',
    location: 'Bình Thạnh',
    // The bed; the sofa with the coffee table; the corner sofa with the coffee table.
    images: Object.freeze(['/listings/furniture-bedroom.png', '/listings/apartment-thaodien.png', '/listings/apartment-phumyhung.png']),
  }),
  Object.freeze({
    externalId: `${SEED_TAG}:moving-sale-laptop-phone-scooter`,
    title: 'Moving sale: laptop, phone and scooter (demo)',
    status: 'hidden',
    titleVi: 'Thanh lý chuyển nhà: laptop, điện thoại và xe tay ga (tin mẫu)',
    description: `Moving out: a laptop, a smartphone and a scooter, sold together, used. Pick-up in Phú Nhuận, Hồ Chí Minh City.\n\n${demoEn('bundle is')}`,
    descriptionVi: `Chuyển nhà nên thanh lý: một laptop, một điện thoại và một xe tay ga, bán cả bộ, đã qua sử dụng. Nhận hàng tại Phú Nhuận, TP. Hồ Chí Minh.\n\n${demoVi('Bộ đồ này')}`,
    price: 24_000_000,
    categorySlug: 'moving-sale',
    // No keyword of the aisle matches the title, so the app files it under the category's first subcategory.
    subcategorySlug: 'whole-home',
    listingType: 'sell',
    condition: 'used',
    city: 'Hồ Chí Minh',
    district: 'Phú Nhuận',
    location: 'Phú Nhuận',
    // One photo of each item in the bundle.
    images: Object.freeze(['/listings/electronics-macbook.png', '/listings/electronics-iphone.png', '/listings/motorbike-airblade.png']),
  }),
])

/** The INSERT's columns, in its `$n` order — `rowFor` answers exactly these keys (the test pins the match). */
export const INSERT_COLUMNS = Object.freeze([
  'id', 'externalId', 'title', 'titleVi', 'description', 'descriptionVi', 'price', 'condition', 'listingType', 'categoryId',
  'subcategorySlug', 'city', 'district', 'location', 'images', 'sellerId', 'sellerTrustScore', 'verified', 'status',
])

/** cuid-SHAPED, not a cuid — the id style register-play-reviewer.mjs writes (its note says why that is enough). */
const newId = () => 'c' + randomBytes(12).toString('hex')

/**
 * One listing as the row the INSERT writes. Defaults carry the rest: VND / ₫, negotiable, postedAt now, identityHold
 * false, searchText '' (an edit rebuilds it), no attributes. `sellerTrustScore` mirrors the storefront's score, as
 * createListingCore writes it (the feed's ranking key). `"updatedAt"` is NOT here: the SQL stamps it with now() — it is
 * NOT NULL with no default (Prisma's @updatedAt is client-side; register-play-reviewer.mjs has the story).
 */
export function rowFor(listing, { sellerId, categoryId, sellerTrustScore, id = newId() }) {
  // ⛔ FAIL CLOSED: a status outside SEED_STATUSES (an 'active' typo above all) must never reach the INSERT.
  if (!SEED_STATUSES.includes(listing.status)) throw new Error(`${listing.externalId}: status must be one of ${SEED_STATUSES.join(', ')} (got ${JSON.stringify(listing.status)})`)
  return {
    id,
    externalId: listing.externalId,
    title: listing.title,
    titleVi: listing.titleVi,
    description: listing.description,
    descriptionVi: listing.descriptionVi,
    price: listing.price,
    condition: listing.condition,
    listingType: listing.listingType,
    categoryId,
    subcategorySlug: listing.subcategorySlug,
    city: listing.city,
    district: listing.district,
    location: listing.location,
    images: JSON.stringify(listing.images),
    sellerId,
    sellerTrustScore,
    verified: SEED_VERIFIED,
    status: listing.status,
  }
}

const INSERT_SQL = `insert into "Listing" (id, "externalId", title, "titleVi", description, "descriptionVi", price, condition,
                                "listingType", "categoryId", "subcategorySlug", city, district, location, images,
                                "sellerId", "sellerTrustScore", verified, status, "updatedAt")
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, now())`

const USAGE = 'usage: node --env-file=.env scripts/seed-ai-review-listings.mjs [--apply]'

/** `{ apply }` or `{ error }`. ⛔ FAILS CLOSED: an unknown argument (`--aply`, `--for=ai`, `--gate=off`) is an error. */
export function parseArgs(argv) {
  let apply = false
  for (const a of argv) {
    if (a === '--apply') apply = true
    else return { error: `unknown argument ${a} — ${USAGE}` }
  }
  return { apply }
}

/**
 * The seat out of SEAT_QUERY's rows: `{ seat }`, or `{ refusal }`. ⛔ EXACTLY ONE account with exactly one storefront,
 * named as the seat table names it — anything else is not this seat and nothing is written to it.
 */
export function seatFromRows(rows) {
  if (rows.length === 0) {
    return { refusal: `No Profile for ${SEAT.email} — create the AI seat first:\n      node --env-file=.env scripts/register-play-reviewer.mjs --for=ai --apply` }
  }
  if (rows.length > 1) return { refusal: `${rows.length} rows for ${SEAT.email} — expected exactly one account with one storefront. Not guessing which.` }
  const r = rows[0]
  if (!r.sellerId) return { refusal: `${SEAT.email} (Profile ${r.id}) owns no storefront — it was not created by register-play-reviewer.mjs --for=ai.` }
  if (r.sellerName !== SEAT.sellerName) {
    return { refusal: `${SEAT.email} owns a storefront named "${r.sellerName}" (${r.sellerId}), not "${SEAT.sellerName}" — not the seat's row.` }
  }
  return { seat: r }
}

const vnd = (n) => `${n.toLocaleString('de-DE')} đ`

/** Every read the plan needs. Writes nothing. `refusals` stop the run; `warnings` do not. */
async function readState(c) {
  const refusals = []
  const warnings = []

  // ── The seat and its storefront. ──
  const picked = seatFromRows((await c.query(SEAT_QUERY.text, [...SEAT_QUERY.values])).rows)
  if (picked.refusal) refusals.push(picked.refusal)
  const seat = picked.seat ?? null
  if (seat) {
    // The publish gate's first step (assertPublishable: account_restricted) and eligibleShop's 'restricted'.
    if (seat.trustTier === 'restricted') refusals.push(`The seat's storefront is trust tier "restricted" — the app would refuse it a listing (account_restricted).`)
    if (seat.enforcementState === 'held' || seat.enforcementState === 'suspended') {
      refusals.push(`${SEAT.email} is ${seat.enforcementState} — "Sign in with eno" refuses it (eligibleShop), so the MCP could not read these anyway.`)
    }
    if (seat.accountType !== 'business') {
      warnings.push(`${SEAT.email} has accountType=${seat.accountType ?? 'null'}, not 'business': "Sign in with eno" answers not_business (eligibleShop), so the reviewers cannot connect the MCP. This seed does not need it; the review does.`)
    }
    if (!seat.officialPartner) {
      warnings.push(`${SEAT.email} is not partner-flagged yet, so password sign-in refuses it. This seed does not need the flag; the review does:\n      node --env-file=.env scripts/set-official-partner.mjs ${seat.sellerId} --apply`)
    }
  }

  // ── The aisles. ──
  const slugs = [...new Set(LISTINGS.map((l) => l.categorySlug))]
  const categories = new Map((await c.query(`select id, slug from "Category" where slug = any($1::text[])`, [slugs])).rows.map((r) => [r.slug, r.id]))
  for (const s of slugs) if (!categories.has(s)) refusals.push(`No Category with slug "${s}".`)

  // ── Anything this script seeded before, in any status (a tombstone keeps its externalId slot). ──
  const seeded = seat
    ? (await c.query(
        // A prefix by left(), not LIKE: no wildcard in the tag can ever widen it.
        `select id, "externalId", status from "Listing" where "sellerId" = $1 and left("externalId", length($2)) = $2 order by "externalId"`,
        [seat.sellerId, `${SEED_TAG}:`],
      )).rows
    : []
  if (seeded.length) {
    refusals.push(
      `The seat's storefront already holds ${seeded.length} seeded listing(s) — this script is create-only:\n` +
        seeded.map((r) => `      ${r.id}  ${r.externalId}  status=${r.status}`).join('\n') +
        `\n    To re-seed, follow the REVERSAL in the header (erase the seat), then create it again.`,
    )
  }

  // ── The storefront's location + bio: written only while BOTH are null, never over a value someone set. ──
  let storefront = null
  if (seat) {
    if (seat.sellerLocation == null && seat.sellerBio == null) storefront = STOREFRONT
    else warnings.push(`The storefront already has a location or bio ("${seat.sellerLocation ?? ''}" / "${seat.sellerBio ?? ''}") — left as it is.`)
  }

  return { seat, categories, seeded, storefront, refusals, warnings }
}

function printPlan(s, args) {
  console.log(`${args.apply ? 'WRITING' : 'DRY RUN — would write'}:`)
  console.log(`  seat      : ${SEAT.email}${s.seat
    ? ` (Profile ${s.seat.id}, accountType=${s.seat.accountType ?? 'null'}, officialPartner=${!!s.seat.officialPartner})`
    : ' — MISSING'}`)
  console.log(`  storefront: ${s.seat ? `${s.seat.sellerId} "${s.seat.sellerName}" (trust ${s.seat.trustScore}/${s.seat.trustTier})` : '—'}`)
  if (s.storefront) console.log(`  Seller    : SET location="${s.storefront.location}", bio="${s.storefront.bio}" (both null now)`)
  for (const l of LISTINGS) {
    console.log(`  Listing   : NEW "${l.title}" — ${l.categorySlug} › ${l.subcategorySlug}, ${l.condition}, ${vnd(l.price)}, ${l.district}, ${l.images.length} photos, ${String(l.status).toUpperCase()} + unverified`)
  }
  console.log(`              never in browse, search, the sitemap, the feeds, the home shelves, the seller page or the PDP;`)
  console.log(`              read by the shop's own MCP tools (list_listings, get_listing, analytics_*) — see the header`)
  for (const w of s.warnings) console.log(`\n⚠️  ${w}`)
  for (const r of s.refusals) console.error(`\n⛔ ${r}`)
}

/** The three INSERTs and the storefront update, one transaction. (sellerId, externalId) is unique, so a racing second run fails here, all or none. */
async function write(s, c) {
  const ids = []
  await c.query('begin')
  try {
    if (s.storefront) {
      // Re-checked in the WHERE: a value written between the read and here is never overwritten — 0 rows rolls back.
      const r = await c.query(`update "Seller" set location = $2, bio = $3 where id = $1 and location is null and bio is null`,
        [s.seat.sellerId, s.storefront.location, s.storefront.bio])
      if (r.rowCount !== 1) throw new Error(`the storefront's location/bio changed since the read (${r.rowCount} rows) — nothing written`)
    }
    for (const l of LISTINGS) {
      const row = rowFor(l, { sellerId: s.seat.sellerId, categoryId: s.categories.get(l.categorySlug), sellerTrustScore: s.seat.trustScore })
      await c.query(INSERT_SQL, INSERT_COLUMNS.map((k) => row[k]))
      ids.push(row.id)
    }
    await c.query('commit')
  } catch (e) {
    await c.query('rollback').catch((rb) => console.error(`  (rollback failed too: ${rb.message})`))
    console.error(`\n⛔ Rolled back — no listing was written.`)
    throw e
  }
  return ids
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.error) {
    console.error(args.error)
    process.exitCode = 1
    return
  }
  const DB = process.env.DIRECT_URL
  if (!DB) {
    console.error('Missing DIRECT_URL — run with node --env-file=.env')
    process.exitCode = 1
    return
  }
  // ⛔ A STAFF ADDRESS WOULD HAND THE REVIEWERS THE ADMIN CONSOLE. This is the shell's copy of ADMIN_EMAILS; production's
  // lives in Secret Manager (eno-root-env) — check it there too.
  const staff = listedIn(process.env.ADMIN_EMAILS, [SEAT.email])
  if (staff.length) {
    console.error(`⛔ ${staff.join(', ')} is in ADMIN_EMAILS — the AI reviewers would get the admin console. Take it out first.`)
    process.exitCode = 1
    return
  }

  // Imported here, not at the top, so the unit test can import this file's pure half with no client loaded.
  const { Client } = await import('pg')
  const c = new Client({ connectionString: DB })
  await c.connect()
  try {
    // ⛔ THE DRY RUN CANNOT WRITE, EVEN THROUGH A BUG: its reads run inside a READ ONLY transaction that is rolled back
    // (transaction-scoped on purpose, as in seed-app-review-thread.mjs).
    let state
    if (!args.apply) await c.query('begin transaction read only')
    try {
      state = await readState(c)
    } finally {
      if (!args.apply) await c.query('rollback')
    }
    printPlan(state, args)
    if (state.refusals.length) {
      process.exitCode = 1
      return
    }
    if (!args.apply) {
      console.log('\nDRY RUN — nothing was written. Re-run with --apply to write.')
      return
    }
    const ids = await write(state, c)
    console.log(`\nDone. ${ids.length} unverified demo listings (${LISTINGS.map((l) => l.status).join(', ')}) on ${state.seat.sellerId}${state.storefront ? ', plus its location and bio' : ''}:`)
    for (const id of ids) console.log(`  ${id}`)
    console.log(`  The reviewer sees them signed in as ${SEAT.email}: Dashboard › Listings ("Hidden"), and through the MCP —`)
    console.log(`  list_listings (status hidden), get_listing, analytics_summary, analytics_listings; get_shop (location, bio).`)
    console.log(`  ⛔ Never approve, verify or activate them from the admin console (header: why they are unverified).`)
    if (state.warnings.length) console.error(`\n⚠️  The seat is not ready for review until the warnings above are dealt with.`)
  } catch (e) {
    console.error('FAILED:', e.message)
    process.exitCode = 1
  } finally {
    await c.end()
  }
}

if (invokedDirectly(import.meta.url)) await main()
