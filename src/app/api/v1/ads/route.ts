import { NextRequest, NextResponse } from 'next/server'
import { resolveApiKey, type ApiAuth } from '@/lib/api/auth'
import { apiAuthError, apiError, apiOk } from '@/lib/api/respond'
import { JSON_BODY_CAP, readBytesCapped } from '@/lib/api/body'
import { ApiError } from '@/lib/api/api-error'
import { rateLimit, type RateLimitSnapshot } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import { logError } from '@/lib/log'
import { AD_MAX_HOURS, adHours, x402Config, type X402Config } from '@/lib/x402/config'
import { HEADER_REQUIRED, HEADER_RESPONSE, HEADER_SIGNATURE, decodeHeader, encodeHeader, type SettlementResponse } from '@/lib/x402/wire'
import { adPaymentRequired, HEADER_CREATIVE_ID } from '@/lib/ads/offer'
import { AD_CREATIVE_MAX_HOURS, bookAd, checkAdCreative, shopAds, type BookResult } from '@/lib/ads/book'
import { adView, bookFailureMessage, PENDING_MESSAGE } from '@/lib/ads/answer'
import { reviewCreative, type ReviewView } from '@/lib/ads/creative-review'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * ── POST /api/v1/ads — buy an ad over x402 v2 (owner 2026-11-23; any lawful advertiser 2026-11-25). Three bodies:
 *   {listingId, hours}   one of the shop's live listings, shown first in matching results (1 h to 90 days);
 *   {creative, hours}    the shop's own ad (a picture, a headline, an https landing page) in the feed card, REVIEWED FIRST
 *                        (src/lib/ads/creative-review.ts), 1 to 168 hours;
 *   {creativeId, hours}  a creative already approved for this shop.
 * The listing ad, as since 2026-11-23:
 *   1. No PAYMENT-SIGNATURE → 402 with PAYMENT-REQUIRED (base64 JSON; the same object is the body). Answered BEFORE any
 *      credential is read: it states only the public price, and it is what x402 clients and the Bazaar probe expect.
 *   2. With PAYMENT-SIGNATURE → the shop's Bearer token (scope listings:write) is required, then src/lib/ads/book.ts:
 *      201 + PAYMENT-RESPONSE once settled (200 for the same payment again), 202 while a lost confirmation is looked up on
 *      chain, 402 when the payment is refused (nothing charged), 4xx when the listing cannot be advertised (checked before
 *      any money moves).
 * ⛔ A CREATIVE IS AUTHENTICATED FIRST (scope ads:write) — a review costs eno a model call, so no anonymous request runs
 *    one — then reviewed (or its stored verdict reused): refused → 422 with the reasons and NEVER a 402 (nothing to pay);
 *    the review unavailable → 503; approved → the 402 (Eno-Ad-Creative-Id names it), and with PAYMENT-SIGNATURE the same
 *    book.ts path, which checks the creative again before the facilitator is asked anything.
 * GET /api/v1/ads — the shop's ads with their figures (scope analytics:read).
 */
const BUY_RATE_PER_IP = 30

function paymentRequired(error?: string, settlement?: SettlementResponse | null, hours?: number, creativeId?: string): NextResponse {
  const cfg = x402Config()
  if (!cfg) return apiError(503, 'ads_unavailable', 'Ads are not on sale right now.')
  const body = adPaymentRequired(cfg, 'http', error, hours, creativeId ? 'creative' : 'listing')
  const res = NextResponse.json(body, { status: 402, headers: { 'Cache-Control': 'no-store' } })
  res.headers.set(HEADER_REQUIRED, encodeHeader(body))
  if (settlement) res.headers.set(HEADER_RESPONSE, encodeHeader(settlement))
  if (creativeId) res.headers.set(HEADER_CREATIVE_ID, creativeId)
  return res
}

/** The review, stated with its refusal (422), its not-judged answer (503 / 429) — never a price. */
function reviewAnswer(status: 422 | 429 | 503, code: string, message: string, review: ReviewView, rate?: RateLimitSnapshot): NextResponse {
  const res = apiError(status, code, message, rate)
  const out = NextResponse.json({ error: { code, message }, review }, { status, headers: res.headers })
  out.headers.set('Cache-Control', 'no-store')
  return out
}

/** A booking's outcome as HTTP (the same for a listing and a creative). */
function bookingAnswer(out: BookResult, rate: RateLimitSnapshot, hours: number, creativeId?: string): NextResponse {
  switch (out.kind) {
    case 'booked': {
      const res = apiOk({ ad: adView(out.ad) }, rate, out.replay ? 200 : 201)
      res.headers.set(HEADER_RESPONSE, encodeHeader(out.settlement))
      return res
    }
    case 'pending':
      return apiOk({ ad: adView(out.ad), message: PENDING_MESSAGE }, rate, 202)
    case 'payment_invalid':
    case 'payment_failed':
      return paymentRequired(bookFailureMessage(out), out.kind === 'payment_failed' ? out.settlement : null, hours, creativeId)
    case 'refused':
      return apiError(out.status, out.code, out.message, rate)
    case 'unavailable':
      return apiError(503, 'payment_unavailable', out.message, rate)
  }
}

/** Before scripts/listing-ad-ddl.mjs has run on this database: not on sale — and nothing was verified or settled yet.
 *  42703: a column this revision reads (ListingAd.creativeId) that the DDL has not added yet. */
const beforeDdl = (e: unknown) => e instanceof Error && /42P01|42703|"ListingAd" does not exist|"AdCreative" does not exist|column .* does not exist/.test(e.message)

function failed(e: unknown, rate?: RateLimitSnapshot): NextResponse {
  if (beforeDdl(e)) return apiError(503, 'ads_unavailable', 'Ads are not on sale right now.', rate)
  logError(e, { op: 'ads.buy' })
  return apiError(500, 'internal', 'Something went wrong. If you were charged, repeat the same request with the same payment: it is matched, never charged twice.', rate)
}

async function creativeAd(req: NextRequest, cfg: X402Config, p: { creative?: unknown; creativeId: string; hoursRaw: unknown }): Promise<NextResponse> {
  const hours = adHours(p.hoursRaw === undefined ? AD_CREATIVE_MAX_HOURS : p.hoursRaw)
  if (hours == null || hours > AD_CREATIVE_MAX_HOURS) return apiError(400, 'invalid_input', `hours must be a whole number from 1 to ${AD_CREATIVE_MAX_HOURS} for a creative ad.`)
  const r = await resolveApiKey(req, 'ads:write')
  if (!r.ok) return apiAuthError(r)
  const auth: ApiAuth = r.auth
  if (!auth.sellerId) return apiError(403, 'shop_required', 'Ads are bought by a shop: connect with a shop account.', r.rate)
  try {
    let creativeId = p.creativeId
    if (p.creative !== undefined) {
      const outcome = await reviewCreative(auth.sellerId, p.creative)
      if (outcome.kind === 'refused') return reviewAnswer(422, 'ad_refused', 'The ad did not pass the review; nothing was charged. See review.reasons.', outcome.view, r.rate)
      if (outcome.kind === 'limited') return reviewAnswer(429, 'review_limit', 'This shop has asked for too many ad reviews today.', outcome.view, r.rate)
      if (outcome.kind !== 'approved') return reviewAnswer(503, 'review_unavailable', 'The review could not run just now; nothing can be paid for. Try again in a few minutes.', outcome.view, r.rate)
      creativeId = outcome.creative.id
    } else {
      const c = await checkAdCreative(creativeId, auth.sellerId)
      if (!c.ok) return apiError(c.status, c.code, c.message, r.rate)
    }
    const signature = req.headers.get(HEADER_SIGNATURE)
    if (!signature) return paymentRequired(`Payment required to run approved ad creative ${creativeId} for ${hours} hours`, null, hours, creativeId)
    const payload = decodeHeader(signature)
    if (payload == null) return paymentRequired('invalid_payload', null, hours, creativeId)
    const out = await bookAd({ cfg, keyId: auth.keyId, sellerId: auth.sellerId, creativeId, rawPayload: payload, via: 'http', hours })
    return bookingAnswer(out, r.rate, hours, creativeId)
  } catch (e) {
    return failed(e, r.rate)
  }
}

export async function POST(req: NextRequest) {
  const cfg = x402Config()
  if (!cfg) return apiError(503, 'ads_unavailable', 'Ads are not on sale right now.')
  const limit = await rateLimit('ads-buy', clientIp(req), BUY_RATE_PER_IP, '1 m')
  if (!limit.success) return apiError(429, 'rate_limited', 'Too many requests; try again in a minute.', limit)

  // The body first: `hours` picks the price the 402 states. Capped, and read before any credential (the 402 is public).
  let listingId = ''
  let creativeId = ''
  let creative: unknown
  let hoursRaw: unknown
  try {
    const raw = await readBytesCapped(req, JSON_BODY_CAP)
    const body: unknown = raw && raw.length ? JSON.parse(new TextDecoder().decode(raw)) : null
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const b = body as { listingId?: unknown; creativeId?: unknown; creative?: unknown; hours?: unknown }
      if (typeof b.listingId === 'string') listingId = b.listingId.trim()
      if (typeof b.creativeId === 'string') creativeId = b.creativeId.trim()
      if ('creative' in b) creative = b.creative
      hoursRaw = b.hours
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 413) return apiError(413, 'payload_too_large', 'Request body too large.')
    // Not JSON: no listing and no hours — a probe still gets the (weekly) 402; a payment is refused below for its listingId.
  }
  if ([listingId, creativeId, creative !== undefined].filter(Boolean).length > 1) {
    return apiError(400, 'invalid_input', 'Send one of listingId, creative or creativeId.')
  }
  if (creative !== undefined || creativeId) return creativeAd(req, cfg, { creative, creativeId, hoursRaw })

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
    return bookingAnswer(out, r.rate, hours)
  } catch (e) {
    return failed(e, r.rate)
  }
}

export async function GET(req: NextRequest) {
  const r = await resolveApiKey(req, 'analytics:read')
  if (!r.ok) return apiAuthError(r)
  if (!r.auth.sellerId) return apiOk({ ads: [] }, r.rate)
  return apiOk({ ads: await shopAds(r.auth.sellerId, 50, x402Config()) }, r.rate)
}
