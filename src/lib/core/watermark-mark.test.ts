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

  it('keeps the probe region inside the image on a tiny source', () => {
    const p = watermarkPlacement(200, 200)
    expect(p.region.left + p.region.width).toBeLessThanOrEqual(200)
    expect(p.region.top + p.region.height).toBeLessThanOrEqual(200)
  })
})
