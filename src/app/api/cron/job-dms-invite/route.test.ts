import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// GET /api/cron/job-dms-invite — the job-messages invite (owner, 2026-10-20). Pinned: cron auth; marketplace only; a dry
// run that counts and writes nothing; WHO (live teachers on a live listing who never used the switch — never the owner's
// demo profile, never over an ON or an OFF); ⛔ NEVER TWICE (the invitedAt claim is a compare-and-set in the bell's own
// transaction: a re-run and a parallel run each find nothing left to claim); ⛔ the quiet hours (21:00–08:00 Vietnam
// time — none at the start, and a run that crosses 21:00 stops there); the ceiling; one teacher's error never stops the
// run (500 at the end); a push failure leaves the bell; the answer stays under 200 bytes. The REAL claim and selection
// (src/lib/teachers/job-dms/invite.ts) run over an in-memory database — nothing reaches a real one, a phone or a browser.
type Consent = { optIn: boolean; optInAt: Date | null; noticeVersion: string | null; withdrawnAt: Date | null; invitedAt: Date | null; updatedAt?: Date }
type Teacher = { id: string; profileId: string; status: string; listingId: string | null; listing: { status: string; verified: boolean } | null; createdAt: Date }
const h = vi.hoisted(() => ({
  teachers: [] as Teacher[],
  consents: new Map<string, Consent>(),
  notifications: [] as Array<{ recipientId: string; type: string; title: string; body: string; url: string }>,
  pushes: [] as Array<{ profileId: string; payload: Record<string, unknown> }>,
  pushThrows: false,
  /** profile ids whose claim throws (a database error mid-transaction) */
  claimThrowsFor: new Set<string>(),
  /** called after each bell row — lets a test move the clock mid-run */
  afterBell: null as null | (() => void),
  lockKeys: [] as string[],
  wheres: [] as unknown[],
}))

/** The selection's where, evaluated the way Postgres would for the shapes invite.ts writes (pinned separately below). */
function matches(t: Teacher, where: Record<string, any>): boolean {
  if (where.status !== undefined && t.status !== where.status) return false
  if (where.listing) {
    if (!t.listing || t.listing.status !== where.listing.status || t.listing.verified !== where.listing.verified) return false
  }
  const notIn: string[] | undefined = where.NOT?.listingId?.in
  if (notIn && (t.listingId === null || notIn.includes(t.listingId))) return false
  const or: Array<Record<string, any>> | undefined = where.profile?.OR
  if (or) {
    const c = h.consents.get(t.profileId) ?? null
    const ok = or.some((alt) => {
      const is = alt.teacherJobDmConsent?.is
      if (is === null) return c === null
      return c !== null && Object.entries(is as Record<string, unknown>).every(([k, v]) => (c as Record<string, unknown>)[k] === v)
    })
    if (!ok) return false
  }
  return true
}

vi.mock('@/lib/db', () => {
  const tx = {
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join('?').includes('pg_advisory_xact_lock')) h.lockKeys.push(String(values[0]))
      return 1
    },
    teacherProfile: {
      count: async ({ where }: { where: Record<string, any> }) => { h.wheres.push(where); return h.teachers.filter((t) => matches(t, where)).length },
      findMany: async ({ where, take }: { where: Record<string, any>; take: number }) => {
        h.wheres.push(where)
        return [...h.teachers].filter((t) => matches(t, where)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).slice(0, take).map((t) => ({ profileId: t.profileId }))
      },
      findUnique: async ({ where }: { where: { profileId: string } }) => {
        const t = h.teachers.find((x) => x.profileId === where.profileId)
        return t ? { status: t.status, listingId: t.listingId, listing: t.listing } : null
      },
    },
    teacherJobDmConsent: {
      // INSERT … ON CONFLICT DO NOTHING
      createMany: async ({ data, skipDuplicates }: { data: Array<Partial<Consent> & { profileId: string }>; skipDuplicates: boolean }) => {
        let count = 0
        for (const d of data) {
          if (h.claimThrowsFor.has(d.profileId)) throw Object.assign(new Error('connection reset — select * from "Profile"'), { code: 'P1017' })
          if (h.consents.has(d.profileId)) { if (!skipDuplicates) throw new Error('unique'); continue }
          const { profileId, ...rest } = d
          h.consents.set(profileId, { optIn: false, optInAt: null, noticeVersion: null, withdrawnAt: null, invitedAt: null, ...rest })
          count++
        }
        return { count }
      },
      // UPDATE … WHERE <every field named>
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Consent> }) => {
        const { profileId, ...cond } = where as { profileId: string } & Record<string, unknown>
        const c = h.consents.get(profileId)
        if (!c || !Object.entries(cond).every(([k, v]) => (c as Record<string, unknown>)[k] === v)) return { count: 0 }
        Object.assign(c, data)
        return { count: 1 }
      },
    },
    notification: {
      create: async ({ data }: { data: (typeof h.notifications)[number] }) => { h.notifications.push(data); h.afterBell?.(); return { id: `n${h.notifications.length}` } },
    },
  }
  return {
    db: {
      ...tx,
      // One transaction = all or nothing: a throw inside rolls back the claim it made.
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
        const before = new Map([...h.consents].map(([k, v]) => [k, { ...v }]))
        const bells = h.notifications.length
        try { return await fn(tx) } catch (e) { h.consents.clear(); for (const [k, v] of before) h.consents.set(k, v); h.notifications.length = bells; throw e }
      },
    },
  }
})
vi.mock('@/lib/push', () => ({
  sendPushToProfile: async (profileId: string, payload: Record<string, unknown>) => {
    h.pushes.push({ profileId, payload })
    if (h.pushThrows) throw new Error('push service down')
    return 1
  },
}))

vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
const { GET } = await import('./route')
const { HOME_HIDDEN_TEACHER_LISTING_IDS } = await import('@/lib/teachers/constants')
const { INVITE_BODY, INVITE_TITLE, JOB_DM_INVITE, inviteCandidateWhere, inviteIsQuiet } = await import('@/lib/teachers/job-dms/invite')

const DEMO = HOME_HIDDEN_TEACHER_LISTING_IDS[0]
/** 10:00 in Vietnam — inside the daytime window. */
const DAY = new Date('2026-10-20T03:00:00.000Z')
const req = (qs = '', auth: string | null = 'Bearer cron-secret') =>
  new Request(`https://eno.vn/api/cron/job-dms-invite${qs}`, { headers: auth ? { authorization: auth } : {} })
const run = async (qs = '') => {
  const res = await GET(req(qs) as never, {} as never)
  const text = await res.text()
  return { status: res.status, body: JSON.parse(text) as Record<string, unknown>, bytes: Buffer.byteLength(text) }
}
let seq = 0
const teacher = (o: Partial<Teacher> = {}): Teacher => {
  seq++
  return { id: `tp${seq}`, profileId: `p${seq}`, status: 'live', listingId: `l${seq}`, listing: { status: 'active', verified: true }, createdAt: new Date(Date.UTC(2026, 9, 1, 0, seq)), ...o }
}

beforeEach(() => {
  process.env.CRON_SECRET = 'cron-secret'
  seq = 0
  h.teachers = []; h.consents.clear(); h.notifications = []; h.pushes = []; h.pushThrows = false; h.claimThrowsFor.clear()
  h.afterBell = null; h.lockKeys = []; h.wheres = []
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(DAY)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('GET /api/cron/job-dms-invite', () => {
  it('needs the cron secret — and writes nothing without it', async () => {
    h.teachers = [teacher()]
    for (const a of [null, 'Bearer nope']) expect((await GET(req('', a) as never, {} as never)).status).toBe(401)
    expect(h.notifications).toEqual([])
  })

  it('⛔ a dry run counts who would be invited — and claims, writes and sends nothing', async () => {
    h.teachers = [teacher(), teacher(), teacher({ status: 'hidden' })]
    const r = await run('?dryRun=1')
    expect(r).toMatchObject({ status: 200, body: { ok: true, dryRun: true, eligible: 2, wouldInvite: 2, quiet: false } })
    expect(h.consents.size).toBe(0)
    expect(h.notifications).toEqual([])
    expect(h.pushes).toEqual([])
  })

  it('invites each live teacher ONCE: the claim and its bell (eno’s bilingual copy, the page’s url) — in the app only, no web push', async () => {
    h.teachers = [teacher(), teacher()]
    const r = await run()
    expect(r).toEqual({ status: 200, body: { ok: true, invited: 2, skipped: 0, failed: 0, left: 0 }, bytes: expect.any(Number) })
    expect(h.notifications).toEqual(['p1', 'p2'].map((recipientId) => ({ recipientId, type: 'teacher_jobs_invite', title: INVITE_TITLE, body: INVITE_BODY, url: '/teachers/job-messages' })))
    // ⛔ no push: the permission was given for messages, not for news of a feature (opus, gate 5b — Decree 91/2020)
    expect(h.pushes).toEqual([])
    for (const id of ['p1', 'p2']) expect(h.consents.get(id)).toMatchObject({ invitedAt: DAY, optIn: false, optInAt: null, withdrawnAt: null })
    // Under the teacher's job-DM lock (consent.ts) — the key desk.ts takes for a send.
    expect(h.lockKeys).toEqual(['teacher-job-dm:p1', 'teacher-job-dm:p2'])
  })

  it('⛔ NEVER TWICE — a re-run finds nobody left, and two runs at once invite each teacher once between them', async () => {
    h.teachers = [teacher(), teacher(), teacher()]
    await run()
    const again = await run()
    expect(again.body).toEqual({ ok: true, invited: 0, skipped: 0, failed: 0, left: 0 })
    expect(h.notifications).toHaveLength(3)
    // Parallel runs over the same selection: only the claim that lands first rings.
    h.teachers.push(teacher(), teacher())
    const [a, b] = await Promise.all([run(), run()])
    expect((a.body.invited as number) + (b.body.invited as number)).toBe(2)
    expect((a.body.skipped as number) + (b.body.skipped as number)).toBe(2)
    const per = new Map<string, number>()
    for (const n of h.notifications) per.set(n.recipientId, (per.get(n.recipientId) ?? 0) + 1)
    expect([...per.values()].every((n) => n === 1)).toBe(true)
    expect(per.size).toBe(5)
  })

  it('⛔ WHO: never over an ON or an OFF, never twice, never the demo profile, never a hidden profile or a listing not live', async () => {
    const at = new Date('2026-10-15T03:00:00.000Z')
    h.teachers = [
      teacher(), // p1 — no row: invited
      teacher(), // p2 — switched ON already
      teacher(), // p3 — switched it OFF
      teacher(), // p4 — invited before
      teacher({ listingId: DEMO }), // p5 — the owner's demo profile
      teacher({ status: 'hidden' }), // p6
      teacher({ listing: { status: 'active', verified: false } }), // p7 — under review
      teacher({ listingId: null, listing: null }), // p8 — no listing
      teacher(), // p9 — a row with nothing in it yet: invited
    ]
    h.consents.set('p2', { optIn: true, optInAt: at, noticeVersion: '2026-10-20', withdrawnAt: null, invitedAt: null })
    h.consents.set('p3', { optIn: false, optInAt: at, noticeVersion: '2026-10-20', withdrawnAt: at, invitedAt: null })
    h.consents.set('p4', { optIn: false, optInAt: null, noticeVersion: null, withdrawnAt: null, invitedAt: at })
    h.consents.set('p9', { optIn: false, optInAt: null, noticeVersion: null, withdrawnAt: null, invitedAt: null })
    const r = await run()
    expect(r.body).toMatchObject({ ok: true, invited: 2 })
    expect(h.notifications.map((n) => n.recipientId)).toEqual(['p1', 'p9'])
    expect(h.consents.get('p4')?.invitedAt).toEqual(at) // the first invite's time stays
  })

  it('the selection, as written: live, a live listing, never the demo listing, never asked', () => {
    expect(inviteCandidateWhere()).toEqual({
      status: 'live',
      listing: { status: 'active', verified: true },
      NOT: { listingId: { in: [DEMO] } },
      profile: { OR: [{ teacherJobDmConsent: { is: null } }, { teacherJobDmConsent: { is: { invitedAt: null, optIn: false, optInAt: null, withdrawnAt: null } } }] },
    })
  })

  it('⛔ the claim re-checks under the lock: a teacher who switched it on, or hid the profile, since the selection is not rung', async () => {
    h.teachers = [teacher(), teacher(), teacher()]
    // After p1's bell: p2 switches the job messages ON, p3 hides the profile — both after the run read its list.
    h.afterBell = () => {
      if (h.notifications.length !== 1) return
      h.consents.set('p2', { optIn: true, optInAt: new Date(), noticeVersion: '2026-10-20', withdrawnAt: null, invitedAt: null })
      h.teachers[2].status = 'hidden'
    }
    const r = await run()
    expect(r.body).toMatchObject({ ok: true, invited: 1, skipped: 2, failed: 0 })
    expect(h.notifications.map((n) => n.recipientId)).toEqual(['p1'])
    expect(h.consents.get('p2')?.invitedAt).toBeNull()
  })

  it('⛔ the quiet hours: 21:00–08:00 Vietnam time invites nobody — and a dry run says so', async () => {
    h.teachers = [teacher()]
    for (const iso of ['2026-10-20T14:00:00.000Z', '2026-10-20T19:30:00.000Z', '2026-10-20T00:59:59.000Z']) { // 21:00, 02:30, 07:59:59 ICT
      vi.setSystemTime(new Date(iso))
      expect((await run()).body, iso).toEqual({ ok: true, invited: 0, left: 1, stopped: 'quiet' })
      expect((await run('?dryRun=1')).body, iso).toMatchObject({ wouldInvite: 0, quiet: true })
    }
    expect(h.notifications).toEqual([])
    expect(h.consents.size).toBe(0)
    // 08:00 and 20:59 ICT are daytime.
    expect(inviteIsQuiet(Date.parse('2026-10-20T01:00:00.000Z'))).toBe(false)
    expect(inviteIsQuiet(Date.parse('2026-10-20T13:59:59.000Z'))).toBe(false)
  })

  it('⛔ a run that crosses 21:00 stops there — the rest wait for the next day', async () => {
    h.teachers = [teacher(), teacher(), teacher()]
    vi.setSystemTime(new Date('2026-10-20T13:59:59.000Z')) // 20:59:59 ICT
    h.afterBell = () => vi.setSystemTime(new Date('2026-10-20T14:00:01.000Z'))
    const r = await run()
    expect(r.body).toEqual({ ok: true, invited: 1, skipped: 0, failed: 0, left: 2, stopped: 'quiet' })
    expect(h.notifications.map((n) => n.recipientId)).toEqual(['p1'])
  })

  it('at most JOB_DM_INVITE.maxPerRun a run, oldest profiles first — the ceiling is a pause (200), not a failure', async () => {
    const n = JOB_DM_INVITE.maxPerRun + 3
    h.teachers = Array.from({ length: n }, () => teacher())
    const r = await run()
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: true, invited: JOB_DM_INVITE.maxPerRun, left: 3, stopped: 'ceiling' })
    expect(h.notifications[0].recipientId).toBe('p1')
    expect((await run()).body).toMatchObject({ ok: true, invited: 3, left: 0 })
    expect(new Set(h.notifications.map((x) => x.recipientId)).size).toBe(n)
  })

  it('⛔ one teacher’s error never stops the run: nothing of theirs is written, the rest are invited, the unit goes red', async () => {
    h.teachers = [teacher(), teacher(), teacher()]
    h.claimThrowsFor.add('p2')
    const r = await run()
    expect(r.status).toBe(500)
    // the failed teacher is still to be invited: counted as left (codex, gate 5a) — not as a ceiling
    expect(r.body).toEqual({ ok: false, invited: 2, skipped: 0, failed: 1, left: 1 })
    expect(h.consents.has('p2')).toBe(false)
    expect(h.notifications.map((x) => x.recipientId)).toEqual(['p1', 'p3'])
    // Logged with the id and a code — never the error's text (it can quote a query).
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls)
    expect(logged).toContain('P1017')
    expect(logged).not.toContain('select')
    // The next run picks up the one that failed.
    h.claimThrowsFor.clear()
    expect((await run()).body).toMatchObject({ ok: true, invited: 1 })
  })

  it('⛔ never a web push, even where the teacher allows them — the bell is the whole invite', async () => {
    h.teachers = [teacher(), teacher()]
    const r = await run()
    expect(r).toMatchObject({ status: 200, body: { ok: true, invited: 2, failed: 0 } })
    expect(h.notifications).toHaveLength(2)
    expect(h.pushes).toEqual([])
  })

  it('the answer stays under 200 bytes (eno-cron.sh prints only the first 200) and names no one', async () => {
    h.teachers = Array.from({ length: JOB_DM_INVITE.maxPerRun + 1 }, () => teacher())
    h.claimThrowsFor.add('p3')
    const r = await run()
    expect(r.bytes).toBeLessThan(200)
    expect(JSON.stringify(r.body)).not.toMatch(/p\d/)
  })

  it('services edition: nothing to do', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'services')
    vi.resetModules()
    try {
      const { GET: forumGet } = await import('./route')
      h.teachers = [teacher()]
      const res = await forumGet(req() as never, {} as never)
      expect(await res.json()).toEqual({ ok: true, skipped: 'marketplace_only' })
      expect(h.notifications).toEqual([])
    } finally {
      vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
    }
  })
})
