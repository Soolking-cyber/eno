import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GET /api/conversations/[id] under App Store gate `ios-hide-visa` (D5 = b): the `eVisaProduct` flag that makes a
 * PARTNER's e-Visa product thread read-only in the iOS app (the thread page's `visaElsewhere`).
 * Off ⇒ no read and no field — the payload is unchanged. On ⇒ the field appears ONLY for the iOS app's user agent,
 * ONLY on an ordinary-kind thread whose listing is an e-Visa product (the visa slot + an e-Visa chip).
 * Harness: route.rental-desk.test.ts's.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({
  me: 'buyer-1',
  kind: 'listing' as string | null,
  listing: null as Row | null,
  extraReads: 0,
}))

vi.mock('next/server', async (orig) => {
  const actual = await orig<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => { void fn() } }
})
vi.mock('@/lib/admin', () => ({
  getCurrentProfileId: async () => h.me,
  getCurrentProfile: async () => ({ id: h.me }),
  getAdmin: async () => null,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('@/lib/edition-scope', () => ({ isSellerHiddenHere: async () => false }))
vi.mock('@/lib/thread-kind', () => ({ threadKind: async () => h.kind }))
vi.mock('@/lib/reaction-tally', () => ({ globalTopReactions: async () => [] }))
vi.mock('@/lib/native-push', () => ({ syncBadgeToProfile: async () => {} }))
vi.mock('@/lib/messages', () => ({ MESSAGE_ROW_SELECT: {}, serializeMessage: (m: Row) => m }))
vi.mock('@/lib/db', () => ({
  db: {
    conversation: {
      findUnique: async () => ({
        id: 'thread-1', buyerProfileId: 'buyer-1', sellerProfileId: 'vk-owner', buyerUnread: 0, sellerUnread: 0,
        visaApplicationId: null,
        listing: { id: 'L-vk', title: 'Vietnam E-Visa - Single Entry - 1 Hour', images: '[]', price: 3_000_000, currency: '₫', priceUnit: null, negotiable: false, availabilityConfirmedAt: null, status: 'active', listingType: 'sell', verified: true, teacherProfile: null },
        teacherContactShare: null,
        teacherVideoShare: null,
        seller: { id: 'seller-vk', ownerId: 'vk-owner', name: 'VietKite', avatarColor: '#111', avatarUrl: null, trustScore: 100, trustTier: 'standard', memberSince: new Date('2025-01-01'), reviewCount: 0, officialPartner: true, owner: { lastSeenAt: null, locale: 'en' } },
        buyer: { displayName: 'Anna', email: 'anna@example.com', avatarColor: '#222', avatarUrl: null, lastSeenAt: null, locale: 'en' },
        messages: [],
      }),
      update: async () => ({}),
    },
    seller: { findUnique: async () => null },
    listing: {
      findFirst: async () => ({ id: 'L-public' }),
      findUnique: async () => { h.extraReads += 1; return h.listing },
    },
    review: { findUnique: async () => null },
  },
}))

const { GET } = await import('./route')

const IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const ANDROID_APP = 'Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 EnoNativeApp/1'

const get = async (ua: string) => {
  const res = await GET(new Request('http://localhost/api/conversations/thread-1', { headers: { 'user-agent': ua } }), { params: Promise.resolve({ id: 'thread-1' }) })
  return (await res.json()) as Row
}

beforeEach(() => {
  vi.unstubAllEnvs()
  h.me = 'buyer-1'
  h.kind = 'listing'
  h.listing = { subcategorySlug: 'visa-legal', attributes: '{"visaEntryType":"single","visaSpeed":"1H"}', category: { slug: 'services' } }
  h.extraReads = 0
})

describe('eVisaProduct on the thread payload', () => {
  it('gate OFF: no read, no field — even for the iOS app on a partner e-Visa thread', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    const body = await get(IOS_APP)
    expect('eVisaProduct' in body).toBe(false)
    expect(h.extraReads).toBe(0)
  })

  it('gate ON, iOS app, a partner e-Visa product thread: flagged', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    expect((await get(IOS_APP)).eVisaProduct).toBe(true)
  })

  it('gate ON, iOS app, the SELLER side (the partner answering): no read, no field', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    h.me = 'vk-owner'
    const body = await get(IOS_APP)
    expect('eVisaProduct' in body).toBe(false)
    expect(h.extraReads).toBe(0)
  })

  it('gate ON, Android: no read, no field', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    const body = await get(ANDROID_APP)
    expect('eVisaProduct' in body).toBe(false)
    expect(h.extraReads).toBe(0)
  })

  it('gate ON, iOS app, a work-permit listing in the same slot: no field', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    h.listing = { subcategorySlug: 'visa-legal', attributes: '{"providerType":"business"}', category: { slug: 'services' } }
    expect('eVisaProduct' in (await get(IOS_APP))).toBe(false)
  })

  it('gate ON, iOS app, a desk thread (kind visa) is already read-only by kind: no extra read', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    h.kind = 'visa'
    const body = await get(IOS_APP)
    expect('eVisaProduct' in body).toBe(false)
    expect(h.extraReads).toBe(0)
  })
})
