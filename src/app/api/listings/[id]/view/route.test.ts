import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CRAWLER_UAS, PERSON_UAS } from '@/lib/__fixtures__/user-agents'

/**
 * POST /api/listings/[id]/view — A CRAWLER NEVER MOVES `Listing.views` (2026-10-03).
 *
 * Cloudflare, 2026-10-02: `meta-externalagent` was 58% of visitor traffic and fired ~6.9k POSTs a day
 * at this route and its siblings, because it renders the page and so runs <TrackView>. The footer
 * counters were guarded on 2026-09-17; this one was not. A crawler gets the same 200 `counted:false`
 * as a deduped person — no 4xx, no crawl error — and touches neither the limiter nor the counter. A
 * person in any browser, the Facebook and Zalo in-app ones included, is still counted.
 */

type Row = Record<string, unknown>

const h = vi.hoisted(() => ({
  limiterCalls: 0,
  bumps: [] as Array<[string, string]>,
  listing: { id: 'L1', verified: true, status: 'active', seller: { ownerId: 'seller-1' } } as Row | null,
  viewer: null as string | null,
}))

vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async () => { h.limiterCalls++; return { success: true } },
}))
vi.mock('@/lib/db', () => ({
  db: { listing: { findUnique: async () => h.listing } },
}))
vi.mock('@/lib/admin', () => ({ getCurrentProfileId: async () => h.viewer }))
vi.mock('@/lib/listing-counters', () => ({
  bumpListingCounter: async (id: string, counter: string) => { h.bumps.push([id, counter]); return 1 },
}))

const { POST } = await import('./route')

async function view(ua: string | null) {
  const headers: Record<string, string> = { 'cf-connecting-ip': '203.0.113.7' }
  if (ua !== null) headers['user-agent'] = ua
  const res = await POST(new Request('https://eno.vn/api/listings/L1/view', { method: 'POST', headers }), { params: Promise.resolve({ id: 'L1' }) })
  return { status: res.status, body: (await res.json()) as Row }
}

beforeEach(() => {
  h.limiterCalls = 0
  h.bumps = []
  h.listing = { id: 'L1', verified: true, status: 'active', seller: { ownerId: 'seller-1' } }
  h.viewer = null
})

describe('a crawler is answered and not counted', () => {
  for (const [name, ua] of Object.entries(CRAWLER_UAS)) {
    it(name || 'empty user-agent', async () => {
      expect(await view(ua)).toEqual({ status: 200, body: { ok: true, counted: false } })
      expect(h.bumps).toEqual([])
      // ⚠️ Before the limiter too: rl_check INSERTs a row per call, which is a write per crawl.
      expect(h.limiterCalls).toBe(0)
    })
  }

  it('no user-agent header at all', async () => {
    expect(await view(null)).toEqual({ status: 200, body: { ok: true, counted: false } })
    expect(h.bumps).toEqual([])
  })
})

describe('a person is counted, in whatever browser they opened the link', () => {
  for (const [name, ua] of Object.entries(PERSON_UAS)) {
    it(name, async () => {
      expect(await view(ua)).toEqual({ status: 200, body: { ok: true, counted: true } })
      expect(h.bumps).toEqual([['L1', 'views']])
    })
  }

  it('the existing exclusions still hold for a person (seller self-view, a hidden listing)', async () => {
    const ua = PERSON_UAS['Facebook in-app (iOS)']
    h.viewer = 'seller-1'
    expect((await view(ua)).body).toEqual({ ok: true, counted: false })
    h.viewer = null
    h.listing = { id: 'L1', verified: true, status: 'hidden', seller: { ownerId: 'seller-1' } }
    expect((await view(ua)).body).toEqual({ ok: true, counted: false })
    expect(h.bumps).toEqual([])
  })
})
