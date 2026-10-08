import { beforeEach, describe, expect, it, vi } from 'vitest'

// The teacher's "Share my phone, email & CV" (2026-09-30) — and its stop. 2026-10-07: a SHARE commits with its line or
// not at all (SendOpts.alongside); a STOP commits first, on its own, and its line is best-effort — revoking must never
// depend on the announcement.
type Row = Record<string, any>
const h = vi.hoisted(() => ({
  me: { id: 'teacher-1', accountType: 'individual' } as Row,
  thread: null as Row | null,
  row: null as Row | null,
  lines: [] as string[],
  failLine: false,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => h.me, getCurrentProfileId: async () => h.me.id, getAdmin: async () => null, isAdminEmail: () => false }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }), kv: { set: async () => 'OK', get: async () => null } }))
vi.mock('@/lib/enforcement', () => ({ conversationGate: async () => null }))
vi.mock('@/lib/user-blocks', () => ({ isBlockedBetween: async () => false }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('@/lib/teachers/share', () => ({ teacherThread: async () => h.thread }))
vi.mock('@/lib/messages', () => ({
  insertMessage: async (_c: Row, _s: string, body: string, opts?: { alongside?: Array<{ run: () => unknown }> }) => {
    if (h.failLine) throw new Error('send failed')
    for (const w of opts?.alongside ?? []) w.run()
    h.lines.push(body)
    return { id: 'm1', body }
  },
}))
vi.mock('@/lib/db', () => ({
  db: {
    teacherContactShare: {
      // Lazy like a PrismaPromise: run by the transaction (alongside) or by an await of its own.
      upsert: ({ create, update }: Row) => {
        const run = () => { h.row = h.row ? { ...h.row, ...update } : { ...create } }
        return { run, then: (ok: (v: unknown) => void, ko: (e: unknown) => void) => { try { run(); ok(undefined) } catch (e) { ko(e) } } }
      },
    },
  },
}))

const { POST } = await import('./route')
const post = (share: boolean) => POST(new Request('https://eno.vn/api/teachers/share', { method: 'POST', body: JSON.stringify({ conversationId: 'c1', share }) }) as never, {} as never)
const thread = (o: Row = {}) => ({ convo: { id: 'c1', buyerProfileId: 'school-1', sellerProfileId: 'teacher-1', listingId: 'L1', sellerId: 's1' }, teacherUserId: 'teacher-1', profileLive: true, shareOn: false, ...o })

beforeEach(() => { h.thread = thread(); h.row = null; h.lines = []; h.failLine = false })

describe('share — with its line or not at all', () => {
  it('shares and announces it', async () => {
    expect((await post(true)).status).toBe(200)
    expect(h.row).toMatchObject({ revokedAt: null })
    expect(h.row?.sharedAt).toBeInstanceOf(Date)
    expect(h.lines[0]).toContain('Shared my phone, email and CV')
  })
  it('a failed line writes no grant — and the retry is no silent no-op', async () => {
    h.failLine = true
    expect((await post(true)).status).toBe(500)
    expect(h.row).toBeNull()
    h.failLine = false
    expect((await post(true)).status).toBe(200)
    expect(h.lines).toHaveLength(1)
  })
})

describe('fails closed', () => {
  it('no `share`, or a non-boolean one, is a 400 — nothing shared', async () => {
    for (const body of [{ conversationId: 'c1' }, { conversationId: 'c1', share: 'false' }]) {
      const res = await POST(new Request('https://eno.vn/api/teachers/share', { method: 'POST', body: JSON.stringify(body) }) as never, {} as never)
      expect(res.status).toBe(400)
    }
    expect(h.row).toBeNull()
  })
})

describe('stop — never depends on its line', () => {
  it('the revoke stands even when the announcement fails', async () => {
    h.row = { sharedAt: new Date(Date.now() - 60_000), revokedAt: null }
    h.thread = thread({ shareOn: true })
    h.failLine = true
    const res = await post(false)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, shared: false })
    expect(h.row?.revokedAt).toBeInstanceOf(Date)
  })
})
