import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/ads/orders — a bank-transfer ad order from /dashboard/ads (src/lib/ads/bank.ts createBankOrder, tested there).
 * Pinned here: the session is required, the shop is the signed-in person's own, and every refusal is a house code (with
 * book.ts's own `reason` for a target) the form words as a sentence.
 */
vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ userId: 'p1' as string | null, seller: { id: 's1' } as { id: string } | null, out: null as unknown, args: [] as unknown[] }))
vi.mock('@/lib/admin', () => ({ getAdmin: async () => null, getCurrentProfile: async () => null, getCurrentProfileId: async () => h.userId }))
vi.mock('@/lib/db', () => ({ db: { seller: { findUnique: async ({ where }: { where: { ownerId: string } }) => (where.ownerId === 'p1' ? h.seller : null) } } }))
vi.mock('@/lib/ads/bank', () => ({ createBankOrder: async (a: unknown) => { h.args.push(a); return h.out } }))

const { POST } = await import('./route')
const post = (body: unknown) => POST(new Request('https://eno.vn/api/ads/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
const BODY = { kind: 'listing', listingId: 'l1', period: 'week' }

beforeEach(() => { h.userId = 'p1'; h.seller = { id: 's1' }; h.args = []; h.out = { ok: true, order: { id: 'ad1', reference: 'ENOAD 7K3F9Q' } } })

describe('POST /api/ads/orders', () => {
  it('signed out → 401, nothing created', async () => {
    h.userId = null
    expect((await post(BODY)).status).toBe(401)
    expect(h.args).toEqual([])
  })

  it('an order for the signed-in person\'s own shop → 201 with the order, never cached', async () => {
    const res = await post(BODY)
    expect(res.status).toBe(201)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(await res.json()).toEqual({ order: { id: 'ad1', reference: 'ENOAD 7K3F9Q' } })
    expect(h.args).toEqual([{ sellerId: 's1', profileId: 'p1', kind: 'listing', listingId: 'l1', creativeId: undefined, period: 'week' }])
  })

  it('refusals are house codes; a target\'s carries book.ts\'s reason', async () => {
    h.out = { ok: false, status: 403, code: 'target_refused', reason: 'not_public' }
    let res = await post(BODY)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'target_refused', reason: 'not_public' })
    h.out = { ok: false, status: 503, code: 'bank_unavailable' }
    res = await post(BODY)
    expect([res.status, await res.json()]).toEqual([503, { error: 'bank_unavailable' }])
    h.out = { ok: false, status: 429, code: 'rate_limited' }
    expect((await post(BODY)).status).toBe(429)
  })

  it('a body of the wrong shape (an unknown period or kind) → 400 before anything runs', async () => {
    expect((await post({ ...BODY, period: 'year' })).status).toBe(400)
    expect((await post({ ...BODY, kind: 'banner' })).status).toBe(400)
    expect(h.args).toEqual([])
  })
})
