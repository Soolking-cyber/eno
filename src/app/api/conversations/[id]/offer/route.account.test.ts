import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/conversations/[id]/offer — ⛔ AN OFFER ANSWER IS SENT AS THE ACCOUNT THAT TAPPED, OR NOT AT ALL
 * (src/lib/api/acting-account.ts). The answer waits out a 5s undo window and the cookie is read when it goes
 * out, so a browser that changed account in between gets 409 account_changed on the handler's FIRST line:
 * before the enforcement gate, the body, the thread read and actOnOffer.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  me: 'seller-1' as string | null,
  gateCalls: 0,
  reads: 0,
  acts: [] as unknown[][],
}))

vi.mock('@/lib/admin', () => ({
  getCurrentProfileId: async () => h.me,
  getCurrentProfile: async () => (h.me ? { id: h.me } : null),
  getAdmin: async () => null,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('@/lib/enforcement', () => ({ messagingGate: async () => { h.gateCalls += 1; return null } }))
vi.mock('@/lib/user-blocks', () => ({ isBlockedBetween: async () => false }))
vi.mock('@/lib/messages', () => ({ actOnOffer: async (...args: unknown[]) => { h.acts.push(args); return true } }))
vi.mock('@/lib/db', () => ({
  db: {
    conversation: {
      findUnique: async (): Promise<Row> => {
        h.reads += 1
        return { id: 'thread-1', buyerProfileId: 'buyer-1', sellerProfileId: 'seller-1', listing: { id: 'L1', status: 'active' } }
      },
    },
  },
}))

const { POST } = await import('./route')

async function answer(headers: Record<string, string>, body: string = JSON.stringify({ messageId: 'm-offer', action: 'accept' })) {
  const res = await POST(
    new Request('https://eno.vn/api/conversations/thread-1/offer', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body }),
    { params: Promise.resolve({ id: 'thread-1' }) },
  )
  return { status: res.status, body: (await res.json()) as Row }
}

beforeEach(() => {
  h.me = 'seller-1'
  h.gateCalls = 0
  h.reads = 0
  h.acts = []
})

describe('POST /api/conversations/[id]/offer — the account that tapped', () => {
  it('⛔ a session that is not the account named → 409 account_changed: no gate, no read, no actOnOffer', async () => {
    h.me = 'buyer-1' // the offer's SENDER signed in inside the window — actOnOffer would refuse them anyway
    expect(await answer({ 'x-eno-acting-account': 'seller-1' })).toEqual({ status: 409, body: { error: 'account_changed' } })
    expect(h.gateCalls).toBe(0)
    expect(h.reads).toBe(0)
    expect(h.acts).toEqual([])
  })

  it('⛔ it comes BEFORE the body: a malformed body under the wrong account is still 409, not 400', async () => {
    h.me = 'stranger-1'
    expect(await answer({ 'x-eno-acting-account': 'seller-1' }, '{not json')).toEqual({ status: 409, body: { error: 'account_changed' } })
  })

  it('the header names the session → the answer goes through, as that account', async () => {
    expect(await answer({ 'x-eno-acting-account': 'seller-1' })).toEqual({ status: 200, body: { ok: true } })
    expect(h.acts).toHaveLength(1)
    expect(h.acts[0][1]).toBe('seller-1')
  })

  it('no header (the native apps, an older page) → unchanged', async () => {
    expect(await answer({})).toEqual({ status: 200, body: { ok: true } })
    expect(h.acts).toHaveLength(1)
  })
})
