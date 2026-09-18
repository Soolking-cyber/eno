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
  /**
   * ⛔ SIX UNIT ROWS, AND THE SPANS ARE THE TWO MOBILE SHAPES (owner: "on mobile 2 rows when swiped
   * transitions into 3"). The first six tiles span THREE units — two to a column, so the opening
   * screen is 3 × 2 — and everything after them spans TWO, three to a column. Desktop is one unit
   * row per tile in a two-row grid. Exact tokens, because `toContain` on a class string would take
   * `md:grid-rows-2` for the phone rule.
   */
  it('is six unit rows on a phone and two from md', () => {
    const { gridCls } = renderRail(cats(10))
    const tokens = gridCls.split(/\s+/)
    expect(tokens).toContain('grid-rows-6')
    expect(tokens).toContain('md:grid-rows-2')
    expect(tokens).toContain('auto-cols-max')
  })

  it('gives the first screen two rows and the swiped pages three', () => {
    const { tiles } = renderRail(cats(10))
    const spans = tiles.map((t) => (t.className.includes('row-span-3') ? 3 : t.className.includes('row-span-2') ? 2 : 0))
    expect(spans.slice(0, 6)).toEqual([3, 3, 3, 3, 3, 3])
    expect(spans.slice(6)).toEqual(Array(spans.length - 6).fill(2))
    // every tile is one COLUMN wide — only the subcategory box is wider, and by its content
    for (const t of tiles) expect(t.className).not.toMatch(/\bcol-span-/)
  })

  /**
   * ⛔ NO MID-RAIL HOLE, AT ANY SELECTION. The phone grid is six unit rows per column and the
   * subcategory box takes a whole one, so the selected tile has to fill whatever is left of ITS
   * column or the grid strands the remainder — measured at 137px under the tapped tile before the
   * flow cursor replaced index arithmetic, then 48px where the two-row region met the three-row one.
   * This walks the rendered spans column by column: every column must come to exactly six units,
   * except the last, which is simply where the list ends.
   */
  it('fills every column but the last, whichever category is open', () => {
    for (const active of ['all', 'vehicles', 'electronics', 'services', 'property', 'jobs']) {
      const { tiles, container } = renderRail(cats(10), active)
      const boxAfter = new Set<number>()
      const spans = tiles.map((t, i) => {
        if (t.getAttribute('data-cat') === active && container.querySelector('[data-subcat]')) boxAfter.add(i)
        const m = t.className.match(/(?:^|\s)row-span-(\d)/)
        return m ? Number(m[1]) : 0
      })
      const columns: number[] = []
      let used = 0
      spans.forEach((span, i) => {
        expect(span, `${active}: tile ${i} has a span`).toBeGreaterThan(0)
        used += span
        if (used >= 6 || boxAfter.has(i)) { columns.push(used); used = 0 }
      })
      if (used > 0) columns.push(used) // the tail
      const full = used > 0 ? columns.slice(0, -1) : columns
      for (const [i, units] of full.entries()) expect(units, `${active}: column ${i}`).toBe(6)
    }
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
  /** The box lives INSIDE the rail, beside its category, and spans the rail's whole height. */
  it('renders the box as a full-height item next to the active tile', () => {
    const { container } = renderRail(cats(10), 'rentals')
    const box = container.querySelector('[data-subcat]')!.closest('div.row-span-6')
    expect(box).not.toBeNull()
    expect(box!.className).toContain('md:row-span-2')
    // it is the tile's next sibling, so it opens where the visitor tapped
    expect(box!.previousElementSibling?.getAttribute('data-cat')).toBe('rentals')
  })

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
