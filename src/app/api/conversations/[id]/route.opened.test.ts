import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GET /api/conversations/[id] — the one-time OPEN (si-04) and the read receipt (inbox-07).
 *
 *   · `?opened=1` marks every unread bell notification for THIS thread read, keyed by conversationId and
 *     NOT by type (the rental desk writes a variable type), scoped to the caller's own rows.
 *   · It is not tied to the unread counter: a stale offer notification on a thread with myUnread 0 clears.
 *   · A read that is already clearing unread messages clears the bell too (an offer that arrived while the
 *     thread was open).
 *   · The 15s poll with nothing unread, and a prefetch (`peek=1`, even with the flag), never write.
 *   · A failing clear never breaks the thread.
 *   · `counterpartSeen` is the other side's unread counter at zero.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  me: 'buyer-1' as string | null,
  convo: null as Row | null,
  notifCalls: [] as Row[],
  notifCount: 2,
  notifThrows: false,
  convoUpdates: 0,
  badgeSyncs: 0,
  // Something AFTER the bell clear's old position throws while the response is being built.
  reactionsThrow: false,
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
vi.mock('@/lib/reaction-tally', () => ({ globalTopReactions: async () => { if (h.reactionsThrow) throw new Error('tally down'); return [] } }))
vi.mock('@/lib/native-push', () => ({ syncBadgeToProfile: async () => { h.badgeSyncs += 1 } }))
vi.mock('@/lib/messages', () => ({ MESSAGE_ROW_SELECT: {}, serializeMessage: (m: Row) => m }))
vi.mock('@/lib/storefront-gone', () => ({ isPublicListing: () => true, isStorefrontGone: async () => false }))
vi.mock('@/lib/db', () => ({
  db: {
    conversation: { findUnique: async () => h.convo, update: async () => { h.convoUpdates += 1; return {} } },
    seller: { findUnique: async () => null },
    review: { findUnique: async () => null },
    notification: {
      updateMany: async (args: Row) => {
        h.notifCalls.push(args)
        if (h.notifThrows) throw new Error('db down')
        return { count: h.notifCount }
      },
    },
  },
}))

const { GET } = await import('./route')

function thread(over: Row = {}): Row {
  return {
    id: 'thread-1', buyerProfileId: 'buyer-1', sellerProfileId: 'seller-1', buyerUnread: 0, sellerUnread: 0,
    visaApplicationId: null,
    listing: { id: 'L1', title: 'Road bike', images: '["https://x/1.webp"]', price: 3_000_000, currency: '₫', priceUnit: 'VND', negotiable: true, availabilityConfirmedAt: null, status: 'active', listingType: 'sell', verified: true, subcategorySlug: 'bicycle', category: { slug: 'vehicles' }, teacherProfile: null },
    teacherContactShare: null,
    seller: { id: 'shop-1', ownerId: 'seller-1', name: 'Shop', avatarColor: '#111', avatarUrl: null, trustScore: 80, trustTier: 'standard', memberSince: new Date('2024-01-01'), reviewCount: 2, officialPartner: false, owner: { lastSeenAt: null, locale: 'vi' } },
    buyer: { displayName: 'An', email: 'an@example.com', avatarColor: '#222', avatarUrl: null, lastSeenAt: null, locale: 'vi' },
    messages: [],
    ...over,
  }
}
const get = async (qs = '') => {
  const res = await GET(new Request(`http://localhost/api/conversations/thread-1${qs}`), { params: Promise.resolve({ id: 'thread-1' }) })
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  h.me = 'buyer-1'
  h.convo = thread()
  h.notifCalls = []
  h.notifCount = 2
  h.notifThrows = false
  h.convoUpdates = 0
  h.badgeSyncs = 0
  h.reactionsThrow = false
})

describe('?opened=1 clears this thread\'s bell — and only the caller\'s rows', () => {
  it('marks unread notifications for this conversation read, with no type list', async () => {
    const { status, body } = await get('?opened=1')
    expect(status).toBe(200)
    expect(h.notifCalls).toHaveLength(1)
    expect(h.notifCalls[0]).toEqual({ where: { recipientId: 'buyer-1', conversationId: 'thread-1', read: false, createdAt: { lte: new Date(body.seenAsOf) } }, data: { read: true } })
    expect(h.notifCalls[0].where).not.toHaveProperty('type')
    expect(body.notificationsCleared).toBe(2)
    // The app-icon badge dropped, so it is re-synced once.
    expect(h.badgeSyncs).toBe(1)
  })

  it('⛔ clears only rows that existed when the read began: createdAt <= seenAsOf (taken before the thread was read)', async () => {
    const before = Date.now()
    const { body } = await get('?opened=1')
    const bound = (h.notifCalls[0].where as { createdAt: { lte: Date } }).createdAt.lte
    expect(bound).toBeInstanceOf(Date)
    expect(bound.toISOString()).toBe(body.seenAsOf)
    expect(bound.getTime()).toBeGreaterThanOrEqual(before - 1)
    expect(bound.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('is NOT gated on the unread counter: myUnread 0 still clears a stale offer notification', async () => {
    h.convo = thread({ buyerUnread: 0 })
    await get('?opened=1')
    expect(h.notifCalls).toHaveLength(1)
    expect(h.convoUpdates).toBe(0)
  })

  it('nothing to clear → no badge sync', async () => {
    h.notifCount = 0
    const { body } = await get('?opened=1')
    expect(body.notificationsCleared).toBe(0)
    expect(h.badgeSyncs).toBe(0)
  })

  it('⛔ a stranger\'s `?opened=1` is a 403 that writes NOTHING — no bell rows, no unread counter, no badge sync', async () => {
    h.me = 'stranger-9'
    h.convo = thread({ buyerUnread: 2, sellerUnread: 3 })
    const { status } = await get('?opened=1')
    expect(status).toBe(403)
    expect(h.notifCalls).toHaveLength(0)
    expect(h.convoUpdates).toBe(0)
    expect(h.badgeSyncs).toBe(0)
  })

  it('fails soft: a broken clear never 500s the thread — and says so (openCleared false), so the page asks again', async () => {
    h.notifThrows = true
    const { status, body } = await get('?opened=1')
    expect(status).toBe(200)
    expect(body.notificationsCleared).toBe(0)
    expect(body.openCleared).toBe(false)
  })

  it('openCleared is the server\'s word that THIS open cleared — true on a clean open, false on a plain read', async () => {
    expect((await get('?opened=1')).body.openCleared).toBe(true)
    h.convo = thread({ buyerUnread: 1 })
    // A read that clears the bell alongside an unread write is not an open.
    expect((await get()).body.openCleared).toBe(false)
  })

  it('⛔ the clear runs LAST: if building the response throws, the person keeps the notification', async () => {
    h.reactionsThrow = true
    const { status } = await get('?opened=1')
    expect(status).toBeGreaterThanOrEqual(500)
    expect(h.notifCalls).toHaveLength(0)
  })
})

describe('polling stays write-free', () => {
  it('the poll (no flag) with nothing unread never touches notifications', async () => {
    const { body } = await get()
    expect(h.notifCalls).toHaveLength(0)
    expect(h.convoUpdates).toBe(0)
    expect(body.notificationsCleared).toBe(0)
    expect(h.badgeSyncs).toBe(0)
  })

  it('a prefetch is never an open, even if it carries the flag', async () => {
    await get('?peek=1&opened=1')
    expect(h.notifCalls).toHaveLength(0)
  })

  it('a prefetch writes nothing even with messages unread', async () => {
    h.convo = thread({ buyerUnread: 2 })
    await get('?peek=1')
    expect(h.notifCalls).toHaveLength(0)
    expect(h.convoUpdates).toBe(0)
  })
})

describe('an offer that arrives while the thread is open', () => {
  it('the refetch that clears the unread counter clears its bell row too — one badge sync for both', async () => {
    h.convo = thread({ buyerUnread: 1 })
    const { body } = await get()
    expect(h.convoUpdates).toBe(1)
    expect(h.notifCalls).toEqual([{ where: { recipientId: 'buyer-1', conversationId: 'thread-1', read: false, createdAt: { lte: new Date(body.seenAsOf) } }, data: { read: true } }])
    expect(body.notificationsCleared).toBe(2)
    expect(h.badgeSyncs).toBe(1)
  })

  it('the open with messages unread still clears once, not twice', async () => {
    h.convo = thread({ buyerUnread: 3 })
    await get('?opened=1')
    expect(h.notifCalls).toHaveLength(1)
    expect(h.convoUpdates).toBe(1)
    expect(h.badgeSyncs).toBe(1)
  })
})

describe('counterpartSeen — the other side\'s unread counter at zero', () => {
  it('rides with seenAsOf: the server instant it vouches for, taken before the read', async () => {
    const t0 = Date.now()
    const { body } = await get()
    expect(typeof body.seenAsOf).toBe('string')
    const asOf = Date.parse(body.seenAsOf)
    expect(asOf).toBeGreaterThanOrEqual(t0 - 1)
    expect(asOf).toBeLessThanOrEqual(Date.now())
  })

  it('buyer viewing: seen when the SELLER has nothing unread', async () => {
    h.convo = thread({ sellerUnread: 0, buyerUnread: 3 })
    expect((await get()).body.counterpartSeen).toBe(true)
    h.convo = thread({ sellerUnread: 1 })
    expect((await get()).body.counterpartSeen).toBe(false)
  })

  it('seller viewing: seen when the BUYER has nothing unread', async () => {
    h.me = 'seller-1'
    h.convo = thread({ buyerUnread: 2, sellerUnread: 0 })
    expect((await get()).body.counterpartSeen).toBe(false)
  })
})

describe('the listing carries the opener facts', () => {
  it('categorySlug and subcategorySlug ride on the listing', async () => {
    const { body } = await get()
    expect(body.listing.categorySlug).toBe('vehicles')
    expect(body.listing.subcategorySlug).toBe('bicycle')
  })
})
