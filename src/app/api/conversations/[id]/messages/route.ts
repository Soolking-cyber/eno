import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { kv } from '@/lib/ratelimit'
import { insertMessage } from '@/lib/messages'
import { messagingGate } from '@/lib/enforcement'
import { recordFixedPriceOfferAttempt } from '@/lib/offer-guard'
import { logError } from '@/lib/log'
import { ApiError, route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_LEN = 2000

// Send-idempotency ledger (audit P2): on VN mobile networks the RESPONSE of a
// committed POST is often dropped — the bubble flips to "tap to retry" and the retry
// used to insert a DUPLICATE message (or duplicate offer). The client sends a
// per-logical-send clientId; the first request claims it (kv NX), commits, then
// stores the serialized message for replay.

// Send a message in a conversation. Authenticated, participant-only, Prisma
// insert (never a client-direct insert). One transaction inserts the Message and
// updates the denormalized last-message + the OTHER party's unread counter.
//
// WS6 — on route(). `auth: 'userId'`: the old code called getCurrentProfileId(), and this is the
// hot messaging write path `src/lib/admin.ts` explicitly warns against adding a DB read to — the
// id is all it needs (participant comparison + the rate-limit and idempotency keys). rateLimit
// reproduces `rateLimit('msg:send', meId, 20, '1 m')`, keyed by the same id.
//
// ⚠️ NO `body:` SCHEMA, AND THAT IS A CORRECTNESS CHOICE, NOT LAZINESS. Two reasons, either alone
// sufficient: (1) the wrapper parses BEFORE the handler, which would move the parse ahead of
// messagingGate and turn a suspended sender's malformed JSON from 403 into 400; (2) the idempotency
// claim is taken from the body and every failure exit below must `release()` it, so the body has to
// be read inside the handler where the ledger lives. The tolerant parse stays verbatim.
//
// ⚠️ EVERY ERROR EXIT STILL RELEASES THE CLAIM. `throw new ApiError(...)` replaced a
// `return NextResponse.json(...)`, so the `await release()` that preceded each one had to come with
// it — a missed one would 409 `send_in_flight` for the whole 5-minute TTL after a validation
// failure, which is the exact bug the release exists to prevent.
//
// Branches held: guest → 401 auth_required · over limit → 429 rate_limited · gated account → 403
// with the gate's OWN body (an object, not an error code — returned as a Response) · malformed
// JSON → 400 bad_request · replayed clientId → 200 with the stored message · in-flight duplicate →
// 409 send_in_flight · no text and no offer → 400 empty · unknown thread → 404 not_found ·
// non-participant → 403 forbidden · offer on a fixed-price listing → 409 not_negotiable · offer on
// a non-active listing → 409 listing_unavailable · success → 200 with the serialized message.
//
// ⚠️ ACCEPTED WIRE CHANGE ON THE FAILURE PATH ONLY: the `catch { await release(); throw e }` around
// insertMessage rethrows, which used to be Next's default 500 and is now
// {"error":"internal_error"} 500. The release still runs first, so the retry is still allowed.
export const POST = route(
  { auth: 'userId', rateLimit: { bucket: 'msg:send', limit: 20, window: '1 m' } },
  async ({ req, params, userId: meId }) => {
    const { id } = params

    // Enforcement (trust Phase 2): a suspended account can't send messages/offers.
    // One indexed PK read; pre-migration → good_standing (no-op).
    const gate = await messagingGate(meId)
    if (gate) return NextResponse.json(gate, { status: 403 })

    let body: { body?: string; offerAmount?: number; clientId?: string; replyToId?: string }
    try { body = await req.json() } catch { throw new ApiError('bad_request', 400) }

    // Idempotency claim BEFORE any work. A replayed clientId returns the original
    // message; a still-in-flight duplicate gets 409 so the retry loop tries again.
    const clientId = typeof body.clientId === 'string' ? body.clientId.trim().slice(0, 64) : ''
    const idemKey = clientId ? `msgid:${id}:${meId}:${clientId}` : null
    if (idemKey) {
      const claimed = await kv.set(idemKey, 'pending', { nx: true, ex: 300 }).catch(() => 'OK' as const)
      if (claimed === null) {
        const stored = await kv.get<Record<string, unknown> | 'pending'>(idemKey).catch(() => null)
        if (stored && stored !== 'pending') return stored
        throw new ApiError('send_in_flight', 409)
      }
    }
    // A claim must never outlive a FAILED attempt — every error exit below releases it,
    // else a retry of a validation failure would 409 for the whole TTL.
    const release = async () => { if (idemKey) await kv.del(idemKey).catch((e) => logError(e, { op: 'messages.del' })) }

    // An offer is a structured message: validate the amount. The body carries ONLY
    // the sender's optional note (possibly empty) — the offer line itself is derived
    // client-side from offerAmount, so locale + money format live in the renderer.
    // ⚠️ ROUND FIRST, THEN VALIDATE. Validating the RAW value and rounding afterwards let any
    // 0 < x < 0.5 through as a genuine offer that then rounds to ZERO: POST {offerAmount: 0.4}
    // stored kind='offer', offerAmount=0, offerStatus='pending', and the thread rendered an offer
    // card for 0 đ that the seller could accept.
    const rawAmount = Number(body.offerAmount)
    const rounded = Number.isFinite(rawAmount) ? Math.min(Math.round(rawAmount), 1e12) : NaN
    const isOffer = Number.isFinite(rounded) && rounded > 0
    const offerAmount = isOffer ? rounded : undefined
    const text = String(body.body || '').trim().slice(0, MAX_LEN)
    if (!text && !isOffer) { await release(); throw new ApiError('empty', 400) }

    // The quoted message, if this is a reply. Shape only here — WHETHER it may be quoted (same
    // conversation, not recalled) is decided inside insertMessage, in the same query that reads it,
    // so no route can forget the check. See SendOpts.replyToId.
    const replyToId = typeof body.replyToId === 'string' ? body.replyToId.trim().slice(0, 64) || undefined : undefined

    const convo = await db.conversation.findUnique({
      where: { id },
      select: { id: true, buyerProfileId: true, sellerProfileId: true, listing: { select: { id: true, negotiable: true, status: true } } },
    })
    if (!convo) { await release(); throw new ApiError('not_found', 404) }

    const iAmBuyer = convo.buyerProfileId === meId
    const iAmSeller = convo.sellerProfileId === meId
    if (!iAmBuyer && !iAmSeller) { await release(); throw new ApiError('forbidden', 403) }

    // Fixed-price listing → offers are off. The UI hides the offer control, so this is
    // the abuse/stale-tab path: reject the offer. Only a BUYER spamming offers is abuse
    // worth a trust dock — offers here are bidirectional (insertMessage supports seller
    // counters), so a seller's stray counter on their own fixed-price listing must NOT
    // self-penalize. Both roles still get the 409; only the buyer's attempts are counted.
    if (isOffer && !convo.listing.negotiable) {
      if (iAmBuyer) await recordFixedPriceOfferAttempt(meId)
      await release()
      throw new ApiError('not_negotiable', 409)
    }

    // ⚠️ NO NEW OFFERS ON A LISTING THAT IS NOT ACTIVE. Neither this path nor actOnOffer read
    // Listing.status, so a buyer could offer on — and a seller accept on — an item already marked
    // SOLD or hidden. OFFERS ONLY: plain text stays allowed, because the sold page is a deliberate
    // 200 surface where buyers still ask questions, and cutting the thread would be a worse bug than
    // the one being fixed. Deliberately NOT counted as a fixed-price attempt: the listing being gone
    // is not the buyer trying it on, and docking trust for it would be exactly the false positive
    // offer-guard's own comments warn about.
    if (isOffer && convo.listing.status !== 'active') {
      await release()
      throw new ApiError('listing_unavailable', 409)
    }

    let message: Awaited<ReturnType<typeof insertMessage>>
    try {
      message = await insertMessage(
        { id, buyerProfileId: convo.buyerProfileId, sellerProfileId: convo.sellerProfileId, listingId: convo.listing.id },
        meId,
        text,
        isOffer ? { kind: 'offer', offerAmount, replyToId } : replyToId ? { replyToId } : undefined,
      )
    } catch (e) {
      await release() // the insert did NOT commit — the retry must be allowed to run
      throw e
    }
    // Store the committed result for replay (best-effort — a miss just means a rare
    // duplicate on the exact old failure pattern, never a lost message).
    if (idemKey) await kv.set(idemKey, message, { ex: 86_400 }).catch((e) => logError(e, { op: 'messages.set' }))
    return message
  },
)
