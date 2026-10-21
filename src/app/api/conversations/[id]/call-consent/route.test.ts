import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── /api/conversations/:id/call-consent — "Allow calls from <name>" ────────────────────────────────────────────────
// A GRANT obeys the same thread rules a call does (eligibility.ts threadPermitRefusal — round-5 review); WITHDRAWING is
// always possible for a participant (round-6 review): a listing sold or a thread turned desk must not strand a "yes".

type Row = Record<string, unknown>
const h = vi.hoisted(() => ({
  me: 'buyer' as string | null,
  convo: null as Row | null,
  refusal: null as { error: string; status: number } | null,
  writes: [] as unknown[][],
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => (h.me ? { id: h.me } : null), getCurrentProfileId: async () => h.me, getAdmin: async () => null }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }) }))
vi.mock('@/lib/calls/server/eligibility', () => ({
  loadConversationForCall: async () => h.convo,
  threadPermitRefusal: async () => h.refusal,
  counterpartOf: (c: Row, id: string) => (c.buyerProfileId === id ? c.sellerProfileId : c.sellerProfileId === id ? c.buyerProfileId : null),
  hasCallConsent: async () => true,
  setCallConsent: async (...a: unknown[]) => { h.writes.push(a) },
}))

const { GET, POST } = await import('./route')
const post = (allow: boolean) =>
  POST(new Request('https://eno.vn/api/conversations/c1/call-consent', { method: 'POST', body: JSON.stringify({ allow }) }), { params: Promise.resolve({ id: 'c1' }) })

beforeEach(() => {
  h.me = 'buyer'
  h.convo = { id: 'c1', buyerProfileId: 'buyer', sellerProfileId: 'seller', sellerId: 'shop', listingId: 'l1', visaApplicationId: null }
  h.refusal = null
  h.writes = []
})

describe('GET call-consent', () => {
  const get = () => GET(new Request('https://eno.vn/api/conversations/c1/call-consent'), { params: Promise.resolve({ id: 'c1' }) })

  it('⛔ shows the STORED answer even where calls no longer qualify — a "yes" that can be withdrawn can be seen (round-7 review)', async () => {
    h.refusal = { error: 'calls_thread_unavailable', status: 403 }
    expect(await (await get()).json()).toEqual({ theyAllowMe: true, iAllowThem: true })
  })

  it('nothing for a stranger, or a thread with nobody on the other side', async () => {
    h.me = 'stranger'
    expect(await (await get()).json()).toEqual({ theyAllowMe: false, iAllowThem: false })
    h.me = 'buyer'; h.convo = { ...h.convo, sellerProfileId: null }
    expect(await (await get()).json()).toEqual({ theyAllowMe: false, iAllowThem: false })
  })
})

describe('POST call-consent', () => {
  it('grants in a thread that may carry calls', async () => {
    const r = await post(true)
    expect(r.status).toBe(200)
    expect(h.writes).toEqual([['c1', 'buyer', 'seller', true]])
  })

  it('⛔ refuses a GRANT where no call may go (visa / desk / e-Visa / listing gone)', async () => {
    h.refusal = { error: 'calls_thread_unavailable', status: 403 }
    const r = await post(true)
    expect(r.status).toBe(403)
    expect(await r.json()).toEqual({ error: 'calls_thread_unavailable' })
    expect(h.writes).toEqual([])
  })

  it('⛔ a WITHDRAWAL goes through even there — a "yes" can always be taken back', async () => {
    h.refusal = { error: 'calls_thread_unavailable', status: 403 }
    const r = await post(false)
    expect(r.status).toBe(200)
    expect(h.writes).toEqual([['c1', 'buyer', 'seller', false]])
  })

  it('only a participant may withdraw; an unclaimed storefront has nothing to withdraw', async () => {
    h.me = 'stranger'
    h.refusal = { error: 'not_participant', status: 403 }
    expect((await post(false)).status).toBe(403)
    h.me = 'buyer'; h.refusal = { error: 'calls_thread_unavailable', status: 403 }
    h.convo = { ...h.convo, sellerProfileId: null }
    expect((await post(false)).status).toBe(200)
    expect(h.writes).toEqual([])
  })
})
