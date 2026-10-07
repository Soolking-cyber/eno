import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/conversations/[id]/messages — cover lessons (2026-10-07). A SCHOOL writing into a teacher thread that
 * had gone quiet rings the teacher (bell + web push, src/lib/teachers/notify.ts); a live back-and-forth, the
 * teacher's own replies and ordinary listings never do.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({ me: 'school-1', convo: null as Row | null, notified: [] as Row[], personal: '' }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin', () => ({ getCurrentProfileId: async () => h.me, getAdmin: async () => null, isAdminEmail: () => false }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async () => ({ success: true, resetSec: 0 }),
  kv: { set: async () => 'OK', get: async () => null, del: async () => 1 },
}))
vi.mock('@/lib/enforcement', () => ({ messagingGate: async () => null }))
vi.mock('@/lib/offer-guard', () => ({ recordFixedPriceOfferAttempt: async () => {} }))
vi.mock('@/lib/messages', () => ({ insertMessage: async (_c: Row, _me: string, text: string) => ({ id: 'm1', body: text }) }))
vi.mock('@/lib/support-thread', () => ({ SUPPORT_SELLER_ID: 'support' }))
vi.mock('@/lib/whatsapp-bridge', () => ({ whatsappRecipientFor: async () => null }))
vi.mock('@/lib/whatsapp', () => ({ sendWhatsAppText: async () => ({ ok: true }) }))
// `after()` runs inline so the ring is observable here.
vi.mock('next/server', async (orig) => ({ ...(await orig<Record<string, unknown>>()), after: (fn: () => unknown) => { void fn() } }))
vi.mock('@/lib/teachers/notify', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/teachers/notify')>()
  return { ...mod, notifyTeacherOfSchoolMessage: async (a: Row) => { h.notified.push(a) } }
})
vi.mock('@/lib/db', () => ({
  db: {
    conversation: { findUnique: async () => h.convo },
    forumUserBlock: { findFirst: async () => null },
    profile: { findUnique: async ({ where }: { where: { id: string } }) => ({ email: 'someone@example.com', accountType: where.id === h.personal ? 'individual' : 'business' }) },
  },
}))

const { POST } = await import('./route')

async function send(body: Row) {
  const res = await POST(new Request('https://eno.vn/api/conversations/c1/messages', { method: 'POST', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: 'c1' }) } as never)
  return res.status
}
const thread = (hoursQuiet: number, listingType = 'teacher') => ({
  id: 'c1', buyerProfileId: 'school-1', sellerProfileId: 'teacher-1', sellerId: 's1',
  lastMessageAt: new Date(Date.now() - hoursQuiet * 3_600_000),
  listing: { id: 'L1', negotiable: false, status: 'active', listingType },
})

beforeEach(() => { h.me = 'school-1'; h.notified = []; h.personal = '' })

describe('a school message into a teacher thread', () => {
  it('rings the teacher when the thread had gone quiet', async () => {
    h.convo = thread(7)
    expect(await send({ body: 'Could you cover Thursday evening?' })).toBe(200)
    await new Promise((r) => setTimeout(r, 0)) // the ring runs in after(), behind a profile lookup
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

describe('a sender who is no longer a business', () => {
  it('keeps writing in its thread but never rings the teacher with "a school or company messaged you"', async () => {
    h.convo = thread(7)
    h.personal = 'school-1'
    expect(await send({ body: 'still there?' })).toBe(200)
    await new Promise((r) => setTimeout(r, 0))
    expect(h.notified).toEqual([])
  })
})
