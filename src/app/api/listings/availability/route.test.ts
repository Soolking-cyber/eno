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
  /** Every path purged (revalidatePublicPath — both languages are its own business). */
  purged: [] as string[],
  /** Listing id → listingType, as the ownership read returns it. Unlisted ids are ordinary listings. */
  types: {} as Record<string, string>,
  /** The ownership read's arguments. */
  reads: [] as Row[],
}))

vi.mock('@/lib/admin', () => ({
  getCurrentProfile: async () => h.profile,
  getCurrentProfileId: async () => h.profile.id,
  getAdmin: async () => null,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '127.0.0.1' }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: (path: string) => { h.purged.push(path) } }))
vi.mock('@/lib/listing-index', () => ({ removeFromIndex: async () => {} }))
vi.mock('@/lib/ranking', () => ({ recomputeRankScoreForListings: async (ids: unknown) => { h.ranked.push(ids) } }))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: () => {} }))
vi.mock('@/lib/db', () => ({
  db: {
    seller: { findUnique: async () => ({ id: 's1' }) },
    listing: {
      findMany: async (a: Row) => { h.reads.push(a); return (a.where.id.in as string[]).map((id) => ({ id, listingType: h.types[id] ?? 'sell' })) },
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
  h.purged = []
  h.types = {}
  h.reads = []
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

/**
 * ⛔ A TEACHER'S PROFILE IS NEVER MARKED SOLD HERE (owner, 2026-10-27). The review asked "Tick anything that sold", and
 * four teachers ticked their own profile — meaning "yes, available" — and left search. The review no longer lists teachers
 * (stale.ts inAvailabilityReview); this door drops a teacher id an older tab or a script still sends, in `sold` AND in
 * `confirm` (theirs is the weekly check-in, src/lib/teachers/check-in.ts).
 */
describe('POST /api/listings/availability — a teacher profile is never marked sold, nor confirmed, here', () => {
  it('teacher ids in the sold set are dropped: only the goods listing is marked sold and purged', async () => {
    h.types = { T1: 'teacher', T2: 'teacher' }
    const r = await post({ confirm: [], sold: ['L1', 'T1', 'T2'] })
    expect(r.body).toEqual({ ok: true, confirmed: 0, markedSold: 1 })
    expect(soldWrites()).toHaveLength(1)
    expect(soldWrites()[0].where.id.in).toEqual(['L1'])
    expect(h.purged).toEqual(['/listings/L1'])
    // No extra read for it: the ownership read carries the type.
    expect(h.reads).toHaveLength(1)
    expect(h.reads[0].select).toEqual({ id: true, listingType: true })
  })

  it('only teacher ids sold → no sold write and no purge at all', async () => {
    h.types = { T1: 'teacher' }
    const r = await post({ confirm: [], sold: ['T1'] })
    expect(r.body).toEqual({ ok: true, confirmed: 0, markedSold: 0 })
    expect(soldWrites()).toEqual([])
    expect(h.purged).toEqual([])
  })

  it('both confirm writes exclude teacher listings, whatever ids are sent', async () => {
    await post({ confirm: ['L1', 'T1'], sold: [] })
    expect(confirmWrites()).toHaveLength(2)
    for (const w of confirmWrites()) expect(w.where.listingType).toEqual({ not: 'teacher' })
  })

  it('only other listings sold → their own pages, as before', async () => {
    await post({ confirm: [], sold: ['L1', 'L2'] })
    expect(h.purged).toEqual(['/listings/L1', '/listings/L2'])
  })

  it('nothing marked sold → no read and no purge at all', async () => {
    await post({ confirm: ['L1'], sold: [] })
    expect(h.reads).toHaveLength(0)
    expect(h.purged).toEqual([])
  })
})
