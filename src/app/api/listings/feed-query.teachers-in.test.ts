import { describe, expect, it, vi } from 'vitest'

/**
 * `teachersIn` IS THE DECISION THE FILTERS CARRY (2026-10-14): the route hands it to every later re-scope (keyword and
 * semantic ranking, the tail, the district-fallback probe), so it must be exactly what teacherExclusion was asked —
 * true on the teachers category (or a facet count that includes teachers), false everywhere else.
 */
const h = vi.hoisted(() => ({ asked: [] as unknown[] }))
vi.mock('@/lib/db', () => ({
  db: {
    listing: { groupBy: vi.fn(async () => []) },
    category: { findUnique: vi.fn(async () => null) },
  },
}))
vi.mock('@/lib/edition-scope', () => ({
  scopedListingWhere: async (w: unknown) => w,
  marketplaceListingScope: async () => ({}),
  teacherExclusion: async (opts: { teachers?: boolean }) => {
    h.asked.push(opts)
    return opts.teachers ? null : { categoryId: { not: 'cat-teachers' } }
  },
}))
vi.mock('@/lib/serialize', () => ({ LISTING_CARD_SELECT: {}, serializeListingCard: (r: unknown) => r }))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: async (l: unknown) => l }))

import { buildFeedFilters } from './feed-query'

const decide = async (qs: string, opts?: { includeTeachers?: boolean }) => {
  h.asked = []
  const f = await buildFeedFilters(new URLSearchParams(qs), opts)
  return { teachersIn: f.teachersIn, asked: h.asked, excluded: JSON.stringify(f.andFilters).includes('"not":"cat-teachers"') }
}

describe('buildFeedFilters — teachersIn', () => {
  it('the teachers category: true, and the filters admit teacher rows', async () => {
    expect(await decide('category=teachers&q=english')).toEqual({ teachersIn: true, asked: [{ teachers: true }], excluded: false })
  })

  it('a facet count that includes teachers: true', async () => {
    expect(await decide('q=english', { includeTeachers: true })).toEqual({ teachersIn: true, asked: [{ teachers: true }], excluded: false })
  })

  it.each(['q=english', 'category=rentals&q=english', ''])('anything else (%s): false, and the filters exclude teachers', async (qs) => {
    expect(await decide(qs)).toEqual({ teachersIn: false, asked: [{ teachers: false }], excluded: true })
  })
})
