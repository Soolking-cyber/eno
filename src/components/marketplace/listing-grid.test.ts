import { describe, expect, it } from 'vitest'
import { LISTING_CARD_SIZES, LISTING_GRID, LISTING_GRID_WIDE, MAP_CARD_SIZES, WIDE_CARD_SIZES } from './listing-grid'
import { LANE_CARD_SIZES, LANE_CARD_W, LANE_SCROLLER, RAIL_CARD_W, RAIL_SCROLLER } from './shelf'

/**
 * A RAIL CARD IS EXACTLY ONE GRID COLUMN (memory eno-card-feed-standards). The two strings live in two files,
 * and the 2026-10-18 grid (owner: "facebook marketplace style with minimal wasted space") changed every
 * number in both — so this parses them instead of trusting that they were edited together: per breakpoint,
 * the rail's column count is the grid's, its calc subtracts (columns − 1) × the grid's column gap, its
 * scroller has that gap, and both bleed out of the page frame by the same amount.
 */
const BREAKPOINTS = ['', 'sm:', 'lg:'] as const
type Bp = (typeof BREAKPOINTS)[number]
const PX_PER_STEP = 4 // Tailwind's spacing scale: gap-1 = 0.25rem = 4px
const FRAME_PX: Record<Bp, number> = { '': 12, 'sm:': 24, 'lg:': 32 } // the page frame: px-3 sm:px-6 lg:px-8

/** The match a mobile-first class list resolves to at `bp`: the last prefix at or below it that sets one. */
function resolve(classes: string, bp: Bp, re: RegExp): RegExpMatchArray | undefined {
  let found: RegExpMatchArray | undefined
  for (const step of BREAKPOINTS.slice(0, BREAKPOINTS.indexOf(bp) + 1)) {
    for (const c of classes.split(/\s+/)) {
      const unprefixed = !/^[a-z0-9-]+:/.test(c)
      if (step === '' ? !unprefixed : !c.startsWith(step)) continue
      const m = c.slice(step.length).match(re)
      if (m) found = m
    }
  }
  return found
}
const num = (bp: Bp, classes: string, re: RegExp) => Number(resolve(classes, bp, re)?.[1] ?? NaN)
const cols = (bp: Bp) => num(bp, LISTING_GRID, /^grid-cols-(\d+)$/)
const gapPx = (bp: Bp) => num(bp, LISTING_GRID, /^gap-x-([\d.]+)$/) * PX_PER_STEP
/** How far a class list bleeds out of the page frame at `bp`, in px (`-mx-2` → 8, `sm:mx-0` → 0). */
const bleedPx = (bp: Bp, classes: string) => {
  const m = resolve(classes, bp, /^(-?)mx-([\d.]+)$/)
  return m ? (m[1] === '-' ? 1 : -1) * Number(m[2]) * PX_PER_STEP || 0 : 0 // `|| 0`: mx-0 is 0, not -0
}

describe('LISTING_GRID (edge to edge) and the swipe rails (RAIL_CARD_W / RAIL_SCROLLER) part ways', () => {
  // Owner, 2026-11-24 (hub round 16 Q27): "the cards that swipe 4px corners the other cards edge to edge", then "also desktop".
  // A grid runs square-cut with 2px between cards at every width; a rail keeps the geometry it had (4px apart on a phone,
  // 8px from sm) and its 4px photo corner, so a rail card is no longer exactly one grid column.
  const RAIL_GAP_PX: Record<Bp, number> = { '': 4, 'sm:': 8, 'lg:': 8 }
  for (const bp of BREAKPOINTS) {
    const label = bp || 'phone'
    it(`${label}: the grid's cards are 2px apart; the rail keeps ${RAIL_GAP_PX[bp]}px, and its card calc follows its own gap`, () => {
      expect(gapPx(bp)).toBe(2)
      expect(num(bp, RAIL_SCROLLER, /^gap-([\d.]+)$/) * PX_PER_STEP).toBe(RAIL_GAP_PX[bp])
      const m = resolve(RAIL_CARD_W, bp, /^w-\[calc\(\(100%-([\d.]+)rem\)\/(\d+)\)\]$/)
      expect(m, `${label} rail card width`).toBeDefined()
      expect(Number(m![2])).toBe(cols(bp))
      expect(Number(m![1]) * 16).toBeCloseTo((cols(bp) - 1) * RAIL_GAP_PX[bp], 6)
    })
  }
  it('the grid is `edge-grid` (globals.css takes its corners off and insets its words); a rail never is', () => {
    expect(LISTING_GRID.split(/\s+/)).toContain('edge-grid')
    expect(RAIL_SCROLLER.split(/\s+/)).not.toContain('edge-grid')
  })
  it('phone: the grid bleeds the whole 12px gutter (square-cut to the screen edge), 12px between rows; the rail stays 4px in', () => {
    expect(FRAME_PX[''] - bleedPx('', LISTING_GRID)).toBe(0)
    expect(num('', LISTING_GRID, /^gap-y-([\d.]+)$/) * PX_PER_STEP).toBe(12)
    expect(FRAME_PX[''] - bleedPx('', RAIL_SCROLLER)).toBe(4)
    // 194px at 390, never smaller than the 189px card it replaces (owner, 2026-11-14).
    expect((390 - gapPx('')) / 2).toBe(194)
  })
  it('from sm the grid keeps the page frame, as the rail does', () => {
    for (const bp of ['sm:', 'lg:'] as const) {
      expect(bleedPx(bp, LISTING_GRID), bp).toBe(0)
      expect(bleedPx(bp, RAIL_SCROLLER), bp).toBe(bleedPx(bp, LISTING_GRID))
    }
  })
  it('2 / 3 / 4 columns — 12 cards a page fill all three, never 5', () => {
    expect(cols('')).toBe(2)
    expect(cols('sm:')).toBe(3)
    expect(cols('lg:')).toBe(4)
  })
})

/** The photo `sizes` must describe the grid it is shown in, or a phone fetches the wrong rung. */
describe('LISTING_CARD_SIZES follows the grid', () => {
  const terms = LISTING_CARD_SIZES.split(/,\s*/)
  /** A card at `bp` is (100vw − 2·edge − (cols − 1)·gap) / cols, i.e. calc(A vw − B px). */
  const expected = (bp: Bp) => {
    const edge = FRAME_PX[bp] - bleedPx(bp, LISTING_GRID)
    return { vw: 100 / cols(bp), px: (2 * edge + (cols(bp) - 1) * gapPx(bp)) / cols(bp) }
  }
  const calc = (t: string) => {
    const m = t.match(/calc\(([\d.]+)vw - ([\d.]+)px\)$/)
    expect(m, t).not.toBeNull()
    return { vw: Number(m![1]), px: Number(m![2]) }
  }

  it('phone: the last (default) term is 50vw − 1px (edge to edge, 2px gutter)', () => {
    const got = calc(terms.at(-1)!)
    expect(got.vw).toBeCloseTo(expected('').vw, 1)
    expect(got.px).toBe(expected('').px)
  })
  it('sm and lg: the min-width terms', () => {
    for (const [bp, min] of [['sm:', 640], ['lg:', 1024]] as const) {
      const got = calc(terms.find((s) => s.startsWith(`(min-width: ${min}px)`))!)
      expect(got.vw, bp).toBeCloseTo(expected(bp).vw, 1)
      expect(Math.abs(got.px - expected(bp).px), bp).toBeLessThan(0.5)
    }
  })
  it('≥1280: the frame is 1280 to a 1368 screen, follows it to 1448, then caps at 1360 (--container-7xl)', () => {
    expect(terms.find((s) => s.startsWith('(min-width: 1280px)'))).toBe(`(min-width: 1280px) ${(1216 - 3 * gapPx('lg:')) / 4}px`)
    expect(terms.find((s) => s.startsWith('(min-width: 1368px)'))).toBe(`(min-width: 1368px) calc(25vw - ${(152 + 3 * gapPx('lg:')) / 4}px)`)
    expect(terms.find((s) => s.startsWith('(min-width: 1448px)'))).toBe(`(min-width: 1448px) ${(1296 - 3 * gapPx('lg:')) / 4}px`)
  })
  it("map mode's two cards from xl: no gap above 1280 that advertises one wide column for a 292px card", () => {
    expect(MAP_CARD_SIZES).toContain('(min-width: 1280px) 292px')
    expect(MAP_CARD_SIZES).toContain('(min-width: 1368px) calc(25vw - 50px)')
    expect(MAP_CARD_SIZES).toContain('(min-width: 1448px) 312px')
  })
  it("map mode's phone card is the full frame width, not half of it", () => {
    expect(MAP_CARD_SIZES.split(/,\s*/).at(-1)).toBe(`calc(100vw - ${2 * FRAME_PX['']}px)`)
  })
})

/**
 * ⛔ THE HOME LANE (owner-approved 2026-11-14, cook r04 home-b "lanes as rails" — shelf.tsx LANE_*): below `sm` a lane card is
 * 220px (larger than the 189px feed column at 390, never smaller — owner, 2026-11-14), on a scroller bled to the screen edges
 * (the #listings frame is px-3) and padded back onto the 12px text edge, 12px apart. From `sm` a lane IS the rail: every lane
 * class is `max-sm:` on top of the rail's own string, and its `sizes` are the grid's.
 */
describe('the home lane is the rail plus phone-only classes', () => {
  it('220px cards, 12px apart, bled 12px each side and padded back by 12, each card its own height (build 7)', () => {
    expect(LANE_CARD_W).toBe(`${RAIL_CARD_W} max-sm:w-55`)
    expect(LANE_SCROLLER).toBe(`${RAIL_SCROLLER} max-sm:-mx-3 max-sm:gap-3 max-sm:px-3 max-sm:scroll-px-3 max-sm:items-start`)
    expect(55 * PX_PER_STEP).toBe(220)
    expect(3 * PX_PER_STEP).toBe(FRAME_PX[''])
  })
  it('no lane class reaches `sm`: each one is max-sm:', () => {
    for (const [lane, rail] of [[LANE_CARD_W, RAIL_CARD_W], [LANE_SCROLLER, RAIL_SCROLLER]]) {
      const extra = lane.slice(rail.length).trim().split(/\s+/)
      expect(extra.every((c) => c.startsWith('max-sm:')), lane).toBe(true)
    }
  })
  it('sizes: the grid\'s own from sm, a fixed 220px on a phone', () => {
    const terms = (s: string) => s.split(/,\s*/)
    expect(terms(LANE_CARD_SIZES).slice(0, -1)).toEqual(terms(LISTING_CARD_SIZES).slice(0, -1))
    expect(terms(LANE_CARD_SIZES).at(-1)).toBe('220px')
  })
})

/**
 * ⛔ RENTAL RESULTS ON A PHONE ARE ONE COLUMN (owner-approved 2026-11-14, cook r06 rentals-a — listing-grid.ts LISTING_GRID_WIDE). Below
 * `sm` one column on the 12px gutter (no bleed), 24px between cards, so the square photo is 366px at 390 — bigger than the
 * 189px two-up card, never smaller (owner, 2026-11-14). From `sm` it resolves to LISTING_GRID's exact columns and gaps, so a
 * tablet and a desktop keep the 3 / 4 grid and the 12-card first page.
 */
describe('LISTING_GRID_WIDE: one column on a phone, LISTING_GRID from sm', () => {
  const wideNum = (bp: Bp, re: RegExp) => num(bp, LISTING_GRID_WIDE, re)
  it('phone: one column, edge to edge (the whole gutter bled), 24px between cards — a card the screen wide', () => {
    expect(wideNum('', /^grid-cols-(\d+)$/)).toBe(1)
    expect(bleedPx('', LISTING_GRID_WIDE)).toBe(FRAME_PX[''])
    expect(LISTING_GRID_WIDE.split(/\s+/)).toContain('edge-grid')
    expect(wideNum('', /^gap-y-([\d.]+)$/) * PX_PER_STEP).toBe(24)
    // At 390: the whole 390, against the two-up card's (390 − 2) / 2 = 194.
    expect(390 - 2 * (FRAME_PX[''] - bleedPx('', LISTING_GRID_WIDE))).toBe(390)
    expect(390).toBeGreaterThan((390 - 2 * (FRAME_PX[''] - bleedPx('', LISTING_GRID)) - gapPx('')) / 2)
  })
  it('sm and lg: the same columns, gaps and bleed as LISTING_GRID', () => {
    for (const bp of ['sm:', 'lg:'] as const) {
      expect(wideNum(bp, /^grid-cols-(\d+)$/), bp).toBe(cols(bp))
      expect(wideNum(bp, /^gap-x-([\d.]+)$/) * PX_PER_STEP, bp).toBe(gapPx(bp))
      expect(wideNum(bp, /^gap-y-([\d.]+)$/), bp).toBe(num(bp, LISTING_GRID, /^gap-y-([\d.]+)$/))
      expect(bleedPx(bp, LISTING_GRID_WIDE), bp).toBe(bleedPx(bp, LISTING_GRID))
    }
  })
  it('WIDE_CARD_SIZES: LISTING_CARD_SIZES from sm, the full screen width below it', () => {
    const terms = (x: string) => x.split(/,\s*/)
    expect(terms(WIDE_CARD_SIZES).slice(0, -1)).toEqual(terms(LISTING_CARD_SIZES).slice(0, -1))
    expect(terms(WIDE_CARD_SIZES).at(-1)).toBe('100vw')
  })
})
