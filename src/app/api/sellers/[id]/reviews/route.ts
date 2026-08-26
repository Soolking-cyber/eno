import { NextResponse, after } from 'next/server'
import { db } from '@/lib/db'
import { recordReview } from '@/lib/trust'
import { messagingGate } from '@/lib/enforcement'
import { maskEmailHandle } from '@/lib/utils'
import { ApiError, route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/sellers/[id]/reviews — a REAL buyer reviews a seller after a
// transaction, making the storefront "Verified buyer" badge earnable.
//
// Server-side gate (Prisma bypasses RLS — these checks ARE the guard):
//   1. signed in (401)
//   2. the conversation exists (404)
//   3. the caller is that conversation's BUYER (403)
//   4. the conversation's listing belongs to seller [id] (403)
//   5. a transaction actually happened: listing sold OR an offer in this thread
//      was accepted (403 'not_transacted')
//   6. one review per conversation — the DB unique index on conversationId is the
//      dedup (P2002 → 409 'already_reviewed')
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

  const convo = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, buyerProfileId: true, listing: { select: { id: true, sellerId: true, status: true } } },
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

  // Transaction signal: the listing was sold, or an offer in THIS thread was accepted.
  const transacted =
    convo.listing.status === 'sold' ||
    (await db.message.count({ where: { conversationId, kind: 'offer', offerStatus: 'accepted' } })) > 0
  if (!transacted) throw new ApiError('not_transacted', 403)

  // Never expose the email local part on a PUBLIC surface (it's often a full name).
  const author = me.displayName || maskEmailHandle(me.email) || 'Buyer'
  let review: { id: string }
  try {
    review = await db.review.create({
      data: {
        sellerId: id,
        author,
        rating,
        text,
        authorProfileId: me.id,
        listingId: convo.listing.id,
        conversationId,
      },
      select: { id: true },
    })
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
      if (seller?.ownerId) await recordReview(seller.ownerId)
    } catch (err) {
      console.error('[reviews] post-create denorm/trust failed', err)
    }
  })

  return NextResponse.json({ ok: true, id: review.id }, { status: 201 })
})
