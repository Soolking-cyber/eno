import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The teacher job-match email cron (the /teachers skill starts its unit after the owner approves a plan). What this pins
// is the never-twice contract: rows are CLAIMED before the send, under consent; the send carries an idempotency key made
// of the teacher and the claimed match ids; 'sent' keeps the claim, 'refused' releases it (and a stopping refusal ends
// the run), 'unknown' is retried once with the same key and then KEEPS the claim. Plus: every email names its sender and
// carries the one-click unsubscribe, the answer stays under 200 bytes, and the run is paced. Resend is mocked — nothing
// here reaches the network, a database or an inbox.
type Once = { outcome: 'sent' | 'refused' | 'unknown'; stopRun: boolean; name: string | null; retryAfterMs: number | null }
type Msg = { to: string; subject: string; html: string; text: string; headers: Record<string, string> }
type ClaimWhere = {
  id: { in: string[] }; emailedAt: Date | null; listing?: { status?: string }
  teacherProfile?: { matchEmailOptIn?: boolean; matchEmailOptInAt?: Date; listing?: { status?: string } }
}
type Row = {
  id: string; score: number; reasons: unknown; createdAt: Date; teacherProfileId: string
  teacherProfile: { matchEmailOptInAt: Date | null }
  listing: { id: string; title: string; city: string; affiliateUrl: string | null; attributes: string | null }
}
const h = vi.hoisted(() => ({
  pending: [] as Row[],
  cooling: [] as { teacherProfileId: string }[],
  teachers: [] as { id: string; fullName: string; profileId: string; private: { email: string | null } | null; profile: { email: string | null } }[],
  emailed: new Map<string, Date | null>(),
  claimWheres: [] as Record<string, unknown>[],
  releases: [] as string[][],
  sends: [] as { msg: Msg; opts: { idempotencyKey: string; afterUnknown?: boolean } }[],
  answers: [] as Once[],
  teacherWhere: null as unknown,
  consentGone: new Set<string>(),
  /** the consent grant the database holds NOW, per teacher (default: the one the plan read — CONSENT below) */
  grants: new Map<string, Date>(),
  /** jobs pulled (sold, unverified, re-categorised) and teachers whose own listing was pulled, since the read */
  jobGone: new Set<string>(),
  profileGone: new Set<string>(),
  mailOn: true,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/unsubscribe-token', () => ({ mintUnsubscribeToken: (id: string) => `signed-${id}` }))
vi.mock('@/lib/mail', () => ({
  mailEnabled: () => h.mailOn,
  sendMailOnce: async (msg: Msg, opts: { idempotencyKey: string; afterUnknown?: boolean }) => {
    h.sends.push({ msg, opts })
    return h.answers.shift() ?? { outcome: 'sent', stopRun: false, name: null, retryAfterMs: null }
  },
}))
vi.mock('@/lib/db', () => ({
  db: {
    teacherJobMatch: {
      findMany: async (args: { distinct?: unknown }) => (args.distinct ? h.cooling : h.pending),
      // The claim flips emailedAt from null — only for rows the where still matches, as the database would read it: the
      // consent switch, the grant the claim names, the job and the teacher's own listing. The release puts back exactly
      // the rows this run claimed.
      updateMany: async ({ where, data }: { where: ClaimWhere; data: { emailedAt: Date | null } }) => {
        let count = 0
        if (data.emailedAt) {
          h.claimWheres.push(where as unknown as Record<string, unknown>)
          const tp = where.teacherProfile
          for (const id of where.id.in) {
            const r = h.pending.find((p) => p.id === id)
            if (!r || h.emailed.get(id) != null) continue
            const t = r.teacherProfileId
            if (tp?.matchEmailOptIn && h.consentGone.has(t)) continue
            if (tp?.matchEmailOptInAt && tp.matchEmailOptInAt.getTime() !== (h.grants.get(t) ?? CONSENT).getTime()) continue
            if (tp?.listing?.status === 'active' && h.profileGone.has(t)) continue
            if (where.listing?.status === 'active' && h.jobGone.has(r.listing.id)) continue
            h.emailed.set(id, data.emailedAt); count++
          }
        } else {
          h.releases.push([...where.id.in])
          for (const id of where.id.in) if (h.emailed.get(id)?.getTime() === where.emailedAt?.getTime()) { h.emailed.set(id, null); count++ }
        }
        return { count }
      },
    },
    teacherProfile: { findMany: async (args: { where: unknown }) => { h.teacherWhere = args.where; return h.teachers } },
  },
}))

vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
const { GET } = await import('./route')
const { SITE_NAME } = await import('@/lib/edition')
const { COMPANY } = await import('@/lib/site-legal')
const { AI_NOTICE_VERSION } = await import('@/lib/teachers/profile')
const { MAILABLE_TEACHER_WHERE, mailableMatchWhere } = await import('@/lib/teachers/match-emails')
const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || `https://${SITE_NAME}`
const req = (auth: string | null = 'Bearer cron-secret') =>
  new Request('https://eno.vn/api/cron/teacher-match-emails', { headers: auth ? { authorization: auth } : {} })

// The grant every planned row carries (the mocks above read it only when the route runs, after this line).
const CONSENT = new Date('2026-10-09T00:00:00Z')
const match = (teacher: string, i: number, o: Partial<Row['listing']> = {}): Row => ({
  id: `${teacher}-m${i}`, score: 90 - i, reasons: ['IELTS trainer'], createdAt: new Date('2026-10-11T00:00:00Z'), teacherProfileId: teacher,
  teacherProfile: { matchEmailOptInAt: CONSENT },
  listing: { id: `${teacher}-l${i}`, title: `IELTS Instructor ${i}`, city: 'Hà Nội', affiliateUrl: null, attributes: null, ...o },
})
const teacher = (id: string) => ({ id, fullName: `Teacher ${id}`, profileId: `p-${id}`, private: { email: `${id}@example.com` }, profile: { email: null } })
/** The run under test starts at 2026-10-12T03:00:00Z (run() below) — the key is that run's. */
const RUN = Date.parse('2026-10-12T03:00:00Z')
const keyOf = (teacherId: string, ids: string[], run = RUN) => `teacher-matches/${run}/${teacherId}/${createHash('sha256').update([...ids].sort().join(',')).digest('hex')}`
const answer = (outcome: Once['outcome'], name: string | null = null, stopRun = false, retryAfterMs: number | null = null): Once => ({ outcome, stopRun, name, retryAfterMs })

/** Run the route with fake timers, so the 150 ms gaps and the 5 s retry pass instantly. */
async function run(r = req()) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
  vi.setSystemTime(new Date('2026-10-12T03:00:00Z'))
  const p = GET(r)
  await vi.runAllTimersAsync()
  const res = await p
  vi.useRealTimers()
  return res
}

let errors: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  process.env.CRON_SECRET = 'cron-secret'
  Object.assign(h, {
    pending: [], cooling: [], teachers: [], emailed: new Map(), claimWheres: [], releases: [], sends: [], answers: [],
    teacherWhere: null, consentGone: new Set(), grants: new Map(), jobGone: new Set(), profileGone: new Set(), mailOn: true,
  })
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers(); errors.mockRestore() })

describe('GET /api/cron/teacher-match-emails', () => {
  it('refuses without the cron bearer and sends nothing', async () => {
    for (const a of [null, 'Bearer nope']) expect((await GET(req(a))).status).toBe(401)
    expect(h.sends).toHaveLength(0)
  })

  it('without RESEND_API_KEY: a legible no-op, nothing claimed', async () => {
    h.mailOn = false
    h.pending = [match('t1', 0)]
    const res = await run()
    expect(await res.json()).toEqual({ ok: true, mail: 'disabled' })
    expect(h.claimWheres).toHaveLength(0)
  })

  it('one email per teacher: claimed under consent BEFORE the send, keyed by the claimed ids, named sender, one-click unsubscribe', async () => {
    h.pending = [match('t1', 0), match('t1', 1), match('t2', 0)]
    h.teachers = [teacher('t1'), teacher('t2')]
    const res = await run()
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body.length).toBeLessThan(200) // eno-cron.sh prints only the first 200 bytes
    expect(JSON.parse(body)).toEqual({ ok: true, rules: 'teacher-match-emails/v2', teachers: 2, sent: 2, failed: 0, unknown: 0, skipped: 0 })
    // Consent re-read for the addresses, and checked again atomically by the claim.
    expect(h.teacherWhere).toMatchObject({ matchEmailOptIn: true, matchEmailNoticeVersion: AI_NOTICE_VERSION, status: 'live' })
    expect(h.teacherWhere).toMatchObject(MAILABLE_TEACHER_WHERE)
    expect(h.claimWheres[0]).toMatchObject({ emailedAt: null, teacherProfile: { matchEmailOptIn: true, matchEmailNoticeVersion: AI_NOTICE_VERSION } })
    // ⛔ The claim IS the selection, re-read atomically — plus the consent grant the plan saw (gate review, 2026-10-08).
    expect(h.claimWheres[0]).toEqual({
      ...mailableMatchWhere(Date.parse('2026-10-12T03:00:00Z'), { ...MAILABLE_TEACHER_WHERE, matchEmailOptInAt: CONSENT }),
      id: { in: ['t1-m0', 't1-m1'] },
    })
    expect(h.sends.map((s) => s.opts.idempotencyKey)).toEqual([keyOf('t1', ['t1-m0', 't1-m1']), keyOf('t2', ['t2-m0'])])
    expect(h.sends.every((s) => !s.opts.afterUnknown)).toBe(true)
    // Claimed, and the claim kept.
    expect([...h.emailed.values()].every(Boolean)).toBe(true)
    expect(h.releases).toHaveLength(0)
    const m = h.sends[0].msg
    expect(m.to).toBe('t1@example.com')
    expect(m.headers['List-Unsubscribe']).toBe(`<${ORIGIN}/api/unsubscribe?token=signed-p-t1&list=teacher-matches>`)
    expect(m.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    // ⛔ The sender named in full (legal name + registered head office), in the HTML and in the text part.
    for (const part of [m.html, m.text]) expect(part).toContain(COMPANY.address)
    expect(m.html).toContain(`${ORIGIN}/unsubscribe?token=signed-p-t1&amp;list=teacher-matches`)
    expect(m.text).toContain(`${ORIGIN}/unsubscribe?token=signed-p-t1&list=teacher-matches`)
    expect(m.html).toContain(COMPANY.name)
    expect(m.text).toContain(`${COMPANY.name} (${COMPANY.nameEn})`)
    expect(m.html + m.text).not.toMatch(/visa/i)
  })

  it('refused: the claim is released for a later run, the run goes on, and the answer is a 500', async () => {
    h.pending = [match('t1', 0), match('t2', 0)]
    h.teachers = [teacher('t1'), teacher('t2')]
    h.answers = [answer('refused', 'validation_error')]
    const res = await run()
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ ok: false, sent: 1, failed: 1, unknown: 0 })
    expect(h.releases).toEqual([['t1-m0']])
    expect(h.emailed.get('t1-m0')).toBeNull()
    expect(h.emailed.get('t2-m0')).toBeInstanceOf(Date)
  })

  it('a 429 waits as Resend asks and is retried once under the SAME key; a second refusal releases', async () => {
    h.pending = [match('t1', 0), match('t2', 0)]
    h.teachers = [teacher('t1'), teacher('t2')]
    h.answers = [answer('refused', 'rate_limit_exceeded', false, 2000), answer('sent'), answer('refused', 'rate_limit_exceeded'), answer('refused', 'rate_limit_exceeded')]
    const res = await run()
    expect(await res.json()).toMatchObject({ sent: 1, failed: 1 })
    expect(h.sends.map((s) => s.opts.idempotencyKey)).toEqual([keyOf('t1', ['t1-m0']), keyOf('t1', ['t1-m0']), keyOf('t2', ['t2-m0']), keyOf('t2', ['t2-m0'])])
    expect(h.sends.every((s) => !s.opts.afterUnknown)).toBe(true)
    expect(h.releases).toEqual([['t2-m0']])
  })

  it('a stopping refusal (quota, key) ends the run there: nothing after it is claimed or sent', async () => {
    h.pending = [match('t1', 0), match('t2', 0), match('t3', 0)]
    h.teachers = [teacher('t1'), teacher('t2'), teacher('t3')]
    h.answers = [answer('sent'), answer('refused', 'daily_quota_exceeded', true)]
    const res = await run()
    expect(res.status).toBe(500)
    const body = await res.text()
    expect(body.length).toBeLessThan(200)
    expect(JSON.parse(body)).toEqual({ ok: false, rules: 'teacher-match-emails/v2', teachers: 3, sent: 1, failed: 1, unknown: 0, skipped: 0, stopped: 'daily_quota_exceeded', left: 1 })
    expect(h.sends).toHaveLength(2)
    expect(h.emailed.has('t3-m0')).toBe(false)
    expect(h.emailed.get('t2-m0')).toBeNull()
  })

  it('⛔ unknown: retried ONCE after the pause with the same key and afterUnknown — and then the claim is KEPT', async () => {
    h.pending = [match('t1', 0), match('t1', 1)]
    h.teachers = [teacher('t1')]
    h.answers = [answer('unknown', 'application_error'), answer('unknown', 'concurrent_idempotent_requests')]
    const res = await run()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: false, sent: 0, failed: 0, unknown: 1 })
    expect(h.sends.map((s) => [s.opts.idempotencyKey, !!s.opts.afterUnknown])).toEqual([[keyOf('t1', ['t1-m0', 't1-m1']), false], [keyOf('t1', ['t1-m0', 't1-m1']), true]])
    expect(h.releases).toHaveLength(0)
    expect(h.emailed.get('t1-m0')).toBeInstanceOf(Date)
    // Logged with the ids for a look in Resend — never the address.
    const logged = errors.mock.calls.flat().map((x) => JSON.stringify(x)).join(' ')
    expect(logged).toContain('t1-m0')
    expect(logged).not.toContain('t1@example.com')
  })

  it('unknown, then sent on the retry: one email, counted sent', async () => {
    h.pending = [match('t1', 0)]
    h.teachers = [teacher('t1')]
    h.answers = [answer('unknown', 'network'), answer('sent')]
    expect(await (await run()).json()).toMatchObject({ ok: true, sent: 1, unknown: 0 })
  })

  it('a claim that does not take every row (another run, or the consent went) releases its part and skips', async () => {
    h.pending = [match('t1', 0), match('t1', 1), match('t2', 0)]
    h.teachers = [teacher('t1'), teacher('t2')]
    h.emailed.set('t1-m1', new Date('2026-10-12T02:59:00Z')) // another run got one of them
    h.consentGone.add('t2') // switched off between the read and the claim
    const res = await run()
    expect(await res.json()).toMatchObject({ sent: 0, skipped: 2 })
    expect(h.sends).toHaveLength(0)
    expect(h.emailed.get('t1-m0')).toBeNull()
    expect(h.emailed.get('t1-m1')).toEqual(new Date('2026-10-12T02:59:00Z'))
  })

  it('⛔ a consent withdrawn and given again between the read and the claim: nothing claimed, nothing sent', async () => {
    // The plan read the 10-09 grant; the teacher switched off and on at 02:59 — the rule mails only matches judged after
    // the CURRENT grant, so these rows (judged 10-11, before it) must not go out on the new consent.
    h.pending = [match('t1', 0), match('t2', 0)]
    h.teachers = [teacher('t1'), teacher('t2')]
    h.grants.set('t1', new Date('2026-10-12T02:59:00Z'))
    expect(await (await run()).json()).toMatchObject({ sent: 1, skipped: 1 })
    expect(h.sends.map((s) => s.msg.to)).toEqual(['t2@example.com'])
    expect(h.emailed.get('t1-m0')).toBeUndefined()
  })

  it('⛔ a job pulled mid-run, or the teacher’s own listing: claims less than planned — released, skipped, not mailed', async () => {
    h.pending = [match('t1', 0), match('t1', 1), match('t2', 0), match('t3', 0)]
    h.teachers = [teacher('t1'), teacher('t2'), teacher('t3')]
    h.jobGone.add('t1-l1') // one of t1's two jobs was sold or unverified since the read
    h.profileGone.add('t2') // moderation pulled t2's profile listing since the read
    const res = await run()
    expect(await res.json()).toMatchObject({ sent: 1, skipped: 2 })
    expect(h.sends.map((s) => s.msg.to)).toEqual(['t3@example.com'])
    // t1's job that WAS still live went back unclaimed — nobody got a partial email.
    expect(h.emailed.get('t1-m0')).toBeNull()
    expect(h.emailed.has('t1-m1')).toBe(false)
  })

  it('the cooldown is read first and handed to the selection (the read leaves those teachers out before its cap)', async () => {
    const src = readFileSync(join(__dirname, 'route.ts'), 'utf8')
    expect(src).toMatch(/const cooling = await loadCooling\(db, startedAt\)\n\s+const plan = planMatchEmails\(await loadPendingMatchRows\(db, startedAt, cooling\), cooling\)/)
  })

  it('a teacher with no address, or no longer consented when read, is skipped and nothing is claimed', async () => {
    h.pending = [match('t1', 0), match('t2', 0)]
    h.teachers = [{ ...teacher('t1'), private: { email: null }, profile: { email: null } }] // t2: not returned (consent gone)
    expect(await (await run()).json()).toMatchObject({ sent: 0, skipped: 2 })
    expect(h.claimWheres).toHaveLength(0)
  })

  it('teachers in cooldown are left out; visa-worded jobs never reach an email', async () => {
    h.pending = [match('t1', 0), match('t2', 0, { title: 'Teacher #VisaSponsorship' }), match('t2', 1)]
    h.cooling = [{ teacherProfileId: 't1' }]
    h.teachers = [teacher('t2')]
    await run()
    expect(h.sends).toHaveLength(1)
    expect(h.sends[0].opts.idempotencyKey).toBe(keyOf('t2', ['t2-m1']))
    expect(h.sends[0].msg.html).not.toMatch(/visa/i)
  })
})
