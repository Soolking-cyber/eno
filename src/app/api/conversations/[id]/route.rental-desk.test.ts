import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GET /api/conversations/[id] on a RENTAL-DESK thread — the counterpart carries no storefront and no
 * trust, on either side.
 *
 * Why it matters, concretely: the desk Seller row is created lazily, so its `memberSince` is recent
 * and its `reviewCount` is 0 — the header would call eno's own team a "New user", link to an empty
 * storefront, and the buyer-side review prompt (which needs a counterpart seller id) could fire on a
 * free availability check. And the operator's counterpart is a person asking for help, whose own
 * shop has nothing to do with the request.
 *
 * The ordinary buyer↔seller thread is pinned alongside, so the exemption cannot quietly widen.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  me: 'asker-1' as string | null,
  convo: null as Row | null,
  buyerStorefront: null as Row | null,
  storefrontLookups: 0,
}))

vi.mock('next/server', async (orig) => {
  const actual = await orig<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => { void fn() } }
})
vi.mock('@/lib/edition', () => ({ IS_SERVICES: false, IS_MARKETPLACE: true }))
vi.mock('@/lib/admin', () => ({
  getCurrentProfileId: async () => h.me,
  getCurrentProfile: async () => (h.me ? { id: h.me } : null),
  getAdmin: async () => null,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('@/lib/edition-scope', () => ({ isSellerHiddenHere: async () => false }))
vi.mock('@/lib/thread-kind', () => ({ threadKind: async () => 'listing' }))
vi.mock('@/lib/reaction-tally', () => ({ globalTopReactions: async () => [] }))
vi.mock('@/lib/native-push', () => ({ syncBadgeToProfile: async () => {} }))
vi.mock('@/lib/messages', () => ({ MESSAGE_ROW_SELECT: {}, serializeMessage: (m: Row) => m }))
vi.mock('@/lib/db', () => ({
  db: {
    conversation: { findUnique: async () => h.convo, update: async () => ({}) },
    seller: { findUnique: async () => { h.storefrontLookups += 1; return h.buyerStorefront } },
    review: { findUnique: async () => null },
  },
}))

const { GET } = await import('./route')

const NEW = new Date()
function thread(over: Row = {}): Row {
  return {
    id: 'thread-1', buyerProfileId: 'asker-1', sellerProfileId: 'op-1', buyerUnread: 0, sellerUnread: 0,
    visaApplicationId: null, listing: null,
    seller: { id: 'eno-rental-desk', name: 'eno team', avatarColor: '#dc2626', avatarUrl: null, trustScore: 100, trustTier: 'standard', memberSince: NEW, reviewCount: 0, officialPartner: false, owner: null },
    buyer: { displayName: 'Anna', email: 'anna@example.com', avatarColor: '#111111', avatarUrl: null, lastSeenAt: null, locale: 'en' },
    messages: [],
    ...over,
  }
}
const get = async () => {
  const res = await GET(new Request('http://localhost/api/conversations/thread-1'), { params: Promise.resolve({ id: 'thread-1' }) })
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  h.me = 'asker-1'
  h.convo = thread()
  h.buyerStorefront = { id: 'annas-shop', trustScore: 90, trustTier: 'trusted', memberSince: new Date('2024-01-01'), reviewCount: 3 }
  h.storefrontLookups = 0
})

describe('a rental-desk thread', () => {
  it('the REQUESTER sees "eno team" with no storefront link and no trust chip', async () => {
    const { status, body } = await get()
    expect(status).toBe(200)
    expect(body.counterpart.name).toBe('eno team')
    expect(body.counterpart.sellerId).toBeNull()
    expect(body.counterpart.trust).toBeNull()
    expect(body.listing).toBeNull()
    expect(body.kind).toBeNull()
  })

  it("the OPERATOR sees the requester, without the requester's shop or trust — and does not look it up", async () => {
    h.me = 'op-1'
    const { body } = await get()
    expect(body.counterpart.name).toBe('Anna')
    expect(body.counterpart.sellerId).toBeNull()
    expect(body.counterpart.trust).toBeNull()
    expect(body.iAmSeller).toBe(true)
    expect(h.storefrontLookups).toBe(0)
  })

  it('works for the forum desk id too', async () => {
    h.convo = thread({ seller: { ...thread().seller, id: 'eno-rental-desk-forum' } })
    const { body } = await get()
    expect(body.counterpart.sellerId).toBeNull()
    expect(body.counterpart.trust).toBeNull()
  })
})

describe('an ordinary thread is untouched', () => {
  it('still links the seller and carries trust for the buyer', async () => {
    h.convo = thread({
      listing: { id: 'L1', title: 'Studio', images: '[]', price: 1, currency: '₫', priceUnit: 'VND/month', negotiable: true, availabilityConfirmedAt: null, status: 'active' },
      seller: { ...thread().seller, id: 'some-shop', name: 'Some Shop' },
    })
    const { body } = await get()
    expect(body.counterpart.sellerId).toBe('some-shop')
    expect(body.counterpart.trust).not.toBeNull()
  })

  // The SELLER ID is the discriminator, not the missing listing: every listing-less thread today is
  // a desk thread (support or rental), so this pins that only the rental desk ids trip the exemption.
  it('the exemption keys on the rental-desk seller id, not on the missing listing', async () => {
    h.convo = thread({ seller: { ...thread().seller, id: 'some-shop', name: 'Some Shop' } })
    const { body } = await get()
    expect(body.counterpart.sellerId).toBe('some-shop')
  })

  it('the seller side still sees the buyer’s own storefront', async () => {
    h.me = 'op-1'
    h.convo = thread({
      listing: { id: 'L1', title: 'Studio', images: '[]', price: 1, currency: '₫', priceUnit: 'VND/month', negotiable: true, availabilityConfirmedAt: null, status: 'active' },
      seller: { ...thread().seller, id: 'some-shop' },
    })
    const { body } = await get()
    expect(body.counterpart.sellerId).toBe('annas-shop')
    expect(body.counterpart.trust).toMatchObject({ trustTier: 'trusted' })
  })
})
