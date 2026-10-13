import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE INTRO VIDEO SENT ON REQUEST (owner, 2026-10-07: "hide and send upon request") — the three conversation routes.
 *   · POST /api/teachers/video-request — the school asks (a line as the school, a ring for the teacher);
 *   · POST /api/teachers/video-share  — the teacher sends or stops (its OWN grant, never the contact one);
 *   · GET  /api/teachers/video        — the school watches through a 10-minute signed link.
 * Each re-derives everything from the thread (teacherThread is mocked to the state under test).
 *
 * ⛔ ANY ACCOUNT SINCE THE TEACHER DM LADDER (owner, 2026-10-13: "Anyone"). The 2026-10-08 business-only rule is gone from
 * all three — and from the contact and CV reads (last block), which carried the same `business_only` 403. A personal
 * account (a parent) the teacher shared with asks, is sent and watches exactly as a school does: the teacher's own tap in
 * THAT conversation is the only key. Every other refusal (not the thread's party, suspended, blocked, no share, a profile
 * not live) stands — asserted below by its error code, with the thread's own party on a personal account, so a refusal
 * can never be a `business_only` in disguise.
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
  // "2 until reply" (dm-quota.ts): mayWriteToTeacher's early answer, and the guard riding with the line aborting it.
  mayWrite: true,
  guardRefuses: false,
  ran: [] as string[],
  // What the route asked the ladder, with which ids: the conversation, the writer, the teacher's PROFILE id (the uuid the
  // guard casts — never the TeacherProfile cuid).
  asked: [] as Row[],
  signedPaths: [] as string[],
  signed: 'https://sb.eno.vn/storage/v1/object/sign/teacher-videos/tp/v.mp4?token=x' as string | null,
  cvUrl: 'https://sb.eno.vn/storage/v1/object/sign/teacher-cvs/cv/tp-1.pdf?token=y',
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
// teacherThread is the state under test; teacherVideoState stays REAL — thread() below derives the ask flags with it.
vi.mock('@/lib/teachers/share', async (orig) => ({ ...(await orig<Record<string, unknown>>()), teacherThread: async () => h.thread }))
vi.mock('@/lib/teachers/video-store', () => ({ signTeacherVideo: async (p: string) => { h.signedPaths.push(p); return h.signed } }))
vi.mock('@/lib/teachers/cv-store', () => ({ signTeacherCv: async () => h.cvUrl }))
vi.mock('@/lib/teachers/notify', () => ({ notifyTeacherOfSchoolMessage: async (a: Row) => { h.rung.push(a) } }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
// The ask is a message to the teacher: "2 until reply" holds it (owner, 2026-10-13). The rule and its SQL are the
// ladder's (dm-quota.test.ts); pinned here: the route asks it, refuses on it, and the guard runs FIRST in the line's
// transaction — before the request is recorded — so a refusal writes neither.
vi.mock('@/lib/teachers/dm-quota', () => ({
  mayWriteToTeacher: async (conversationId: string, buyerProfileId: string, teacherProfileId: string | null) => {
    h.asked.push({ fn: 'mayWrite', conversationId, buyerProfileId, teacherProfileId })
    return h.mayWrite
  },
  // As the real one: the send runs WITH the guard, and a guard that aborts fails the whole batch — the rule, asked again,
  // then says no. The guard aborting is modelled by its own write throwing, in the order the batch runs them.
  sendToTeacherGuarded: async (thread: Row, send: (alongside: Array<{ run: () => unknown }>) => Promise<unknown>) => {
    h.asked.push({ fn: 'guarded', ...thread })
    try {
      return { sent: true, value: await send([{ run: () => { h.ran.push('guard'); if (h.guardRefuses) throw new Error('division by zero') } }]) }
    } catch (e) {
      if (h.guardRefuses) return { sent: false }
      throw e
    }
  },
}))
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
          h.ran.push('request')
          const cur = h.rows.get(where.conversationId)
          h.rows.set(where.conversationId, cur ? { ...cur, ...update } : { requestedAt: null, sharedAt: null, revokedAt: null, ...create })
        }
        return { run, then: (ok: (v: unknown) => void, ko: (e: unknown) => void) => { try { run(); ok(undefined) } catch (e) { ko(e) } } }
      },
    },
    profile: { findUnique: async () => ({ email: 'someone@example.com' }) },
    // The contact and CV reads (last block): the teacher's CURRENT private row, and the lead-signal ledger.
    teacherPrivate: { findUnique: async () => ({ phone: '+84 90 123 4567', email: 't@example.com', cvPath: 'cv/tp-1.pdf', cvFileName: 'cv.pdf' }) },
    contactReveal: { createMany: async () => ({ count: 1 }) },
  },
}))

const share = await import('../video-share/route')
const request = await import('../video-request/route')
const watch = await import('./route')
const contact = await import('../contact/route')
const cv = await import('../cv/route')
const { teacherVideoState } = await import('@/lib/teachers/share')

// The ask flags come from the row through the REAL derivation (share.ts teacherVideoState): video-request's "asked
// recently" IS the strip's `requested && !askAgain`, so its clock is exercised through the route, not re-mocked.
// ⚠️ No buyer account type anywhere on it: teacherThread no longer reads one (owner, 2026-10-13), so there is nothing a
// route could refuse a personal account on. The 4th argument of teacherVideoState is `now` (the real clock here).
const thread = (o: Row = {}): Row => {
  const vs = h.rows.get('c1') ?? null
  const v = teacherVideoState(vs as never, { videoOnRequest: true, private: { videoPath: 'tp/v.mp4' } }, true)
  return {
    convo: { id: 'c1', buyerProfileId: 'school-1', sellerProfileId: 'teacher-1', listingId: 'L1', sellerId: 's1', teacherVideoShare: vs },
    teacherProfileId: 'tp-1', teacherUserId: 'teacher-1', recruiterUserId: 'school-1',
    // The contact share (the contact and CV reads) — off unless a test turns it on.
    shared: false, shareOn: false, phoneShared: false,
    profileLive: true, privateVideoPath: 'tp/v.mp4', videoAvailable: true, videoShareOn: false, videoShared: false,
    videoRequested: v.requested, videoAskAgain: v.askAgain,
    ...o,
  }
}
/** The same thread opened by a parent — its buyer a personal account, which nothing on the thread records. */
const parentThread = (o: Row = {}): Row => thread({ convo: { ...thread().convo, buyerProfileId: 'parent-1' }, recruiterUserId: 'parent-1', ...o })
/** [status, error code] of a refusal — the code too, so a refusal can never be some other rule in disguise. */
const refusal = async (res: Response) => [res.status, ((await res.json()) as Row).error]
const post = (mod: { POST: (r: never, c: never) => Promise<Response> }, body: Row) =>
  mod.POST(new Request('https://eno.vn/api/x', { method: 'POST', body: JSON.stringify(body) }) as never, {} as never)
const get = () => watch.GET(new Request('https://eno.vn/api/teachers/video?conversationId=c1') as never, {} as never)

beforeEach(() => {
  h.me = { id: 'school-1', accountType: 'business' }
  // Rows first: thread() reads them, and a thread built over the previous test's rows would carry its grant.
  h.rows = new Map(); h.lines = []; h.rung = []
  h.thread = thread()
  h.suspended = false; h.blocked = false; h.failLine = false; h.signedPaths = []; h.mayWrite = true; h.guardRefuses = false; h.ran = []; h.asked = []
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
  it('⛔ "2 until reply" holds the ask (owner, 2026-10-13): the writer\'s two messages in and no answer → 429 teacher_awaiting_reply — no line, no request, no ring', async () => {
    h.mayWrite = false
    expect(await refusal(await post(request, { conversationId: 'c1' }))).toEqual([429, 'teacher_awaiting_reply'])
    expect(h.lines).toEqual([])
    expect(h.rows.get('c1')).toBeUndefined()
    expect(h.rung).toEqual([])
  })

  it('⛔ an ask racing a send past the check is stopped by the guard: 429 — and the request is not recorded either', async () => {
    h.guardRefuses = true
    expect(await refusal(await post(request, { conversationId: 'c1' }))).toEqual([429, 'teacher_awaiting_reply'])
    // The guard RAN — first in the line's batch — and aborted it before the request's write.
    expect(h.ran).toEqual(['guard'])
    expect(h.lines).toEqual([])
    expect(h.rows.get('c1')).toBeUndefined()
    expect(h.rung).toEqual([])
  })

  it('asks the rule and the guard about THIS thread, this writer and the teacher\'s profile id — the uuid the guard casts, never the TeacherProfile id', async () => {
    await post(request, { conversationId: 'c1' })
    const ids = { conversationId: 'c1', buyerProfileId: 'school-1', teacherProfileId: 'teacher-1' }
    expect(h.asked).toEqual([{ fn: 'mayWrite', ...ids }, { fn: 'guarded', ...ids }])
  })

  it('the guard runs first in the line\'s transaction, then the request is recorded', async () => {
    expect((await post(request, { conversationId: 'c1' })).status).toBe(200)
    expect(h.ran).toEqual(['guard', 'request'])
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
  it('asks again once a day has passed — exactly when the strip offers "Ask again" (askAgain)', async () => {
    const old = new Date(Date.now() - 25 * 3600_000)
    h.rows.set('c1', { requestedAt: old, sharedAt: null, revokedAt: null })
    h.thread = thread()
    expect(h.thread.videoAskAgain).toBe(true)
    expect((await post(request, { conversationId: 'c1' })).status).toBe(200)
    expect(h.lines).toHaveLength(1)
    expect(h.rows.get('c1')?.requestedAt.getTime()).toBeGreaterThan(old.getTime())
  })
  it('⛔ a personal account (a parent) asks like any school — its line, the request, the ring (owner, 2026-10-13)', async () => {
    for (const accountType of ['individual', null]) {
      h.rows = new Map(); h.lines = []; h.rung = []
      h.thread = parentThread()
      h.me = { id: 'parent-1', accountType }
      const res = await post(request, { conversationId: 'c1' })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true, requested: true, shared: false })
      expect(h.lines).toEqual([{ sender: 'parent-1', body: expect.stringContaining('Could you send your intro video?') }])
      expect(h.rows.get('c1')?.requestedAt).toBeInstanceOf(Date)
      expect(h.rows.get('c1')?.sharedAt).toBeNull() // …and, as for a school, the ask unlocks nothing
      expect(h.rung).toEqual([{ teacherProfileId: 'teacher-1', conversationId: 'c1', listingId: 'L1' }])
    }
  })
  it('refuses the teacher themself, a suspended account, a video kept public, and a block — each for its own reason', async () => {
    const ask = async () => refusal(await post(request, { conversationId: 'c1' }))
    h.me = { id: 'teacher-1', accountType: 'individual' }
    expect(await ask()).toEqual([404, 'not_found'])
    h.me = { id: 'school-1', accountType: 'individual' }
    h.suspended = true
    expect(await ask()).toEqual([403, 'account_suspended'])
    h.suspended = false; h.thread = thread({ videoAvailable: false })
    expect(await ask()).toEqual([409, 'video_not_on_request'])
    h.thread = thread(); h.blocked = true
    expect(await ask()).toEqual([403, 'blocked'])
    expect(h.lines).toEqual([])
    expect(h.rows.has('c1')).toBe(false)
    expect(h.rung).toEqual([])
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
  it('⛔ sends to a personal account (a parent) as to a school — the parent watches it, and Stop takes it back (owner, 2026-10-13)', async () => {
    h.thread = parentThread()
    let res = await post(share, { conversationId: 'c1', share: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, shared: true })
    expect(h.rows.get('c1')?.sharedAt).toBeInstanceOf(Date)
    expect(h.lines).toEqual([{ sender: 'teacher-1', body: expect.stringContaining('Sent my intro video') }])
    // The parent watches what was sent — the grant is the key, not the account type.
    h.me = { id: 'parent-1', accountType: 'individual' }
    h.thread = parentThread({ videoShareOn: true, videoShared: true })
    res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: h.signed, expiresIn: 600 })
    // …and the teacher's Stop takes it back from a parent as from a school.
    h.me = { id: 'teacher-1', accountType: 'individual' }
    expect((await post(share, { conversationId: 'c1', share: false })).status).toBe(200)
    expect(h.rows.get('c1')?.revokedAt).toBeInstanceOf(Date)
  })
  it('a send is refused only on the teacher\'s own state: a suspension first, then a hidden profile — whoever the buyer is', async () => {
    const send = async () => refusal(await post(share, { conversationId: 'c1', share: true }))
    h.suspended = true; h.thread = parentThread({ profileLive: false, videoAvailable: false })
    expect(await send()).toEqual([403, 'account_suspended'])
    h.suspended = false
    expect(await send()).toEqual([409, 'profile_hidden'])
    expect(h.rows.has('c1')).toBe(false)
    expect(h.lines).toEqual([])
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
  it('⛔ any account the teacher sent it to watches — a personal one as much as a business (owner, 2026-10-13)', async () => {
    h.thread = thread({ videoShareOn: true, videoShared: true })
    for (const accountType of ['individual', null, 'business']) {
      h.me = { id: 'school-1', accountType }
      const res = await get()
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ url: h.signed, expiresIn: 600 })
    }
    expect(h.signedPaths).toEqual(['tp/v.mp4', 'tp/v.mp4', 'tp/v.mp4'])
  })
  it('refuses before a share, to anyone but the thread\'s buyer, to a suspended account, across a block', async () => {
    const watchIt = async () => refusal(await get())
    h.me = { id: 'school-1', accountType: 'individual' }
    expect(await watchIt()).toEqual([403, 'share_required'])
    h.thread = thread({ videoShareOn: true, videoShared: true })
    h.me = { id: 'other-school', accountType: 'business' }
    expect(await watchIt()).toEqual([404, 'not_found'])
    h.me = { id: 'school-1', accountType: 'individual' }; h.suspended = true
    expect(await watchIt()).toEqual([403, 'account_suspended'])
    h.suspended = false; h.blocked = true
    expect(await watchIt()).toEqual([403, 'blocked'])
    expect(h.signedPaths).toEqual([])
  })
  it('a profile not live, or a video no longer kept on request, refuses with ITS reason — never "stopped sharing"', async () => {
    h.thread = thread({ videoShareOn: true, videoShared: false, videoAvailable: false, profileLive: false })
    let res = await get()
    expect(res.status).toBe(409)
    expect(((await res.json()) as Row).error).toBe('profile_hidden')
    h.thread = thread({ videoShareOn: true, videoShared: false, videoAvailable: false, profileLive: true })
    res = await get()
    expect(((await res.json()) as Row).error).toBe('video_not_on_request')
  })
  it('⛔ a school the teacher blocked learns nothing about the profile: `blocked` before any state reason', async () => {
    h.blocked = true
    for (const o of [
      { videoShareOn: true, videoShared: false, videoAvailable: false, profileLive: false }, // hidden — was `profile_hidden`
      { videoShareOn: true, videoShared: false, videoAvailable: false, profileLive: true }, // was `video_not_on_request`
      {}, // never sent — was `share_required`
    ]) {
      h.thread = thread(o)
      const res = await get()
      expect(res.status).toBe(403)
      expect(((await res.json()) as Row).error).toBe('blocked')
    }
    expect(h.signedPaths).toEqual([])
  })
  it('says the store failed rather than handing out nothing', async () => {
    h.thread = thread({ videoShared: true }); h.signed = null
    expect((await get()).status).toBe(502)
  })
})

describe('the state the strip re-reads on a 🎬 line', () => {
  const state = () => share.GET(new Request('https://eno.vn/api/teachers/video-share?conversationId=c1') as never, {} as never)
  it('answers both parties with flags only, never cached — a personal buyer the same as a business one', async () => {
    h.thread = thread({ videoShareOn: true, videoShared: true, videoRequested: true })
    for (const me of [{ id: 'school-1', accountType: 'business' }, { id: 'school-1', accountType: 'individual' }, { id: 'teacher-1', accountType: 'individual' }]) {
      h.me = me
      const res = await state()
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('private, no-store')
      expect(await res.json()).toEqual({ available: true, shareOn: true, shared: true, requested: true, askAgain: false })
    }
  })
  it('carries `askAgain` — and no `forBusiness` any more (owner, 2026-10-13): the strip offers nothing a route then refuses', async () => {
    h.me = { id: 'teacher-1', accountType: 'individual' }
    h.thread = thread({ videoRequested: true, videoAskAgain: true })
    // toEqual: the exact flag set — a `forBusiness` riding along again would fail here.
    expect(await (await state()).json()).toEqual({ available: true, shareOn: false, shared: false, requested: true, askAgain: true })
  })
  it('anyone else: the thread does not exist', async () => {
    h.me = { id: 'other-school', accountType: 'business' }
    expect((await state()).status).toBe(404)
  })
  it('⛔ a thread closed by a block tells the school nothing; the teacher keeps the flags to withdraw a standing share', async () => {
    h.blocked = true
    h.rows.set('c1', { requestedAt: null, sharedAt: new Date(), revokedAt: null })
    h.thread = thread({ videoShareOn: true, videoShared: true })
    const asSchool = await state()
    expect(asSchool.status).toBe(403)
    expect(await asSchool.json()).toEqual({ error: 'blocked' }) // no flag rides along
    h.me = { id: 'teacher-1', accountType: 'individual' }
    const asTeacher = await state()
    expect(asTeacher.status).toBe(200)
    expect(((await asTeacher.json()) as Row).shareOn).toBe(true)
    // …and Stop still takes it back across the block.
    expect((await post(share, { conversationId: 'c1', share: false })).status).toBe(200)
    expect(h.rows.get('c1')?.revokedAt).toBeInstanceOf(Date)
  })
})

// The contact and CV reads carried the same `business_only` 403 until 2026-10-13, and no test held a personal account
// against them — so its removal is pinned here, beside the video's. (route.blocked / route.phone cover the block and
// the phone rule.)
describe('the phone, email and CV — the same key for any account (owner, 2026-10-13)', () => {
  const read = (mod: { GET: (r: never, c: never) => Promise<Response> }, path: string) =>
    mod.GET(new Request(`https://eno.vn/api/teachers/${path}?conversationId=c1`) as never, {} as never)
  it('⛔ a personal account the teacher shared with reads them — as a school does', async () => {
    h.thread = parentThread({ shared: true, shareOn: true, phoneShared: true })
    for (const accountType of ['individual', null]) {
      h.me = { id: 'parent-1', accountType }
      const res = await read(contact, 'contact')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ phone: '+84 90 123 4567', email: 't@example.com', hasCv: true })
      const file = await read(cv, 'cv')
      expect(file.status).toBe(302)
      expect(file.headers.get('location')).toBe(h.cvUrl)
      expect(file.headers.get('cache-control')).toBe('private, no-store')
    }
  })
  it('the teacher\'s share stays the only key: refused before it, to anyone but the thread\'s buyer, a suspended account, across a block', async () => {
    for (const [mod, path] of [[contact, 'contact'], [cv, 'cv']] as const) {
      const readIt = async () => refusal(await read(mod, path))
      h.suspended = false; h.blocked = false
      h.thread = parentThread()
      h.me = { id: 'parent-1', accountType: 'individual' }
      expect(await readIt()).toEqual([403, 'share_required'])
      h.thread = parentThread({ shared: true, shareOn: true, phoneShared: true })
      h.me = { id: 'school-1', accountType: 'business' } // a school that is not this thread's buyer
      expect(await readIt()).toEqual([404, 'not_found'])
      h.me = { id: 'parent-1', accountType: 'individual' }; h.suspended = true
      expect(await readIt()).toEqual([403, 'account_suspended'])
      h.suspended = false; h.blocked = true
      expect(await readIt()).toEqual([403, 'blocked'])
    }
  })
})

