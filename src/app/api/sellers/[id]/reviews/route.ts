import { NextResponse, after } from 'next/server'
import { db } from '@/lib/db'
import { recordReview } from '@/lib/trust'
import { messagingGate } from '@/lib/enforcement'
import { maskEmailHandle } from '@/lib/utils'
import { ApiError, route } from '@/lib/api/handler'
import { removedReviewConversationNeedle } from '@/lib/reported-content'
import { refuseObjectionable } from '@/lib/ugc-filter'
import { SALE_FACTS_SELECT, saleFacts } from '@/lib/core/sale-loop'
import { mayReviewDeal } from '@/lib/trade-loop'
import { isSellerHiddenHere } from '@/lib/edition-scope'
import { SERVICE_DEAL, mayReviewServiceDeal, reviewBasis, undoCutoff, type DealRow, type ServiceDealKind } from '@/lib/service-deal'
import { dbNow, dealListingCompliance, isMissingRelation, lockDealRow, readDealConfirmation } from '@/lib/service-deal-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The service deal's conditional reviewId lock matched no row — the seller's undo, the buyer's "No" or a window won. */
/** The deal's listing was taken down, licence-held or unpublished after the rule read it (re-read under the lock). */
class DealListingClosed extends Error {}
class DealLockLost extends Error {}

/**
 * The service branch's refusals → the wire (spec v3 A3). ⚠️ ONE LITERAL `ApiError(…)` PER CODE (errors.test.ts harvests
 * that form). Anything else is the goods answer, not_transacted.
 */
function refuseServiceDeal(reason: string | null): never {
  if (reason === 'deal_withdrawn') throw new ApiError('deal_withdrawn', 403)
  if (reason === 'deal_declined') throw new ApiError('deal_declined', 403)
  if (reason === 'review_not_open') throw new ApiError('review_not_open', 403)
  if (reason === 'review_window_closed') throw new ApiError('review_window_closed', 403)
  throw new ApiError('not_transacted', 403)
}

/** Why the lock was lost, read off the row as it stands after the rollback (the same order the rule asks in). */
function lostLockReason(row: DealRow | null, now: Date): string {
  if (!row || row.revokedAt || !row.confirmedAt) return 'deal_withdrawn'
  if (row.declinedAt) return 'deal_declined'
  if (row.confirmedAt.getTime() > undoCutoff(now).getTime()) return 'review_not_open'
  if (now.getTime() - row.confirmedAt.getTime() > SERVICE_DEAL.REVIEW_WINDOW_DAYS * 86_400_000) return 'review_window_closed'
  return 'deal_withdrawn'
}

// POST /api/sellers/[id]/reviews — a REAL buyer reviews a seller after a
// transaction, making the storefront "Verified buyer" badge earnable.
//
// Server-side gate (Prisma bypasses RLS — these checks ARE the guard):
//   1. signed in (401)
//   2. the conversation exists (404)
//   3. the caller is that conversation's BUYER (403)
//   4. the conversation's listing belongs to seller [id] (403)
//   5. a transaction actually happened (mayReviewDeal): the listing was sold TO THE CALLER (named by the seller), OR an
//      offer in this thread was accepted while the sale record does not contradict it — never a taken-down listing,
//      never a buyer who said "No" (403 'not_transacted')
//   6. one review per conversation — the DB unique index on conversationId is the
//      dedup (P2002 → 409 'already_reviewed')
//   0. ⛔ THE EDITION BOUNDARY FIRST (spec v3 A7): a seller this edition hides (isSellerHiddenHere) is a 404 not_found on
//      EVERY path — goods, offer and service — exactly as the thread GET and the deal route answer for it.
//   5b. OR A SERVICE DEAL (owner 2026-11-11, SUPERSEDING rule 1 of the 2026-10-25 decision for rentals, services and
//      lessons only — goods keep 5): the SELLER confirmed in this thread that the rental / lesson / service happened
//      (POST /api/conversations/[id]/deal) and mayReviewServiceDeal holds — the deal's buyer, confirmed, not withdrawn,
//      not declined, not yet reviewed, the seller's 10-minute undo CLOSED (spec v3 A2 — now >= confirmedAt + 10 min),
//      within 30 days of the confirm, the deal's own storefront, not taken down. The Review carries `basis` = the deal's
//      kind and the deal's listingId, and it is written in ONE transaction with the conditional `reviewId` lock on the
//      DealConfirmation row (A3: reviewId, revokedAt and declinedAt all null, confirmedAt set and <= now − 10 min): the
//      seller's undo and the buyer's "No" are conditional updates of the same row, so only one can land. Lock lost →
//      rollback, 403 'deal_withdrawn' / 'deal_declined' / 'review_not_open'. 403 'review_window_closed' past the 30 days. Every code is reachable only by the thread's buyer (3 runs
//      first). ⛔ A basis review is NOT a trust input (A4 — trust.ts reads basis IS NULL only); it counts in the shown
//      rating and count.
//      ⛔ THE ROW DECIDES (2026-11-11): once a DealConfirmation exists, 5b reads the kind, the listing and the storefront
//      off the ROW (deal.kind, deal.listingId, deal.sellerId) — never the listing's CURRENT listingType / category, so a
//      seller cannot refuse the review by switching the listing to 'wanted' or 'sell' after confirming. Only a takedown
//      of the deal's listing (moderation) still refuses it.
//      ⛔ THE OFFER PATH WINS (2026-11-11): when 5 already qualifies, the review is the plain one (basis null — it counts
//      in trust Q and reads "Verified buyer"); 5b runs only when 5 does not. A deal row in that thread is still linked
//      to the plain review (a conditional reviewId update; a lost race is ignored), so the deal reads 'reviewed'.
//      ⚠️ MIGRATION TOLERANCE: the deal row is read in its own findUnique on EVERY listing thread; a missing table reads
//      as "no deal", and any other failed read is ignored when 5 qualifies (the goods path never fails over the deal
//      table) and thrown only when 5b is the caller's one way in. The goods path never selects or writes `basis`.
//
// ⚠️ WS6 MIGRATION — auth + the limiter become options, in the order they already ran (auth →
// limiter → enforcement gate → body). Every code above is unchanged, plus 429 `rate_limited`.
//
// ⚠️ `auth: 'profile'` — the handler needs the ROW, not just the id: `me.displayName` and `me.email`
// are what the public review author line is built from.
//
// ⚠️ NOT `strict` — the original limiter was fail-open and leaving a review is neither paid nor
// PII-adjacent; failing it closed during a limiter blip would block honest buyers and protect nothing.
//
// ⚠️ THE ENFORCEMENT GATE STAYS A RAW Response: messagingGate() returns its own body
// (`{"error":"account_suspended"}`, a code absent from errors.ts) at 403. Forwarding the object keeps
// that string on the wire rather than renaming it. Reported, not added.
//
// ⚠️ NO `body:` SCHEMA even though malformed JSON already answers `bad_request` — the wrapper's
// default code would match, but its VALIDATION would not: `String(body.conversationId || '')` accepts
// a number and turns it into a 404, where a zod schema would 400 it. The hand parse stays verbatim.
//
// ⚠️ SUCCESS IS 201, so it is a returned Response, not a plain object (route() would default to 200).
//
// ⚠️ ONE BRANCH IS NOT BYTE-IDENTICAL: the `throw e` re-raise on an unrecognised Prisma error (and
// the unwrapped reads before it) used to reach Next's default 500. route() now catches it, logs with
// an `op`, and returns `{"error":"internal_error"}` 500 — an improvement, but a wire change there.
export const POST = route({ auth: 'profile', rateLimit: { bucket: 'review-create', limit: 10, window: '1 h' } }, async ({ req, params, profile: me }) => {
  const id = params.id

  // Enforcement (trust Phase 2): a suspended account can't leave reviews.
  const gate = await messagingGate(me.id)
  if (gate) return NextResponse.json(gate, { status: 403 })

  let body: { conversationId?: string; rating?: number; text?: string }
  try { body = await req.json() } catch { throw new ApiError('bad_request', 400) }
  const conversationId = String(body.conversationId || '')
  const rating = Number(body.rating)
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!conversationId || !Number.isInteger(rating) || rating < 1 || rating > 5 || text.length > 600) {
    throw new ApiError('bad_request', 400)
  }
  // 0 — the edition boundary (header): a storefront this edition hides cannot be reviewed here, by any path.
  if (await isSellerHiddenHere(id)) throw new ApiError('not_found', 404)

  const convo = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, buyerProfileId: true, listing: { select: { id: true, sellerId: true, listingType: true, verified: true, verificationNotes: true, category: { select: { slug: true } }, ...SALE_FACTS_SELECT } } },
  })
  if (!convo) throw new ApiError('not_found', 404)
  // Only the conversation's BUYER may review (the seller is the subject).
  if (convo.buyerProfileId !== me.id) throw new ApiError('forbidden', 403)
  /* ⛔ A SUPPORT THREAD IS NOT REVIEWABLE. A review is about a storefront's handling of a
     LISTING — it carries listingId, and the transaction signal below reads the listing's status.
     A thread with no listing satisfies none of that, so it is refused before any of it is read. */
  if (!convo.listing) throw new ApiError('forbidden', 403)
  // The reviewed storefront must own the listing this conversation is about.
  if (convo.listing.sellerId !== id) throw new ApiError('forbidden', 403)

  // Transaction signal (trade-loop.ts mayReviewDeal — the thread GET's review-card flags are the same call): the sale
  // names THIS caller as its eno buyer, awaiting their answer or confirmed by them; or an offer in THIS thread was
  // accepted while the sale record does not contradict it (unsold, or sold with nobody named). Never a listing taken
  // down by authority order, never a buyer who said "No".
  // ⚠️ "Sold" alone used to count (security review 2026-10-22, item 32; sweep 2026-10-22): anyone who had messaged about
  // an item that later sold to SOMEONE ELSE could post a "Verified buyer" review, which also feeds distinctBuyerReviews
  // and the trust tier. ⛔ An accepted offer is never revoked (offers.ts: no expiry, no sweeper), so it cannot outvote a
  // sale to someone else, to "someone not on eno", or the caller's own "No" (refute review, 2026-10-23).
  const facts = saleFacts(convo.listing)
  const transacted = mayReviewDeal(facts, me.id, false) || (
    mayReviewDeal(facts, me.id, true) &&
    (await db.message.count({ where: { conversationId, kind: 'offer', offerStatus: 'accepted' } })) > 0
  )
  // 5b — the service deal (header). ⛔ THE ROW DECIDES: read on EVERY listing thread (a seller who switched a confirmed
  // rental to 'sell' or 'wanted' must not hide it), tolerantly — a failed read never costs a goods / offer review.
  const now = new Date()
  let deal: DealRow | null = null
  let dealReadError: unknown = null
  try {
    deal = await readDealConfirmation(conversationId)
  } catch (e) {
    dealReadError = e
  }
  // ⛔ THE OFFER PATH WINS (header): 5b only when 5 does not qualify.
  let serviceKind: ServiceDealKind | null = null
  if (!transacted) {
    // The deal is this caller's only way in, so an unreadable row is the retryable 500, never a "can't review" answer
    // that would put the buyer's card away for good.
    if (dealReadError) throw dealReadError
    const kind = deal ? reviewBasis(deal.kind) : null
    const service = deal && kind
      ? mayReviewServiceDeal(deal, me.id, { sellerId: id, complianceStatus: await dealListingCompliance(deal, convo.listing) }, now)
      : null
    if (!service?.ok) refuseServiceDeal(service && !service.ok ? service.reason : null)
    serviceKind = kind
  }
  // A review a moderator REMOVED (App Store gate `ugc-safety`, plan R5) does not come straight back. The
  // removal deleted the row (Review has no status column), which freed this conversation's one-review slot;
  // the moderation log remembers the deal (src/lib/reported-content.ts reviewRemovalNote), and the answer is
  // the one-review-per-conversation code the review prompt already treats as "done" (codex + opus, gate
  // round 1). NOT gated: a removal made while the gate was on still holds if it goes off (opus, round 5) —
  // and with no removal on record (all there can be until the gate is on) the answer is exactly as before.
  const removedBefore = await db.forumModerationAction.findFirst({
    where: { targetProfileId: me.id, action: 'remove', reason: 'review', note: { contains: removedReviewConversationNeedle(conversationId) } },
    select: { id: true },
  })
  if (removedBefore) throw new ApiError('already_reviewed', 409)
  // App Store gate `ugc-safety` (plan R5): a review with a slur, a threat or sexual solicitation in it is
  // refused (the severe-only filter, src/lib/ugc-filter.ts) — after every eligibility check, so an
  // ineligible caller still hears why they cannot review at all. Off ⇒ nothing is scanned.
  if (text && await refuseObjectionable('review', text)) throw new ApiError('objectionable_content', 400)

  // Never expose the email local part on a PUBLIC surface (it's often a full name).
  const author = me.displayName || maskEmailHandle(me.email) || 'Buyer'
  let review: { id: string } | null = null
  let basis: ServiceDealKind | null = null
  if (serviceKind && deal) {
    const kind = serviceKind
    try {
      review = await db.$transaction(async (tx) => {
        await lockDealRow(tx, conversationId)
        const txNow = await dbNow(tx)
        // The deal's listing re-read UNDER the lock (codex, round 3): a takedown, a licence hold or an unpublish that committed
        // after the rule read it still closes the card here.
        const held = await tx.listing.findUnique({ where: { id: deal.listingId }, select: { complianceStatus: true, verified: true, verificationNotes: true } })
        if (!held || held.complianceStatus === 'taken_down' || held.verified === false || held.verificationNotes === 'licence:held') throw new DealListingClosed()
        const r = await tx.review.create({
          data: { sellerId: id, author, rating, text, authorProfileId: me.id, listingId: deal.listingId, conversationId, basis: kind },
          select: { id: true },
        })
        // ⛔ THE LOCK (spec v3 A3). Conditional on everything the rule read — not reviewed, not withdrawn, not declined,
        // confirmed, the undo CLOSED (confirmedAt <= now − 10 min: the withdraw's WHERE asks the opposite), still inside
        // the 30 days — so a concurrent undo or "No" (the same row, deal/route.ts) and this cannot both land.
        const lock = await tx.dealConfirmation.updateMany({
          where: {
            conversationId, buyerProfileId: me.id, reviewId: null, revokedAt: null, declinedAt: null,
            // Judged on the DATABASE's clock at the write (dbNow), the clock the confirm and the undo use.
            confirmedAt: { not: null, lte: undoCutoff(txNow), gte: new Date(txNow.getTime() - SERVICE_DEAL.REVIEW_WINDOW_DAYS * 86_400_000) },
          },
          data: { reviewId: r.id },
        })
        if (lock.count !== 1) throw new DealLockLost()
        return r
      })
      basis = kind
    } catch (e) {
      const code = (e as { code?: string })?.code
      // The seller's undo, the buyer's "No" (another device) or a window won — the refusal names what stands now. (No
      // plain review to fall back on: this path runs only when 5 does not qualify.)
      if (e instanceof DealLockLost) refuseServiceDeal(lostLockReason(await readDealConfirmation(conversationId).catch(() => null), now))
      // The card's own words for it (opus, round 4): the same refusal a takedown read before the lock answers, so the card goes.
      if (e instanceof DealListingClosed) throw new ApiError('not_transacted', 403)
      // Review.basis or the deal table is not in this database yet (scripts/deal-confirmation-ddl.mjs): the retryable 503
      // the goods path already answers before its own migration.
      if (isMissingRelation(e)) throw new ApiError('migration_pending', 503)
      if (code === 'P2002') throw new ApiError('already_reviewed', 409)
      throw e
    }
  } else {
    try {
      const plain = {
        data: { sellerId: id, author, rating, text, authorProfileId: me.id, listingId: convo.listing.id, conversationId },
        select: { id: true },
      } as const
      // THE OFFER PATH WON (header) over a deal this thread also holds: the plain review and its link to the deal are ONE
      // transaction under the deal row's lock (codex, round 3), so the deal reads 'reviewed' the moment the review exists — a
      // concurrent "No", confirm or undo waits on the same lock and then sees it (they re-check for a review under it), and a
      // failed link cannot leave a reviewed thread whose deal is still open.
      review = deal
        ? await db.$transaction(async (tx) => {
          await lockDealRow(tx, conversationId)
          const r = await tx.review.create(plain)
          await tx.dealConfirmation.updateMany({ where: { conversationId, reviewId: null }, data: { reviewId: r.id } })
          return r
        })
        : await db.review.create(plain)
    } catch (e) {
      const code = (e as { code?: string })?.code
      // The unique index on conversationId = one review per conversation.
      if (code === 'P2002') throw new ApiError('already_reviewed', 409)
      // Pre-migration DB (scripts/add-review-cols.mjs not yet run): the provenance
      // columns don't exist → retryable 503 instead of a 500, so this code can
      // deploy before the migration in any order.
      if (code === 'P2022' || /column .* does not exist/i.test(String((e as Error)?.message))) {
        throw new ApiError('migration_pending', 503)
      }
      throw e
    }
  }

  // After the response flushes (zero added latency): refresh the storefront's
  // denormalized rating/reviewCount, and credit the seller's OWNER with the
  // verified-review trust event. Guest sellers (ownerId null) have no Profile to
  // attach an event to → skip trust silently (penalizeSeller's convention).
  after(async () => {
    try {
      const [seller, agg] = await Promise.all([
        db.seller.findUnique({ where: { id }, select: { ownerId: true } }),
        db.review.aggregate({ where: { sellerId: id }, _avg: { rating: true }, _count: { _all: true } }),
      ])
      await db.seller.update({
        where: { id },
        data: { rating: agg._avg.rating ?? rating, reviewCount: agg._count._all },
      })
      // ⛔ NOT for a service-deal review (spec v3 A4): it is no trust input at all — no positive_review event, no
      // positiveInteractions tick. It still moved the shown rating and count just above.
      if (seller?.ownerId && !basis) await recordReview(seller.ownerId)
    } catch (err) {
      console.error('[reviews] post-create denorm/trust failed', err)
    }
    // The service deal's audit line (DealConfirmationEvent — the row itself was locked in the transaction).
    if (basis && deal) {
      try {
        await db.dealConfirmationEvent.create({
          data: { conversationId, listingId: deal.listingId, sellerId: id, actorProfileId: me.id, buyerProfileId: me.id, action: 'reviewed' },
        })
      } catch (err) {
        console.error('[reviews] deal event failed', err)
      }
    }
  })

  return NextResponse.json({ ok: true, id: review.id }, { status: 201 })
})
