import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A WORDS SEARCH INSIDE TEACHERS, AND NOWHERE ELSE (2026-10-14). The keyword path re-scopes the feed's `where` three
 * times (the ranked set, the ranked page, the tail). With no teacher decision each re-scope added the teacher exclusion
 * back, so /api/listings?category=teachers&q=… ranked and served nothing. The route now passes buildFeedFilters' own
 * decision (`teachersIn`) to every re-scope: a teachers search keeps its rows, and every other search gets the default
 * exclusion re-added as a backstop — even a read whose input carries none (the semantic path's page read). The REAL
 * scopedListingWhere and teacherExclusion run here (marketplace edition); only the database is a fake that records
 * every listing read. The decision itself is buildFeedFilters' (feed-query.teachers-in.test.ts).
 */
const h = vi.hoisted(() => ({ reads: [] as unknown[] }))

vi.mock('@/lib/edition', () => ({ IS_SERVICES: false, IS_MARKETPLACE: true, EDITION: 'marketplace' }))
vi.mock('@/lib/visa-shop', async (orig) => ({ ...(await orig<Record<string, unknown>>()), VISA_SHOP_OWNER_EMAILS: ['visa@eno.vn'] }))
vi.mock('@/lib/trips/dm-thread', async (orig) => ({ ...(await orig<Record<string, unknown>>()), TRIP_DESK_OWNER_EMAILS: ['trips@eno.vn'] }))
vi.mock('@/lib/db', () => ({
  db: {
    category: { findUnique: async () => ({ id: 'cat-teachers' }) },
    seller: { findMany: async () => [{ id: 'desk-1' }] },
    listing: { findMany: async (args: { where: unknown }) => { h.reads.push(args.where); return [] } },
  },
}))
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: (f: unknown) => f }))

const { teacherExclusion, resetTeachersCategoryIdForTests } = await import('@/lib/edition-scope')
const { keywordRank, __resetKeywordRankCache } = await import('./keyword-rank')
const { pageRankedThenTail } = await import('./ranked-page')

const ORDER = [{ rankScore: 'desc' as const }, { id: 'desc' as const }]
const TEACHER_EXCLUSION = '"categoryId":{"not":"cat-teachers"}'
const DESK_EXCLUSION = '"notIn":["desk-1"]'
/** The feed's `where` as buildFeedFilters builds it: its own AND array, the teacher decision one element of it. */
const feedWhere = async (category: 'teachers' | null) => {
  const teacherScope = await teacherExclusion({ teachers: category === 'teachers' })
  return { AND: [{ verified: true }, { status: 'active' }, ...(teacherScope ? [teacherScope] : [])] }
}
const search = async (category: 'teachers' | null) =>
  keywordRank({ q: 'english', looseMatch: false, featuredOnly: false, sort: 'newest', offset: 0, limit: 12, where: await feedWhere(category), orderBy: ORDER, teachers: category === 'teachers' })

beforeEach(() => {
  h.reads = []
  __resetKeywordRankCache()
  resetTeachersCategoryIdForTests()
})

describe('the keyword path keeps the feed\'s teacher decision through every re-scope', () => {
  it('inside teachers: no read adds the teacher exclusion back — the desk exclusion still applies to each', async () => {
    await search('teachers')
    expect(h.reads.length).toBeGreaterThan(0)
    for (const where of h.reads) {
      expect(JSON.stringify(where)).not.toContain(TEACHER_EXCLUSION)
      expect(JSON.stringify(where)).toContain(DESK_EXCLUSION)
    }
  })

  it('outside teachers: every read still excludes teachers (and the desk)', async () => {
    await search(null)
    expect(h.reads.length).toBeGreaterThan(0)
    for (const where of h.reads) {
      expect(JSON.stringify(where)).toContain(TEACHER_EXCLUSION)
      expect(JSON.stringify(where)).toContain(DESK_EXCLUSION)
    }
  })

  it('the ranked page and the tail follow the decision passed; the page read keeps the filters it is given', async () => {
    // The semantic path's shape inside teachers: pageWhere = its structural filters (semantic-rank.ts).
    const teachersFilters = { AND: [...(await feedWhere('teachers')).AND, { categoryId: 'cat-teachers' }] }
    await pageRankedThenTail({ rankedIds: ['a', 'b'], pageWhere: teachersFilters, tailWhere: teachersFilters, orderBy: ORDER, offset: 0, limit: 12, teachers: true })
    // A caller with NO pageWhere outside teachers: the ids alone reach the page read, and the backstop still applies.
    await pageRankedThenTail({ rankedIds: ['a', 'b'], tailWhere: await feedWhere(null), orderBy: ORDER, offset: 0, limit: 12, teachers: false })
    const [teachersPage, teachersTail, generalPage, generalTail] = h.reads.map((w) => JSON.stringify(w))
    expect(teachersPage).not.toContain(TEACHER_EXCLUSION)
    expect(teachersPage).toContain('"categoryId":"cat-teachers"')
    expect(teachersPage).toContain('"status":"active"')
    expect(teachersTail).not.toContain(TEACHER_EXCLUSION)
    expect(generalPage).toContain('"in":["a","b"]')
    expect(generalPage).toContain(TEACHER_EXCLUSION)
    expect(generalTail).toContain(TEACHER_EXCLUSION)
  })
})
