// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'

import { LanguageProvider } from '@/context/language-context'
import { SUBCATEGORIES } from '@/lib/subcategories'
import { CategoryRail } from './category-rail'

/**
 * THE RAIL'S SHAPE — the three things a screenshot of the real home page cannot check, because the
 * real rail always has plenty of tiles and its own edition's categories.
 *
 * Owner, 2026-09-18: "mobile initial one … grid 3x3 not 2x2", "make the subcategory plate fully no
 * dropdown … if overflow swipe to the right", "remove All category from both desktop and mobile".
 * So: every tile is ONE CELL in a 3-row grid on a phone and a 2-row grid from `md`; there is no
 * "All" tile; and the plate holds every subcategory of the active category, in taxonomy order.
 *
 * ⚠️ THIS FILE REPLACED A GUARD ON THE SPAN SYSTEM IT SUPERSEDES. The previous layout gave the first
 * four tiles `col-span-2 row-span-3`, which needed rules about even counts and short rails; a uniform
 * cell has none of those cases. What survives from that round is the habit of pinning the SHAPE, and
 * one case it caught: the rail is reachable with `categories: []` (the home page's `getData()` catch).
 */
afterEach(cleanup)

const TestResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = TestResizeObserver
HTMLElement.prototype.scrollTo = () => {}

type Cats = React.ComponentProps<typeof CategoryRail>['categories']
const POOL = ['vehicles', 'electronics', 'services', 'property', 'jobs', 'rentals', 'fashion-beauty', 'sports', 'pets', 'baby-kids']
const cats = (n: number) =>
  POOL.slice(0, n).map((slug) => ({ id: slug, slug, name: slug, nameVi: slug, icon: 'Car' })) as unknown as Cats
/** The three live intent tiles (INTENT_SHORTCUTS' shape). `shortcuts` is fed from DESK_SHORTCUTS,
 *  which is `[]` on both editions since 2026-09-13, so exercising it would pin dead code. */
const INTENTS = [
  { type: 'free', name: 'Free', nameVi: 'Miễn phí', icon: 'Gift' },
  { type: 'wanted', name: 'Wanted', nameVi: 'Cần mua', icon: 'PackageSearch' },
  { type: 'wholesale', name: 'Wholesale', nameVi: 'Bán sỉ', icon: 'Boxes' },
]

function renderRail(categories: Cats, activeCategory = 'all', activeSubcategory = 'all', subcategoryCounts: Record<string, number> = {}) {
  const { container } = render(
    <LanguageProvider>
      <CategoryRail
        categories={categories}
        intents={INTENTS}
        activeCategory={activeCategory}
        activeSubcategory={activeSubcategory}
        subcategoryCounts={subcategoryCounts}
        onCategory={() => {}}
        onSubcategory={() => {}}
        onIntent={() => {}}
      />
    </LanguageProvider>,
  )
  const grid = container.querySelector('[role="group"][aria-label]')!
  return {
    container,
    gridCls: grid.className,
    tiles: [...grid.querySelectorAll('[data-cat],[data-intent],[data-shortcut]')],
    chips: [...container.querySelectorAll('[data-subcat]')].map((el) => el.getAttribute('data-subcat')),
  }
}

describe('<CategoryRail> grid shape', () => {
  it('is 3 rows on a phone and 2 from md, one cell per tile', () => {
    const { gridCls, tiles } = renderRail(cats(10))
    // Exact tokens: `toContain` on a class string would accept `md:grid-rows-3` for the phone rule.
    const tokens = gridCls.split(/\s+/)
    expect(tokens).toContain('grid-rows-3')
    expect(tokens).toContain('md:grid-rows-2')
    expect(tokens).not.toContain('grid-rows-6')
    // ⛔ NO SPANS. A tile that spans rows or columns is the layout this replaced.
    for (const t of tiles) expect(t.className).not.toMatch(/\b(row-span|col-span)-/)
  })

  it('renders no "All" tile, at any rail length', () => {
    for (const n of [0, 1, 4, 10]) {
      const { tiles } = renderRail(cats(n))
      expect(tiles.map((t) => t.getAttribute('data-cat'))).not.toContain('all')
      // every category the edition passed IS a tile, plus the three intents
      expect(tiles.length).toBe(n + INTENTS.length)
    }
  })
})

describe('<CategoryRail> subcategory plate', () => {
  it('shows EVERY subcategory of the active category — no More dropdown', () => {
    const slug = 'rentals'
    const { chips, container } = renderRail(cats(10), slug)
    expect(chips).toEqual(SUBCATEGORIES[slug].map((s) => s.slug))
    expect(chips.length).toBeGreaterThan(8) // the count that used to trigger the cut
    expect(container.textContent).not.toMatch(/\+\d/) // the +N badge is gone with it
  })

  /** Taxonomy order IS the hierarchy the visitor sees (owner: "make rentals follow 58.com
   *  hierarchy"), so the plate must not re-sort — by counts or anything else. */
  it('keeps taxonomy order, and rentals leads with homes before vehicle hire', () => {
    const { chips } = renderRail(cats(10), 'rentals')
    expect(chips.indexOf('apartment-rental')).toBeLessThan(chips.indexOf('motorbike-rental'))
    expect(chips.indexOf('house-rental')).toBeLessThan(chips.indexOf('hotel-short-stay'))
    expect(chips.indexOf('office-rental')).toBeLessThan(chips.indexOf('car-rental'))
  })

  /**
   * ⛔ THE ORDER MUST NOT FOLLOW THE COUNTS, and with empty counts every case above would pass even
   * if it did (a reviewer's catch). These counts are the shape that used to re-sort the plate: the
   * LAST chip in taxonomy order carries by far the most listings, so the deleted count-sort would
   * have hoisted it to the front.
   */
  it('ignores listing counts when ordering — taxonomy order wins', () => {
    const taxonomy = SUBCATEGORIES['rentals'].map((s) => s.slug)
    const loud = { [taxonomy.at(-1)!]: 9999, [taxonomy[0]]: 1 }
    expect(renderRail(cats(10), 'rentals', 'all', loud).chips).toEqual(taxonomy)
  })

  it('opens no plate for a category this edition does not list', () => {
    // `?category=<slug>` is user input: a services-only slug must not open the other edition's chips.
    expect(renderRail(cats(2), 'rentals').chips).toEqual([])
    expect(renderRail(cats(10), 'not-a-category').chips).toEqual([])
  })
})
