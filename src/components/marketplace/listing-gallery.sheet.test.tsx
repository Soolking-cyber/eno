// @vitest-environment jsdom
/**
 * ⛔ THE RENTAL SHEET'S PHONE PHOTO (owner-approved 2026-11-14, cook r05 "rental-c"; ListingGallery `sheet`, src/lib/rental-sheet.ts).
 * Each photo fills its square: no 64px blurred backdrop, no flat gutter fill, no watermark texture — only the sharp layer, which
 * keeps `priority` + fetchPriority=high (the LCP element). The counter sits at the END, 28px up (above the sheet's 16px edge,
 * over its z 6), and the video slide's mute toggle 28px up too. Without `sheet` everything is as before (flat-fill and gestures
 * suites). next/image is a plain <img> here, as in those suites.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type React from 'react'

vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text
  default: ({ fill: _f, priority, unoptimized: _u, quality: _q, ...rest }: Record<string, unknown>) => <img data-priority={priority ? '' : undefined} {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)} />,
}))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', t: (k: string) => k, tr: (en: string) => en }),
  Tr: ({ en }: { en: string }) => <>{en}</>,
  useTr: (s: string) => s,
}))
vi.mock('./image-mark', () => ({ ImageMark: () => null }))
vi.mock('@/components/ui/carousel', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  return { Carousel: Pass, CarouselContent: Pass, CarouselItem: Pass, CarouselNext: () => null, CarouselPrevious: () => null }
})
vi.mock('@/components/native/native-bootstrap', () => ({ pushBlackStatusBar: () => () => {} }))

import { ListingGallery } from './listing-gallery'

const A = 'https://img.test/a.jpg'
const B = 'https://img.test/b.jpg'
const V = 'https://img.test/v.mp4'

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

const photoImgs = (c: HTMLElement) => [...c.querySelectorAll('img')].filter((i) => i.getAttribute('src') === A || i.getAttribute('src') === B)
const counter = (c: HTMLElement) => [...c.querySelectorAll('span.photo-badge')].find((s) => /\d+ \/ \d+/.test(s.textContent ?? '')) as HTMLElement | undefined

describe('ListingGallery `sheet` (the rental sheet, phone mount)', () => {
  it('cover: only the sharp layer — object-cover, no 64px backdrop, no watermark texture — and the first keeps its priority', () => {
    const { container } = render(<ListingGallery variant="mobile" images={[A, B]} title="Studio" sheet />)
    const imgs = photoImgs(container)
    expect(imgs.map((i) => i.getAttribute('sizes'))).toEqual(['100vw', '100vw'])
    for (const i of imgs) {
      expect(i.className).toContain('object-cover')
      expect(i.className).not.toContain('object-contain')
      expect(i.className).not.toContain('blur-2xl')
    }
    expect(imgs[0].hasAttribute('data-priority')).toBe(true)
    expect(imgs[0].getAttribute('fetchpriority')).toBe('high')
    expect(container.innerHTML).not.toContain('watermark.svg')
    expect(container.querySelector('img[aria-hidden="true"]')).toBeNull()
  })

  // The eno.vn mark is drawn again in the bottom-right corner (owner 2026-11-23), so the counter is back at the centre.
  it('the counter is at the bottom-centre, 28px up, over the sheet edge — the mark owns bottom-right', () => {
    const { container } = render(<ListingGallery variant="mobile" images={[A, B]} title="Studio" sheet />)
    const c = counter(container)!.className.split(/\s+/)
    expect(c).toEqual(expect.arrayContaining(['bottom-7', 'left-1/2', '-translate-x-1/2', 'z-10', 'photo-badge']))
    expect(c).not.toContain('right-3')
    expect(c).not.toContain('bottom-3')
  })

  it('a single photo fills its frame too (the one-photo branch)', () => {
    const { container } = render(<ListingGallery variant="mobile" images={[A]} title="Studio" sheet />)
    const imgs = photoImgs(container)
    expect(imgs).toHaveLength(1)
    expect(imgs[0].className).toContain('object-cover')
    expect(imgs[0].getAttribute('fetchpriority')).toBe('high')
  })

  it('a video slide: the mute toggle sits 28px up; the cover overlay and its eager poster are unchanged (no poster attr)', () => {
    const { container } = render(<ListingGallery variant="mobile" images={[A, B]} video={V} title="Studio" sheet />)
    const mute = container.querySelector('button[aria-label="Unmute"]')!
    expect(mute.className).toContain('bottom-7')
    expect(mute.className).not.toContain('bottom-2')
    const video = container.querySelector('video')!
    expect(video.hasAttribute('poster')).toBe(false)
    const cover = [...container.querySelectorAll('img')].find((i) => i.getAttribute('loading') === 'eager' && i.getAttribute('src') === A && i.closest('[aria-hidden="true"]'))
    expect(cover).toBeDefined()
  })

  it('without `sheet` nothing changes: the blurred backdrop, the contained photo, the bottom-centre counter, mute at bottom-2', () => {
    const { container } = render(<ListingGallery variant="mobile" images={[A, B]} video={V} title="Studio" />)
    // (Not the video's cover overlay, whose wrapper is aria-hidden; the 64px backdrop is aria-hidden itself.)
    const imgs = photoImgs(container).filter((i) => !i.parentElement!.closest('[aria-hidden="true"]'))
    expect(imgs.some((i) => i.getAttribute('sizes') === '64px')).toBe(true)
    expect(imgs.filter((i) => i.getAttribute('sizes') !== '64px').every((i) => i.className.includes('object-contain'))).toBe(true)
    expect(container.innerHTML).toContain('watermark.svg')
    expect(counter(container)!.className).toContain('left-1/2')
    expect(container.querySelector('button[aria-label="Unmute"]')!.className).toContain('bottom-2')
  })
})
