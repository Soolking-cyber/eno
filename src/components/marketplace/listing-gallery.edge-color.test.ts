// @vitest-environment jsdom
/**
 * A PACKSHOT'S GUTTERS TAKE ITS OWN FLAT EDGE COLOUR; A REAL PHOTO KEEPS THE BLUR (UI climb 2026-11-09). edgeColor reads the
 * outer ring of a 16×16 draw of the backdrop's 64px source: every channel within 12 → the mean colour; anything else, or a
 * canvas that throws (a tainted cross-origin image), → null, and the blurred copy stays.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { edgeColor, isShowing } from './listing-gallery'

const N = 16
/** A fake 2D context whose pixels come from `px(x, y)`. */
function stubCanvas(px: (x: number, y: number) => [number, number, number], opts: { throws?: boolean; alpha?: number } = {}) {
  const data = new Uint8ClampedArray(N * N * 4)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const [r, g, b] = px(x, y); data.set([r, g, b, opts.alpha ?? 255], (y * N + x) * 4) }
  const ctx = {
    drawImage: () => {},
    getImageData: () => { if (opts.throws) throw new DOMException('tainted', 'SecurityError'); return { data } },
  }
  const real = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
    tag === 'canvas' ? ({ width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement) : real(tag)) as typeof document.createElement)
}
const img = {} as HTMLImageElement
afterEach(() => vi.restoreAllMocks())

describe('edgeColor', () => {
  it('a studio packshot on white (a subject in the middle) → white gutters', () => {
    stubCanvas((x, y) => (x > 4 && x < 11 && y > 4 && y < 11 ? [200, 30, 40] : [252, 252, 251]))
    expect(edgeColor(img)).toBe('rgb(252, 252, 251)')
  })

  it('a near-flat grey studio wall within the tolerance, a subject in front → its mean', () => {
    stubCanvas((x, y) => (x > 4 && x < 11 && y > 4 && y < 11 ? [40, 60, 200] : x % 2 ? [236, 236, 236] : [228, 228, 228]))
    expect(edgeColor(img)).toBe('rgb(232, 232, 232)')
  })

  it('a whole image of one colour (a blank frame, or a privacy browser\'s faked canvas data) → null', () => {
    stubCanvas(() => [255, 255, 255])
    expect(edgeColor(img)).toBeNull()
  })

  it('a shaded studio sweep (240 at the top to 216 at the bottom) → null: a flat fill would leave a step', () => {
    stubCanvas((_x, y) => { const v = Math.round(240 - (24 * y) / (N - 1)); return [v, v, v] })
    expect(edgeColor(img)).toBeNull()
  })

  it('a real photo whose edges vary → null (the blur stays)', () => {
    stubCanvas((x, y) => (y === 0 ? [210, 220, 230] : x === 0 ? [90, 70, 60] : [140, 140, 140]))
    expect(edgeColor(img)).toBeNull()
  })

  it('a subject touching the edge (a wheel on the bottom border) → null', () => {
    stubCanvas((x, y) => (y === N - 1 && x > 6 && x < 10 ? [20, 20, 20] : [255, 255, 255]))
    expect(edgeColor(img)).toBeNull()
  })

  it('a transparent border (a cut-out PNG/WebP) → null: drawn it reads as black, so the blur stays', () => {
    stubCanvas((x, y) => (x > 4 && x < 11 && y > 4 && y < 11 ? [200, 30, 40] : [0, 0, 0]), { alpha: 0 })
    expect(edgeColor(img)).toBeNull()
  })

  it('a tainted canvas (cross-origin mock image) → null, never a throw', () => {
    stubCanvas(() => [255, 255, 255], { throws: true })
    expect(edgeColor(img)).toBeNull()
  })
})

describe('isShowing (a late load from the previous photo never stamps the current one)', () => {
  const el = (src: string) => ({ currentSrc: src, src } as unknown as HTMLImageElement)
  const PHOTO = 'https://sb.eno.vn/storage/v1/object/public/listings/a.webp'
  it('the optimizer URL that carries this photo → true', () => {
    expect(isShowing(el(`${location.origin}/_next/image?url=${encodeURIComponent(PHOTO)}&w=64&q=60`), PHOTO)).toBe(true)
  })
  it('the optimizer URL of ANOTHER photo that merely starts the same → false', () => {
    expect(isShowing(el(`${location.origin}/_next/image?url=${encodeURIComponent(PHOTO + '?v=2')}&w=64&q=60`), PHOTO)).toBe(false)
  })
  it('an unoptimized (mock) photo compares as a whole URL, relative or absolute', () => {
    expect(isShowing(el(`${location.origin}/mock/a.jpg`), '/mock/a.jpg')).toBe(true)
    expect(isShowing(el(`${location.origin}/mock/a.jpg?v=2`), '/mock/a.jpg')).toBe(false)
  })
})
