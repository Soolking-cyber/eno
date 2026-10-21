import { beforeEach, describe, expect, it, vi } from 'vitest'

// GET /api/teachers/dm-quota — where the signed-in account stands on the teacher DM ladder, and its own thread with the
// teacher asked about: the contact block goes back INTO that thread instead of the first-contact chooser (2026-10-21).
const h = vi.hoisted(() => ({
  me: { id: 'p-1' } as { id: string } | null,
  standing: { tier: 'business', limit: 30, used: 2, remaining: 28, resetAt: '2026-10-21T17:00:00.000Z', next: 'tomorrow', nextLimit: null, needsPhone: false, pooled: false, reason: null, hasThread: false } as Record<string, unknown>,
  asked: [] as unknown[],
}))
vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => h.me, getCurrentProfileId: async () => h.me?.id ?? null, getAdmin: async () => null, isAdminEmail: () => false }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }), kv: { set: async () => 'OK', get: async () => null } }))
vi.mock('@/lib/teachers/dm-quota', () => ({
  teacherDmStanding: async (profileId: string, opts: unknown) => { h.asked.push({ profileId, opts }); return h.standing },
}))

const { GET } = await import('./route')
const ask = (q = '?listingId=t1') => GET(new Request(`http://localhost/api/teachers/dm-quota${q}`) as never, { params: Promise.resolve({}) } as never)

beforeEach(() => { h.me = { id: 'p-1' }; h.asked = []; h.standing = { ...h.standing, hasThread: false }; delete h.standing.threadId })

describe('GET /api/teachers/dm-quota', () => {
  it('answers the caller\'s own standing for the teacher asked about — with no thread, threadId is null', async () => {
    const res = await ask()
    expect(res.status).toBe(200)
    expect(h.asked).toEqual([{ profileId: 'p-1', opts: expect.objectContaining({ listingId: 't1' }) }])
    expect(await res.json()).toMatchObject({ remaining: 28, hasThread: false, threadId: null })
  })

  it('names the caller\'s thread with that teacher, so the Message button goes back into it', async () => {
    h.standing = { ...h.standing, hasThread: true, threadId: 'c9' }
    expect(await (await ask()).json()).toMatchObject({ hasThread: true, threadId: 'c9' })
  })

  it('answers no one signed out', async () => {
    h.me = null
    expect((await ask()).status).toBe(401)
    expect(h.asked).toEqual([])
  })
})
