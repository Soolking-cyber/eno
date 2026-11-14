import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * homeCategoryRails() — the home page's per-category shelves, read into its ISR document since 2026-11-14 (owner-approved,
 * cook r04 home-b "lanes as rails": on a phone they are lanes ABOVE the feed, so they must be in the server's HTML). The
 * ranking, retirement and in-app rules are pinned through the route that wraps it (api/category-rails/route.test.ts and
 * route.lang.test.ts); this file pins what the home page relies on directly: the same scope on the ranking and on every
 * fill, the title language passed straight through, and a throw left to the caller (the page logs it and draws no lanes).
 * ⚠️ DATA SAFETY — the database, the edition scope and the translator are mocked by name.
 */
type Row = Record<string, any>

const h = vi.hoisted(() => ({
  groups: [] as Row[],
  categories: [] as Array<{ id: string; slug: string }>,
  wheres: [] as Row[],
  langs: [] as Array<string | undefined>,
  throwOn: '' as '' | 'groupBy',
}))

vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      groupBy: async ({ where }: { where: Row }) => { if (h.throwOn === 'groupBy') throw new Error('db down'); h.wheres.push(where); return h.groups },
      findMany: async ({ where }: { where: Row }) => {
        h.wheres.push(where)
        const categoryId = (where.AND?.[0] ?? where).categoryId
        return Array.from({ length: 8 }, (_, i) => ({ id: `${categoryId}-${i}`, title: `t${i}` }))
      },
    },
    category: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => h.categories.filter((c) => where.id.in.includes(c.id)),
    },
  },
}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: Row) => ({ ...w, __scoped: true }) }))
vi.mock('@/lib/serialize', () => ({ LISTING_CARD_SELECT: {}, serializeListingCard: (l: Row) => l }))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: async (rows: Row[], lang?: string) => { h.langs.push(lang); return rows } }))
vi.mock('@/lib/feed-diversity', () => ({ diversifyRail: (rows: Row[], { take }: { take: number }) => rows.slice(0, take) }))

const { homeCategoryRails } = await import('./category-rails')

beforeEach(() => {
  h.categories = ['rentals', 'jobs', 'services'].map((slug) => ({ id: `id-${slug}`, slug }))
  h.groups = h.categories.map((c, i) => ({ categoryId: c.id, _count: { _all: 50 }, _sum: { views: 100 - i, contactCount: 0 } }))
  h.wheres = []
  h.langs = []
  h.throwOn = ''
})

describe('homeCategoryRails', () => {
  it('ranks and fills under the edition scope, in-app only, every read', async () => {
    const rails = await homeCategoryRails()
    expect(rails.map((r) => r.slug)).toEqual(['rentals', 'jobs', 'services'])
    expect(rails.every((r) => r.listings.length === 8)).toBe(true)
    const { IN_APP_ONLY } = await import('@/lib/in-app-listing')
    expect(h.wheres).toHaveLength(1 + 3)
    for (const w of h.wheres) {
      expect(w.AND?.[0]?.__scoped, JSON.stringify(w)).toBe(true)
      expect(w.AND).toContainEqual(IN_APP_ONLY)
    }
  })

  it('passes the ISR entry\'s title language straight through, ONE translation read for every rail', async () => {
    await homeCategoryRails('vi')
    await homeCategoryRails(undefined)
    expect(h.langs).toEqual(['vi', undefined])
  })

  it('throws to its caller (the home page logs it and draws no lanes; the route answers 500)', async () => {
    h.throwOn = 'groupBy'
    await expect(homeCategoryRails()).rejects.toThrow('db down')
  })
})
