import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GET /api/category-rails — the home page's "Browse by category" shelves.
 *
 * ⛔ A RETIRED SHELF NEVER RANKS IN (second-hand focus, owner 2026-10-03 — src/lib/retired-categories.ts).
 * Measured on production 2026-10-04: hobbies-sports held 4 live rows (the MIN_LISTINGS floor exactly) and
 * ranked 10th of 11, so the home page drew a "Hobbies & Sports" shelf. The filter has to run BEFORE the
 * MAX_RAILS cut, or the page loses a rail instead of letting the 11th category in.
 *
 * ⚠️ DATA SAFETY — the database, the edition scope and the translator are mocked by name.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  groups: [] as Row[],
  categories: [] as Array<{ id: string; slug: string }>,
  filledCategoryIds: [] as string[],
}))

vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      groupBy: async () => h.groups,
      findMany: async ({ where }: { where: Row }) => {
        h.filledCategoryIds.push(where.categoryId)
        return Array.from({ length: 8 }, (_, i) => ({ id: `${where.categoryId}-${i}` }))
      },
    },
    category: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => h.categories.filter((c) => where.id.in.includes(c.id)),
    },
  },
}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: Row) => w }))
vi.mock('@/lib/serialize', () => ({ LISTING_CARD_SELECT: {}, serializeListingCard: (l: Row) => l }))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: async (rows: Row[]) => rows }))
vi.mock('@/lib/feed-diversity', () => ({ diversifyRail: (rows: Row[], { take }: { take: number }) => rows.slice(0, take) }))
vi.mock('@/lib/admin', () => ({ getAdmin: async () => null, getCurrentProfile: async () => null, getCurrentProfileId: async () => null }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))

import { NextRequest } from 'next/server'
const { GET } = await import('./route')

/** Eleven categories that all clear the floor, demand descending in this order. */
const SLUGS = [
  'rentals', 'electronics', 'services', 'furniture-appliances', 'jobs', 'tickets-travel',
  'fashion-beauty', 'food-drink', 'baby-kids', 'hobbies-sports', 'books-stationery',
]

async function rails(): Promise<string[]> {
  const res = await GET(new NextRequest('https://eno.vn/api/category-rails'))
  expect(res.status).toBe(200)
  return ((await res.json()) as { rails: Array<{ slug: string }> }).rails.map((r) => r.slug)
}

beforeEach(() => {
  h.categories = SLUGS.map((slug) => ({ id: `id-${slug}`, slug }))
  // Demand falls with the index, so the order above is the ranking. Every category has at least 4 live rows.
  h.groups = SLUGS.map((slug, i) => ({
    categoryId: `id-${slug}`,
    _count: { _all: slug === 'hobbies-sports' ? 4 : 50 },
    _sum: { views: 1000 - i * 10, contactCount: 0 },
  }))
  h.filledCategoryIds = []
})

describe('GET /api/category-rails', () => {
  it('drops a retired category that clears the live-row floor, and the next one takes its place', async () => {
    const slugs = await rails()
    expect(slugs).not.toContain('hobbies-sports')
    expect(slugs).not.toContain('books-stationery')
    // Eleven qualify, two are retired: the other nine — the owner's lead first (category-lead.ts), then demand.
    expect(slugs).toEqual(['rentals', 'jobs', 'services', 'electronics', 'furniture-appliances', 'tickets-travel', 'fashion-beauty', 'food-drink', 'baby-kids'])
    // No query is spent filling a shelf that is never shown.
    expect(h.filledCategoryIds).not.toContain('id-hobbies-sports')
  })

  it('keeps MAX_RAILS full when a retired category would have ranked inside it', async () => {
    // Vehicles ranks 2nd and pets last; ten live categories remain. Cutting to MAX_RAILS (10) BEFORE dropping
    // vehicles would have cut `sports` (11th) and then shown nine rails.
    // ⚠️ `sports`, not `teachers` as this read before 2026-10-10: teachers is in the lead now, and teacher
    // profiles never reach this groupBy on production (scopedListingWhere keeps them out of listing shelves).
    h.categories.push({ id: 'id-vehicles', slug: 'vehicles' }, { id: 'id-pets', slug: 'pets' }, { id: 'id-sports', slug: 'sports' })
    h.groups = [
      { categoryId: 'id-vehicles', _count: { _all: 9 }, _sum: { views: 995, contactCount: 0 } },
      ...h.groups.filter((g) => !['id-hobbies-sports', 'id-books-stationery'].includes(g.categoryId)),
      { categoryId: 'id-sports', _count: { _all: 4 }, _sum: { views: 2, contactCount: 0 } },
      { categoryId: 'id-pets', _count: { _all: 5 }, _sum: { views: 1, contactCount: 0 } },
    ]
    const slugs = await rails()
    expect(slugs).toHaveLength(10)
    expect(slugs).not.toContain('vehicles')
    expect(slugs).not.toContain('pets')
    expect(slugs.at(-1)).toBe('sports')
  })

  /**
   * ⛔ OWNER, 2026-10-10: "put find a teacher to number 4 everywhere so rentals jobs services and then electronics".
   * These shelves were pure demand, which on production that day opened on electronics, rentals, furniture.
   * ⚠️ There is no teachers shelf, so electronics follows services here.
   */
  it('leads with rentals, jobs, services, electronics — then demand — on the production ranking', async () => {
    const live = ['electronics', 'rentals', 'furniture-appliances', 'services', 'fashion-beauty', 'tickets-travel', 'baby-kids', 'food-drink', 'jobs']
    h.categories = live.map((slug) => ({ id: `id-${slug}`, slug }))
    h.groups = live.map((slug, i) => ({ categoryId: `id-${slug}`, _count: { _all: 50 }, _sum: { views: 1000 - i * 10, contactCount: 0 } }))
    expect(await rails()).toEqual(['rentals', 'jobs', 'services', 'electronics', 'furniture-appliances', 'fashion-beauty', 'tickets-travel', 'baby-kids', 'food-drink'])
  })

  /** The lead ranks BEFORE the MAX_RAILS cut: a lead shelf last by demand still shows, and the lowest-demand shelf outside the lead yields. */
  it('a lead category last by demand is not cut; the weakest shelf outside the lead gives way', async () => {
    const live = ['electronics', 'furniture-appliances', 'fashion-beauty', 'tickets-travel', 'baby-kids', 'food-drink', 'sports', 'property', 'community-events', 'moving-sale', 'jobs']
    h.categories = live.map((slug) => ({ id: `id-${slug}`, slug }))
    h.groups = live.map((slug, i) => ({ categoryId: `id-${slug}`, _count: { _all: 50 }, _sum: { views: 1000 - i * 10, contactCount: 0 } }))
    const slugs = await rails()
    expect(slugs).toHaveLength(10)
    expect(slugs.slice(0, 3)).toEqual(['jobs', 'electronics', 'moving-sale'])
    expect(slugs).not.toContain('community-events')
  })

  it('still drops a category below the floor, retired or not', async () => {
    h.groups = h.groups.map((g) => (g.categoryId === 'id-jobs' ? { ...g, _count: { _all: 3 } } : g))
    expect(await rails()).not.toContain('jobs')
  })
})
