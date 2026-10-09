import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE BELL'S DELETES NAME THE ACCOUNT WHOSE BELL TAPPED (F6, as F1 did for conversation deletes and offer answers).
 * A tab still showing one account after another tab switched the shared cookie must not delete the other account's
 * notifications. Through the real route() wrapper; harness after read/route.test.ts.
 */

const h = vi.hoisted(() => ({ userId: 'user-1' as string | null, deletes: [] as unknown[] }))

vi.mock('@/lib/admin', () => ({
  getCurrentProfileId: async () => h.userId,
  getCurrentProfile: async () => (h.userId ? { id: h.userId } : null),
  getAdmin: async () => null,
  isCurrentUserAdminByClaims: async () => false,
}))
vi.mock('@/lib/db', () => ({
  db: { notification: { deleteMany: async (a: unknown) => { h.deletes.push(a); return { count: 1 } } } },
}))

const { DELETE: clearAll } = await import('./route')
const { DELETE: removeOne } = await import('./[id]/route')

const req = (url: string, account?: string) =>
  new Request(url, { method: 'DELETE', headers: account ? { 'x-eno-acting-account': account } : {} })

beforeEach(() => { h.userId = 'user-1'; h.deletes = [] })

describe('DELETE /api/notifications and /api/notifications/[id] (F6)', () => {
  it('⛔ clear all, tapped by another account than the cookie\'s → 409, nothing deleted', async () => {
    const res = await clearAll(req('http://x/api/notifications', 'someone-else'), { params: Promise.resolve({}) } as never)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'account_changed' })
    expect(h.deletes).toEqual([])
  })

  it('⛔ remove one, tapped by another account → 409, nothing deleted', async () => {
    const res = await removeOne(req('http://x/api/notifications/n1', 'someone-else'), { params: Promise.resolve({ id: 'n1' }) } as never)
    expect(res.status).toBe(409)
    expect(h.deletes).toEqual([])
  })

  it('the cookie\'s own account (or an older client with no header) → deleted as before', async () => {
    expect((await clearAll(req('http://x/api/notifications', 'user-1'), { params: Promise.resolve({}) } as never)).status).toBe(204)
    expect((await removeOne(req('http://x/api/notifications/n1'), { params: Promise.resolve({ id: 'n1' }) } as never)).status).toBe(204)
    expect(h.deletes).toHaveLength(2)
  })
})
