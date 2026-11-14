// @vitest-environment jsdom
/**
 * ⛔ THE GOODS SHEET'S PHONE PHOTO (owner-approved 2026-11-14, cook r06 "item"; ListingGallery `plain`, src/lib/goods-sheet.ts).
 * Each photo whole on the frame's own white: `object-contain`, the slide `bg-background`, no 64px blurred backdrop, no flat
 * gutter fill, no watermark texture — only the sharp layer, which keeps `priority` + fetchPriority=high. The counter sits at
 * the START, 28px up, over the sheet edge — bottom-centre (28px up) on a gallery with a video, whose mute toggle (28px up too)
 * owns bottom-left. The cover video and its no-`poster` rule are untouched.
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

describe('ListingGallery `plain` (the goods sheet, phone mount)', () => {
  it('the whole photo on white: object-contain, no backdrop, no texture, the slide bg-background; the first keeps its priority', () => {
    const { container } = render(<ListingGallery variant="mobile" images={[A, B]} title="iPhone" plain />)
    const imgs = photoImgs(container)
    expect(imgs).toHaveLength(2)
    for (const i of imgs) {
      expect(i.className).toContain('object-contain')
      expect(i.className).not.toContain('blur-2xl')
      expect(i.closest('button')!.className).toContain('bg-background')
      expect(i.closest('button')!.className).not.toContain('bg-tint')
    }
    expect(imgs[0].hasAttribute('data-priority')).toBe(true)
    expect(imgs[0].getAttribute('fetchpriority')).toBe('high')
    expect(container.innerHTML).not.toContain('watermark.svg')
    expect(container.querySelector('img[aria-hidden="true"]')).toBeNull()
  })
  it('the counter at the start, 28px up, over the sheet edge', () => {
    const { container } = render(<ListingGallery variant="mobile" images={[A, B]} title="iPhone" plain />)
    const c = counter(container)!.className.split(/\s+/)
    expect(c).toEqual(expect.arrayContaining(['bottom-7', 'left-3', 'z-10', 'photo-badge']))
    expect(c).not.toContain('left-1/2')
  })
  it('with a video: the counter stays bottom-centre (28px up) and the mute toggle lifts; no poster attr', () => {
    const { container } = render(<ListingGallery variant="mobile" images={[A, B]} video={V} title="iPhone" plain />)
    const c = counter(container)!.className.split(/\s+/)
    expect(c).toEqual(expect.arrayContaining(['bottom-7', 'left-1/2', '-translate-x-1/2']))
    expect(container.querySelector('button[aria-label="Unmute"]')!.className).toContain('bottom-7')
    expect(container.querySelector('video')!.hasAttribute('poster')).toBe(false)
  })
  it('a single photo: contained on white too', () => {
    const { container } = render(<ListingGallery variant="mobile" images={[A]} title="iPhone" plain />)
    const imgs = photoImgs(container)
    expect(imgs[0].className).toContain('object-contain')
    expect(imgs[0].closest('[data-protected]')!.className).toContain('bg-background')
  })
})
