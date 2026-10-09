import { beforeEach, describe, expect, it, vi } from 'vitest'

// PATCH /api/teachers/me/status — the Visibility switch. Showing is a relist: the publish gates answer 403 with their
// code, and ⛔ a profile with nothing to be found for (no job goal, no public cover — what an edit save hides, D6) answers
// 409 no_teaching_goal, a stable code the form words (gate review, 2026-10-09).
type Row = Record<string, any>
const h = vi.hoisted(() => ({ calls: [] as Row[], outcome: 'ok' as 'ok' | 'missing' | 'no_goal' | 'blocked' }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => ({ id: 'p-b' }), getCurrentProfileId: async () => 'p-b', getAdmin: async () => null, isAdminEmail: () => false }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }), kv: { set: async () => 'OK', get: async () => null } }))
vi.mock('@/lib/publish-guard', () => ({
  PublishBlockedError: class extends Error { constructor(public code: string) { super(code) } },
}))
vi.mock('@/lib/teachers/publish', async () => {
  const { PublishBlockedError } = await import('@/lib/publish-guard')
  class TeacherNoGoalError extends Error {}
  return {
    TeacherNoGoalError,
    setTeacherStatus: async (profileId: string, status: string) => {
      h.calls.push({ profileId, status })
      if (h.outcome === 'no_goal') throw new TeacherNoGoalError('no_teaching_goal')
      if (h.outcome === 'blocked') throw new (PublishBlockedError as unknown as new (c: string) => Error)('identity_unverified')
      return h.outcome === 'ok'
    },
  }
})
vi.mock('@/lib/db', () => ({ db: {} }))

const { PATCH } = await import('./route')
const patch = (body: Row) => PATCH(new Request('https://eno.vn/api/teachers/me/status', { method: 'PATCH', body: JSON.stringify(body) }) as never, {} as never)

beforeEach(() => { h.calls = []; h.outcome = 'ok' })

describe('PATCH /api/teachers/me/status', () => {
  it('shows or hides the caller\'s profile', async () => {
    const res = await patch({ status: 'live' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 'live' })
    expect(h.calls).toEqual([{ profileId: 'p-b', status: 'live' }])
  })
  it('⛔ nothing to be found for (no job goal, no public cover — D6): 409 no_teaching_goal, never shown', async () => {
    h.outcome = 'no_goal'
    const res = await patch({ status: 'live' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'no_teaching_goal' })
  })
  it('a publish gate (identity, trust) answers 403 with its code', async () => {
    h.outcome = 'blocked'
    const res = await patch({ status: 'live' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'identity_unverified' })
  })
  it('answers 404 with no profile, and 400 for any other status', async () => {
    h.outcome = 'missing'
    expect((await patch({ status: 'live' })).status).toBe(404)
    expect((await patch({ status: 'active' })).status).toBe(400)
  })
})
