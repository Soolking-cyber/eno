import { describe, expect, it } from 'vitest'
import { CARD_SEGMENTS, cardSlots, isSwipe } from './card-slots'

describe('cardSlots', () => {
  // The whole table, because this is an off-by-one in three related numbers at once and reading
  // it as a table is the only way to see that the boundary at 4/5 is the one the owner asked for.
  const table: Array<[n: number, photoCount: number, moreCount: number, segments: number]> = [
    // n   photos  +N   slots
    [0, 0, 0, 0],
    [1, 1, 0, 1],
    [2, 2, 0, 2],
    [3, 3, 0, 3],
    [4, 4, 0, 4], // ⚠️ the boundary: "if 4 just show 4 images right on product card"
    [5, 3, 2, 4], // ⚠️ one more photo and the 4th slot flips to the doorway
    [6, 3, 3, 4],
    [9, 3, 6, 4],
    [12, 3, 9, 4],
  ]

  it.each(table)('%i photos → %i slides, +%i, %i slots', (n, photoCount, moreCount, segments) => {
    expect(cardSlots(n)).toEqual({ photoCount, moreCount, segments, overflow: n > CARD_SEGMENTS })
  })

  it('never renders more slots than the ceiling', () => {
    for (let n = 0; n <= 60; n++) expect(cardSlots(n).segments).toBeLessThanOrEqual(CARD_SEGMENTS)
  })

  it('accounts for every photo: shown cleanly + advertised = the whole set', () => {
    // The invariant that makes "+N" honest. If this ever fails, the card is lying about how many
    // photos the listing has — which on a marketplace is a claim, not a cosmetic detail.
    for (let n = 0; n <= 60; n++) {
      const { photoCount, moreCount } = cardSlots(n)
      expect(photoCount + moreCount).toBe(n)
    }
  })

  it('shows a doorway only when there is something behind it', () => {
    for (let n = 0; n <= 60; n++) {
      const { overflow, moreCount } = cardSlots(n)
      expect(overflow).toBe(moreCount > 0)
      // A "+1" doorway is allowed (5 photos → +2 is the minimum in practice), but never "+0".
      if (overflow) expect(moreCount).toBeGreaterThan(0)
    }
  })

  // ⚠️ This block was originally one test called "treats junk counts as no photos" that only
  // asserted the outputs were non-negative — so its name claimed a contract it never checked, and
  // `cardSlots(2.7)` returning two photos would have passed it silently (codex caught this at the
  // commit gate). Split into the two contracts that actually exist, each asserting the exact value.
  it('floors a fractional count instead of inventing a slot', () => {
    expect(cardSlots(2.7)).toEqual({ photoCount: 2, moreCount: 0, segments: 2, overflow: false })
    expect(cardSlots(4.9)).toEqual({ photoCount: 4, moreCount: 0, segments: 4, overflow: false })
  })

  it('treats a negative or non-numeric count as no photos', () => {
    for (const junk of [-1, -100, NaN]) {
      expect(cardSlots(junk)).toEqual({ photoCount: 0, moreCount: 0, segments: 0, overflow: false })
    }
  })
})

describe('isSwipe', () => {
  it('pages on a decisive flick that distance alone would have ignored', () => {
    // 30px in 40ms = 0.75px/ms. Under the old distance-only rule (>40px) this did NOTHING.
    expect(isSwipe(-30, 2, 40)).toBe(true)
  })

  it('still pages on a slow deliberate drag', () => {
    expect(isSwipe(-60, 5, 600)).toBe(true)
  })

  it('ignores a vertical flick-scroll that drifts sideways — BOTH branches', () => {
    expect(isSwipe(45, 240, 300)).toBe(false)   // past the 40px distance gate
    expect(isSwipe(30, 200, 40)).toBe(false)    // past the velocity gate
  })

  it('ignores a tap whose finger rolls a few pixels very fast', () => {
    // 6px in 3ms is 2px/ms — an enormous velocity, and not a swipe. The 20px floor is what says so.
    expect(isSwipe(6, 1, 3)).toBe(false)
  })

  it('ignores a slow short drag that reaches neither gate', () => {
    expect(isSwipe(30, 1, 500)).toBe(false)
  })

  it('never divides by a zero elapsed time', () => {
    expect(isSwipe(25, 0, 0)).toBe(true)
    expect(Number.isFinite(25 / Math.max(1, 0))).toBe(true)
  })
})
