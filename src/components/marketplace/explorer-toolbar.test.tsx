// @vitest-environment jsdom
/**
 * UX3 NAV-4 and NAV-13 on the explorer's sticky strip (SortStrip) and the category rail:
 *   · NAV-4 — the phone "›" at a scrolling row's edge was a `pointer-events-none` plate that looked like a
 *     button, so a tap fell THROUGH to the pill or tile under it (measured: it opened the Price sheet; on
 *     production it switched the category to Mẹ & Bé → 0 results). It is a real 44px button now, named
 *     "More" / "Xem thêm", that scrolls its row by the desktop arrows' own step (85%).
 *   · NAV-13 — the desktop price SORT tab read "Price ⇅" beside the "Price ▾" FILTER; it now names the
 *     order it gives, "Price low → high" / "Price high → low" (and the salary twins over jobs).
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCategory } from '@/lib/types'

const h = vi.hoisted(() => {
  const language = { lang: 'en', t: (k: string) => k, tr: (en: string, vi?: string) => (h.vi ? vi ?? en : en), setLang: () => {} }
  const h = { vi: false, language }
  return h
})
vi.mock('@/context/language-context', () => ({
  useLanguage: () => h.language,
  useTr: (s: string) => s,
  Tr: ({ text }: { text?: string | null }) => <>{text}</>,
  LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import userEvent from '@testing-library/user-event'
import { SortStrip, ViewSwitch, ViewToggles, createHeaderHiddenSignal } from './explorer-toolbar'
import { CategoryRail } from './category-rail'

/** Every scroller overflows: 300px wide, 1000px of content — so each row has more to its right. */
let scrollBy: ReturnType<typeof vi.fn>
beforeEach(() => {
  h.vi = false
  scrollBy = vi.fn()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 300 })
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => 1000 })
  ;(HTMLElement.prototype as unknown as { scrollBy: unknown }).scrollBy = scrollBy
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (HTMLElement.prototype as unknown as { clientWidth?: unknown }).clientWidth
  delete (HTMLElement.prototype as unknown as { scrollWidth?: unknown }).scrollWidth
})

const strip = (sort: Parameters<typeof SortStrip>[0]['sort'], priceLabel: 'price' | 'salary' = 'price') => (
  <SortStrip sort={sort} onPickSort={() => {}} goodPrice={false} onGoodPrice={() => {}} priceLabel={priceLabel} leading={<div data-facet-pills="" />} />
)

describe('NAV-4: the phone "›" is a real button that scrolls its row', () => {
  it('on the sort/filter strip: named "More", a 44px target, and it pages the row by 85% (the desktop arrows\' step)', async () => {
    render(strip('newest'))
    const more = await screen.findByRole('button', { name: 'More' })
    expect(more.className).toContain('tap-44') // the IconButton's 44px hit area around the unchanged 32px disc
    expect(more.className).toContain('sm:hidden')
    expect(more.className).not.toContain('pointer-events-none')
    fireEvent.click(more)
    expect(scrollBy).toHaveBeenCalledWith({ left: 255, behavior: expect.any(String) })
  })

  it('on the category rail too (phones and touch up to pc: `pc:hidden` — on a phone it is the swipe cue since 2026-11-14, owner-approved; the desktop keeps its own arrows)', async () => {
    const cats = [
      { id: 'c1', slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê', icon: 'home', verifiedCount: 5 },
      { id: 'c2', slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử', icon: 'tv', verifiedCount: 5 },
    ] as unknown as SerializedCategory[]
    render(<CategoryRail categories={cats} activeCategory="all" activeSubcategory="all" subcategoryCounts={{}} onCategory={() => {}} onSubcategory={() => {}} />)
    const more = await screen.findByRole('button', { name: 'More' })
    expect(more.className).toContain('pc:hidden')
    expect(more.className).toContain('tap-44')
    fireEvent.click(more)
    await waitFor(() => expect(scrollBy).toHaveBeenCalledWith({ left: 255, behavior: expect.any(String) }))
  })

  it('reads "Xem thêm" in Vietnamese', async () => {
    h.vi = true
    render(strip('newest'))
    expect(await screen.findByRole('button', { name: 'Xem thêm' })).toBeTruthy()
  })
})

describe('NAV-13: the price sort tab names the order it gives', () => {
  const tab = () => screen.getByRole('tab', { name: /price|giá/i })

  it('not sorting by price, or low → high: "Price low → high", spoken "Price: low to high"', () => {
    for (const sort of ['newest', 'price-low'] as const) {
      const view = render(strip(sort))
      expect(tab().textContent).toBe('Price low → high')
      expect(tab().getAttribute('aria-label')).toBe('Price: low to high')
      view.unmount()
    }
  })

  it('after the re-tap flip: "Price high → low"', () => {
    render(strip('price-high'))
    expect(tab().textContent).toBe('Price high → low')
    expect(tab().getAttribute('aria-label')).toBe('Price: high to low')
  })

  it('in Vietnamese, and over jobs as salary', () => {
    h.vi = true
    const view = render(strip('price-low'))
    expect(screen.getByRole('tab', { name: 'Giá: thấp đến cao' }).textContent).toBe('Giá thấp → cao')
    view.unmount()
    render(strip('price-high', 'salary'))
    expect(screen.getByRole('tab', { name: 'Lương: cao đến thấp' }).textContent).toBe('Lương cao → thấp')
  })
})

/**
 * ⛔ THE TEACHERS FEED HAS NO MAP (gate review, 2026-10-09): every row there is a teacher and a teacher is never a pin
 * (map-pin-rows.ts), so the explorer passes `showMap={false}` over it. The default is the old toolbar, button for button
 * — every other feed keeps its Map tab. (The explorer's half: listings-explorer.teachers-map.test.tsx.)
 */
describe('ViewToggles: the Map tab is offered unless the feed has no map', () => {
  const views = () => screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))

  it('by default all four views, in order — what every feed but the teachers\' gets', () => {
    render(<ViewToggles viewMode="grid" onViewMode={() => {}} />)
    expect(views()).toEqual(['List view', 'Grid view', 'Map view', 'Video view'])
  })

  it('`showMap={false}` takes the Map tab away and nothing else (the Video gate still works beside it)', () => {
    const onViewMode = vi.fn()
    const view = render(<ViewToggles viewMode="grid" onViewMode={onViewMode} showMap={false} />)
    expect(views()).toEqual(['List view', 'Grid view', 'Video view'])
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    expect(onViewMode).toHaveBeenCalledWith('compact')
    view.unmount()
    render(<ViewToggles viewMode="grid" onViewMode={() => {}} showMap={false} showVideo={false} />)
    expect(views()).toEqual(['List view', 'Grid view'])
  })
})

/**
 * ⛔ ONE CHIP STYLE ON THE STRIP (owner, 2026-10-18). The strip's pills were flush text that read as a row of bold links
 * on a phone; they are ui/chip-style's PILL_* now — a 36px pill with an invisible 44px hit area (`tap-44`, which
 * needs `relative`): white with a line-strong hairline at rest, the INK FILL once something is applied, the muted fill
 * while open (owner-approved 2026-11-14; the tint and the brand-tint selection before). jsdom has no layout, so the
 * classes are the contract.
 */
const tokens = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/)

describe('the strip\'s pills: 36px, tinted, a 44px hit area', () => {
  it('the phone sort pill rests white with a hairline while the order is Relevance', () => {
    render(strip('newest'))
    const pill = screen.getByRole('combobox', { name: /Sort by/ })
    expect(tokens(pill)).toEqual(expect.arrayContaining(['min-h-9', 'rounded-full', 'px-3.5', 'relative', 'tap-44', 'bg-background', 'border-line-strong', 'data-popup-open:bg-muted']))
    expect(tokens(pill)).not.toContain('min-h-11')
  })

  it('…and takes the ink fill for any other order', () => {
    render(strip('recent'))
    const pill = screen.getByRole('combobox', { name: /Sort by/ })
    expect(tokens(pill)).toEqual(expect.arrayContaining(['pill-on', 'bg-foreground', 'text-background', 'icon-own-ink']))
    expect(tokens(pill)).not.toContain('bg-background')
  })

  it('the phone row leaves the 4px above and below the pills that their hit area needs inside its clip', () => {
    render(strip('newest'))
    const row = screen.getByRole('combobox', { name: /Sort by/ }).closest('[class*="max-sm:overflow-x-auto"]')!
    expect(tokens(row)).toContain('max-sm:py-1')
  })

  it('Good price wears the same pill and keeps its green pressed state', () => {
    render(strip('newest'))
    const good = screen.getByRole('button', { name: 'Good price' })
    expect(tokens(good)).toEqual(expect.arrayContaining(['min-h-9', 'rounded-full', 'relative', 'tap-44', 'bg-background', 'border-line-strong', 'data-pressed:bg-success', 'data-pressed:border-success', 'data-pressed:text-background']))
    expect(tokens(good)).not.toContain('h-[42px]')
  })
})

/**
 * ⛔ THE PHONE'S ONE VIEW SWITCH (owner, 2026-10-18: the results row folded into one compact line). The four icons cost
 * that row a second line; one pill offers the same views behind the same gates, named in full for a screen reader.
 */
describe('ViewSwitch: one pill for every view', () => {
  it('names the current view, rests white whatever is picked, and offers the four views in the toggles\' order', async () => {
    const user = userEvent.setup()
    const onViewMode = vi.fn()
    render(<ViewSwitch viewMode="grid" onViewMode={onViewMode} />)
    const pill = screen.getByRole('combobox', { name: /View/ })
    expect(pill.textContent).toContain('Grid view') // sr-only on screen; the glyph is what shows
    expect(tokens(pill)).toEqual(expect.arrayContaining(['min-h-9', 'rounded-full', 'tap-44', 'bg-background']))
    expect(tokens(pill)).not.toContain('bg-foreground')
    await user.click(pill)
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent)
    expect(options).toEqual(['List view', 'Grid view', 'Map view', 'Video view'])
    await user.click(screen.getByRole('option', { name: 'Map view' }))
    expect(onViewMode).toHaveBeenCalledWith('map')
  })

  it('takes away Map and Video behind the same gates as the toggles', async () => {
    const user = userEvent.setup()
    render(<ViewSwitch viewMode="compact" onViewMode={() => {}} showMap={false} showVideo={false} />)
    await user.click(screen.getByRole('combobox', { name: /View/ }))
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['List view', 'Grid view'])
  })
})

/**
 * ⛔ THE STRIP RUNS THE SCROLL HOOK ITSELF (smooth-01, 2026-11-10). The explorer used to call useHideOnScroll() and pass
 * `headerHidden` down, so every hide/reveal flip re-rendered the whole explorer (395 components at phone 4x on `/`).
 * The strip's own instance now moves it, and tells the explorer's desktop map through `onHeaderHidden`.
 */
describe('SortStrip follows the header on its own', () => {
  let Y = 0
  /** One scroll frame at `y`; rAF runs synchronously here (the hook's own test does the same). */
  const scroll = (y: number) => { Y = y; act(() => { window.dispatchEvent(new Event('scroll')) }) }
  const bar = () => document.getElementById('explorer-toolbar')!
  beforeEach(() => {
    Y = 0
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => Y })
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => 4000 })
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0 })
  })

  it('down parks it above the viewport (back at the inset when focused), up pins it under the header — and each flip is reported', () => {
    const onHeaderHidden = vi.fn()
    render(<SortStrip sort="newest" onPickSort={() => {}} goodPrice={false} onGoodPrice={() => {}} onHeaderHidden={onHeaderHidden} />)
    expect(bar().className).toContain('top-[calc(max(env(safe-area-inset-top),var(--safe-area-inset-top,0px))+3.5rem)]')
    scroll(400) // the first frame only anchors
    scroll(900)
    expect(bar().className).toContain('top-[-9rem]')
    expect(bar().className).toContain('focus-within:top-[max(env(safe-area-inset-top),var(--safe-area-inset-top,0px))]')
    expect(onHeaderHidden).toHaveBeenLastCalledWith(true)
    scroll(600)
    expect(bar().className).toContain('top-[calc(max(env(safe-area-inset-top),var(--safe-area-inset-top,0px))+3.5rem)]')
    expect(onHeaderHidden).toHaveBeenLastCalledWith(false)
  })

  it('the signal the explorer hands it: holds the last flip for a reader that mounts later, and notifies only on a change', () => {
    const signal = createHeaderHiddenSignal()
    const seen = vi.fn()
    const off = signal.subscribe(seen)
    expect(signal.get()).toBe(false)
    signal.set(false)
    expect(seen).not.toHaveBeenCalled()
    signal.set(true)
    expect(signal.get()).toBe(true)
    expect(seen).toHaveBeenCalledTimes(1)
    off()
    signal.set(false)
    expect(seen).toHaveBeenCalledTimes(1)
  })
})

describe('on a tablet the strip is always two lines (UI climb 2026-11-10: a cold category link no longer drops a line under its results)', () => {
  it('the pills take their own line from sm to lg, on every feed; only from lg may the tabs sit beside them', () => {
    const { container } = render(strip('newest'))
    const lead = container.querySelector('[data-facet-pills]')!.parentElement!
    expect(lead.className.split(' ')).toEqual(expect.arrayContaining(['basis-full', 'lg:flex-1', 'lg:basis-auto']))
    // ⚠️ a `sm:` flex-1/basis-auto would let the home's seed and a category's answer wrap differently again
    expect(lead.className).not.toMatch(/(^|\s)(sm|md):(flex-1|basis-auto)(\s|$)/)
  })
})
