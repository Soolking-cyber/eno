import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

/**
 * The paid-ad MCP tools (ad-tools.ts). create_ad (owner 2026-11-25): the review runs before any payment request — a
 * refusal comes back as the review (nothing to pay), an approval as the x402 PaymentRequired; paid, it books the creative.
 * And the texts stay inside WebMCP's 500 characters a tool and 150 a field.
 */
vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({
  review: null as unknown,
  reviewArgs: null as unknown,
  bookArgs: null as Record<string, unknown> | null,
  booked: null as unknown,
  offer: {} as Record<string, unknown>,
  profiles: { p1: { email: 'shop@example.com' }, p_admin: { email: 'owner@eno.vn' } } as Record<string, { email: string }>,
}))
// The private test's admin lookup (src/lib/ads/creative-gate.ts): ApiAuth.profileId → Profile.email → ADMIN_EMAILS (the real
// isAdminEmail is creative-gate.test.ts's).
vi.mock('@/lib/db', () => ({ db: { profile: { findUnique: async ({ where }: { where: { id: string } }) => h.profiles[where.id] ?? null } } }))
vi.mock('@/lib/admin', () => ({ isAdminEmail: (e?: string | null) => !!e && (process.env.ADMIN_EMAILS ?? '').split(',').includes(e.toLowerCase()) }))
const VIEW = { status: 'approved', creative_id: 'cr1', reasons: [], permit_classes: [], reused: false, reviewed_at: '2026-11-25T08:00:00.000Z' }
vi.mock('@/lib/x402/config', () => ({
  x402Config: () => ({ network: 'eip155:8453', payTo: '0x' + '1'.repeat(40), adPriceAtomic: '3760000', asset: '0x2', extra: { name: 'USD Coin', version: '2' } }),
  usdcText: () => '3.76', AD_MAX_HOURS: 2160,
  adHours: (v: unknown) => (v === undefined ? 168 : typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 2160 ? v : null),
  adPriceAtomicFor: () => '22381',
}))
vi.mock('@/lib/ads/offer', () => ({
  adOffer: async () => h.offer,
  adPaymentRequired: (_c: unknown, transport: string, error: string, hours: number, kind: string) => ({ x402Version: 2, error, transport, hours, kind }),
  AD_POLICY_URL: 'https://eno.vn/advertising-policy',
}))
vi.mock('@/lib/ads/creative-review', () => ({
  reviewCreative: async (_s: string, raw: unknown) => { h.reviewArgs = raw; return h.review },
  storedReview: async () => VIEW,
}))
vi.mock('@/lib/ads/book', () => ({
  AD_CREATIVE_MAX_HOURS: 168,
  checkAdCreative: async (id: string) => (id === 'cr1' ? { ok: true, creative: { id, contentHash: 'h' } } : { ok: false, status: 404, code: 'not_found', message: 'Ad creative not found in this shop.' }),
  checkAdListing: async () => ({ ok: true }),
  bookAd: async (a: Record<string, unknown>) => { h.bookArgs = a; return h.booked },
  shopAds: async () => [],
}))

const { AD_TOOLS } = await import('./ad-tools')
const { ToolError, ToolPaymentRequired, ToolResultWithMeta } = await import('./tool-types')
const createAd = AD_TOOLS.find((t) => t.name === 'create_ad')!
const AUTH = { keyId: 'k1', sellerId: 's1', profileId: 'p1', scopes: new Set(['ads:write']) } as never
const CREATIVE = { advertiserName: 'Bean', legalName: 'Bean Co', taxCode: '0312345678', headline: 'Fresh coffee', imageUrl: 'https://cdn.example/a.jpg', clickUrl: 'https://bean.vn' }
const call = (args: Record<string, unknown>, meta?: Record<string, unknown>) => createAd.handler(AUTH, createAd.input.parse(args) as Record<string, unknown>, meta ? { meta } : undefined)

beforeEach(() => {
  // Open to every shop, as after the private test; the test itself has its own describe below.
  vi.stubEnv('ADS_CREATIVE_OPEN', '1')
  vi.stubEnv('ADMIN_EMAILS', 'owner@eno.vn')
  h.review = { kind: 'approved', creative: { id: 'cr1' }, view: VIEW }
  h.reviewArgs = null
  h.bookArgs = null
  h.booked = { kind: 'booked', ad: { id: 'ad1', listingId: null, creativeId: 'cr1', status: 'active', durationSec: 86_400, startsAt: new Date(), endsAt: new Date(), txHash: '0xab', network: 'eip155:8453', amount: '537143' }, settlement: { success: true, transaction: '0xab', network: 'eip155:8453' }, replay: false }
})
afterEach(() => vi.unstubAllEnvs())

describe('create_ad', () => {
  it('scope ads:write; it spends money (not read-only, not idempotent)', () => {
    expect(createAd.scope).toBe('ads:write')
    expect(createAd.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: false })
  })

  it('⛔ refused → the review with its reasons, never a payment request', async () => {
    h.review = { kind: 'refused', creative: { id: 'cr9' }, view: { ...VIEW, status: 'refused', creative_id: 'cr9', reasons: [{ code: 'banned_gambling', en: 'Gambling, betting and lotteries cannot be advertised.', vi: '…' }] } }
    const r = await call({ creative: CREATIVE, hours: 24 }) as { review: { status: string; reasons: { code: string }[] }; ad: unknown; message: string }
    expect(r.review).toMatchObject({ status: 'refused', reasons: [{ code: 'banned_gambling' }] })
    expect(r.ad).toBeNull()
    expect(r.message).toMatch(/nothing to pay.*Gambling/)
    expect(createAd.output.safeParse(r).success).toBe(true)
    expect(h.reviewArgs).toEqual(CREATIVE)
    expect(h.bookArgs).toBeNull()
  })

  it('the review not judged (unavailable, over the budget) → an error, never a price', async () => {
    h.review = { kind: 'unavailable', view: VIEW }
    await expect(call({ creative: CREATIVE })).rejects.toMatchObject({ code: 'review_unavailable' })
    h.review = { kind: 'limited', view: VIEW }
    await expect(call({ creative: CREATIVE })).rejects.toMatchObject({ code: 'review_limit' })
  })

  it('approved, no payment → the x402 PaymentRequired for the creative and the hours asked', async () => {
    const e = await call({ creative: CREATIVE, hours: 24 }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ToolPaymentRequired)
    expect((e as InstanceType<typeof ToolPaymentRequired>).paymentRequired).toMatchObject({ transport: 'mcp', hours: 24, kind: 'creative', error: expect.stringContaining('cr1') })
  })

  it('approved and paid → booked as that creative (never a listing), the settlement in _meta', async () => {
    const r = await call({ creative: CREATIVE, hours: 24 }, { 'x402/payment': { x402Version: 2 } })
    expect(r).toBeInstanceOf(ToolResultWithMeta)
    expect(h.bookArgs).toMatchObject({ creativeId: 'cr1', hours: 24, via: 'mcp', sellerId: 's1' })
    expect(h.bookArgs!.listingId).toBeUndefined()
    expect(createAd.output.safeParse((r as InstanceType<typeof ToolResultWithMeta>).result).success).toBe(true)
  })

  it('the paid call repeats the same fields: the review is asked again (its stored verdict is reused by content)', async () => {
    await call({ creative: CREATIVE, hours: 24 }).catch(() => {})
    await call({ creative: CREATIVE, hours: 24 }, { 'x402/payment': { x402Version: 2 } })
    expect(h.reviewArgs).toEqual(CREATIVE)
    expect(h.bookArgs).toMatchObject({ creativeId: 'cr1' })
  })

  it('1 to 168 hours', async () => {
    await expect(call({ creative: CREATIVE, hours: 169 })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(call({ creative: CREATIVE, hours: 0 })).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

/** The private test (src/lib/ads/creative-gate.ts, ADS_CREATIVE_OPEN unset): create_ad answers an admin only. */
describe('create_ad while creative ads are in their private test', () => {
  beforeEach(() => { vi.stubEnv('ADS_CREATIVE_OPEN', '') })
  const ADMIN = { keyId: 'k2', sellerId: 's1', profileId: 'p_admin', scopes: new Set(['ads:write']) } as never

  it('⛔ a shop that is not an admin → creative_ads_not_open, before any review (no model call) or payment request', async () => {
    await expect(call({ creative: CREATIVE, hours: 24 })).rejects.toMatchObject({ code: 'creative_ads_not_open' })
    await expect(call({ creative: CREATIVE, hours: 24 }, { 'x402/payment': { x402Version: 2 } })).rejects.toBeInstanceOf(ToolError)
    expect(h.reviewArgs).toBeNull()
    expect(h.bookArgs).toBeNull()
  })

  it('an admin is reviewed and booked as before, and named to bookAd for its own re-check', async () => {
    const e = await createAd.handler(ADMIN, createAd.input.parse({ creative: CREATIVE, hours: 24 }) as Record<string, unknown>).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ToolPaymentRequired)
    expect(h.reviewArgs).toEqual(CREATIVE)
    await createAd.handler(ADMIN, createAd.input.parse({ creative: CREATIVE, hours: 24 }) as Record<string, unknown>, { meta: { 'x402/payment': { x402Version: 2 } } })
    expect(h.bookArgs).toMatchObject({ creativeId: 'cr1', profileId: 'p_admin' })
  })
})

describe('get_ad_offer — creative_ads.status', () => {
  const getOffer = AD_TOOLS.find((t) => t.name === 'get_ad_offer')!
  const offer = (status: 'open' | 'testing', note: string | null) => ({
    available: true, price: { usdc: '3.76', network: 'eip155:8453' }, price_vnd_reference: 99000, duration_days: 7, placements: [{ id: 'search', text: 'first' }],
    audience: { public_listings: 10, running_ads: 0 },
    creative_ads: { status, note, placement: { text: 'The first card.', max_hours: 168 }, restrictions: { refused: [], claims_refused: [], permit_classes_allowed: [] }, policy_url: 'https://eno.vn/advertising-policy' },
  })

  it('passes the offer\'s status and its sentence through, in the declared shape', async () => {
    for (const [status, note] of [['testing', 'Your own ads are in a private test; sales open to every shop after that test.'], ['open', null]] as const) {
      h.offer = offer(status, note)
      const r = await getOffer.handler(AUTH, getOffer.input.parse({}) as Record<string, unknown>) as { creative_ads: { status: string; note: string | null } }
      expect(r.creative_ads).toMatchObject({ status, note })
      expect(getOffer.output.safeParse(r).success).toBe(true)
    }
  })
})

describe('the ad tools\' texts (WebMCP: 500 characters a tool, 150 a field)', () => {
  /** Every `description` in a JSON schema, with its path. */
  const fieldTexts = (n: unknown, path = ''): [string, string][] => {
    if (!n || typeof n !== 'object') return []
    const o = n as Record<string, unknown>
    const here: [string, string][] = path && typeof o.description === 'string' ? [[path, o.description]] : []
    const props = Object.entries((o.properties as Record<string, unknown>) ?? {}).flatMap(([k, v]) => fieldTexts(v, `${path}.${k}`))
    return [...here, ...props, ...(o.items ? fieldTexts(o.items, `${path}[]`) : [])]
  }
  it('every ad tool describes itself in at most 500 characters', () => {
    for (const t of AD_TOOLS) expect(t.description.length, t.name).toBeLessThanOrEqual(500)
  })
  it('the tools written or rewritten for creatives keep every input and output field within 150 characters', () => {
    for (const t of AD_TOOLS.filter((x) => ['get_ad_offer', 'create_ad', 'get_ad_stats'].includes(x.name))) {
      for (const [path, text] of [...fieldTexts(z.toJSONSchema(t.input)), ...fieldTexts(z.toJSONSchema(t.output, { io: 'output' }))]) {
        expect(text.length, `${t.name}${path}`).toBeLessThanOrEqual(150)
      }
    }
  })
})
