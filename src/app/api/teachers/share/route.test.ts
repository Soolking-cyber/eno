import { beforeEach, describe, expect, it, vi } from 'vitest'

// The teacher's "Share my phone, email & CV" (2026-09-30) — and its stop. 2026-10-07: a SHARE commits with its line or
// not at all (SendOpts.alongside); a STOP commits first, on its own, and its line is best-effort — revoking must never
// depend on the announcement. 2026-10-09 (gate review): the share RECORDS whether its tap included the phone
// (TeacherContactShare.phoneShared), the flag /api/teachers/contact serves the phone by.
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
/** `phone: true` = the tapped label named the phone ("Share my phone, email & CV" / "Share my phone too"). */
const post = (share: boolean, extra: Row = share ? { phone: true } : {}) => POST(new Request('https://eno.vn/api/teachers/share', { method: 'POST', body: JSON.stringify({ conversationId: 'c1', share, ...extra }) }) as never, {} as never)
const thread = (o: Row = {}) => ({ convo: { id: 'c1', buyerProfileId: 'school-1', sellerProfileId: 'teacher-1', listingId: 'L1', sellerId: 's1' }, teacherUserId: 'teacher-1', profileLive: true, shareOn: false, hasPhone: true, phoneShared: false, ...o })

beforeEach(() => { h.thread = thread(); h.row = null; h.lines = []; h.failLine = false })

describe('share — with its line or not at all', () => {
  it('shares and announces it', async () => {
    expect((await post(true)).status).toBe(200)
    expect(h.row).toMatchObject({ revokedAt: null })
    expect(h.row?.sharedAt).toBeInstanceOf(Date)
    expect(h.lines[0]).toContain('Shared my phone, email and CV')
  })
  it('with no phone on file the line says what was shared — email and CV, never a phone (A3, 2026-10-08)', async () => {
    h.thread = thread({ hasPhone: false })
    expect((await post(true)).status).toBe(200)
    expect(h.lines[0]).toContain('Shared my email and CV')
    expect(h.lines[0]).not.toMatch(/phone|điện thoại/)
    expect(h.lines[0].startsWith('📇')).toBe(true) // the strip's share signal counts 📇 lines
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
    expect(await res.json()).toEqual({ ok: true, shared: false, phoneShared: false })
    expect(h.row?.revokedAt).toBeInstanceOf(Date)
  })
})

// ⛔ A SHARE HANDS OVER WHAT ITS TAP NAMED (gate review, 2026-10-09). The contact route serves the CURRENT private row, so
// the share must record whether its tap included the phone — or a phone added after an "email & CV" share reaches every
// school shared with before. The phone goes only when the tapped label named it AND one is on file.
describe('phoneShared — stamped from the tap, on the create AND the update', () => {
  it('CREATE: a tap naming the phone, with one on file, records it — and the line says so', async () => {
    const res = await post(true, { phone: true })
    expect(await res.json()).toEqual({ ok: true, shared: true, phoneShared: true })
    expect(h.row).toMatchObject({ revokedAt: null, phoneShared: true })
    expect(h.lines[0]).toContain('Shared my phone, email and CV')
  })
  it('CREATE: no phone on file records none, whatever the label said (one removed since is not promised)', async () => {
    h.thread = thread({ hasPhone: false })
    const res = await post(true, { phone: true })
    expect(await res.json()).toEqual({ ok: true, shared: true, phoneShared: false })
    expect(h.row?.phoneShared).toBe(false)
    expect(h.lines[0]).toContain('Shared my email and CV')
  })
  it('⛔ CREATE: a "Share my email & CV" tap never hands over a phone added since (a tab loaded before it)', async () => {
    // The phone is on file NOW, but the button the teacher tapped did not name it.
    const res = await post(true, { phone: false })
    expect(await res.json()).toEqual({ ok: true, shared: true, phoneShared: false })
    expect(h.row?.phoneShared).toBe(false)
    expect(h.lines[0]).toContain('Shared my email and CV')
    expect(h.lines[0]).not.toMatch(/phone|điện thoại/)
  })
  it('fails closed: only a literal `phone: true` hands the phone over (missing, a string, a number: email and CV)', async () => {
    for (const extra of [{}, { phone: 'true' }, { phone: 1 }]) {
      Object.assign(h, { row: null, lines: [] }) // a fresh thread each time (assigned this way, tsc keeps h.row's type)
      expect((await post(true, extra)).status).toBe(200)
      expect(h.row?.phoneShared, JSON.stringify(extra)).toBe(false)
      expect(h.lines[0]).toContain('Shared my email and CV')
    }
  })
  it('UPDATE: a re-share after a stop re-stamps it — a row that once carried the phone does not keep it', async () => {
    h.row = { sharedAt: new Date(Date.now() - 60_000), revokedAt: new Date(Date.now() - 30_000), phoneShared: true }
    h.thread = thread({ hasPhone: false }) // the phone was removed since the first share
    expect((await post(true, { phone: true })).status).toBe(200)
    expect(h.row).toMatchObject({ revokedAt: null, phoneShared: false })
    expect(h.lines[0]).toContain('Shared my email and CV')
  })
  it('UPDATE: …and the other way — a re-share naming the phone records it', async () => {
    h.row = { sharedAt: new Date(Date.now() - 60_000), revokedAt: new Date(Date.now() - 30_000), phoneShared: false }
    expect((await post(true, { phone: true })).status).toBe(200)
    expect(h.row).toMatchObject({ revokedAt: null, phoneShared: true })
  })
  it('a revoke that creates its row records no phone (never the column\'s backfill default)', async () => {
    h.thread = thread({ shareOn: true }) // a standing share with no row in this mock: the revoke creates it
    expect((await post(false)).status).toBe(200)
    expect(h.row).toMatchObject({ phoneShared: false })
    expect(h.row?.revokedAt).toBeInstanceOf(Date)
  })
})

describe('"Share my phone too" — a phone added after an "email & CV" share', () => {
  const standing = () => { h.row = { sharedAt: new Date(Date.now() - 60_000), revokedAt: null, phoneShared: false }; h.thread = thread({ shareOn: true, phoneShared: false }) }
  it('re-shares with the phone: the row records it, and the thread is told in full (the school re-reads on the 📇 line)', async () => {
    standing()
    const res = await post(true, { phone: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, shared: true, phoneShared: true })
    expect(h.row).toMatchObject({ revokedAt: null, phoneShared: true })
    expect(h.lines).toHaveLength(1)
    expect(h.lines[0]).toBe('📇 Đã chia sẻ số điện thoại, email và CV · Shared my phone, email and CV')
  })
  it('a tap that does not name the phone changes nothing on a standing share — no line, no phone', async () => {
    standing()
    const res = await post(true, { phone: false })
    expect(await res.json()).toEqual({ ok: true, shared: true, phoneShared: false })
    expect(h.row?.phoneShared).toBe(false)
    expect(h.lines).toHaveLength(0)
  })
  it('⛔ an ADD on a STOPPED share (a stale tab after Stop) changes nothing — never re-grants phone, email and CV (Opus, 2026-10-09)', async () => {
    h.row = { sharedAt: new Date(Date.now() - 120_000), revokedAt: new Date(Date.now() - 60_000), phoneShared: false }
    h.thread = thread({ shareOn: false, phoneShared: false })
    const res = await post(true, { phone: true, addPhone: true })
    expect(await res.json()).toEqual({ ok: true, shared: false, phoneShared: false })
    expect(h.row).toMatchObject({ revokedAt: expect.any(Date), phoneShared: false })
    expect(h.lines).toHaveLength(0)
    // …while a fresh Share tap (no addPhone) on the same stopped share is the teacher sharing again, as before.
    const again = await post(true, { phone: true })
    expect(await again.json()).toEqual({ ok: true, shared: true, phoneShared: true })
  })

  it('with no phone on file any more it is a no-op: nothing to add', async () => {
    standing()
    h.thread = thread({ shareOn: true, phoneShared: false, hasPhone: false })
    const res = await post(true, { phone: true })
    expect(await res.json()).toEqual({ ok: true, shared: true, phoneShared: false })
    expect(h.lines).toHaveLength(0)
  })
  it('a share that already includes the phone stays as it is — a stale "email & CV" tap never takes it back (only Stop does)', async () => {
    h.row = { sharedAt: new Date(Date.now() - 60_000), revokedAt: null, phoneShared: true }
    h.thread = thread({ shareOn: true, phoneShared: true })
    for (const phone of [true, false]) {
      const res = await post(true, { phone })
      expect(await res.json()).toEqual({ ok: true, shared: true, phoneShared: true })
    }
    expect(h.row?.phoneShared).toBe(true)
    expect(h.lines).toHaveLength(0)
  })
  it('is refused on a hidden profile, like any share', async () => {
    standing()
    h.thread = thread({ shareOn: true, phoneShared: false, profileLive: false })
    expect((await post(true, { phone: true })).status).toBe(409)
    expect(h.row?.phoneShared).toBe(false)
  })
})
