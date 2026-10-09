import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * DELETE /api/conversations/[id] — ⛔ SENT AS THE ACCOUNT THAT TAPPED, OR NOT AT ALL (src/lib/api/acting-account.ts).
 *
 * The inbox's delete waits out a 5s undo window, and the cookie is read when it goes out. If the browser
 * changed account inside the window and both accounts are in this thread, the session's own inbox would
 * lose it. The route answers 409 account_changed on its FIRST line — nothing read, nothing written.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  me: 'buyer-1' as string | null,
  convo: { buyerProfileId: 'buyer-1', sellerProfileId: 'seller-1' } as Row | null,
  reads: 0,
  updates: [] as Row[],
}))

vi.mock('@/lib/admin', () => ({
  getCurrentProfileId: async () => h.me,
  getCurrentProfile: async () => (h.me ? { id: h.me } : null),
  getAdmin: async () => null,
  isAdminEmail: () => false,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }), kv: { set: async () => 'OK' } }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('@/lib/db', () => ({
  db: {
    conversation: {
      findUnique: async () => { h.reads += 1; return h.convo },
      update: async (args: Row) => { h.updates.push(args); return {} },
    },
  },
}))

const { DELETE } = await import('./route')

async function del(headers: Record<string, string> = {}) {
  const res = await DELETE(new Request('https://eno.vn/api/conversations/thread-1', { method: 'DELETE', headers }), { params: Promise.resolve({ id: 'thread-1' }) })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

beforeEach(() => {
  h.me = 'buyer-1'
  h.convo = { buyerProfileId: 'buyer-1', sellerProfileId: 'seller-1' }
  h.reads = 0
  h.updates = []
})

describe('DELETE /api/conversations/[id] — the account that tapped', () => {
  it('⛔ a session that is not the account named → 409 account_changed, before any read — even when the session is in the thread too', async () => {
    h.me = 'seller-1' // the other participant signed in inside the window
    expect(await del({ 'x-eno-acting-account': 'buyer-1' })).toEqual({ status: 409, body: { error: 'account_changed' } })
    expect(h.reads).toBe(0)
    expect(h.updates).toEqual([])
  })

  it('⛔ a non-participant session with a stale header → 409 account_changed too, not a 403 about the thread', async () => {
    h.me = 'stranger-1'
    expect(await del({ 'x-eno-acting-account': 'buyer-1' })).toEqual({ status: 409, body: { error: 'account_changed' } })
    expect(h.reads).toBe(0)
  })

  it('the header names the session → 204, and only the caller’s side is stamped', async () => {
    expect(await del({ 'x-eno-acting-account': 'buyer-1' })).toEqual({ status: 204, body: null })
    expect(h.updates).toHaveLength(1)
    expect(Object.keys(h.updates[0].data).sort()).toEqual(['buyerDeletedAt', 'buyerUnread'])
  })

  it('no header (the native apps, an older page) → unchanged: 204', async () => {
    expect(await del()).toEqual({ status: 204, body: null })
    expect(h.updates).toHaveLength(1)
  })

  it('signed out → the wrapper’s 401, whatever the header says', async () => {
    h.me = null
    expect(await del({ 'x-eno-acting-account': 'buyer-1' })).toEqual({ status: 401, body: { error: 'auth_required' } })
    expect(h.reads).toBe(0)
  })
})
