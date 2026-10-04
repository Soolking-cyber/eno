import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/conversations/[id]/messages under App Store gate `ios-hide-visa` (D5 = b; src/lib/ios-hide-visa.ts).
 * Off ⇒ unchanged, and no classification read runs on this hot path. On ⇒ the APPLICANT in the iOS app cannot write
 * into an e-Visa thread (bound to an application, a desk visa product, or a partner's e-Visa product); the seller side,
 * Android, the web and ordinary threads are untouched; a classification that cannot be read fails the send (closed).
 * Harness: blocked.test.ts's.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({ me: 'buyer-1', convo: null as Row | null, kind: 'listing', reads: 0, failRead: false, inserted: [] as Row[] }))

vi.mock('@/lib/admin', () => ({ getCurrentProfileId: async () => h.me, getAdmin: async () => null, isAdminEmail: () => false }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async () => ({ success: true, resetSec: 0 }),
  kv: { set: async () => 'OK', get: async () => null, del: async () => 1 },
}))
vi.mock('@/lib/enforcement', () => ({ messagingGate: async () => null }))
vi.mock('@/lib/offer-guard', () => ({ recordFixedPriceOfferAttempt: async () => {} }))
vi.mock('@/lib/messages', () => ({
  insertMessage: async (_c: Row, _me: string, text: string) => { h.inserted.push({ text }); return { id: 'm1', body: text } },
}))
vi.mock('@/lib/support-thread', () => ({ SUPPORT_SELLER_ID: 'support' }))
vi.mock('@/lib/whatsapp-bridge', () => ({ whatsappRecipientFor: async () => null }))
vi.mock('@/lib/whatsapp', () => ({ sendWhatsAppText: async () => ({ ok: true }) }))
vi.mock('@/lib/user-blocks', () => ({ isBlockedBetween: async () => false }))
vi.mock('@/lib/thread-kind', () => ({ threadKind: async () => h.kind }))
vi.mock('next/server', async (orig) => ({ ...(await orig<Record<string, unknown>>()), after: () => {} }))
vi.mock('@/lib/db', () => ({
  db: {
    conversation: {
      // The route's own read selects no visaApplicationId; the classification read does — count only that one.
      findUnique: async ({ select }: { select: Row }) => {
        if ('visaApplicationId' in select) { h.reads++; if (h.failRead) throw new Error('db down') }
        return h.convo
      },
    },
    profile: { findUnique: async () => ({ email: 'someone@example.com' }) },
  },
}))

const { POST } = await import('./route')

const IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const ANDROID_APP = 'Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 EnoNativeApp/1'

async function send(ua: string, body: Row = { body: 'Here is my passport photo' }) {
  const res = await POST(new Request('https://www.eno.forum/api/conversations/c1/messages', { method: 'POST', headers: { 'user-agent': ua }, body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: 'c1' }) } as never)
  return { status: res.status, body: (await res.json()) as Row }
}

const partnerVisa = { id: 'L-vk', negotiable: false, status: 'active', listingType: 'sell', subcategorySlug: 'visa-legal', attributes: '{"visaEntryType":"single","visaSpeed":"1H"}', category: { slug: 'services' } }
const bike = { id: 'L-bike', negotiable: true, status: 'active', listingType: 'sell', subcategorySlug: 'bicycles', attributes: null, category: { slug: 'sports' } }

beforeEach(() => {
  h.me = 'buyer-1'; h.kind = 'listing'; h.reads = 0; h.failRead = false; h.inserted = []
  h.convo = { id: 'c1', buyerProfileId: 'buyer-1', sellerProfileId: 'vk-owner', sellerId: 's-vk', visaApplicationId: null, listing: partnerVisa }
})
afterEach(() => vi.unstubAllEnvs())

describe('sending into an e-Visa thread', () => {
  it('gate OFF: the iOS app sends as before, and no classification read runs', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    expect((await send(IOS_APP)).status).toBe(200)
    expect(h.reads).toBe(0)
  })

  it('gate ON, iOS app, applicant, partner e-Visa product: 403 ios_app_unavailable, nothing inserted', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    expect(await send(IOS_APP)).toEqual({ status: 403, body: { error: 'ios_app_unavailable' } })
    // An offer on a NEGOTIABLE one too (on a fixed-price listing the existing not_negotiable 409 refuses it first).
    h.convo = { ...h.convo!, listing: { ...partnerVisa, negotiable: true } }
    expect(await send(IOS_APP, { offerAmount: 100000 })).toEqual({ status: 403, body: { error: 'ios_app_unavailable' } })
    expect(h.inserted).toEqual([])
  })

  it('gate ON, iOS app, a thread bound to an application, or a desk visa product: refused', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    h.convo = { ...h.convo!, visaApplicationId: 'app1', listing: bike }
    expect((await send(IOS_APP)).status).toBe(403)
    h.convo = { ...h.convo!, visaApplicationId: null, listing: { ...bike, id: 'L-desk' } }
    h.kind = 'visa'
    expect((await send(IOS_APP)).status).toBe(403)
  })

  it('gate ON: the seller side, Android and an ordinary thread are untouched', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    h.me = 'vk-owner'
    expect((await send(IOS_APP)).status).toBe(200)
    h.me = 'buyer-1'
    expect((await send(ANDROID_APP)).status).toBe(200)
    h.convo = { ...h.convo!, listing: bike }
    expect((await send(IOS_APP)).status).toBe(200)
  })

  it('gate ON: a classification that cannot be read FAILS the send rather than letting it through', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    h.failRead = true
    expect((await send(IOS_APP)).status).toBe(500)
    expect(h.inserted).toEqual([])
  })
})
