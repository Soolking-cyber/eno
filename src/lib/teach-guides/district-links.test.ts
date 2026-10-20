import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MIN_INDEXABLE_LISTINGS } from '@/lib/index-floor'
import { RENTAL_PLACES } from '@/lib/rental-places'

/**
 * district-links.ts: the guide page asks the data which district rentals pages it links are under the indexing floor —
 * a 404 when empty ([district]/page.tsx) — and renders those links as text. The database, the edition scope and the
 * district scope are stand-ins that record what they were asked.
 */
const h = vi.hoisted(() => ({
  counts: {} as Record<string, number>,
  counted: [] as { where: unknown }[],
  scoped: [] as unknown[][],
  down: false,
}))
vi.mock('@/lib/db', () => ({
  db: {
    category: { findUnique: async () => (h.down ? Promise.reject(new Error('connection refused')) : { id: 'cat-rentals', slug: 'rentals' }) },
    listing: {
      count: async (args: { where: { AND: [unknown, { district: string }] } }) => {
        h.counted.push(args)
        return h.counts[args.where.AND[1].district] ?? 0
      },
    },
  },
}))
vi.mock('@/lib/edition-scope', () => ({
  scopedListingWhere: async (where: unknown, opts: unknown) => {
    h.scoped.push([where, opts])
    return { scoped: where }
  },
}))
vi.mock('@/lib/district-slug', () => ({ districtScopeForSlug: async (slug: string) => (slug === 'nowhere' ? null : { district: slug }) }))

const { districtLinksAsText } = await import('./district-links')
const guide = (...keyPoints: string[]) => ({ keyPoints, sections: [] })

beforeEach(() => {
  h.counts = { d1: 1373, 'thu-duc': 98, d2: 0, d3: MIN_INDEXABLE_LISTINGS - 1, d7: MIN_INDEXABLE_LISTINGS }
  h.counted = []
  h.scoped = []
  h.down = false
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('districtLinksAsText', () => {
  it('a guide that links no district reads nothing', async () => {
    const empty = await districtLinksAsText(guide('See [the schools](/schools), [every rental](/c/rentals) and [a source](https://example.com/c/rentals/d2).'))
    expect([...empty]).toEqual([])
    expect([h.scoped.length, h.counted.length]).toEqual([0, 0])
  })

  it('returns the district pages under the floor only, counting each once with the district page’s own predicate', async () => {
    const empty = await districtLinksAsText(
      guide('[District 1](/c/rentals/d1) or [Thao Dien](/c/rentals/d2).', '[District 1 again](/c/rentals/d1#rent) and [Thu Duc](/c/rentals/thu-duc).'),
    )
    expect([...empty]).toEqual(['/c/rentals/d2'])
    // [district]/page.tsx `load()`: rentals, verified and active, places only, edition-scoped with teachers allowed…
    expect(h.scoped).toEqual([[{ AND: [{ categoryId: 'cat-rentals', verified: true, status: 'active' }, RENTAL_PLACES] }, { teachers: true }]])
    // …AND the district's own scope, one count per distinct path.
    expect(h.counted.map((c) => c.where)).toEqual(
      ['d1', 'd2', 'thu-duc'].map((district) => ({ AND: [{ scoped: { AND: [{ categoryId: 'cat-rentals', verified: true, status: 'active' }, RENTAL_PLACES] } }, { district }] })),
    )
  })

  it('the floor is the line: one place under it is text, at it a link', async () => {
    expect([...(await districtLinksAsText(guide('[District 3](/c/rentals/d3) and [District 7](/c/rentals/d7).')))]).toEqual(['/c/rentals/d3'])
  })

  it('a district with no scope is a 404 too, and is not counted', async () => {
    expect([...(await districtLinksAsText(guide('[Nowhere](/c/rentals/nowhere)')))]).toEqual(['/c/rentals/nowhere'])
    expect(h.counted).toEqual([])
  })

  it('a failed read fails closed: every district link renders as text this time, the guide’s other links untouched', async () => {
    h.down = true
    const empty = await districtLinksAsText(guide('[District 1](/c/rentals/d1), [Thao Dien](/c/rentals/d2) and [the schools](/schools).'))
    expect([...empty]).toEqual(['/c/rentals/d1', '/c/rentals/d2'])
    expect(console.warn).toHaveBeenCalledOnce()
  })
})
