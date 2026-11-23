import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GET /api/conversations/[id] — `buyUrl`, the "Buy now" button's link (src/lib/partner-buy.ts, owner 2026-11-23). The thread's two
 * people only, an open listing thread with an eno-run partner only; every other thread pays no read and carries no key.
 * (Harness copied from route.closed.test.ts.)
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  me: 'buyer-1' as string | null,
  convo: null as Row | null,
  blocks: [] as Row[],
  blockReads: 0,
  // writerVerified (src/lib/teachers/writer-verified.ts): whose verification each read was for.
  tierReads: [] as string[],
  // The teacher's "Identity verified" (the REAL src/lib/teachers/identity-mark.ts): each identity read's arguments.
  markReads: [] as Array<Record<string, unknown>>,
  enoRun: true,
  buyUrl: 'https://go.isclix.com/deep_link/1/2' as string | null | Error,
  buyReads: [] as unknown[],
}))
vi.mock('@/lib/eno-run-partners', () => ({ isEnoRunPartner: () => h.enoRun }))
vi.mock('@/lib/partner-buy', () => ({
  partnerBuyUrl: async (id: unknown) => { h.buyReads.push(id); if (h.buyUrl instanceof Error) throw h.buyUrl; return h.buyUrl },
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
vi.mock('@/lib/edition-scope', () => ({ HIDDEN_DESK_OWNER_EMAILS: [], isSellerHiddenHere: async () => false }))
vi.mock('@/lib/thread-kind', () => ({ threadKind: async () => 'listing' }))
vi.mock('@/lib/reaction-tally', () => ({ globalTopReactions: async () => [] }))
vi.mock('@/lib/native-push', () => ({ syncBadgeToProfile: async () => {} }))
vi.mock('@/lib/messages', () => ({ MESSAGE_ROW_SELECT: {}, serializeMessage: (m: Row) => m }))
vi.mock('@/lib/storefront-gone', () => ({ isPublicListing: () => true, isStorefrontGone: async () => false }))
// The teacher's "Identity verified" — what the SCHOOL's side shows as `teacherIdentityVerified` — is the REAL predicate,
// over the identity table faked below: a live verification whose name is the teacher's, so it shows whenever it is asked.
// The writer's public verification — what the TEACHER's side shows as `writerVerified`.
vi.mock('@/lib/teachers/writer-verified', () => ({
  writerVerified: async (profileId: string) => {
    h.tierReads.push(profileId)
    return 'identity'
  },
}))
vi.mock('@/lib/db', () => ({
  db: {
    conversation: { findUnique: async () => h.convo, update: async () => ({}) },
    identityVerification: {
      findMany: async (args: Row) => {
        h.markReads.push(args)
        return [{
          id: 'iv-1', profileId: 'seller-1', tier: 'B', method: 'passport_mrz', status: 'verified', decidedAt: new Date('2026-09-01T00:00:00+07:00'),
          documentExpiresAt: new Date('2030-01-01T00:00:00+07:00'), assuranceLevel: 'manual_review',
          evidence: { decisionInput: { surname: 'ERIKSSON', givenNames: 'ANNA' } },
        }]
      },
    },
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
const { IDENTITY_MARK_NOTICE_VERSION } = await import('@/lib/teachers/constants')

function thread(over: Row = {}): Row {
  return {
    id: 'thread-1', buyerProfileId: 'buyer-1', sellerProfileId: 'seller-1', buyerUnread: 0, sellerUnread: 0,
    visaApplicationId: null,
    listing: { id: 'L1', title: 'Honda Wave', images: '[]', price: 1, currency: '₫', priceUnit: 'VND', negotiable: true, availabilityConfirmedAt: null, status: 'active', listingType: 'sell', verified: true, teacherProfile: null },
    teacherContactShare: null,
    teacherVideoShare: null,
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
  h.tierReads = []
  h.markReads = []
  h.enoRun = true
  h.buyUrl = 'https://go.isclix.com/deep_link/1/2'
  h.buyReads = []
})
afterEach(() => vi.unstubAllEnvs())

describe('buyUrl', () => {
  it('the customer and the shop of an eno-run partner\'s listing thread get the link, read for THIS listing', async () => {
    expect((await get()).body.buyUrl).toBe('https://go.isclix.com/deep_link/1/2')
    h.me = 'seller-1'
    expect((await get()).body.buyUrl).toBe('https://go.isclix.com/deep_link/1/2')
    expect(h.buyReads).toEqual(['L1', 'L1'])
  })

  it('any other storefront: no read, no key (the most-polled route)', async () => {
    h.enoRun = false
    const { body } = await get()
    expect('buyUrl' in body).toBe(false)
    expect(h.buyReads).toEqual([])
  })

  it('no live link (sold, hidden, none) → no key; a failed read → no key, never an error', async () => {
    h.buyUrl = null
    expect('buyUrl' in (await get()).body).toBe(false)
    h.buyUrl = new Error('db down')
    const r = await get()
    expect(r.status).toBe(200)
    expect('buyUrl' in r.body).toBe(false)
  })

  it('a thread closed by a block → no link', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.blocks = [{ blockerProfileId: 'seller-1', blockedProfileId: 'buyer-1' }]
    expect('buyUrl' in (await get()).body).toBe(false)
    expect(h.buyReads).toEqual([])
  })

  it('someone who is neither side never gets it (403)', async () => {
    h.me = 'stranger'
    expect((await get()).status).toBe(403)
    expect(h.buyReads).toEqual([])
  })
})
