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
/** A phone-width screen: the rental sheet's preview reads `(max-width: 767.98px)` (build 7). */
let narrow = false
beforeEach(() => {
  narrow = false
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('coarse') ? coarse : q.includes('max-width') ? narrow : false, media: q, addEventListener() {}, removeEventListener() {} }))
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

describe('ListingDetailMap — an approximate area has no pin (owner, 2026-09-30, P-MAP)', () => {
  it('touch: draws the area disc and no pin, framed below zoom 15', () => {
    coarse = true
    render(<ListingDetailMap listings={[listing]} activeDistrict="all" approximate={{ lat: 12.6667, lng: 108.05, radiusM: 4000 }} />)
    const open = screen.getByRole('button', { name: 'Open map' })
    expect(open.querySelector('[data-map-area]')).not.toBeNull()
    expect(open.querySelector('svg.text-brand')).toBeNull()
    const src = open.querySelector('img')?.getAttribute('src') ?? ''
    const z = Number(src.match(/light_all\/(\d+)\//)?.[1])
    expect(z).toBeLessThan(15)
  })

  it('touch without an area keeps the pin and no disc', () => {
    coarse = true
    render(<ListingDetailMap listings={[listing]} activeDistrict="all" />)
    const open = screen.getByRole('button', { name: 'Open map' })
    expect(open.querySelector('[data-map-area]')).toBeNull()
    expect(open.querySelector('svg.text-brand')).not.toBeNull()
  })
})

/**
 * ⛔ look="sheet" — THE RENTAL LISTING PAGE ON A PHONE (owner-approved 2026-11-14, cook r05 "rental-c"; the card since owner-approved
 * 2026-11-15 (build 7), cook r07 "rental"): one ink pin placed by its tip, an ink area, "Open map" as the card's 48px footer row,
 * the credits as one text plate whose links SHOW their licence wording, 8px over that row, and below md the picture drawn from
 * CARTO Voyager one zoom step out in the space the row leaves. Every class it adds is max-md: or puts back from md the r05 look
 * (a touch tablet at md+); the default look is unchanged (the suites above).
 */
describe('ListingDetailMap look="sheet"', () => {
  it('the pin: ink and 40px below md, positioned by its tip (translate), brand and 36px from md', () => {
    coarse = true
    render(<ListingDetailMap listings={[listing]} activeDistrict="all" look="sheet" />)
    const open = screen.getByRole('button', { name: 'Open map' })
    const pin = open.querySelector('svg.size-9')!
    const cls = pin.getAttribute('class')!.split(' ')
    expect(cls).toEqual(expect.arrayContaining(['max-md:size-10', 'max-md:text-foreground', '-translate-x-1/2', '-translate-y-[91.667%]', 'text-brand']))
    // At the point itself (the default look subtracts the 36px box's tip offsets instead).
    const style = pin.getAttribute('style') ?? ''
    expect(style).toMatch(/left: \d+(\.\d+)?px/)
    const def = render(<ListingDetailMap listings={[listing]} activeDistrict="all" />)
    const defPin = def.container.querySelector('svg.size-9')!
    expect(defPin.getAttribute('class')).not.toMatch(/translate|max-md:/)
    const left = (s: string) => Number(s.match(/left: (-?[\d.]+)px/)![1])
    const top = (s: string) => Number(s.match(/top: (-?[\d.]+)px/)![1])
    expect(left(style) - left(defPin.getAttribute('style')!)).toBe(18)
    expect(top(style) - top(defPin.getAttribute('style')!)).toBe(33)
  })

  it('"Open map" is the card\'s 48px footer row below md, the pill bottom-right with the pop from md — and still the button\'s name', () => {
    coarse = true
    render(<ListingDetailMap listings={[listing]} activeDistrict="all" look="sheet" />)
    const pill = [...screen.getByRole('button', { name: 'Open map' }).querySelectorAll('span')].find((s) => s.textContent === 'Open map')!
    const cls = pill.className.split(' ')
    expect(cls).toEqual(expect.arrayContaining(['bottom-0', 'left-0', 'right-0', 'h-12', 'justify-center', 'border-t', 'border-line-strong', 'bg-background', 'text-base', 'font-bold']))
    expect(cls).toEqual(expect.arrayContaining(['md:bottom-3', 'md:left-auto', 'md:right-3', 'md:h-9', 'md:rounded-full', 'md:border-t-0', 'md:bg-card', 'md:text-sm', 'md:font-semibold', 'md:shadow-[var(--shadow-pop)]']))
    expect(cls).not.toContain('top-3')
    expect(pill.className).not.toMatch(/(^|\s)shadow-pop(\s|$)/)
    expect(pill.querySelector('svg')!.getAttribute('class')).toContain('max-md:size-5')
  })

  it('below md: Voyager at z14 over the box less the 48px row, the pin centred in it; from md (or dark) the live map\'s own tiles', async () => {
    coarse = true
    narrow = true
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 382 })
    render(<ListingDetailMap listings={[listing]} activeDistrict="all" look="sheet" />)
    const open = screen.getByRole('button', { name: 'Open map' })
    const tiles = [...open.querySelectorAll('img')]
    expect(tiles.length).toBeGreaterThanOrEqual(4)
    for (const t of tiles) expect(t.getAttribute('src')).toMatch(/basemaps\.cartocdn\.com\/rastertiles\/voyager\/14\//)
    const pin = open.querySelector('svg.size-9')!
    expect(Number(pin.getAttribute('style')!.match(/top: (-?[\d.]+)px/)![1])).toBeCloseTo((382 - 48) / 2, 0)
    cleanup()
    narrow = false
    render(<ListingDetailMap listings={[listing]} activeDistrict="all" look="sheet" />)
    for (const t of screen.getByRole('button', { name: 'Open map' }).querySelectorAll('img')) expect(t.getAttribute('src')).toMatch(/\/light_all\/15\//)
  })

  it('the default look never reads the phone query: the live map\'s own tiles at every width', () => {
    coarse = true
    narrow = true
    render(<ListingDetailMap listings={[listing]} activeDistrict="all" />)
    for (const t of screen.getByRole('button', { name: 'Open map' }).querySelectorAll('img')) expect(t.getAttribute('src')).toMatch(/\/light_all\/15\//)
  })

  it('the credits: one plate, each link SHOWING its licence wording below md (its ⓘ hidden there), the name unchanged, still outside the button', () => {
    coarse = true
    render(<ListingDetailMap listings={[listing]} activeDistrict="all" look="sheet" />)
    const credits = screen.getAllByRole('link')
    expect(credits.map((a) => a.getAttribute('aria-label'))).toEqual(['© OpenStreetMap contributors', '© CARTO'])
    expect(credits.map((a) => a.textContent)).toEqual(['© OpenStreetMap contributors', '© CARTO'])
    for (const a of credits) {
      expect(a.querySelector('svg')!.getAttribute('class')).toContain('max-md:hidden')
      expect(a.querySelector('span')!.className).toBe('md:hidden')
      expect(screen.getByRole('button', { name: 'Open map' }).contains(a)).toBe(false)
    }
    const plate = credits[0].parentElement!
    expect(plate.className.split(' ')).toEqual(expect.arrayContaining(['max-md:h-6', 'max-md:rounded-full', 'max-md:text-t-meta', 'max-md:text-muted-foreground', 'max-md:bottom-14', 'max-md:backdrop-blur-none']))
    // The material tint stays bare (design-lint: the reduced-transparency block reaches a bare tint only).
    expect(plate.className.split(' ')).toContain('bg-card/70')
  })

  it('an approximate area is ink below md, brand from md', () => {
    coarse = true
    render(<ListingDetailMap listings={[listing]} activeDistrict="all" look="sheet" approximate={{ lat: 12.6667, lng: 108.05, radiusM: 4000 }} />)
    const area = screen.getByRole('button', { name: 'Open map' }).querySelector('[data-map-area]')!
    expect(area.className.split(' ')).toEqual(expect.arrayContaining(['border-brand', 'bg-brand/15', 'max-md:border-foreground', 'max-md:bg-foreground/8']))
  })
})
