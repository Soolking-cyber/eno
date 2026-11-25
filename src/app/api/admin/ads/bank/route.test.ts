import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/admin/ads/bank — Mark paid / Cancel on a bank-transfer ad order (src/lib/ads/bank.ts). ⛔ Admin only: a
 * signed-in non-admin is refused before anything is read or written; the lib's answers pass through (idempotent).
 */
vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ admin: 'owner@eno.vn' as string | null, calls: [] as unknown[][] }))
vi.mock('@/lib/admin', () => ({ getAdmin: async () => h.admin, getCurrentProfile: async () => null, getCurrentProfileId: async () => 'p1' }))
vi.mock('@/lib/ads/bank', () => ({
  markBankOrderPaid: async (...a: unknown[]) => { h.calls.push(['paid', ...a]); return a[0] === 'closed' ? { ok: false, status: 409, code: 'order_closed' } : { ok: true, already: false, status: 'active', startsAt: null, endsAt: null } },
  adminCancelBankOrder: async (...a: unknown[]) => { h.calls.push(['cancel', ...a]); return a[0] === 'nope' ? { ok: false, status: 404, code: 'not_found' } : { ok: true, already: true } },
}))

const { POST } = await import('./route')
const post = (body: unknown) => POST(new Request('https://eno.vn/api/admin/ads/bank', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

beforeEach(() => { h.admin = 'owner@eno.vn'; h.calls = [] })

describe('POST /api/admin/ads/bank', () => {
  it('⛔ a non-admin is refused (403) and nothing is called', async () => {
    h.admin = null
    const res = await post({ adId: 'ad1', action: 'paid' })
    expect(res.status).toBe(403)
    expect(h.calls).toEqual([])
  })

  it('Mark paid runs as the admin; Cancel too; the answers pass through', async () => {
    const paid = await post({ adId: 'ad1', action: 'paid' })
    expect(paid.status).toBe(200)
    expect(await paid.json()).toMatchObject({ ok: true, already: false, status: 'active' })
    const cancel = await post({ adId: 'ad2', action: 'cancel' })
    expect(await cancel.json()).toEqual({ ok: true, already: true })
    expect(h.calls).toEqual([['paid', 'ad1', 'owner@eno.vn'], ['cancel', 'ad2', 'owner@eno.vn']])
  })

  it('a closed order is 409 order_closed, an unknown one 404, a bad body 400', async () => {
    expect((await post({ adId: 'closed', action: 'paid' })).status).toBe(409)
    expect((await post({ adId: 'nope', action: 'cancel' })).status).toBe(404)
    expect((await post({ adId: 'ad1', action: 'refund' })).status).toBe(400)
  })
})
