import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { actOnOffer } from '@/lib/messages'
import { messagingGate } from '@/lib/enforcement'
import { ApiError, route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Accept or decline a pending offer in a conversation. Participant-only; the
// actor must be the RECIPIENT of the offer (enforced in actOnOffer).
//
// WS6 — on route(). `auth: 'userId'` because the old code called getCurrentProfileId() and only
// compares ids against buyerProfileId/sellerProfileId; upgrading to 'profile' would add a Profile
// read to an accept/decline tap for nothing. rateLimit reproduces `rateLimit('offer:act', meId,
// 30, '1 m')` exactly, keyed by the same id, and still runs AFTER auth and BEFORE the body.
//
// ⚠️ NO `body:` SCHEMA, DELIBERATELY, AND THE REASON IS ORDER. The wrapper parses the body before
// the handler runs, which would move it ahead of messagingGate — a suspended account sending
// malformed JSON would flip from 403 to 400. It also collapses two distinct 400s: today a missing
// `messageId`/`action` and unparseable JSON both answer `bad_request`, but only because both were
// written that way, not because a schema decided it. The tolerant parse therefore stays here.
//
// Branches held: guest → 401 auth_required · over limit → 429 rate_limited · gated account → 403
// with the gate's OWN body (an object, not an error code — returned as a Response) · malformed
// JSON or missing messageId/action → 400 bad_request · unknown thread → 404 not_found ·
// non-participant → 403 forbidden · accept on a non-active listing → 409 listing_unavailable ·
// actOnOffer refusing → 409 not_actionable · success → 200 {"ok":true}.
//
// ⚠️ ACCEPTED WIRE CHANGE ON THE FAILURE PATH ONLY: neither the conversation read nor actOnOffer
// was wrapped, so a DB rejection used to be Next's default 500 and is now
// {"error":"internal_error"} 500.
export const POST = route(
  { auth: 'userId', rateLimit: { bucket: 'offer:act', limit: 30, window: '1 m' } },
  async ({ req, params, userId: meId }) => {
    const { id } = params

    // Enforcement (trust Phase 2): a suspended account can't act on offers.
    const gate = await messagingGate(meId)
    if (gate) return NextResponse.json(gate, { status: 403 })

    let body: { messageId?: string; action?: string }
    try { body = await req.json() } catch { throw new ApiError('bad_request', 400) }
    const messageId = String(body.messageId || '')
    const action = body.action === 'accept' ? 'accept' : body.action === 'decline' ? 'decline' : null
    if (!messageId || !action) throw new ApiError('bad_request', 400)

    const convo = await db.conversation.findUnique({
      where: { id },
      select: { id: true, buyerProfileId: true, sellerProfileId: true, listing: { select: { id: true, status: true } } },
    })
    if (!convo) throw new ApiError('not_found', 404)
    if (convo.buyerProfileId !== meId && convo.sellerProfileId !== meId) {
      throw new ApiError('forbidden', 403)
    }

    // ⚠️ ACCEPT ONLY WHILE THE LISTING IS ACTIVE — but DECLINE must always work. Neither this route
    // nor actOnOffer read Listing.status, so a seller could accept an offer on an item they had
    // already marked sold. Gating decline too would strand pending offer cards forever on every sold
    // listing, with no way for either side to clear them, so the guard is scoped to 'accept'.
    // A support thread carries no listing, so there is no offer to act on — see the same guard in
    // the messages route for why this is a rejection rather than a null-check on each field.
    if (!convo.listing) throw new ApiError('listing_unavailable', 409)
    if (action === 'accept' && convo.listing.status !== 'active') {
      throw new ApiError('listing_unavailable', 409)
    }

    const ok = await actOnOffer(
      { id, buyerProfileId: convo.buyerProfileId, sellerProfileId: convo.sellerProfileId, listingId: convo.listing?.id ?? null },
      meId,
      messageId,
      action,
    )
    if (!ok) throw new ApiError('not_actionable', 409)
    return { ok: true }
  },
)
