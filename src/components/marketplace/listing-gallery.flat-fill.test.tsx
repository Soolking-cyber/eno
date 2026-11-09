// @vitest-environment jsdom
/**
 * A PACKSHOT'S FLAT GUTTERS, IN THE REAL GALLERY (UI climb 2026-11-09): the flat fill waits for the SHARP photo — applied on the
 * 64px backdrop's load alone it would replace a slow connection's blurred preview with a blank frame — never appears when the
 * sharp photo fails, and a late load from another photo never stamps this one. next/image is a plain <img> here (as in the
 * gestures suite), so `src` is the photo's own URL; the canvas is stubbed to a white border.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type React from 'react'

vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text
  default: ({ fill: _f, priority: _p, unoptimized: _u, quality: _q, ...rest }: Record<string, unknown>) => <img {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)} />,
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
// White border, a dark subject in the middle (a packshot) — a fully uniform image is treated as a blank or faked frame.
const white = new Uint8ClampedArray(16 * 16 * 4).fill(255)
for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) white.set([30, 30, 30, 255], (y * 16 + x) * 4)

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  const real = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => tag === 'canvas'
    ? ({ width: 0, height: 0, getContext: () => ({ drawImage: () => {}, getImageData: () => ({ data: white }) }) } as unknown as HTMLCanvasElement)
    : real(tag)) as typeof document.createElement)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

const fill = (c: HTMLElement) => c.querySelector('span[style*="background-color"]')
const layers = (c: HTMLElement) => {
  const imgs = [...c.querySelectorAll('img')].filter((i) => i.getAttribute('src') === A)
  return { backdrop: imgs.find((i) => i.getAttribute('sizes') === '64px')!, sharp: imgs.find((i) => i.getAttribute('sizes') !== '64px')! }
}

describe('BlurFillImage flat fill', () => {
  it('waits for the sharp photo: backdrop loaded → still no fill; sharp loaded → white gutters', async () => {
    const { container } = render(<ListingGallery images={[A]} title="Bike" />)
    const { backdrop, sharp } = layers(container)
    await act(async () => { fireEvent.load(backdrop) })
    expect(fill(container)).toBeNull()
    await act(async () => { fireEvent.load(sharp) })
    expect(fill(container)?.getAttribute('style')).toContain('rgb(255, 255, 255)')
  })

  it('a sharp photo that fails never gets the fill', async () => {
    const { container } = render(<ListingGallery images={[A]} title="Bike" />)
    const { backdrop, sharp } = layers(container)
    await act(async () => { fireEvent.load(backdrop); fireEvent.error(sharp) })
    expect(fill(container)).toBeNull()
  })

  it('a load event from another photo stamps nothing', async () => {
    const { container } = render(<ListingGallery images={[A]} title="Bike" />)
    const { backdrop, sharp } = layers(container)
    backdrop.setAttribute('src', 'https://img.test/a.jpg?v=2')
    sharp.setAttribute('src', 'https://img.test/a.jpg?v=2')
    await act(async () => { fireEvent.load(backdrop); fireEvent.load(sharp) })
    expect(fill(container)).toBeNull()
  })

  it('A → B → A by props: B starts without a fill, and back on A the fill waits for A\'s loads again', async () => {
    const B = 'https://img.test/b.jpg'
    const view = render(<ListingGallery images={[A]} title="Bike" />)
    const a1 = layers(view.container)
    await act(async () => { fireEvent.load(a1.backdrop); fireEvent.load(a1.sharp) })
    expect(fill(view.container)).not.toBeNull()
    view.rerender(<ListingGallery images={[B]} title="Bike" />)
    expect(fill(view.container)).toBeNull()
    view.rerender(<ListingGallery images={[A]} title="Bike" />)
    expect(fill(view.container)).toBeNull() // A's earlier "loaded" and colour did not survive the visit to B
    const a2 = layers(view.container)
    await act(async () => { fireEvent.load(a2.backdrop); fireEvent.load(a2.sharp) })
    expect(fill(view.container)).not.toBeNull()
  })
})
