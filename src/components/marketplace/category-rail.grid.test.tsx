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
      const { tiles } = renderRail(cats(10), active)
      const spans = tiles.map((t) => {
        const m = t.className.match(/(?:^|\s)row-span-(\d)/)
        return m ? Number(m[1]) : 0
      })
      const columns: number[] = []
      let used = 0
      spans.forEach((span, i) => {
        expect(span, `${active}: tile ${i} has a span`).toBeGreaterThan(0)
        used += span
        if (used >= 6) { columns.push(used); used = 0 }
      })
      if (used > 0) columns.push(used) // the tail
      const full = used > 0 ? columns.slice(0, -1) : columns
      for (const [i, units] of full.entries()) expect(units, `${active}: column ${i}`).toBe(6)
    }
  })

  /**
   * ⛔ THE SPANS ARE IDENTICAL WITH AND WITHOUT A SELECTION. This is the guard for "categories when
   * pressed they shift down and center, dont": the previous version stretched the pressed tile to
   * close its column, which re-centred it and re-flowed everything after. Measured in the browser
   * too — pressing any of five categories moved no tile at or before it — but the cause is here.
   */
  it('changes no tile span when a category is pressed', () => {
    const spansOf = (active: string) => renderRail(cats(10), active).tiles.map((t) => t.className.match(/(?:^|\s)row-span-\d/)?.[0].trim())
    const idle = spansOf('all')
    for (const active of ['electronics', 'services', 'vehicles', 'jobs']) expect(spansOf(active), active).toEqual(idle)
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
  /**
   * The box lives INSIDE the rail, spans its whole height, and is placed EXPLICITLY — in the column
   * after the pressed tile's, so no tile changes span or row when a category is pressed (owner:
   * "category doesnt shift and categories below it stays at the same place").
   */
  it('renders the box as a full-height item placed in its own column', () => {
    const { container } = renderRail(cats(10), 'rentals')
    // ⚠️ BY ITS STYLE HOOK, NOT `[class*=grid-row]` — the chip plate inside it matches that too.
    const box = container.querySelector('[data-subcat]')!.closest('div[style*="--sub-col-m"]') as HTMLElement
    expect(box).not.toBeNull()
    expect(box.className).toContain('[grid-row:1/-1]')
    expect(box.className).toContain('[grid-column:var(--sub-col-m)]')
    expect(box.className).toContain('md:[grid-column:var(--sub-col-d)]')
    // both breakpoints get a column index, and it is past the pressed tile's own column
    expect(Number(box.style.getPropertyValue('--sub-col-m'))).toBeGreaterThan(1)
    expect(Number(box.style.getPropertyValue('--sub-col-d'))).toBeGreaterThan(1)
    expect(box.previousElementSibling?.getAttribute('data-cat')).toBe('rentals')
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
