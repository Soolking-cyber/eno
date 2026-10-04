import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GET /api/conversations/[id] — the `closed` flag (App Store gate `ugc-safety`, follow-up 2 of 0a470ed98).
 *
 * This is the most-polled route in the app, so the pins are about cost as much as content: gate OFF ⇒ the
 * block table is never read and the payload has no `closed` key at all (byte-for-byte what it was); gate
 * ON ⇒ one read, 'you_blocked' for the blocker, 'blocked' for the other side, and never a profile id.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  me: 'buyer-1' as string | null,
  convo: null as Row | null,
  blocks: [] as Row[],
  blockReads: 0,
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
  isAdminEmail: (e: string | null | undefined) => e === 'support@eno.vn',
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }), kv: { set: async () => 'OK' } }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('@/lib/edition-scope', () => ({ isSellerHiddenHere: async () => false }))
vi.mock('@/lib/thread-kind', () => ({ threadKind: async () => 'listing' }))
vi.mock('@/lib/reaction-tally', () => ({ globalTopReactions: async () => [] }))
vi.mock('@/lib/native-push', () => ({ syncBadgeToProfile: async () => {} }))
vi.mock('@/lib/messages', () => ({ MESSAGE_ROW_SELECT: {}, serializeMessage: (m: Row) => m }))
vi.mock('@/lib/storefront-gone', () => ({ isPublicListing: () => true, isStorefrontGone: async () => false }))
vi.mock('@/lib/db', () => ({
  db: {
    conversation: { findUnique: async () => h.convo, update: async () => ({}) },
    seller: { findUnique: async () => null },
    review: { findUnique: async () => null },
    profile: { findUnique: async ({ where }: { where: { id: string } }) => ({ email: where.id === 'staff-1' ? 'support@eno.vn' : `${where.id}@example.com` }) },
    forumUserBlock: {
      findMany: async ({ where }: { where: { OR: Row[] } }) => {
        h.blockReads += 1
        return h.blocks.filter((b) => where.OR.some((c) => c.blockerProfileId === b.blockerProfileId && c.blockedProfileId === b.blockedProfileId))
      },
    },
  },
}))

const { GET } = await import('./route')

function thread(over: Row = {}): Row {
  return {
    id: 'thread-1', buyerProfileId: 'buyer-1', sellerProfileId: 'seller-1', buyerUnread: 0, sellerUnread: 0,
    visaApplicationId: null,
    listing: { id: 'L1', title: 'Honda Wave', images: '[]', price: 1, currency: '₫', priceUnit: 'VND', negotiable: true, availabilityConfirmedAt: null, status: 'active', listingType: 'sell', verified: true, teacherProfile: null },
    teacherContactShare: null,
    seller: { id: 'shop-1', ownerId: 'seller-1', name: 'Shop', avatarColor: '#111111', avatarUrl: null, trustScore: 100, trustTier: 'standard', memberSince: new Date('2024-01-01'), reviewCount: 2, officialPartner: false, owner: { lastSeenAt: null, locale: 'vi' } },
    buyer: { displayName: 'Anna', email: 'anna@example.com', avatarColor: '#222222', avatarUrl: null, lastSeenAt: null, locale: 'en' },
    messages: [],
    ...over,
  }
}
const get = async () => {
  const res = await GET(new Request('http://localhost/api/conversations/thread-1?peek=1'), { params: Promise.resolve({ id: 'thread-1' }) })
  return { status: res.status, body: (await res.json()) as Row }
}

beforeEach(() => {
  h.me = 'buyer-1'
  h.convo = thread()
  h.blocks = []
  h.blockReads = 0
})
afterEach(() => vi.unstubAllEnvs())

describe('the closed flag', () => {
  it('gate OFF: a stored block is never read and the payload carries no `closed` key', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    h.blocks = [{ blockerProfileId: 'seller-1', blockedProfileId: 'buyer-1' }]
    const { status, body } = await get()
    expect(status).toBe(200)
    expect('closed' in body).toBe(false)
    expect(h.blockReads).toBe(0)
  })

  it('gate ON, no block: one read, still no `closed` key', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    const { body } = await get()
    expect('closed' in body).toBe(false)
    expect(h.blockReads).toBe(1)
  })

  it('gate ON: the blocked side sees "blocked", the blocker sees "you_blocked" — and no profile id rides along', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.blocks = [{ blockerProfileId: 'seller-1', blockedProfileId: 'buyer-1' }]
    const asBuyer = await get()
    expect(asBuyer.body.closed).toBe('blocked')
    h.me = 'seller-1'
    const asSeller = await get()
    expect(asSeller.body.closed).toBe('you_blocked')
    // The other party's profile id appears nowhere — `me` is the caller's own id only.
    expect(JSON.stringify(asSeller.body)).not.toContain('buyer-1')
    expect(JSON.stringify(asBuyer.body)).not.toContain('seller-1')
    expect(asSeller.body.me).toBe('seller-1')
  })

  it('gate ON: a block with the eno team on either side is void (a desk thread never closes)', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.convo = thread({ sellerProfileId: 'staff-1', seller: { ...thread().seller, ownerId: 'staff-1' } })
    h.blocks = [{ blockerProfileId: 'buyer-1', blockedProfileId: 'staff-1' }]
    const { body } = await get()
    expect('closed' in body).toBe(false)
  })
})
