import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── An enforcement pull purges the HOME page too (2026-10-13) ──────────────────────────────────
//
// A hold pulls every live listing of the account (verified=false) and purged only the listing pages — while the
// home page's 6h-ISR HTML (its feed, its rails and, since 2026-10-13, its "Find a teacher" shelf) kept the held
// seller's cards for up to six hours. Pinned: a pull purges '/' once, after the commit; a transition that touches no
// listing purges no home page.

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  profileState: 'good_standing',
  /** The account's storefronts and, in order, what each listing read answers (the drain's batches, then the rest). */
  sellers: [] as Row[],
  reads: [] as Row[][],
  /** Every path purged, and whether the transaction had committed when it was. */
  purged: [] as Array<{ path: string; committed: boolean }>,
  committed: false,
}))

vi.mock('./compliance/seller-publish-gate', () => ({
  partitionByIdentityGate: async (ids: string[]) => ({ allowed: ids, held: [] }),
  settleHolds: async () => 0,
}))
vi.mock('./db', () => {
  const db: Row = {
    enforcementAction: {
      findUnique: async () => null,
      findMany: async () => [],
      update: async () => ({}),
      updateMany: async () => ({ count: 0 }),
      create: async () => ({ id: 'a1' }),
    },
    listing: {
      findMany: async () => h.reads.shift() ?? [],
      updateMany: async () => ({ count: 0 }),
      updateManyAndReturn: async () => [],
    },
    profile: {
      findUnique: async () => ({ locale: 'en', enforcementState: h.profileState }),
      update: async () => ({}),
      updateMany: async () => ({ count: 1 }),
    },
    seller: { findMany: async () => h.sellers },
    bannedIdentity: { deleteMany: async () => ({ count: 0 }), create: async () => ({}) },
    notification: { create: async () => ({}) },
  }
  db.$transaction = async (fn: (tx: Row) => unknown) => { const r = await fn(db); h.committed = true; return r }
  db.$queryRaw = async () => [{ enforcementState: h.profileState }]
  return { db }
})
vi.mock('./push', () => ({ sendPushToProfile: async () => 0 }))
vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: (path: string) => { h.purged.push({ path, committed: h.committed }) } }))

const { applyEnforcement } = await import('./enforcement')

beforeEach(() => {
  h.profileState = 'good_standing'
  h.sellers = []
  h.reads = []
  h.purged = []
  h.committed = false
})

describe('applyEnforcement — the home page follows a pull', () => {
  it('a hold that pulls listings purges each listing page and the home page, once, after the commit', async () => {
    h.sellers = [{ id: 's1' }]
    h.reads = [[{ id: 'l1' }, { id: 'l2' }]] // the drain's one (short) batch
    expect(await applyEnforcement('p1', { state: 'held', reason: 'admin_manual', expiresAt: null }, { decidedBy: 'mod@eno.vn' })).toBe(true)
    const paths = h.purged.map((p) => p.path)
    expect(paths).toEqual(expect.arrayContaining(['/listings/l1', '/listings/l2', '/']))
    expect(paths.filter((p) => p === '/')).toHaveLength(1)
    expect(h.purged.every((p) => p.committed)).toBe(true)
  })

  it('a transition that pulls nothing (a throttle) purges no home page', async () => {
    h.sellers = [{ id: 's1' }]
    expect(await applyEnforcement('p1', { state: 'throttled', reason: 'admin_manual', expiresAt: null }, { decidedBy: 'mod@eno.vn' })).toBe(true)
    expect(h.purged.map((p) => p.path)).not.toContain('/')
  })
})
