// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { LanguageProvider } from '@/context/language-context'
import { SUBCATEGORIES } from '@/lib/subcategories'
import { CategoryRail } from './category-rail'

/**
 * THE RAIL'S SHAPE — the three things a screenshot of the real home page cannot check, because the
 * real rail always has plenty of tiles and its own edition's categories.
 *
 * Owner, 2026-09-18: "mobile initial one … grid 3x3 not 2x2", "make the subcategory plate fully no
 * dropdown … if overflow swipe to the right", "remove All category from both desktop and mobile".
 * So: from 640px the tiles fill six unit rows (two rows on the opening screen, three after the swipe)
 * and a 2-row grid from `md`; there is no "All" tile; and the plate holds every subcategory of the
 * active category, in taxonomy order.
 * ⛔ BELOW 640px ONE COMPACT ROW (owner, 2026-11-12: "go all", after a blind A/B +0.15 GPT / +0.11 Opus):
 * 84px tiles with a 44px glyph and a one-line label, no More arrow, and the subcategory box directly
 * right of the pressed tile with its plate capped at two chip rows. All of it is `max-sm:` overrides,
 * so the pins for 640px and up below stand unchanged beside the phone ones.
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
// ⚠️ No retired shelf (vehicles, pets, books-stationery, hobbies-sports — src/lib/retired-categories.ts): since
// 2026-10-03 the rail drops those by name, so they would not be tiles and the counts below would not hold.
const POOL = ['furniture-appliances', 'electronics', 'services', 'property', 'jobs', 'rentals', 'fashion-beauty', 'sports', 'food-drink', 'baby-kids']
const cats = (n: number) =>
  POOL.slice(0, n).map((slug) => ({ id: slug, slug, name: slug, nameVi: slug, icon: 'Car' })) as unknown as Cats
/** The three live intent tiles (INTENT_SHORTCUTS' shape). `shortcuts` is fed from DESK_SHORTCUTS,
 *  which is `[]` on both editions since 2026-09-13, so exercising it would pin dead code. */
const INTENTS = [
  { type: 'free', name: 'Free', nameVi: 'Miễn phí', icon: 'Gift' },
  { type: 'wanted', name: 'Wanted', nameVi: 'Cần mua', icon: 'PackageSearch' },
  { type: 'wholesale', name: 'Wholesale', nameVi: 'Bán sỉ', icon: 'Boxes' },
]

/** eno's own product tiles, pinned ahead of the categories. Dead on both editions today (DESK_SHORTCUTS is `[]`),
 *  used here only to prove the phone box column counts them as the columns they are. */
type Shortcuts = React.ComponentProps<typeof CategoryRail>['shortcuts']
const SHORTCUTS: Shortcuts = [
  { key: 'evisa', href: '/?category=services&subcategory=visa-legal', kind: 'filter', name: 'Vn e-Visa', nameVi: 'e-Visa VN', icon: 'Gift' },
  { key: 'trip', href: '/itinerary', kind: 'route', name: 'Trip planner', nameVi: 'Lên lịch trình', icon: 'Gift' },
]

function renderRail(categories: Cats, activeCategory = 'all', activeSubcategory = 'all', subcategoryCounts: Record<string, number> = {}, shortcuts?: Shortcuts) {
  const { container } = render(
    <LanguageProvider>
      <CategoryRail
        categories={categories}
        intents={INTENTS}
        shortcuts={shortcuts}
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
    grid,
    gridCls: grid.className,
    tiles: [...grid.querySelectorAll('[data-cat],[data-intent],[data-shortcut]')],
    chips: [...container.querySelectorAll('[data-subcat]')].map((el) => el.getAttribute('data-subcat')),
  }
}

describe('<CategoryRail> grid shape', () => {
  /**
   * ⛔ SIX UNIT ROWS FROM 640px, AND THE SPANS ARE ITS TWO SHAPES (owner: "on mobile 2 rows when swiped
   * transitions into 3"). The first six tiles span THREE units — two to a column, so the opening
   * screen is 3 × 2 — and everything after them spans TWO, three to a column. Desktop is one unit
   * row per tile in a two-row grid. Below 640px ONE row with no gaps or padding (owner, 2026-11-12:
   * "go all"). Exact tokens, because `toContain` on a class string would take `md:grid-rows-2` for the
   * 640px rule, and `max-sm:grid-rows-1` would not be told apart from a bare `grid-rows-1`.
   */
  it('is one row below 640px, six unit rows from 640px and two from md', () => {
    const { gridCls } = renderRail(cats(10))
    const tokens = gridCls.split(/\s+/)
    expect(tokens).toContain('grid-rows-6')
    expect(tokens).toContain('md:grid-rows-2')
    expect(tokens).toContain('auto-cols-max')
    expect(tokens).toEqual(expect.arrayContaining(['max-sm:grid-rows-1', 'max-sm:gap-y-0', 'max-sm:py-0']))
    // the 640px+ spacing it overrides is still there for those widths
    expect(tokens).toEqual(expect.arrayContaining(['gap-x-2', 'gap-y-0.5', 'py-1']))
  })

  /**
   * THE CLIPPED TILE IS THE SWIPE CUE (batch 72 review): with the More arrow hidden below 640px, a tile cut by the right
   * edge is the only sign that more categories exist, and no single width+gap cuts one at every common phone width. So
   * the column gap is set by THREE EXCLUSIVE width ranges — never two at once, so no cascade order decides — and NO edge
   * fade (the owner removed it from this rail, 2026-08-26). The arithmetic below is the check: for each common width, the
   * scroller (vw − 24px) must cut a tile with at least 12px shown AND 12px hidden.
   */
  it('below 640px sets the column gap by three exclusive ranges so a tile is clipped at every common phone width', () => {
    const { gridCls } = renderRail(cats(10))
    const tokens = gridCls.split(/\s+/)
    expect(tokens).toEqual(expect.arrayContaining(['max-[23.25rem]:gap-x-1', 'min-[23.25rem]:max-[27rem]:gap-x-0', 'min-[27rem]:max-sm:gap-x-1']))
    expect(tokens.some((t) => t.includes('mask'))).toBe(false)
    expect(tokens).not.toContain('max-sm:gap-x-0')
    const gapAt = (vw: number) => (vw < 372 ? 4 : vw < 432 ? 0 : 4) // 23.25rem = 372px, 27rem = 432px
    for (const vw of [320, 360, 375, 384, 390, 393, 402, 412, 414, 428, 430, 440]) {
      const pitch = 84 + gapAt(vw)
      const edge = vw - 24
      let shown = edge - Math.floor(edge / pitch) * pitch
      if (shown > 84) shown = 0 // the edge fell in a gap: every visible tile is whole
      expect({ vw, cut: shown >= 12 && 84 - shown >= 12 }).toEqual({ vw, cut: true })
    }
  })

  /**
   * ⛔ ON A PHONE EVERY TILE IS ONE ROW TALL AND 84px WIDE (owner, 2026-11-12: "go all"). Without
   * `max-sm:row-span-1` a row-span-3 tile in a one-row grid makes implicit rows and the tiles stack.
   */
  it('makes every tile one 84px column on a phone, beside its 640px+ span and width', () => {
    for (const shortcuts of [undefined, SHORTCUTS]) {
      const { tiles } = renderRail(cats(10), 'all', 'all', {}, shortcuts)
      expect(tiles.length).toBeGreaterThan(0)
      for (const t of tiles) {
        const tokens = t.className.split(/\s+/)
        expect(tokens).toEqual(expect.arrayContaining(['max-sm:row-span-1', 'md:row-span-1', 'max-sm:w-21']))
        expect(tokens.some((c) => /^row-span-[23]$/.test(c)), t.className).toBe(true)
        expect(tokens.some((c) => c.startsWith('w-[calc(')), t.className).toBe(true)
      }
    }
  })

  /**
   * ⛔ THE OPENING SCREEN'S BIG GLYPH IS THE SMALL ONE ON A PHONE: a 44px box (`p-0.5`) holding a 40px
   * mark, as the swiped tiles already are — so the one row is a 63px tile at every position.
   */
  it('gives the big (first-screen) tiles the small glyph below 640px', () => {
    const { tiles } = renderRail(cats(10))
    const glyphOf = (t: Element) => {
      const box = t.firstElementChild!
      const mark = box.querySelector('img,svg')!
      return { box: (box.getAttribute('class') ?? '').split(/\s+/), mark: (mark.getAttribute('class') ?? '').split(/\s+/) }
    }
    const big = tiles.filter((t) => /(?:^|\s)row-span-3(?:\s|$)/.test(t.className))
    const small = tiles.filter((t) => /(?:^|\s)row-span-2(?:\s|$)/.test(t.className))
    expect(big.length).toBe(6)
    expect(small.length).toBeGreaterThan(0)
    for (const t of big) {
      const g = glyphOf(t)
      expect(g.box).toEqual(expect.arrayContaining(['h-15', 'w-15', 'max-sm:h-11', 'max-sm:w-11', 'max-sm:p-0.5']))
      expect(g.mark).toEqual(expect.arrayContaining(['h-13', 'w-13', 'max-sm:h-10', 'max-sm:w-10']))
    }
    // the swiped tiles are already that size at every phone width, with no override needed
    for (const t of small) {
      const g = glyphOf(t)
      expect(g.box).toEqual(expect.arrayContaining(['h-11', 'w-11', 'p-0.5']))
      expect(g.mark).toEqual(expect.arrayContaining(['h-10', 'w-10']))
    }
  })

  /**
   * ⛔ ONE-LINE LABELS ON A PHONE, cut with an ellipsis (`truncate`, on a block box), at the same 12px
   * bold and leading; the two-line clamp stays for 640px and up.
   */
  it('keeps every label to one line below 640px', () => {
    const { tiles } = renderRail(cats(10))
    for (const t of tiles) {
      const label = [...t.querySelectorAll('span')].find((s) => s.className.includes('line-clamp-2'))!
      expect(label, t.className).toBeTruthy()
      expect(label.className.split(/\s+/)).toEqual(
        expect.arrayContaining(['max-sm:block', 'max-sm:truncate', 'line-clamp-2', 'text-xs', 'font-bold', 'leading-tight']),
      )
    }
  })

  /** ⛔ NO MORE ARROW ON A PHONE: the peek of the next tile is the swipe cue there. It stays from 640px until `pc:`. */
  it('hides the More arrow below 640px', async () => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 300 })
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => 1000 })
    try {
      renderRail(cats(10))
      const more = await screen.findByRole('button', { name: 'More' })
      expect(more.className.split(/\s+/)).toEqual(expect.arrayContaining(['max-sm:hidden', 'pc:hidden']))
    } finally {
      delete (HTMLElement.prototype as unknown as { clientWidth?: unknown }).clientWidth
      delete (HTMLElement.prototype as unknown as { scrollWidth?: unknown }).scrollWidth
    }
  })

  /**
   * …EXCEPT AS A FALLBACK (review rounds 4-5): wherever the VISIBLE right edge, where the row has come to rest, lands
   * between children — widths PHONE_GAP does not cover (280, 464, 552px), a swipe, a picked category slid left with its
   * box — nothing is clipped, and the arrow comes back on the phone. `edgeClipsChild` decides it.
   */
  describe('edgeClipsChild — the phone arrow fallback', () => {
    /** A fake scroller `edge` px wide whose children sit at the given [left, width] in content coordinates. */
    const scroller = (edge: number, kids: Array<[number, number]>, scrollLeft = 0) => {
      const el = document.createElement('div')
      Object.defineProperty(el, 'clientWidth', { value: edge })
      Object.defineProperty(el, 'clientLeft', { value: 0 })
      el.scrollLeft = scrollLeft
      el.getBoundingClientRect = () => ({ left: 12, width: edge } as DOMRect)
      for (const [left, width] of kids) {
        const c = document.createElement('a')
        c.getBoundingClientRect = () => ({ left: 12 + left - scrollLeft, width } as DOMRect)
        el.appendChild(c)
      }
      return el
    }
    const row = (pitch: number, n = 12): Array<[number, number]> => Array.from({ length: n }, (_, i) => [i * pitch, 84])

    it('a tile cut with ≥12px shown and ≥12px hidden is a clip (360px: 4px gap → 72 of the 4th shows)', async () => {
      const { edgeClipsChild } = await import('./category-rail')
      expect(edgeClipsChild(scroller(336, row(88)))).toBe(true)
      expect(edgeClipsChild(scroller(366, row(84)))).toBe(true) // 390px, no gap: 30 of the 5th
    })

    it('whole tiles at the edge are NOT a clip (552px: six tiles + 4px of gap), nor is a 4px sliver (280px)', async () => {
      const { edgeClipsChild } = await import('./category-rail')
      expect(edgeClipsChild(scroller(528, row(88)))).toBe(false)
      expect(edgeClipsChild(scroller(256, row(88)))).toBe(false) // the 3rd tile shows 80 of 84
    })

    it('is judged at the VISIBLE edge, where the row is now (review round 5)', async () => {
      const { edgeClipsChild } = await import('./category-rail')
      // 390px, no gap: at rest 30px of the 5th tile shows — a clip.
      expect(edgeClipsChild(scroller(366, row(84), 0))).toBe(true)
      // …swiped 54px, the visible edge sits exactly on a tile boundary (content x 420 = 5 × 84): nothing is cut, so the
      // arrow must come back — a test of the resting position would wrongly still say "clipped".
      expect(edgeClipsChild(scroller(366, row(84), 54))).toBe(false)
      // …swiped 40px instead: the visible edge is content x 406, inside the 5th tile (336-420) — 70px shown, a clip.
      expect(edgeClipsChild(scroller(366, row(84), 40))).toBe(true)
    })

    it('a picked category slid to the left edge with its box beside it can leave the edge between children', async () => {
      const { edgeClipsChild } = await import('./category-rail')
      // The pressed tile at 0-84, a 230px subcategory box at 88-318, the next tile at 322-406 (4px gaps), at 360px
      // (336px scroller): the next tile is cut with 14px shown — a clip. A 248px box puts that tile at 340: whole edge.
      expect(edgeClipsChild(scroller(336, [[0, 84], [88, 230], [322, 84], [410, 84]]))).toBe(true)
      expect(edgeClipsChild(scroller(336, [[0, 84], [88, 248], [340, 84]]))).toBe(false)
    })

    it('reads null where there is no layout (jsdom, display:none) so the caller keeps its answer', async () => {
      const { edgeClipsChild } = await import('./category-rail')
      expect(edgeClipsChild(scroller(336, row(88).map(([l]) => [l, 0])))).toBeNull()
    })
  })

  it('shows the More arrow on a phone when the edge clips nothing (the fallback)', async () => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 300 })
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => 1000 })
    // The grid's children laid out 100px wide, edge to edge, in a 300px scroller: the edge falls between the 3rd and 4th.
    const rect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const parent = this.parentElement
      if (parent?.getAttribute('role') === 'group' && parent.parentElement?.hasAttribute('data-category-rail')) {
        const i = Array.from(parent.children).indexOf(this)
        return { left: i * 100, width: 100, top: 0, height: 63, right: i * 100 + 100, bottom: 63, x: i * 100, y: 0, toJSON() {} } as DOMRect
      }
      return { left: 0, width: 300, top: 0, height: 63, right: 300, bottom: 63, x: 0, y: 0, toJSON() {} } as DOMRect
    }
    try {
      renderRail(cats(10))
      const more = await screen.findByRole('button', { name: 'More' })
      // 300px of scroller over 100px children: the edge falls exactly between the 3rd and 4th — nothing clipped.
      await vi.waitFor(() => expect(more.className.split(/\s+/)).not.toContain('max-sm:hidden'))
      expect(more.className.split(/\s+/)).toContain('pc:hidden')
    } finally {
      HTMLElement.prototype.getBoundingClientRect = rect
      delete (HTMLElement.prototype as unknown as { clientWidth?: unknown }).clientWidth
      delete (HTMLElement.prototype as unknown as { scrollWidth?: unknown }).scrollWidth
    }
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
    for (const active of ['electronics', 'services', 'furniture-appliances', 'jobs']) expect(spansOf(active), active).toEqual(idle)
  })

  it('renders no "All" tile, at any rail length', () => {
    for (const n of [0, 1, 4, 10]) {
      const { tiles } = renderRail(cats(n))
      expect(tiles.map((t) => t.getAttribute('data-cat'))).not.toContain('all')
      // every category the edition passed IS a tile, plus the one intent drawn before counts prove the others (offeredIntents)
      expect(tiles.length).toBe(n + 1)
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
    expect(box.className.split(/\s+/)).toContain('max-sm:[grid-column:var(--sub-col-p)]')
    // every breakpoint gets a column index, and it is past the pressed tile's own column
    expect(Number(box.style.getPropertyValue('--sub-col-p'))).toBeGreaterThan(1)
    expect(Number(box.style.getPropertyValue('--sub-col-m'))).toBeGreaterThan(1)
    expect(Number(box.style.getPropertyValue('--sub-col-d'))).toBeGreaterThan(1)
    expect(box.previousElementSibling?.getAttribute('data-cat')).toBe('rentals')
  })

  /**
   * ⛔ ON A PHONE THE BOX SITS DIRECTLY RIGHT OF THE PRESSED TILE (owner, 2026-11-12: "go all"). Below
   * 640px every tile is one column of the one row, so the pressed tile's 1-based column is its index
   * among the grid's children + 1 and the box takes the next: index + 2. Read off the RENDERED order —
   * shortcut tiles come first and each is a column too — rather than recomputed the way the code does.
   * ⚠️ AND IT IS NOT THE 640px COLUMN: there a column holds two or three tiles, so `--sub-col-m` is
   * smaller for every tile but the first, and a box placed by it on a phone would land on the wrong tile.
   */
  it('places the phone box directly right of the pressed tile, counting shortcut tiles', () => {
    const cases: [string, Shortcuts | undefined][] = [
      ['furniture-appliances', undefined], ['rentals', undefined], ['baby-kids', undefined],
      ['furniture-appliances', SHORTCUTS], ['rentals', SHORTCUTS], ['jobs', SHORTCUTS],
    ]
    for (const [active, shortcuts] of cases) {
      const label = `${active}${shortcuts ? ' + shortcuts' : ''}`
      const { grid } = renderRail(cats(10), active, 'all', {}, shortcuts)
      const kids = [...grid.children] as HTMLElement[]
      const at = kids.findIndex((el) => el.getAttribute('data-cat') === active)
      expect(at, label).toBeGreaterThanOrEqual(0)
      // every child up to the pressed tile is a tile (one phone column each), shortcuts first when given
      expect(kids.slice(0, at + 1).every((el) => el.matches('[data-cat],[data-intent],[data-shortcut]')), label).toBe(true)
      if (shortcuts) expect(kids.slice(0, shortcuts.length).map((el) => el.getAttribute('data-shortcut')), label).toEqual(shortcuts.map((s) => s.key))
      const box = kids[at + 1]
      expect(box.style.getPropertyValue('--sub-col-p'), label).not.toBe('')
      expect(Number(box.style.getPropertyValue('--sub-col-p')), label).toBe(at + 2)
      if (at >= 1) expect(Number(box.style.getPropertyValue('--sub-col-m')), label).toBeLessThan(at + 2)
    }
  })

  /**
   * ⛔ THE PHONE PLATE IS CAPPED AT TWO CHIP ROWS, NO ROW GAP, 2px TOP AND BOTTOM: 2×28 + 4 = 60px, under
   * the 63px tile, so opening a category neither grows the one-row rail nor re-centres its tiles. The
   * chips flow sideways. The 640px six-row and md five-row caps stay.
   */
  it('caps the phone plate at two chip rows', () => {
    const { container } = renderRail(cats(10), 'rentals')
    const plate = container.querySelector('[role="group"][aria-label="Subcategories"]')!
    const tokens = plate.className.split(/\s+/)
    expect(tokens).toEqual(expect.arrayContaining([
      'max-sm:[grid-template-rows:repeat(2,min-content)]', 'max-sm:gap-y-0', 'max-sm:py-0.5',
      '[grid-template-rows:repeat(6,min-content)]', 'md:[grid-template-rows:repeat(5,min-content)]',
      'grid-flow-col', 'auto-cols-max', 'min-h-full', 'content-center',
    ]))
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
