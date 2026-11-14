import type { Prisma } from '@/generated/prisma/client'

/**
 * THE STORE-REVIEW SEATS' ADDRESSES — the shared password logins eno hands to the review teams of the STORES that list it
 * (scripts/review-seats.mjs: Google Play, the App Store, the AI-app marketplaces). Every "seat" below, every guard that
 * reads isReviewSeatEmail, NOT_A_REVIEW_SEATS_LISTING or notAReviewSeatsListingSql, means these three and nothing else.
 *
 * ⛔ THE LAWYER SEAT IS OUT, ON PURPOSE (round 4, 2026-11-14). lawyer-review@eno.vn (REVIEW_SEATS.lawyer) is one trusted
 * person, not a store's rotating review team — and it OWNS A REAL STOREFRONT, Luật Hoàng Phi (scripts/seed-hoangphi.ts),
 * whose buyer chats it answers. A teacher asking that law firm about a work permit must be answered, and its listings
 * publish like any partner's. So no guard here touches it; review-seat-accounts.test.ts pins it out, with this reason.
 *
 * A store reviewer is not a school, so a seat never reaches a real teacher: it never reveals a teacher's Zalo
 * (teachers/zalo.ts viewerOf), never reads what a teacher shared — phone, email, CV — nor a teacher's number through a
 * listing (api/teachers/contact, api/teachers/cv, api/listings/[id]/contact — round 5: a share or a reply made before
 * these rules still stands), never opens, writes into or rings a teacher chat — a cover request included
 * (teachers/dm-quota.ts teacherDmTier, api/teachers/video-request) — nor, in ANY thread and in either role, writes, reacts,
 * answers an offer, confirms a deal, asks "did you buy this?" or calls a teacher (review-seat-listings.ts
 * reviewSeatMeetsTeacher: api/conversations, its messages/offer/deal routes, api/messages/[id]/reactions,
 * api/listings/[id]/sold, calls/server/eligibility.ts callPermit) — eno never offers a seat's
 * job post to teachers (NOT_A_REVIEW_SEATS_LISTING below), and a seat's new listings are never public, a teacher profile
 * least of all (REVIEW_SEAT_HELD_NOTE below), so a job post a seat makes now can never draw a teacher into its thread (one it
 * had live before these rules can, and the seat never writes back — reviewSeatMeetsTeacher).
 *
 * ⛔ EVERY SEAT, WHATEVER ITS ACCOUNT TYPE (codex + opus, 2026-11-14). The server never reads a message's words, so it
 * cannot tell a cover request from any other line — and any seat can switch itself between personal and business
 * (api/profile/account-type). So the guard is the address alone, never the voice.
 *
 * ⛔ ONCE A SEAT, ALWAYS ONE: the guards read Profile.email, and a seat can change its sign-in address itself (Settings ›
 * Change email). ensureProfile (src/lib/profile.ts) therefore never moves a Profile off a seat's address — the row, by
 * its id, stays a seat.
 *
 * ⚠️ A COPY, ON PURPOSE. scripts/review-seats.mjs is the table the account scripts read, and it carries their own fields
 * (credential files, env prefixes, hand-off notes) that have no place in the app; this is the app's half — the addresses
 * only. src/lib/review-seat-accounts.test.ts imports that table and pins the two together: every seat it defines but the
 * lawyer's must be here (a store seat the guard does not know fails the suite), the lawyer's must not, and nothing here may
 * be anything but a store seat's address.
 * `ai-review@eno.vn` is here BEFORE its row lands in the table (the AI seat's branch): the guard is in place before the
 * account exists, and the test names it as the one address still on its way.
 *
 * ⛔ EXACT, CASE-INSENSITIVE, AFTER TRIM — NEVER A DOMAIN MATCH: @eno.vn is the staff's domain as well as the seats'.
 */
export const STORE_REVIEW_SEAT_EMAILS: readonly string[] = Object.freeze([
  'play-review@eno.forum',
  'app-review@eno.vn',
  'ai-review@eno.vn',
])

/**
 * Is this address one of the STORE-REVIEW seats (STORE_REVIEW_SEAT_EMAILS — never the lawyer's)? Exact, case-insensitive
 * after trim; anything that is not a string is not.
 */
export function isReviewSeatEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && STORE_REVIEW_SEAT_EMAILS.includes(email.trim().toLowerCase())
}

/**
 * A listing no review seat owns — for the reads that OFFER jobs to real teachers on eno's own initiative (the job DMs,
 * teachers/job-dms/run.ts loadJobs; the match emails, teachers/match-emails.ts mailableMatchWhere; the matcher's export
 * and import, scripts/teachers-match.ts) and for every write that publishes an existing row (below). A seat's job post
 * (a reviewer testing create_listing) is never pushed to a teacher.
 *
 * ⛔ CASE-INSENSITIVE, LIKE THE CREATE HOLD (opus, round 3): ownerIsReviewSeat (review-seat-listings.ts) judges with
 * isReviewSeatEmail, which ignores case and spacing, so a row it held must never slip past this filter for an owner whose
 * stored address differs in case — `mode: 'insensitive'` compiles to `LOWER(email) IN (LOWER($n), …)` (checked against
 * this repo's Prisma 7 client). Spacing has no Prisma form: Profile.email is the auth server's address, which carries none,
 * and every admin publish first refuses by reviewSeatListingIds, which reads the addresses and matches them with
 * isReviewSeatEmail itself — so the admin paths and the create hold agree exactly; the SQL form below trims too.
 *
 * ⛔ NULL-SAFE, OR IT DROPS REAL SCHOOLS (opus, round 2 — compiled against this repo's Prisma 7 client): `NOT (email IN
 * (…))` over a NULL email is NULL, and a NULL WHERE drops the row. Profile.email is nullable and live code writes NULL
 * into it — the trap src/lib/site-stats.ts:158-164 measured. The `not: null` puts `AND email IS NOT NULL` inside the NOT,
 * so the inner test is FALSE, never NULL, for such an owner: an ownerless seller (a board import) or a no-email owner is
 * KEPT; a seat's listings are still left out.
 */
export const NOT_A_REVIEW_SEATS_LISTING = {
  NOT: { seller: { owner: { email: { in: [...STORE_REVIEW_SEAT_EMAILS], mode: 'insensitive', not: null } } } },
} satisfies Prisma.ListingWhereInput

/**
 * ⛔ A REVIEW SEAT'S NEW LISTINGS ARE NEVER PUBLIC (round 3, 2026-11-14). Every listing a seat creates — the post
 * wizard, the partner REST API and the Partner MCP (core/listings.ts createListingCore), the bulk and sync paths
 * (core/bulk.ts bulkImportCore, which core/sync.ts creates through) — is written `verified: false` with this mark: the
 * state the MCP reports as "waits for eno's check". NEVER `identityHold`, so releaseIdentityHolds has nothing to
 * release. The mark only says WHY in the admin queue: an admin takedown or a move out of a licence aisle may clear it,
 * so the rule is the OWNER (review-seat-listings.ts reviewSeatListingIds) — every admin publish refuses a seat's row
 * (api/admin/listings activate/verify/licence-approve, api/admin/moderate approve), and the publishing writes AND
 * NOT_A_REVIEW_SEATS_LISTING.
 * ⛔ AND A SEAT NEVER HAS A TEACHER PROFILE (round 4 — codex + opus): the teacher form writes its listing live
 * (`verified: true`, teachers/publish.ts), so saveTeacherProfile refuses a seat outright — a create and an edit alike,
 * before anything is read or copied — and api/teachers/me/status refuses to show one a seat already had.
 * ⛔ NO SELLER DOOR PUTS A SEAT'S SOLD OR HIDDEN LISTING BACK ON — ANY TYPE (round 5 — codex + opus, round 4). The
 * hold above covers what a seat creates from now on; a row it made BEFORE it may still be verified, and a move back to
 * active makes such a row public by its status alone. So both seller revives refuse every row a seat owns, verified or
 * not, with 403 `review_seat_listing`: core/listings.ts setStatusCore (the dashboard's Relist, /api/v1 and MCP
 * set_listing_status, a sync's re-send) and confirmCore ("still available" on a sold or hidden row — /api/listings and
 * /api/v1 confirm). Hiding, marking sold and deleting stay open. What this does NOT do: take down a seat's row that is
 * live today (nothing here sweeps one; a hold's lift — enforcement.ts restoreListings — puts back only rows that were
 * live when the hold pulled them), nor guard an operator's one-off script (scripts/teacher-sold-restore.ts, run on
 * 2026-10-27) — those are operator acts, not doors a seat can reach.
 */
export const REVIEW_SEAT_HELD_NOTE = 'review-seat:held'

/**
 * What every seat-side door says when a seat's listing is refused back on (403 `review_seat_listing`) or saved
 * unpublished (round 5): one neutral line that promises nothing, since no check publishes a seat's listing. The session
 * routes send the pair as `message: { en, vi }` (the native dashboards), /api/v1 and the MCP the English. ⚠️ A web client
 * words it with a LITERAL tr() pair carrying these same sentences (scripts/gen-ui-strings.mjs harvests literals) — the
 * post wizard's line adds "Saved." in front.
 */
export const REVIEW_SEAT_LISTING_COPY = {
  en: 'Listings from this account are not shown publicly.',
  vi: 'Tin đăng của tài khoản này không hiển thị công khai.',
} as const

/**
 * NOT_A_REVIEW_SEATS_LISTING for a raw-SQL client (scripts/publish-held.ts, scripts/release-identity-holds.ts): the row
 * at `alias` (a table alias with its dot, e.g. 'l.'; none = the table itself, `"Listing".` — never a bare "sellerId" a
 * subquery table could capture) has no seller whose owner holds a seat's address. NOT EXISTS, so an ownerless seller or a
 * NULL email is kept, exactly as the Prisma form. The addresses are this module's constants, checked to be plain
 * lowercase addresses before they are inlined (review-seat-accounts.test.ts pins it) — no input ever reaches the string.
 */
export function notAReviewSeatsListingSql(alias = ''): string {
  if (alias !== '' && !/^[a-z]\w*\.$/.test(alias)) throw new Error(`notAReviewSeatsListingSql: bad alias ${JSON.stringify(alias)}`)
  for (const e of STORE_REVIEW_SEAT_EMAILS) if (!/^[a-z0-9.+-]+@[a-z0-9.-]+$/.test(e)) throw new Error(`notAReviewSeatsListingSql: not a plain address ${JSON.stringify(e)}`)
  const list = STORE_REVIEW_SEAT_EMAILS.map((e) => `'${e}'`).join(', ')
  return `NOT EXISTS (SELECT 1 FROM "Seller" rs JOIN "Profile" rp ON rp.id = rs."ownerId" WHERE rs.id = ${alias || '"Listing".'}"sellerId" AND lower(btrim(rp.email)) IN (${list}))`
}
