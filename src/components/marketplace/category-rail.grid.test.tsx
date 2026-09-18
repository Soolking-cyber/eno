// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'

import { LanguageProvider } from '@/context/language-context'
import { CategoryRail } from './category-rail'

/**
 * THE GRID'S SPAN RULES — the part of the 58-style rail that a screenshot of the real home page
 * cannot check, because the real rail always has enough tiles.
 *
 * Owner, 2026-09-18: "2 rows big top 4 categories rest reveal in 3 rows upon swipe". The mobile
 * grid is 6 rows deep and column-filled: an XL tile is `col-span-2 row-span-3`, so A PAIR OF THEM
 * FILLS ONE TWO-COLUMN BLOCK — rows 1-3 and rows 4-6 across the same two columns — and a small tile
 * is `row-span-2`, three to a column. ⛔ An ODD number of XL tiles therefore leaves the bottom half of
 * that block empty and nothing can fill it — a `row-span-2` tile needs two consecutive free rows and
 * one is left — which is a visible hole in the middle of the grid. (A reviewer caught this file
 * restating the geometry the component comment had just corrected.)
 * A reviewer found it; this file is the guard, since the case needs a rail of 1 or 3 lead tiles.
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
/** The three live intent tiles (INTENT_SHORTCUTS' shape). ⚠️ `shortcuts` is NOT exercised: it is fed
 *  from DESK_SHORTCUTS, which is `[]` on both editions since 2026-09-13, so a test of it would pin
 *  dead code. If desk tiles ever return, add a case here — `spanAt(1 + si)` covers them by index. */
const INTENTS = [
  { type: 'free', name: 'Free', nameVi: 'Miễn phí', icon: 'Gift' },
  { type: 'wanted', name: 'Wanted', nameVi: 'Cần mua', icon: 'PackageSearch' },
  { type: 'wholesale', name: 'Wholesale', nameVi: 'Bán sỉ', icon: 'Boxes' },
]
const CAT = (slug: string, name: string, icon: string) => ({ id: slug, slug, name, nameVi: name, icon })
const POOL = ['vehicles', 'electronics', 'services', 'property', 'jobs', 'rentals', 'fashion', 'sports', 'pets', 'kids']
/** `n` categories, optionally padded to `extra` more so the rail outgrows one screen. */
const cats = (n: number, extra = 0) =>
  POOL.slice(0, n + extra).map((slug) => CAT(slug, slug, 'Car')) as unknown as Cats

function render_(categories: Cats, intents?: typeof INTENTS) {
  return render(
    <LanguageProvider>
      <CategoryRail categories={categories} intents={intents} activeCategory="all" activeSubcategory="all" subcategoryCounts={{}} onCategory={() => {}} onSubcategory={() => {}} onIntent={() => {}} />
    </LanguageProvider>,
  )
}

function spans(categories: Cats) {
  const { container } = render_(categories)
  // The tiles in grid order: "All" first, then one per category.
  return [...container.querySelectorAll('[data-cat]')].map((el) => (el.className.includes('col-span-2') ? 'XL' : 'sm'))
}

/** Every tile in grid order — INCLUDING the intent tiles, which the first version of this file left
 *  out, and a reviewer noted that is exactly where the degraded rail's hole was hiding. */
function rowSpans(categories: Cats) {
  const { container } = render_(categories, INTENTS)
  const grid = container.querySelector('[role="group"][aria-label]')!
  return {
    // ⚠️ `md:grid-rows-2` is ALWAYS in the class list, so test for the six-row class, not the two.
    rows: grid.className.includes(' grid-rows-6') || grid.className.startsWith('grid-rows-6') ? 6 : 2,
    tiles: [...grid.querySelectorAll('[data-cat],[data-intent]')].map((el) =>
      el.className.includes('col-span-2') ? 'XL' : el.className.includes('row-span-2') ? 'sm-2row' : 'flat',
    ),
  }
}

describe('<CategoryRail> mobile grid spans', () => {
  it('gives the first four tiles the extra-large span once the rail is long', () => {
    expect(spans(cats(10))).toEqual(['XL', 'XL', 'XL', 'XL', ...Array(7).fill('sm')])
  })

  it('gives a short rail no extra-large tiles at all', () => {
    // Without intents these are 3 and 1 tiles: both short, so both lay out flat.
    expect(spans(cats(2))).toEqual(['sm', 'sm', 'sm'])
    expect(spans(cats(0))).toEqual(['sm'])
  })

  /**
   * ⛔ THE DEGRADED RAIL, which is reachable: the home page's `getData()` catch returns
   * `categories: []`. Four `row-span-2` tiles in six rows strand one alone in column 2 under four
   * row tracks that cannot collapse; at `row-span-3` the same four fill two columns exactly.
   */
  it('lays a short rail out flat, so no tile is stranded beside empty row tracks', () => {
    // categories: [] — the home page's getData() catch. All + 3 intents = 4 tiles = 2 full columns.
    expect(rowSpans(cats(0))).toEqual({ rows: 2, tiles: ['flat', 'flat', 'flat', 'flat'] })
    // 3 lead + 3 intents: the case that still had a hole when only XL parity was guarded.
    expect(rowSpans(cats(2))).toEqual({ rows: 2, tiles: Array(6).fill('flat') })
  })

  /**
   * ⛔ THE PROPERTY, NOT A SAMPLE: a reviewer showed the span assertions above pass whether or not a
   * column is left short, and that non-XL tiles are `row-span-2` in six rows — 3 to a column — so the
   * LAST column is short whenever the small count is not a multiple of 3, i.e. for two counts in
   * every three. That is accepted (a scroller ending on a part-filled column is where the list ends,
   * several swipes right) but it must stay confined to the last column, which is what this asserts.
   */
  it('leaves at most the FINAL column part-filled, at every plausible rail length', () => {
    // ⚠️ AN EXPECTED TABLE, NOT AN INVARIANT DERIVED FROM THE OUTPUT — two reviewers caught the first
    // version computing `partialColumns` from the same modulo it then asserted, which passes whatever
    // the component does. These rows are what the rail renders TODAY for `n` categories + 3 intents:
    //   n → [row tracks, tiles, XL tiles, empty cells in the last column]
    const EXPECTED: Record<number, [number, number, number, number]> = {
      0: [2, 4, 0, 0], 1: [2, 5, 0, 1], 2: [2, 6, 0, 0], 3: [2, 7, 0, 1], 4: [2, 8, 0, 0],
      5: [6, 9, 4, 1], 6: [6, 10, 4, 0], 7: [6, 11, 4, 2], 8: [6, 12, 4, 1], 9: [6, 13, 4, 0],
      10: [6, 14, 4, 2],
    }
    for (let n = 0; n <= 10; n++) {
      const { rows, tiles } = rowSpans(cats(n))
      const xl = tiles.filter((t) => t === 'XL').length
      const perColumn = rows === 2 ? 2 : 3
      const empty = (perColumn - ((tiles.length - xl) % perColumn)) % perColumn
      expect([rows, tiles.length, xl, empty], `rail of ${n} categories`).toEqual(EXPECTED[n])
      // XL tiles fill whole two-column blocks, so an odd count would strand half a block.
      expect(xl % 2).toBe(0)
      // ⛔ AND THE SHORT RAIL — the first-screen case — is never more than ONE cell short.
      if (rows === 2) expect(empty).toBeLessThanOrEqual(1)
    }
  })

  it('keeps the six-row shape once the rail outgrows one screen', () => {
    // 5 lead + 3 intents = 8 tiles is still short; 9 is where the owner's 2-big-rows shape starts.
    expect(rowSpans(cats(4))).toEqual({ rows: 2, tiles: Array(8).fill('flat') })
    const long = rowSpans(cats(4, 6))
    expect(long.rows).toBe(6)
    expect(long.tiles.slice(0, 4)).toEqual(['XL', 'XL', 'XL', 'XL'])
    expect(long.tiles.slice(4)).toEqual(Array(long.tiles.length - 4).fill('sm-2row'))
  })
})
