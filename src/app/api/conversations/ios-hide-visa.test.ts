import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/conversations under App Store gate `ios-hide-visa` (D5 = b; src/lib/ios-hide-visa.ts).
 * Every "Chat with seller" reaches this route. Off ⇒ unchanged. On ⇒ from the iOS app only, no conversation about
 * an e-Visa PRODUCT starts here — the desk's (it would create the application) or a partner's (visa slot + an e-Visa
 * chip) — while an ordinary listing, a work-permit/legal listing in the same slot, Android and the web are untouched.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({
  listings: {} as Record<string, Row>,
  created: [] as Row[],
  started: [] as Row[],
  deskIds: new Set<string>(),
}))

vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: unknown) => w, editionSellerScope: async () => ({}) }))
vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      findFirst: ({ where }: Row) => Promise.resolve(h.listings[where.id] ? { ...h.listings[where.id] } : null),
      findUnique: ({ where }: Row) => {
        const l = h.listings[where.id]
        return Promise.resolve(l ? { attributes: l.attributes ?? null, category: { slug: l.categorySlug } } : null)
      },
    },
    message: { findFirst: () => Promise.resolve(null) },
    conversation: {
      findUnique: () => Promise.resolve(null),
      findFirst: () => Promise.resolve(null),
      findMany: () => Promise.resolve([]),
      create: ({ data }: Row) => { const row = { id: `convo-${h.created.length + 1}`, ...data }; h.created.push(row); return Promise.resolve(row) },
      update: ({ data }: Row) => Promise.resolve(data),
      updateMany: () => Promise.resolve({ count: 0 }),
    },
    notification: { create: () => Promise.resolve({}) },
  },
}))
vi.mock('@/lib/admin', () => ({
  getCurrentProfile: () => Promise.resolve({ id: 'buyer-1', email: 'b@example.com' }),
  getCurrentProfileId: () => Promise.resolve('buyer-1'),
  getAdmin: () => Promise.resolve(null),
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: () => Promise.resolve({ success: true }) }))
vi.mock('@/lib/enforcement', () => ({ conversationGate: () => Promise.resolve(null) }))
vi.mock('@/lib/user-blocks', () => ({ isBlockedBetween: () => Promise.resolve(false), blockedConversationIds: () => Promise.resolve([]) }))
vi.mock('@/lib/push', () => ({ sendPushToProfile: () => Promise.resolve() }))
vi.mock('@/lib/offer-guard', () => ({ recordFixedPriceOfferAttempt: () => Promise.resolve() }))
vi.mock('@/lib/messages', () => ({ insertMessage: () => Promise.resolve({ id: 'm1', body: '', createdAt: new Date().toISOString() }) }))
vi.mock('@/lib/thread-kind', () => ({ threadKind: () => Promise.resolve('listing') }))
vi.mock('@/lib/visa-shop', () => ({
  isVisaShopListing: (id: string) => Promise.resolve(h.deskIds.has(id)),
  getVisaShopSeller: () => Promise.resolve({ id: 'seller-desk', ownerId: 'desk-owner' }),
}))
vi.mock('@/lib/visa/dm-flow', () => ({
  startVisaDmFlow: (args: Row) => { h.started.push(args); return Promise.resolve({ ok: true, conversationId: 'visa-thread' }) },
}))
vi.mock('next/server', async (importOriginal) => {
  const mod = await importOriginal<typeof import('next/server')>()
  return { ...mod, after: (fn: () => unknown) => { void fn() } }
})

import { POST } from './route'

const IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const ANDROID_APP = 'Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 EnoNativeApp/1'

const base = { title: 'x', verified: true, negotiable: false, listingType: 'sell', affiliateUrl: null }
beforeEach(() => {
  vi.unstubAllEnvs()
  h.created = []
  h.started = []
  h.deskIds = new Set(['desk-visa'])
  h.listings = {
    'desk-visa': { ...base, id: 'desk-visa', sellerId: 'seller-desk', subcategorySlug: 'visa-legal', categorySlug: 'services', attributes: '{"visaEntryType":"single","visaSpeed":"1H"}', seller: { ownerId: 'desk-owner' } },
    'partner-visa': { ...base, id: 'partner-visa', sellerId: 'seller-vk', subcategorySlug: 'visa-legal', categorySlug: 'services', attributes: '{"visaEntryType":"multiple","visaSpeed":"1D","providerType":"business"}', seller: { ownerId: 'vk-owner' } },
    'work-permit': { ...base, id: 'work-permit', sellerId: 'seller-agent', subcategorySlug: 'visa-legal', categorySlug: 'services', attributes: '{"providerType":"business"}', seller: { ownerId: 'agent-owner' } },
    'bike': { ...base, id: 'bike', negotiable: true, sellerId: 'seller-shop', subcategorySlug: 'bicycles', categorySlug: 'sports', attributes: null, seller: { ownerId: 'shop-owner' } },
  }
})

async function post(listingId: string, ua: string) {
  const res = await POST(new Request('http://test/api/conversations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': ua },
    body: JSON.stringify({ listingId }),
  }))
  return { status: res.status, json: (await res.json()) as Row }
}

describe('gate OFF (the shipped default)', () => {
  it('the iOS app still starts the desk application and the partner chat', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    expect((await post('desk-visa', IOS_APP)).json).toMatchObject({ visa: true })
    expect(h.started).toHaveLength(1)
    expect((await post('partner-visa', IOS_APP)).status).toBe(200)
    expect(h.created).toHaveLength(1)
  })
})

describe('gate ON', () => {
  it('iOS app + the desk product: 403 ios_app_unavailable, no application started', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    expect(await post('desk-visa', IOS_APP)).toEqual({ status: 403, json: { error: 'ios_app_unavailable' } })
    expect(h.started).toEqual([])
  })

  it('iOS app + a partner e-Visa product: 403, no conversation created', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    expect(await post('partner-visa', IOS_APP)).toEqual({ status: 403, json: { error: 'ios_app_unavailable' } })
    expect(h.created).toEqual([])
  })

  it('iOS app + a work-permit listing in the same slot, or an ordinary listing: unchanged', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    expect((await post('work-permit', IOS_APP)).status).toBe(200)
    expect((await post('bike', IOS_APP)).status).toBe(200)
    expect(h.created).toHaveLength(2)
  })

  it('Android: unchanged for the desk and the partner', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    expect((await post('desk-visa', ANDROID_APP)).json).toMatchObject({ visa: true })
    expect((await post('partner-visa', ANDROID_APP)).status).toBe(200)
  })
})
