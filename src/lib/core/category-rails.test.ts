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
  /** Rows each fill read returns (8 = a short pool, no top-up); `crowd` = what crowdingSellers answers. */
  poolSize: 8,
  crowd: [] as string[],
}))

vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      groupBy: async ({ where }: { where: Row }) => { if (h.throwOn === 'groupBy') throw new Error('db down'); h.wheres.push(where); return h.groups },
      findMany: async ({ where }: { where: Row }) => {
        h.wheres.push(where)
        if (where.AND?.[1]?.sellerId) return [{ id: 'other-1', title: 'o1' }, { id: 'other-2', title: 'o2' }] // the top-up read
        const categoryId = (where.AND?.[0] ?? where).categoryId
        return Array.from({ length: h.poolSize }, (_, i) => ({ id: `${categoryId}-${i}`, title: `t${i}` }))
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
vi.mock('@/lib/feed-diversity', () => ({
  diversifyRail: (rows: Row[], { take }: { take: number }) => rows.slice(0, take),
  crowdingSellers: () => h.crowd,
}))

const { homeCategoryRails } = await import('./category-rails')

beforeEach(() => {
  h.categories = ['rentals', 'jobs', 'services'].map((slug) => ({ id: `id-${slug}`, slug }))
  h.groups = h.categories.map((c, i) => ({ categoryId: c.id, _count: { _all: 50 }, _sum: { views: 100 - i, contactCount: 0 } }))
  h.wheres = []
  h.langs = []
  h.throwOn = ''
  h.poolSize = 8
  h.crowd = []
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

/** 2026-11-18: a full pool one seller crowds reads the next rows without that seller, under the same scope. */
describe('homeCategoryRails top-up', () => {
  it('a full, crowded pool reads again without the crowding sellers, inside the same scoped where', async () => {
    h.poolSize = 40
    h.crowd = ['big']
    const rails = await homeCategoryRails('en')
    const topUps = h.wheres.filter((w) => w.AND?.[1]?.sellerId)
    expect(topUps).toHaveLength(3) // one per rail
    for (const w of topUps) {
      expect(w.AND[1]).toEqual({ sellerId: { notIn: ['big'] } })
      expect(JSON.stringify(w.AND[0])).toContain('__scoped')
    }
    expect(rails.length).toBe(3)
  })

  it('a short pool or an uncrowded one makes no second read', async () => {
    h.crowd = ['big'] // short pool: crowding is never asked
    await homeCategoryRails('en')
    h.poolSize = 40
    h.crowd = [] // full but diverse
    await homeCategoryRails('en')
    expect(h.wheres.filter((w) => w.AND?.[1]?.sellerId)).toHaveLength(0)
  })

  it('leaves out what the page shows above (the feed\'s first page), never below MIN_LISTINGS (Seobility 2026-11-23)', async () => {
    h.poolSize = 12
    const rails = await homeCategoryRails('en', { excludeIds: Promise.resolve(['id-rentals-0', 'id-rentals-1', 'id-jobs-3']) })
    const rentals = rails.find((r) => r.slug === 'rentals')!.listings.map((l) => l.id)
    expect(rentals).toEqual(['id-rentals-2', 'id-rentals-3', 'id-rentals-4', 'id-rentals-5', 'id-rentals-6', 'id-rentals-7', 'id-rentals-8', 'id-rentals-9'])
    expect(rails.find((r) => r.slug === 'jobs')!.listings.map((l) => l.id)).not.toContain('id-jobs-3')
    h.poolSize = 4
    const thin = await homeCategoryRails('en', { excludeIds: ['id-services-0'] })
    expect(thin.find((r) => r.slug === 'services')!.listings.map((l) => l.id)).toContain('id-services-0') // 3 left would be under 4: kept whole
  })
  it('a first page that failed excludes nothing and takes no shelf down (gate 2026-11-23)', async () => {
    const rails = await homeCategoryRails('en', { excludeIds: Promise.reject(new Error('feed down')) })
    expect(rails.map((r) => r.slug)).toEqual(['rentals', 'jobs', 'services'])
    expect(rails.every((r) => r.listings.length === 8)).toBe(true)
  })
})
