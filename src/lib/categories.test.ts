import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * getCategoriesByDemand's memo (audit M2). Its two aggregates were ~20% of all database time,
 * because `/s/[handle]` is force-dynamic and paid for both on every visit. Pinned here: a recent
 * answer is reused, it expires, concurrent callers share one read, a failed read is NOT remembered
 * (the caller gets [] once, not for five minutes), and each caller gets its own objects.
 *
 * ⚠️ DATA SAFETY — `@/lib/db` is stubbed; nothing here can reach Postgres. The memo is module
 * state, so every test imports a fresh copy of the module.
 */

const h = vi.hoisted(() => ({
  reads: 0,
  fail: false,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/edition-scope', () => ({
  DeskResolutionError: class DeskResolutionError extends Error {},
  marketplaceListingScope: async () => ({}),
}))
vi.mock('./db', () => ({
  db: {
    category: {
      findMany: vi.fn(async () => {
        h.reads++
        if (h.fail) throw new Error('db down')
        return [
          { id: 'c1', name: 'Electronics', nameVi: 'Điện tử', slug: 'electronics', icon: null, color: null, description: null, _count: { listings: 900 } },
          { id: 'c2', name: 'Rentals', nameVi: 'Cho thuê', slug: 'rentals', icon: null, color: null, description: null, _count: { listings: 20 } },
        ]
      }),
    },
    listing: {
      groupBy: vi.fn(async () => [{ categoryId: 'c1', _sum: { views: 10, contactCount: 1, savedCount: 0 } }]),
    },
  },
}))

const T0 = new Date('2026-09-23T10:00:00Z').getTime()
const load = async () => (await import('./categories')).getCategoriesByDemand

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  h.reads = 0
  h.fail = false
})
afterEach(() => vi.useRealTimers())

describe('getCategoriesByDemand — memoized aggregates', () => {
  it('reuses the rows within five minutes, reads again after', async () => {
    const get = await load()
    await get()
    vi.setSystemTime(T0 + 4 * 60_000)
    await get()
    expect(h.reads).toBe(1)
    vi.setSystemTime(T0 + 5 * 60_000 + 1)
    await get()
    expect(h.reads).toBe(2)
  })

  it('concurrent callers share one read', async () => {
    const get = await load()
    await Promise.all([get(), get(), get()])
    expect(h.reads).toBe(1)
  })

  it('a failed read returns [] for that call only — it is not remembered', async () => {
    const get = await load()
    h.fail = true
    expect(await get()).toEqual([])
    h.fail = false
    expect((await get()).map((c) => c.slug)).toEqual(['rentals', 'electronics'])
    expect(h.reads).toBe(2)
  })

  it('each caller gets its own array and objects — mutating one answer cannot leak into the next', async () => {
    const get = await load()
    const first = await get()
    first[0].name = 'MUTATED'
    first.reverse()
    const second = await get()
    expect(second.map((c) => c.slug)).toEqual(['rentals', 'electronics'])
    expect(second[0].name).toBe('Rentals')
  })
})
