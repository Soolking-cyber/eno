import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

// ── DELETE /api/conversations/:id/call — give up a start that never heard back (session.ts abandonStart) ─────────────
// The route itself, not only the SQL (round-7 review): its body is parsed, the give-up is scoped to the signed-in
// caller and this start id, and whatever it ended gets its follow-up (records, relay revocation).

const h = vi.hoisted(() => ({
  me: 'caller-1' as string | null,
  abandoned: [] as unknown[][],
  ended: [] as { row: { id: string }; reason: string }[],
  finished: [] as string[],
  afters: [] as Array<() => unknown>,
}))
vi.mock('server-only', () => ({}))
vi.mock('next/server', async (orig) => ({ ...(await orig<Record<string, unknown>>()), after: (fn: () => unknown) => { h.afters.push(fn) } }))
vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => (h.me ? { id: h.me } : null), getCurrentProfileId: async () => h.me, getAdmin: async () => null }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }) }))
vi.mock('@/lib/edition', () => ({ EDITION: 'marketplace' }))
vi.mock('@/lib/calls/server/eligibility', () => ({ callLimitRefusal: vi.fn(), callPermit: vi.fn(), hasCallConsent: vi.fn(), loadConversationForCall: vi.fn() }))
vi.mock('@/lib/calls/server/relay', () => ({ mintRelayCredential: vi.fn(), relayConfigured: vi.fn(), revokeRelayCredential: vi.fn() }))
vi.mock('@/lib/calls/server/cards', () => ({ sendRingPush: vi.fn() }))
vi.mock('@/lib/calls/server/http', () => ({ boundedCapabilities: z.unknown().optional(), peerCard: vi.fn(), relayForClient: vi.fn() }))
vi.mock('@/lib/calls/server/finish', () => ({ afterCallEnded: async (row: { id: string }, reason: string) => { h.finished.push(`${row.id}:${reason}`) } }))
vi.mock('@/lib/calls/server/session', () => ({
  RING_TIMEOUT_S: 45,
  commitTag: vi.fn(),
  startCall: vi.fn(),
  sweepStale: vi.fn(),
  abandonStart: async (...args: unknown[]) => { h.abandoned.push(args); return h.ended },
}))

const { DELETE } = await import('./route')
const del = (body: unknown) =>
  DELETE(new Request('https://eno.vn/api/conversations/c1/call', { method: 'DELETE', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'c1' }) })

beforeEach(() => { h.me = 'caller-1'; h.abandoned = []; h.ended = []; h.finished = []; h.afters = [] })

describe('DELETE /api/conversations/:id/call', () => {
  it('gives up THIS start of the signed-in caller in this thread, and follows up whatever it ended', async () => {
    h.ended = [{ row: { id: 'call-9' }, reason: 'cancelled' }]
    const r = await del({ startId: 'a1b2c3d4-0000-4000-8000-000000000001' })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ended: 1 })
    expect(h.abandoned).toEqual([['c1', 'caller-1', 'a1b2c3d4-0000-4000-8000-000000000001']])
    for (const fn of h.afters) await fn()
    expect(h.finished).toEqual(['call-9:cancelled'])
  })

  it('a give-up that finds nothing (still on its way: the tombstone) answers 200 { ended: 0 }', async () => {
    const r = await del({ startId: 'a1b2c3d4-0000-4000-8000-000000000002' })
    expect(await r.json()).toEqual({ ended: 0 })
    expect(h.abandoned).toHaveLength(1)
  })

  it('a malformed start id is a 400 and touches nothing; signed out is a 401', async () => {
    expect((await del({ startId: 'x' })).status).toBe(400)
    expect((await del({ tabId: 't-1' })).status).toBe(400)
    h.me = null
    expect((await del({ startId: 'a1b2c3d4-0000-4000-8000-000000000003' })).status).toBe(401)
    expect(h.abandoned).toEqual([])
  })
})
