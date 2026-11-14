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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
import { SortStrip, ViewPickReserve, ViewSwitch, ViewToggles, createHeaderHiddenSignal } from './explorer-toolbar'
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
 * ⛔ THE RENTALS FEED'S MAP FLOATS ON A PHONE (owner-approved 2026-11-15 (build 8), cook r08 rentals — map-float.ts; ViewToggles
 * `floatMap`): the same four buttons, the same order and names; below sm every one but Map steps down (its host box is
 * `display: contents` there), and Map carries the float look and its name in words — the aria-label's own. Without the prop
 * nothing changes.
 */
describe('ViewToggles `floatMap`: the phone\'s Map toggle is the floating pill', () => {
  const tokens = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/)

  it('the same buttons; every one but Map max-sm:hidden; Map wears MAP_FLOAT and shows its name only while floated', async () => {
    const { MAP_FLOAT, MAP_FLOAT_LABEL } = await import('./map-float')
    const onViewMode = vi.fn()
    render(<ViewToggles viewMode="grid" onViewMode={onViewMode} floatMap />)
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['List view', 'Grid view', 'Map view', 'Video view'])
    for (const name of ['List view', 'Grid view', 'Video view']) expect(tokens(screen.getByRole('button', { name }))).toContain('max-sm:hidden')
    const map = screen.getByRole('button', { name: 'Map view' })
    expect(tokens(map)).toEqual(expect.arrayContaining(['max-sm:hidden', ...MAP_FLOAT.split(' ')]))
    const label = map.querySelector('span')!
    expect(label.textContent).toBe('Map view')
    expect(label.getAttribute('class')).toBe(MAP_FLOAT_LABEL)
    fireEvent.click(map)
    expect(onViewMode).toHaveBeenCalledWith('map')
  })

  it('without it: no float class, no label, no phone-off on any toggle', async () => {
    const { MAP_FLOAT } = await import('./map-float')
    render(<ViewToggles viewMode="grid" onViewMode={() => {}} />)
    for (const b of screen.getAllByRole('button')) {
      expect(tokens(b)).not.toContain('max-sm:hidden')
      for (const t of MAP_FLOAT.split(' ')) expect(tokens(b)).not.toContain(t)
    }
    expect(screen.getByRole('button', { name: 'Map view' }).querySelector('span')).toBeNull()
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

  /**
   * ⛔ `stayPinned` — the rentals feed's phone row (owner-approved 2026-11-14, cook r06 rentals-a; listings-explorer.tsx `rentalsWide`):
   * below sm it pins at the safe-area top while the header is hidden, and it is opaque there. From sm (and without the prop) the
   * 08-12 rule above holds: the classes it adds are all `max-sm:`.
   */
  it('stayPinned: below sm the row stays at the safe-area top with the header hidden, opaque; nothing changes from sm', () => {
    const { rerender } = render(<SortStrip sort="newest" onPickSort={() => {}} goodPrice={false} onGoodPrice={() => {}} stayPinned />)
    expect(bar().getAttribute('data-stay-pinned')).toBe('true')
    expect(bar().className.split(/\s+/)).toEqual(expect.arrayContaining(['max-sm:bg-background', 'max-sm:backdrop-blur-none', 'material', 'material-bar']))
    scroll(400)
    scroll(900)
    const cls = bar().className.split(/\s+/)
    expect(cls).toEqual(expect.arrayContaining(['top-[-9rem]', 'max-sm:top-[max(env(safe-area-inset-top),var(--safe-area-inset-top,0px))]']))
    rerender(<SortStrip sort="newest" onPickSort={() => {}} goodPrice={false} onGoodPrice={() => {}} />)
    expect(bar().hasAttribute('data-stay-pinned')).toBe(false)
    expect(bar().className).not.toMatch(/max-sm:(?:top-|bg-background|backdrop-blur-none)/)
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

/**
 * ⛔ THE GOODS SEARCH'S STRIP ON A PHONE (owner-approved 2026-11-14, cook r06 goods: "after this cook round build all best options
 * and deploy"): `look="goods"` — opaque, no rule under it (transparent, never removed) while it sits in place — and `phoneScope`,
 * the scope chip, first of all in the row. Since build 8 (owner-approved 2026-11-15, cook r08 goods): the pill prints its order
 * ("Relevance") where it said "Sort", the pills are filled (`data-pills`), and the strip stays pinned with its hairline back once
 * stuck (explorer-toolbar.goods-pinned.test.tsx).
 */
describe('SortStrip look="goods" and phoneScope', () => {
  const goodsStrip = (sort: Parameters<typeof SortStrip>[0]['sort'], extra: Partial<Parameters<typeof SortStrip>[0]> = {}) => (
    <SortStrip sort={sort} onPickSort={() => {}} goodPrice={false} onGoodPrice={() => {}} look="goods" leading={<div data-facet-pills="" />} {...extra} />
  )

  it('below sm the bar is the page\'s white with no blur, and its hairline goes transparent but keeps its 1px', () => {
    const { container } = render(goodsStrip('newest'))
    const bar = container.querySelector('#explorer-toolbar')!
    expect(tokens(bar)).toEqual(expect.arrayContaining(['max-sm:bg-background', 'max-sm:backdrop-blur-none']))
    const rule = bar.querySelector('.border-b')!
    expect(tokens(rule)).toEqual(expect.arrayContaining(['border-b', 'border-border', 'max-sm:border-b-transparent']))
    expect(tokens(rule)).not.toContain('border-b-0')
  })

  it('⛔ at the default order the sort pill prints its state, "Relevance", with no ⇅ and no "Sort" (build 8, owner-approved 2026-11-15, cook r08 goods); a price order keeps its arrow', () => {
    render(goodsStrip('newest'))
    const pill = screen.getByRole('combobox', { name: /Sort by/ })
    expect(pill.textContent).toBe('Relevance')
    // The order's name is the pill's visible label — the one it carried for a screen reader — not an sr-only copy.
    const label = [...pill.querySelectorAll('span')].find((e) => e.textContent === 'Relevance')!
    expect(tokens(label)).not.toContain('sr-only')
    expect(pill.querySelector('.sort-word-default')).toBeNull()
    expect(pill.querySelectorAll('svg').length).toBe(1) // the ⌄ alone
    cleanup()
    render(goodsStrip('price-low'))
    expect(screen.getByRole('combobox', { name: /Sort by/ }).querySelectorAll('svg').length).toBe(2) // ↑ and ⌄
  })

  it('without the look the strip is as it was: the frosted bar, its rule, the ⇅ and "Sort" — marked for the cold goods link\'s first frame', () => {
    const { container } = render(strip('newest'))
    const bar = container.querySelector('#explorer-toolbar')!
    expect(tokens(bar)).not.toContain('max-sm:bg-background')
    expect(bar.hasAttribute('data-pills')).toBe(false)
    expect(tokens(bar.querySelector('.border-b')!)).not.toContain('max-sm:border-b-transparent')
    const pill = screen.getByRole('combobox', { name: /Sort by/ })
    expect(pill.querySelectorAll('svg').length).toBe(2)
    // "Sort" shown, "Relevance" sr-only — each marked, so globals.css can paint a cold goods link's seed as the goods pill.
    expect(pill.querySelector('.sort-word-default')!.textContent).toBe('Sort')
    expect(tokens(pill.querySelector('.sort-label-default')!)).toEqual(expect.arrayContaining(['sr-only', 'truncate']))
    expect(pill.querySelector('.sort-label-default')!.textContent).toBe('Relevance')
  })

  it('⛔ the goods strip says its pills are filled (build 8, owner-approved 2026-11-15, cook r08 goods; globals.css paints them)', () => {
    const { container } = render(goodsStrip('newest'))
    expect(container.querySelector('#explorer-toolbar')!.getAttribute('data-pills')).toBe('filled')
    // Every resting pill carries the marker the rule keys on; an applied one does not.
    expect(tokens(screen.getByRole('combobox', { name: /Sort by/ }))).toContain('pill-rest')
    expect(tokens(screen.getByRole('button', { name: 'Good price' }))).toContain('pill-rest')
    cleanup()
    render(goodsStrip('recent'))
    expect(tokens(screen.getByRole('combobox', { name: /Sort by/ }))).not.toContain('pill-rest')
  })

  it('globals.css: the filled look below 40rem — field grey, no edge, a step deeper pressed or open — in the goods strips and a cold goods link\'s seed only', () => {
    const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8')
    const at = css.indexOf('#explorer-toolbar[data-pills="filled"]')
    expect(at).toBeGreaterThan(0)
    const block = css.slice(css.lastIndexOf('@media', at), css.indexOf('@media (width < 40rem) and (hover: hover)', at))
    expect(block.startsWith('@media (width < 40rem)')).toBe(true)
    expect(block).toContain(':is(#explorer-toolbar[data-pills="filled"], [data-pinned-strip][data-pills="filled"]) .pill-rest:not([data-pressed])')
    expect(block).toMatch(/border-color: transparent;\s*background-color: var\(--muted\);/)
    expect(block).toMatch(/\.pill-rest\[data-popup-open\], \.pill-open[^{]*\{\s*border-color: transparent;\s*background-color: var\(--secondary\);/)
    // A pressed toggle (Good price's green) is never repainted.
    expect(block).not.toMatch(/\.pill-rest(?!:not\(\[data-pressed\]\))(?![\[]data-popup-open)[ ,{:]/)
  })

  it('phoneScope is the row\'s FIRST item, before the applied chips and the sort pill (DOM order = visual order)', () => {
    render(goodsStrip('newest', { phoneScope: <button type="button" data-scope="" aria-label="All categories" />, phoneLead: <span data-lead="" /> }))
    const scope = document.querySelector('[data-scope]')!
    const row = scope.parentElement!
    expect(row.firstElementChild).toBe(scope)
    expect(scope.nextElementSibling!.hasAttribute('data-lead')).toBe(true)
    const sort = screen.getByRole('combobox', { name: /Sort by/ })
    expect(scope.compareDocumentPosition(sort) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('⛔ phoneView leads the row, before phoneScope (owner-approved 2026-11-15 (build 7), cook r07 goods): view · All categories · Sort', () => {
    render(goodsStrip('newest', {
      phoneView: <ViewSwitch viewMode="grid" onViewMode={() => {}} variant="circle" />,
      phoneScope: <button type="button" data-scope="" aria-label="All categories" />,
      phoneLead: <span data-lead="" />,
    }))
    const view = screen.getByRole('combobox', { name: /View/ })
    const scope = document.querySelector('[data-scope]')!
    const row = scope.parentElement!
    // The view circle's CustomSelect wrapper is the row's first item, the scope chip right after it.
    expect(row.firstElementChild!.contains(view)).toBe(true)
    expect(row.firstElementChild!.nextElementSibling).toBe(scope)
    expect(scope.nextElementSibling!.hasAttribute('data-lead')).toBe(true)
    expect(view.compareDocumentPosition(screen.getByRole('combobox', { name: /Sort by/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('ViewPickReserve (the view circle\'s place on a cold link, build 7)', () => {
  it('an invisible 36px box: a span, aria-hidden, never focusable, display:none unless the cold-link rule shows it', () => {
    const { container } = render(<ViewPickReserve />)
    const reserve = container.firstElementChild!
    expect(reserve.tagName).toBe('SPAN')
    expect(reserve.getAttribute('aria-hidden')).toBe('true')
    expect(reserve.getAttribute('tabindex')).toBeNull()
    expect(tokens(reserve).sort()).toEqual(['shrink-0', 'size-9', 'view-pick-reserve'])
  })

  it('globals.css hides it, and shows it (invisible) exactly where the scope chip\'s reserve shows', () => {
    const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8')
    expect(css).toMatch(/\.scope-chip-reserve,\s*\.view-pick-reserve \{\s*display: none;/)
    // The shown rule's selector list: from the brace that opens its @media block to `.view-pick-reserve {` (string search —
    // a backtracking regex over the whole stylesheet ran past the test timeout under a parallel run).
    const end = css.search(/\.view-pick-reserve \{\s*display: inline-flex;\s*visibility: hidden;/)
    expect(end).toBeGreaterThan(0)
    const shown = css.slice(css.lastIndexOf('{', end) + 1, end + '.view-pick-reserve'.length)
    // Two selectors, one per reserve, the same condition (the `:is(…)` list holds commas of its own, so split before `html`).
    const sel = shown.split(/,\s*(?=html)/).map((x) => x.trim())
    expect(sel).toHaveLength(2)
    expect(sel[0]).toMatch(/ \.scope-chip-reserve$/)
    expect(sel[0].replace('.scope-chip-reserve', '.view-pick-reserve')).toBe(sel[1])
  })
})

describe('ViewSwitch variant="circle" (the goods search\'s view pick, owner-approved 2026-11-14; the control row\'s first chip since build 7)', () => {
  it('a 36px round chip with the view\'s 20px glyph and no chevron — the same select, the same name and options', async () => {
    const user = userEvent.setup()
    render(<ViewSwitch viewMode="grid" onViewMode={() => {}} variant="circle" />)
    const pill = screen.getByRole('combobox', { name: /View/ })
    expect(tokens(pill)).toEqual(expect.arrayContaining(['size-9', 'rounded-full', 'tap-44', 'justify-center', 'bg-background', 'border-line-strong']))
    expect(pill.textContent).toContain('Grid view')
    expect(pill.querySelectorAll('svg').length).toBe(1)
    expect(pill.querySelector('svg')!.getAttribute('class')).toContain('size-5')
    await user.click(pill)
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['List view', 'Grid view', 'Map view', 'Video view'])
  })
})
