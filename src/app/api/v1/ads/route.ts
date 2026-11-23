import { NextRequest, NextResponse } from 'next/server'
import { resolveApiKey } from '@/lib/api/auth'
import { apiAuthError, apiError, apiOk } from '@/lib/api/respond'
import { JSON_BODY_CAP, readBytesCapped } from '@/lib/api/body'
import { ApiError } from '@/lib/api/api-error'
import { rateLimit } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import { logError } from '@/lib/log'
import { AD_MAX_HOURS, adHours, x402Config } from '@/lib/x402/config'
import { HEADER_REQUIRED, HEADER_RESPONSE, HEADER_SIGNATURE, decodeHeader, encodeHeader, type SettlementResponse } from '@/lib/x402/wire'
import { adPaymentRequired } from '@/lib/ads/offer'
import { bookAd, shopAds } from '@/lib/ads/book'
import { adView, bookFailureMessage, PENDING_MESSAGE } from '@/lib/ads/answer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * ── POST /api/v1/ads — buy an "Ad" placement for one of your listings for `hours` (1 to 90 days' worth, default a week),
 * paid over x402 v2 (owner 2026-11-23).
 *   1. No PAYMENT-SIGNATURE → 402 with PAYMENT-REQUIRED (base64 JSON; the same object is the body). Answered BEFORE any
 *      credential is read: it states only the public price, and it is what x402 clients and the Bazaar probe expect.
 *   2. With PAYMENT-SIGNATURE → the shop's Bearer token (scope listings:write) is required, then src/lib/ads/book.ts:
 *      201 + PAYMENT-RESPONSE once settled (200 for the same payment again), 202 while a lost confirmation is looked up on
 *      chain, 402 when the payment is refused (nothing charged), 4xx when the listing cannot be advertised (checked before
 *      any money moves).
 * GET /api/v1/ads — the shop's ads with their figures (scope analytics:read).
 */
const BUY_RATE_PER_IP = 30

function paymentRequired(error?: string, settlement?: SettlementResponse | null, hours?: number): NextResponse {
  const cfg = x402Config()
  if (!cfg) return apiError(503, 'ads_unavailable', 'Ads are not on sale right now.')
  const body = adPaymentRequired(cfg, 'http', error, hours)
  const res = NextResponse.json(body, { status: 402, headers: { 'Cache-Control': 'no-store' } })
  res.headers.set(HEADER_REQUIRED, encodeHeader(body))
  if (settlement) res.headers.set(HEADER_RESPONSE, encodeHeader(settlement))
  return res
}

export async function POST(req: NextRequest) {
  const cfg = x402Config()
  if (!cfg) return apiError(503, 'ads_unavailable', 'Ads are not on sale right now.')
  const limit = await rateLimit('ads-buy', clientIp(req), BUY_RATE_PER_IP, '1 m')
  if (!limit.success) return apiError(429, 'rate_limited', 'Too many requests; try again in a minute.', limit)

  // The body first: `hours` picks the price the 402 states. Capped, and read before any credential (the 402 is public).
  let listingId = ''
  let hoursRaw: unknown
  try {
    const raw = await readBytesCapped(req, JSON_BODY_CAP)
    const body: unknown = raw && raw.length ? JSON.parse(new TextDecoder().decode(raw)) : null
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const b = body as { listingId?: unknown; hours?: unknown }
      if (typeof b.listingId === 'string') listingId = b.listingId.trim()
      hoursRaw = b.hours
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 413) return apiError(413, 'payload_too_large', 'Request body too large.')
    // Not JSON: no listing and no hours — a probe still gets the (weekly) 402; a payment is refused below for its listingId.
  }
  const hours = adHours(hoursRaw)
  if (hours == null) return apiError(400, 'invalid_input', `hours must be a whole number from 1 to ${AD_MAX_HOURS}.`)

  const signature = req.headers.get(HEADER_SIGNATURE)
  if (!signature) return paymentRequired('PAYMENT-SIGNATURE header is required', null, hours)

  const r = await resolveApiKey(req, 'listings:write')
  if (!r.ok) return apiAuthError(r)
  if (!listingId) return apiError(400, 'invalid_input', 'listingId is required.', r.rate)

  const payload = decodeHeader(signature)
  if (payload == null) return paymentRequired('invalid_payload', null, hours)

  try {
    const out = await bookAd({ cfg, keyId: r.auth.keyId, sellerId: r.auth.sellerId, listingId, rawPayload: payload, via: 'http', hours })
    switch (out.kind) {
      case 'booked': {
        const res = apiOk({ ad: adView(out.ad) }, r.rate, out.replay ? 200 : 201)
        res.headers.set(HEADER_RESPONSE, encodeHeader(out.settlement))
        return res
      }
      case 'pending':
        return apiOk({ ad: adView(out.ad), message: PENDING_MESSAGE }, r.rate, 202)
      case 'payment_invalid':
      case 'payment_failed': {
        const res = paymentRequired(bookFailureMessage(out), out.kind === 'payment_failed' ? out.settlement : null, hours)
        return res
      }
      case 'refused':
        return apiError(out.status, out.code, out.message, r.rate)
      case 'unavailable':
        return apiError(503, 'payment_unavailable', out.message, r.rate)
    }
  } catch (e) {
    // Before scripts/listing-ad-ddl.mjs has run on this database: not on sale — and nothing was verified or settled yet.
    if (e instanceof Error && /42P01|"ListingAd" does not exist/.test(e.message)) return apiError(503, 'ads_unavailable', 'Ads are not on sale right now.', r.rate)
    logError(e, { op: 'ads.buy' })
    return apiError(500, 'internal', 'Something went wrong. If you were charged, repeat the same request with the same payment: it is matched, never charged twice.', r.rate)
  }
}

export async function GET(req: NextRequest) {
  const r = await resolveApiKey(req, 'analytics:read')
  if (!r.ok) return apiAuthError(r)
  if (!r.auth.sellerId) return apiOk({ ads: [] }, r.rate)
  return apiOk({ ads: await shopAds(r.auth.sellerId, 50, x402Config()) }, r.rate)
}
