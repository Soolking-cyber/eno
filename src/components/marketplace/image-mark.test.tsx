// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IMAGE_MARK_BOX, ImageMark, MARK_SHARE, ON_SCREEN_MARK } from './image-mark'

const BASE = 'https://sb.eno.vn/storage/v1/object/public/listings/'
beforeEach(() => vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sb.eno.vn'))
afterEach(() => vi.unstubAllEnvs())

// Owner 2026-11-23: "apply eno.vn watermark small on right left corner for all products all images in the app" — and
// "also new uploads all images should have it".
describe('ImageMark', () => {
  it('is on, and small: the card class and the contain maths use the same MARK_SHARE', () => {
    expect(ON_SCREEN_MARK).toBe(true)
    expect(MARK_SHARE).toBe(0.2)
    const { container } = render(<div className="relative"><ImageMark src={`${BASE}1794127133406-gruw9b-ild-1600x1200.webp`} /></div>)
    // A cropped photo's mark is ONE empty element drawn by `.img-mark` (globals.css, owner 2026-11-25 page weight): its
    // width there is MARK_SHARE, 3 % from the corner.
    const svg = container.querySelector('.img-mark')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.childElementCount).toBe(0)
    const css = readFileSync('src/app/globals.css', 'utf8')
    const rule = css.slice(css.indexOf('.img-mark {'), css.indexOf('}', css.indexOf('.img-mark {')))
    expect(rule).toContain(`width: ${MARK_SHARE * 100}%;`)
    expect(rule).toContain('right: 3%;')
    expect(rule).toContain('bottom: 3%;')
    expect(rule).toContain(`aspect-ratio: ${IMAGE_MARK_BOX.w} / ${IMAGE_MARK_BOX.h};`)
    expect(rule).toContain('mask: url(/brand/eno-mark-mask.svg)')
    // 'ild': light ink on the card's square.
    expect(svg.getAttribute('class')).toContain('text-white/60')
  })

  it('on a whole photo (contain) it is MARK_SHARE of the photo\'s own width, in its bottom-right corner', () => {
    const { container } = render(<div className="relative"><ImageMark fit="contain" src={`${BASE}affiliate/m/x-1-a-idl-1000x800.webp`} /></div>)
    const inner = container.querySelector('svg svg')!
    const w = Number(inner.getAttribute('width')), x = Number(inner.getAttribute('x'))
    expect(w).toBeCloseTo(1000 * MARK_SHARE)
    expect(x + w).toBeCloseTo(1000 - 800 * 0.03)
    expect(Number(inner.getAttribute('height'))).toBeCloseTo((w * IMAGE_MARK_BOX.h) / IMAGE_MARK_BOX.w)
  })

  it('a member\'s new upload gets it; a photo with its mark baked in (before 2026-11-10) never gets a second one', () => {
    const { container: a } = render(<ImageMark src={`${BASE}bulk/1794127133406-gruw9b-idd-800x600-h6d6929292b2cb0c1.webp`} />)
    expect(a.querySelector('.img-mark')).not.toBeNull()
    const { container: b } = render(<ImageMark src={`${BASE}1787899111917-wdme70-h07822068618be83c.webp`} />)
    expect(b.firstChild).toBeNull()
    const { container: c } = render(<ImageMark src="https://example.com/photo.webp" />)
    expect(c.firstChild).toBeNull()
  })
})
