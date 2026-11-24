import { describe, expect, it } from 'vitest'
import { COLLAGE_GAP, collageLayout, photoAspect } from './photo-collage'

const u = (w: number, h: number, n = 0) => `https://sb.eno.vn/storage/v1/object/public/listings/17951-x${n}-ild-${w}x${h}-habc.webp`
const L = (w: number, h: number, n = 0) => u(w, h, n) // landscape helper names stay readable in the cases below

/** Every tile inside the frame, no two overlapping, and each one's aspect is its photo's (before the frame clamp scales y). */
function sane(urls: string[]) {
  const c = collageLayout(urls)!
  for (const t of c.tiles) {
    expect(t.x).toBeGreaterThanOrEqual(-1e-9)
    expect(t.x + t.w).toBeLessThanOrEqual(1 + 1e-9)
    expect(t.y + t.h).toBeLessThanOrEqual(c.height + 1e-9)
  }
  for (let a = 0; a < c.tiles.length; a++) for (let b = a + 1; b < c.tiles.length; b++) {
    const p = c.tiles[a], q = c.tiles[b]
    const overlap = p.x < q.x + q.w - 1e-9 && q.x < p.x + p.w - 1e-9 && p.y < q.y + q.h - 1e-9 && q.y < p.y + p.h - 1e-9
    expect(overlap, `${c.name}: tiles ${p.i} and ${q.i}`).toBe(false)
  }
  return c
}

describe('photoAspect', () => {
  it('reads the -WxH- in an eno file name, clamped to 1:2 … 2.2:1; 4:3 without one', () => {
    expect(photoAspect(u(1600, 1200))).toBeCloseTo(4 / 3)
    expect(photoAspect(u(387, 516))).toBeCloseTo(387 / 516)
    expect(photoAspect(u(4000, 1000))).toBe(2.2)
    expect(photoAspect(u(100, 400))).toBe(0.5)
    expect(photoAspect('https://x/y.jpg')).toBeCloseTo(4 / 3)
    expect(photoAspect(null)).toBeCloseTo(4 / 3)
  })
})

describe('collageLayout (owner 2026-11-24: "all image surface will be shown without empty bars max 4 at a time")', () => {
  it('no collage for one photo (the card keeps its one large photo)', () => {
    expect(collageLayout([u(1600, 1200)])).toBeNull()
    expect(collageLayout([])).toBeNull()
  })
  it('at most 4 tiles, the first four photos, each once', () => {
    const c = sane([L(1600, 1200, 1), L(1600, 1200, 2), L(1600, 1200, 3), L(1600, 1200, 4), L(1600, 1200, 5), L(1600, 1200, 6)])
    expect(c.tiles.map((t) => t.i).sort()).toEqual([0, 1, 2, 3])
  })
  it('four 4:3 photos: a 2×2 whose tiles keep 4:3 exactly (no crop), a frame close to square', () => {
    const c = sane([L(1600, 1200, 1), L(1600, 1200, 2), L(1600, 1200, 3), L(1600, 1200, 4)])
    expect(c.name).toBe('2x2')
    for (const t of c.tiles) expect(t.w / t.h).toBeCloseTo(4 / 3, 1)
    expect(c.height).toBeGreaterThan(0.7)
  })
  it('two tall photos sit side by side; two wide ones stack', () => {
    expect(sane([u(600, 900, 1), u(600, 900, 2)]).name).toBe('row')
    expect(sane([u(1600, 900, 1), u(1600, 900, 2)]).name).toBe('stack')
  })
  it('a tall photo then two wide ones: the tall one big on the left, the wide ones stacked beside it', () => {
    const c = sane([u(900, 1200, 1), u(1600, 1200, 2), u(1600, 1200, 3)])
    expect(c.name).toBe('left+col')
    // The column's tiles keep their aspect, and both columns end on one line.
    const [big, a, b] = c.tiles
    expect(a.w / a.h).toBeCloseTo(4 / 3, 1)
    expect(b.y + b.h).toBeCloseTo(big.h, 6)
    expect(a.x).toBeCloseTo(big.w + COLLAGE_GAP, 6)
  })
  it('the frame stays 0.7 … 1.35 of the width, whatever the photos', () => {
    for (const set of [[u(4000, 1000, 1), u(4000, 1000, 2)], [u(100, 400, 1), u(100, 400, 2), u(100, 400, 3)], [u(1000, 1000, 1), u(1000, 1000, 2)]]) {
      const c = sane(set)
      expect(c.height).toBeGreaterThanOrEqual(0.7 - 1e-9)
      expect(c.height).toBeLessThanOrEqual(1.35 + 1e-9)
    }
  })
  it('no tile narrower than 30% of the card when a layout without one exists', () => {
    const c = sane([L(1600, 1200, 1), L(1600, 1200, 2), L(1600, 1200, 3), L(1600, 1200, 4)])
    for (const t of c.tiles) expect(Math.min(t.w, t.h)).toBeGreaterThanOrEqual(0.3)
  })
})
