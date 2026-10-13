import { beforeEach, describe, expect, it, vi } from 'vitest'

// The teacher message email cron (2026-10-12). The rule itself is pinned in src/lib/teachers/message-emails.test.ts;
// this pins the SEND discipline around it — the teacher-match-emails contract: cron auth; a dry run that claims and sends
// nothing; a claim before every send; the RFC 8058 one-click headers and the list's own unsubscribe link; one idempotency
// key per claim; 'refused' releases the claim, 'unknown' is retried once and then KEEPS it; no address, no token or a lost
// claim → no send. Resend and the database are faked — nothing reaches the network, a database or an inbox.
type Once = { outcome: 'sent' | 'refused' | 'unknown'; stopRun: boolean; name: string | null; retryAfterMs: number | null }
const h = vi.hoisted(() => ({
  plan: [] as { teacherProfileId: string; due: { conversationId: string; stage: 1 | 2 | 3; prev: null; anchor: Date }[]; threadIds: string[]; hadState: boolean; prevLastEmailAt: Date | null }[],
  teachers: [] as { profileId: string; fullName: string; private: { email: string | null } | null; profile: { email: string | null } }[],
  claimOk: true,
  claimThrowsFor: null as string | null,
  noToken: false,
  releaseThrows: false,
  claims: [] as string[],
  releases: [] as string[],
  sends: [] as { msg: { to: string; subject: string; headers: Record<string, string> }; opts: { idempotencyKey: string; afterUnknown?: boolean } }[],
  answers: [] as Once[],
  mailOn: true,
  /** The quiet hours, pinned per test — the real clock would make this suite depend on the time of day. */
  quiet: false,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/unsubscribe-token', () => ({ mintUnsubscribeToken: (id: string) => (h.noToken ? null : `signed-${id}`) }))
vi.mock('@/lib/mail', () => ({
  mailEnabled: () => h.mailOn,
  sendMailOnce: async (msg: never, opts: never) => {
    h.sends.push({ msg, opts })
    return h.answers.shift() ?? { outcome: 'sent', stopRun: false, name: null, retryAfterMs: null }
  },
}))
vi.mock('@/lib/db', () => ({
  db: {
    teacherMessageEmailState: { findMany: async () => [] },
    teacherMessageEmailThread: { findMany: async () => [] },
    teacherProfile: { findMany: async () => h.teachers },
  },
}))
vi.mock('@/lib/teachers/message-emails', async (orig) => {
  const real = await orig<typeof import('@/lib/teachers/message-emails')>()
  return {
  ...real,
  // A small ceiling, so the cap is testable: two sends per run here (200 in production).
  MESSAGE_EMAIL_RULES: { ...real.MESSAGE_EMAIL_RULES, maxSendsPerRun: 2 },
  loadUnreadTeacherThreads: async () => h.plan.flatMap((p) => p.threadIds.map((conversationId) => ({ conversationId, teacherProfileId: p.teacherProfileId, unread: 1, window: [] }))),
  loadEmailsLast24h: async () => new Map(),
  quietSoon: () => h.quiet,
  planMessageEmails: () => h.plan,
  // The claim as production builds it: per-stage counts FROM THE DUE THREADS (codex, gate round 1: a plan-level stage let
  // the test pass an impossible mixed plan).
  claimMessageEmail: async (_db: unknown, e: { teacherProfileId: string; threadIds: string[]; due: { stage: 1 | 2 | 3 }[] }) => {
    h.claims.push(e.teacherProfileId)
    if (h.claimThrowsFor === e.teacherProfileId) throw new Error('transaction timeout')
    const counts = { 1: 0, 2: 0, 3: 0 }
    for (const d of e.due) counts[d.stage]++
    return h.claimOk ? { counts, unreadThreads: e.threadIds.length, applied: e.due } : null
  },
  releaseMessageEmail: async (_db: unknown, e: { teacherProfileId: string }) => {
    h.releases.push(e.teacherProfileId)
    if (h.releaseThrows) throw new Error('db down')
  },
  }
})

// The marketplace edition — the only one that sends (the services edition answers `marketplace_only`).
vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
const { GET } = await import('./route')
const req = (qs = '', auth: string | null = 'Bearer cron-secret') =>
  new Request(`https://eno.vn/api/cron/teacher-message-emails${qs}`, { headers: auth ? { authorization: auth } : {} })
const due = (conversationId: string, stage: 1 | 2 | 3 = 1) => ({ conversationId, stage, prev: null, anchor: new Date() })
const one = (o: Partial<(typeof h.plan)[number]> = {}) => ({
  teacherProfileId: 'p1', threadIds: ['c1'], due: [due('c1')], hadState: false, prevLastEmailAt: null, ...o,
})

beforeEach(() => {
  h.quiet = false
  process.env.CRON_SECRET = 'cron-secret'
  h.plan = [one()]
  // The account's current address wins over the copy the profile save took (Opus, gate).
  h.teachers = [{ profileId: 'p1', fullName: 'Jane Doe', private: { email: 'stale@example.com' }, profile: { email: 'jane@example.com' } }]
  h.claimOk = true; h.claimThrowsFor = null; h.noToken = false; h.releaseThrows = false; h.claims = []; h.releases = []; h.sends = []; h.answers = []; h.mailOn = true
})

describe('GET /api/cron/teacher-message-emails', () => {
  it('needs the cron secret', async () => {
    for (const a of [null, 'Bearer nope']) expect((await GET(req('', a) as never)).status).toBe(401)
  })

  it('⛔ a dry run counts what it would send — and claims and sends nothing', async () => {
    h.plan = [one(), one({ teacherProfileId: 'p2', threadIds: ['c2', 'c3'], due: [due('c2', 3), due('c3', 1)] })]
    const res = await GET(req('?dryRun=1') as never)
    const body = await res.json()
    // Threads per stage, and whether the run fell in the quiet hours.
    expect(body).toMatchObject({ ok: true, dryRun: true, teachers: 2, first: 2, second: 0, third: 1, tokens: true })
    expect(typeof body.quiet).toBe('boolean')
    expect(h.claims).toEqual([])
    expect(h.sends).toEqual([])
  })

  it('⛔ claims, then sends to the account’s current address with the one-click headers and one key per claim', async () => {
    const res = await GET(req() as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, teachers: 1, sent: 1, failed: 0, unknown: 0, skipped: 0 })
    expect(h.claims).toEqual(['p1'])
    const { msg, opts } = h.sends[0]
    expect(msg.to).toBe('jane@example.com')
    expect(msg.subject).toBe('You have a new message about your teacher profile on eno.vn')
    expect(msg.headers['List-Unsubscribe']).toBe('<https://eno.vn/api/unsubscribe?token=signed-p1&list=teacher-messages>')
    expect(msg.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    expect(opts.idempotencyKey).toMatch(/^teacher-messages\/p1\/\d{13}$/)
  })

  it('a run-wide refusal releases its claim, fails the unit and ends the run', async () => {
    h.answers = [{ outcome: 'refused', stopRun: true, name: 'daily_quota_exceeded', retryAfterMs: null }]
    h.plan = [one(), one({ teacherProfileId: 'p2' })]
    const res = await GET(req() as never)
    expect(res.status).toBe(500)
    expect(h.releases).toEqual(['p1'])
    expect(h.sends).toHaveLength(1)
  })

  it('⛔ a refusal of THIS message PARKS the claim — never retried every 30 min — and fails the unit (Opus, gate)', async () => {
    h.answers = [{ outcome: 'refused', stopRun: false, name: 'validation_error', retryAfterMs: null }]
    const res = await GET(req() as never)
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ ok: false, invalid: 1, failed: 0, sent: 0 })
    expect(h.releases).toEqual([])
  })

  it('a rate limit that outlasts its one retry releases the claim and ENDS the run (Opus, gate round 5)', async () => {
    const rl = { outcome: 'refused' as const, stopRun: false, name: 'rate_limit_exceeded', retryAfterMs: 10 }
    h.answers = [rl, rl]
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const p = GET(req() as never)
    await vi.runAllTimersAsync()
    const res = await p
    vi.useRealTimers()
    expect(res.status).toBe(500)
    expect(h.releases).toEqual(['p1'])
    expect(await res.json()).toMatchObject({ stopped: 'rate_limit_exceeded' })
  })

  it('⛔ a run-wide refusal stops the run even when its release throws — never sends into an exhausted quota', async () => {
    h.answers = [{ outcome: 'refused', stopRun: true, name: 'daily_quota_exceeded', retryAfterMs: null }]
    h.plan = [one(), one({ teacherProfileId: 'p2' })]
    h.releaseThrows = true
    const res = await GET(req() as never)
    expect(res.status).toBe(500)
    expect(h.sends).toHaveLength(1)
  })

  it('⛔ three refusals of "this message" in a row are the email itself: stop, release the third (the two before stay parked)', async () => {
    const bad = { outcome: 'refused' as const, stopRun: false, name: 'validation_error', retryAfterMs: null }
    h.answers = [bad, bad, bad]
    h.plan = [one(), one({ teacherProfileId: 'p2' }), one({ teacherProfileId: 'p3' })]
    h.teachers.push(
      { profileId: 'p2', fullName: 'Ann', private: null, profile: { email: 'ann@example.com' } },
      { profileId: 'p3', fullName: 'Bo', private: null, profile: { email: 'bo@example.com' } },
    )
    const res = await GET(req() as never)
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ invalid: 3, stopped: 'refused_systemic' })
    expect(h.releases).toEqual(['p3'])
  })

  it('⛔ a missing unsubscribe secret is a FAILURE, not a quiet skip — the run must not go green sending nothing', async () => {
    h.noToken = true
    const res = await GET(req() as never)
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ failed: 1, sent: 0 })
    expect(h.claims).toEqual([])
  })

  it('⛔ once an attempt was unclear, a later refusal never releases the claim (Opus, gate round 3)', async () => {
    h.answers = [{ outcome: 'unknown', stopRun: false, name: 'timeout', retryAfterMs: null }, { outcome: 'refused', stopRun: false, name: 'rate_limit_exceeded', retryAfterMs: null }]
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const p = GET(req() as never)
    await vi.runAllTimersAsync()
    const res = await p
    vi.useRealTimers()
    expect(await res.json()).toMatchObject({ unknown: 1, failed: 0, sent: 0 })
    expect(h.releases).toEqual([])
  })

  it('⛔ an unclear send is retried once with the same key, then the claim is KEPT — never a second email', async () => {
    h.answers = [{ outcome: 'unknown', stopRun: false, name: 'timeout', retryAfterMs: null }, { outcome: 'unknown', stopRun: false, name: 'timeout', retryAfterMs: null }]
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const p = GET(req() as never)
    await vi.runAllTimersAsync()
    const res = await p
    vi.useRealTimers()
    expect(await res.json()).toMatchObject({ sent: 0, unknown: 1, failed: 0 })
    expect(h.sends.map((s) => s.opts)).toEqual([
      { idempotencyKey: h.sends[0].opts.idempotencyKey },
      { idempotencyKey: h.sends[0].opts.idempotencyKey, afterUnknown: true },
    ])
    expect(h.releases).toEqual([])
  })

  it('no address → skipped, never claimed; a lost claim → never sent', async () => {
    h.teachers = [{ profileId: 'p1', fullName: 'Jane', private: null, profile: { email: null } }]
    expect(await (await GET(req() as never)).json()).toMatchObject({ skipped: 1, sent: 0 })
    expect(h.claims).toEqual([])
    h.teachers = [{ profileId: 'p1', fullName: 'Jane', private: null, profile: { email: 'jane@example.com' } }]
    h.claimOk = false
    expect(await (await GET(req() as never)).json()).toMatchObject({ skipped: 1, sent: 0 })
    expect(h.sends).toEqual([])
  })

  it('⛔ one teacher’s error never stops the run: counted failed, the next teacher is still emailed (Opus, gate round 4)', async () => {
    h.plan = [one(), one({ teacherProfileId: 'p2' })]
    h.teachers.push({ profileId: 'p2', fullName: 'Ann', private: null, profile: { email: 'ann@example.com' } })
    h.claimThrowsFor = 'p1'
    const res = await GET(req() as never)
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ failed: 1, sent: 1 })
    expect(h.sends.map((s) => s.msg.to)).toEqual(['ann@example.com'])
  })

  it('⛔ at most maxSendsPerRun sends a run — a planned pause, not a failure: the next run carries on', async () => {
    h.plan = [one(), one({ teacherProfileId: 'p2' }), one({ teacherProfileId: 'p3' })]
    h.teachers.push(
      { profileId: 'p2', fullName: 'Ann', private: null, profile: { email: 'ann@example.com' } },
      { profileId: 'p3', fullName: 'Bo', private: null, profile: { email: 'bo@example.com' } },
    )
    const res = await GET(req() as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, sent: 2, stopped: 'ceiling', left: 1 })
    expect(h.claims).toEqual(['p1', 'p2'])
  })

  it('mail switched off → nothing happens (the dry run still answers)', async () => {
    h.mailOn = false
    expect(await (await GET(req() as never)).json()).toEqual({ ok: true, mail: 'disabled' })
    expect(h.claims).toEqual([])
  })

  it('the answer stays under 200 bytes', async () => {
    h.answers = [{ outcome: 'refused', stopRun: true, name: 'daily_quota_exceeded_and_a_very_long_name_indeed', retryAfterMs: null }]
    h.plan = [one(), one({ teacherProfileId: 'p2' })]
    const body = await (await GET(req() as never)).text()
    expect(Buffer.byteLength(body)).toBeLessThan(200)
  })
})

describe('the quiet hours begin mid-run (codex, gate round 2)', () => {
  it('⛔ stops before the next claim — a planned pause: 200, nothing claimed or sent, the rest left for the morning', async () => {
    h.plan = [one(), one({ teacherProfileId: 'p2' })]
    h.quiet = true
    const res = await GET(req() as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, sent: 0, stopped: 'quiet', left: 2 })
    expect(h.claims).toEqual([])
    expect(h.sends).toEqual([])
  })
})
