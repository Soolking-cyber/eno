import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/messages/[id]/reactions from a STORE-REVIEW seat (round 4, 2026-11-14 — opus 3b; src/lib/review-seat-accounts.ts):
 * the seat's reply to a teacher is refused by the messages route, so an emoji on the teacher's message is refused too —
 * an ADD only; taking a reaction back stays possible, as across a block. The lawyer's seat (Luật Hoàng Phi's storefront)
 * is not a store seat and reacts as anyone. The real predicate (review-seat-listings.ts reviewSeatMeetsTeacher) over a
 * faked db.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({
  me: { id: 'seat-1', email: 'app-review@eno.vn' as string | null },
  teachers: new Set<string>(['teacher-1']),
  created: [] as Row[],
  existing: 0,
  removedCount: 0,
  teacherReads: [] as string[],
}))

vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => h.me, getCurrentProfileId: async () => h.me.id, getAdmin: async () => null, isAdminEmail: () => false }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }) }))
vi.mock('@/lib/user-blocks', () => ({ isBlockedBetween: async () => false }))
vi.mock('@/lib/db', () => {
  const tx: Row = {
    message: { updateMany: async () => ({ count: 1 }) },
    messageReaction: {
      deleteMany: async ({ where }: Row) => {
        if (where.emoji && h.existing) { h.existing = 0; h.removedCount++; return { count: 1 } }
        return { count: 0 }
      },
      create: async ({ data }: Row) => { h.created.push(data); return data },
    },
  }
  return {
    db: {
      // The seat sold to the teacher: the teacher is the BUYER of the thread.
      message: { findUnique: async () => ({ id: 'm1', deletedAt: null, conversation: { buyerProfileId: 'teacher-1', sellerProfileId: h.me.id } }) },
      messageReaction: { findMany: async () => [] },
      teacherProfile: { findUnique: async ({ where }: Row) => { h.teacherReads.push(where.profileId); return h.teachers.has(where.profileId) ? { id: 'tp-1' } : null } },
      profile: { findUnique: async () => { throw new Error('the route passes actorEmail: no Profile read') } },
      $transaction: async (fn: (t: Row) => unknown) => fn(tx),
    },
  }
})

const { POST } = await import('./route')

async function react() {
  const res = await POST(new Request('https://eno.vn/api/messages/m1/reactions', { method: 'POST', body: JSON.stringify({ emoji: '❤️' }) }) as never, { params: Promise.resolve({ id: 'm1' }) } as never)
  return { status: res.status, body: (await res.json().catch(() => null)) as Row | null }
}

beforeEach(() => {
  h.me = { id: 'seat-1', email: 'app-review@eno.vn' }
  h.teachers = new Set(['teacher-1'])
  h.created = []; h.existing = 0; h.removedCount = 0; h.teacherReads = []
})

describe('a store-review seat reacting to a teacher', () => {
  it('⛔ every store seat, in any case: a NEW reaction is refused (403) and nothing is written', async () => {
    for (const email of ['app-review@eno.vn', 'PLAY-REVIEW@eno.forum', ' ai-review@eno.vn ']) {
      h.me = { id: 'seat-1', email }
      h.created = []
      expect(await react(), email).toEqual({ status: 403, body: { error: 'forbidden' } })
      expect(h.created, email).toEqual([])
    }
    expect(h.teacherReads).toContain('teacher-1')
  })

  it('taking its own reaction BACK still works', async () => {
    h.existing = 1
    expect((await react()).status).toBe(200)
    expect(h.removedCount).toBe(1)
    expect(h.created).toEqual([])
  })

  it('CONTROL: a seat reacting to someone who is not a teacher, the lawyer\'s seat and an ordinary account react as before', async () => {
    h.teachers = new Set()
    expect((await react()).status).toBe(200)
    expect(h.created).toHaveLength(1)

    h.teachers = new Set(['teacher-1'])
    for (const email of ['lawyer-review@eno.vn', 'shop@example.com', null]) {
      h.me = { id: 'seat-1', email }
      h.created = []; h.teacherReads = []
      expect((await react()).status, String(email)).toBe(200)
      expect(h.created, String(email)).toHaveLength(1)
      expect(h.teacherReads, String(email)).toEqual([]) // not a seat: no read past the Profile row auth already had
    }
  })
})
