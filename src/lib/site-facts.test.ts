import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * site-facts is what /about and /llms.txt say about the shelf, so the tests are about two things:
 * the WORDS each share is allowed to become (shareOf's boundaries), and that every listing read is
 * edition-scoped and the result memoized — the per-request /md/home path would otherwise run seven
 * full-table aggregates per agent request.
 */
const h = vi.hoisted(() => ({
  fail: false,
  hang: false,
  calls: { groupBy: [] as unknown[], count: [] as unknown[], category: 0 },
}))

vi.mock('@/lib/edition-scope', () => ({
  // Tags the predicate the way the real helper wraps it, so the test can see every read went through it.
  scopedListingWhere: async (where: object) => ({ AND: [where, { sellerId: { notIn: ['desk'] } }] }),
}))

vi.mock('@/lib/db', () => {
  const byWhere = (where: unknown) => JSON.stringify(where)
  return {
    db: {
      category: {
        findMany: async () => {
          h.calls.category++
          if (h.fail) throw new Error('db down')
          return [{ id: 'c-rent', slug: 'rentals' }, { id: 'c-elec', slug: 'electronics' }, { id: 'c-jobs', slug: 'jobs' }]
        },
      },
      listing: {
        groupBy: async ({ where }: { where: unknown }) => {
          h.calls.groupBy.push(where)
          if (h.hang) return new Promise(() => {})
          const w = byWhere(where)
          if (w.includes('Ho Chi Minh')) return [{ categoryId: 'c-rent', _count: { _all: 25 } }, { categoryId: 'c-elec', _count: { _all: 60 } }]
          if (w.includes('Ha Noi')) return [{ categoryId: 'c-jobs', _count: { _all: 6 } }]
          if (w.includes('Da Nang')) return []
          if (w.includes('affiliateUrl')) return [
            { categoryId: 'c-rent', _count: { _all: 20 } },
            { categoryId: 'c-elec', _count: { _all: 64 } },
            { categoryId: 'c-gone', _count: { _all: 3 } }, // an orphan: dropped here exactly as in `live`
          ]
          return [
            { categoryId: 'c-rent', _count: { _all: 25 } },
            { categoryId: 'c-elec', _count: { _all: 64 } },
            { categoryId: 'c-jobs', _count: { _all: 10 } },
            { categoryId: 'c-gone', _count: { _all: 3 } }, // a category id with no row: dropped, not "c-gone"
          ]
        },
        count: async ({ where }: { where: unknown }) => {
          h.calls.count.push(where)
          return byWhere(where).includes('motorbike') ? 0 : 90
        },
      },
    },
  }
})

const load = async () => {
  vi.resetModules()
  return import('./site-facts')
}

beforeEach(() => {
  h.fail = false
  h.hang = false
  h.calls = { groupBy: [], count: [], category: 0 }
})

describe('shareOf — the only words the pages may use for a share', () => {
  it('draws each boundary where the word stops being true', async () => {
    const { shareOf } = await load()
    expect(shareOf(0, 0)).toBeNull() // nothing to describe
    expect(shareOf(10, 10)).toBe('all')
    expect(shareOf(9, 10)).toBe('almost') // 90% is "almost everything"
    expect(shareOf(899, 1000)).toBe('most') // 89.9% is not
    expect(shareOf(51, 100)).toBe('most')
    expect(shareOf(50, 100)).toBe('some') // half is not "most" — strict majority
    expect(shareOf(1, 100)).toBe('some')
    expect(shareOf(0, 100)).toBe('none')
  })
})

describe('assembleFacts', () => {
  it('keys counts by slug, drops unknown ids and empty groups, and totals only what it kept', async () => {
    const { assembleFacts, inCity } = await load()
    const f = assembleFacts({
      categories: [{ id: 'a', slug: 'rentals' }, { id: 'b', slug: 'jobs' }],
      live: [
        { categoryId: 'a', _count: { _all: 5 } },
        { categoryId: 'b', _count: { _all: 0 } },
        { categoryId: 'zzz', _count: { _all: 7 } },
      ],
      linked: [{ categoryId: 'a', _count: { _all: 4 } }, { categoryId: 'zzz', _count: { _all: 7 } }],
      motorbikes: 0,
      byCity: { hcmc: [{ categoryId: 'a', _count: { _all: 5 } }], hanoi: [], daNang: [] },
    })
    expect(f.byCategory).toEqual({ rentals: 5 })
    expect(f.live).toBe(5)
    expect(f.linked).toBe(4) // the orphan 'zzz' counts in neither total
    expect(inCity(f, 'hcmc')).toBe(5)
    expect(inCity(f, 'hcmc', 'rentals')).toBe(5)
    expect(inCity(f, 'hanoi', 'rentals')).toBe(0)
  })
})

describe('linked never exceeds live — shareOf would otherwise say "every listing"', () => {
  it('keeps linked a subset even when the two reads disagree', async () => {
    const { assembleFacts, shareOf } = await load()
    const f = assembleFacts({
      categories: [{ id: 'a', slug: 'rentals' }],
      live: [{ categoryId: 'a', _count: { _all: 10 } }],
      linked: [{ categoryId: 'a', _count: { _all: 11 } }, { categoryId: 'orphan', _count: { _all: 50 } }],
      motorbikes: 0,
      byCity: { hcmc: [], hanoi: [], daNang: [] },
    })
    expect(f.linked).toBe(10)
    expect(shareOf(f.linked, f.live)).toBe('all')
    const g = assembleFacts({
      categories: [{ id: 'a', slug: 'rentals' }],
      live: [{ categoryId: 'a', _count: { _all: 10 } }],
      linked: [{ categoryId: 'a', _count: { _all: 6 } }, { categoryId: 'orphan', _count: { _all: 50 } }],
      motorbikes: 0,
      byCity: { hcmc: [], hanoi: [], daNang: [] },
    })
    expect(shareOf(g.linked, g.live)).toBe('most') // 50 orphans must not turn 6/10 into "all"
  })
})

describe('a city never exceeds its category — shareOf would otherwise say "everything is in HCMC"', () => {
  it('caps each city count at the category total the same facts report', async () => {
    const { assembleFacts, inCity, shareOf } = await load()
    const f = assembleFacts({
      categories: [{ id: 'a', slug: 'rentals' }, { id: 'b', slug: 'jobs' }],
      live: [{ categoryId: 'a', _count: { _all: 10 } }, { categoryId: 'b', _count: { _all: 5 } }],
      linked: [],
      motorbikes: 0,
      // an import landed between the waves: 12 HCMC rentals against 10 counted live, 5 HCMC jobs of 5
      byCity: { hcmc: [{ categoryId: 'a', _count: { _all: 12 } }, { categoryId: 'b', _count: { _all: 5 } }], hanoi: [], daNang: [] },
    })
    expect(inCity(f, 'hcmc', 'rentals')).toBe(10)
    expect(inCity(f, 'hcmc')).toBe(15)
    const g = assembleFacts({
      categories: [{ id: 'a', slug: 'rentals' }, { id: 'b', slug: 'jobs' }],
      live: [{ categoryId: 'a', _count: { _all: 10 } }, { categoryId: 'b', _count: { _all: 5 } }],
      linked: [],
      motorbikes: 0,
      // 12 HCMC rentals must not stand in for the 5 jobs that are elsewhere
      byCity: { hcmc: [{ categoryId: 'a', _count: { _all: 12 } }], hanoi: [{ categoryId: 'b', _count: { _all: 5 } }], daNang: [] },
    })
    expect(shareOf(inCity(g, 'hcmc'), g.live)).toBe('most')
  })
})

describe('loadSiteFacts', () => {
  it('reads the shelf with every listing query edition-scoped, and the city split on the Area filter predicate', async () => {
    const { loadSiteFacts, resetSiteFactsMemo, inCity } = await load()
    resetSiteFactsMemo()
    const f = await loadSiteFacts()
    expect(f).not.toBeNull()
    expect(f!.byCategory).toEqual({ rentals: 25, electronics: 64, jobs: 10 })
    expect(f!.live).toBe(99)
    expect(f!.linked).toBe(84) // 20 + 64; the orphan c-gone is dropped, as it is from live
    expect(f!.motorbikes).toBe(0)
    expect(inCity(f!, 'hcmc', 'rentals')).toBe(25)
    expect(inCity(f!, 'hanoi')).toBe(6)
    expect(inCity(f!, 'daNang')).toBe(0)
    // ⛔ Every listing read carries the desk exclusion — the licensing boundary, not a nicety.
    for (const where of [...h.calls.groupBy, ...h.calls.count]) {
      expect(JSON.stringify(where)).toContain('"notIn":["desk"]')
    }
    // The city counts use provinceWhere (city OR location, plus the other spellings), i.e. the
    // same rows the public `?province=` filter returns — not a hand-rolled city equality.
    const hcmcWhere = JSON.stringify(h.calls.groupBy.find((w) => JSON.stringify(w).includes('Ho Chi Minh')))
    expect(hcmcWhere).toContain('"location":{"contains":"Ho Chi Minh"}')
    expect(hcmcWhere).toContain('Hồ Chí Minh')
  })

  it('is memoized — a second call within the TTL issues no query', async () => {
    const { loadSiteFacts, resetSiteFactsMemo } = await load()
    resetSiteFactsMemo()
    await loadSiteFacts()
    const before = h.calls.groupBy.length + h.calls.count.length + h.calls.category
    await loadSiteFacts()
    expect(h.calls.groupBy.length + h.calls.count.length + h.calls.category).toBe(before)
  })

  it('answers null on failure, never throws, and does not cache the failure', async () => {
    const { loadSiteFacts, resetSiteFactsMemo } = await load()
    resetSiteFactsMemo()
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.fail = true
    await expect(loadSiteFacts()).resolves.toBeNull()
    h.fail = false
    await expect(loadSiteFacts()).resolves.not.toBeNull()
    quiet.mockRestore()
  })
})

describe('a read that never settles', () => {
  it('answers null after the budget instead of holding the caller forever', async () => {
    vi.useFakeTimers()
    try {
      const { loadSiteFacts, resetSiteFactsMemo, READ_BUDGET_MS } = await load()
      resetSiteFactsMemo()
      h.hang = true
      const p = loadSiteFacts()
      await vi.advanceTimersByTimeAsync(READ_BUDGET_MS + 1)
      await expect(p).resolves.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
