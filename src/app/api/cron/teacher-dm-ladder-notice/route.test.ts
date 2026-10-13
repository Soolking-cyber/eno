import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The one-off notice to teachers that anyone can now message them (owner, 2026-10-13 — "Notify + privacy", then "no
// email only notif"). What this pins: the cron secret guards it; the dry run counts and touches nothing; each teacher
// gets ONE in-app notice in their language — never an email — and a second run writes nothing; the run is bound to its
// day and to /privacy's date; two overlapping runs never work on the same teacher. The database is a fake.
const h = vi.hoisted(() => ({
  teachers: [] as { profileId: string; profile: { locale: string | null } }[],
  notes: [] as { recipientId: string; type: string; title: string; body: string; url?: string }[],
  kv: new Map<string, unknown>(),
  // What was asked of the teacher table.
  findArgs: [] as unknown[],
  // /privacy's date as the route reads it — pinned to the notice's day here, so a later amendment never fails this file.
  privacyDay: '',
  // Set: the notification insert fails for this teacher.
  failFor: null as string | null,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/compliance/privacy-updated', () => ({ get PRIVACY_TEXT_PUBLISHED() { return h.privacyDay } }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async () => ({ success: true }),
  kv: {
    get: async (k: string) => h.kv.get(k) ?? null,
    // As kv_store: `nx` writes only when the key is absent, and answers null when it was not written.
    set: async (k: string, v: unknown, o?: { nx?: boolean }) => { if (o?.nx && h.kv.has(k)) return null; h.kv.set(k, v); return 'OK' },
    del: async (k: string) => { h.kv.delete(k) },
  },
}))
// ⛔ No email (owner, 2026-10-13: "no email only notif"): were the route ever to reach for mail again, this throws.
vi.mock('@/lib/mail', () => ({
  mailEnabled: () => { throw new Error('the teacher DM ladder notice sends no email') },
  sendMailOnce: async () => { throw new Error('the teacher DM ladder notice sends no email') },
}))
vi.mock('@/lib/db', () => ({
  db: {
    teacherProfile: { findMany: async (args: unknown) => { h.findArgs.push(args); return h.teachers } },
    notification: {
      findFirst: async ({ where }: { where: { recipientId: string; type: string; title: { in: string[] } } }) =>
        h.notes.find((n) => n.recipientId === where.recipientId && n.type === where.type && where.title.in.includes(n.title)) ?? null,
      create: async ({ data }: { data: { recipientId: string; type: string; title: string; body: string; url?: string } }) => {
        if (h.failFor === data.recipientId) throw new Error('insert failed')
        h.notes.push(data)
        return data
      },
    },
  },
}))

// ⚠️ BEFORE the import: the edition is read once, when @/lib/edition first loads (teachers live on eno.vn).
vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
process.env.CRON_SECRET = 'cron-secret'
const { GET } = await import('./route')
const { NOTICE_SINCE, TEACHER_DM_NOTICE_DAY: DAY } = await import('@/lib/teachers/dm-ladder-notice')
const req = (q = '', auth: string | null = 'Bearer cron-secret') =>
  new Request(`https://eno.vn/api/cron/teacher-dm-ladder-notice${q}`, { headers: auth ? { authorization: auth } : {} })

// The notice's own day, inside its 14-day window — never the clock the suite happens to run on.
const ON_THE_DAY = Date.parse(`${DAY}T15:00:00+07:00`)
const dayPlus = (days: number) => new Date(Date.parse(`${DAY}T00:00:00+07:00`) + days * 86_400_000)
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(ON_THE_DAY)
  h.privacyDay = DAY
  h.notes = []; h.kv = new Map(); h.findArgs = []; h.failFor = null
  h.teachers = [
    { profileId: 'p1', profile: { locale: 'en' } },
    { profileId: 'p2', profile: { locale: 'vi' } },
    { profileId: 'p3', profile: { locale: null } },
  ]
})
afterEach(() => { vi.restoreAllMocks() })

describe('teacher-dm-ladder-notice', () => {
  it('needs the cron secret', async () => {
    for (const a of [null, 'Bearer nope']) expect((await GET(req('', a))).status).toBe(401)
  })

  it('a dry run counts and changes nothing', async () => {
    expect(await (await GET(req('?dryRun=1'))).json()).toEqual({ ok: true, dryRun: true, teachers: 3 })
    expect(h.notes).toHaveLength(0)
  })

  it('⛔ one in-app notice per teacher, in their language, dated — and no email (owner: "no email only notif")', async () => {
    const body = await (await GET(req())).json()
    expect(body).toEqual({ ok: true, teachers: 3, notified: 3, already: 0, busy: 0, failed: 0 })
    expect(h.notes.map((n) => [n.recipientId, n.type, n.url])).toEqual([['p1', 'system', '/privacy'], ['p2', 'system', '/privacy'], ['p3', 'system', '/privacy']])
    expect(h.notes.find((n) => n.recipientId === 'p1')?.title).toBe('A change to who can message teachers')
    expect(h.notes.find((n) => n.recipientId === 'p2')?.title).toBe('Thay đổi về người có thể nhắn tin cho giáo viên')
    expect(h.notes.find((n) => n.recipientId === 'p3')?.title).toBe('A change to who can message teachers') // no locale: English
    // Dated from its own day, never "today": a notice is read days later.
    expect(h.notes.find((n) => n.recipientId === 'p1')?.body).toMatch(new RegExp(`^From ${NOTICE_SINCE.en}, any signed-in account`))
    expect(h.notes.find((n) => n.recipientId === 'p2')?.body).toMatch(new RegExp(`^Từ ngày ${NOTICE_SINCE.vi.replace(/\//g, '\\/')}, mọi tài khoản`))
    // It reads the language and nothing else — no name, no address.
    expect(h.findArgs[0]).toMatchObject({ select: { profileId: true, profile: { select: { locale: true } } } })
    // Claims are released: nothing is left held for a later run.
    expect([...h.kv.keys()]).toEqual([])
  })

  it('⛔ never twice: a second run writes nothing', async () => {
    await GET(req())
    const body = await (await GET(req())).json()
    expect(body).toEqual({ ok: true, teachers: 3, notified: 0, already: 3, busy: 0, failed: 0 })
    expect(h.notes).toHaveLength(3)
  })

  it('a failed insert is counted, not ok, and a later run reaches that teacher', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.failFor = 'p2'
    expect(await (await GET(req())).json()).toMatchObject({ ok: false, notified: 2, failed: 1 })
    h.failFor = null
    expect(await (await GET(req())).json()).toMatchObject({ ok: true, notified: 1, already: 2 })
    expect(h.notes.map((n) => n.recipientId).sort()).toEqual(['p1', 'p2', 'p3'])
  })

  it('⛔ a teacher another run is working on is left to it: claimed, skipped, not ok', async () => {
    h.kv.set('teacher-dm-ladder-notice:claim:p1', 1)
    expect(await (await GET(req())).json()).toMatchObject({ ok: false, busy: 1, notified: 2 })
    expect(h.notes.map((n) => n.recipientId)).toEqual(['p2', 'p3'])
  })

  it('⛔ hidden profiles are told too, and only teachers who agreed to an older publish notice', async () => {
    await GET(req('?dryRun=1'))
    const { PUBLISH_NOTICE_VERSION } = await import('@/lib/teachers/profile')
    expect(h.findArgs[0]).toMatchObject({ where: { status: { in: ['live', 'hidden'] }, OR: [{ consentPublicVersion: null }, { consentPublicVersion: { lt: PUBLISH_NOTICE_VERSION } }] } })
  })

  it('⛔ a one-off bound to its day: refused before it and 14 days after it, before reading anyone', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(dayPlus(15).getTime())
    expect(await (await GET(req())).json()).toEqual({ ok: false, skipped: 'expired' })
    vi.spyOn(Date, 'now').mockReturnValue(dayPlus(0).getTime() - 60_000)
    expect(await (await GET(req())).json()).toEqual({ ok: false, skipped: 'not_yet' })
    expect(h.findArgs).toEqual([])
    expect(h.notes).toEqual([])
  })

  it('⛔ refused while /privacy is dated another day — a slipped deploy not re-dated here, or a later amendment', async () => {
    h.privacyDay = new Date(Date.parse(`${DAY}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10) // the next day
    expect(await (await GET(req('?dryRun=1'))).json()).toEqual({ ok: false, skipped: 'privacy_date_differs' })
    expect(h.findArgs).toEqual([])
  })
})
