/**
 * SEED THE APP REVIEW DEMO CONVERSATION — the thread Apple's reviewer opens, signed in as the Apple seat, to
 * test Block (App Store Guideline 1.2; docs/ios-appstore-release.md P11).
 *
 *   node --env-file=.env scripts/seed-app-review-thread.mjs                        # dry run (read-only)
 *   node --env-file=.env scripts/seed-app-review-thread.mjs --apply --gate=off
 *
 * Run it AFTER the Apple seat exists (the seat is the buyer here):
 *   node --env-file=.env scripts/register-play-reviewer.mjs --for=apple --apply
 *   node --env-file=.env scripts/set-official-partner.mjs <sellerId it printed> --apply
 *
 * WHAT IT WRITES — each row only when it is missing (IDEMPOTENT, below):
 *   · a counterpart SELLER ACCOUNT, app-review-seller@eno.vn — an auth user (email-confirmed, NO password,
 *     marked `app_metadata.eno_seed`), a Profile (accountType individual) and a Seller "Demo seller (App
 *     Review)": no handle, no phone, no partner flag;
 *   · ONE ordinary second-hand listing on that storefront (a used sofa, Home › Sofa), created SOLD (review
 *     2026-10-07): its page still opens (the sold page) and the thread and Block work, but a not-for-sale item
 *     with a price never reaches browse, the sitemap or the Google/Meta product feeds (they read status 'active');
 *   · ONE conversation about it, the Apple seat as BUYER, with two plain text messages.
 *
 * ⚠️ WHY A SECOND ACCOUNT AT ALL. Block refuses the eno team (ADMIN_EMAILS → 403 cannot_block_staff) and has
 * nobody to block behind a shop eno lists on a business's behalf (no owner profile → 404 not_found) —
 * src/app/api/blocks/route.ts, src/lib/user-blocks.ts. So the counterpart has to be an ordinary PERSON who
 * owns a storefront, and no such account exists that eno may hand to a stranger to block.
 *
 * ⚠️ WHY THE LISTING IS SOLD (review 2026-10-07; P11 first asked for a live one). The chat header's Block needs
 * only a thread that HAS a listing (src/app/[lang]/messages/[id]/page.tsx), and a reviewer explores: the item
 * strip links to the listing page, which for a sold listing is the dedicated sold page (200, noindex) — not a
 * dead end. A LIVE demo would have been public: browse, the sitemap, IndexNow, the Google/Meta feeds and
 * saved-search alerts read status 'active', and a not-for-sale item with a price in a Merchant feed is a
 * misrepresentation risk for the whole account. Sold, none of them lists it, so there is no hide/re-activate
 * cycle around each review. Also:
 *   · its description says plainly, in both languages, that it is a demo listing, not for sale, with
 *     illustrative photos;
 *   · `searchText` is left empty, so keyword search never finds it;
 *   · its photos are the repo's own seed images (public/listings/*.png, the fixture photos of
 *     src/lib/__fixtures__/break-ui.ts), served same-origin — nothing uploaded, nothing hotlinked, and not a
 *     storage object, so no account erasure or storage sweep can ever delete them;
 *   · ⚠️ never admin "Delete": that action is a TOMBSTONE (status 'removed', kept a year under Law 122/2025
 *     Art 17.1(e) — admin/listings/route.ts), which keeps the (seller, externalId) slot, so a re-run could
 *     neither reuse nor recreate the listing.
 *
 * Dry run by default, and the dry run reads inside a READ ONLY transaction — a bug in it cannot write.
 *
 * REVERSAL — the demo seller only; the Apple seat has its own (register-play-reviewer.mjs):
 *   · out of every thread's item strip too, reversibly: /admin → Listings → Hide.
 *   · the account itself: /admin/users/<the seller's profile id> → Erase (retype app-review-seller@eno.vn) —
 *     eraseAccount (src/lib/core/account-erasure.ts), the one erasure path: listing, storefront, thread and
 *     messages, Profile and the Supabase auth user, with the audit row and storage handling hand-written
 *     DELETEs would skip (the seed photos are not storage objects, so they are never touched). ⚠️ An OPEN
 *     report against the demo seller — a reviewer may file one — makes it answer under_review: resolve the
 *     report in the moderation queue first.
 */
import { randomBytes } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REVIEW_SEATS, findAuthUser } from './review-seats.mjs'

/** `app_metadata.eno_seed` on the seller's auth user — what makes it adoptable by a re-run. */
export const SEED_TAG = 'seed-app-review-thread'

/** The buyer: App Store review's seat, created by `register-play-reviewer.mjs --for=apple`. */
export const REVIEWER_EMAIL = REVIEW_SEATS.apple.email

/**
 * The counterpart: an ordinary PERSON account (not business, not staff, not a seat). ⚠️ `storefrontName` IS
 * PUBLIC — the listing page, the storefront and the reviewer's chat header show it — so it says what it is.
 */
export const SELLER = Object.freeze({
  email: 'app-review-seller@eno.vn',
  displayName: 'Demo seller',
  storefrontName: 'Demo seller (App Review)',
})

/** Fresh-account trust — TRUST.BASE with the tier GUEST_SELLER_TRUST carries (src/lib/trust-math.ts). */
export const TRUST_BASE = 60
export const TRUST_TIER = 'standard'

/**
 * The listing — the shape the post wizard sends for an ordinary used item (src/components/marketplace/
 * post-wizard.tsx): area = the 2025 ward and province names (An Khánh — the old Thảo Điền — in Hồ Chí Minh),
 * condition 'used', listingType 'sell'. src/lib/app-review-seat.test.ts runs it through the app's own publish
 * screens (photos, text, contact info, location, aisle), so a copy edit that the app would refuse fails there.
 */
export const LISTING = Object.freeze({
  externalId: 'app-review:demo-listing',
  title: 'Beige fabric sofa, 3-seater',
  titleVi: 'Sofa vải 3 chỗ màu be',
  description:
    'Three-seater sofa in beige fabric, used. Pick-up in An Khánh, Hồ Chí Minh City.\n\n' +
    'Demo listing: it belongs to the test account eno uses for App Store review. The sofa is not for sale ' +
    'and the photos are illustrative, so please do not contact the seller.',
  descriptionVi:
    'Sofa vải 3 chỗ màu be, đã qua sử dụng. Nhận hàng tại An Khánh, TP. Hồ Chí Minh.\n\n' +
    'Tin đăng mẫu: tin này thuộc tài khoản thử nghiệm mà eno dùng khi Apple duyệt ứng dụng trên App Store. ' +
    'Sofa không bán và ảnh chỉ mang tính minh họa, vui lòng không liên hệ người bán.',
  price: 3_900_000,
  categorySlug: 'furniture-appliances',
  subcategorySlug: 'sofa-seating',
  listingType: 'sell',
  condition: 'used',
  city: 'Hồ Chí Minh',
  district: 'An Khánh',
  location: 'An Khánh',
  // Three DISTINCT photos — the goods minimum (publish-guard.ts MIN_IMAGE_ANGLES), each a beige fabric sofa.
  images: Object.freeze(['/listings/furniture-sofa.png', '/listings/apartment-thaodien.png', '/listings/apartment-phumyhung.png']),
})

/**
 * Two plain text messages, oldest first: the buyer asks, the seller answers. Neutral on purpose — no Block
 * instructions (the button exists only while `ugc-safety` is on, and a seeded message cannot know that), no
 * contact details, no agreed price (each would trigger a safety strip in the thread).
 */
export const MESSAGES = Object.freeze([
  Object.freeze({ from: 'buyer', body: 'Hi! Could you tell me more about the sofa?' }),
  Object.freeze({ from: 'seller', body: 'Hi! It is a demo listing for the App Store review, so it is not for sale.' }),
])

const USAGE = 'usage: node --env-file=.env scripts/seed-app-review-thread.mjs [--apply --gate=off]'

/**
 * `{ apply, gate }` or `{ error }`. ⛔ FAILS CLOSED: an unknown argument is an error rather than ignored, and
 * `--apply` without `--gate=off` refuses (see the gate note in the header).
 */
export function parseArgs(argv) {
  let apply = false
  /** @type {'on' | 'off' | null} */
  let gate = null
  for (const a of argv) {
    if (a === '--apply') apply = true
    else if (a.startsWith('--gate=')) {
      const v = a.slice('--gate='.length)
      if (v !== 'on' && v !== 'off') return { error: `--gate must be on or off (got "${v}") — ${USAGE}` }
      if (gate !== null && gate !== v) return { error: `conflicting --gate flags — ${USAGE}` }
      gate = v
    } else return { error: `unknown argument ${a} — ${USAGE}` }
  }
  if (apply && gate === null) {
    return { error: '⛔ --apply needs --gate=off: say whether PRODUCTION enforces IDENTITY_GATE_ENFORCED (Secret Manager eno-root-env). This shell cannot tell.' }
  }
  if (apply && gate === 'on') {
    return { error: '⛔ Refusing with --gate=on: while the seller identity gate is enforced, a new unverified account may not publish, and a test account cannot be verified. Seed this while the gate is off.' }
  }
  return { apply, gate }
}

/**
 * The thread's denormalised counters after `messages` (oldest first), as the app would leave them:
 * replying implies having opened the thread (which clears your own unread), so the side that did NOT send
 * the last run of messages holds that run as unread. For the seed: the reviewer sees 1 unread reply.
 */
export function threadCounters(messages) {
  let buyerUnread = 0
  let sellerUnread = 0
  for (const m of messages) {
    if (m.from === 'buyer') { sellerUnread++; buyerUnread = 0 } else { buyerUnread++; sellerUnread = 0 }
  }
  return { buyerUnread, sellerUnread, lastText: messages[messages.length - 1].body }
}

/** Which of `emails` an ADMIN_EMAILS-style comma list names — EXACT, lowercased, like src/lib/admin.ts. */
export function listedIn(csv, emails) {
  const list = (csv || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  return emails.filter((e) => list.includes(e.toLowerCase()))
}

/** cuid-SHAPED, not a cuid — the id style register-play-reviewer.mjs writes (its note says why that is enough). */
const newId = () => 'c' + randomBytes(12).toString('hex')

const vnd = (n) => `${n.toLocaleString('de-DE')} đ`

/**
 * Was this file the one `node` ran? Real paths, with or without the extension — a port of src/lib/cli-entry.ts
 * (a plain-node .mjs cannot import the .ts). ⛔ The naive URL comparison is false through a symlinked path,
 * and then a production --apply would skip main() and exit 0 in silence.
 */
function invokedDirectly(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false
  const real = (p) => {
    try { return realpathSync(p) } catch { return resolve(p) }
  }
  const modulePath = real(fileURLToPath(moduleUrl))
  if (real(argv1) === modulePath) return true
  const ext = extname(modulePath)
  return !!ext && !extname(argv1) && real(argv1 + ext) === modulePath
}

/** Every read the plan needs. Writes nothing. `refusals` stop the run; `warnings` do not. */
async function readState(c, admin) {
  const refusals = []
  const warnings = []

  // ── The buyer: the Apple seat. ──
  const reviewer = (await c.query(
    `select p.id, s.id as "sellerId", s."officialPartner"
       from "Profile" p left join "Seller" s on s."ownerId" = p.id
      where p.email = $1`,
    [REVIEWER_EMAIL],
  )).rows[0] ?? null
  if (!reviewer) {
    refusals.push(`No Profile for ${REVIEWER_EMAIL} — create the Apple seat first:\n      node --env-file=.env scripts/register-play-reviewer.mjs --for=apple --apply`)
  } else if (!reviewer.officialPartner) {
    warnings.push(`${REVIEWER_EMAIL} is not partner-flagged yet, so "Use a password" refuses it. This seed does not need the flag, but App Review does:\n      node --env-file=.env scripts/set-official-partner.mjs ${reviewer.sellerId ?? '<the seat\'s sellerId>'} --apply`)
  }

  // ── The aisle. ──
  const category = (await c.query(`select id from "Category" where slug = $1`, [LISTING.categorySlug])).rows[0] ?? null
  if (!category) refusals.push(`No Category with slug "${LISTING.categorySlug}".`)

  // ── The seller: auth user → Profile → storefront, each one checked to be this script's own. ──
  const authUser = await findAuthUser(admin, SELLER.email)
  if (authUser && authUser.app_metadata?.eno_seed !== SEED_TAG) {
    refusals.push(`An auth user for ${SELLER.email} exists (${authUser.id}) without this script's marker (app_metadata.eno_seed). Not adopting an account it did not create — if it is a stray, delete it in Supabase → Authentication → Users and re-run.`)
  }
  const profile = (await c.query(`select id, "accountType" from "Profile" where email = $1`, [SELLER.email])).rows[0] ?? null
  if (profile && profile.id !== authUser?.id) {
    refusals.push(`The Profile for ${SELLER.email} (${profile.id}) does not belong to a seed-marked auth user — not this script's row.`)
  } else if (profile && profile.accountType !== 'individual') {
    refusals.push(`The Profile for ${SELLER.email} has accountType=${profile.accountType}; the demo seller must be a person account ('individual').`)
  }
  if (!profile && authUser) {
    // A marked auth user whose rows never landed (an earlier run died mid-way). Its id must be free in Profile.
    const byId = (await c.query(`select email from "Profile" where id = $1`, [authUser.id])).rows[0]
    if (byId) refusals.push(`Auth user ${authUser.id} already has a Profile under ${byId.email} — not this script's row.`)
  }
  const seller = profile
    ? (await c.query(`select id, name, "officialPartner", "trustScore" from "Seller" where "ownerId" = $1`, [profile.id])).rows[0] ?? null
    : null
  if (seller && seller.name !== SELLER.storefrontName) {
    refusals.push(`${SELLER.email} owns a storefront named "${seller.name}" (${seller.id}), not "${SELLER.storefrontName}" — not this script's row.`)
  } else if (seller?.officialPartner) {
    warnings.push(`The demo storefront ${seller.id} carries the official-partner flag; the demo seller is meant to be an ordinary seller (Block works either way).`)
  }

  // ── The listing, the thread, its messages, and anything that closed or hid the thread last time. ──
  const listing = seller
    ? (await c.query(
        `select id, status, verified, "complianceStatus" from "Listing" where "sellerId" = $1 and "externalId" = $2`,
        [seller.id, LISTING.externalId],
      )).rows[0] ?? null
    : null
  // "live" here means "as seeded": SOLD and verified — its page opens, nothing public lists it (header).
  const live = !!listing && listing.status === 'sold' && listing.verified === true && listing.complianceStatus !== 'taken_down'
  if (listing && !live) {
    warnings.push(`The demo listing ${listing.id} exists but is not as seeded — sold + verified (status=${listing.status}, verified=${listing.verified}, complianceStatus=${listing.complianceStatus}). Not republished — a hide is a moderation or owner decision. If the hide was yours, Activate it in /admin → Listings before the review. (status=removed is a tombstone: it cannot come back, and its slot stops this script recreating the listing.)`)
  }
  // Timestamps come back as text: the columns are zone-less UTC, and pg would read them as this machine's
  // local time — wrong by the zone offset on the operator's screen.
  const convo = listing && reviewer
    ? (await c.query(
        `select id, "sellerId", "sellerProfileId", to_char("buyerDeletedAt", 'YYYY-MM-DD HH24:MI') as "buyerDeletedAt"
           from "Conversation" where "listingId" = $1 and "buyerProfileId" = $2`,
        [listing.id, reviewer.id],
      )).rows[0] ?? null
    : null
  if (convo && (convo.sellerId !== seller.id || convo.sellerProfileId !== profile.id)) {
    refusals.push(`Conversation ${convo.id} on the demo listing does not run between the Apple seat and the demo seller — not this script's row.`)
  }
  const messageCount = convo
    ? Number((await c.query(`select count(*)::int as n from "Message" where "conversationId" = $1`, [convo.id])).rows[0].n)
    : 0
  const blocks = reviewer && profile
    ? (await c.query(
        `select "blockerProfileId" as blocker, to_char("createdAt", 'YYYY-MM-DD HH24:MI') as "createdAt" from "ForumUserBlock"
          where ("blockerProfileId" = $1 and "blockedProfileId" = $2) or ("blockerProfileId" = $2 and "blockedProfileId" = $1)`,
        [reviewer.id, profile.id],
      )).rows
    : []

  return { reviewer, category, authUser, profile, seller, listing, live, convo, messageCount, blocks, refusals, warnings }
}

function printPlan(s, args) {
  const isNew = (row, what) => (row ? `reuse ${row.id}` : `NEW ${what}`)
  console.log(`${args.apply ? 'WRITING' : 'DRY RUN — would write'}:`)
  console.log(`  buyer     : ${REVIEWER_EMAIL}${s.reviewer ? ` (Profile ${s.reviewer.id}, officialPartner=${!!s.reviewer.officialPartner})` : ' — MISSING'}`)
  console.log(`  auth user : ${SELLER.email} — ${s.authUser ? `reuse ${s.authUser.id} (seed-marked)` : 'NEW (email-confirmed, no password, seed-marked)'}`)
  console.log(`  Profile   : ${isNew(s.profile, `(individual, displayName "${SELLER.displayName}", trust ${TRUST_BASE}/${TRUST_TIER}, reminder/digest/nudge mail off)`)}`)
  console.log(`  Seller    : ${isNew(s.seller, `"${SELLER.storefrontName}" (no handle, no phone, not a partner, trust ${TRUST_BASE}/${TRUST_TIER})`)}`)
  console.log(`  Listing   : ${s.listing
    ? `reuse ${s.listing.id} — ${s.live ? 'sold, as seeded' : `⛔ NOT as seeded (status=${s.listing.status}, verified=${s.listing.verified})`}`
    : `NEW "${LISTING.title}" — ${LISTING.categorySlug} › ${LISTING.subcategorySlug}, ${LISTING.condition}, ${vnd(LISTING.price)}, ${LISTING.district}, ${LISTING.images.length} photos, SOLD (page opens; never in browse or the feeds)`}`)
  console.log(`  Thread    : ${isNew(s.convo, '(buyer = the Apple seat, about that listing)')}`)
  console.log(`  Messages  : ${s.messageCount === 0
    ? `${MESSAGES.length} plain messages (${MESSAGES.map((m) => m.from).join(' → ')}); the seat sees ${threadCounters(MESSAGES).buyerUnread} unread`
    : `the thread already has ${s.messageCount} — left as they are`}`)
  if (s.blocks.length) {
    for (const b of s.blocks) console.log(`  Reopen    : remove the block placed by ${b.blocker === s.reviewer?.id ? 'the Apple seat' : 'the demo seller'} (${b.createdAt} UTC) — the thread is closed until then`)
  }
  if (s.convo?.buyerDeletedAt) console.log(`  Reopen    : un-hide the thread in the seat's inbox (it was deleted there ${s.convo.buyerDeletedAt} UTC)`)
  console.log(`  Gate      : ${args.gate === 'off' ? '--gate=off stated' : args.gate === 'on' ? '--gate=on stated — --apply would REFUSE (see the header)' : '--apply needs --gate=off — your statement that production does not enforce IDENTITY_GATE_ENFORCED'}`)
  for (const w of s.warnings) console.log(`\n⚠️  ${w}`)
  for (const r of s.refusals) console.error(`\n⛔ ${r}`)
}

async function write(s, c, admin) {
  let sellerProfileId = s.authUser?.id ?? null
  let createdAuthUser = false
  if (!s.authUser) {
    const created = await admin.auth.admin.createUser({
      email: SELLER.email,
      email_confirm: true,
      app_metadata: { eno_seed: SEED_TAG },
    })
    if (created.error) {
      throw new Error(`createUser failed: ${created.error.message}. If the account got created anyway (a lost response), it carries the seed marker and the next run adopts it.`)
    }
    sellerProfileId = created.data.user.id
    createdAuthUser = true
    console.log(`\n  ✓ auth user ${sellerProfileId} (no password, seed-marked)`)
  }

  const sellerId = s.seller?.id ?? newId()
  const listingId = s.listing?.id ?? newId()
  const convoId = s.convo?.id ?? newId()
  await c.query('begin')
  try {
    if (!s.profile) {
      // `"updatedAt"` by hand: Prisma's @updatedAt is client-side, the column has no default (see
      // register-play-reviewer.mjs). The email is stored lowercase, as the app's lookups expect.
      await c.query(
        `insert into "Profile" (id, email, "displayName", "accountType", "trustScore", "trustTier",
                                "dailyReminderOptIn", "weeklyDigestOptIn", "verificationNudgeOptOut", "updatedAt")
         values ($1, $2, $3, 'individual', $4, $5, false, false, true, now())`,
        [sellerProfileId, SELLER.email.toLowerCase(), SELLER.displayName, TRUST_BASE, TRUST_TIER],
      )
    }
    if (!s.seller) {
      // resolveSellerForPost's shape for a person's first storefront: rating 0 (not the column's 5), no
      // reviews, the owner's trust (initialSellerTrust) — and no phone, so there is nothing to reveal.
      await c.query(
        `insert into "Seller" (id, "ownerId", name, rating, "reviewCount", "responseRate", "verifiedSeller", "trustScore", "trustTier")
         values ($1, $2, $3, 0, 0, 100, false, $4, $5)`,
        [sellerId, sellerProfileId, SELLER.storefrontName, TRUST_BASE, TRUST_TIER],
      )
    }
    if (!s.listing) {
      // CREATE-ONLY publish (src/lib/compliance/public-state-writes.test.ts audits this insert). Defaults
      // carry the rest: VND / ₫, negotiable, postedAt now, identityHold false, searchText '' (see the header).
      // sellerTrustScore mirrors the storefront's score, as createListingCore writes it (the feed's ranking key).
      await c.query(
        `insert into "Listing" (id, "externalId", title, "titleVi", description, "descriptionVi", price, condition,
                                "listingType", "categoryId", "subcategorySlug", city, district, location, images,
                                "sellerId", "sellerTrustScore", verified, status, "soldAt", "updatedAt")
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, true, 'sold', now(), now())`,
        [
          listingId, LISTING.externalId, LISTING.title, LISTING.titleVi, LISTING.description, LISTING.descriptionVi,
          LISTING.price, LISTING.condition, LISTING.listingType, s.category.id, LISTING.subcategorySlug,
          LISTING.city, LISTING.district, LISTING.location, JSON.stringify(LISTING.images), sellerId, s.seller?.trustScore ?? TRUST_BASE,
        ],
      )
    }
    if (!s.convo) {
      // sellerProfileId = the storefront's owner, as POST /api/conversations sets it — the side Block resolves.
      await c.query(
        `insert into "Conversation" (id, "listingId", "buyerProfileId", "sellerId", "sellerProfileId")
         values ($1, $2, $3, $4, $5)`,
        [convoId, listingId, s.reviewer.id, sellerId, sellerProfileId],
      )
    }
    if (s.messageCount === 0) {
      // One minute apart, oldest first, ending a minute ago — and from now() in SQL, the clock the column
      // defaults use (a JS Date would be written in this machine's zone into a zone-less column).
      for (let i = 0; i < MESSAGES.length; i++) {
        const m = MESSAGES[i]
        await c.query(
          `insert into "Message" (id, "conversationId", "senderProfileId", body, "createdAt")
           values ($1, $2, $3, $4, now() - make_interval(mins => $5::int))`,
          [newId(), convoId, m.from === 'buyer' ? s.reviewer.id : sellerProfileId, m.body, MESSAGES.length - i],
        )
      }
      // What insertMessage (src/lib/messages.ts) keeps on the thread: last activity, the inbox preview
      // (every seeded body is under its 140-char cut — the test pins it), and each side's unread count.
      const t = threadCounters(MESSAGES)
      await c.query(
        `update "Conversation"
            set "lastMessageAt" = now() - make_interval(mins => 1), "lastMessageText" = $2, "buyerUnread" = $3, "sellerUnread" = $4
          where id = $1`,
        [convoId, t.lastText, t.buyerUnread, t.sellerUnread],
      )
    }
    if (s.blocks.length) {
      await c.query(
        `delete from "ForumUserBlock"
          where ("blockerProfileId" = $1 and "blockedProfileId" = $2) or ("blockerProfileId" = $2 and "blockedProfileId" = $1)`,
        [s.reviewer.id, sellerProfileId],
      )
    }
    if (s.convo?.buyerDeletedAt) {
      await c.query(`update "Conversation" set "buyerDeletedAt" = null where id = $1`, [convoId])
    }
    await c.query('commit')
  } catch (e) {
    await c.query('rollback').catch((rb) => console.error(`  (rollback failed too: ${rb.message})`))
    if (createdAuthUser) {
      console.error(`\n⛔ Rolled back — no database row was written. Auth user ${sellerProfileId} stays: it has no`)
      console.error(`   password and carries the seed marker, so the next run adopts it. Fix the cause and re-run.`)
    }
    throw e
  }
  return { sellerProfileId, sellerId, listingId, convoId }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.error) {
    console.error(args.error)
    process.exitCode = 1
    return
  }
  const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
  const SECRET = process.env.SUPABASE_SECRET_KEY
  const DB = process.env.DIRECT_URL
  if (!URL_ || !SECRET || !DB) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY / DIRECT_URL — run with node --env-file=.env')
    process.exitCode = 1
    return
  }
  // ⛔ The eno team cannot be blocked: a staff address on either side and the thread cannot test Block.
  // This is the shell's copy of ADMIN_EMAILS; production's lives in Secret Manager (eno-root-env).
  const staff = listedIn(process.env.ADMIN_EMAILS, [REVIEWER_EMAIL, SELLER.email])
  if (staff.length) {
    console.error(`⛔ ${staff.join(', ')} is in ADMIN_EMAILS — Block answers cannot_block_staff for the eno team, so this thread could not test it.`)
    process.exitCode = 1
    return
  }
  // ⚠️ With a marketplace allow-list armed, eno.vn shows only the sellers it names (src/lib/edition-scope.ts)
  // — the demo listing AND the thread would vanish there. Unset today; checked against this shell's copy.
  const allow = process.env.MARKETPLACE_ALLOWED_OWNER_EMAILS
  if (allow?.trim() && !listedIn(allow, [SELLER.email]).length) {
    console.warn(`⚠️  MARKETPLACE_ALLOWED_OWNER_EMAILS is set and does not name ${SELLER.email}: eno.vn would hide the demo listing and thread. Add it in BOTH env files.`)
  }

  // Imported here, not at the top, so the unit test can import this file's pure half with no client loaded.
  const { createClient } = await import('@supabase/supabase-js')
  const { Client } = await import('pg')
  const admin = createClient(URL_, SECRET, { auth: { autoRefreshToken: false, persistSession: false } })
  const c = new Client({ connectionString: DB })
  await c.connect()
  try {
    // ⛔ THE DRY RUN CANNOT WRITE, EVEN THROUGH A BUG: its reads run inside a READ ONLY transaction that is
    // rolled back. Transaction-scoped on purpose — a session-level SET could outlive this client on a pooled
    // server connection; a transaction cannot.
    let state
    if (!args.apply) await c.query('begin transaction read only')
    try {
      state = await readState(c, admin)
    } finally {
      if (!args.apply) await c.query('rollback')
    }
    printPlan(state, args)
    if (state.refusals.length) {
      process.exitCode = 1
      return
    }
    if (!args.apply) {
      console.log('\nDRY RUN — nothing was written. Re-run with --apply --gate=off to write.')
      if (state.listing && !state.live) process.exitCode = 1
      return
    }
    const ids = await write(state, c, admin)
    console.log(`\nDone. The demo seat's thread is ready:`)
    console.log(`  seller   : ${SELLER.email} (Profile ${ids.sellerProfileId}) · storefront /sellers/${ids.sellerId}`)
    console.log(`  listing  : /listings/${ids.listingId}`)
    console.log(`  thread   : /messages/${ids.convoId}  (sign in as ${REVIEWER_EMAIL} → Messages)`)
    console.log(`  Block shows only while \`ugc-safety\` is in NEXT_PUBLIC_APP_REVIEW_GATES (docs/ios-appstore-release.md P10).`)
    if (!state.live && state.listing) {
      console.error(`\n⛔ The listing is not as seeded (sold + verified) — see the warning above. The seat is not ready for review until it is.`)
      process.exitCode = 1
    }
  } catch (e) {
    console.error('FAILED:', e.message)
    process.exitCode = 1
  } finally {
    await c.end()
  }
}

if (invokedDirectly(import.meta.url)) await main()
