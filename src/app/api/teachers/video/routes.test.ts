import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE INTRO VIDEO SENT ON REQUEST (owner, 2026-10-07: "hide and send upon request") — the three conversation routes.
 *   · POST /api/teachers/video-request — the school asks (a line as the school, a ring for the teacher);
 *   · POST /api/teachers/video-share  — the teacher sends or stops (its OWN grant, never the contact one);
 *   · GET  /api/teachers/video        — the school watches through a 10-minute signed link.
 * Each re-derives everything from the thread (teacherThread is mocked to the state under test).
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({
  me: { id: 'school-1', accountType: 'business' } as Row,
  thread: null as Row | null,
  suspended: false,
  blocked: false,
  rows: new Map<string, Row>(),
  lines: [] as Row[],
  rung: [] as Row[],
  failLine: false,
  signedPaths: [] as string[],
  signed: 'https://sb.eno.vn/storage/v1/object/sign/teacher-videos/tp/v.mp4?token=x' as string | null,
}))

vi.mock('server-only', () => ({}))
vi.mock('next/server', async (orig) => ({ ...(await orig<Record<string, unknown>>()), after: (fn: () => unknown) => { void fn() } }))
vi.mock('@/lib/admin', () => ({
  getCurrentProfile: async () => h.me,
  getCurrentProfileId: async () => h.me.id,
  getAdmin: async () => null,
  isAdminEmail: () => false,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }), kv: { set: async () => 'OK', get: async () => null } }))
vi.mock('@/lib/enforcement', () => ({ conversationGate: async () => (h.suspended ? { error: 'account_suspended' } : null) }))
vi.mock('@/lib/user-blocks', () => ({ isBlockedBetween: async () => h.blocked }))
vi.mock('@/lib/teachers/share', () => ({ teacherThread: async () => h.thread }))
vi.mock('@/lib/teachers/video-store', () => ({ signTeacherVideo: async (p: string) => { h.signedPaths.push(p); return h.signed } }))
vi.mock('@/lib/teachers/notify', () => ({ notifyTeacherOfSchoolMessage: async (a: Row) => { h.rung.push(a) } }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
// insertMessage commits its `alongside` writes WITH the line or not at all (SendOpts.alongside) — the mock keeps that
// contract: a failed line applies none of them.
vi.mock('@/lib/messages', () => ({
  insertMessage: async (_c: Row, sender: string, body: string, opts?: { alongside?: Array<{ run: () => unknown }> }) => {
    if (h.failLine) throw new Error('send failed')
    for (const w of opts?.alongside ?? []) w.run()
    h.lines.push({ sender, body })
    return { id: 'm1', body }
  },
}))
vi.mock('@/lib/db', () => ({
  db: {
    teacherVideoShare: {
      // LAZY, like a PrismaPromise: nothing is written until the transaction runs it (insertMessage's mock above) or the
      // caller awaits it on its own.
      upsert: ({ where, create, update }: Row) => {
        const run = () => {
          const cur = h.rows.get(where.conversationId)
          h.rows.set(where.conversationId, cur ? { ...cur, ...update } : { requestedAt: null, sharedAt: null, revokedAt: null, ...create })
        }
        return { run, then: (ok: (v: unknown) => void, ko: (e: unknown) => void) => { try { run(); ok(undefined) } catch (e) { ko(e) } } }
      },
    },
    profile: { findUnique: async () => ({ email: 'someone@example.com' }) },
  },
}))

const share = await import('../video-share/route')
const request = await import('../video-request/route')
const watch = await import('./route')

const thread = (o: Row = {}): Row => ({
  convo: { id: 'c1', buyerProfileId: 'school-1', sellerProfileId: 'teacher-1', listingId: 'L1', sellerId: 's1', teacherVideoShare: h.rows.get('c1') ?? null },
  teacherProfileId: 'tp-1', teacherUserId: 'teacher-1', recruiterUserId: 'school-1',
  profileLive: true, privateVideoPath: 'tp/v.mp4', videoAvailable: true, videoShareOn: false, videoShared: false, videoRequested: false,
  ...o,
})
const post = (mod: { POST: (r: never, c: never) => Promise<Response> }, body: Row) =>
  mod.POST(new Request('https://eno.vn/api/x', { method: 'POST', body: JSON.stringify(body) }) as never, {} as never)
const get = () => watch.GET(new Request('https://eno.vn/api/teachers/video?conversationId=c1') as never, {} as never)

beforeEach(() => {
  h.me = { id: 'school-1', accountType: 'business' }
  // Rows first: thread() reads them, and a thread built over the previous test's rows would carry its grant.
  h.rows = new Map(); h.lines = []; h.rung = []
  h.thread = thread()
  h.suspended = false; h.blocked = false; h.failLine = false; h.signedPaths = []
  h.signed = 'https://sb.eno.vn/storage/v1/object/sign/teacher-videos/tp/v.mp4?token=x'
})

describe('the school asks', () => {
  it('posts its line, records the request and rings the teacher', async () => {
    const res = await post(request, { conversationId: 'c1' })
    expect(res.status).toBe(200)
    expect(h.lines).toEqual([{ sender: 'school-1', body: expect.stringContaining('Could you send your intro video?') }])
    expect(h.rows.get('c1')?.requestedAt).toBeInstanceOf(Date)
    expect(h.rows.get('c1')?.sharedAt).toBeNull() // a request unlocks nothing
    expect(h.rung).toEqual([{ teacherProfileId: 'teacher-1', conversationId: 'c1', listingId: 'L1' }])
  })
  it('does not ask again within a day — and may once the teacher stopped sharing since', async () => {
    h.rows.set('c1', { requestedAt: new Date(Date.now() - 3600_000), sharedAt: null, revokedAt: null })
    h.thread = thread()
    await post(request, { conversationId: 'c1' })
    expect(h.lines).toEqual([])
    h.rows.set('c1', { requestedAt: new Date(Date.now() - 3600_000), sharedAt: new Date(Date.now() - 3000_000), revokedAt: new Date(Date.now() - 60_000) })
    h.thread = thread()
    await post(request, { conversationId: 'c1' })
    expect(h.lines).toHaveLength(1)
  })
  it('refuses a personal account, the teacher themself, a video kept public, and a block', async () => {
    h.me = { id: 'school-1', accountType: 'individual' }
    expect((await post(request, { conversationId: 'c1' })).status).toBe(403)
    h.me = { id: 'teacher-1', accountType: 'business' }
    expect((await post(request, { conversationId: 'c1' })).status).toBe(404)
    h.me = { id: 'school-1', accountType: 'business' }
    h.thread = thread({ videoAvailable: false })
    expect((await post(request, { conversationId: 'c1' })).status).toBe(409)
    h.thread = thread(); h.blocked = true
    expect((await post(request, { conversationId: 'c1' })).status).toBe(403)
    expect(h.lines).toEqual([])
  })
  it('never a request the teacher was not told about: the row is written WITH the line, so a failed line writes nothing', async () => {
    h.failLine = true
    expect((await post(request, { conversationId: 'c1' })).status).toBe(500)
    expect(h.rows.has('c1')).toBe(false)
    // …and the retry is not silenced by an "asked recently" request nobody was told about.
    h.failLine = false; h.thread = thread()
    expect((await post(request, { conversationId: 'c1' })).status).toBe(200)
    expect(h.lines).toHaveLength(1)
  })
})

describe('the teacher sends or stops', () => {
  beforeEach(() => { h.me = { id: 'teacher-1', accountType: 'individual' } })
  it('sends: the grant is on and the school is told in the thread', async () => {
    expect((await post(share, { conversationId: 'c1', share: true })).status).toBe(200)
    expect(h.rows.get('c1')?.sharedAt).toBeInstanceOf(Date)
    expect(h.rows.get('c1')?.revokedAt).toBeNull()
    expect(h.lines[0].body).toContain('Sent my intro video')
  })
  it('only the thread\'s teacher may, and never on a hidden profile, without a private video, or across a block', async () => {
    h.me = { id: 'school-1', accountType: 'business' }
    expect((await post(share, { conversationId: 'c1', share: true })).status).toBe(404)
    h.me = { id: 'teacher-1', accountType: 'individual' }
    h.thread = thread({ profileLive: false })
    expect((await post(share, { conversationId: 'c1', share: true })).status).toBe(409)
    h.thread = thread({ videoAvailable: false })
    expect((await post(share, { conversationId: 'c1', share: true })).status).toBe(404)
    h.thread = thread(); h.blocked = true
    expect((await post(share, { conversationId: 'c1', share: true })).status).toBe(403)
  })
  it('fails closed: no `share`, or a non-boolean one, hands nothing over', async () => {
    for (const body of [{ conversationId: 'c1' }, { conversationId: 'c1', share: 'false' }, { conversationId: 'c1', share: 1 }]) {
      expect((await post(share, body)).status).toBe(400)
    }
    expect(h.rows.has('c1')).toBe(false)
    expect(h.lines).toEqual([])
  })
  it('a suspended teacher cannot send — but can always stop, even on a hidden profile', async () => {
    h.suspended = true
    expect((await post(share, { conversationId: 'c1', share: true })).status).toBe(403)
    h.rows.set('c1', { requestedAt: null, sharedAt: new Date(), revokedAt: null })
    h.thread = thread({ profileLive: false, videoAvailable: false, videoShareOn: true })
    expect((await post(share, { conversationId: 'c1', share: false })).status).toBe(200)
    expect(h.rows.get('c1')?.revokedAt).toBeInstanceOf(Date)
  })
  it('never a grant with no line: the grant is written WITH its line, so a failed line writes nothing', async () => {
    h.failLine = true
    expect((await post(share, { conversationId: 'c1', share: true })).status).toBe(500)
    expect(h.rows.has('c1')).toBe(false)
    // …and the retry is no silent no-op: the grant and its line land together.
    h.failLine = false; h.thread = thread()
    expect((await post(share, { conversationId: 'c1', share: true })).status).toBe(200)
    expect(h.rows.get('c1')?.sharedAt).toBeInstanceOf(Date)
    expect(h.lines).toHaveLength(1)
  })
  it('⛔ a STOP never depends on its line: the revoke stands even when the announcement fails', async () => {
    const was = new Date(Date.now() - 60_000)
    h.rows.set('c1', { requestedAt: null, sharedAt: was, revokedAt: null })
    h.thread = thread({ videoShareOn: true, videoShared: true })
    h.failLine = true
    const res = await post(share, { conversationId: 'c1', share: false })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, shared: false })
    expect(h.rows.get('c1')?.revokedAt).toBeInstanceOf(Date)
  })
})

describe('the school watches', () => {
  it('gets a 10-minute link only while the video is shared with it, never cached', async () => {
    h.thread = thread({ videoShared: true })
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect((await res.json()) as Row).toEqual({ url: h.signed, expiresIn: 600 })
    // The path read WITH the grant — never a second lookup a replacement could slip between (gate review).
    expect(h.signedPaths).toEqual(['tp/v.mp4'])
  })
  it('refuses before a share, to a personal account, to anyone but the thread\'s school, across a block', async () => {
    expect((await get()).status).toBe(403) // share_required
    h.thread = thread({ videoShared: true })
    h.me = { id: 'school-1', accountType: 'individual' }
    expect((await get()).status).toBe(403)
    h.me = { id: 'other-school', accountType: 'business' }
    expect((await get()).status).toBe(404)
    h.me = { id: 'school-1', accountType: 'business' }; h.blocked = true
    expect((await get()).status).toBe(403)
  })
  it('says the store failed rather than handing out nothing', async () => {
    h.thread = thread({ videoShared: true }); h.signed = null
    expect((await get()).status).toBe(502)
  })
})

describe('the state the strip re-reads on a 🎬 line', () => {
  const state = () => share.GET(new Request('https://eno.vn/api/teachers/video-share?conversationId=c1') as never, {} as never)
  it('answers both parties with flags only, never cached', async () => {
    h.thread = thread({ videoShareOn: true, videoShared: true, videoRequested: true })
    for (const me of [{ id: 'school-1', accountType: 'business' }, { id: 'teacher-1', accountType: 'individual' }]) {
      h.me = me
      const res = await state()
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('private, no-store')
      expect(await res.json()).toEqual({ available: true, shareOn: true, shared: true, requested: true })
    }
  })
  it('anyone else: the thread does not exist', async () => {
    h.me = { id: 'other-school', accountType: 'business' }
    expect((await state()).status).toBe(404)
  })
})

