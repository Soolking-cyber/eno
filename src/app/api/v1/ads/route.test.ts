import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/v1/ads over x402's HTTP transport (owner 2026-11-23): the 402 comes before any credential (it states only the
 * public price — what x402 clients and the Bazaar probe expect); a payment needs the shop's Bearer token; the outcomes map
 * to 201 + PAYMENT-RESPONSE, 200 (same payment again), 202 (confirming), 402 (refused, nothing charged) and 4xx.
 */
vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ auth: true, booked: { kind: 'booked' } as Record<string, unknown>, calls: 0 }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, limit: 30, remaining: 29, resetSec: 60 }) }))
vi.mock('@/lib/api/auth', () => ({
  resolveApiKey: async () => (h.auth
    ? { ok: true, auth: { keyId: 'k1', sellerId: 's1', profileId: 'p1', scopes: new Set(['listings:write']) }, rate: { limit: 600, remaining: 599, resetSec: 60 } }
    : { ok: false, status: 401, code: 'unauthorized', message: 'Missing API key.' }),
}))
const AD = { id: 'ad1', listingId: 'l1', status: 'active', startsAt: new Date('2026-11-23T08:00:00Z'), endsAt: new Date('2026-11-30T08:00:00Z'), txHash: `0x${'c'.repeat(64)}`, network: 'eip155:8453', amount: '3760000' }
vi.mock('@/lib/ads/book', () => ({
  bookAd: async () => { h.calls++; return h.booked },
  shopAds: async () => [],
}))
vi.mock('@/lib/ads/offer', () => ({ adPaymentRequired: (_c: unknown, _t: string, error?: string) => ({ x402Version: 2, ...(error ? { error } : {}), resource: { url: 'https://eno.vn/api/v1/ads' }, accepts: [{ scheme: 'exact' }] }) }))

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
