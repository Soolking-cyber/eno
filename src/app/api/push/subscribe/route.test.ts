import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/push/subscribe (F9): a subscription is saved only for the account that tapped. A permission prompt left
 * open across an account switch posted with the NEXT account's cookie and saved the subscription for it. Through the
 * real route() wrapper; harness after ../subscription/route.test.ts.
 */

const h = vi.hoisted(() => ({ userId: 'user-1' as string | null, upserts: [] as unknown[] }))

vi.mock('@/lib/admin', () => ({
  getCurrentProfileId: async () => h.userId,
  getCurrentProfile: async () => (h.userId ? { id: h.userId } : null),
  getAdmin: async () => null,
}))
vi.mock('@/lib/db', () => ({ db: { pushSubscription: { upsert: async (args: unknown) => { h.upserts.push(args) } } } }))

const { POST } = await import('./route')

const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys: { p256dh: 'p', auth: 'a' } }
const post = (headers: Record<string, string> = {}) =>
  POST(new Request('http://x/api/push/subscribe', { method: 'POST', headers, body: JSON.stringify(SUB) }), { params: Promise.resolve({}) } as never)

beforeEach(() => { h.userId = 'user-1'; h.upserts = [] })

describe('POST /api/push/subscribe — only for the account that tapped', () => {
  it('⛔ a tap made for another account than the cookie\'s → 409 account_changed, and nothing is saved', async () => {
    const res = await post({ 'x-eno-acting-account': 'user-2' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'account_changed' })
    expect(h.upserts).toEqual([])
  })

  it('the cookie\'s own account is saved, as before', async () => {
    expect((await post({ 'x-eno-acting-account': 'user-1' })).status).toBe(200)
    expect(h.upserts).toHaveLength(1)
  })

  it('no header (an older client) is saved, as in F1', async () => {
    expect((await post()).status).toBe(200)
    expect(h.upserts).toHaveLength(1)
  })
})
