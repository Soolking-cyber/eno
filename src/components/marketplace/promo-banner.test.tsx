// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SlidePanel } from './promo-banner'
import { PROMO_SLIDES } from '@/lib/promo-slides'

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ tr: (en: string) => en }) }))
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const slide = PROMO_SLIDES.find(s => s.art?.avif)!

describe('promo artwork network recovery', () => {
  it('starts with AVIF and preserves art direction, priority and the accessible link', () => {
    const { container } = render(<SlidePanel slide={slide} first />)
    expect(container.querySelectorAll('source[type="image/avif"]')).toHaveLength(2)
    expect(container.querySelector('source[media]')?.getAttribute('media')).toBe('(min-width: 1024px)')
    expect(screen.getByRole('img').getAttribute('fetchpriority')).toBe('high')
    expect(screen.getByRole('link').getAttribute('aria-label')).toContain(slide.art!.alt)
  })
  it('remounts onto WebP after AVIF fails, then shows text if WebP also fails', () => {
    const { container } = render(<SlidePanel slide={slide} first />)
    const original = screen.getByRole('img')
    Object.defineProperty(original, 'currentSrc', { value: slide.art!.avif!.desktop })
    fireEvent.error(original)
    expect(container.querySelectorAll('source[type="image/avif"]')).toHaveLength(0)
    const retry = screen.getByRole('img')
    expect(retry).not.toBe(original)
    expect(retry.getAttribute('src')).toBe(slide.art!.mobile)
    expect(container.querySelector('source')?.getAttribute('srcset')).toBe(slide.art!.desktop)
    fireEvent.error(retry)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText(slide.art!.alt)).toBeTruthy()
    expect(screen.getByRole('link').getAttribute('href')).toBe(slide.href)
  })
  it('goes straight to text when the browser demonstrably selected WebP', () => {
    render(<SlidePanel slide={slide} />)
    const img = screen.getByRole('img')
    // ⚠️ STATE THE PREMISE. This previously asserted "WebP was selected" while leaving currentSrc
    // empty, so it actually passed on the OLD code's fallback to `img.src` — which is hardcoded to
    // the WebP and therefore reports "WebP failed" for every failure, AVIF included.
    Object.defineProperty(img, 'currentSrc', { value: slide.art!.mobile })
    fireEvent.error(img)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText(slide.art!.alt)).toBeTruthy()
  })
  /** ⛔ THE AMBIGUOUS CASE, which is the one the old code got wrong: some engines leave
   *  `currentSrc` empty on error. Assume the AVIF candidate and retry WebP — one wasted request at
   *  worst — rather than demoting to text and skipping a format that would probably have worked. */
  it('retries WebP when the failing format cannot be identified', () => {
    const { container } = render(<SlidePanel slide={slide} />)
    fireEvent.error(screen.getByRole('img')) // currentSrc unset
    expect(container.querySelectorAll('source[type="image/avif"]')).toHaveLength(0)
    const retry = screen.getByRole('img')
    expect(retry.getAttribute('src')).toBe(slide.art!.mobile)
    fireEvent.error(retry) // the ladder still terminates at text
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText(slide.art!.alt)).toBeTruthy()
  })
  it('detects a failure that happened before hydration attached onError', () => {
    // ⚠️ THE SPIES BREAK EVERY FORMAT, so the ladder legitimately runs all the way to text here —
    // this pins DETECTION of the pre-hydration case, not the AVIF→WebP rung, which the explicit
    // error tests above cover. A broken eager SSR image can finish loading before React hydrates,
    // so onError never fires and only the complete/naturalWidth check notices.
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(0)
    render(<SlidePanel slide={slide} />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText(slide.art!.alt)).toBeTruthy()
  })
  it('does not fetch held-back offscreen artwork', () => {
    const { container } = render(<SlidePanel slide={slide} artReady={false} />)
    expect(container.querySelector('picture')).toBeNull()
  })
})
