import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/conversations/[id]/messages — a teacher thread.
 *   · Cover lessons (2026-10-07): a message into a teacher thread that had gone quiet rings the teacher (bell + web push,
 *     src/lib/teachers/notify.ts); a live back-and-forth, the teacher's own replies and ordinary listings never do. ANY
 *     writer since the DM ladder (owner, 2026-10-13: "Anyone") — the alert no longer says "a school or company", so the
 *     writer's account type is not read.
 *   · ⛔ "2 until reply" (owner, 2026-10-13 — src/lib/teachers/dm-quota.ts mayWriteToTeacher): a teacher who has not
 *     answered gets at most two messages from the writer. The third is refused 429 `teacher_awaiting_reply` with nothing
 *     written; anything the teacher writes opens the chat. The rule runs for real here — only the rows it counts are mocked.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({
  me: 'school-1',
  convo: null as Row | null,
  notified: [] as Row[],
  personal: '',
  // The thread's messages as insertMessage wrote them — what mayWriteToTeacher counts.
  messages: [] as Row[],
  // Idempotency claims released (kv.del) — every refusal must free its claim.
  released: [] as string[],
  // A concurrent send landing AFTER the route's check and BEFORE this insert (the race the guard closes).
  beforeInsert: null as null | (() => void),
  // The alongside writes each insert carried.
  carried: [] as unknown[][],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin', () => ({ getCurrentProfileId: async () => h.me, getAdmin: async () => null, isAdminEmail: () => false }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async () => ({ success: true, resetSec: 0 }),
  kv: { set: async () => 'OK', get: async () => null, del: async (k: string) => { h.released.push(k); return 1 } },
}))
vi.mock('@/lib/enforcement', () => ({ messagingGate: async () => null }))
vi.mock('@/lib/offer-guard', () => ({ recordFixedPriceOfferAttempt: async () => {} }))
// ⛔ The guard's statements (dm-quota.ts teacherUnansweredGuard) run HERE, before the row, the way the batch transaction
// runs SendOpts.alongside: its re-read of the rule sees every message committed before it — a concurrent send included —
// and aborts the insert when the rule says no. The SQL itself is pinned in dm-quota.test.ts and was measured on Postgres.
vi.mock('@/lib/messages', () => ({
  insertMessage: async (c: Row, me: string, text: string, opts?: { alongside?: Row[] }) => {
    h.beforeInsert?.()
    h.carried.push(opts?.alongside ?? [])
    for (const op of opts?.alongside ?? []) {
      if (op.guard !== 'check') continue
      const [conv, teacher, , writer, max] = op.values as [string, string, string, string, number]
      const teacherSpoke = h.messages.some((m) => m.conversationId === conv && m.senderProfileId === teacher)
      const sent = h.messages.filter((m) => m.conversationId === conv && m.senderProfileId === writer).length
      // The guard's abort exactly as Prisma raises it through the pg adapter (dm-quota.ts isTeacherGuardAbort).
      if (!teacherSpoke && sent >= max) throw Object.assign(new Error('Raw query failed. Code: `22012`. Message: `division by zero`'), { code: 'P2010', meta: { driverAdapterError: { cause: { code: '22012', originalCode: '22012' } } } })
    }
    const m = { id: `m${h.messages.length + 1}`, conversationId: c.id, senderProfileId: me, body: text, deletedAt: null as Date | null }
    h.messages.push(m)
    return { id: m.id, body: text }
  },
}))
vi.mock('@/lib/support-thread', () => ({ SUPPORT_SELLER_ID: 'support' }))
vi.mock('@/lib/whatsapp-bridge', () => ({ whatsappRecipientFor: async () => null }))
vi.mock('@/lib/whatsapp', () => ({ sendWhatsAppText: async () => ({ ok: true }) }))
// `after()` runs inline so the ring is observable here.
vi.mock('next/server', async (orig) => ({ ...(await orig<Record<string, unknown>>()), after: (fn: () => unknown) => { void fn() } }))
vi.mock('@/lib/teachers/notify', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/teachers/notify')>()
  return { ...mod, notifyTeacherOfSchoolMessage: async (a: Row) => { h.notified.push(a) } }
})
vi.mock('@/lib/db', () => {
  // Every key of the `where` must match the row. A filter this mock cannot read (a range, a relation) fails the test
  // loudly rather than answering a count it never computed.
  const matches = (m: Row, where: Row) => Object.entries(where).every(([k, v]) => {
    if (v !== null && typeof v === 'object') throw new Error(`message mock: unsupported where.${k}`)
    return (m[k] ?? null) === v
  })
  return {
    db: {
      conversation: { findUnique: async () => h.convo },
      forumUserBlock: { findFirst: async () => null },
      // Answers 'individual' for h.personal: were the ring ever gated on the account type again, the test below would see it.
      profile: { findUnique: async ({ where }: { where: { id: string } }) => ({ email: 'someone@example.com', accountType: where.id === h.personal ? 'individual' : 'business' }) },
      // teacherUnansweredGuard's two statements: LAZY markers, run by insertMessage's mock above as the transaction would.
      $executeRaw: (_s: TemplateStringsArray, ...values: unknown[]) => ({ guard: 'lock', key: values[0] }),
      $queryRaw: (_s: TemplateStringsArray, ...values: unknown[]) => ({ guard: 'check', values }),
      message: {
        findFirst: async ({ where }: { where: Row }) => h.messages.find((m) => matches(m, where)) ?? null,
        count: async ({ where }: { where: Row }) => h.messages.filter((m) => matches(m, where)).length,
      },
    },
  }
})

const { POST } = await import('./route')

async function post(body: Row) {
  return POST(new Request('https://eno.vn/api/conversations/c1/messages', { method: 'POST', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: 'c1' }) } as never)
}
async function send(body: Row) {
  return (await post(body)).status
}
const thread = (hoursQuiet: number, listingType = 'teacher') => ({
  id: 'c1', buyerProfileId: 'school-1', sellerProfileId: 'teacher-1', sellerId: 's1',
  lastMessageAt: new Date(Date.now() - hoursQuiet * 3_600_000),
  listing: { id: 'L1', negotiable: false, status: 'active', listingType },
})
const sentBy = (who: string) => h.messages.filter((m) => m.senderProfileId === who).map((m) => m.body)
const tick = () => new Promise((r) => setTimeout(r, 0)) // the ring runs in after()

beforeEach(() => { h.me = 'school-1'; h.notified = []; h.personal = ''; h.messages = []; h.released = []; h.beforeInsert = null; h.carried = [] })

describe('a message into a teacher thread', () => {
  it('rings the teacher when the thread had gone quiet', async () => {
    h.convo = thread(7)
    expect(await send({ body: 'Could you cover Thursday evening?' })).toBe(200)
    await tick()
    expect(h.notified).toEqual([{ teacherProfileId: 'teacher-1', conversationId: 'c1', listingId: 'L1' }])
  })
  it('stays quiet during a live conversation', async () => {
    h.convo = thread(1)
    expect(await send({ body: 'Great, see you then' })).toBe(200)
    expect(h.notified).toEqual([])
  })
  it('never rings for the teacher\'s own reply, or on an ordinary listing', async () => {
    h.convo = thread(7)
    h.me = 'teacher-1'
    await send({ body: 'Yes, I can' })
    h.me = 'school-1'
    h.convo = thread(7, 'sell')
    await send({ body: 'Is this still available?' })
    expect(h.notified).toEqual([])
  })
})

describe('any account that writes (DM ladder, owner 2026-10-13: "Anyone")', () => {
  it('a personal account rings the teacher after a quiet gap too — the account type is not read', async () => {
    h.convo = thread(7)
    h.personal = 'school-1'
    expect(await send({ body: 'still there?' })).toBe(200)
    await tick()
    expect(h.notified).toEqual([{ teacherProfileId: 'teacher-1', conversationId: 'c1', listingId: 'L1' }])
  })
})

describe('⛔ a teacher who has not answered gets at most two messages (owner, 2026-10-13: "2 until reply")', () => {
  it('the writer\'s third message is refused 429 teacher_awaiting_reply — nothing written, nothing rung, the send claim freed', async () => {
    h.convo = thread(7) // quiet: a third message that went through would ring
    expect(await send({ body: 'Hello — are you taking new students?' })).toBe(200)
    expect(await send({ body: 'We are in District 2, evenings.' })).toBe(200)
    await tick()
    const rung = h.notified.length
    const res = await post({ body: 'Hello??', clientId: 'third-1' })
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'teacher_awaiting_reply' })
    await tick()
    expect(sentBy('school-1')).toEqual(['Hello — are you taking new students?', 'We are in District 2, evenings.'])
    expect(h.messages).toHaveLength(2)
    expect(h.notified).toHaveLength(rung)
    // Released, so the same send retried once the teacher answers is not held off as send_in_flight.
    expect(h.released).toEqual(['msgid:c1:school-1:third-1'])
  })

  // The cap is the writer's alone: the teacher's first answer, after two unanswered messages, must never be refused.
  it('the teacher can always answer — and the answer opens the chat again', async () => {
    h.convo = thread(1)
    expect(await send({ body: 'one' })).toBe(200)
    expect(await send({ body: 'two' })).toBe(200)
    expect(await send({ body: 'three' })).toBe(429)
    h.me = 'teacher-1'
    expect(await send({ body: 'Hi! Yes, I am.' })).toBe(200)
    h.me = 'school-1'
    expect(await send({ body: 'Great — Thursday at 6?' })).toBe(200)
    expect(await send({ body: 'And Friday?' })).toBe(200)
    expect(h.messages.map((m) => m.body)).toEqual(['one', 'two', 'Hi! Yes, I am.', 'Great — Thursday at 6?', 'And Friday?'])
  })

  it('a recalled message still counts — a recall does not buy another try', async () => {
    h.convo = thread(1)
    expect(await send({ body: 'one' })).toBe(200)
    expect(await send({ body: 'two' })).toBe(200)
    h.messages[1].deletedAt = new Date() // "Delete" on the second: hidden from both sides, still in the row
    expect(await send({ body: 'two, again' })).toBe(429)
    expect(sentBy('school-1')).toEqual(['one', 'two'])
  })

  it('⛔ a send racing another past the check is stopped AT THE INSERT (codex, gate 2026-10-13): 429, nothing of it written, its claim freed', async () => {
    h.convo = thread(7)
    expect(await send({ body: 'one' })).toBe(200)
    // The second message of another tab commits after this request's check (one message: may write) and before its insert.
    h.beforeInsert = () => { h.beforeInsert = null; h.messages.push({ id: 'm-race', conversationId: 'c1', senderProfileId: 'school-1', body: 'two (other tab)', deletedAt: null }) }
    const res = await post({ body: 'two (this tab)', clientId: 'race-1' })
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'teacher_awaiting_reply' })
    expect(sentBy('school-1')).toEqual(['one', 'two (other tab)'])
    expect(h.released).toEqual(['msgid:c1:school-1:race-1'])
  })

  it('the guard rides only with the writer\'s sends into a teacher thread — never the teacher\'s, never an ordinary listing\'s', async () => {
    h.convo = thread(1)
    await send({ body: 'one' })
    expect(h.carried[0]).toEqual([{ guard: 'lock', key: 'teacher-unanswered:c1' }, { guard: 'check', values: ['c1', 'teacher-1', 'c1', 'school-1', 2] }])
    h.me = 'teacher-1'
    await send({ body: 'Hi!' })
    h.me = 'school-1'
    h.convo = thread(1, 'sell')
    await send({ body: 'Is this still available?' })
    expect(h.carried.slice(1)).toEqual([[], []])
  })

  it('only in a teacher thread: an ordinary listing\'s seller may be written to a third time without an answer', async () => {
    h.convo = thread(1, 'sell')
    for (const body of ['Is this still available?', 'Could I see it today?', 'Hello?']) expect(await send({ body })).toBe(200)
    expect(sentBy('school-1')).toHaveLength(3)
  })
})
