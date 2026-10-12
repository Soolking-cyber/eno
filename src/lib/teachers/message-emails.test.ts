import { beforeEach, describe, expect, it, vi } from 'vitest'

// The teacher message email rule, v2 (owner, 2026-10-12: "maximum 3 reminders 1 hr 24 hours 3 days … 3 max per 1 notif").
// An episode per thread, anchored on the oldest unread school message (recalled ones included — the counter ignores a
// recall) and RECORDED on the thread's row (`first@<anchor>`), gets at most three emails — an hour, a day and three days
// in — each only while still unread; a follow-up after the third starts a new episode with its own three. The bounds,
// each exact: one email per teacher per run, an hour between emails, a day between two about the same thread, four in any
// 24 h, none 22:00–07:00 Vietnam time, nothing a week old. The claim: one transaction, compare-and-set on the teacher's
// state, the whole rule re-read (same episode or dropped), the stage due at claim time, each row moved on conditionally —
// and an undo that touches only its own claim. No database: the Prisma calls are faked (the window query's SQL was run
// read-only against production on 2026-10-12).
type Conv = { id: string; buyerProfileId: string; sellerProfileId: string; sellerUnread: number; messages: { senderProfileId: string }[] }
type Row = { createdAt: Date; deletedAt: Date | null }
const h = vi.hoisted(() => ({
  convs: [] as Conv[],
  findManyArgs: null as unknown,
  /** per conversation: its school rows, newest first */
  windows: new Map<string, Row[]>(),
  blocked: new Map<string, string[]>(),
  groupRows: [] as { profileId: string; emailedAt: Date }[],
  tx: null as unknown,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/unread', () => ({ liveForSeller: () => ({ OR: ['live-for-seller'] }) }))
vi.mock('@/lib/support-thread', () => ({ SUPPORT_SELLER_ID: 'support-seller' }))
vi.mock('@/lib/user-blocks', () => ({ blockedConversationIds: async (me: string) => h.blocked.get(me) ?? [] }))
vi.mock('@/lib/db', () => ({
  db: {
    conversation: { findMany: async (args: unknown) => { h.findManyArgs = args; return h.convs } },
    // readWindows' one statement: the ids arrive as its only parameter.
    $queryRaw: async (_sql: TemplateStringsArray, ids: string[]) => ids.flatMap((id) => (h.windows.get(id) ?? []).map((m) => ({ conversationId: id, ...m }))),
    teacherMessageEmailThread: { groupBy: async () => h.groupRows },
    $transaction: async (arg: unknown) => (Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(h.tx)),
  },
}))

const {
  MESSAGE_EMAIL_RULES, stageOf, dueStage, kindFor, parseKind, episodeOf, freshWindow, isQuietHour, quietSoon, vnHour, planMessageEmails,
  loadUnreadTeacherThreads, loadEmailsLast24h, claimMessageEmail, releaseMessageEmail, messageEmailResult,
} = await import('./message-emails')
const { db } = await import('@/lib/db')

const H = 60 * 60 * 1000
const DAY = 24 * H
const NOW = new Date('2026-10-12T08:00:00Z').getTime() // 15:00 in Vietnam
const ago = (ms: number) => new Date(NOW - ms)
const msg = (agoMs: number, recalled = false): Row => ({ createdAt: ago(agoMs), deletedAt: recalled ? new Date(NOW) : null })
/** A thread whose unread window holds school messages this long ago, newest first. */
const thread = (conversationId: string, windowAgo: number[], teacherProfileId = 't1') =>
  ({ conversationId, teacherProfileId, unread: windowAgo.length, window: windowAgo.map((a) => msg(a)) })
/** A v2 row: an email `agoMs` ago that recorded `stage` of the episode anchored `anchorAgo` ago. */
const v2 = (agoMs: number, stage: 1 | 2 | 3, anchorAgo: number) => ({ emailedAt: ago(agoMs), kind: kindFor(stage, ago(anchorAgo)) })
/** A v1 row: no anchor recorded. */
const v1 = (agoMs: number, kind: 'new' | 'reminder') => ({ emailedAt: ago(agoMs), kind })
type L = { emailedAt: Date; kind: string }
type O = { ledger?: [string, L][]; state?: { lastEmailAt: Date | null; optedOutAt: Date | null }; times?: number[]; now?: number }
const plan = (threads: ReturnType<typeof thread>[], o: O = {}) =>
  planMessageEmails(threads, new Map(o.ledger ?? []), new Map(o.state ? [['t1', o.state]] : []), new Map(o.times ? [['t1', new Set(o.times)]] : []), o.now ?? NOW)

describe('the stages and the row’s kind', () => {
  it('an hour, a day, three days — and nothing before the hour', () => {
    expect(dueStage(ago(59 * 60 * 1000), NOW)).toBe(0)
    expect(dueStage(ago(H), NOW)).toBe(1)
    expect(dueStage(ago(DAY), NOW)).toBe(2)
    expect(dueStage(ago(3 * DAY), NOW)).toBe(3)
    expect(MESSAGE_EMAIL_RULES.stageAfterMs).toEqual([H, DAY, 3 * DAY])
  })

  it('⛔ a row records its stage AND its episode’s anchor; v1’s rows read as their v2 stage, with no anchor', () => {
    const at = new Date('2026-10-12T01:02:03.004Z')
    expect(kindFor(2, at)).toBe('second@2026-10-12T01:02:03.004Z')
    expect(parseKind(kindFor(3, at))).toEqual({ stage: 3, anchor: at })
    expect(parseKind('new')).toEqual({ stage: 1, anchor: null })
    expect(parseKind('reminder')).toEqual({ stage: 2, anchor: null })
    expect([stageOf('first'), stageOf('second'), stageOf('third'), stageOf(undefined)]).toEqual([1, 2, 3, 0])
  })

  it('quiet hours are 22:00–07:00 Vietnam time (UTC+7, all year)', () => {
    expect(vnHour(Date.parse('2026-10-12T08:00:00Z'))).toBe(15)
    expect(isQuietHour(Date.parse('2026-10-12T14:59:00Z'))).toBe(false) // 21:59
    expect(isQuietHour(Date.parse('2026-10-12T15:00:00Z'))).toBe(true) // 22:00
    expect(isQuietHour(Date.parse('2026-10-12T23:59:00Z'))).toBe(true) // 06:59
    expect(isQuietHour(Date.parse('2026-10-13T00:07:00Z'))).toBe(false) // 07:07 — the run that sends what waited
  })

  it('⛔ no claim within 5 minutes of 22:00 — its send must land before it (codex, gate round 4)', () => {
    expect(quietSoon(Date.parse('2026-10-12T14:54:59Z'))).toBe(false) // 21:54:59
    expect(quietSoon(Date.parse('2026-10-12T14:55:00Z'))).toBe(true) // 21:55
    expect(quietSoon(Date.parse('2026-10-12T23:59:00Z'))).toBe(true) // 06:59 — still quiet, however close 07:00 is
    expect(quietSoon(Date.parse('2026-10-13T00:00:00Z'))).toBe(false) // 07:00
  })

  it('the send ceiling and the quiet hours are planned pauses, not failures', () => {
    const r = { teachers: 3, sent: 1, failed: 0, invalid: 0, unknown: 0, skipped: 0, left: 2 }
    expect(messageEmailResult({ ...r, stopped: 'quiet' }).ok).toBe(true)
    expect(messageEmailResult({ ...r, stopped: 'ceiling' }).ok).toBe(true)
    expect(messageEmailResult({ ...r, stopped: 'deadline' }).ok).toBe(false)
  })
})

describe('episodeOf — recorded, recall-proof, and a follow-up after the third email is a new episode', () => {
  it('no row: the oldest row of the unread window, a RECALLED one included (codex + Opus, plan review)', () => {
    expect(episodeOf([msg(H), msg(3 * H, true)], null, NOW)).toEqual({ anchor: ago(3 * H), stage: 0 })
  })

  it('no standing message from the anchor on, or no window → nothing to email about', () => {
    expect(episodeOf([msg(H, true), msg(3 * H, true)], null, NOW)).toBeNull()
    expect(episodeOf([], null, NOW)).toBeNull()
  })

  it('⛔ a v2 row’s episode goes on while its anchor is still unread — further messages ride it', () => {
    expect(episodeOf([msg(5 * H), msg(30 * H)], v2(29 * H, 1, 30 * H), NOW)).toEqual({ anchor: ago(30 * H), stage: 1 })
  })

  it('⛔ read since (its anchor left the window): a new episode at the oldest unread message', () => {
    expect(episodeOf([msg(2 * H)], v2(20 * H, 2, 50 * H), NOW)).toEqual({ anchor: ago(2 * H), stage: 0 })
  })

  it('⛔ closed by its third email: the next episode starts at the oldest message newer than it — or there is none', () => {
    const third = v2(10 * H, 3, 100 * H)
    expect(episodeOf([msg(2 * H), msg(100 * H)], third, NOW)).toEqual({ anchor: ago(2 * H), stage: 0 })
    expect(episodeOf([msg(100 * H)], third, NOW)).toBeNull()
    expect(episodeOf([msg(2 * H, true), msg(100 * H)], third, NOW)).toBeNull() // the follow-up was recalled
  })

  it('⛔ a follow-up episode’s own row is read as ITS stage, never as the old episode’s (Opus, gate round 2)', () => {
    // M1 200 h ago (closed), M2 26 h ago: the follow-up's first email went 25 h ago — it is at stage 1, not 3.
    expect(episodeOf([msg(26 * H), msg(200 * H)], v2(25 * H, 1, 26 * H), NOW)).toEqual({ anchor: ago(26 * H), stage: 1 })
  })

  it('⛔ an aged-out anchor is NOT a read: a closed episode stays closed on day 7 (Opus, gate round 4)', () => {
    // M1 7 d 1 h ago (its third email 4 d ago), M2 6 d ago — never read: no fourth "last email".
    expect(episodeOf([msg(6 * DAY), msg(7 * DAY + H)], v2(4 * DAY, 3, 7 * DAY + H), NOW)).toBeNull()
    expect(plan([thread('c1', [6 * DAY, 7 * DAY + H])], { ledger: [['c1', v2(4 * DAY, 3, 7 * DAY + H)]] })).toEqual([])
    // A stalled episode (stage 1, its anchor now stale): the oldest message newer than its email starts the next one.
    expect(episodeOf([msg(2 * H), msg(3 * DAY), msg(8 * DAY)], v2(7 * DAY, 1, 8 * DAY), NOW)).toEqual({ anchor: ago(3 * DAY), stage: 0 })
    expect(episodeOf([msg(2 * H), msg(8 * DAY)], v2(7 * DAY, 1, 8 * DAY), NOW)).toEqual({ anchor: ago(2 * H), stage: 0 })
  })

  it('v1 rows: the window’s episode, credited with the stage already due when the email went out', () => {
    expect(episodeOf([msg(100 * H)], v1(99 * H, 'new'), NOW)).toEqual({ anchor: ago(100 * H), stage: 1 })
    expect(episodeOf([msg(100 * H)], v1(70 * H, 'reminder'), NOW)).toEqual({ anchor: ago(100 * H), stage: 2 })
    // v1's morning reminder about a message already 3+ days old was its LAST email (Opus, plan review).
    expect(episodeOf([msg(100 * H)], v1(10 * H, 'reminder'), NOW)).toBeNull()
    expect(episodeOf([msg(H), msg(100 * H)], v1(10 * H, 'reminder'), NOW)).toEqual({ anchor: ago(H), stage: 0 })
    expect(episodeOf([msg(2 * H)], v1(50 * H, 'new'), NOW)).toEqual({ anchor: ago(2 * H), stage: 0 }) // read since
  })
})

describe('planMessageEmails — at most three per episode, every bound exact', () => {
  it('⛔ an hour after the message: stage 1', () => {
    expect(plan([thread('c1', [30 * 60 * 1000])])).toEqual([])
    expect(plan([thread('c1', [70 * 60 * 1000])])).toMatchObject([{ teacherProfileId: 't1', due: [{ conversationId: 'c1', stage: 1, prev: null }] }])
  })

  it('⛔ a day after: stage 2; three days after: stage 3', () => {
    expect(plan([thread('c1', [26 * H])], { ledger: [['c1', v2(25 * H, 1, 26 * H)]] })).toMatchObject([{ due: [{ stage: 2, anchor: ago(26 * H) }] }])
    expect(plan([thread('c1', [73 * H])], { ledger: [['c1', v2(48 * H, 2, 73 * H)]] })).toMatchObject([{ due: [{ stage: 3 }] }])
  })

  it('⛔ after the third email: nothing — until the school writes again, a new episode (a day after that email)', () => {
    expect(plan([thread('c1', [100 * H])], { ledger: [['c1', v2(25 * H, 3, 100 * H)]] })).toEqual([])
    expect(plan([thread('c1', [2 * H, 100 * H])], { ledger: [['c1', v2(25 * H, 3, 100 * H)]] })).toMatchObject([{ due: [{ stage: 1, anchor: ago(2 * H) }] }])
    expect(plan([thread('c1', [2 * H, 100 * H])], { ledger: [['c1', v2(20 * H, 3, 100 * H)]] })).toEqual([])
  })

  it('⛔ a follow-up episode gets its OWN second and third emails (Opus, gate round 2)', () => {
    const w = [26 * H, 200 * H]
    expect(plan([thread('c1', w)], { ledger: [['c1', v2(25 * H, 1, 26 * H)]] })).toMatchObject([{ due: [{ stage: 2, anchor: ago(26 * H) }] }])
    expect(plan([thread('c1', [73 * H, 250 * H])], { ledger: [['c1', v2(48 * H, 2, 73 * H)]] })).toMatchObject([{ due: [{ stage: 3, anchor: ago(73 * H) }] }])
  })

  it('⛔ a missed slot is never sent late: first seen at 30 h, it is stage 2 — one email, not two', () => {
    expect(plan([thread('c1', [30 * H])])).toMatchObject([{ due: [{ stage: 2, prev: null }] }])
  })

  it('⛔ read, then the school wrote again: a NEW episode — stage 1 again', () => {
    expect(plan([thread('c1', [2 * H])], { ledger: [['c1', v2(100 * H, 3, 170 * H)]] })).toMatchObject([{ due: [{ stage: 1 }] }])
  })

  it('⛔ a day between two emails about the same thread, in ANY episode (Opus, gate round 1)', () => {
    expect(plan([thread('c1', [2 * H])], { ledger: [['c1', v2(3 * H, 1, 30 * H)]] })).toEqual([])
    expect(plan([thread('c1', [25 * H])], { ledger: [['c1', v2(23 * H, 1, 25 * H)]] })).toEqual([])
    expect(plan([thread('c1', [26 * H])], { ledger: [['c1', v2(24.5 * H, 1, 26 * H)]] })).toMatchObject([{ due: [{ stage: 2 }] }])
  })

  it('v1 rows: a reminder sent a day in means stage 3 next; one sent past three days was the last', () => {
    expect(plan([thread('c1', [80 * H])], { ledger: [['c1', v1(50 * H, 'reminder')]] })).toMatchObject([{ due: [{ stage: 3 }] }])
    expect(plan([thread('c1', [120 * H])], { ledger: [['c1', v1(30 * H, 'reminder')]] })).toEqual([])
  })

  it('⛔ the v1 → v2 day: a thread whose row is v1’s also waits a day after the teacher’s last email (codex, gate rounds 2–3)', () => {
    // v1's reminder 3 h ago covered this thread but wrote no row for it (it had one): nothing until a day after that email.
    const state = { lastEmailAt: ago(3 * H), optedOutAt: null }
    expect(plan([thread('c1', [80 * H])], { ledger: [['c1', v1(70 * H, 'new')]], state })).toEqual([])
    // ...even when the same reminder recorded ANOTHER thread, so a row holds its time (the mixed case).
    expect(plan([thread('c1', [80 * H])], { ledger: [['c1', v1(70 * H, 'new')]], state, times: [NOW - 3 * H] })).toEqual([])
    // A v2 row is held only to its own day gap; a day after the last email the v1 row's thread goes too.
    expect(plan([thread('c2', [80 * H])], { ledger: [['c2', v2(48 * H, 2, 80 * H)]], state, times: [NOW - 3 * H] })).toMatchObject([{ due: [{ stage: 3 }] }])
    expect(plan([thread('c1', [80 * H])], { ledger: [['c1', v1(70 * H, 'new')]], state: { lastEmailAt: ago(25 * H), optedOutAt: null } })).toMatchObject([{ due: [{ stage: 3 }] }])
  })

  it('⛔ the cap counts the last email even when no row holds it', () => {
    const three = [5, 9, 13].map((x) => NOW - x * H)
    expect(plan([thread('a', [2 * H])], { state: { lastEmailAt: ago(2 * H), optedOutAt: null }, times: three })).toEqual([])
    expect(plan([thread('a', [2 * H])], { state: { lastEmailAt: new Date(three[0]), optedOutAt: null }, times: three })).toMatchObject([{ due: [{ stage: 1 }] }])
  })

  it('⛔ one email records at most 50 threads — the rest ride the next (codex, gate round 4: a claim must stay bounded)', () => {
    const many = Array.from({ length: 55 }, (_, i) => thread(`c${i}`, [2 * H]))
    const [p] = plan(many)
    expect(p.due).toHaveLength(MESSAGE_EMAIL_RULES.maxThreadsPerEmail)
    expect(p.threadIds).toHaveLength(55)
  })

  it('⛔ one email per teacher per run with every thread due; an hour between emails; at most 4 in 24 h', () => {
    expect(plan([thread('a', [2 * H]), thread('b', [30 * H]), thread('c', [10 * 60 * 1000])])).toMatchObject([
      { due: [{ conversationId: 'a', stage: 1 }, { conversationId: 'b', stage: 2 }], threadIds: ['a', 'b', 'c'] },
    ])
    expect(plan([thread('a', [2 * H])], { state: { lastEmailAt: ago(30 * 60 * 1000), optedOutAt: null }, times: [NOW - 30 * 60 * 1000] })).toEqual([])
    const four = [1, 5, 9, 13].map((x) => NOW - x * H)
    expect(plan([thread('a', [2 * H])], { state: { lastEmailAt: new Date(four[0]), optedOutAt: null }, times: four })).toEqual([])
    expect(plan([thread('a', [2 * H])], { state: { lastEmailAt: new Date(four[0]), optedOutAt: null }, times: four.slice(0, 3) })).toMatchObject([{ due: [{ stage: 1 }] }])
  })

  it('⛔ quiet hours: nothing between 22:00 and 07:00 Vietnam time; the 07:07 run sends what waited', () => {
    const night = Date.parse('2026-10-12T16:00:00Z') // 23:00
    const t = { ...thread('a', []), window: [{ createdAt: new Date(night - 2 * H), deletedAt: null }] }
    expect(plan([t], { now: night })).toEqual([])
    expect(plan([t], { now: Date.parse('2026-10-13T00:07:00Z') })).toMatchObject([{ due: [{ stage: 1 }] }])
  })

  it('⛔ nothing about a message more than a week old (the launch backlog)', () => {
    expect(plan([thread('a', [8 * DAY])])).toEqual([])
    expect(plan([thread('a', [6 * DAY])])).toMatchObject([{ due: [{ stage: 3 }] }])
  })

  it('⛔ a stale unread message never mutes the school’s newer ones (Opus, gate round 3 — the shape measured on production)', () => {
    // A recalled message 10 days old, then a standing one 5 days old: the episode is the fresh one's.
    const measured = { ...thread('a', []), window: [msg(5 * DAY), msg(10 * DAY, true)] }
    expect(plan([measured])).toMatchObject([{ due: [{ stage: 3, anchor: ago(5 * DAY) }] }])
    expect(plan([thread('a', [2 * H, 8 * DAY])])).toMatchObject([{ due: [{ stage: 1, anchor: ago(2 * H) }] }])
    // A v2 row whose anchor went stale (its episode stalled while the teacher was opted out): the fresh message starts over.
    expect(plan([thread('a', [2 * H, 8 * DAY])], { ledger: [['a', v2(7 * DAY, 1, 8 * DAY)]] })).toMatchObject([{ due: [{ stage: 1, anchor: ago(2 * H) }] }])
    expect(freshWindow([msg(2 * H), msg(8 * DAY)], NOW)).toEqual([msg(2 * H)])
  })

  it('an opted-out teacher gets nothing', () => {
    expect(plan([thread('a', [2 * H])], { state: { lastEmailAt: null, optedOutAt: new Date() } })).toEqual([])
  })
})

describe('loadUnreadTeacherThreads — the inbox’s unread, live teachers only, with recall-proof windows', () => {
  beforeEach(() => { h.convs = []; h.windows = new Map(); h.blocked = new Map() })
  const conv = (id: string, last: string, unread = 1): Conv => ({ id, buyerProfileId: 'school', sellerProfileId: 't1', sellerUnread: unread, messages: [{ senderProfileId: last }] })

  it('asks for unread teacher threads the inbox shows, of live teachers, never the desk, newest first', async () => {
    await loadUnreadTeacherThreads(db as never)
    const where = JSON.stringify((h.findManyArgs as { where: unknown }).where)
    for (const s of ['"sellerUnread":{"gt":0}', '"listingType":"teacher"', '"status":"live"', '"sellerId":{"not":"support-seller"}', 'live-for-seller']) expect(where).toContain(s)
    expect((h.findManyArgs as { orderBy: unknown }).orderBy).toEqual({ lastMessageAt: 'desc' })
  })

  it('⛔ the window is the last sellerUnread school rows, a RECALLED one included', async () => {
    h.convs = [conv('c1', 'school', 2)]
    const w = [msg(H), msg(3 * H, true)]
    h.windows.set('c1', w)
    expect(await loadUnreadTeacherThreads(db as never)).toEqual([{ conversationId: 'c1', teacherProfileId: 't1', unread: 2, window: w }])
  })

  it('⛔ every unread message recalled, the teacher’s own reply last, or a blocked pair → not news', async () => {
    h.convs = [conv('recalled', 'school'), conv('teacherLast', 't1'), conv('blocked', 'school')]
    h.windows.set('recalled', [msg(H, true)])
    h.windows.set('blocked', [msg(H)])
    h.blocked.set('t1', ['blocked'])
    expect(await loadUnreadTeacherThreads(db as never)).toEqual([])
  })
})

describe('loadEmailsLast24h', () => {
  it('the distinct claim times per teacher', async () => {
    const t = new Date()
    h.groupRows = [{ profileId: 't1', emailedAt: t }, { profileId: 't1', emailedAt: new Date(t.getTime() + 1) }, { profileId: 't2', emailedAt: t }]
    const got = await loadEmailsLast24h(db as never, ['t1', 't2'], Date.now())
    expect([...got.get('t1')!]).toEqual([t.getTime(), t.getTime() + 1])
    expect([...got.get('t2')!]).toEqual([t.getTime()])
  })
})

describe('claimMessageEmail / releaseMessageEmail', () => {
  const claimAt = new Date('2026-10-12T08:07:01.123Z') // 15:07 in Vietnam
  const prevState = new Date('2026-10-11T01:07:00.000Z')
  const anchor = ago(2 * H)
  const oldRow = v2(100 * H, 3, 170 * H)
  const e = (o: Partial<Parameters<typeof claimMessageEmail>[1]> = {}) => ({
    teacherProfileId: 't1', threadIds: ['c1', 'c2', 'c3'], hadState: true, prevLastEmailAt: prevState,
    due: [{ conversationId: 'c1', stage: 1 as const, prev: null, anchor }, { conversationId: 'c2', stage: 1 as const, prev: oldRow, anchor }],
    ...o,
  })
  // The transaction client: the state, the re-read (conversations + each due one's window) and the thread rows.
  const tx = (o: { moved?: number; windows?: Record<string, Row[]>; ids?: string[]; made?: number; rowMoved?: number; createThrows?: unknown } = {}) => {
    const calls: Record<string, unknown[]> = { stateUpdate: [], stateCreate: [], createMany: [], rowUpdate: [], windowReads: [] }
    const windows: Record<string, Row[]> = o.windows ?? { c1: [{ createdAt: anchor, deletedAt: null }], c2: [{ createdAt: anchor, deletedAt: null }], c3: [msg(10 * 60 * 1000)] }
    const ids = o.ids ?? Object.keys(windows)
    h.tx = {
      teacherMessageEmailState: {
        updateMany: async (a: unknown) => { calls.stateUpdate.push(a); return { count: o.moved ?? 1 } },
        create: async (a: unknown) => { calls.stateCreate.push(a); if (o.createThrows) throw o.createThrows; return {} },
      },
      conversation: { findMany: async () => ids.map((id) => ({ id, buyerProfileId: 'school', sellerProfileId: 't1', sellerUnread: windows[id]?.length ?? 1, messages: [{ senderProfileId: 'school' }] })) },
      $queryRaw: async (_sql: TemplateStringsArray, want: string[]) => {
        calls.windowReads.push(...want)
        return want.flatMap((id) => (windows[id] ?? []).map((m) => ({ conversationId: id, ...m })))
      },
      teacherMessageEmailThread: {
        createMany: async (a: { data: unknown[] }) => { calls.createMany.push(a); return { count: o.made ?? a.data.length } },
        updateMany: async (a: unknown) => { calls.rowUpdate.push(a); return { count: o.rowMoved ?? 1 } },
      },
    }
    return calls
  }

  it('⛔ wins the state by compare-and-set, re-reads every window in one statement, records stage AND anchor — conditionally', async () => {
    const calls = tx()
    expect(await claimMessageEmail(db as never, e(), claimAt)).toMatchObject({ counts: { 1: 2, 2: 0, 3: 0 }, unreadThreads: 3 })
    expect(calls.stateUpdate[0]).toEqual({ where: { profileId: 't1', lastEmailAt: prevState, optedOutAt: null }, data: { lastEmailAt: claimAt, updatedAt: claimAt } })
    expect((calls.windowReads as string[]).sort()).toEqual(['c1', 'c2', 'c3'])
    expect(calls.createMany[0]).toEqual({ data: [{ conversationId: 'c1', profileId: 't1', emailedAt: claimAt, kind: kindFor(1, anchor) }], skipDuplicates: true })
    expect(calls.rowUpdate[0]).toEqual({ where: { conversationId: 'c2', emailedAt: oldRow.emailedAt, kind: oldRow.kind }, data: { emailedAt: claimAt, kind: kindFor(1, anchor) } })
  })

  it('⛔ an episode that moved since the plan (read, then a new message) drops that thread — never a stage for the wrong one', async () => {
    tx({ windows: { c1: [msg(10 * 60 * 1000)], c2: [{ createdAt: anchor, deletedAt: null }] } })
    expect(await claimMessageEmail(db as never, e(), claimAt)).toMatchObject({ counts: { 1: 1 }, applied: [{ conversationId: 'c2' }] })
    tx({ windows: { c1: [msg(10 * 60 * 1000)] } })
    expect(await claimMessageEmail(db as never, e({ due: [e().due[0]] }), claimAt)).toBeNull()
  })

  it('⛔ the stage is the one due when CLAIMED: a threshold crossed since the plan is a jump, recorded and counted as such', async () => {
    const crossed = new Date(claimAt.getTime() - DAY - 60 * 1000)
    const calls = tx({ windows: { c1: [{ createdAt: crossed, deletedAt: null }] } })
    const claimed = await claimMessageEmail(db as never, e({ threadIds: ['c1'], due: [{ conversationId: 'c1', stage: 1, prev: null, anchor: crossed }] }), claimAt)
    expect(claimed).toMatchObject({ counts: { 1: 0, 2: 1, 3: 0 } })
    expect(calls.createMany[0]).toMatchObject({ data: [{ conversationId: 'c1', kind: kindFor(2, crossed) }] })
  })

  it('⛔ MAX_AGE and the quiet hours hold at claim time too (codex, gate round 2)', async () => {
    const old = new Date(claimAt.getTime() - 7 * DAY - 60 * 1000)
    tx({ windows: { c1: [{ createdAt: old, deletedAt: null }] } })
    expect(await claimMessageEmail(db as never, e({ threadIds: ['c1'], due: [{ conversationId: 'c1', stage: 3, prev: null, anchor: old }] }), claimAt)).toBeNull()
    const calls = tx()
    expect(await claimMessageEmail(db as never, e(), new Date('2026-10-12T15:00:30Z'))).toBeNull() // 22:00:30
    expect(await claimMessageEmail(db as never, e(), new Date('2026-10-12T14:57:00Z'))).toBeNull() // 21:57 — inside the margin
    expect(calls.stateUpdate).toHaveLength(0)
  })

  it('⛔ "in all" counts only threads with a standing unread message — as the plan does (Opus, gate round 4)', async () => {
    tx({ windows: { c1: [{ createdAt: anchor, deletedAt: null }], c2: [{ createdAt: anchor, deletedAt: null }], c3: [msg(H, true)] } })
    expect(await claimMessageEmail(db as never, e(), claimAt)).toMatchObject({ unreadThreads: 2 })
  })

  it('a follow-up after the third email: the claim finds the same new episode and moves the row on', async () => {
    const third = v2(30 * H, 3, 100 * H)
    const calls = tx({ windows: { c1: [{ createdAt: anchor, deletedAt: null }, msg(100 * H)] } })
    expect(await claimMessageEmail(db as never, e({ threadIds: ['c1'], due: [{ conversationId: 'c1', stage: 1, prev: third, anchor }] }), claimAt)).toMatchObject({ counts: { 1: 1 } })
    expect(calls.rowUpdate[0]).toEqual({ where: { conversationId: 'c1', emailedAt: third.emailedAt, kind: third.kind }, data: { emailedAt: claimAt, kind: kindFor(1, anchor) } })
  })

  it('read or switched off since the plan → nothing eligible → no claim', async () => {
    tx({ windows: {}, ids: [] })
    expect(await claimMessageEmail(db as never, e(), claimAt)).toBeNull()
  })

  it('another run got there first (state, a new row or an old row) → no claim', async () => {
    tx({ moved: 0 }); expect(await claimMessageEmail(db as never, e(), claimAt)).toBeNull()
    tx({ made: 0 }); expect(await claimMessageEmail(db as never, e(), claimAt)).toBeNull()
    tx({ rowMoved: 0 }); expect(await claimMessageEmail(db as never, e(), claimAt)).toBeNull()
    tx({ createThrows: Object.assign(new Error('dup'), { code: 'P2002' }) })
    expect(await claimMessageEmail(db as never, e({ hadState: false, prevLastEmailAt: null }), claimAt)).toBeNull()
  })

  it('any other error is not swallowed', async () => {
    tx({ createThrows: new Error('db down') })
    await expect(claimMessageEmail(db as never, e({ hadState: false }), claimAt)).rejects.toThrow('db down')
  })

  it('⛔ the undo after a refused send touches only this claim: its time on the state, its new rows, its moved rows', async () => {
    const writes: unknown[] = []
    const fake = {
      ...db,
      teacherMessageEmailState: { updateMany: (a: unknown) => { writes.push(['state', a]); return Promise.resolve({ count: 1 }) } },
      teacherMessageEmailThread: {
        deleteMany: (a: unknown) => { writes.push(['delete', a]); return Promise.resolve({ count: 1 }) },
        updateMany: (a: unknown) => { writes.push(['restore', a]); return Promise.resolve({ count: 1 }) },
      },
    }
    await releaseMessageEmail(fake as never, e(), claimAt, e().due)
    expect(writes).toEqual([
      ['state', { where: { profileId: 't1', lastEmailAt: claimAt }, data: { lastEmailAt: prevState } }],
      ['delete', { where: { conversationId: { in: ['c1'] }, emailedAt: claimAt } }],
      ['restore', { where: { conversationId: 'c2', emailedAt: claimAt }, data: { emailedAt: oldRow.emailedAt, kind: oldRow.kind } }],
    ])
  })
})
