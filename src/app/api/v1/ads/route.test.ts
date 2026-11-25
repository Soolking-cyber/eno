import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/v1/ads over x402's HTTP transport (owner 2026-11-23): the 402 comes before any credential (it states only the
 * public price — what x402 clients and the Bazaar probe expect); a payment needs the shop's Bearer token; the outcomes map
 * to 201 + PAYMENT-RESPONSE, 200 (same payment again), 202 (confirming), 402 (refused, nothing charged) and 4xx.
 */
vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({
  auth: true, booked: { kind: 'booked' } as Record<string, unknown>, calls: 0, scopeAsked: [] as string[],
  review: { kind: 'approved', creative: { id: 'cr1' }, view: { status: 'approved', creative_id: 'cr1', reasons: [], permit_classes: [], reused: false, reviewed_at: '2026-11-25T08:00:00.000Z' } } as Record<string, unknown>,
  reviews: 0, bookArgs: null as Record<string, unknown> | null,
  creativeCheck: { ok: true, creative: { id: 'cr1', contentHash: 'h' } } as Record<string, unknown>,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, limit: 30, remaining: 29, resetSec: 60 }) }))
vi.mock('@/lib/api/auth', () => ({
  resolveApiKey: async (_req: unknown, scope: string) => (h.scopeAsked.push(scope), h.auth
    ? { ok: true, auth: { keyId: 'k1', sellerId: 's1', profileId: 'p1', scopes: new Set(['listings:write']) }, rate: { limit: 600, remaining: 599, resetSec: 60 } }
    : { ok: false, status: 401, code: 'unauthorized', message: 'Missing API key.' }),
}))
const AD = { id: 'ad1', listingId: 'l1', status: 'active', startsAt: new Date('2026-11-23T08:00:00Z'), endsAt: new Date('2026-11-30T08:00:00Z'), txHash: `0x${'c'.repeat(64)}`, network: 'eip155:8453', amount: '3760000' }
vi.mock('@/lib/ads/book', () => ({
  AD_CREATIVE_MAX_HOURS: 168,
  bookAd: async (a: Record<string, unknown>) => { h.calls++; h.bookArgs = a; return h.booked },
  checkAdCreative: async () => h.creativeCheck,
  shopAds: async () => [],
}))
vi.mock('@/lib/ads/creative-review', () => ({ reviewCreative: async () => { h.reviews++; return h.review } }))
vi.mock('@/lib/ads/offer', () => ({
  HEADER_CREATIVE_ID: 'Eno-Ad-Creative-Id',
  adPaymentRequired: (_c: unknown, _t: string, error?: string, hours?: number, kind?: string) => ({ x402Version: 2, ...(error ? { error } : {}), resource: { url: 'https://eno.vn/api/v1/ads' }, accepts: [{ scheme: 'exact', hours }], kind }),
}))

process.env.X402_PAY_TO = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C'
process.env.X402_NETWORK = 'eip155:84532'
process.env.X402_FACILITATOR_URL = 'https://x402.org/facilitator'
const { POST } = await import('./route')
const { encodeHeader, decodeHeader } = await import('@/lib/x402/wire')

const req = (headers: Record<string, string> = {}, body: unknown = { listingId: 'l1' }) =>
  new NextRequest('https://eno.vn/api/v1/ads', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const PAID = { 'payment-signature': encodeHeader({ x402Version: 2 }), authorization: 'Bearer eno_live_x' }

beforeEach(() => {
  h.auth = true
  h.calls = 0
  h.scopeAsked = []
  h.reviews = 0
  h.bookArgs = null
  h.review = { kind: 'approved', creative: { id: 'cr1' }, view: { status: 'approved', creative_id: 'cr1', reasons: [], permit_classes: [], reused: false, reviewed_at: '2026-11-25T08:00:00.000Z' } }
  h.creativeCheck = { ok: true, creative: { id: 'cr1', contentHash: 'h' } }
  h.booked = { kind: 'booked', ad: AD, settlement: { success: true, transaction: AD.txHash, network: 'eip155:8453' }, replay: false }
})

describe('POST /api/v1/ads', () => {
  it('no payment → 402 with PAYMENT-REQUIRED (the body is the same object), before any credential', async () => {
    h.auth = false
    const r = await POST(req())
    expect(r.status).toBe(402)
    const header = decodeHeader(r.headers.get('PAYMENT-REQUIRED')) as Record<string, unknown>
    expect(header).toMatchObject({ x402Version: 2, accepts: [{ scheme: 'exact' }] })
    expect(await r.json()).toEqual(header)
    expect(h.calls).toBe(0)
  })

  it('a payment without the shop\'s token → 401, nothing booked', async () => {
    h.auth = false
    const r = await POST(req({ 'payment-signature': PAID['payment-signature'] }))
    expect(r.status).toBe(401)
    expect(h.calls).toBe(0)
  })

  it('paid → 201 with the ad and PAYMENT-RESPONSE; the same payment again → 200', async () => {
    const r = await POST(req(PAID))
    expect(r.status).toBe(201)
    expect((await r.json()).ad).toMatchObject({ id: 'ad1', listing_id: 'l1', status: 'active', ends_at: '2026-11-30T08:00:00.000Z' })
    expect(decodeHeader(r.headers.get('PAYMENT-RESPONSE'))).toMatchObject({ success: true, transaction: AD.txHash })
    h.booked = { ...h.booked, replay: true }
    expect((await POST(req(PAID))).status).toBe(200)
  })

  it('confirming → 202; refused payment → 402 with the reason; listing refused → its status', async () => {
    h.booked = { kind: 'pending', ad: { ...AD, status: 'unknown', startsAt: null, endsAt: null, txHash: null } }
    const pending = await POST(req(PAID))
    expect(pending.status).toBe(202)
    expect((await pending.json()).message).toMatch(/never charged twice/)
    h.booked = { kind: 'payment_failed', reason: 'insufficient_funds', settlement: { success: false, transaction: '', network: 'eip155:8453', errorReason: 'insufficient_funds' } }
    const failed = await POST(req(PAID))
    expect(failed.status).toBe(402)
    expect((decodeHeader(failed.headers.get('PAYMENT-REQUIRED')) as { error: string }).error).toMatch(/insufficient_funds.*never charged twice/)
    expect(decodeHeader(failed.headers.get('PAYMENT-RESPONSE'))).toMatchObject({ success: false })
    // A final "never charged" reason says so, and does not suggest the payment may still land.
    h.booked = { kind: 'payment_failed', reason: 'authorization_expired_unpaid', settlement: null }
    const expired = await POST(req(PAID))
    expect((decodeHeader(expired.headers.get('PAYMENT-REQUIRED')) as { error: string }).error).toMatch(/expired or was cancelled without being charged/)
    h.booked = { kind: 'refused', status: 403, code: 'not_public', message: 'Only a live, public listing can be advertised.' }
    expect((await POST(req(PAID))).status).toBe(403)
  })

  it('hours that are not a whole number from 1 to 2160 → 400 before anything else; a valid one prices the 402', async () => {
    expect((await POST(req({}, { listingId: 'l1', hours: 0 }))).status).toBe(400)
    expect((await POST(req({}, { listingId: 'l1', hours: 1.5 }))).status).toBe(400)
    expect((await POST(req({}, { listingId: 'l1', hours: 3000 }))).status).toBe(400)
    expect((await POST(req({}, { listingId: 'l1', hours: null }))).status).toBe(400)
    expect((await POST(req({}, { listingId: 'l1', hours: 24 }))).status).toBe(402)
    expect(h.calls).toBe(0)
  })

  it('a payment header that is not base64 JSON → 402 invalid_payload; no listingId → 400', async () => {
    const bad = await POST(req({ ...PAID, 'payment-signature': '!!!' }))
    expect(bad.status).toBe(402)
    expect((await POST(req(PAID, {}))).status).toBe(400)
    expect(h.calls).toBe(0)
  })
})

/** The creative path (owner 2026-11-25): authenticated FIRST with ads:write, reviewed before any price, 1 to 168 hours. */
describe('POST /api/v1/ads — a creative', () => {
  const CREATIVE = { advertiserName: 'Bean', legalName: 'Bean Co', taxCode: '0312345678', headline: 'Coffee', imageUrl: 'https://cdn.example/a.jpg', clickUrl: 'https://bean.vn' }
  const REFUSED = { kind: 'refused', creative: { id: 'cr9' }, view: { status: 'refused', creative_id: 'cr9', reasons: [{ code: 'banned_gambling', en: 'Gambling…', vi: 'Cờ bạc…' }], permit_classes: [], reused: false, reviewed_at: '2026-11-25T08:00:00.000Z' } }

  it('⛔ no credential → 401 and NO review (an anonymous request never costs a model call)', async () => {
    h.auth = false
    const r = await POST(req({}, { creative: CREATIVE, hours: 24 }))
    expect(r.status).toBe(401)
    expect(h.reviews).toBe(0)
    expect(h.scopeAsked).toEqual(['ads:write'])
  })

  it('⛔ refused → 422 with the reasons, never a 402, nothing booked', async () => {
    h.review = REFUSED
    for (const headers of [{ authorization: 'Bearer eno_live_x' }, PAID]) {
      const r = await POST(req(headers, { creative: CREATIVE, hours: 24 }))
      expect(r.status).toBe(422)
      expect(r.headers.get('PAYMENT-REQUIRED')).toBeNull()
      expect(await r.json()).toMatchObject({ error: { code: 'ad_refused' }, review: { status: 'refused', reasons: [{ code: 'banned_gambling' }] } })
    }
    expect(h.calls).toBe(0)
  })

  it('the review unavailable → 503, over the budget → 429: never a price', async () => {
    h.review = { kind: 'unavailable', view: { status: 'unavailable', creative_id: null, reasons: [{ code: 'review_unavailable', en: '', vi: '' }], permit_classes: [], reused: false, reviewed_at: null } }
    const u = await POST(req({ authorization: 'Bearer eno_live_x' }, { creative: CREATIVE }))
    expect(u.status).toBe(503)
    expect((await u.json()).error.code).toBe('review_unavailable')
    h.review = { kind: 'limited', view: { status: 'limited', creative_id: null, reasons: [{ code: 'review_limit', en: '', vi: '' }], permit_classes: [], reused: false, reviewed_at: null } }
    expect((await POST(req({ authorization: 'Bearer eno_live_x' }, { creative: CREATIVE }))).status).toBe(429)
    expect(h.calls).toBe(0)
  })

  it('approved → 402 for the hours asked, the creative named in Eno-Ad-Creative-Id; then paid → booked as that creative', async () => {
    const r = await POST(req({ authorization: 'Bearer eno_live_x' }, { creative: CREATIVE, hours: 24 }))
    expect(r.status).toBe(402)
    expect(r.headers.get('Eno-Ad-Creative-Id')).toBe('cr1')
    expect(decodeHeader(r.headers.get('PAYMENT-REQUIRED'))).toMatchObject({ accepts: [{ hours: 24 }], kind: 'creative', error: expect.stringContaining('cr1') })
    const paid = await POST(req(PAID, { creative: CREATIVE, hours: 24 }))
    expect(paid.status).toBe(201)
    expect(h.bookArgs).toMatchObject({ creativeId: 'cr1', hours: 24, sellerId: 's1' })
    expect(h.bookArgs!.listingId).toBeUndefined()
  })

  it('{creativeId}: checked for this shop (refused → its status, no 402), else priced and booked', async () => {
    h.creativeCheck = { ok: false, status: 409, code: 'creative_removed', message: 'eno removed this ad creative.' }
    expect((await POST(req({ authorization: 'Bearer eno_live_x' }, { creativeId: 'cr1' }))).status).toBe(409)
    h.creativeCheck = { ok: true, creative: { id: 'cr1', contentHash: 'h' } }
    expect((await POST(req({ authorization: 'Bearer eno_live_x' }, { creativeId: 'cr1' }))).status).toBe(402)
    expect((await POST(req(PAID, { creativeId: 'cr1', hours: 1 }))).status).toBe(201)
    expect(h.reviews).toBe(0)
  })

  it('a creative runs 1 to 168 hours (168 when left out); more is refused before the credential is read', async () => {
    expect((await POST(req({ authorization: 'Bearer eno_live_x' }, { creative: CREATIVE, hours: 169 }))).status).toBe(400)
    expect(h.scopeAsked).toEqual([])
    const r = await POST(req({ authorization: 'Bearer eno_live_x' }, { creative: CREATIVE }))
    expect(decodeHeader(r.headers.get('PAYMENT-REQUIRED'))).toMatchObject({ accepts: [{ hours: 168 }] })
  })

  it('one target only: listingId with a creative → 400', async () => {
    expect((await POST(req(PAID, { listingId: 'l1', creative: CREATIVE }))).status).toBe(400)
    expect((await POST(req(PAID, { listingId: 'l1', creativeId: 'cr1' }))).status).toBe(400)
    expect(h.calls + h.reviews).toBe(0)
  })

  it('the listing path is unchanged: its anonymous 402 asks for no credential and runs no review', async () => {
    h.auth = false
    expect((await POST(req({}, { listingId: 'l1' }))).status).toBe(402)
    expect(h.scopeAsked).toEqual([])
    expect(h.reviews).toBe(0)
  })
})
