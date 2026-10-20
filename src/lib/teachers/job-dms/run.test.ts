import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ONE RUN of the teacher job DMs (run.ts) against an in-memory table set: what it reads, drops as a cross-post, matches,
 * records in shadow and sends in live. The database is a small where-interpreter over arrays — only the shapes run.ts
 * uses — so the test pins run.ts's own queries, not a copy of them.
 */
vi.mock('server-only', () => ({}))

type Row = Record<string, unknown>
const T = { posts: [] as Row[], dms: [] as Row[], teachers: [] as Row[] }
const calls = { teacherWhere: [] as unknown[], createMany: [] as Row[][] }

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
      updateMany: vi.fn(async () => ({ count: 0 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    teacherJobDm: {
      findMany: vi.fn(async () => T.dms),
      createMany: vi.fn(async (a: { data: Row[] }) => { calls.createMany.push(a.data); T.dms.push(...a.data); return { count: a.data.length } }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    teacherProfile: { findMany: vi.fn(async (a: { where: unknown }) => { calls.teacherWhere.push(a.where); return T.teachers }) },
    teacherJobMatch: { findMany: vi.fn(async () => []) },
    teacherJobDmDay: { findMany: vi.fn(async () => []) },
    conversation: { findMany: vi.fn(async () => []) },
    listing: { findMany: vi.fn(async () => []) },
    $queryRaw: vi.fn(async () => stops.rows),
  },
}))
const mode = { value: 'shadow' as string | null }
vi.mock('@/lib/ratelimit', () => ({ kv: { get: vi.fn(async () => mode.value) } }))
vi.mock('./laya', () => ({ layaAnswers: vi.fn(async () => null) }))
const desk = { operator: 'op-1' as string | null }
const sendJobDm = vi.fn(async () => ({ sent: true, conversationId: 'c1', messageId: 'm1' }))
const honourStop = vi.fn(async () => true)
const stops = { rows: [] as { conversationId: string; teacher: string; body: string }[] }
vi.mock('./desk', () => ({
  resolveJobsOperatorProfileId: vi.fn(async () => desk.operator),
  sendJobDm: (...a: unknown[]) => (sendJobDm as (...x: unknown[]) => unknown)(...a),
  honourStop: (...a: unknown[]) => (honourStop as (...x: unknown[]) => unknown)(...a),
}))

const { runJobDms, textSig } = await import('./run')
const { JOB_DM_NOTICE_VERSION } = await import('./constants')

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
  T.posts = []; T.dms = []; T.teachers = [teacher]
  calls.teacherWhere = []; calls.createMany = []
  mode.value = 'shadow'; desk.operator = 'op-1'
  sendJobDm.mockClear(); honourStop.mockClear(); stops.rows = []
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

  it('both modes match only teachers who switched job messages on under the current notice', async () => {
    T.posts = [post('1')]
    await runJobDms({ dryRun: false, now: DAY })
    mode.value = 'live'
    await runJobDms({ dryRun: false, now: DAY })
    for (const w of calls.teacherWhere) expect(w).toMatchObject({ profile: { teacherJobDmConsent: { optIn: true, noticeVersion: JOB_DM_NOTICE_VERSION } } })
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

  it('dry run: counts only — no post is written', async () => {
    T.posts = [post('1')]
    const r = await runJobDms({ dryRun: true, now: DAY })
    expect(r).toMatchObject({ mode: 'dry', read: 1, ready: 1 })
    expect(T.posts[0]).toMatchObject({ status: 'new' })
    expect(calls.createMany).toEqual([])
  })
})
