import { NextResponse } from 'next/server'
import { Redis } from '@upstash/redis'
import { db } from '@/lib/db'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { insertMessage } from '@/lib/messages'
import { messagingGate } from '@/lib/enforcement'
import { recordFixedPriceOfferAttempt } from '@/lib/offer-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_LEN = 2000

// Send-idempotency ledger (audit P2): on VN mobile networks the RESPONSE of a
// committed POST is often dropped — the bubble flips to "tap to retry" and the retry
// used to insert a DUPLICATE message (or duplicate offer). The client now sends a
// per-logical-send clientId; the first request claims it (SET NX), commits, then
// stores the serialized message for replay. Redis absent → previous behavior.
const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null

// Send a message in a conversation. Authenticated, participant-only, Prisma
// insert (never a client-direct insert). One transaction inserts the Message and
// updates the denormalized last-message + the OTHER party's unread counter.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const meId = await getCurrentProfileId()
  if (!meId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  const rl = await rateLimit('msg:send', meId, 20, '1 m')
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  // Enforcement (trust Phase 2): a suspended account can't send messages/offers.
  // One indexed PK read; pre-migration → good_standing (no-op).
  const gate = await messagingGate(meId)
  if (gate) return NextResponse.json(gate, { status: 403 })

  let body: { body?: string; offerAmount?: number; clientId?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }

  // Idempotency claim BEFORE any work. A replayed clientId returns the original
  // message; a still-in-flight duplicate gets 409 so the retry loop tries again.
  const clientId = typeof body.clientId === 'string' ? body.clientId.trim().slice(0, 64) : ''
  const idemKey = clientId && redis ? `msgid:${id}:${meId}:${clientId}` : null
  if (idemKey) {
    const claimed = await redis!.set(idemKey, 'pending', { nx: true, ex: 300 }).catch(() => 'OK' as const)
    if (claimed === null) {
      const stored = await redis!.get<Record<string, unknown> | 'pending'>(idemKey).catch(() => null)
      if (stored && stored !== 'pending') return NextResponse.json(stored)
      return NextResponse.json({ error: 'send_in_flight' }, { status: 409 })
    }
  }
  // A claim must never outlive a FAILED attempt — every error exit below releases it,
  // else a retry of a validation failure would 409 for the whole TTL.
  const release = async () => { if (idemKey) await redis!.del(idemKey).catch(() => {}) }

  // An offer is a structured message: validate the amount. The body carries ONLY
  // the sender's optional note (possibly empty) — the offer line itself is derived
  // client-side from offerAmount, so locale + money format live in the renderer.
  const rawAmount = Number(body.offerAmount)
  const isOffer = Number.isFinite(rawAmount) && rawAmount > 0
  const offerAmount = isOffer ? Math.min(Math.round(rawAmount), 1e12) : undefined
  const text = String(body.body || '').trim().slice(0, MAX_LEN)
  if (!text && !isOffer) { await release(); return NextResponse.json({ error: 'empty' }, { status: 400 }) }

  const convo = await db.conversation.findUnique({
    where: { id },
    select: { id: true, buyerProfileId: true, sellerProfileId: true, listing: { select: { id: true, negotiable: true } } },
  })
  if (!convo) { await release(); return NextResponse.json({ error: 'not_found' }, { status: 404 }) }

  const iAmBuyer = convo.buyerProfileId === meId
  const iAmSeller = convo.sellerProfileId === meId
  if (!iAmBuyer && !iAmSeller) { await release(); return NextResponse.json({ error: 'forbidden' }, { status: 403 }) }

  // Fixed-price listing → offers are off. The UI hides the offer control, so this is
  // the abuse/stale-tab path: reject the offer. Only a BUYER spamming offers is abuse
  // worth a trust dock — offers here are bidirectional (insertMessage supports seller
  // counters), so a seller's stray counter on their own fixed-price listing must NOT
  // self-penalize. Both roles still get the 409; only the buyer's attempts are counted.
  if (isOffer && !convo.listing.negotiable) {
    if (iAmBuyer) await recordFixedPriceOfferAttempt(meId)
    await release()
    return NextResponse.json({ error: 'not_negotiable' }, { status: 409 })
  }

  let message: Awaited<ReturnType<typeof insertMessage>>
  try {
    message = await insertMessage(
      { id, buyerProfileId: convo.buyerProfileId, sellerProfileId: convo.sellerProfileId, listingId: convo.listing.id },
      meId,
      text,
      isOffer ? { kind: 'offer', offerAmount } : undefined,
    )
  } catch (e) {
    await release() // the insert did NOT commit — the retry must be allowed to run
    throw e
  }
  // Store the committed result for replay (best-effort — a miss just means a rare
  // duplicate on the exact old failure pattern, never a lost message).
  if (idemKey) await redis!.set(idemKey, message, { ex: 86_400 }).catch(() => {})
  return NextResponse.json(message)
}
