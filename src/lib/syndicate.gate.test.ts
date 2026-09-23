import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Publish-time syndication posts only what is PUBLIC, here, now (audit #22) ─────────────────────

const h = vi.hoisted(() => ({
  row: null as null | { verified: boolean; status: string; sellerId: string },
  hidden: false,
  desk: false,
  quotaOk: true,
  quotaThrows: false,
}))
vi.mock('server-only', () => ({}))
vi.mock('./db', () => ({
  db: {
    listing: { findUnique: async () => h.row },
    $executeRaw: async () => 0,
    $queryRaw: async () => [],
  },
}))
vi.mock('./edition-scope', () => ({
  isSellerHiddenHere: async () => h.hidden,
  isServicesDeskListing: async () => h.desk,
}))
vi.mock('./ratelimit', () => ({
  rateLimit: async () => { if (h.quotaThrows) throw new Error('db down'); return { success: h.quotaOk } },
}))

const fetchSpy = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response('{"ok":true}', { status: 200 }))
vi.stubGlobal('fetch', fetchSpy)
vi.stubEnv('TELEGRAM_BOT_TOKEN', 't'); vi.stubEnv('TELEGRAM_CHAT_ID', 'c'); vi.stubEnv('FB_PAGE_ID', 'p'); vi.stubEnv('FB_PAGE_TOKEN', 'k')

const { syndicateListingIfPublic } = await import('./syndicate')
const L = { id: 'l1', title: 'Bike', price: 1000000, currency: 'VND', location: 'HCM', district: null, image: null, categoryName: 'Vehicles' }
// Either channel counts as a post — the gate must stop BOTH.
const posted = () => fetchSpy.mock.calls.some(([u]) => /api\.telegram\.org|graph\.facebook\.com/.test(String(u)))

beforeEach(() => {
  fetchSpy.mockClear()
  h.row = { verified: true, status: 'active', sellerId: 's1' }; h.hidden = false; h.desk = false; h.quotaOk = true; h.quotaThrows = false
})

describe('syndicateListingIfPublic', () => {
  it('posts a public listing of a visible seller — to both channels', async () => {
    await syndicateListingIfPublic(L)
    const urls = fetchSpy.mock.calls.map(([u]) => String(u))
    expect(urls.some((u) => u.includes('api.telegram.org'))).toBe(true)
    expect(urls.some((u) => u.includes('graph.facebook.com'))).toBe(true)
  })

  it('⛔ not a listing moderation held (verified:false) or took off sale', async () => {
    h.row = { verified: false, status: 'active', sellerId: 's1' }
    await syndicateListingIfPublic(L); expect(posted()).toBe(false)
    h.row = { verified: true, status: 'hidden', sellerId: 's1' }
    await syndicateListingIfPublic(L); expect(posted()).toBe(false)
    h.row = null
    await syndicateListingIfPublic(L); expect(posted()).toBe(false)
  })

  it('⛔ not a seller this edition hides, and never the services desk', async () => {
    h.hidden = true
    await syndicateListingIfPublic(L); expect(posted()).toBe(false)
    h.hidden = false; h.desk = true
    await syndicateListingIfPublic(L); expect(posted()).toBe(false)
  })

  it('stops at the daily cap, and fails CLOSED if the limiter errors', async () => {
    h.quotaOk = false
    await syndicateListingIfPublic(L); expect(posted()).toBe(false)
    h.quotaOk = true; h.quotaThrows = true
    await syndicateListingIfPublic(L); expect(posted()).toBe(false)
  })
})
