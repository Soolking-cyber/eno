import { describe, expect, it } from 'vitest'
import { clearanceLift, nextScrollDirection, planClearance, tapBox, type Box, type ScrollDir } from './fab-clearance'

/**
 * The floating cluster's two rules, pinned with the geometry measured on eno.vn (390x844 phone):
 * the cluster spans x 330–374, the support mark sits at y 720–764 and the chevron at 666–710; the right
 * column's save heart is a 32px button centred at x≈354 (16-fab-steal.js). Owner, 2026-09-25: the
 * chevron shows only while scrolling UP, and neither control may sit on a heart or the PDP CTA.
 */
const support: Box = { left: 330, right: 374, top: 720, bottom: 764 }
const heartAt = (cy: number): Box => tapBox({ left: 338, right: 370, top: cy - 16, bottom: cy + 16 })

describe('tapBox — a 32px heart takes taps across 44px', () => {
  it('grows a small control to the 44px floor around its centre, and leaves a big one alone', () => {
    expect(heartAt(746)).toEqual({ left: 332, right: 376, top: 724, bottom: 768 })
    const cta = { left: 12, right: 378, top: 700, bottom: 748 }
    expect(tapBox(cta)).toEqual(cta)
  })
})

describe('clearanceLift — rise just above whatever control is under a visible floating control', () => {
  it('a clear column does not move', () => {
    expect(clearanceLift(support, [], 300)).toBe(0)
    // A heart in the LEFT column (x≈165) is not under the cluster.
    expect(clearanceLift(support, [tapBox({ left: 149, right: 181, top: 730, bottom: 762 })], 300)).toBe(0)
  })

  it('the measured steal (heart centred at y=746 under the bubble) rises to 8px above the heart', () => {
    // heart tap box top = 724 → bubble bottom must be ≤ 716 → lift = 764 - 716 = 48.
    const lift = clearanceLift(support, [heartAt(746)], 300)
    expect(lift).toBe(48)
    const moved = { ...support, top: support.top - lift!, bottom: support.bottom - lift! }
    expect(moved.bottom).toBeLessThanOrEqual(heartAt(746).top - 8)
  })

  it('the PDP CTA under the bubble: rises above the full-width button, not beside it', () => {
    const cta = tapBox({ left: 12, right: 378, top: 619, bottom: 667 })
    const box = { ...support, top: 666, bottom: 764 } // chevron + bubble
    expect(clearanceLift(box, [cta], 400)).toBe(764 - (619 - 8))
  })

  it('a stack is cleared in layers: rising above one control onto another keeps rising', () => {
    const a = heartAt(746)
    const b = tapBox({ left: 340, right: 372, top: 680, bottom: 712 }) // just above the first
    const lift = clearanceLift(support, [a, b], 400)!
    expect(support.bottom - lift).toBeLessThanOrEqual(b.top - 8)
  })

  it('returns null — stand down — when clearing would take more than the cap', () => {
    const wall = Array.from({ length: 12 }, (_, i) => heartAt(746 - i * 50))
    expect(clearanceLift(support, wall, 300)).toBeNull()
  })

  it('never lowers the cluster, even with nothing above an obstacle below it', () => {
    expect(clearanceLift(support, [heartAt(800)], 300)).toBe(0) // heart box 778–822 is below 764
  })
})

describe('planClearance — lift above a BAR, yield to a SMALL control, never move for one', () => {
  const chevron: Box = { left: 330, right: 374, top: 666, bottom: 710 }
  it('a heart under the support mark: the mark yields, the chevron stays, nothing moves', () => {
    const plan = planClearance([chevron, support], [heartAt(746)], 390, 300)
    expect(plan).toEqual({ rise: 0, standDown: false, yielded: [false, true] })
  })
  it('a heart under the chevron only: the chevron yields', () => {
    expect(planClearance([chevron, support], [heartAt(688)], 390, 300).yielded).toEqual([true, false])
  })
  it('tap boxes that only TOUCH are not a conflict (no pixel a finger could mean for both)', () => {
    expect(planClearance([support], [heartAt(698)], 390, 300).yielded).toEqual([false]) // heart box 676–720
  })
  it('the PDP CTA (full width) under the cluster: the whole cluster rises above it, nothing yields', () => {
    const cta = tapBox({ left: 12, right: 378, top: 700, bottom: 748 })
    expect(planClearance([chevron, support], [cta], 390, 300)).toEqual({ rise: 764 - (700 - 8), standDown: false, yielded: [false, false] })
  })
  it('after rising above a bar, a small control at the new height still makes that control yield', () => {
    const cta = tapBox({ left: 12, right: 378, top: 700, bottom: 748 }) // rise 72 → support at 648–692
    expect(planClearance([support], [cta, heartAt(670)], 390, 300)).toEqual({ rise: 72, standDown: false, yielded: [true] })
  })
  it('stands the cluster down when no clear place above the bars exists within the cap', () => {
    const bars = Array.from({ length: 8 }, (_, i) => tapBox({ left: 12, right: 378, top: 700 - i * 60, bottom: 748 - i * 60 }))
    expect(planClearance([support], bars, 390, 300)).toEqual({ rise: 0, standDown: true, yielded: [true] })
  })
  it('nothing visible, nothing to plan', () => {
    expect(planClearance([], [heartAt(746)], 390, 300)).toEqual({ rise: 0, standDown: false, yielded: [] })
  })
})

describe('nextScrollDirection — the chevron starts hidden and follows the last deliberate scroll', () => {
  const start: ScrollDir = { anchor: null, height: 5000, up: false }
  it('the first frame only adopts a reference (a restored mid-page scroll is not a scroll)', () => {
    expect(nextScrollDirection(start, 3000, 5000)).toEqual({ anchor: 3000, height: 5000, up: false })
  })
  it('up after down, down after up; jitter decides nothing', () => {
    let s = nextScrollDirection(start, 3000, 5000)
    s = nextScrollDirection(s, 2990, 5000)
    expect(s.up).toBe(true)
    s = nextScrollDirection(s, 2994, 5000) // +4: jitter
    expect(s.up).toBe(true)
    s = nextScrollDirection(s, 3100, 5000)
    expect(s.up).toBe(false)
  })
  it('a document that GREW is re-anchored, never read as a scroll', () => {
    let s = nextScrollDirection(start, 3000, 5000)
    s = nextScrollDirection(s, 2900, 5000) // up
    s = nextScrollDirection(s, 3338, 5438) // feed appended 438px, browser moved scrollY with it
    expect(s).toEqual({ anchor: 3338, height: 5438, up: true })
  })
})
