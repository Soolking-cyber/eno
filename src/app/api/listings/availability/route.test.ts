import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/listings/availability — THE HOLD GUARD ON THE DAILY BATCH (owner, 2026-09-24).
 *
 * confirmCore refuses every "still available?" confirm while the storefront owner is held or suspended
 * (core/listings.ts, "THE HOLD LEAK"). This batch route did not: a held seller's live rows are the
 * ones the hold PULLED (still status 'active', only verified=false), and the confirm here matches on
 * status alone — so it bumped their postedAt and they came back at the top of the feed the day the
 * hold ended. Pinned: held/suspended → no confirm write at all, the refusal named, and marking sold
 * still applied; every other state → the bump exactly as before.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  profile: {} as Row,
  updateMany: [] as Row[],
  ranked: [] as unknown[],
}))

vi.mock('@/lib/admin', () => ({
  getCurrentProfile: async () => h.profile,
  getCurrentProfileId: async () => h.profile.id,
  getAdmin: async () => null,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '127.0.0.1' }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: () => {} }))
vi.mock('@/lib/listing-index', () => ({ removeFromIndex: async () => {} }))
vi.mock('@/lib/ranking', () => ({ recomputeRankScoreForListings: async (ids: unknown) => { h.ranked.push(ids) } }))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: () => {} }))
vi.mock('@/lib/db', () => ({
  db: {
    seller: { findUnique: async () => ({ id: 's1' }) },
    listing: {
      findMany: async (a: Row) => (a.where.id.in as string[]).map((id) => ({ id })),
      updateMany: async (a: Row) => { h.updateMany.push(a); return { count: (a.where.id.in as string[]).length } },
    },
    profile: { update: async () => ({}) },
  },
}))

const { POST } = await import('./route')

const post = async (body: unknown) => {
  const res = await POST(new Request('https://eno.vn/api/listings/availability', { method: 'POST', body: JSON.stringify(body) }) as never, undefined as never)
  return { status: res.status, body: await res.json() as Row }
}
const confirmWrites = () => h.updateMany.filter((u) => 'availabilityConfirmedAt' in u.data)
const soldWrites = () => h.updateMany.filter((u) => u.data.status === 'sold')

beforeEach(() => {
  h.profile = { id: 'p1', enforcementState: 'good_standing', availabilitySkips: 0 }
  h.updateMany = []
  h.ranked = []
})

describe('POST /api/listings/availability — a held or suspended seller cannot bump pulled listings', () => {
  for (const [state, code] of [['held', 'account_held'], ['suspended', 'account_suspended']] as const) {
    it(`${state}: NO confirm write (no bump, no stamp), the refusal named, sold still applied`, async () => {
      h.profile.enforcementState = state
      const r = await post({ confirm: ['L1', 'L2'], sold: ['L3'] })
      expect(r.status).toBe(200)
      expect(r.body).toEqual({ ok: true, confirmed: 0, markedSold: 1, confirmRefused: code })
      expect(confirmWrites()).toEqual([])
      expect(h.ranked).toEqual([])
      expect(soldWrites()).toHaveLength(1)
    })
  }

  for (const state of ['good_standing', 'warned', 'throttled']) {
    it(`${state}: the confirm bumps exactly as before`, async () => {
      h.profile.enforcementState = state
      const r = await post({ confirm: ['L1'], sold: [] })
      expect(r.body.confirmRefused).toBeUndefined()
      expect(confirmWrites()).toHaveLength(2) // the bump and the stamp-only halves
      expect(confirmWrites()[0].data).toHaveProperty('postedAt')
      expect(r.body.confirmed).toBe(2)
    })
  }

  it('held with nothing to confirm: no refusal field (nothing was refused)', async () => {
    h.profile.enforcementState = 'held'
    const r = await post({ confirm: [], sold: ['L3'] })
    expect(r.body).toEqual({ ok: true, confirmed: 0, markedSold: 1 })
  })
})
