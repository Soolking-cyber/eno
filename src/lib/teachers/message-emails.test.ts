import { beforeEach, describe, expect, it, vi } from 'vitest'

// The teacher message email rule (owner, 2026-10-12): someone new (a school message in the last 48 h) → an email at once
// (≤ 8 in any 24 h); otherwise one reminder a day, in the 08:00 Vietnam run, while anything is unread; opt-outs never.
// Plus the read (only threads the inbox shows, whose newest standing message is the school's, of live teachers, newest
// first) and the claim: one transaction that wins the teacher's state by compare-and-set, re-reads the WHOLE rule for the
// threads it is about, records the schools it covers — and an undo that touches only its own claim. No database.
const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  findManyArgs: null as unknown,
  blocked: new Map<string, string[]>(),
  groupRows: [] as { profileId: string; emailedAt: Date }[],
  groupArgs: null as unknown,
  tx: null as unknown,
  txArray: null as unknown,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/unread', () => ({ liveForSeller: () => ({ OR: ['live-for-seller'] }) }))
vi.mock('@/lib/support-thread', () => ({ SUPPORT_SELLER_ID: 'support-seller' }))
vi.mock('@/lib/user-blocks', () => ({ blockedConversationIds: async (me: string) => h.blocked.get(me) ?? [] }))
vi.mock('@/lib/db', () => ({
  db: {
    conversation: { findMany: async (args: unknown) => { h.findManyArgs = args; return h.rows } },
    teacherMessageEmailThread: { groupBy: async (a: unknown) => { h.groupArgs = a; return h.groupRows } },
    $transaction: async (arg: unknown) => {
      if (Array.isArray(arg)) { h.txArray = arg; return Promise.all(arg) }
      return (arg as (tx: unknown) => Promise<unknown>)(h.tx)
    },
  },
}))

const {
  MESSAGE_EMAIL_RULES, vnDayStart, vnHour, planMessageEmails, loadUnreadTeacherThreads, loadNewEmailsLast24h, claimMessageEmail, releaseMessageEmail,
} = await import('./message-emails')
const { db } = await import('@/lib/db')

const at = (iso: string) => new Date(iso).getTime()
// 08:20 Vietnam time on 12 October (01:20 UTC): the reminder run.
const REMINDER_RUN = at('2026-10-12T01:20:00Z')
// 15:07 Vietnam time: not the reminder run.
const AFTERNOON = at('2026-10-12T08:07:00Z')
// A school message an hour before the afternoon run unless said otherwise.
const thread = (conversationId: string, teacherProfileId = 't1', lastSchoolMessageAt = new Date(AFTERNOON - 60 * 60_000)) =>
  ({ conversationId, teacherProfileId, unread: 1, lastSchoolMessageAt })
const plan = (threads: ReturnType<typeof thread>[], o: { state?: { lastEmailAt: Date | null; optedOutAt: Date | null }; emailed?: string[]; today?: number; now?: number } = {}) =>
  planMessageEmails(threads, new Map(o.state ? [['t1', o.state]] : []), new Set(o.emailed ?? []), new Map(o.today ? [['t1', o.today]] : []), o.now ?? AFTERNOON)

describe('the Vietnam clock', () => {
  it('days start at midnight UTC+7 and hours are Vietnam hours', () => {
    expect(new Date(vnDayStart(at('2026-10-12T01:20:00Z'))).toISOString()).toBe('2026-10-11T17:00:00.000Z')
    expect(new Date(vnDayStart(at('2026-10-11T16:59:59Z'))).toISOString()).toBe('2026-10-10T17:00:00.000Z')
    expect(vnHour(at('2026-10-12T00:59:00Z'))).toBe(7)
    expect(vnHour(at('2026-10-12T01:07:00Z'))).toBe(MESSAGE_EMAIL_RULES.reminderFromHourVn)
  })
})

describe('planMessageEmails — the owner’s rule', () => {
  it('⛔ someone new → an email now, even ten minutes after the last one', () => {
    const p = plan([thread('c1'), thread('c2')], { state: { lastEmailAt: new Date(AFTERNOON - 10 * 60_000), optedOutAt: null }, emailed: ['c1'] })
    expect(p).toEqual([{ teacherProfileId: 't1', kind: 'new', threadIds: ['c1', 'c2'], newThreadIds: ['c2'], hadState: true, prevLastEmailAt: new Date(AFTERNOON - 10 * 60_000) }])
  })

  it('more from a school already emailed about waits for the reminder — nothing in the afternoon', () => {
    expect(plan([thread('c1')], { state: { lastEmailAt: new Date(at('2026-10-10T03:00:00Z')), optedOutAt: null }, emailed: ['c1'] })).toEqual([])
  })

  it('⛔ the reminder: once a Vietnam day, in the 08:00 run, while anything is unread', () => {
    const yesterday = { lastEmailAt: new Date(at('2026-10-11T03:00:00Z')), optedOutAt: null }
    expect(plan([thread('c1')], { state: yesterday, emailed: ['c1'], now: REMINDER_RUN })).toMatchObject([{ kind: 'reminder', threadIds: ['c1'], newThreadIds: [] }])
    // Any email earlier this Vietnam day (07:30 ICT) — no reminder today.
    const thisMorning = { lastEmailAt: new Date(at('2026-10-12T00:30:00Z')), optedOutAt: null }
    expect(plan([thread('c1')], { state: thisMorning, emailed: ['c1'], now: REMINDER_RUN })).toEqual([])
  })

  it('⛔ the morning window catches a failed 08:07 run up — still once a day; never after noon', () => {
    const yesterday = { lastEmailAt: new Date(at('2026-10-11T03:00:00Z')), optedOutAt: null }
    expect(plan([thread('c1')], { state: yesterday, emailed: ['c1'], now: at('2026-10-12T03:37:00Z') })).toMatchObject([{ kind: 'reminder' }]) // 10:37 ICT
    expect(plan([thread('c1')], { state: yesterday, emailed: ['c1'], now: at('2026-10-12T05:07:00Z') })).toEqual([]) // 12:07 ICT
  })

  it('a teacher with no state row yet is reminded in the morning run', () => {
    expect(plan([thread('c1')], { emailed: ['c1'], now: REMINDER_RUN })).toMatchObject([{ kind: 'reminder', hadState: false, prevLastEmailAt: null }])
  })

  it('an opted-out teacher gets nothing — not even for someone new', () => {
    expect(plan([thread('c1')], { state: { lastEmailAt: null, optedOutAt: new Date() } })).toEqual([])
  })

  it('⛔ past 8 "someone new" emails in 24 h, a new school waits — and the morning reminder marks it emailed', () => {
    expect(plan([thread('c9')], { state: { lastEmailAt: new Date(AFTERNOON - 60_000), optedOutAt: null }, today: MESSAGE_EMAIL_RULES.maxNewPer24h })).toEqual([])
    const nextMorning = at('2026-10-13T01:10:00Z')
    expect(plan([thread('c9')], { state: { lastEmailAt: new Date(AFTERNOON - 60_000), optedOutAt: null }, today: MESSAGE_EMAIL_RULES.maxNewPer24h, now: nextMorning }))
      .toMatchObject([{ kind: 'reminder', newThreadIds: ['c9'] }])
  })

  it('⛔ the launch backlog: a never-emailed thread older than 48 h is not "new" — it waits for the morning reminder', () => {
    const old = thread('c-old', 't1', new Date(AFTERNOON - 3 * 24 * 60 * 60_000))
    expect(plan([old])).toEqual([])
    expect(plan([{ ...old, lastSchoolMessageAt: new Date(REMINDER_RUN - 3 * 24 * 60 * 60_000) }], { now: REMINDER_RUN }))
      .toMatchObject([{ kind: 'reminder', threadIds: ['c-old'], newThreadIds: ['c-old'] }])
  })

  it('one email per teacher per run, each counting only that teacher’s threads', () => {
    const p = plan([thread('a', 't1'), thread('b', 't2'), thread('c', 't1')])
    expect(p.map((e) => [e.teacherProfileId, e.threadIds])).toEqual([['t1', ['a', 'c']], ['t2', ['b']]])
  })
})

describe('loadUnreadTeacherThreads — the inbox’s unread, live teachers only', () => {
  beforeEach(() => { h.rows = []; h.blocked = new Map() })

  it('asks for unread teacher threads the inbox shows, of live teachers, never the support desk', async () => {
    await loadUnreadTeacherThreads(db as never)
    const where = JSON.stringify((h.findManyArgs as { where: unknown }).where)
    expect(where).toContain('"sellerUnread":{"gt":0}')
    expect(where).toContain('"listingType":"teacher"')
    expect(where).toContain('"status":"live"')
    expect(where).toContain('"sellerId":{"not":"support-seller"}')
    expect(where).toContain('live-for-seller')
    expect((h.findManyArgs as { orderBy: unknown }).orderBy).toEqual({ lastMessageAt: 'desc' }) // newest first: a backlog never starves new messages
  })

  it('⛔ only while the newest standing message is the school’s; blocked threads never count', async () => {
    const sent = new Date('2026-10-12T05:00:00Z')
    const row = (id: string, last: string | null, teacher = 't1') => ({ id, buyerProfileId: 'school', sellerProfileId: teacher, sellerUnread: 2, messages: last ? [{ senderProfileId: last, createdAt: sent }] : [] })
    h.rows = [row('ok', 'school'), row('recalled', null), row('teacherLast', 't1'), row('blocked', 'school')]
    h.blocked.set('t1', ['blocked'])
    expect(await loadUnreadTeacherThreads(db as never)).toEqual([{ conversationId: 'ok', teacherProfileId: 't1', unread: 2, lastSchoolMessageAt: sent }])
  })
})

describe('loadNewEmailsLast24h', () => {
  it('counts distinct claim times per teacher', async () => {
    const t = new Date()
    h.groupRows = [{ profileId: 't1', emailedAt: t }, { profileId: 't1', emailedAt: new Date(t.getTime() + 1) }, { profileId: 't2', emailedAt: t }]
    expect([...(await loadNewEmailsLast24h(db as never, ['t1', 't2'], Date.now()))]).toEqual([['t1', 2], ['t2', 1]])
    // Only "someone new" emails count toward the cap — a reminder that marked the backlog does not (codex, gate).
    expect(JSON.stringify(h.groupArgs)).toContain('"kind":"new"')
  })
})

describe('claimMessageEmail / releaseMessageEmail', () => {
  const claimAt = new Date('2026-10-12T08:07:01.123Z')
  const prev = new Date('2026-10-11T01:07:00.000Z')
  const e = (o: Partial<Parameters<typeof claimMessageEmail>[1]> = {}) => ({
    teacherProfileId: 't1', kind: 'new' as const, threadIds: ['c1', 'c2'], newThreadIds: ['c2'], hadState: true, prevLastEmailAt: prev, ...o,
  })
  const tx = (o: { moved?: number; still?: { id: string; last: string }[]; made?: number; createThrows?: unknown } = {}) => {
    const calls: Record<string, unknown[]> = { updateMany: [], create: [], createMany: [], findMany: [] }
    const still = o.still ?? [{ id: 'c2', last: 'school' }]
    h.tx = {
      teacherMessageEmailState: {
        updateMany: async (a: unknown) => { calls.updateMany.push(a); return { count: o.moved ?? 1 } },
        create: async (a: unknown) => { calls.create.push(a); if (o.createThrows) throw o.createThrows; return {} },
      },
      conversation: {
        findMany: async (a: unknown) => {
          calls.findMany.push(a)
          return still.map((r) => ({ id: r.id, buyerProfileId: 'school', sellerProfileId: 't1', sellerUnread: 1, messages: [{ senderProfileId: r.last, createdAt: new Date() }] }))
        },
      },
      teacherMessageEmailThread: { createMany: async (a: { data: unknown[] }) => { calls.createMany.push(a); return { count: o.made ?? a.data.length } } },
    }
    return calls
  }

  it('⛔ moves lastEmailAt only from exactly what the plan read, never past an opt-out', async () => {
    const calls = tx()
    expect(await claimMessageEmail(db as never, e(), claimAt)).toEqual({ threads: 1, newThreads: 1 })
    expect(calls.updateMany[0]).toEqual({ where: { profileId: 't1', lastEmailAt: prev, optedOutAt: null }, data: { lastEmailAt: claimAt, updatedAt: claimAt } })
    expect(calls.createMany[0]).toEqual({ data: [{ conversationId: 'c2', profileId: 't1', emailedAt: claimAt, kind: 'new' }], skipDuplicates: true })
  })

  it('another run (or an unsubscribe) got there first → no claim', async () => {
    tx({ moved: 0 })
    expect(await claimMessageEmail(db as never, e(), claimAt)).toBeNull()
  })

  it('a first claim that races another create (unique violation) → no claim', async () => {
    tx({ createThrows: Object.assign(new Error('dup'), { code: 'P2002' }) })
    expect(await claimMessageEmail(db as never, e({ hadState: false, prevLastEmailAt: null }), claimAt)).toBeNull()
  })

  it('⛔ the claim re-reads the whole rule for every thread the email is about', async () => {
    const calls = tx()
    await claimMessageEmail(db as never, e(), claimAt)
    const where = JSON.stringify((calls.findMany[0] as { where: unknown }).where)
    expect(where).toContain('"id":{"in":["c1","c2"]}')
    expect(where).toContain('"sellerProfileId":"t1"')
    expect(where).toContain('"status":"live"')
    expect(where).toContain('"sellerUnread":{"gt":0}')
  })

  it('⛔ read, switched off, recalled or blocked since the plan → nothing eligible → no claim', async () => {
    tx({ still: [] })
    expect(await claimMessageEmail(db as never, e(), claimAt)).toBeNull()
    tx({ still: [{ id: 'c2', last: 't1' }] }) // the teacher answered: the newest standing message is theirs
    expect(await claimMessageEmail(db as never, e(), claimAt)).toBeNull()
    h.blocked.set('t1', ['c2']) // read BEFORE the transaction, from the global client
    tx()
    expect(await claimMessageEmail(db as never, e(), claimAt)).toBeNull()
    h.blocked = new Map()
  })

  it('⛔ the email counts what the claim read: an older thread read since the plan is not counted or marked (codex, gate)', async () => {
    // A "new" email: c2 (new) still eligible, c1 (older) read since → one thread, one new school.
    tx({ still: [{ id: 'c2', last: 'school' }] })
    expect(await claimMessageEmail(db as never, e(), claimAt)).toEqual({ threads: 1, newThreads: 1 })
    // The new school read since, the older thread still unread → not a "new" email at all.
    tx({ still: [{ id: 'c1', last: 'school' }] })
    expect(await claimMessageEmail(db as never, e(), claimAt)).toBeNull()
    // A reminder marks only the never-emailed threads still eligible, stamped 'reminder'.
    const calls = tx({ still: [{ id: 'c1', last: 'school' }] })
    expect(await claimMessageEmail(db as never, e({ kind: 'reminder', newThreadIds: ['c1', 'c2'] }), claimAt)).toEqual({ threads: 1, newThreads: 1 })
    expect(calls.createMany[0]).toEqual({ data: [{ conversationId: 'c1', profileId: 't1', emailedAt: claimAt, kind: 'reminder' }], skipDuplicates: true })
  })

  it('a "someone new" thread another run already recorded → no claim', async () => {
    tx({ made: 0 })
    expect(await claimMessageEmail(db as never, e(), claimAt)).toBeNull()
  })

  it('any other error is not swallowed', async () => {
    tx({ createThrows: new Error('db down') })
    await expect(claimMessageEmail(db as never, e({ hadState: false }), claimAt)).rejects.toThrow('db down')
  })

  it('⛔ the undo after a refused send touches only this claim: its time on the state, its rows', async () => {
    const writes: unknown[] = []
    const fake = {
      ...db,
      teacherMessageEmailState: { updateMany: (a: unknown) => { writes.push(['state', a]); return Promise.resolve({ count: 1 }) } },
      teacherMessageEmailThread: { deleteMany: (a: unknown) => { writes.push(['thread', a]); return Promise.resolve({ count: 1 }) } },
    }
    await releaseMessageEmail(fake as never, e(), claimAt)
    expect(writes).toEqual([
      ['state', { where: { profileId: 't1', lastEmailAt: claimAt }, data: { lastEmailAt: prev } }],
      ['thread', { where: { conversationId: { in: ['c2'] }, emailedAt: claimAt } }],
    ])
  })
})
