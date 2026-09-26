// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type React from 'react'

/**
 * THE PHOTO VIEWER'S GESTURES FOLLOW THE HOUSE SWIPE GRAMMAR (use-swipe-dismiss).
 *  · A flick down closes the photo on its RELEASE velocity. The old rule averaged over the whole gesture from
 *    touchdown (≥0.5 px/ms over ≥40px), so the dwell before the finger moved counted against it and an ordinary
 *    flick snapped back — only a 120px drag closed the photo.
 *  · Where there is nowhere to go — before the first photo, past the last, past a zoomed photo's edge — the photo
 *    gives under the finger (rubber band) instead of tracking it 1:1 or stopping dead, and release settles it.
 */
vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text
  default: ({ fill: _f, priority: _p, unoptimized: _u, quality: _q, sizes: _s, ...rest }: Record<string, unknown>) => <img {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)} />,
}))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', t: (k: string) => k, tr: (en: string) => en }),
  Tr: ({ en }: { en: string }) => <>{en}</>,
  useTr: (s: string) => s,
}))
vi.mock('./image-mark', () => ({ ImageMark: () => null }))
// The desktop thumbnail rail (embla) is not under test and needs matchMedia jsdom lacks.
vi.mock('@/components/ui/carousel', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  return { Carousel: Pass, CarouselContent: Pass, CarouselItem: Pass, CarouselNext: () => null, CarouselPrevious: () => null }
})
vi.mock('@/components/native/native-bootstrap', () => ({ pushBlackStatusBar: () => () => {} }))

import { ListingGallery } from './listing-gallery'

const IMAGES = ['https://img.test/a.jpg', 'https://img.test/b.jpg', 'https://img.test/c.jpg']

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function openLightbox() {
  render(<ListingGallery images={IMAGES} title="Bike" />)
  fireEvent.click(screen.getAllByRole('button').find((b) => b.querySelector('img'))!)
  const dialog = screen.getByRole('dialog')
  const frame = dialog.querySelector<HTMLElement>('[data-protected]')!
  // The frame's own geometry sizes the zoomed pan's bounds; jsdom lays nothing out.
  frame.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600, toJSON() {} }) as DOMRect
  const photo = frame.firstElementChild as HTMLElement
  return { dialog, frame, photo }
}

const touch = (x: number, y: number) => [{ clientX: x, clientY: y, identifier: 0 }]
/** One finger: down, `dwellMs` still, then 10ms moves along `path` (offsets from the start), then `holdMs` still, up. */
function gesture(el: HTMLElement, path: Array<[number, number]>, { dwellMs = 0, holdMs = 0, x0 = 200, y0 = 300 } = {}) {
  act(() => { fireEvent.touchStart(el, { touches: touch(x0, y0), changedTouches: touch(x0, y0) }) })
  act(() => { vi.advanceTimersByTime(dwellMs) })
  for (const [dx, dy] of path) {
    act(() => { vi.advanceTimersByTime(10) })
    act(() => { fireEvent.touchMove(el, { touches: touch(x0 + dx, y0 + dy), changedTouches: touch(x0 + dx, y0 + dy) }) })
  }
  act(() => { vi.advanceTimersByTime(holdMs) })
  const [lx, ly] = path.at(-1) ?? [0, 0]
  act(() => { fireEvent.touchEnd(el, { touches: [], changedTouches: touch(x0 + lx, y0 + ly) }) })
}
const down = (px: number, steps: number): Array<[number, number]> => Array.from({ length: steps }, (_, i) => [0, (px * (i + 1)) / steps])
const closing = (dialog: HTMLElement) => dialog.className.includes('animate-out')

describe('lightbox — swipe to close', () => {
  it('closes on a short, quick flick after a pause at touchdown (the old whole-gesture average refused it)', () => {
    const { dialog, frame } = openLightbox()
    // 36px in 60ms (0.6 px/ms at release) after 150ms still: averaged over 210ms it is 0.17 px/ms, under 40px.
    gesture(frame, down(36, 6), { dwellMs: 150 })
    expect(closing(dialog)).toBe(true)
  })

  it('does not close when the finger stopped before lifting — a held finger is not a flick', () => {
    const { dialog, frame, photo } = openLightbox()
    gesture(frame, down(36, 6), { holdMs: 150 })
    expect(closing(dialog)).toBe(false)
    expect(photo.style.transform).toBe('')
  })

  it('does not close on a flick back toward where it started', () => {
    const { dialog, frame } = openLightbox()
    // Out 60px slowly, then back up quickly to 40px: the release moves AGAINST the displacement.
    gesture(frame, [...down(60, 12), [0, 55], [0, 50], [0, 45], [0, 40]])
    expect(closing(dialog)).toBe(false)
  })

  it('still closes on distance alone, slow or not', () => {
    const { dialog, frame } = openLightbox()
    gesture(frame, down(130, 26), { holdMs: 300 })
    expect(closing(dialog)).toBe(true)
  })
})

describe('lightbox — edges give under the finger', () => {
  it('before the first photo the drag is damped; toward the next photo it tracks 1:1', () => {
    const { frame, photo } = openLightbox()
    act(() => { fireEvent.touchStart(frame, { touches: touch(200, 300), changedTouches: touch(200, 300) }) })
    act(() => { fireEvent.touchMove(frame, { touches: touch(300, 300), changedTouches: touch(300, 300) }) })
    expect(photo.style.transform).toBe('translate(20px, 0px)')
    act(() => { fireEvent.touchMove(frame, { touches: touch(100, 300), changedTouches: touch(100, 300) }) })
    expect(photo.style.transform).toBe('translate(-100px, 0px)')
  })

  it('a zoomed photo pans past its edge by a fraction of the finger, and settles back to the edge on release', () => {
    const { frame, photo } = openLightbox()
    // Double-tap the centre: zoom 2.5× with no pan.
    for (let i = 0; i < 2; i++) {
      act(() => { fireEvent.touchStart(frame, { touches: touch(200, 300), changedTouches: touch(200, 300) }) })
      act(() => { fireEvent.touchEnd(frame, { touches: [], changedTouches: touch(200, 300) }) })
      act(() => { vi.advanceTimersByTime(100) })
    }
    expect(photo.style.transform).toBe('translate(0px, 0px) scale(2.5)')
    // Bound: (2.5 - 1) × 400 / 2 = 300px. Drag 400px right: 300 + 100 × 0.2 = 320.
    act(() => { fireEvent.touchStart(frame, { touches: touch(0, 300), changedTouches: touch(0, 300) }) })
    act(() => { fireEvent.touchMove(frame, { touches: touch(400, 300), changedTouches: touch(400, 300) }) })
    expect(photo.style.transform).toBe('translate(320px, 0px) scale(2.5)')
    act(() => { fireEvent.touchEnd(frame, { touches: [], changedTouches: touch(400, 300) }) })
    expect(photo.style.transform).toBe('translate(300px, 0px) scale(2.5)')
    // …under the transition: panning cleared, so the settle eases instead of jumping.
    expect(photo.className).toContain('transition-transform')
  })
})
