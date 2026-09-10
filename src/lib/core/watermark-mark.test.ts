import { describe, it, expect } from 'vitest'
import { watermarkSvg, watermarkPlacement, inkForLuminance } from './watermark-mark'

// ⛔ THIS MODULE EXISTS BECAUSE THE MARK DRIFTED THREE WAYS ACROSS THREE FILES — one of them
// stamping "eno" without the domain that is the entire point. These tests pin the properties that
// drift silently: nobody notices a watermark that is subtly wrong until it is on 10,000 photos.

describe('watermarkSvg', () => {
  it('renders the full wordmark, not a truncated one', () => {
    const svg = watermarkSvg(400, { fill: '#ffffff', opacity: 0.85 }).svg.toString()
    // The ".vn" glyphs live past x≈5300 in the path data. A path that stops before them is the
    // exact regression that shipped: a mark reading "eno".
    expect(svg).toContain('M5581.0')  // the dot of ".vn"
    expect(svg).toContain('M8246.0')  // the final "n"
  })

  it('keeps the mark aspect ratio at any width', () => {
    // ⚠️ 2 places, not 3: the height is rounded to a whole pixel, so at a small width the ratio
    // moves in the third decimal for that reason alone. A genuine aspect change moves the first.
    const a = watermarkSvg(200, { fill: '#fff', opacity: 1 })
    const b = watermarkSvg(600, { fill: '#fff', opacity: 1 })
    expect(b.height / b.width).toBeCloseTo(a.height / a.width, 2)
    expect(b.height / b.width).toBeCloseTo(1588.3 / 9132.3, 2) // the mark's own box
  })

  it('carries the ink it was given', () => {
    const svg = watermarkSvg(300, { fill: '#0a0a0a', opacity: 0.42 }).svg.toString()
    expect(svg).toContain('fill="#0a0a0a"')
    expect(svg).toContain('fill-opacity="0.42"')
  })
})

describe('inkForLuminance', () => {
  it('goes near-black on a bright backdrop and white on a dark one', () => {
    expect(inkForLuminance(0.9).fill).toBe('#0a0a0a') // pale sky, white cyc
    expect(inkForLuminance(0.2).fill).toBe('#ffffff')
  })

  // ⛔ THE CASE THAT MATTERED. A bulk script stamped FIXED WHITE, so a water park under a pale sky
  // got a mark nobody could see. Anything that can measure a mean now gets the app's answer.
  it('is not white for a pale photo', () => {
    expect(inkForLuminance(0.75).fill).not.toBe('#ffffff')
  })

  it('falls back to white when the probe failed, which is the safe average', () => {
    expect(inkForLuminance(null).fill).toBe('#ffffff')
    expect(inkForLuminance(Number.NaN).fill).toBe('#ffffff')
  })
})

describe('watermarkPlacement', () => {
  it('anchors bottom-right and never touches the border', () => {
    const p = watermarkPlacement(1600, 1600)
    expect(p.left).toBeGreaterThan(0)
    expect(p.top).toBeGreaterThan(0)
    expect(p.left + p.markWidth).toBeLessThan(1600)
  })

  // ⚠️ Padding comes off the SHORT edge on purpose: off the width, a tall portrait got a hairline
  // gap at the bottom while a panorama got a canyon.
  it('takes its inset from the short edge, so a panorama and a portrait match', () => {
    const wide = watermarkPlacement(3000, 800)
    const tall = watermarkPlacement(800, 3000)
    // Both have a short edge of 800, so both pad by round(800 * 0.03) = 24 from the right.
    expect(3000 - (wide.left + wide.markWidth)).toBe(24)
    expect(800 - (tall.left + tall.markWidth)).toBe(24)
  })

  /**
   * ⛔ PINS A KNOWN DEFECT RATHER THAN A WISH. My first version asserted "some of the mark stays
   * visible after a square cover-crop" and PASSED — because it compared `left` against a
   * `visibleRight` that falls back to the full width on a portrait, so the vertical crop was never
   * checked. Three reviewers caught it. The truth is worse than the assertion: on a portrait card
   * the mark is cropped away completely.
   *
   * Cards use `aspect-square` + `object-cover` (listing-card.tsx:329), which crops the LONG axis
   * centred while the mark is anchored to the image's own corner. This records what that costs, so
   * that a future fix — anchoring to the centre-crop box — has a number to move.
   */
  it('records how much of the mark a square cover-crop actually leaves', () => {
    const visible = (w: number, h: number) => {
      const { left, top, markWidth } = watermarkPlacement(w, h)
      const mh = Math.round((markWidth / 9132.3) * 1588.3)
      const [vx0, vx1] = w > h ? [(w - h) / 2, (w + h) / 2] : [0, w]
      const [vy0, vy1] = h > w ? [(h - w) / 2, (h + w) / 2] : [0, h]
      const sx = Math.max(0, Math.min(left + markWidth, vx1) - Math.max(left, vx0))
      const sy = Math.max(0, Math.min(top + mh, vy1) - Math.max(top, vy0))
      return (sx / markWidth) * (sy / mh)
    }
    expect(visible(1200, 1200)).toBeCloseTo(1, 2)   // square: fully visible — ~90% of live photos
    expect(visible(1600, 900)).toBeGreaterThan(0.2) // landscape: partly cropped
    expect(visible(1600, 900)).toBeLessThan(0.4)
    expect(visible(900, 1200)).toBe(0)              // ⛔ portrait: gone entirely
  })

  /**
   * ⛔ THE OVERLAY MUST FIT ON BOTH AXES. sharp refuses one larger than its base. Width was clamped
   * and height was not: an 800×30 banner asked for a 224×39 mark and threw whatever `top` did.
   */
  it('never asks for a mark that overflows the image, on either axis', () => {
    // ⚠️ 2×100 is in here because `mh` rounded to ZERO on it, which fed the luminance probe a
    // zero-height region — a reviewer's case, not one I would have thought of.
    for (const [w, h] of [[100, 100], [800, 30], [150, 90], [60, 400], [1600, 900], [2, 100]]) {
      const p = watermarkPlacement(w, h)
      const mh = Math.max(1, Math.round((p.markWidth / 9132.3) * 1588.3))
      expect(p.region.width).toBeGreaterThan(0)
      expect(p.region.height).toBeGreaterThan(0)
      expect(p.markWidth).toBeLessThanOrEqual(w)
      expect(p.left + p.markWidth).toBeLessThanOrEqual(w)
      expect(p.top + mh).toBeLessThanOrEqual(h)
    }
  })

  /**
   * ⚠️ 23% of live listing photos are 600px wide (measured, 10 of a 44-image sample): partner CDNs
   * serve small images and MAX_EDGE only ever shrinks. The old 190px floor made those a 31.7% mark
   * beside a 1200px photo's 28.0% — the inconsistency the owner reported.
   */
  it('does not let the floor inflate the mark on the sizes partners actually serve', () => {
    for (const edge of [600, 800, 900, 1200]) {
      const p = watermarkPlacement(edge, edge)
      expect(p.markWidth / edge).toBeCloseTo(0.28, 2)
    }
  })

  it('keeps the probe region inside the image on a tiny source', () => {
    const p = watermarkPlacement(200, 200)
    expect(p.region.left + p.region.width).toBeLessThanOrEqual(200)
    expect(p.region.top + p.region.height).toBeLessThanOrEqual(200)
  })
})
