import { NextResponse, after } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, apiFail } from '@/lib/api/handler'
import { LISTING_REMOVED } from '@/lib/listing-removed'
import { buyerResponsePatch, canRespondToSale, confirmPromptPrice, saleState } from '@/lib/trade-loop'
import { SALE_CONFIRM_NOTIFICATION, SALE_FACTS_SELECT, asksBuyerAbout, factsUnchanged, saleFacts } from '@/lib/core/sale-loop'
import { logError } from '@/lib/log'
import { recomputeTrust } from '@/lib/trust'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Re-reads allowed when the row changes between the decision and the write (see the conditional write). */
const MAX_ATTEMPTS = 3

const Body = z.object({
  answer: z.enum(['confirm', 'decline']),
  /** The price the buyer was SHOWN (GET /api/conversations/[id]/sale-question), echoed back: the answer is
   *  to that question, and a question whose number has moved since is not the one they answered. */
  price: z.number().finite().nonnegative().nullable(),
})

/**
 * POST /api/listings/[id]/sale-confirmation — THE BUYER'S ANSWER to "did you buy this?" (the trade loop's
 * buyer half; the question is asked by POST /sold and shown in their thread by sale-question).
 *
 *   { answer: 'confirm' | 'decline', price: <the number shown> | null }
 *
 * ⛔ ONLY THE ATTRIBUTED BUYER. Identity is checked BEFORE outcome (canRespondToSale's rule): anyone else —
 * the seller included — gets 403 forbidden in every state, so this cannot be used to learn whether a named
 * buyer confirmed, declined or was ever asked.
 *
 * IDEMPOTENT. Repeating the answer already recorded is 200 with that status and writes nothing (a double
 * tap, a retry after a lost response). The OTHER answer once one is recorded is 409 already_resolved with
 * the recorded `status` — "Yes" then "No" for one sale is never a retry (sale-confirm-prompt.tsx keeps the
 * same one-way door on the client).
 *
 * WHAT THE TWO ANSWERS MEAN — and they keep the meaning the columns already have (src/lib/trade-loop.ts,
 * prisma/schema.prisma):
 *   · confirm → `saleConfirmedAt`. The only state countsTowardTrust / salePriceForGuidance may ever read.
 *   · decline → `saleDeclinedAt`, plus a decline recorded against THIS buyer in saleBuyerHistory, so the
 *     seller can never name them for this listing again and nothing re-asks them. ⚠️ THE SALE STAYS SOLD:
 *     status, soldAt and the seller's attribution (soldChannel / soldToProfileId) are the SELLER's record
 *     and are not touched — the listing is still gone. It is simply no longer a sale that can be counted
 *     as confirmed (saleState 'declined'). Since 2026-10-06 a decline also takes it out of trust's transaction
 *     count (src/lib/trust.ts, offer path included) and recomputes the seller's score; a "Yes" changes nothing there.
 *
 * ⚠️ A CONDITIONAL WRITE, AS buyerResponsePatch REQUIRES. The UPDATE carries every fact the decision read
 * (the buyer, the channel, both answers still empty, the price, the per-buyer history and the compliance
 * status), so a takedown, or a seller who
 * re-attributes the sale or edits its price between this read and this write makes it miss — and the
 * re-read then answers for what is there now. A buyer can never confirm a figure they were not shown.
 *
 * Branches: guest → 401 auth_required · bad body → 400 invalid_body · rate limited → 429 · unknown or
 * removed listing → 404 not_found · not the attributed buyer (or no question was ever put to one) → 403
 * forbidden · the other answer already recorded → 409 already_resolved {status} · taken down by authority
 * order → 409 listing_unavailable · the question changed (a new price) or closed (the 14-day window) →
 * 409 not_actionable · success → 200 {"ok":true,"status":"confirmed"|"declined"}.
 */
export const POST = route(
  {
    auth: 'userId',
    rateLimit: { bucket: 'sale-confirmation', limit: 30, window: '1 h' },
    body: Body,
    invalidBodyCode: 'invalid_body',
  },
  async ({ params, userId, body }) => {
    const id = params.id
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // edition-lint-allow: ONE row by id, answered only to its ATTRIBUTED buyer (403 for anyone else),
      // the services desk refused by asksBuyerAbout's edition-independent desk check; the response is
      // { ok, status } — no listing field is serialized.
      const row = await db.listing.findUnique({
        where: { id },
        select: { ...SALE_FACTS_SELECT, sellerId: true, listingType: true, category: { select: { slug: true } }, seller: { select: { ownerId: true } } },
      })
      if (!row || row.status === LISTING_REMOVED) return apiFail('not_found', 404)
      const facts = saleFacts(row)
      // Identity first, and the same answer for every state (see the header).
      if (row.status !== 'sold' || facts.soldChannel !== 'eno' || !facts.soldToProfileId || facts.soldToProfileId !== userId) {
        return apiFail('forbidden', 403)
      }
      // A listing nobody is asked about (not a sale of goods; the services desk) has no question to answer.
      if (!(await asksBuyerAbout({ sellerId: row.sellerId, listingType: row.listingType, categorySlug: row.category?.slug ?? null }))) {
        return apiFail('forbidden', 403)
      }

      const wanted = body.answer === 'confirm' ? 'confirmed' : 'declined'
      const state = saleState(facts)
      if (state === wanted) return { ok: true, status: wanted }
      if (state === 'confirmed' || state === 'declined') {
        return NextResponse.json({ error: 'already_resolved', status: state }, { status: 409 })
      }

      const now = new Date()
      const can = canRespondToSale({ actorProfileId: userId, sellerProfileId: row.seller.ownerId, facts, now })
      if (!can.ok) {
        if (can.reason === 'listing_unavailable') return apiFail('listing_unavailable', 409)
        if (can.reason === 'not_the_buyer' || can.reason === 'seller_cannot_confirm') return apiFail('forbidden', 403)
        // confirm_window_closed — the question has closed on its own (TRADE_LOOP.CONFIRM_WINDOW_DAYS).
        return apiFail('not_actionable', 409)
      }
      // The answer is to the question the buyer SAW. A different number means the seller changed it since.
      if ((confirmPromptPrice(facts) ?? null) !== body.price) return apiFail('not_actionable', 409)

      const patch = buyerResponsePatch(body.answer === 'confirm' ? 'yes' : 'no', now, facts)
      // Every fact this decision read, unchanged — complianceStatus included, so a takedown landing in
      // between makes this miss and the re-read answers listing_unavailable (canRespondToSale checked it).
      const { count } = await db.listing.updateMany({
        where: { id, ...factsUnchanged(facts) },
        data: patch,
      })
      if (count === 0) continue // the row moved under the decision: re-read and answer for what is there now

      // The bell row asking them is answered — read, like a thread that has been opened.
      try {
        await db.notification.updateMany({
          where: { recipientId: userId, type: SALE_CONFIRM_NOTIFICATION, listingId: id, read: false },
          data: { read: true },
        })
      } catch (e) {
        logError(e, { op: 'sale-confirmation.markRead' })
      }
      // ⛔ A "No" TAKES THE SALE OUT OF THE SELLER'S TRUST (trust.ts, owner 2026-10-06) — recompute now, so the public
      // score does not keep a disputed sale until some unrelated event recomputes it. Best effort, after the answer.
      if (body.answer === 'decline' && row.seller.ownerId) {
        const sellerProfileId = row.seller.ownerId
        after(() => recomputeTrust(sellerProfileId).then(() => undefined, (e) => logError(e, { op: 'sale-confirmation.recomputeTrust' })))
      }
      return { ok: true, status: wanted }
    }
    return apiFail('not_actionable', 409)
  },
)
