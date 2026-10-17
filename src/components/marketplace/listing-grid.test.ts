import { describe, expect, it } from 'vitest'
import { LISTING_CARD_SIZES, LISTING_GRID, MAP_CARD_SIZES } from './listing-grid'
import { RAIL_CARD_W, RAIL_SCROLLER } from './shelf'

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

describe('LISTING_GRID ↔ RAIL_CARD_W / RAIL_SCROLLER', () => {
  for (const bp of BREAKPOINTS) {
    const label = bp || 'phone'

    it(`${label}: the rail card's calc is (columns − 1) × the grid's column gap, over the grid's columns`, () => {
      const m = resolve(RAIL_CARD_W, bp, /^w-\[calc\(\(100%-([\d.]+)rem\)\/(\d+)\)\]$/)
      expect(m, `${label} rail card width`).toBeDefined()
      expect(Number(m![2])).toBe(cols(bp))
      expect(Number(m![1]) * 16).toBeCloseTo((cols(bp) - 1) * gapPx(bp), 6)
    })

    it(`${label}: the rail scroller's gap is the grid's column gap`, () => {
      expect(num(bp, RAIL_SCROLLER, /^gap-([\d.]+)$/) * PX_PER_STEP).toBe(gapPx(bp))
    })

    it(`${label}: rail and grid bleed out of the page frame by the same amount, never past the screen edge`, () => {
      expect(bleedPx(bp, RAIL_SCROLLER)).toBe(bleedPx(bp, LISTING_GRID))
      expect(bleedPx(bp, LISTING_GRID)).toBeLessThan(FRAME_PX[bp])
    })
  }

  it("the phone geometry is the owner's Facebook spacing: 4px from the edge, 4px apart, 12px between rows", () => {
    expect(FRAME_PX[''] - bleedPx('', LISTING_GRID)).toBe(4)
    expect(gapPx('')).toBe(4)
    expect(num('', LISTING_GRID, /^gap-y-([\d.]+)$/) * PX_PER_STEP).toBe(12)
    expect(cols('')).toBe(2)
    expect(cols('sm:')).toBe(3)
    expect(cols('lg:')).toBe(4) // 12 cards a page fill all three — never 5
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

  it('phone: the last (default) term is 50vw − 6px', () => {
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
  it('≥1280: the capped 1216px frame shared by four columns', () => {
    expect(terms.find((s) => s.startsWith('(min-width: 1280px)'))).toBe(`(min-width: 1280px) ${(1216 - 3 * gapPx('lg:')) / 4}px`)
  })
  it("map mode's phone card is the full frame width, not half of it", () => {
    expect(MAP_CARD_SIZES.split(/,\s*/).at(-1)).toBe(`calc(100vw - ${2 * FRAME_PX['']}px)`)
  })
})
