import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ NO CHIP LINKS A DISTRICT PAGE UNDER THE INDEXING FLOOR (SEO wave B, I1; src/lib/index-floor.ts).
 *
 * Below 10 listings `/c/<cat>/<district>` answers `noindex, follow`, and a chip is a followed link: the
 * category page linked `/c/rentals/can-gio` (one rental) from its "By area" row. Three chip rows link
 * district pages — the category page's, /c/rentals' busiest districts, and the district page's
 * siblings — and each must drop a place under the floor, counted after its spellings are merged.
 *
 * Its own file rather than category-text.test.tsx, which the rentals copy commits edit (plan §2).
 */

type Group = { district: string | null; _count: { _all: number } }
const h = vi.hoisted(() => ({ groups: [] as Group[], count: 0 }))

vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      groupBy: async ({ by }: { by: string[] }) =>
        // The facts' subcategory breakdown is another groupBy; only the district one carries chips.
        by[0] === 'district' ? h.groups : [{ subcategorySlug: 'apartment-rental', _count: { _all: h.count } }],
      count: async () => h.count,
    },
  },
}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: object) => w }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))

import { loadDistrictChips, loadRentalsFacts } from './category-data'
import { MIN_INDEXABLE_LISTINGS } from '@/lib/index-floor'

const g = (district: string, n: number): Group => ({ district, _count: { _all: n } })

beforeEach(() => {
  h.count = 500
  h.groups = [
    g('Quận 1', 40),
    g('Quận 3', MIN_INDEXABLE_LISTINGS), // exactly at the floor → linked
    g('Quận 9', MIN_INDEXABLE_LISTINGS - 1), // one under → not
    g('Cần Giờ', 1), // /c/rentals/can-gio, 2026-09-27
    // Two stored spellings of one place, 6 + 4: one `cu-chi` page of 10 → linked.
    g('Quận Củ Chi', 6),
    g('Huyện Củ Chi', 4),
    // A non-curated place split 5 + 4 across spellings that slugify alike: 9 → not.
    g('Cư M\'gar', 5),
    g('Cư M’gar', 4),
  ]
})

describe('the category page chips (loadDistrictChips)', () => {
  it('keep only places at the floor, counted after the spellings merge', async () => {
    const chips = await loadDistrictChips('cat-rentals', true)
    expect(chips.map((c) => [c.slug, c.count])).toEqual([['d1', 40], ['cu-chi', 10], ['d3', 10]])
    expect(chips.every((c) => c.count >= MIN_INDEXABLE_LISTINGS)).toBe(true)
  })

  it('are empty when no place reaches the floor', async () => {
    h.groups = [g('Cần Giờ', 1), g('Quận 9', MIN_INDEXABLE_LISTINGS - 1)]
    expect(await loadDistrictChips('cat-books')).toEqual([])
  })
})

describe('/c/rentals busiest districts (loadRentalsFacts().top)', () => {
  it('name only places at the floor', async () => {
    const facts = await loadRentalsFacts('cat-rentals', h.count)
    expect(facts?.top.map((c) => c.slug)).toEqual(['d1', 'cu-chi', 'd3'])
  })
})

describe('where each chip row gets its floor (source contract)', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), 'src/app/[lang]/c/[category]', p), 'utf8')

  it('the district page filters its sibling chips by the floor', () => {
    expect(read('[district]/page.tsx')).toMatch(
      /const otherDistricts = districts\.filter\(\(d\) => d\.slug !== district && isIndexableCount\(d\.count\)\)/,
    )
  })

  /**
   * The category page takes its chips from loadDistrictChips and nowhere else, and on rentals always
   * places-only: /c/rentals/<district> counts places, so a chip tallied over vehicle hire (the
   * no-place fallback grid) would link a 404.
   */
  it('the category page reads its chips only through loadDistrictChips, places-only on rentals', () => {
    const src = read('(index)/page.tsx')
    expect(src).toMatch(/loadDistrictChips\(cat\.id, cat\.slug === 'rentals'\)/)
    expect(src).not.toMatch(/mergeDistrictGroups|groupBy\(\{\s*by: \['district'\]/)
  })
})
