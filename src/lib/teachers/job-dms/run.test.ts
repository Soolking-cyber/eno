import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ONE RUN of the teacher job DMs (run.ts) against an in-memory table set: what it reads, drops as a cross-post, matches,
 * records in shadow and sends in live. The database is a small where-interpreter over arrays — only the shapes run.ts
 * uses — so the test pins run.ts's own queries, not a copy of them.
 */
vi.mock('server-only', () => ({}))

type Row = Record<string, unknown>
const T = { posts: [] as Row[], dms: [] as Row[], teachers: [] as Row[], listings: [] as Row[] }
const calls = { teacherWhere: [] as unknown[], createMany: [] as Row[][], consentUpdates: [] as unknown[] }

/**
 * SQL's three-valued logic, as Postgres runs Prisma's filters: a comparison with NULL is UNKNOWN (null here), NOT UNKNOWN
 * is UNKNOWN, and only TRUE passes — `NOT: { statusReason: 'duplicate' }` drops a NULL reason, which a two-valued mock
 * hid (opus, gate 3a). `field: null` is IS NULL; `{ not: null }` is IS NOT NULL.
 */
type B = boolean | null
const and = (xs: B[]): B => (xs.includes(false) ? false : xs.includes(null) ? null : true)
const or = (xs: B[]): B => (xs.includes(true) ? true : xs.includes(null) ? null : false)
const not = (x: B): B => (x === null ? null : !x)
function cond(row: Row, where: Row | undefined): B {
  if (!where) return true
  const parts: B[] = []
  for (const [k, v] of Object.entries(where)) {
    if (k === 'OR') { parts.push(or((v as Row[]).map((w) => cond(row, w)))); continue }
    if (k === 'AND') { parts.push(and((v as Row[]).map((w) => cond(row, w)))); continue }
    if (k === 'NOT') { parts.push(not(cond(row, v as Row))); continue }
    const x = row[k]
    const isNull = x === null || x === undefined
    if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) {
      const o = v as Row
      if ('in' in o) parts.push(isNull ? null : (o.in as unknown[]).includes(x))
      if ('notIn' in o) parts.push(isNull ? null : !(o.notIn as unknown[]).includes(x))
      if ('not' in o) parts.push(o.not === null ? !isNull : isNull ? null : x !== o.not)
      if ('gt' in o) parts.push(isNull ? null : (x as Date).getTime() > (o.gt as Date).getTime())
      if ('lt' in o) parts.push(isNull ? null : (x as Date).getTime() < (o.lt as Date).getTime())
      if ('gte' in o) parts.push(isNull ? null : (x as Date).getTime() >= (o.gte as Date).getTime())
      if ('lte' in o) parts.push(isNull ? null : (x as Date).getTime() <= (o.lte as Date).getTime())
      if ('startsWith' in o) parts.push(isNull ? null : String(x).startsWith(o.startsWith as string))
      for (const op of Object.keys(o)) if (!['in', 'notIn', 'not', 'gt', 'lt', 'gte', 'lte', 'startsWith'].includes(op)) throw new Error(`mock: unsupported operator ${op}`)
      continue
    }
    parts.push(v === null ? isNull : isNull ? null : x === v)
  }
  return and(parts)
}
const match = (row: Row, where: Row | undefined) => cond(row, where) === true

vi.mock('@/lib/db', () => ({
  db: {
    externalJobPost: {
      findMany: vi.fn(async (a: { where?: Row; take?: number; orderBy?: { receivedAt?: 'asc' } }) => {
        const rows = T.posts.filter((r) => match(r, a.where))
        if (a.orderBy?.receivedAt) rows.sort((x, y) => (x.receivedAt as Date).getTime() - (y.receivedAt as Date).getTime())
        return rows.slice(0, a.take ?? 1e9).map((r) => ({ ...r }))
      }),
      update: vi.fn(async (a: { where: { id: string }; data: Row }) => { Object.assign(T.posts.find((r) => r.id === a.where.id)!, a.data) }),
      updateMany: vi.fn(async (a: { where?: Row; data: Row }) => {
        const rows = T.posts.filter((r) => match(r, a.where))
        for (const r of rows) Object.assign(r, Object.fromEntries(Object.entries(a.data).map(([k, v]) => [k, v === DBNULL ? null : v])))
        return { count: rows.length }
      }),
      deleteMany: vi.fn(async (a: { where?: Row }) => { const before = T.posts.length; T.posts = T.posts.filter((r) => !match(r, a.where)); return { count: before - T.posts.length } }),
    },
    teacherJobDm: {
      findMany: vi.fn(async () => T.dms),
      createMany: vi.fn(async (a: { data: Row[] }) => { calls.createMany.push(a.data); T.dms.push(...a.data); return { count: a.data.length } }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    teacherProfile: { findMany: vi.fn(async (a: { where: unknown }) => { calls.teacherWhere.push(a.where); return T.teachers }) },
    teacherJobMatch: { findMany: vi.fn(async () => []) },
    teacherJobDmConsent: { updateMany: vi.fn(async (a: unknown) => { calls.consentUpdates.push(a); return { count: 0 } }) },
    teacherJobDmDay: { findMany: vi.fn(async () => []) },
    conversation: { findMany: vi.fn(async () => []) },
    listing: { findMany: vi.fn(async () => T.listings) },
    $queryRaw: vi.fn(async () => stops.rows),
    $executeRaw: vi.fn(async (_s: TemplateStringsArray, key: string, token: string) => { if (key === 'job-dms:run' && lock.token === token) lock.held = false; return 1 }),
  },
}))
const mode = { value: 'shadow' as string | null }
const lock = { held: false, token: '' }
vi.mock('@/lib/ratelimit', () => ({
  kv: {
    get: vi.fn(async (k: string) => (k === 'job-dms:run' ? (lock.held ? lock.token : null) : mode.value)),
    set: vi.fn(async (_k: string, v: string) => (lock.held ? null : ((lock.held = true), (lock.token = v), 'OK'))),
    del: vi.fn(async () => { lock.held = false }),
  },
}))
const DBNULL = Symbol('DbNull')
vi.mock('@/generated/prisma/client', () => ({ Prisma: { DbNull: DBNULL } }))
const scoped = vi.hoisted(() => ({ wheres: [] as unknown[] }))
vi.mock('@/lib/edition-scope', () => ({
  scopedListingWhere: async (w: object) => { scoped.wheres.push(w); return { AND: [w, { sellerId: { notIn: ['desk'] } }] } },
}))
const layaAnswers = vi.fn(async () => null)
// eno's default-on switch-on (consent.ts enrolDefaultOn — its own tests in consent.test.ts): a spy here.
const enrolDefaultOn = vi.fn(async () => 0)
vi.mock('./consent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./consent')>()),
  enrolDefaultOn: (...a: unknown[]) => (enrolDefaultOn as (...x: unknown[]) => unknown)(...a),
}))
vi.mock('./laya', () => ({ layaAnswers: (...a: unknown[]) => (layaAnswers as (...x: unknown[]) => unknown)(...a) }))
const desk = { operator: 'op-1' as string | null }
const sendJobDm = vi.fn(async () => ({ sent: true, conversationId: 'c1', messageId: 'm1' }))
const honourStop = vi.fn(async () => true)
const pauseJobDms = vi.fn(async () => true)
const resumeJobDms = vi.fn(async () => true)
const stops = { rows: [] as { conversationId: string; teacher: string; body: string; at?: Date; paused?: boolean }[] }
vi.mock('./desk', () => ({
  resolveJobsOperatorProfileId: vi.fn(async () => desk.operator),
  sendJobDm: (...a: unknown[]) => (sendJobDm as (...x: unknown[]) => unknown)(...a),
  honourStop: (...a: unknown[]) => (honourStop as (...x: unknown[]) => unknown)(...a),
  pauseJobDms: (...a: unknown[]) => (pauseJobDms as (...x: unknown[]) => unknown)(...a),
  resumeJobDms: (...a: unknown[]) => (resumeJobDms as (...x: unknown[]) => unknown)(...a),
}))

const { runJobDms, textSig, purgeJobPosts, PURGED_TEXT, jobFromListing } = await import('./run')
const { RULES_VERSION } = await import('./extract')
const { JOB_DM_DEFAULT_ON, JOB_DM_NOTICE_VERSION } = await import('./constants')
const { JOB_BOARDS, jobExternalId } = await import('@/lib/job-listing')

const DAY = new Date('2026-10-21T03:00:00Z') // Wed 10:00 ICT
const NIGHT = new Date('2026-10-21T15:00:00Z') // Wed 22:00 ICT
const AD = 'Our English centre in District 7 is hiring a part-time teacher for kids, 400k/hour, weekday evenings. Send your CV.'

function post(id: string, o: Row = {}): Row {
  return {
    id, source: 'fb', text: AD, title: null, company: null, locationText: null, postedAt: new Date('2026-10-21T01:00:00Z'),
    receivedAt: new Date('2026-10-21T01:30:00Z'), groupPublic: true, url: `https://www.facebook.com/groups/1/posts/${id}/`, applyText: null,
    status: 'new', statusReason: null, factsVersion: null, textSig: null, sourceName: 'Saigon Teachers', expiresAt: null, facts: null, ...o,
  }
}
const teacher = {
  profileId: 't-1', fullName: 'Sam Lee', livesIn: 'city', currentCity: 'ho-chi-minh-city', teachAreas: ['d7'], jobTypes: ['parttime'],
  ageGroups: ['kids'], subjects: [], englishLevel: 'c1', degreeLevel: 'bachelor', certificates: [{ type: 'tefl' }], yearsExperience: 2,
  expectedSalaryM: null, coverOpen: false, coverConsentVersion: null, coverAreas: [], coverSlots: [], coverRateVnd: null,
}

beforeEach(() => {
  T.posts = []; T.dms = []; T.teachers = [teacher]; T.listings = []
  calls.teacherWhere = []; calls.createMany = []; calls.consentUpdates = []
  mode.value = 'shadow'; desk.operator = 'op-1'
  sendJobDm.mockClear(); honourStop.mockClear(); pauseJobDms.mockClear(); resumeJobDms.mockClear(); layaAnswers.mockClear(); enrolDefaultOn.mockClear(); stops.rows = []; lock.held = false
})

describe('runJobDms', () => {
  it('no operator to answer replies: nothing runs', async () => {
    desk.operator = null
    expect(await runJobDms({ dryRun: false, now: DAY })).toMatchObject({ stopped: 'no-operator', read: 0 })
  })

  it('shadow: reads, drops the cross-post, records the would-be message — sends nothing', async () => {
    T.posts = [post('1'), post('2', { receivedAt: new Date('2026-10-21T01:40:00Z'), url: 'https://www.facebook.com/groups/9/posts/2/' })]
    const r = await runJobDms({ dryRun: false, now: DAY })
    expect(r).toMatchObject({ mode: 'shadow', read: 2, ready: 1, dropped: 1, teachers: 1, shadow: 1, sent: 0 })
    expect(T.posts.find((p) => p.id === '2')).toMatchObject({ status: 'dropped', statusReason: 'duplicate' })
    expect(calls.createMany[0]).toEqual([expect.objectContaining({ profileId: 't-1', jobKey: 'post:1', mode: 'shadow' })])
    expect(String(calls.createMany[0][0].preview)).toContain('Hi Sam, this is Alex from eno.vn.')
    expect(sendJobDm).not.toHaveBeenCalled()
  })

  it('eno.vn\'s own teaching jobs are read through the edition scope (edition-lint Rule A)', async () => {
    const { db } = await import('@/lib/db')
    T.posts = [post('1')]
    scoped.wheres = []
    await runJobDms({ dryRun: false, now: DAY })
    expect(scoped.wheres).toEqual([expect.objectContaining({ status: 'active', verified: true, listingType: 'job', subcategorySlug: 'teaching' })])
    expect(vi.mocked(db.listing.findMany).mock.calls.at(-1)?.[0]).toMatchObject({ where: { AND: [scoped.wheres[0], { sellerId: { notIn: ['desk'] } }] } })
  })

  it('both modes match only teachers with job messages on — their own switch-on, or eno\'s default-on — and not paused', async () => {
    T.posts = [post('1')]
    await runJobDms({ dryRun: false, now: DAY })
    mode.value = 'live'
    await runJobDms({ dryRun: false, now: DAY })
    for (const w of calls.teacherWhere) expect(w).toMatchObject({ profile: { teacherJobDmConsent: { optIn: true, noticeVersion: { in: [JOB_DM_NOTICE_VERSION, JOB_DM_DEFAULT_ON] }, pausedAt: null } } })
  })

  it('a writing run switches on, first, every live teacher who never chose (default-on); a dry run never does; quiet hours wait', async () => {
    T.posts = [post('1')]
    await runJobDms({ dryRun: true, now: DAY })
    expect(enrolDefaultOn).not.toHaveBeenCalled()
    await runJobDms({ dryRun: false, now: NIGHT })
    expect(enrolDefaultOn).not.toHaveBeenCalled()
    enrolDefaultOn.mockResolvedValueOnce(3)
    const r = await runJobDms({ dryRun: false, now: DAY })
    expect(enrolDefaultOn).toHaveBeenCalledTimes(1)
    expect(enrolDefaultOn).toHaveBeenCalledWith(DAY)
    expect(r.enrolled).toBe(3)
  })

  it('a copy held only for its route (a private group) does not take the job from a public copy', async () => {
    T.posts = [post('1', { groupPublic: false }), post('2', { receivedAt: new Date('2026-10-21T01:40:00Z') })]
    const r = await runJobDms({ dryRun: false, now: DAY })
    expect(T.posts.find((p) => p.id === '1')).toMatchObject({ status: 'held', statusReason: 'group-private' })
    expect(T.posts.find((p) => p.id === '2')).toMatchObject({ status: 'ready' })
    expect(r.ready).toBe(1)
  })

  it('a still-unread LATER copy never makes the earlier one the duplicate', async () => {
    // 60 posts fill this run's batch (READ_PER_RUN); the 61st, a copy of post 1 that a sender already signed, waits for
    // the next run — it must not count as "earlier" now, or post 1 drops as its duplicate and then it drops as post 1's.
    const fillers = Array.from({ length: 59 }, (_, i) => post(`f${i}`, { text: `Unrelated note number ${i} about the weather`, receivedAt: new Date(Date.UTC(2026, 9, 21, 1, 31 + (i % 20), i)) }))
    T.posts = [post('1'), ...fillers, post('later', { textSig: textSig(AD), receivedAt: new Date('2026-10-21T02:30:00Z') })]
    await runJobDms({ dryRun: false, now: DAY })
    expect(T.posts.find((p) => p.id === '1')).toMatchObject({ status: 'ready' })
    expect(T.posts.find((p) => p.id === 'later')).toMatchObject({ status: 'new' })
    await runJobDms({ dryRun: false, now: DAY })
    expect(T.posts.find((p) => p.id === 'later')).toMatchObject({ status: 'dropped', statusReason: 'duplicate' })
    expect(T.posts.find((p) => p.id === '1')).toMatchObject({ status: 'ready' })
  })

  it('a copy in a LATER run finds the earlier ready one (its reason is NULL) and drops as the duplicate', async () => {
    T.posts = [post('1')]
    await runJobDms({ dryRun: false, now: DAY })
    expect(T.posts[0]).toMatchObject({ status: 'ready', statusReason: null })
    T.posts.push(post('2', { receivedAt: new Date('2026-10-21T02:40:00Z'), url: 'https://www.facebook.com/groups/9/posts/2/' }))
    await runJobDms({ dryRun: false, now: DAY })
    expect(T.posts.find((p) => p.id === '2')).toMatchObject({ status: 'dropped', statusReason: 'duplicate' })
  })

  it('shadow keeps live\'s rules: nothing recorded in quiet hours, one message of a kind a day', async () => {
    T.posts = [post('1')]
    expect(await runJobDms({ dryRun: false, now: NIGHT })).toMatchObject({ mode: 'shadow', stopped: 'quiet', shadow: 0 })
    expect(calls.createMany).toEqual([])
    await runJobDms({ dryRun: false, now: DAY })
    expect(calls.createMany).toHaveLength(1)
    expect(calls.createMany[0][0]).toMatchObject({ kind: 'jobs', day: '2026-10-21' })
    T.posts.push(post('3', { text: 'Our English centre in District 7 is also hiring a part-time teacher for kids classes on weekends, 450k/hour.', receivedAt: new Date('2026-10-21T02:50:00Z'), url: 'https://www.facebook.com/groups/1/posts/3/' }))
    const r = await runJobDms({ dryRun: false, now: new Date('2026-10-21T05:00:00Z') })
    expect(r).toMatchObject({ shadow: 0, skipped: 1 })
  })

  it('a STOP is honoured in shadow mode too, and once per teacher', async () => {
    stops.rows = [{ conversationId: 'c1', teacher: 't-1', body: 'STOP' }, { conversationId: 'c1', teacher: 't-1', body: 'stop please' }, { conversationId: 'c2', teacher: 't-2', body: 'thanks!' }]
    const r = await runJobDms({ dryRun: false, now: DAY })
    expect(honourStop).toHaveBeenCalledTimes(1)
    expect(honourStop).toHaveBeenCalledWith('t-1', 'op-1', 'c1', DAY)
    expect(r.stops).toBe(1)
  })

  it('a STOP that failed is counted, retried next run, and that teacher is sent nothing now', async () => {
    mode.value = 'live'
    T.posts = [post('1')]
    stops.rows = [{ conversationId: 'c1', teacher: 't-1', body: 'STOP' }]
    honourStop.mockImplementationOnce(async () => { throw new Error('lock timeout') })
    const r = await runJobDms({ dryRun: false, now: DAY })
    expect(r).toMatchObject({ failed: 1, stops: 0, sent: 0, skipped: 1 })
    expect(sendJobDm).not.toHaveBeenCalled()
  })

  it('a reply that may be an opt-out PAUSES that teacher (stored) — no withdrawal — until an explicit "keep sending"', async () => {
    mode.value = 'live'
    T.posts = [post('1')]
    stops.rows = [{ conversationId: 'c1', teacher: 't-1', body: "I don't want to receive these job messages anymore, please take note, thanks" }]
    const r = await runJobDms({ dryRun: false, now: DAY })
    expect(honourStop).not.toHaveBeenCalled()
    expect(pauseJobDms).toHaveBeenCalledWith('t-1', 'op-1', 'c1', undefined, DAY)
    expect(sendJobDm).not.toHaveBeenCalled()
    expect(r).toMatchObject({ sent: 0, skipped: 1, paused: 1 })
    // a "thanks" after it changes nothing — the pause is lifted only by an explicit keep (or a switch-on); the row now
    // reads as paused, so the run does not pause it again
    stops.rows = [{ ...stops.rows[0], paused: true }, { conversationId: 'c1', teacher: 't-1', body: 'thanks for your help!', paused: true }]
    pauseJobDms.mockClear()
    await runJobDms({ dryRun: false, now: DAY })
    expect(resumeJobDms).not.toHaveBeenCalled()
    expect(pauseJobDms).not.toHaveBeenCalled()
    expect(sendJobDm).not.toHaveBeenCalled()
    // "Keep sending jobs" lifts it
    stops.rows = [...stops.rows, { conversationId: 'c1', teacher: 't-1', body: 'Keep sending jobs', paused: true }]
    await runJobDms({ dryRun: false, now: DAY })
    expect(resumeJobDms).toHaveBeenCalledWith('t-1', DAY)
    expect(sendJobDm).toHaveBeenCalledTimes(1)
    expect(sendJobDm).toHaveBeenCalledWith(expect.objectContaining({ repliesReadAt: expect.any(Date) }))
  })

  it('the latest word decides: a "Keep sending jobs" after a STOP is not a withdrawal', async () => {
    stops.rows = [{ conversationId: 'c1', teacher: 't-1', body: 'STOP' }, { conversationId: 'c1', teacher: 't-1', body: 'Keep sending jobs' }]
    await runJobDms({ dryRun: false, now: DAY })
    expect(honourStop).not.toHaveBeenCalled()
  })

  it('a post the RULES dropped is read again under new rules — never a duplicate, never one past its time', async () => {
    const old = { status: 'dropped', factsVersion: 'job-rules-2026-10-20' }
    T.posts = [
      post('rules', { ...old, statusReason: 'deny:vietnamese-oriented' }),
      // another job (the same words would be the first one's copy)
      post('placeless', { ...old, statusReason: 'no-place', text: 'Our English centre in District 7 is hiring a full-time teacher for teens, 25M a month. Send your CV.' }),
      post('dup', { ...old, statusReason: 'duplicate' }),
      post('stale', { ...old, statusReason: 'kind:other', receivedAt: new Date(DAY.getTime() - 6 * 86_400_000) }),
      post('aged', { ...old, statusReason: 'too-old' }),
      // the first LinkedIn alert: an English job the place-name bug dropped, and a Vietnamese one rightly dropped (its title)
      post('li-esl', { ...old, statusReason: 'deny:vietnamese-oriented', source: 'linkedin', title: 'English Second Language Teacher- Vietnam', text: 'English Second Language Teacher- Vietnam · English 1 · Ho Chi Minh City, Ho Chi Minh City, Vietnam', url: 'https://www.linkedin.com/jobs/view/1/' }),
      post('li-vi', { ...old, statusReason: 'deny:vietnamese-oriented', source: 'linkedin', title: 'Giáo Viên IELTS Fulltime Từ 7.5', text: 'Giáo Viên IELTS Fulltime Từ 7.5 · IELTS ARENA · Ho Chi Minh City, Vietnam', url: 'https://www.linkedin.com/jobs/view/2/' }),
    ]
    await runJobDms({ dryRun: false, now: DAY })
    const by = (id: string) => T.posts.find((p) => p.id === id)
    expect(by('rules')).toMatchObject({ status: 'ready', statusReason: null })
    expect(by('placeless')).toMatchObject({ status: 'ready' })
    for (const id of ['dup', 'stale', 'aged']) expect(by(id), id).toMatchObject({ status: 'dropped', factsVersion: 'job-rules-2026-10-20' })
    expect(by('li-esl')).toMatchObject({ status: 'ready' })
    expect(by('li-vi')).toMatchObject({ status: 'dropped', statusReason: 'deny:vietnamese-oriented', factsVersion: RULES_VERSION })
  })

  it('a re-read copy never brings back a job a later copy already carries (opus, gate 12f)', async () => {
    T.posts = [
      post('a', { status: 'dropped', statusReason: 'deny:vietnamese-oriented', factsVersion: 'job-rules-2026-10-20', receivedAt: new Date('2026-10-21T00:30:00Z') }),
      post('b', { status: 'ready', factsVersion: RULES_VERSION, textSig: textSig(AD) }),
      // and a row from before versions were stored: read again too
      post('legacy', { status: 'held', statusReason: 'undated', factsVersion: null, text: `${AD} (legacy)` }),
    ]
    await runJobDms({ dryRun: false, now: DAY })
    expect(T.posts.find((p) => p.id === 'a')).toMatchObject({ status: 'dropped', statusReason: 'duplicate' })
    expect(T.posts.find((p) => p.id === 'legacy')).toMatchObject({ factsVersion: RULES_VERSION })
  })

  it('posts read under older rules never keep a NEW post waiting (codex + opus, gate 12c)', async () => {
    T.posts = Array.from({ length: 60 }, (_, i) => post(`old-${i}`, { status: 'dropped', statusReason: 'kind:other', factsVersion: 'job-rules-2026-10-20', receivedAt: new Date('2026-10-21T00:30:00Z'), text: `${AD} (${i})` }))
    T.posts.push(post('new'))
    await runJobDms({ dryRun: false, now: DAY })
    expect(T.posts.find((p) => p.id === 'new')).toMatchObject({ status: 'ready' })
    expect(T.posts.filter((p) => p.factsVersion === RULES_VERSION)).toHaveLength(60) // the run's budget
  })

  it('…nor a busy mailbox a fix: half of every run is kept for posts under older rules (opus, gate 12d)', async () => {
    T.posts = Array.from({ length: 61 }, (_, i) => post(`new-${i}`, { text: `${AD} (${i})` }))
    T.posts.push(post('stale', { status: 'ready', factsVersion: 'job-rules-2026-10-20', receivedAt: new Date('2026-10-21T00:30:00Z'), text: `${AD} (stale)` }))
    await runJobDms({ dryRun: false, now: DAY })
    expect(T.posts.find((p) => p.id === 'stale')).toMatchObject({ factsVersion: RULES_VERSION })
    expect(T.posts.filter((p) => p.status === 'new')).toHaveLength(2) // 59 of the 61 new ones, and the stale one
  })

  it('a Spanish class goes to the teacher who teaches Spanish — not one who teaches French, nor an English teacher (2026-10-21)', async () => {
    T.posts = [post('es', { text: 'I am looking for 1 teacher who can teach Spanish for 1 kid class 2 hours a day in the morning in District 7. Message me on Zalo.' })]
    T.teachers = [
      { ...teacher, profileId: 't-es', subjects: ['general-english', 'other-language'], teachLanguages: ['Spanish'] },
      { ...teacher, profileId: 't-fr', subjects: ['general-english', 'other-language'], teachLanguages: ['French'] },
      { ...teacher, profileId: 't-en' },
    ]
    await runJobDms({ dryRun: false, now: DAY })
    const to = (id: string) => calls.createMany.flat().filter((r) => r.profileId === id).map((r) => r.jobKey)
    expect(to('t-es')).toContain('post:es')
    expect(to('t-fr')).not.toContain('post:es')
    expect(to('t-en')).not.toContain('post:es')
  })

  it('a copy older than 30 days does not take the job from a repost', async () => {
    T.posts = [post('old', { status: 'ready', textSig: textSig(AD), receivedAt: new Date(DAY.getTime() - 40 * 86_400_000), factsVersion: 'x' })]
    T.posts[0].status = 'expired'
    T.posts.push(post('repost'))
    await runJobDms({ dryRun: false, now: DAY })
    expect(T.posts.find((p) => p.id === 'repost')).toMatchObject({ status: 'ready' })
  })

  it('a pause nobody lifted for 14 days becomes a withdrawal', async () => {
    await runJobDms({ dryRun: false, now: DAY })
    expect(calls.consentUpdates).toContainEqual({
      where: { optIn: true, pausedAt: { lt: new Date(DAY.getTime() - 14 * 86_400_000) } },
      data: { optIn: false, withdrawnAt: DAY, pausedAt: null, updatedAt: DAY },
    })
  })

  it('live, in quiet hours: reads but sends nothing', async () => {
    mode.value = 'live'
    T.posts = [post('1')]
    expect(await runJobDms({ dryRun: false, now: NIGHT })).toMatchObject({ mode: 'live', stopped: 'quiet', sent: 0 })
    expect(sendJobDm).not.toHaveBeenCalled()
  })

  it('live, in the day: one message through sendJobDm, with the jobs it lists', async () => {
    mode.value = 'live'
    T.posts = [post('1')]
    const r = await runJobDms({ dryRun: false, now: DAY })
    expect(r).toMatchObject({ sent: 1, failed: 0 })
    expect(sendJobDm).toHaveBeenCalledWith(expect.objectContaining({ teacherProfileId: 't-1', operatorId: 'op-1', kind: 'jobs', jobs: [expect.objectContaining({ key: 'post:1' })] }))
  })

  it('dry run: counts only — no post is written, Laya is not asked', async () => {
    T.posts = [post('1')]
    const r = await runJobDms({ dryRun: true, now: DAY })
    expect(r).toMatchObject({ mode: 'dry', read: 1, ready: 1 })
    expect(T.posts[0]).toMatchObject({ status: 'new' })
    expect(calls.createMany).toEqual([])
    expect(layaAnswers).not.toHaveBeenCalled()
  })

  it('the lock is released by its owner only', async () => {
    T.posts = [post('1')]
    await runJobDms({ dryRun: false, now: DAY })
    expect(lock.held).toBe(false)
  })

  it('one run at a time: a second run while the lock is held does nothing', async () => {
    lock.held = true
    T.posts = [post('1')]
    expect(await runJobDms({ dryRun: false, now: DAY })).toMatchObject({ stopped: 'busy', read: 0 })
    expect(T.posts[0]).toMatchObject({ status: 'new' })
  })

  it('retention: content goes at 30 days, the shell (key + signature) stays to 180 days, then goes', async () => {
    const old = (id: string, days: number) => post(id, { status: 'ready', textSig: textSig(AD), receivedAt: new Date(DAY.getTime() - days * 86_400_000) })
    T.posts = [old('fresh', 5), old('month', 31), old('half-year', 181)]
    await purgeJobPosts(DAY)
    expect(T.posts.map((p) => p.id)).toEqual(['fresh', 'month'])
    expect(T.posts[1]).toMatchObject({ text: PURGED_TEXT, title: null, url: null, facts: null, status: 'ready', textSig: textSig(AD) })
    expect(T.posts[0]).toMatchObject({ text: AD })
  })

  it('a signature is the text alone — a LinkedIn text opens with its title line, so boilerplate under two titles differs', () => {
    expect(textSig('English Teacher · ILA · Hanoi\nStandard description.')).not.toBe(textSig('IELTS Teacher · ILA · Hanoi\nStandard description.'))
    expect(textSig('Same words. See more')).toBe(textSig('Same words.'))
  })

})

describe('a LinkedIn job is read once per field (the first alert, 2026-10-21)', () => {
  const li = (id: string, title: string, company: string, place: string) => post(id, {
    source: 'linkedin', title, company, locationText: place, text: `${title} · ${company} · ${place}`, groupPublic: null,
    url: `https://www.linkedin.com/jobs/view/${id}/`, sourceName: 'LinkedIn',
  })
  it('English jobs in Ho Chi Minh City are kept; the Vietnamese one is dropped as for Vietnamese teachers', async () => {
    T.posts = [
      li('4479590744', 'English Second Language Teacher- Vietnam', 'English 1', 'Ho Chi Minh City, Ho Chi Minh City, Vietnam'),
      li('4479360254', 'PYP Stem Specialist Teacher', 'Tesla Education', 'Ho Chi Minh City, Vietnam'),
      li('4480000002', 'Teacher', 'ABC', 'Ho Chi Minh City, Ho Chi Minh City, Vietnam'), // read twice, a short title went over
      li('4480720160', 'Giáo Viên Tiếng Anh Mầm non – Pathway School', 'Pathway School', 'Ho Chi Minh City, Ho Chi Minh City, Vietnam'),
    ]
    await runJobDms({ dryRun: false, now: DAY })
    const row = (id: string) => T.posts.find((p) => p.id === id)
    expect(row('4479590744')).toMatchObject({ status: 'ready', statusReason: null })
    expect(row('4479360254')).toMatchObject({ status: 'ready', statusReason: null })
    expect(row('4480000002')).toMatchObject({ status: 'ready', statusReason: null })
    expect(row('4480720160')).toMatchObject({ status: 'dropped', statusReason: 'deny:vietnamese-oriented' })
  })
})

describe("eno.vn's own listings — the first shadow grading (2026-10-21)", () => {
  const listing = (id: string, o: Row): Row => ({ id, title: '', description: '', city: 'Hồ Chí Minh', salaryM: null, attributes: '{}', createdAt: new Date('2026-10-20T01:00:00Z'), sellerId: 'a-school', ...o })
  it('another subject, a Vietnamese job posted here and a foreigners-only one are never offered; an IMPORTED Vietnamese title still is', async () => {
    T.listings = [
      // fits the teacher in every other way (kids, part-time, District 7): only its TITLE keeps it out
      listing('econ', { title: 'Economics Teacher — ABC Academy', description: 'Economics classes for kids, part-time, in District 7.' }),
      listing('viet', { title: 'Giáo viên dạy tiếng anh giao tiếp', description: 'Phụ trách giảng dạy các lớp tiếng Anh giao tiếp cho trẻ em tại Quận 7, lương 5 triệu.', salaryM: 5 }),
      listing('expat', { title: '[Expat Only] English Teacher / Part-Time (20H/week)', description: 'Kids classes in District 7.' }),
      listing('esl', { title: 'ESL Teacher for kids — Power English', description: 'Teach English to kids in District 7, part-time.' }),
      // filed under a job board's own seller: IMPORTED (job-listing.ts — the importer kept foreigner-oriented jobs only)
      // as the importer files it (job-listing.ts jobExternalId — opus, gate 12d)
      listing('imported', { title: 'Giáo viên tiếng Anh cho trẻ em', description: 'Dạy tiếng Anh cho trẻ em tại Quận 7, bán thời gian.', ...jobExternalId('careerlink-teach', 'https://www.careerlink.vn/tim-viec-lam/giao-vien-tieng-anh-da-nang/3629784') }),
      // a board's seller without that board's id is not proof of an import (codex, gates 12b, 12c)
      listing('unproven', { title: 'Giáo viên tiếng Anh giao tiếp', description: 'Dạy tiếng Anh giao tiếp cho trẻ em tại Quận 7, bán thời gian.', sellerId: JOB_BOARDS.careerlink.sellerId }),
      listing('other-board', { title: 'Giáo viên tiếng Anh mầm non', description: 'Dạy tiếng Anh mầm non tại Quận 7, bán thời gian.', sellerId: JOB_BOARDS.careerlink.sellerId, externalId: 'teast:abc' }),
    ]
    await runJobDms({ dryRun: false, now: DAY })
    const offered = new Set(calls.createMany.flat().map((r) => r.jobKey))
    expect(offered.has('listing:esl')).toBe(true)
    expect(offered.has('listing:imported')).toBe(true)
    for (const id of ['econ', 'viet', 'expat', 'unproven', 'other-board']) expect(offered.has(`listing:${id}`), id).toBe(false)
  })

  it('a LinkedIn job also listed here is in a message once; two schools\' "English Teacher" stay two (2026-10-21)', async () => {
    const title = 'Part-time English Teacher for Kids – Sunrise Academy, District 7'
    T.listings = [
      listing('sunrise', { title, description: 'Kids classes in District 7, part-time.' }),
      listing('generic', { title: 'English Teacher', description: 'English for kids in District 7, part-time.' }),
    ]
    const li = (id: string, t: string, company: string) => post(id, {
      source: 'linkedin', title: t, company, locationText: 'District 7, Ho Chi Minh City', text: `${t} · ${company} · District 7, Ho Chi Minh City`,
      groupPublic: null, url: `https://www.linkedin.com/jobs/view/${id}/`, sourceName: 'LinkedIn',
    })
    T.posts = [li('4490000001', title, 'Sunrise Academy'), li('4490000002', 'English Teacher', 'Other School')]
    await runJobDms({ dryRun: false, now: DAY })
    const offered = new Set(calls.createMany.flat().map((r) => r.jobKey))
    // the listing stays — its page and its pay; the LinkedIn copy gives way (gates 12h–12l)
    expect(offered.has('listing:sunrise')).toBe(true)
    expect(offered.has('post:4490000001')).toBe(false)
    expect(offered.has('listing:generic')).toBe(true)
    expect(offered.has('post:4490000002')).toBe(true)
  })

  it('two listings with the same long title are two jobs — one a day, as two same lines always were; only a LinkedIn copy ever gives way for good (gate 12l)', async () => {
    const title = 'Full-time ESL Teacher for Kids – District 7, Ho Chi Minh City'
    T.listings = [listing('a', { title, description: 'School A: kids classes in District 7, part-time.' }), listing('b', { title, description: 'School B: kids classes in District 7, part-time.' })]
    await runJobDms({ dryRun: false, now: DAY })
    expect(calls.createMany.flat().map((r) => String(r.jobKey)).filter((k) => k.startsWith('listing:'))).toHaveLength(1)
    await runJobDms({ dryRun: false, now: new Date(DAY.getTime() + 86_400_000) })
    const offered = new Set(calls.createMany.flat().map((r) => r.jobKey))
    expect(offered.has('listing:a')).toBe(true)
    expect(offered.has('listing:b')).toBe(true)
  })

  it('…nor the listing today after its LinkedIn copy yesterday (codex, gate 12m)', async () => {
    const title = 'Part-time English Teacher for Kids – Sunrise Academy, District 7'
    T.listings = [listing('sunrise', { title, description: 'Kids classes in District 7, part-time.' })]
    T.posts = [post('4490000001', {
      source: 'linkedin', title, company: 'Sunrise Academy', locationText: 'District 7, Ho Chi Minh City', text: `${title} · Sunrise Academy · District 7, Ho Chi Minh City`,
      groupPublic: null, url: 'https://www.linkedin.com/jobs/view/4490000001/', sourceName: 'LinkedIn',
    })]
    T.dms = [{ profileId: 't-1', jobKey: 'post:4490000001', kind: 'jobs', day: '2026-10-20', mode: 'shadow' }]
    await runJobDms({ dryRun: false, now: DAY })
    expect(calls.createMany.flat().map((r) => r.jobKey)).not.toContain('listing:sunrise')
    // the control: with nothing offered yesterday, the listing goes out (opus, gate 12o)
    T.dms = []
    calls.createMany = []
    await runJobDms({ dryRun: false, now: DAY })
    expect(calls.createMany.flat().map((r) => r.jobKey)).toContain('listing:sunrise')
  })

  it('a teacher offered the listing yesterday is not offered its LinkedIn copy today (opus, gate 12k)', async () => {
    const title = 'Part-time English Teacher for Kids – Sunrise Academy, District 7'
    T.listings = [listing('sunrise', { title, description: 'Kids classes in District 7, part-time.' })]
    T.posts = [post('4490000001', {
      source: 'linkedin', title, company: 'Sunrise Academy', locationText: 'District 7, Ho Chi Minh City', text: `${title} · Sunrise Academy · District 7, Ho Chi Minh City`,
      groupPublic: null, url: 'https://www.linkedin.com/jobs/view/4490000001/', sourceName: 'LinkedIn',
    })]
    T.dms = [{ profileId: 't-1', jobKey: 'listing:sunrise', kind: 'jobs', day: '2026-10-20', mode: 'shadow' }]
    await runJobDms({ dryRun: false, now: DAY })
    expect(calls.createMany.flat().map((r) => r.jobKey)).not.toContain('post:4490000001')
    // the control: without the listing, the LinkedIn copy goes out (opus, gate 12o)
    T.listings = []
    T.dms = []
    calls.createMany = []
    await runJobDms({ dryRun: false, now: DAY })
    expect(calls.createMany.flat().map((r) => r.jobKey)).toContain('post:4490000001')
  })

  it('…but a shorter title is not proof: another school\'s "Part-time English Teacher for Kids" stays its own job (codex + opus, gate 12h)', async () => {
    // the very same six words, from two schools
    T.listings = [listing('sunrise', { title: 'Part-time English Teacher for Kids', description: 'Sunrise Academy: kids classes in District 7, part-time.' })]
    T.posts = [post('4490000003', {
      source: 'linkedin', title: 'Part-time English Teacher for Kids', company: 'Moonlight School', locationText: 'District 7, Ho Chi Minh City',
      text: 'Part-time English Teacher for Kids · Moonlight School · District 7, Ho Chi Minh City', groupPublic: null,
      url: 'https://www.linkedin.com/jobs/view/4490000003/', sourceName: 'LinkedIn',
    })]
    await runJobDms({ dryRun: false, now: DAY })
    const offered = new Set(calls.createMany.flat().map((r) => r.jobKey))
    expect(offered.has('listing:sunrise')).toBe(true)
    expect(offered.has('post:4490000003')).toBe(true)
  })
})

describe("the live audit (2026-10-22) — a listing's attributes", () => {
  const l = { id: 'x', title: 'English Teacher — ABC Academy', description: 'Teach English to kids in District 7.', city: 'Hồ Chí Minh', salaryM: null, createdAt: new Date('2026-10-20T01:00:00Z'), sellerId: 'a-school', externalId: null }
  it('Listing.attributes is a JSON string: its job type and salary are read, and the line shows the rules\' own figure', () => {
    const job = jobFromListing({ ...l, attributes: JSON.stringify({ salaryText: '450,000 VND / hour', jobtype: 'parttime' }) })!
    expect(job.employment).toEqual(['part_time'])
    expect(job.pay).toMatchObject({ min: 450_000, unit: 'hour' })
    expect(job.item.pay).toBe('450,000 đ / hour')
    // a board's hourly figure labelled "/ month" is no month's pay — and the line never prints the board's words
    expect(jobFromListing({ ...l, attributes: JSON.stringify({ salaryText: '550,000 VND / month', jobtype: 'fulltime' }) })!.item.pay).toBeUndefined()
    // unreadable attributes read as none
    expect(jobFromListing({ ...l, attributes: '{oops' })!.employment).toEqual([])
  })
})
