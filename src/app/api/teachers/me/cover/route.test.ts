import { beforeEach, describe, expect, it, vi } from 'vitest'

// PATCH /api/teachers/me/cover (teacher onboarding redesign, 2026-10-08): the areas are derived, so a body that still
// sends them is a panel from before the redesign — its switch-ON is refused ("reload"), its switch-OFF still saves (a
// withdrawal is never blocked, plan review D6). An older notice is 409 notice_changed.
type Row = Record<string, any>
const h = vi.hoisted(() => ({ calls: [] as Row[], result: { coverOpen: false, hidden: false } as Row | null, notice: null as string | null }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => ({ id: 'p-b' }), getCurrentProfileId: async () => 'p-b', getAdmin: async () => null, isAdminEmail: () => false }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }), kv: { set: async () => 'OK', get: async () => null } }))
vi.mock('@/lib/publish-guard', () => ({ PublishBlockedError: class extends Error {} }))
vi.mock('@/lib/teachers/publish', async () => {
  const real = await vi.importActual<typeof import('@/lib/teachers/publish')>('@/lib/teachers/publish')
  class E extends Error {}
  class TeacherNoticeChangedError extends Error { constructor(public notice: string) { super('notice_changed') } }
  return {
    isLegacyCoverBody: real.isLegacyCoverBody,
    TeacherCoverConflictError: E, TeacherValidationError: class extends Error {}, TeacherNoticeChangedError,
    saveTeacherCover: async (_id: string, body: Row) => {
      if (h.notice) throw new TeacherNoticeChangedError(h.notice)
      h.calls.push(body)
      return h.result
    },
  }
})
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ assertSellerMayPublish: vi.fn(), sellerPublishDecision: async () => ({ ok: true }) }))

const { PATCH } = await import('./route')
const patch = (body: Row) => PATCH(new Request('https://eno.vn/api/teachers/me/cover', { method: 'PATCH', body: JSON.stringify(body) }) as never, {} as never)
const v2 = { coverOpen: true, coverSlots: ['mon-am'], coverRateVnd: 300_000, coverConsent: true, coverNotice: '2026-10-08' }

beforeEach(() => { h.calls = []; h.result = { coverOpen: true, hidden: false }; h.notice = null })

describe('PATCH /api/teachers/me/cover', () => {
  it('saves a v2 body and says whether the profile was hidden', async () => {
    const res = await patch(v2)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, coverOpen: true, hidden: false })
    expect(h.calls).toHaveLength(1)
  })
  it('⛔ refuses an OLD panel\'s switch-ON (it still sends picked areas) — 409 profile_changed, nothing saved', async () => {
    const res = await patch({ ...v2, coverAreas: ['d1', 'd3'], coverNotice: '2026-10-07' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'profile_changed' })
    expect(h.calls).toEqual([])
  })
  it('⛔ lets an old panel\'s switch-OFF through — a withdrawal is never blocked (D6)', async () => {
    h.result = { coverOpen: false, hidden: true }
    const res = await patch({ ...v2, coverOpen: false, coverConsent: false, coverAreas: ['d1'] })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ coverOpen: false, hidden: true })
    expect(h.calls).toHaveLength(1)
  })
  it('maps an older cover notice to 409 notice_changed', async () => {
    h.notice = 'cover'
    const res = await patch(v2)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'notice_changed', notice: 'cover' })
  })
  it('answers 404 with no profile', async () => {
    h.result = null
    expect((await patch(v2)).status).toBe(404)
  })
})
