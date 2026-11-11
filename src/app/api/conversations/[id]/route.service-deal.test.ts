import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GET /api/conversations/[id] — THE SERVICE-DEAL KEYS (src/lib/service-deal.ts, spec v2 §6–7). The seller side of a
 * rental / lesson / service thread gets `deal`; the buyer side gets `mayReviewService` + `dealKind`. Every other payload
 * carries none of them and never reads the deal table — this is the most-polled route in the app — and a missing table
 * (before scripts/deal-confirmation-ddl.mjs) or any failed read is "no deal", never a 500.
 */

type Row = Record<string, any>
const MIN = 60_000

const h = vi.hoisted(() => ({

  me: 'seller-1' as string | null,
  convo: null as Row | null,
  kind: 'listing' as string,
  deal: null as Row | null,
  dealReads: 0,
  dealFails: null as null | Error,
  review: null as Row | null,
  reviewReads: 0,
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
  isAdminEmail: () => false,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }), kv: { set: async () => 'OK' } }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('@/lib/edition-scope', () => ({ isSellerHiddenHere: async () => false, HIDDEN_DESK_OWNER_EMAILS: ['support@eno.forum'] }))
vi.mock('@/lib/thread-kind', () => ({ threadKind: async () => h.kind }))
vi.mock('@/lib/reaction-tally', () => ({ globalTopReactions: async () => [] }))
vi.mock('@/lib/native-push', () => ({ syncBadgeToProfile: async () => {} }))
vi.mock('@/lib/messages', () => ({ MESSAGE_ROW_SELECT: {}, serializeMessage: (m: Row) => ({ id: m.id, body: m.body }) }))
vi.mock('@/lib/storefront-gone', () => ({ isPublicListing: () => true, isStorefrontGone: async () => false }))
vi.mock('@/lib/teachers/writer-verified', () => ({ writerVerified: async () => 'identity' }))
vi.mock('@/lib/teachers/identity-mark', () => ({ IDENTITY_MARK_TP_SELECT: {}, identityMarkShownOnCard: async () => false }))
vi.mock('@/lib/db', () => ({
  db: {
    conversation: { findUnique: async () => h.convo, update: async () => ({}) },
    seller: { findUnique: async () => null },
    review: { findUnique: async () => { h.reviewReads++; return h.review } },
    dealConfirmation: {
      findUnique: async () => {
        h.dealReads++
        if (h.dealFails) throw h.dealFails
        return h.deal
      },
    },
    forumUserBlock: { findMany: async () => [] },
  },
}))

const { GET } = await import('./route')
const { RENTAL_DESK_SELLER_IDS } = await import('@/lib/rental-check/desk-ids')

function thread(over: Row = {}): Row {
  return {
    id: 'thread-1', buyerProfileId: 'buyer-1', sellerProfileId: 'seller-1', buyerUnread: 0, sellerUnread: 0, visaApplicationId: null,
    listing: {
      id: 'L1', title: 'Studio in D3', images: '[]', price: 9_000_000, currency: '₫', priceUnit: 'month', negotiable: true, availabilityConfirmedAt: null,
      status: 'active', complianceStatus: null, listingType: 'rent', verified: true, subcategorySlug: null, identityMarkNotice: null, category: { slug: 'rentals' }, teacherProfile: null,
    },
    teacherContactShare: null,
    teacherVideoShare: null,
    seller: { id: 'shop-1', ownerId: 'seller-1', name: 'Landlord', avatarColor: '#111111', avatarUrl: null, trustScore: 60, trustTier: 'standard', memberSince: new Date('2024-01-01'), reviewCount: 0, officialPartner: false, owner: { lastSeenAt: null, locale: 'vi' } },
    buyer: { displayName: 'Anna', email: 'anna@example.com', avatarColor: '#222222', avatarUrl: null, lastSeenAt: null, locale: 'en' },
    messages: [],
    ...over,
  }
}
const confirmedAgo = (ms: number, over: Row = {}): Row => ({
  listingId: 'L1', sellerId: 'shop-1', sellerProfileId: 'seller-1', buyerProfileId: 'buyer-1', kind: 'rental',
  confirmedAt: new Date(Date.now() - ms), revokedAt: null, declinedAt: null, confirmCount: 1, reviewId: null, ...over,
})
const get = async (as: string) => {
  h.me = as
  const res = await GET(new Request('http://localhost/api/conversations/thread-1?peek=1'), { params: Promise.resolve({ id: 'thread-1' }) })
  return { status: res.status, body: (await res.json()) as Row }
}
const DEAL_KEYS = ['deal', 'mayReviewService', 'dealKind']

beforeEach(() => {
  h.convo = thread(); h.kind = 'listing'; h.deal = null; h.dealReads = 0; h.dealFails = null; h.review = null; h.reviewReads = 0
})

describe('the seller side of an in-scope thread: `deal`', () => {
  it('nothing confirmed yet: state none, two confirms left — and no buyer keys', async () => {
    const { body } = await get('seller-1')
    expect(body.deal).toEqual({ kind: 'rental', state: 'none', confirmsLeft: 2 })
    expect(body).not.toHaveProperty('mayReviewService')
    expect(body).not.toHaveProperty('dealKind')
  })

  it('confirmed 3 minutes ago: the undo is open (withdrawUntil) — even though the buyer has written since (A2: the window alone)', async () => {
    h.deal = confirmedAgo(3 * MIN)
    h.convo = thread({ messages: [{ id: 'm2', senderProfileId: 'buyer-1', createdAt: new Date(Date.now() - MIN), body: 'thanks!' }] })
    const { body } = await get('seller-1')
    expect(body.deal).toMatchObject({ kind: 'rental', state: 'confirmed', confirmsLeft: 1 })
    expect(Date.parse(body.deal.withdrawUntil)).toBeGreaterThan(Date.now())
  })

  it('…10 minutes passed: no undo', async () => {
    h.deal = confirmedAgo(11 * MIN)
    expect((await get('seller-1')).body.deal).toEqual({ kind: 'rental', state: 'confirmed', confirmsLeft: 1 })
  })

  it('reviewed — by the deal, or an offer-path review of the thread — and declined', async () => {
    h.deal = confirmedAgo(MIN, { reviewId: 'r1' })
    expect((await get('seller-1')).body.deal.state).toBe('reviewed')
    h.deal = null; h.review = { id: 'r9' }
    expect((await get('seller-1')).body.deal.state).toBe('reviewed')
    h.review = null; h.deal = confirmedAgo(MIN, { declinedAt: new Date() })
    // A3: a declined deal has no confirm left — it is never confirmed again (and A8: the page shows only the line)
    expect((await get('seller-1')).body.deal).toEqual({ kind: 'rental', state: 'declined', confirmsLeft: 0 })
  })

  it('a teacher thread is a lesson', async () => {
    h.convo = thread({ listing: { ...thread().listing, listingType: 'teacher', category: { slug: 'teachers' }, teacherProfile: { status: 'live', videoOnRequest: false, private: null } } })
    expect((await get('seller-1')).body.deal).toEqual({ kind: 'lesson', state: 'none', confirmsLeft: 2 })
  })
})

describe('the buyer side of an in-scope thread: `mayReviewService` + `dealKind`', () => {
  it('confirmed 11 minutes ago (the undo closed): the card may open', async () => {
    h.deal = confirmedAgo(11 * MIN)
    const { body } = await get('buyer-1')
    expect(body.mayReviewService).toBe(true)
    expect(body.dealKind).toBe('rental')
    expect(body).not.toHaveProperty('deal')
  })

  it('⛔ A2: NOT while the seller can still undo — confirmed 1 or 9 minutes ago: false (the kind still says what is coming)', async () => {
    for (const ago of [MIN, 9 * MIN]) {
      h.deal = confirmedAgo(ago)
      const { body } = await get('buyer-1')
      expect(body.mayReviewService).toBe(false)
      expect(body.dealKind).toBe('rental')
    }
  })

  it('⛔ A2: the seller\'s undo and the buyer\'s card are NEVER both open on the same read', async () => {
    for (const ago of [MIN, 9 * MIN, 9.9 * MIN, 10.1 * MIN, 11 * MIN, 29 * 24 * 60 * MIN]) {
      h.deal = confirmedAgo(ago)
      const undo = 'withdrawUntil' in (await get('seller-1')).body.deal
      const card = (await get('buyer-1')).body.mayReviewService === true
      expect([ago, undo && card]).toEqual([ago, false])
      expect([ago, undo || card]).toEqual([ago, true])
    }
  })

  it('⛔ withdrawn, declined, already reviewed, or no deal: false', async () => {
    for (const d of [confirmedAgo(11 * MIN, { confirmedAt: null, revokedAt: new Date() }), confirmedAgo(11 * MIN, { declinedAt: new Date() }), confirmedAgo(11 * MIN, { reviewId: 'r1' }), null]) {
      h.deal = d
      expect((await get('buyer-1')).body.mayReviewService).toBe(false)
    }
    h.deal = confirmedAgo(11 * MIN); h.review = { id: 'r1' }
    expect((await get('buyer-1')).body.mayReviewService).toBe(false)
  })
})

const goods = () => thread({ listing: { ...thread().listing, listingType: 'sell', category: { slug: 'electronics' } } })
const OUT_OF_SCOPE_LISTINGS: [string, () => void][] = [
  ['a goods thread', () => { h.convo = goods() }],
  ['a job thread', () => { h.convo = thread({ listing: { ...thread().listing, listingType: 'job', category: { slug: 'jobs' } } }) }],
  ['a wanted post', () => { h.convo = thread({ listing: { ...thread().listing, listingType: 'wanted' } }) }],
  ['a taken-down listing', () => { h.convo = thread({ listing: { ...thread().listing, complianceStatus: 'taken_down' } }) }],
]

describe('⛔ every other thread with no deal: no keys (byte-identical)', () => {
  it.each(OUT_OF_SCOPE_LISTINGS)('%s: no keys on either side; both sides read the row (the row decides once it exists)', async (_what, set) => {
    set()
    const seller = await get('seller-1')
    expect(seller.status).toBe(200)
    for (const k of DEAL_KEYS) expect(seller.body).not.toHaveProperty(k)
    expect(h.dealReads).toBe(1)
    const buyer = await get('buyer-1')
    expect(buyer.status).toBe(200)
    for (const k of DEAL_KEYS) expect(buyer.body).not.toHaveProperty(k)
    expect(h.dealReads).toBe(2)
  })

  it.each([
    ['a visa desk thread', () => { h.kind = 'visa' }],
    ['an itinerary desk thread', () => { h.kind = 'itinerary' }],
    ['a rental-desk thread', () => { h.convo = thread({ listing: null, seller: { ...thread().seller, id: RENTAL_DESK_SELLER_IDS[0] } }) }],
    ['a support thread (no listing)', () => { h.convo = thread({ listing: null }) }],
  ])('%s: no keys, and the deal table is never read — not even with a row there', async (_what, set) => {
    set()
    h.deal = confirmedAgo(11 * MIN)
    for (const as of ['seller-1', 'buyer-1']) {
      const { status, body } = await get(as)
      expect(status).toBe(200)
      for (const k of DEAL_KEYS) expect(body).not.toHaveProperty(k)
    }
    expect(h.dealReads).toBe(0)
  })

  it('an out-of-scope thread the buyer already reviewed: nothing could open — no read, no keys', async () => {
    h.convo = goods(); h.review = { id: 'r1' }
    const { body } = await get('buyer-1')
    for (const k of DEAL_KEYS) expect(body).not.toHaveProperty(k)
    expect(h.dealReads).toBe(0)
  })

  it('the seller side of an out-of-scope thread pays no extra Review read either', async () => {
    h.convo = goods()
    await get('seller-1')
    expect(h.reviewReads).toBe(0)
  })
})

describe('⛔ THE ROW DECIDES — the seller switched the listing after confirming', () => {
  it.each([
    ['wanted', { listingType: 'wanted' }],
    ['sell (goods)', { listingType: 'sell', category: { slug: 'electronics' } }],
    ['job', { listingType: 'job', category: { slug: 'jobs' } }],
  ])('switched to %s: the buyer\'s card still opens, worded by the ROW\'s kind', async (_what, over) => {
    h.deal = confirmedAgo(11 * MIN)
    h.convo = thread({ listing: { ...thread().listing, ...over } })
    const { body } = await get('buyer-1')
    expect(body.mayReviewService).toBe(true)
    expect(body.dealKind).toBe('rental')
  })

  it('…and a lesson confirmed on a teacher profile stays a lesson whatever the listing says now', async () => {
    h.deal = confirmedAgo(11 * MIN, { kind: 'lesson' })
    h.convo = goods()
    expect((await get('buyer-1')).body).toMatchObject({ mayReviewService: true, dealKind: 'lesson' })
  })

  it('⛔ still not before the undo closed, nor once withdrawn / declined / reviewed', async () => {
    h.convo = goods()
    for (const d of [confirmedAgo(MIN), confirmedAgo(11 * MIN, { confirmedAt: null, revokedAt: new Date() }), confirmedAgo(11 * MIN, { declinedAt: new Date() }), confirmedAgo(11 * MIN, { reviewId: 'r1' })]) {
      h.deal = d
      expect((await get('buyer-1')).body).toMatchObject({ mayReviewService: false, dealKind: 'rental' })
    }
  })

  it('⛔ a takedown of the deal\'s listing (moderation) still closes the card', async () => {
    h.deal = confirmedAgo(11 * MIN)
    h.convo = thread({ listing: { ...thread().listing, listingType: 'wanted', complianceStatus: 'taken_down' } })
    expect((await get('buyer-1')).body).toMatchObject({ mayReviewService: false, dealKind: 'rental' })
    h.convo = thread({ listing: { ...thread().listing, complianceStatus: 'taken_down' } })
    expect((await get('buyer-1')).body).toMatchObject({ mayReviewService: false, dealKind: 'rental' })
  })

  it('⛔ identity still first: a row naming another buyer or another storefront opens nothing', async () => {
    h.convo = goods()
    h.deal = confirmedAgo(11 * MIN, { buyerProfileId: 'someone-else' })
    expect((await get('buyer-1')).body.mayReviewService).toBe(false)
    h.deal = confirmedAgo(11 * MIN, { sellerId: 'shop-2' })
    expect((await get('buyer-1')).body.mayReviewService).toBe(false)
  })

  it('⛔ the SELLER side follows the stored deal too: a confirmed rental switched to goods keeps its control (and its undo)', async () => {
    h.deal = confirmedAgo(2 * MIN)
    h.convo = goods()
    const { body } = await get('seller-1')
    expect(body.deal).toMatchObject({ kind: 'rental', state: 'confirmed' })
    expect(body.deal.withdrawUntil).toBeTruthy()
  })
  it('…but a WITHDRAWN deal switched to goods shows the seller nothing (a fresh confirm there would always be refused)', async () => {
    h.deal = { ...confirmedAgo(20 * MIN), confirmedAt: null, revokedAt: new Date(), confirmCount: 1 }
    h.convo = goods()
    const { body } = await get('seller-1')
    for (const k of DEAL_KEYS) expect(body).not.toHaveProperty(k)
  })
  it('…and a goods listing with no deal row shows the seller nothing', async () => {
    h.deal = null
    h.convo = goods()
    const { body } = await get('seller-1')
    for (const k of DEAL_KEYS) expect(body).not.toHaveProperty(k)
  })
})

describe('⛔ migration tolerance on the polled route', () => {
  it('the table missing (P2021) or the column missing (P2022): 200, no deal', async () => {
    for (const code of ['P2021', 'P2022']) {
      h.dealFails = Object.assign(new Error('does not exist'), { code })
      const seller = await get('seller-1')
      expect(seller.status).toBe(200)
      expect(seller.body.deal).toEqual({ kind: 'rental', state: 'none', confirmsLeft: 2 })
      const buyer = await get('buyer-1')
      expect(buyer.status).toBe(200)
      expect(buyer.body.mayReviewService).toBe(false)
    }
  })

  it('any other failed read: still 200 (fail soft — a chat never 500s over a review affordance)', async () => {
    h.dealFails = new Error('connection reset')
    expect((await get('buyer-1')).status).toBe(200)
  })
})

describe('⛔ review round 5 — the seller is offered a fresh confirm only where the deal route takes it', () => {
  it('eno\'s own storefront (refused by the route, though no DESK_BY_SELLER_ID desk): no deal keys for the seller', async () => {
    const c = h.convo as Row
    c.seller = { ...c.seller, owner: { ...(c.seller.owner ?? {}), email: 'Support@eno.forum' } }
    const { body } = await get('seller-1')
    expect(body).not.toHaveProperty('deal')
  })
  it('…and it costs no query on the polled route: the owner rides the thread\'s own seller join', async () => {
    const src = (await import('node:fs')).readFileSync('src/app/api/conversations/[id]/route.ts', 'utf8')
    expect(src).toContain('accountType: true, email: true } } } },')
    expect(src).not.toContain('isEnoDeskThread')
  })
})

