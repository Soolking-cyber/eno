// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SerializedListingCard } from '@/lib/types'

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en }),
  useTr: (t: string) => t,
  Tr: ({ text }: { text: string }) => <>{text}</>,
}))
// The live Leaflet map is the landmine listings-map.tsx; what is under test is WHEN it mounts.
vi.mock('next/dynamic', () => ({ default: () => () => <div data-testid="live-map" /> }))

import { ListingDetailMap } from './listing-detail-map'

/**
 * THE PDP MAP BY INPUT (owner, 2026-09-25): on a TOUCH screen a static picture of the map with the pin
 * and an "Open map" button that opens the interactive map full-screen; with a real pointer the live map,
 * as before. The live map's `touch-action: none` trapped one-finger page scrolls (measured: a 200px drag
 * on it scrolled the page 0px), and it cost ~583 ms of main thread when it mounted mid-scroll.
 * jsdom has no IntersectionObserver, so the near-viewport gate fails open (mounts at once), and no
 * layout, so the preview's box is stubbed at the PDP's real size.
 * ⚠️ EXPLICIT CLEANUP — no vitest `globals`.
 */
afterEach(cleanup)

let coarse = false
beforeEach(() => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('coarse') ? coarse : false, media: q, addEventListener() {}, removeEventListener() {} }))
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 366 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 260 })
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight
})

const listing = {
  id: 'l1', title: 'Flat', lat: 10.7769, lng: 106.7009, city: 'Ho Chi Minh City', district: 'District 1', location: 'Ho Chi Minh City',
} as unknown as SerializedListingCard

describe('ListingDetailMap — touch gets a picture, a pointer gets the live map', () => {
  it('touch: static tiles + pin + an "Open map" button, and NO live map until it is opened', async () => {
    coarse = true
    render(<ListingDetailMap listings={[listing]} activeDistrict="all" />)
    const open = screen.getByRole('button', { name: 'Open map' })
    expect(screen.queryByTestId('live-map')).toBeNull()
    const tiles = open.querySelectorAll('img')
    expect(tiles.length).toBeGreaterThanOrEqual(4)
    expect(tiles.length).toBeLessThanOrEqual(9)
    for (const t of Array.from(tiles)) {
      expect(t.getAttribute('src')).toMatch(/basemaps\.cartocdn\.com\/light_all\/15\//)
      expect(t.getAttribute('loading')).toBe('lazy')
    }
    // Nothing IN the preview takes over a touch (the live map's `.leaflet-container` is touch-action:
    // none — the trap): no descendant carries a touch-action or Leaflet's container.
    for (const el of [open, ...Array.from(open.querySelectorAll('*'))]) {
      expect(el.getAttribute('style') ?? '').not.toMatch(/touch-action/)
      expect(String(el.getAttribute('class') ?? '')).not.toMatch(/touch-none|leaflet-container/)
    }
    // The licence credits stay reachable and are NOT inside the button.
    const credits = screen.getAllByRole('link')
    expect(credits.map((a) => a.getAttribute('aria-label'))).toEqual(['© OpenStreetMap contributors', '© CARTO'])
    for (const a of credits) expect(open.contains(a)).toBe(false)

    await act(async () => { fireEvent.click(open) })
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('Location')
    expect(dialog.querySelector('[data-testid="live-map"]')).not.toBeNull()
  })

  it('no listing on a touch screen renders nothing, not a loading tile that never resolves', () => {
    coarse = true
    const { container } = render(<ListingDetailMap listings={[]} activeDistrict="all" />)
    expect(screen.queryByRole('button', { name: 'Open map' })).toBeNull()
    expect(container.textContent).not.toContain('Loading map')
  })

  it('asks whether ANY input is touch — a touchscreen laptop gets the picture too', () => {
    const asked: string[] = []
    vi.stubGlobal('matchMedia', (q: string) => { asked.push(q); return { matches: q === '(any-pointer: coarse)', media: q, addEventListener() {}, removeEventListener() {} } })
    render(<ListingDetailMap listings={[listing]} activeDistrict="all" />)
    expect(asked).toContain('(any-pointer: coarse)')
    expect(screen.getByRole('button', { name: 'Open map' })).toBeTruthy()
  })

  it('a real pointer keeps the live map, mounted in the page as before', () => {
    coarse = false
    render(<ListingDetailMap listings={[listing]} activeDistrict="all" />)
    expect(screen.getByTestId('live-map')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open map' })).toBeNull()
  })
})
