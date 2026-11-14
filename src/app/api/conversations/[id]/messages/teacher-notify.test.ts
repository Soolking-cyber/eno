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
  // The writer's address as its Profile row reads it — a review seat's (src/lib/review-seat-accounts.ts) in its tests.
  email: 'someone@example.com',
  /** Whose Profile reads failed (a database error): the seat guard must fail closed. */
  profileDown: false,
  // The profiles that own a TeacherProfile (live or hidden), and every TeacherProfile read the route made.
  teachers: ['teacher-1'] as string[],
  teacherReads: [] as string[],
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
      profile: { findUnique: async ({ where }: { where: { id: string } }) => {
        if (h.profileDown) throw new Error('db down')
        return { email: h.email, accountType: where.id === h.personal ? 'individual' : 'business' }
      } },
      teacherProfile: { findUnique: async ({ where }: { where: { profileId: string } }) => {
        h.teacherReads.push(where.profileId)
        return h.teachers.includes(where.profileId) ? { id: `tp-${where.profileId}` } : null
      } },
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

beforeEach(() => {
  h.me = 'school-1'; h.notified = []; h.personal = ''; h.email = 'someone@example.com'; h.messages = []; h.released = []; h.beforeInsert = null; h.carried = []
  h.profileDown = false; h.teachers = ['teacher-1']; h.teacherReads = []
})

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

describe('⛔ a review seat (src/lib/review-seat-accounts.ts) — personal or business', () => {
  it('writes nothing into a teacher thread — 403 forbidden, nothing rung, its claim freed', async () => {
    h.convo = thread(7)
    h.email = ' AI-Review@eno.vn'
    const res = await post({ body: 'Hello, we need a cover teacher — could you cover a lesson for us?', clientId: 'seat-1' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden' })
    expect(sentBy('school-1')).toEqual([])
    expect(h.carried).toEqual([])
    await tick()
    expect(h.notified).toEqual([])
    expect(h.released).toEqual(['msgid:c1:school-1:seat-1'])
  })

  it('as a PERSON too: the cover opener from a personal seat is refused the same way (the server never reads the words)', async () => {
    h.convo = thread(7)
    h.email = 'app-review@eno.vn'
    h.personal = 'school-1'
    const res = await post({ body: 'Hello, we need a cover teacher — could you cover a lesson for us?', clientId: 'seat-2' })
    expect(res.status).toBe(403)
    expect(sentBy('school-1')).toEqual([])
    await tick()
    expect(h.notified).toEqual([])
    expect(h.released).toEqual(['msgid:c1:school-1:seat-2'])
  })

  it('CONTROL: the seat on an ordinary listing from someone who is NOT a teacher still writes — and a writer that is not a seat is untouched', async () => {
    h.email = 'play-review@eno.forum'
    h.convo = { ...thread(1, 'sell'), sellerProfileId: 'shop-1' }
    expect(await send({ body: 'Is this still available?' })).toBe(200)
    expect(h.teacherReads).toEqual(['shop-1'])
    h.email = 'office@saigon-english.example'
    h.convo = thread(1)
    expect(await send({ body: 'Hello, we are hiring a teacher' })).toBe(200)
    expect(sentBy('school-1')).toHaveLength(2)
    // An ordinary writer pays the one Profile read and never a TeacherProfile one: the hot path stays as it was.
    expect(h.teacherReads).toEqual(['shop-1'])
  })

  // ⛔ Round 4, 2026-11-14: the lawyer's seat is no store seat (review-seat-accounts.ts) — it owns Luật Hoàng Phi's
  // storefront, and a teacher asking that firm about a work permit must be answered.
  it('CONTROL: the LAWYER\'s seat writes in a teacher thread as anyone does — no TeacherProfile read', async () => {
    h.email = 'lawyer-review@eno.vn'
    h.convo = thread(1)
    expect(await send({ body: 'Yes, we can help with the work permit.' })).toBe(200)
    expect(sentBy('school-1')).toEqual(['Yes, we can help with the work permit.'])
    expect(h.teacherReads).toEqual([])
  })
})

/**
 * ⛔ ROUND 3 (2026-11-14): A SEAT WRITES TO NO TEACHER IN ANY THREAD — as the SELLER too. A teacher who writes in about a
 * seat's job post (or anything a seat sells) opens a thread where the seat is the seller; its reply would be a school's
 * voice in a teacher's inbox. Any thread whose other side owns a TeacherProfile, live or hidden, refuses the seat's send:
 * 403, nothing written, nobody rung, the claim freed.
 */
describe('⛔ a review seat writes to no teacher in ANY thread (round 3) — the seat as the seller included', () => {
  /** A teacher (buyer) wrote to the seat's job post (seller): the seat-as-school arrangement round 2 left open. */
  const jobThread = (seller = 'seat-1', buyer = 'teacher-2') => ({
    id: 'c1', buyerProfileId: buyer, sellerProfileId: seller, sellerId: 's-seat',
    lastMessageAt: new Date(Date.now() - 9 * 3_600_000),
    listing: { id: 'J1', negotiable: false, status: 'active', listingType: 'job' },
  })

  it('⛔ teacher buyer, seat seller, a job listing → the seat\'s reply is 403: no message, no notification, the claim freed', async () => {
    h.teachers = ['teacher-2']
    h.convo = jobThread()
    h.me = 'seat-1'
    h.email = 'ai-review@eno.vn'
    const res = await post({ body: 'Thanks for applying — can you cover a lesson on Thursday?', clientId: 'seat-job' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden' })
    expect(h.messages).toEqual([])
    expect(h.carried).toEqual([])
    await tick()
    expect(h.notified).toEqual([])
    expect(h.released).toEqual(['msgid:c1:seat-1:seat-job'])
    expect(h.teacherReads).toEqual(['teacher-2'])
  })

  it('…an offer too, and a HIDDEN teacher profile counts (the teacher\'s own switch, not a sign they are not one)', async () => {
    h.teachers = ['teacher-2'] // the mock answers a row whatever its status: the guard never asks for one
    h.convo = { ...jobThread(), listing: { id: 'J1', negotiable: true, status: 'active', listingType: 'sell' } }
    h.me = 'seat-1'
    h.email = 'app-review@eno.vn'
    expect(await send({ body: '', offerAmount: 500_000 })).toBe(403)
    expect(h.messages).toEqual([])
  })

  it('⛔ the seat as the BUYER on an ordinary listing a teacher sells: 403, nothing written', async () => {
    h.convo = thread(7, 'sell') // the seller, teacher-1, owns a TeacherProfile
    h.email = 'play-review@eno.forum'
    expect(await send({ body: 'Is the bike still available?' })).toBe(403)
    expect(h.messages).toEqual([])
    await tick()
    expect(h.notified).toEqual([])
  })

  it('⛔ fails CLOSED: a Profile read that fails sends nothing and frees the claim', async () => {
    h.convo = jobThread()
    h.me = 'seat-1'
    h.profileDown = true
    const res = await post({ body: 'hello', clientId: 'down-1' })
    expect(res.status).toBe(500)
    expect(h.messages).toEqual([])
    expect(h.released).toEqual(['msgid:c1:seat-1:down-1'])
  })

  it('CONTROL: an ordinary school replying to the teacher who wrote to its job post is untouched — written, one Profile read, no TeacherProfile read', async () => {
    h.teachers = ['teacher-2']
    h.convo = jobThread('school-9')
    h.me = 'school-9'
    h.email = 'office@saigon-english.example'
    expect(await send({ body: 'Thanks for applying — can you come in on Thursday?' })).toBe(200)
    expect(sentBy('school-9')).toEqual(['Thanks for applying — can you come in on Thursday?'])
    expect(h.teacherReads).toEqual([])
  })

  it('CONTROL: the teacher writing into that thread is untouched (the guard is on the seat\'s sends only)', async () => {
    h.teachers = ['teacher-2']
    h.convo = jobThread()
    h.me = 'teacher-2'
    expect(await send({ body: 'Hello, I saw your job post' })).toBe(200)
    expect(sentBy('teacher-2')).toHaveLength(1)
  })
})
