import { NextResponse, after } from 'next/server'
import { db } from '@/lib/db'
import { ENFORCEMENT_REASON, flagForReview, messagingGate } from '@/lib/enforcement'
import { ApiError, route } from '@/lib/api/handler'
import { insertMessage } from '@/lib/messages'
import { threadKind } from '@/lib/thread-kind'
import { isSellerHiddenHere } from '@/lib/edition-scope'
import { isBlockedBetween } from '@/lib/user-blocks'
import {
  DEAL_WITHDRAWN_LINE, SERVICE_DEAL, canConfirmDeal, canWithdrawDeal, confirmsLeft, dealConfirmedLine, dealState, declinesWarrantFlag,
  mayReviewServiceDeal, reviewBasis, serviceDealInScope, undoCutoff, withdrawUntil, type DealRow, type ServiceDealDenyReason, type ServiceDealKind,
} from '@/lib/service-deal'
import { DEAL_ROW_SELECT, dbNow, dealListingCompliance, isEnoDeskThread, isMissingRelation, lockDealRow, readDealConfirmation } from '@/lib/service-deal-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/conversations/[id]/deal — THE SERVICE-DEAL LOOP'S ONE WRITE PATH (src/lib/service-deal.ts holds the rules;
 * owner 2026-11-11: "a renter, student or client can review once the seller confirms in chat that the rental or lesson
 * happened"). Body `{ action, listingId? }`:
 *   · 'confirm'  — the SELLER says the rental / lesson / service in this thread happened. `listingId` is the listing the
 *                  dialog showed (a SNAPSHOT: the 15 s poll can retarget a thread while the dialog is open — 409
 *                  listing_changed when it no longer matches). Writes the DealConfirmation row + a 'confirm' event, then
 *                  the server-authored 'deal_confirmed' timeline line.
 *   · 'withdraw' — the SELLER's undo: only while now < confirmedAt + WITHDRAW_WINDOW_MINUTES (spec v3 A2 — the buyer's
 *                  next message no longer closes it). After that the confirmation stands; only an admin removes it, through
 *                  a Report on the thread: Admin › Moderation's ⋯ "Undo the seller's confirmation" (POST
 *                  /api/admin/moderate 'withdraw-deal' → service-deal-server.ts adminWithdrawDeal — not this route).
 *   · 'decline'  — the BUYER's "No, this didn't happen" from the review card, which opens only when now >= confirmedAt +
 *                  WITHDRAW_WINDOW_MINUTES (A2 — undo and review never overlap): the deal is marked declined by a
 *                  CONDITIONAL update (A3), no review is possible on it and it can never be confirmed again, and 3 declines
 *                  of one seller's deals in 90 days (counted from the 'declined' EVENTS, which survive erasure) raise a
 *                  SILENT admin annotation under its own flag reason 'deal_declines' (never public). Decided from the
 *                  DealConfirmation row, never from the listing's current type (only a takedown still refuses).
 *
 * Checks, in order — identity BEFORE outcome, so a stranger learns nothing about the thread:
 *   auth 'profile' → limiter (fail-open) → messagingGate (the caller) → body → 404 unknown thread or a seller hidden on
 *   this edition (the thread GET's rule) → 403 forbidden for anyone but the thread's seller-who-owns-the-storefront
 *   (confirm / withdraw) or its buyer (decline) → 409 listing_changed → 403 not_reviewable unless the thread is in scope
 *   (an ordinary 'listing' thread, never one of eno's desks by seller AND by listing, never taken down, a rental / lesson /
 *   service listing) → the pure rule's refusals → the conditional write.
 *
 * ⛔ A CONFIRMATION MINTS NOTHING (no trust, no rating, no probation lift, nothing public) and changes nothing public, so
 * nothing is revalidated. The buyer is told by the timeline line's ordinary unread / inbox path.
 * ⛔ THE CAPS: the limiter here fails OPEN (handler.ts); behind it, a fail-CLOSED count of this seller's 'confirm' events in
 * the last rolling 24 h refuses the 21st (429 confirm_cap) — counted once before, and AGAIN inside the confirm transaction
 * under a per-seller pg_advisory_xact_lock, so twenty parallel confirms on twenty threads cannot all pass the first count —
 * and MAX_CONFIRMS_PER_THREAD bounds each thread for ever.
 * ⚠️ MIGRATION: before scripts/deal-confirmation-ddl.mjs has run, a write answers 503 migration_pending (never a 500).
 */

/**
 * Pure-rule refusals → the wire. Identity refusals are a plain `forbidden`, whatever the state. ⚠️ ONE LITERAL `ApiError(…)`
 * PER CODE, NOT A LOOKUP TABLE: src/lib/api/errors.test.ts harvests the wire from exactly that form, and a code reached
 * through a table would read as "emitted by no route".
 */
function refuse(reason: ServiceDealDenyReason): never {
  switch (reason) {
    case 'not_seller':
    case 'not_the_buyer': throw new ApiError('forbidden', 403)
    case 'buyer_is_seller': throw new ApiError('buyer_is_seller', 403)
    case 'not_reviewable':
    case 'listing_unavailable': throw new ApiError('not_reviewable', 403)
    case 'blocked': throw new ApiError('blocked', 403)
    case 'already_reviewed': throw new ApiError('already_reviewed', 409)
    case 'deal_declined': throw new ApiError('deal_declined', 409)
    case 'confirm_budget_spent': throw new ApiError('confirm_budget_spent', 409)
    case 'too_few_messages': throw new ApiError('too_few_messages', 403)
    case 'not_yet_confirmable': throw new ApiError('not_yet_confirmable', 403)
    case 'confirm_cap': throw new ApiError('confirm_cap', 429)
    case 'not_confirmed':
    case 'deal_withdrawn': throw new ApiError('not_confirmed', 409)
    case 'withdraw_window_closed': throw new ApiError('withdraw_window_closed', 409)
    case 'review_not_open': throw new ApiError('review_not_open', 403)
    case 'review_window_closed': throw new ApiError('review_window_closed', 409)
  }
}

/** A conditional write matched nothing — someone else's write (a double tap, the buyer's review) landed first. */
class DealRaceLost extends Error {}
/** The recount under the per-seller advisory lock reached the daily cap — the transaction rolls back. */
/** The thread was moved to another listing between the dialog and the write (retargetForListing, under the same row lock). */
class ListingMoved extends Error {}
/** The listing was taken down, licence-held or unpublished after the scope read (re-read under the thread's lock). */
class ListingClosed extends Error {}
/** A review landed on the thread while the "No" waited for the deal row's lock. */
class AlreadyReviewed extends Error {}
class ConfirmCapReached extends Error {}

const DAY_MS = 86_400_000

export const POST = route({ auth: 'profile', rateLimit: { bucket: 'deal-confirm', limit: 40, window: '1 d' } }, async ({ req, params, profile: me }) => {
  const id = params.id
  // Enforcement: a suspended account confirms, withdraws and declines nothing (the gate's own body, as the review POST).
  const gate = await messagingGate(me.id)
  if (gate) return NextResponse.json(gate, { status: 403 })

  let body: { action?: unknown; listingId?: unknown }
  try { body = await req.json() } catch { throw new ApiError('bad_request', 400) }
  const action = body?.action
  if (action !== 'confirm' && action !== 'withdraw' && action !== 'decline') throw new ApiError('bad_request', 400)
  const snapshot = typeof body.listingId === 'string' && body.listingId ? body.listingId : null
  if (action === 'confirm' && !snapshot) throw new ApiError('bad_request', 400)

  const convo = await db.conversation.findUnique({
    where: { id },
    select: {
      id: true, listingId: true, buyerProfileId: true, sellerProfileId: true,
      listing: { select: { id: true, sellerId: true, listingType: true, status: true, complianceStatus: true, verified: true, verificationNotes: true, category: { select: { slug: true } } } },
      seller: { select: { id: true, ownerId: true } },
      // Read for the confirm rule only, and only as an age — never sent to anyone. ⛔ NOT Profile.phone: PATCH /api/profile
      // writes it without an OTP (admin.ts getVerifiedPhone). The verified phone is the trust event read below.
      buyer: { select: { createdAt: true } },
    },
  })
  if (!convo) throw new ApiError('not_found', 404)
  // The thread GET's edition rule: a thread with a seller this edition hides does not exist here.
  if (await isSellerHiddenHere(convo.seller.id)) throw new ApiError('not_found', 404)

  const now = new Date()

  // ── THE BUYER'S "No, I didn't" ────────────────────────────────────────────────────────────────────────────────────────
  if (action === 'decline') {
    if (convo.buyerProfileId !== me.id) throw new ApiError('forbidden', 403)
    const deal = await readDealConfirmation(id)
    // Exactly the card this rule shows: the deal's buyer, confirmed, not withdrawn / reviewed, the undo closed (A2), in the
    // window. ⛔ THE ROW DECIDES (service-deal-server.ts dealListingCompliance): no scope check on the listing's CURRENT
    // type — a seller who switched it to 'wanted' or 'sell' after confirming cannot take the buyer's "No" away; only a
    // takedown of the deal's own listing closes it.
    const may = mayReviewServiceDeal(deal, me.id, { sellerId: convo.seller.id, complianceStatus: deal ? await dealListingCompliance(deal, convo.listing) : null }, now)
    if (!may.ok) {
      if (may.reason === 'deal_declined') return { ok: true, state: 'declined' } // an idempotent re-tap
      refuse(may.reason)
    }
    if (await db.review.findUnique({ where: { conversationId: id }, select: { id: true } })) refuse('already_reviewed')
    const d = deal!
    try {
      await db.$transaction(async (tx) => {
        // The row's lock first, then the database's clock (dbNow's rule): the deadlines are judged after any wait.
        await lockDealRow(tx, id)
        const t = await dbNow(tx)
        // A review that landed meanwhile (the offer path's plain review links the deal under this same lock) — re-checked
        // UNDER the lock, so a "No" can never land on a reviewed thread nor flag the seller for it (codex, round 3).
        if (await tx.review.findUnique({ where: { conversationId: id }, select: { id: true } })) throw new AlreadyReviewed()
        // ⛔ CONDITIONAL (spec v3 A3): not reviewed, not declined, not withdrawn, confirmed, and the undo closed — the same
        // facts the rule read, re-asserted on the row, so the seller's undo, the buyer's own review or a second "No" cannot
        // race it.
        const r = await tx.dealConfirmation.updateMany({
          where: {
            conversationId: id, buyerProfileId: me.id, reviewId: null, declinedAt: null, revokedAt: null,
            // The undo's close and the 30-day window, judged on the DATABASE's clock at the write (dbNow), not the request's.
            confirmedAt: { not: null, lte: undoCutoff(t), gte: new Date(t.getTime() - SERVICE_DEAL.REVIEW_WINDOW_DAYS * DAY_MS) },
          },
          data: { declinedAt: t },
        })
        if (r.count !== 1) throw new DealRaceLost()
        await tx.dealConfirmationEvent.create({
          data: { conversationId: id, listingId: d.listingId, sellerId: d.sellerId, actorProfileId: me.id, buyerProfileId: me.id, action: 'declined' },
        })
      })
    } catch (e) {
      if (e instanceof AlreadyReviewed) refuse('already_reviewed')
      if (e instanceof DealRaceLost) {
        // The seller's undo or the buyer's own review landed first — answer with what stands now.
        const again = await readDealConfirmation(id)
        if (again?.declinedAt) return { ok: true, state: 'declined' }
        if (again?.reviewId) refuse('already_reviewed')
        if (again?.confirmedAt && !again.revokedAt && again.confirmedAt.getTime() > undoCutoff(now).getTime()) refuse('review_not_open')
        refuse('not_confirmed')
      }
      if (isMissingRelation(e)) throw new ApiError('migration_pending', 503)
      throw e
    }
    // The seller flag (spec v2 §4): SILENT — an annotation in the admin console, never public, never notified — under its
    // OWN flag reason (ENFORCEMENT_REASON.DEAL_DECLINES, one of FLAG_REASONS, so every ladder query and the seller's own
    // dashboard / appeal reads exclude it; the console labels it). ⛔ COUNTED FROM THE EVENTS ('declined' by storefront,
    // rolling 90 days), never from DealConfirmation rows: account erasure deletes the rows but keeps the events (spec v3
    // A5), so a buyer erasing their account cannot wipe a seller's record. After the response, never failing it.
    after(async () => {
      try {
        const since = new Date(now.getTime() - SERVICE_DEAL.DECLINE_FLAG_WINDOW_DAYS * DAY_MS)
        const declines = await db.dealConfirmationEvent.count({ where: { sellerId: d.sellerId, action: 'declined', createdAt: { gte: since } } })
        if (declinesWarrantFlag(declines)) await flagForReview(d.sellerProfileId, ENFORCEMENT_REASON.DEAL_DECLINES)
      } catch (err) {
        console.error('[deal] decline flag failed', err)
      }
    })
    return { ok: true, state: 'declined' }
  }

  // ── THE SELLER: confirm / withdraw ────────────────────────────────────────────────────────────────────────────────────
  // ⛔ IDENTITY FIRST, FAIL CLOSED: both the thread's seller profile AND the storefront's owner (canNameBuyer's rule — an
  // unresolved owner, a guest or unclaimed storefront, refuses).
  if (!convo.sellerProfileId || me.id !== convo.sellerProfileId || me.id !== convo.seller.ownerId) throw new ApiError('forbidden', 403)
  if (action === 'confirm' && convo.listingId !== snapshot) throw new ApiError('listing_changed', 409)

  // ⛔ SCOPE — the one predicate the thread GET also asks (serviceDealInScope), plus the desk check by seller AND listing,
  // which only this write path pays for. A missing check here cannot be caught by a value test, so a source-level test
  // pins it (deal/route.scope.test.ts).
  const kindOfThread = convo.listing ? await threadKind({ listingId: convo.listing.id }) : null
  const enoDesk = await isEnoDeskThread(convo.seller.id, convo.listing?.id ?? null)
  let kind = serviceDealInScope({
    listing: convo.listing ? { listingType: convo.listing.listingType, categorySlug: convo.listing.category?.slug ?? null, complianceStatus: convo.listing.complianceStatus, verified: convo.listing.verified, verificationNotes: convo.listing.verificationNotes } : null,
    threadKind: kindOfThread,
    enoDesk,
  })
  // ⛔ THE UNDO FOLLOWS THE STORED DEAL (codex + opus, 2026-11-11): a seller who switched the listing's type inside the 10
  // minutes keeps the undo the confirm dialog promised, as the buyer's side follows the row. Never on a desk, never off a
  // 'listing' thread; a confirm is a new act and still needs a rental / lesson / service listing.
  if (action === 'withdraw' && !kind && !enoDesk && kindOfThread === 'listing' && convo.listing) {
    const stored = await readDealConfirmation(id)
    kind = stored ? reviewBasis(stored.kind) : null
  }
  if (!kind || !convo.listing) refuse('not_reviewable')
  const listing = convo.listing!
  const dealKind = kind as ServiceDealKind

  const [deal, threadHasReview, blocked] = await Promise.all([
    readDealConfirmation(id),
    db.review.findUnique({ where: { conversationId: id }, select: { id: true } }).then((r) => !!r),
    isBlockedBetween(me.id, convo.buyerProfileId),
  ])

  const answer = (row: DealRow | null) => {
    const until = withdrawUntil(row, threadHasReview, new Date())
    return {
      deal: {
        kind: dealKind,
        state: dealState(row, threadHasReview),
        confirmsLeft: confirmsLeft(row),
        ...(until ? { withdrawUntil: until.toISOString() } : {}),
      },
    }
  }

  if (action === 'confirm') {
    const since24h = new Date(now.getTime() - DAY_MS)
    let confirmsLast24h: number
    try {
      // ⛔ FAIL-CLOSED: the event table is the cap's truth. Missing (pre-DDL) → the write below cannot happen either.
      confirmsLast24h = await db.dealConfirmationEvent.count({ where: { actorProfileId: me.id, action: 'confirm', createdAt: { gte: since24h } } })
    } catch (e) {
      if (isMissingRelation(e)) throw new ApiError('migration_pending', 503)
      throw e
    }
    const [bySender, buyerGate, phoneVerified] = await Promise.all([
      // A two-way thread: non-recalled 'text' / 'offer' messages only — the seller's own deal lines and calls do not count.
      db.message.groupBy({
        by: ['senderProfileId'],
        where: { conversationId: id, deletedAt: null, kind: { in: ['text', 'offer'] }, senderProfileId: { in: [convo.buyerProfileId, me.id] } },
        _count: { _all: true },
      }),
      messagingGate(convo.buyerProfileId),
      // ⛔ A VERIFIED PHONE, NOT Profile.phone: the 'phone_verified' trust event (trust.ts recordPhoneVerified), written only
      // for a confirmation eno's own phone flow produced (auth-policy.ts phoneConfirmationTrusted — profile.ts / admin.ts).
      db.trustEvent.findFirst({ where: { subjectProfileId: convo.buyerProfileId, reason: 'phone_verified' }, select: { id: true } }).then((e) => !!e),
    ])
    const countOf = (pid: string) => bySender.find((g) => g.senderProfileId === pid)?._count._all ?? 0
    const decision = canConfirmDeal({
      actorProfileId: me.id,
      threadSellerProfileId: convo.sellerProfileId,
      buyerProfileId: convo.buyerProfileId,
      sellerOwnerId: convo.seller.ownerId,
      kind: dealKind,
      blocked,
      deal,
      threadHasReview,
      messages: { buyer: countOf(convo.buyerProfileId), seller: countOf(me.id) },
      buyer: { createdAt: convo.buyer.createdAt, phoneVerified, suspended: !!buyerGate },
      confirmsLast24h,
      now,
    })
    if (!decision.ok) refuse(decision.reason)
    // An idempotent re-tap: it already stands — no second row, no second line. (The undo it reports is the real one.)
    if (decision.ok && decision.noop) return answer(deal)

    const fields = { listingId: listing.id, sellerId: convo.seller.id, sellerProfileId: me.id, buyerProfileId: convo.buyerProfileId, kind: dealKind }
    try {
      await db.$transaction(async (tx) => {
        // ⛔ THE CAP, RACE-PROOF: one confirm per seller at a time (a transaction-scoped advisory lock keyed by the seller
        // profile — released at COMMIT / ROLLBACK), then the 24 h count again under it. The count before the transaction
        // stays as the cheap early answer; this one is the truth.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`deal-confirm:${me.id}`}))`
        // ⛔ THE THREAD'S ROW LOCK, then its listing re-read under it (codex, 2026-11-11): retargetForListing takes the same lock
        // to move a thread, so a confirm can never bind a thread that is being moved — the move lands first and this answers
        // listing_changed, or this lands first and the move sends the buyer to a fresh thread.
        const locked = await tx.$queryRaw<{ listingId: string | null }[]>`SELECT "listingId" FROM "Conversation" WHERE "id" = ${id} FOR UPDATE`
        if (locked[0]?.listingId !== listing.id) throw new ListingMoved()
        // The listing re-read UNDER the lock (codex, round 3): a takedown, licence hold or unpublish committed after the scope
        // read still refuses the confirm.
        const now2 = await tx.listing.findUnique({ where: { id: listing.id }, select: { complianceStatus: true, verified: true, verificationNotes: true } })
        if (!now2 || now2.complianceStatus === 'taken_down' || now2.verified === false || now2.verificationNotes === 'licence:held') throw new ListingClosed()
        // A plain (offer-path) review that landed after the pre-check: never confirm a reviewed thread.
        if (await tx.review.findUnique({ where: { conversationId: id }, select: { id: true } })) throw new AlreadyReviewed()
        // The confirm instant on the DATABASE's clock (dbNow): the undo, the decline and the review all judge it by that clock.
        const at = await dbNow(tx)
        const recount = await tx.dealConfirmationEvent.count({ where: { actorProfileId: me.id, action: 'confirm', createdAt: { gte: since24h } } })
        if (recount >= SERVICE_DEAL.DAILY_CONFIRMS_PER_SELLER) throw new ConfirmCapReached()
        if (!deal) {
          // P2002 on conversationId (a double tap that both read "no row") is caught below and answered idempotently.
          await tx.dealConfirmation.create({ data: { conversationId: id, ...fields, confirmedAt: at, confirmCount: 1 } })
        } else {
          // ⚠️ CONDITIONAL: only a row with nothing standing, not reviewed, not declined, with budget left — so a concurrent
          // confirm, the buyer's review or their "No" cannot be overwritten by a stale read.
          const r = await tx.dealConfirmation.updateMany({
            where: { conversationId: id, confirmedAt: null, reviewId: null, declinedAt: null, confirmCount: { lt: SERVICE_DEAL.MAX_CONFIRMS_PER_THREAD } },
            data: { ...fields, confirmedAt: at, revokedAt: null, confirmCount: { increment: 1 } },
          })
          if (r.count !== 1) throw new DealRaceLost()
        }
        await tx.dealConfirmationEvent.create({ data: { conversationId: id, listingId: listing.id, sellerId: convo.seller.id, actorProfileId: me.id, buyerProfileId: convo.buyerProfileId, action: 'confirm' } })
      })
    } catch (e) {
      const code = (e as { code?: string } | null)?.code
      if (e instanceof ConfirmCapReached) refuse('confirm_cap')
      if (e instanceof ListingMoved) throw new ApiError('listing_changed', 409)
      if (e instanceof ListingClosed) refuse('not_reviewable')
      if (e instanceof AlreadyReviewed) refuse('already_reviewed')
      if (e instanceof DealRaceLost || code === 'P2002') {
        const again = await readDealConfirmation(id)
        if (again?.confirmedAt && !again.revokedAt && !again.reviewId && !again.declinedAt) return answer(again) // the other tap won
        refuse(again?.reviewId ? 'already_reviewed' : again?.declinedAt ? 'deal_declined' : 'confirm_budget_spent')
      }
      if (isMissingRelation(e)) throw new ApiError('migration_pending', 503)
      throw e
    }
    // The timeline line, after the commit — its normal unread / inbox path tells the buyer. Best effort: the confirmation
    // is the truth and stands without it (the buyer's card follows the row on their next read).
    try {
      await insertMessage({ id, buyerProfileId: convo.buyerProfileId, sellerProfileId: convo.sellerProfileId, listingId: convo.listingId }, me.id, dealConfirmedLine(dealKind), { kind: 'deal_confirmed' })
    } catch (err) {
      console.error('[deal] confirm line failed', err)
    }
    const confirmed = await db.dealConfirmation.findUnique({ where: { conversationId: id }, select: DEAL_ROW_SELECT }).catch(() => null)
    return answer(confirmed ?? { ...fields, confirmedAt: now, revokedAt: null, declinedAt: null, confirmCount: (deal?.confirmCount ?? 0) + 1, reviewId: null })
  }

  // ── WITHDRAW: the undo ────────────────────────────────────────────────────────────────────────────────────────────────
  const confirmedAt = deal?.confirmedAt ?? null
  const decision = canWithdrawDeal({
    actorProfileId: me.id,
    threadSellerProfileId: convo.sellerProfileId,
    sellerOwnerId: convo.seller.ownerId,
    blocked,
    deal,
    threadHasReview,
    now,
  })
  if (!decision.ok) refuse(decision.reason)
  try {
    await db.$transaction(async (tx) => {
      await lockDealRow(tx, id)
      const t = await dbNow(tx)
      // ⚠️ THE SAME ROW THE REVIEW POST LOCKS (reviewId: null → its id): both are conditional UPDATEs of it, so they
      // serialise, and a review and a withdrawal can never both land. The window is re-asserted in the WHERE (the same
      // confirm instant, still after undoCutoff — the review's WHERE asks the opposite, confirmedAt <= undoCutoff).
      const r = await tx.dealConfirmation.updateMany({
        where: {
          // The window on the DATABASE's clock at the write (dbNow): a request that started inside it but writes after it loses.
          conversationId: id, confirmedAt: { equals: confirmedAt!, gt: undoCutoff(t) },
          revokedAt: null, reviewId: null, declinedAt: null,
        },
        data: { confirmedAt: null, revokedAt: t },
      })
      if (r.count !== 1) throw new DealRaceLost()
      await tx.dealConfirmationEvent.create({ data: { conversationId: id, listingId: deal!.listingId, sellerId: convo.seller.id, actorProfileId: me.id, buyerProfileId: convo.buyerProfileId, action: 'withdraw' } })
    })
  } catch (e) {
    if (e instanceof DealRaceLost) {
      const again = await readDealConfirmation(id)
      refuse(again?.reviewId ? 'already_reviewed' : again?.declinedAt ? 'deal_declined' : again?.confirmedAt ? 'withdraw_window_closed' : 'not_confirmed')
    }
    if (isMissingRelation(e)) throw new ApiError('migration_pending', 503)
    throw e
  }
  try {
    await insertMessage({ id, buyerProfileId: convo.buyerProfileId, sellerProfileId: convo.sellerProfileId, listingId: convo.listingId }, me.id, DEAL_WITHDRAWN_LINE, { kind: 'deal_withdrawn' })
  } catch (err) {
    console.error('[deal] withdraw line failed', err)
  }
  return answer({ ...deal!, confirmedAt: null, revokedAt: now })
})
