import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The one-off notice to live teachers that anyone can now message them (owner, 2026-10-13 — "Notify + privacy"). What
// this pins: the cron secret guards it; the dry run counts and touches nothing; each live teacher gets ONE in-app notice
// in their language and ONE email — a second run sends and writes nothing (the notification check, the kv marker), a
// refused send leaves no marker (so a later run tries again) and a run-wide refusal stops the emails. Resend and the
// database are fakes — nothing here reaches the network or an inbox.
type Once = { outcome: 'sent' | 'refused' | 'unknown'; stopRun: boolean; name: string | null; retryAfterMs: number | null }
const h = vi.hoisted(() => ({
  teachers: [] as { profileId: string; fullName: string; private: { email: string | null } | null; profile: { email: string | null; locale: string | null } }[],
  notes: [] as { recipientId: string; type: string; title: string; body: string }[],
  kv: new Map<string, unknown>(),
  sends: [] as { to: string; key: string; html?: string; subject?: string }[],
  answers: [] as Once[],
  // What was asked of the teacher table, and every kv write with its options.
  findArgs: [] as unknown[],
  // /privacy's date as the route reads it — pinned to the notice's day here, so a later amendment never fails this file.
  privacyDay: '',
  kvWrites: [] as { k: string; o: unknown }[],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/compliance/privacy-updated', () => ({ get PRIVACY_TEXT_PUBLISHED() { return h.privacyDay } }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async () => ({ success: true }),
  kv: {
    get: async (k: string) => h.kv.get(k) ?? null,
    // As kv_store: `nx` writes only when the key is absent, and answers null when it was not written.
    set: async (k: string, v: unknown, o?: { nx?: boolean }) => { if (o?.nx && h.kv.has(k)) return null; h.kv.set(k, v); h.kvWrites.push({ k, o }); return 'OK' },
    del: async (k: string) => { h.kv.delete(k) },
  },
}))
vi.mock('@/lib/mail', () => ({
  mailEnabled: () => true,
  sendMailOnce: async (msg: { to: string; html: string; subject: string }, opts: { idempotencyKey: string }) => {
    h.sends.push({ to: msg.to, key: opts.idempotencyKey, html: msg.html, subject: msg.subject })
    return h.answers.shift() ?? { outcome: 'sent', stopRun: false, name: null, retryAfterMs: null }
  },
}))
vi.mock('@/lib/db', () => ({
  db: {
    teacherProfile: { findMany: async (args: unknown) => { h.findArgs.push(args); return h.teachers } },
    notification: {
      findFirst: async ({ where }: { where: { recipientId: string; type: string; title: { in: string[] } } }) =>
        h.notes.find((n) => n.recipientId === where.recipientId && n.type === where.type && where.title.in.includes(n.title)) ?? null,
      create: async ({ data }: { data: { recipientId: string; type: string; title: string; body: string } }) => { h.notes.push(data); return data },
    },
  },
}))

// ⚠️ BEFORE the import: the edition is read once, when @/lib/edition first loads (teachers live on eno.vn).
vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
process.env.CRON_SECRET = 'cron-secret'
const { GET } = await import('./route')
const { NOTICE_SINCE } = await import('@/lib/emails/teacher-dm-ladder-notice')
const req = (q = '', auth: string | null = 'Bearer cron-secret') =>
  new Request(`https://eno.vn/api/cron/teacher-dm-ladder-notice${q}`, { headers: auth ? { authorization: auth } : {} })

// The notice's own day, inside its 14-day window — never the clock the suite happens to run on.
const { TEACHER_DM_NOTICE_DAY: DAY } = await import('@/lib/emails/teacher-dm-ladder-notice')
const ON_THE_DAY = Date.parse(`${DAY}T15:00:00+07:00`)
const dayPlus = (days: number) => new Date(Date.parse(`${DAY}T00:00:00+07:00`) + days * 86_400_000)
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(ON_THE_DAY)
  h.privacyDay = DAY
  h.notes = []; h.kv = new Map(); h.sends = []; h.answers = []; h.findArgs = []; h.kvWrites = []
  h.teachers = [
    { profileId: 'p1', fullName: 'Ann', private: null, profile: { email: 'ann@example.com', locale: 'en' } },
    { profileId: 'p2', fullName: 'Bình', private: { email: 'binh@example.com' }, profile: { email: null, locale: 'vi' } },
    { profileId: 'p3', fullName: 'No Mail', private: null, profile: { email: null, locale: null } },
  ]
})

afterEach(() => { vi.restoreAllMocks() })

describe('teacher-dm-ladder-notice', () => {
  it('needs the cron secret', async () => {
    for (const a of [null, 'Bearer nope']) expect((await GET(req('', a))).status).toBe(401)
  })

  it('a dry run counts and changes nothing', async () => {
    const body = await (await GET(req('?dryRun=1'))).json()
    expect(body).toMatchObject({ dryRun: true, teachers: 3, withEmail: 2 })
    expect(h.notes).toHaveLength(0)
    expect(h.sends).toHaveLength(0)
  })

  it('one notice per teacher, in their language, and one email each to those with an address', async () => {
    const body = await (await GET(req())).json()
    expect(body).toMatchObject({ teachers: 3, notified: 3, emailed: 2, failed: 0 })
    expect(h.notes.find((n) => n.recipientId === 'p1')?.title).toBe('A change to who can message teachers')
    expect(h.notes.find((n) => n.recipientId === 'p2')?.title).toBe('Thay đổi về người có thể nhắn tin cho giáo viên')
    expect(h.sends.map((s) => s.to)).toEqual(['ann@example.com', 'binh@example.com'])
    // The body is ONE content row of the card (layout.ts) — bare paragraphs would be hoisted above the white card.
    expect(h.sends[0].html).toMatch(/<tr><td style="padding:4px 24px 8px;"><p [^>]*>Hi Ann,<\/p>/)
    // Claims are released: nothing is left held for a later run.
    expect([...h.kv.keys()].filter((k) => k.includes(':claim:'))).toEqual([])
    expect(h.sends.map((s) => s.key)).toEqual(['teacher-dm-ladder-notice:p1', 'teacher-dm-ladder-notice:p2'])
    // The email in the teacher's language too — it reports a privacy change (gate review, 2026-10-13).
    expect(h.sends.map((s) => s.subject)).toEqual(['A change to who can message you on eno.vn', 'Thay đổi về người có thể nhắn tin cho bạn trên eno.vn'])
    // Dated from /privacy's own date, never "today": the notice is read days later.
    expect(h.notes.find((n) => n.recipientId === 'p1')?.body).toMatch(new RegExp(`^From ${NOTICE_SINCE.en}, any signed-in account`))
    expect(h.notes.find((n) => n.recipientId === 'p2')?.body).toMatch(new RegExp(`^Từ ngày ${NOTICE_SINCE.vi.replace(/\//g, '\\/')}, mọi tài khoản`))
    expect(JSON.stringify(body).length).toBeLessThan(200)
  })

  it('⛔ never twice: a second run writes no notice and sends no email', async () => {
    await GET(req())
    h.sends = []
    const body = await (await GET(req())).json()
    expect(body).toMatchObject({ notified: 0, emailed: 0, already: 2 })
    expect(h.sends).toHaveLength(0)
    expect(h.notes).toHaveLength(3)
  })

  it('a refused email leaves no marker, so a later run tries again; a run-wide refusal stops the emails', async () => {
    h.answers = [{ outcome: 'refused', stopRun: true, name: 'daily_quota_exceeded', retryAfterMs: null }]
    const first = await (await GET(req())).json()
    expect(first).toMatchObject({ emailed: 0, failed: 1, stopped: true })
    expect(h.sends).toHaveLength(1) // stopped after the first refusal
    h.sends = []
    const second = await (await GET(req())).json()
    expect(second).toMatchObject({ emailed: 2, notified: 0 })
  })

  it('⛔ an UNKNOWN send (twice unknown) is marked like a send and never retried — Resend may already have sent it (pre-review, 2026-10-13)', async () => {
    const unknown: Once = { outcome: 'unknown', stopRun: false, name: 'network', retryAfterMs: null }
    h.answers = [unknown, unknown]
    // The route waits 5 s before asking again about an unknown send: the clock is moved, never waited on.
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    let first: Record<string, unknown>
    try {
      const run = GET(req())
      await vi.runAllTimersAsync()
      first = await (await run).json()
    } finally {
      vi.useRealTimers()
    }
    expect(first).toMatchObject({ emailed: 1, uncertain: 1, failed: 0 })
    h.sends = []
    const second = await (await GET(req())).json()
    expect(second).toMatchObject({ emailed: 0, already: 2 })
    expect(h.sends).toHaveLength(0)
  })

  it('⛔ a teacher another run is working on is left to it: claimed, skipped, nothing written or sent for them', async () => {
    h.kv.set('teacher-dm-ladder-notice:claim:p1', 1)
    const body = await (await GET(req())).json()
    expect(body).toMatchObject({ busy: 1, notified: 2, emailed: 1 })
    expect(h.notes.map((n) => n.recipientId)).toEqual(['p2', 'p3'])
    expect(h.sends.map((s) => s.to)).toEqual(['binh@example.com'])
  })

  it('⛔ hidden profiles are told too — the rule reaches them the day they show it again (gate review, 2026-10-13)', async () => {
    await GET(req('?dryRun=1'))
    const { PUBLISH_NOTICE_VERSION } = await import('@/lib/teachers/profile')
    expect(h.findArgs[0]).toMatchObject({ where: { status: { in: ['live', 'hidden'] }, OR: [{ consentPublicVersion: null }, { consentPublicVersion: { lt: PUBLISH_NOTICE_VERSION } }] } })
  })

  it('⛔ a send marker never expires; an UNKNOWN first try is marked even when the retry is refused — it may have gone out', async () => {
    const unknown: Once = { outcome: 'unknown', stopRun: false, name: 'network', retryAfterMs: null }
    const refused: Once = { outcome: 'refused', stopRun: false, name: 'validation_error', retryAfterMs: null }
    h.answers = [unknown, refused]
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    let first: Record<string, unknown>
    try {
      const run = GET(req())
      await vi.runAllTimersAsync()
      first = await (await run).json()
    } finally {
      vi.useRealTimers()
    }
    expect(first).toMatchObject({ emailed: 1, uncertain: 1, failed: 0 })
    const marks = h.kvWrites.filter((w) => w.k.includes(':sent:'))
    expect(marks.map((w) => w.k)).toEqual(['teacher-dm-ladder-notice:sent:p1', 'teacher-dm-ladder-notice:sent:p2'])
    expect(marks.every((w) => w.o === undefined)).toBe(true) // no expiry
  })

  it('⛔ two uncertain sends in a row stop the emails — an outage never marks every teacher as emailed (gate review, 2026-10-13)', async () => {
    h.teachers = [
      { profileId: 'p1', fullName: 'A', private: null, profile: { email: 'a@example.com', locale: 'en' } },
      { profileId: 'p2', fullName: 'B', private: null, profile: { email: 'b@example.com', locale: 'en' } },
      { profileId: 'p3', fullName: 'C', private: null, profile: { email: 'c@example.com', locale: 'en' } },
    ]
    const unknown: Once = { outcome: 'unknown', stopRun: false, name: 'network', retryAfterMs: null }
    h.answers = [unknown, unknown, unknown, unknown]
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    let body: Record<string, unknown>
    try {
      const run = GET(req())
      await vi.runAllTimersAsync()
      body = await (await run).json()
    } finally {
      vi.useRealTimers()
    }
    expect(body).toMatchObject({ ok: false, uncertain: 2, emailed: 0, stopped: true, notified: 3 })
    // The two uncertain ones are named in the log — the id only, never the address.
    expect(warn.mock.calls.map((c) => (c[1] as { profileId: string }).profileId)).toEqual(['p1', 'p2'])
    expect(JSON.stringify(warn.mock.calls)).not.toContain('@example.com')
    expect(h.sends.map((x) => x.to)).toEqual(['a@example.com', 'a@example.com', 'b@example.com', 'b@example.com'])
    // The third is left unmarked, for a later run.
    expect([...h.kv.keys()].filter((k) => k.includes(':sent:'))).toEqual(['teacher-dm-ladder-notice:sent:p1', 'teacher-dm-ladder-notice:sent:p2'])
  })

  it('an uncertain first try whose retry is refused run-wide still stops the run — the refusal\'s stopRun is honoured', async () => {
    const unknown: Once = { outcome: 'unknown', stopRun: false, name: 'network', retryAfterMs: null }
    const quota: Once = { outcome: 'refused', stopRun: true, name: 'daily_quota_exceeded', retryAfterMs: null }
    h.answers = [unknown, quota]
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    let body: Record<string, unknown>
    try {
      const run = GET(req())
      await vi.runAllTimersAsync()
      body = await (await run).json()
    } finally {
      vi.useRealTimers()
    }
    expect(body).toMatchObject({ ok: false, uncertain: 1, stopped: true })
    expect(h.sends.map((x) => x.to)).toEqual(['ann@example.com', 'ann@example.com']) // Bình is left for a later run
  })

  it('⛔ a one-off bound to its day: refused before it and 14 days after it, before reading anyone (gate review, 2026-10-13)', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(dayPlus(15).getTime())
    expect(await (await GET(req())).json()).toEqual({ ok: false, skipped: 'expired' })
    vi.spyOn(Date, 'now').mockReturnValue(dayPlus(0).getTime() - 60_000)
    expect(await (await GET(req())).json()).toEqual({ ok: false, skipped: 'not_yet' })
    expect(h.findArgs).toEqual([])
    expect(h.sends).toEqual([])
  })

  it('⛔ refused while /privacy is dated another day — a slipped deploy not re-dated here, or a later amendment', async () => {
    h.privacyDay = new Date(Date.parse(`${DAY}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10) // the next day
    expect(await (await GET(req('?dryRun=1'))).json()).toEqual({ ok: false, skipped: 'privacy_date_differs' })
    expect(h.findArgs).toEqual([])
  })

  it('the audience is measured against the publish notice in force', async () => {
    const { PUBLISH_NOTICE_VERSION } = await import('@/lib/teachers/profile')
    await GET(req('?dryRun=1'))
    expect(h.findArgs[0]).toMatchObject({ where: { OR: [{ consentPublicVersion: null }, { consentPublicVersion: { lt: PUBLISH_NOTICE_VERSION } }] } })
  })

  it('ok only when every email is confirmed — an uncertain send, alone, is not ok', async () => {
    const unknown: Once = { outcome: 'unknown', stopRun: false, name: 'network', retryAfterMs: null }
    h.answers = [unknown, unknown]
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    let body: Record<string, unknown>
    try {
      const run = GET(req())
      await vi.runAllTimersAsync()
      body = await (await run).json()
    } finally {
      vi.useRealTimers()
    }
    expect(body).toMatchObject({ ok: false, uncertain: 1, emailed: 1, stopped: false })
  })
})
