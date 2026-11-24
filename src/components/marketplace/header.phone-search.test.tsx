// @vitest-environment jsdom
/**
 * ⛔ O-03 G-SEARCH OPTION A (owner, 2026-09-30): BELOW 640px ✨ AND MAP LEAVE THE IDLE PILL AND BECOME THE
 * FOCUS PANEL'S FIRST TWO ROWS; desktop is unchanged.
 *
 * Pinned here through the REAL Header (same harness as header.focusout.test.tsx):
 *   · the pill's own ✨ / Map carry `hidden sm:flex` — CSS, so the server HTML is already right on a phone;
 *   · on a phone the panel opens on the first focus even with NO history and trending not yet landed,
 *     and its first two rows are "Ask eno AI" then "Browse on the map", each doing what the pill button did;
 *   · off a phone, nothing changes: no history, no trending → no panel.
 * ⚠️ `fetch` never answers here, so nothing but the phone rows can be what opened the panel.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const push = vi.fn()
  const router = { push, prefetch: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }
  // English unless a test switches `language.lang` (reset in beforeEach): a Vietnamese test reads the Vietnamese copy.
  const language = { lang: 'en' as string, t: (k: string) => k, tr: (en: string, vi?: string) => (language.lang === 'vi' && vi ? vi : en), setLang: () => {} }
  const auth = { user: null, profile: null, loading: false, openSignIn: () => {} }
  const phone = { value: true }
  const pathname = { value: '/help' }
  const hidden = { value: false }
  return { push, router, language, auth, phone, pathname, hidden }
})

vi.mock('next/navigation', () => ({
  useRouter: () => h.router,
  usePathname: () => h.pathname.value,
  useSearchParams: () => new URLSearchParams(window.location.search),
}))
// The typeahead listbox is a code-split chunk and is not under test here (search-suggest.test.tsx).
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => h.language,
  useTr: (s: string) => s,
  Tr: ({ text }: { text?: string | null }) => <>{text}</>,
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => h.auth, preloadSignIn: () => {} }))
vi.mock('./account-panel', () => ({ useAccountPanel: () => ({ open: false }) }))
vi.mock('@/lib/safe-back', () => ({ useSafeBack: () => () => {} }))
vi.mock('./notification-bell', () => ({ NotificationBell: ({ quiet }: { quiet?: boolean }) => <button type="button" aria-label="Notifications" data-quiet={quiet ? '' : undefined} /> }))
vi.mock('./app-download', () => ({ AppDownload: () => null }))
// The header's own slide, held still unless a test asks for it (the real hook only moves on scroll, which nothing here does).
vi.mock('@/hooks/use-hide-on-scroll', () => ({ useHideOnScroll: () => h.hidden.value }))
vi.mock('@/hooks/use-is-phone', () => ({ useIsPhone: () => h.phone.value }))
// The header's classes on the ✨ ride through (the real button merges them onto its own), so the phone look is pinned here.
vi.mock('./ai-concierge', () => ({
  AISearchButton: ({ className, active }: { className?: string; active?: boolean }) => <button type="button" aria-label="AI" className={className} aria-current={active ? 'page' : undefined} />,
  GuideMark: () => null,
}))

import { Header } from './header'
import { setHeaderPinned } from '@/hooks/use-header-pin'
import { setConciergeAvailable } from '@/lib/concierge/client'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => { map.clear() },
  } as Storage
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  h.push.mockClear()
  h.phone.value = true
  h.pathname.value = '/help'
  h.hidden.value = false
  h.language.lang = 'en'
})
afterEach(() => {
  cleanup()
  act(() => setHeaderPinned(false))
  vi.unstubAllGlobals()
})

const field = () => screen.getByRole('combobox') as HTMLInputElement
const panel = () => document.querySelector('#app-header form div.overflow-y-auto')

// ⛔ A landing whose category has no map opens the MARKETPLACE map (map-pin-rows.ts categoryHasMap, gate review, 2026-10-09).
describe('Map off the explorer', () => {
  it('from /c/teachers it opens the unfiltered map — the teachers map is always empty; /c/rentals keeps its own', () => {
    h.pathname.value = '/c/teachers'
    const { unmount } = render(<Header />)
    fireEvent.click(screen.getByRole('button', { name: 'Map' }))
    expect(h.push).toHaveBeenLastCalledWith('/?view=map')
    unmount()
    h.pathname.value = '/c/rentals'
    render(<Header />)
    fireEvent.click(screen.getByRole('button', { name: 'Map' }))
    expect(h.push).toHaveBeenLastCalledWith('/?category=rentals&view=map')
  })
})

describe('O-03: ✨ and Map on a phone', () => {
  it('the pill\'s Map button is `hidden sm:flex` — gone below 640px from the first byte, unchanged above', () => {
    render(<Header />)
    const map = screen.getByRole('button', { name: 'Map' })
    expect(map.className).toMatch(/(^|\s)hidden(\s|$)/)
    expect(map.className).toMatch(/(^|\s)sm:flex(\s|$)/)
  })

  it('focus opens the panel with "Ask eno AI" then "Browse on the map" as its FIRST two rows — no history needed', async () => {
    render(<Header />)
    act(() => field().focus())
    await waitFor(() => expect(panel()).not.toBeNull())
    const rows = [...panel()!.querySelectorAll('button, a')].map((b) => b.textContent?.trim())
    expect(rows.slice(0, 2)).toEqual(['Ask eno AI', 'Browse on the map'])
    // Phone-only in CSS too, so a narrow-then-wide desktop window never keeps them.
    expect(panel()!.querySelector('ul[aria-label="Other ways to search"]')!.className).toContain('sm:hidden')
  })

  it('the rows do what the pill buttons did: AI opens the concierge, Map the map view', async () => {
    render(<Header />)
    act(() => field().focus())
    await waitFor(() => expect(panel()).not.toBeNull())
    // The host has decided (no guide for this account): askForHelp answers at once with the text assistant.
    setConciergeAvailable(false)
    fireEvent.click(screen.getByRole('button', { name: 'Ask eno AI' }))
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/messages/ai'))
    await waitFor(() => expect(panel()).toBeNull())
    act(() => field().blur())
    act(() => field().focus())
    await waitFor(() => expect(panel()).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Browse on the map' }))
    expect(h.push).toHaveBeenLastCalledWith(expect.stringContaining('view=map'))
  })

  it('off a phone nothing changed: no history and no trending → no panel, no rows', async () => {
    h.phone.value = false
    render(<Header />)
    act(() => field().focus())
    await new Promise((r) => setTimeout(r, 50))
    expect(panel()).toBeNull()
  })
})

/**
 * ⛔ THE FIXED PHONE PANEL HANGS FROM THE HEADER'S MEASURED BOTTOM (2026-10-01 review). With a strip in flow
 * above the sticky header (the Terms-amendment notice), the header starts at y≈N at scroll-top, and a panel
 * pinned at the constant y=60 covered the header's own search field. jsdom has no layout, so the header's
 * rect is stubbed: the contract is "top = header bottom − 4, re-measured on scroll", with the old constant
 * kept as the CSS fallback.
 */
describe('the phone panel follows the header, wherever the header is', () => {
  it('publishes the header bottom − 4 as --search-panel-top, and re-measures on scroll', async () => {
    // The header is 56px since 2026-10-18 (owner: "slimmer + calm" — header.tsx `h-14`).
    let bottom = 122 // a 66px notice above a 56px header, at scroll-top
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { top: bottom - 56, bottom, left: 0, right: 390, width: 390, height: 56, x: 0, y: bottom - 56, toJSON: () => ({}) } as DOMRect
    })
    try {
      render(<Header />)
      act(() => field().focus())
      await waitFor(() => expect(panel()).not.toBeNull())
      const win = panel() as HTMLElement
      expect(win.style.getPropertyValue('--search-panel-top')).toBe('118px')
      // The class reads the variable, with the 56px bar's constant (56 − 4 = 52px = 3.25rem) as its fallback — top
      // AND the height cap.
      expect(win.className).toContain('top-[var(--search-panel-top,calc(env(safe-area-inset-top)+3.25rem))]')
      expect(win.className).toContain('-var(--search-panel-top,calc(env(safe-area-inset-top)+3.25rem))-0.75rem')
      // Scrolled past the strip: the sticky header is at y=0 again, and the panel follows it up.
      bottom = 56
      await act(async () => {
        window.dispatchEvent(new Event('scroll'))
        await new Promise((r) => requestAnimationFrame(() => r(null)))
      })
      expect(win.style.getPropertyValue('--search-panel-top')).toBe('52px')
    } finally {
      rect.mockRestore()
    }
  })
})

/**
 * ⛔ "SLIMMER + CALM" (owner, 2026-10-18): a 56px bar and no glow. A 40px logo mark matches the 40px field beside it (the
 * owner's 2026-08-02 rule) — from sm the 40px tint pill, and ON A PHONE SINCE ROUND 13 (owner, 2026-11-17: "mobile top search
 * bar is not in harmony with logo on left lets make sure it looks part of app") a 40px grey tile of the mark's shape, painted by
 * `search-tile` inside the field's 44px tap box. It reverses r05's 44px round, white, raised pill beside a 36px mark
 * (owner-approved 2026-11-14). jsdom has no layout, so the classes that make the geometry are what is pinned; the tile's own
 * paint is pinned from globals.css below, and its contrast in src/lib/tokens-contrast.test.ts.
 */
describe('the header bar: 56px, no glow; a 40px logo beside a 40px field at every width', () => {
  it('h-14 bar, a 40px logo at every width, a py-2 field that keeps text-base (iOS zooms under 16px)', () => {
    render(<Header />)
    const header = document.getElementById('app-header')!
    const bar = header.querySelector(':scope > div') as HTMLElement
    expect(bar.className.split(/\s+/)).toContain('h-14')
    expect(bar.className.split(/\s+/)).not.toContain('h-16')
    const logo = header.querySelector('[data-header-logo] img') as HTMLImageElement
    expect(logo.className.split(/\s+/)).toEqual(['h-10', 'w-10'])
    const input = field().className.split(/\s+/)
    expect(input).toEqual(expect.arrayContaining(['py-2', 'text-base']))
    expect(input).not.toContain('py-3')
  })

  it('the idle field: a 44px tap box wearing the search tile on a phone — no rim, no lift, no pill; the bare tint from sm; never a search-beam', () => {
    render(<Header />)
    const pill = field().closest('form')!.querySelector('div.relative.z-50') as HTMLElement
    const cls = pill.className.split(/\s+/)
    expect(cls).toEqual(expect.arrayContaining(['max-sm:h-11', 'max-sm:search-tile', 'sm:rounded-2xl', 'sm:bg-tint']))
    expect(cls).not.toContain('search-beam')
    // r05's pill and build 8's are gone: no round shape, rim, fill or lift of its own below sm (the tile paints itself).
    expect(cls.filter((c) => /^max-sm:(rounded|border|bg|shadow|ring)/.test(c))).toEqual([])
    expect(cls).not.toContain('max-sm:h-11.5')
    // From sm the idle pill is still bare tint (owner, 2026-10-18): no edge or lift at any width.
    expect(cls.some((c) => /^(ring|border|shadow)(-|$)/.test(c))).toBe(false)
    expect(cls.some((c) => /^sm:(ring|border|shadow)/.test(c))).toBe(false)
  })

  it('the tile (globals.css `search-tile`): 2px inside the 44px box, the 8px tier, flat grey (dark one step up), a transparent 1px edge for forced colours; a 2px ring while focused; the whole 44px box only while the phone search is open', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
    const start = css.indexOf('@utility search-tile {')
    expect(start).toBeGreaterThan(-1)
    const tile = css.slice(start, css.indexOf('\n}', start)).replace(/\s+/g, ' ')
    expect(tile).toContain('isolation: isolate;')
    expect(tile).toMatch(/&::before \{ content: ''; position: absolute; inset: 2px 0; z-index: -1; border: 1px solid transparent; border-radius: 9999px; background-color: var\(--tint\); pointer-events: none; \}/)
    expect(tile).toContain('&:is(.dark *)::before { background-color: var(--secondary); }')
    // The ring follows focus; the 44px fill follows the OPEN phone search (`data-search-open`), never focus — a submitted search
    // closes the panel and keeps the field focused, and a focus-keyed 44px tile sat beside the 40px mark (review, 2026-11-17).
    // Open, the Clear ✕'s 34px ring keeps 5px of grey all round (measured at 3x, 320/390/412, both themes).
    expect(tile).toContain('&:has(input:focus-visible)::before { outline: 2px solid var(--ring); }')
    expect(tile).toContain('&[data-search-open]::before { inset: 0; }')
    expect(tile).not.toMatch(/focus-visible\)::before \{[^}]*inset/)
    // Flat: no lift and no ring at rest — the only outline is the focus one.
    expect(tile).not.toMatch(/box-shadow|search-edge/)
    expect(tile.match(/outline/g)).toHaveLength(1)
    expect(css).toMatch(/--radius-lg: 6px;/)
  })
})

/**
 * ⛔ ROUND 13 (owner, 2026-11-17; hub round 13): ONE PHONE HEADER ON EVERY ROUTE. The field's two ends are 40px squares — the
 * magnifier at the left (a label for the input, so its square types too), the ✨ flush at the right — and everything inside is
 * one muted grey until typed; the empty field says the one word ("Search" / "Tìm kiếm", the field's aria-label), left, where
 * typed text starts. Build 8's home-only phone pill (owner-approved 2026-11-15 — 46px, `shadow-search`, a centred bold ink
 * label beside its own magnifier, the ✨ muted on home only) is gone; what build 8 kept for the home route is the bar that
 * stays put over the lanes with no hairline (use-header-pin.ts), still pinned below — AND ITS QUIET BELL: round 13 did not
 * touch the bell, so it still follows the route (`quiet={homeRoute}`: build 8's 22px muted bell on home, r05's 24px ink bell
 * elsewhere), its row overhanging the gutter by 11px / 10px so either glyph's paint keeps the mark's 12px edge.
 */
describe('round 13: the phone header is the same on every route', () => {
  const pill = () => field().closest('form')!.querySelector('div.relative.z-50') as HTMLElement
  const tokens = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/)
  const hairline = () => document.querySelector('#app-header > div > span[aria-hidden].absolute')!
  const lead = () => pill().querySelector(':scope > label[data-search-lead]') as HTMLLabelElement
  const overlay = () => document.querySelector('[data-search-placeholder]')!
  const ai = () => screen.getByRole('button', { name: 'AI' })
  const bell = () => screen.getByRole('button', { name: 'Notifications' })
  const actions = () => bell().closest('div.shrink-0')!
  // Everything a route could change but the bell's row (the bell follows the route — its own test below), as one picture.
  const look = () => ({
    pill: tokens(pill()),
    lead: tokens(lead()),
    glyph: tokens(lead().querySelector('svg')),
    input: tokens(field()),
    overlay: tokens(overlay()),
    long: tokens(overlay().querySelector('[data-rung="long"]')),
    short: tokens(overlay().querySelector('[data-rung="short"]')),
    ai: tokens(ai()),
    logo: tokens(document.querySelector('[data-header-logo] img')),
  })

  it('parity: the home route and every other route render the phone search field class for class', () => {
    const at = (path: string) => {
      h.pathname.value = path
      const { unmount } = render(<Header />)
      const l = look()
      unmount()
      return l
    }
    const home = at('/')
    for (const path of ['/help', '/c/rentals', '/listings/abc', '/vi']) expect(at(path), path).toEqual(home)
  })

  it('the magnifier: a full-height label for the input, its glyph centred in the left 40px square and muted below sm', () => {
    render(<Header />)
    expect(lead().htmlFor).toBe(field().id)
    expect(tokens(lead())).toEqual(expect.arrayContaining(['self-stretch', 'shrink-0', 'pl-3.5', 'max-sm:pl-2.5']))
    expect(tokens(lead().querySelector('svg'))).toEqual(expect.arrayContaining(['h-5', 'w-5', 'pointer-events-none', 'text-foreground', 'max-sm:text-muted-foreground']))
    // A tap on the magnifier's square reaches the input (label activation; a browser also focuses it there, which jsdom does
    // not model — measured in Chromium: a tap at x 75 focuses #header-search-input).
    const reached = vi.fn()
    field().addEventListener('click', reached)
    fireEvent.click(lead())
    expect(reached).toHaveBeenCalledTimes(1)
    // Always there: build 8's `--lead-glyph` step-out is gone.
    expect(look().pill.some((c) => c.includes('lead-glyph') || c.includes('placeholder-shown'))).toBe(false)
    expect(tokens(lead().querySelector('svg')).some((c) => c.includes('visibility'))).toBe(false)
  })

  it('the empty field says the one word, left, where typed text starts, 16px regular muted — no centred label, no second magnifier', () => {
    render(<Header />)
    const o = tokens(overlay())
    expect(o).toEqual(expect.arrayContaining(['left-2', 'max-sm:left-2.5', 'max-sm:text-base', 'text-t-card', 'text-muted-foreground', 'peer-placeholder-shown:@min-[4.55em]/q:flex']))
    for (const gone of ['max-sm:justify-center', 'max-sm:font-bold', 'max-sm:text-foreground', 'max-sm:left-0', 'max-sm:peer-placeholder-shown:flex']) expect(o).not.toContain(gone)
    expect(overlay().querySelector('svg')).toBeNull()
    // The overlay's left edge is the typed text's: the input's left padding below sm is the same 10px.
    expect(tokens(field())).toEqual(expect.arrayContaining(['pl-2', 'max-sm:pl-2.5']))
    // The long rung waits for sm on every route; below sm the short rung is the label, and it is the field's own name.
    expect(look().long).toEqual(expect.arrayContaining(['hidden', 'sm:@min-[8.6em]/q:block']))
    expect(look().long).not.toContain('@min-[8.6em]/q:block')
    expect(look().short).toContain('sm:@min-[8.6em]/q:hidden')
    expect(overlay().querySelector('[data-rung="short"]')!.textContent).toBe(field().getAttribute('aria-label'))
  })

  it('in Vietnamese the one word is "Tìm kiếm", on its own measured thresholds', () => {
    h.language.lang = 'vi'
    h.pathname.value = '/'
    render(<Header />)
    expect(tokens(overlay())).toContain('peer-placeholder-shown:@min-[5.55em]/q:flex')
    expect(look().long).toEqual(expect.arrayContaining(['hidden', 'sm:@min-[8.7em]/q:block']))
    expect(look().short).toContain('sm:@min-[8.7em]/q:hidden')
    const short = overlay().querySelector('[data-rung="short"]')!
    expect(short.textContent).toBe('Tìm kiếm')
    expect(short.textContent).toBe(field().getAttribute('aria-label'))
  })

  it('the nine machine-translated languages keep their ladder: the long copy only, from 15em', () => {
    h.language.lang = 'fr'
    render(<Header />)
    expect(tokens(overlay())).toContain('peer-placeholder-shown:@min-[15em]/q:flex')
    expect(look().long).toContain('block')
    expect(look().long).not.toContain('hidden')
    expect(look().short).toContain('hidden')
  })

  it('the ✨: muted below sm on every route, flush to the tile\'s right end; ink from sm; the accent (and no override) on /messages/ai', () => {
    render(<Header />)
    expect(look().ai).toEqual(expect.arrayContaining(['h-10', 'w-10', 'tap-48', 'relative', 'ml-2', 'mr-2', 'max-sm:ml-1', 'max-sm:mr-0', 'text-foreground', 'max-sm:text-muted-foreground']))
    cleanup()
    h.pathname.value = '/messages/ai'
    render(<Header />)
    expect(ai().getAttribute('aria-current')).toBe('page')
    expect(look().ai.some((c) => /^(max-sm:)?text-/.test(c))).toBe(false)
    expect(look().ai).toEqual(expect.arrayContaining(['max-sm:ml-1', 'max-sm:mr-0']))
  })

  // ⛔ KEEP r05's BELL (owner-approved 2026-11-14) AND build 8's QUIET ONE ON HOME (2026-11-15): `quiet={homeRoute}`.
  it('the bell: quiet on the home route only (r05\'s ink bell elsewhere), its row overhanging the gutter by 11px / 10px below sm', () => {
    const overhang = (cls: string[]) => cls.filter((c) => /^max-sm:-?m[rx]-/.test(c))
    for (const path of ['/', '/vi']) {
      h.pathname.value = path
      const { unmount } = render(<Header />)
      expect(bell().hasAttribute('data-quiet'), path).toBe(true)
      expect(overhang(tokens(actions())), path).toEqual(['max-sm:-mr-[11px]'])
      unmount()
    }
    for (const path of ['/help', '/c/rentals', '/c/phones', '/listings/abc', '/messages/ai']) {
      h.pathname.value = path
      const { unmount } = render(<Header />)
      expect(bell().hasAttribute('data-quiet'), path).toBe(false)
      expect(overhang(tokens(actions())), path).toEqual(['max-sm:-mr-2.5'])
      unmount()
    }
  })

  it('the bell\'s row overhang is phone-only: from sm the row sits inside the bar\'s gutter on every route', () => {
    for (const path of ['/', '/help']) {
      h.pathname.value = path
      const { unmount } = render(<Header />)
      expect(tokens(actions()).filter((c) => /(^|:)-m[rx]-/.test(c) && !c.startsWith('max-sm:')), path).toEqual([])
      unmount()
    }
  })

  it('pinned by the home lanes: the bar does not slide away below sm (it still does from sm), and draws no hairline', () => {
    h.pathname.value = '/'
    h.hidden.value = true
    const { rerender } = render(<Header />)
    const header = document.getElementById('app-header')!
    // Not pinned (a directed feed on /): it slides on every width, and its hairline is there.
    expect(tokens(header)).toEqual(expect.arrayContaining(['-translate-y-full', 'opacity-0']))
    expect(tokens(header)).not.toContain('max-sm:translate-y-0')
    expect(tokens(hairline())).not.toContain('max-sm:hidden')
    act(() => setHeaderPinned(true))
    rerender(<Header />)
    expect(tokens(header)).toEqual(expect.arrayContaining(['-translate-y-full', 'opacity-0', 'max-sm:translate-y-0', 'max-sm:opacity-100']))
    expect(tokens(hairline())).toContain('max-sm:hidden')
    act(() => setHeaderPinned(false))
    expect(tokens(header)).not.toContain('max-sm:translate-y-0')
  })

  it('the home route\'s server HTML already leaves the hairline out (the explorer cannot say yet); other routes keep it', async () => {
    const { renderToString } = await import('react-dom/server')
    const line = (path: string) => {
      h.pathname.value = path
      const box = document.createElement('div')
      box.innerHTML = renderToString(<Header />)
      return tokens(box.querySelector('#app-header > div > span[aria-hidden].absolute'))
    }
    expect(line('/')).toContain('max-sm:hidden')
    expect(line('/help')).not.toContain('max-sm:hidden')
  })
})

// ⛔ The open phone search is the whole screen (owner, 2026-11-15: "search pill on mobile is not good").
describe('the open phone search is the whole screen', () => {
  const tokens = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/)
  const pill = () => field().closest('form')!.querySelector('div.relative.z-50') as HTMLElement

  it('open on /: Back + the same grey tile, left-aligned; logo and actions step out; the window fills the screen; the page is held', async () => {
    h.pathname.value = '/'
    const main = document.body.appendChild(Object.assign(document.createElement('main'), { id: 'main' }))
    const { unmount } = render(<Header />)
    act(() => field().focus())
    await waitFor(() => expect(panel()).not.toBeNull())
    expect(tokens(document.getElementById('app-header'))).toContain('max-sm:z-overlay')
    expect(tokens(document.querySelector('[data-header-logo]'))).toContain('max-sm:hidden')
    expect(tokens(screen.getByRole('button', { name: 'Notifications' }).closest('div.shrink-0'))).toContain('max-sm:hidden')
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy()
    // Back takes the magnifier's square; the tile is the same 40px grey tile open as closed (its focus ring is CSS).
    expect(pill().querySelector(':scope > label[data-search-lead]')).toBeNull()
    const p = tokens(pill())
    expect(p).toEqual(expect.arrayContaining(['max-sm:h-11', 'max-sm:search-tile']))
    expect(p.filter((c) => /^max-sm:(rounded|border|bg|shadow)/.test(c))).toEqual([])
    // Open: the box carries `data-search-open`, which the tile's 44px fill keys on (never focus — globals.css search-tile).
    expect(pill().hasAttribute('data-search-open')).toBe(true)
    expect(tokens(document.querySelector('[data-search-placeholder]'))).not.toContain('max-sm:justify-center')
    const w = tokens(panel())
    expect(w).toEqual(expect.arrayContaining(['max-sm:inset-x-0', 'max-sm:max-h-none', 'max-sm:rounded-none', 'max-sm:bg-background', 'overscroll-contain', 'kb-pad']))
    expect(w).not.toContain('shadow-pop')
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.documentElement.hasAttribute('data-phone-search')).toBe(true)
    expect(main.inert).toBe(true)
    unmount()
    expect(main.inert).toBe(false)
    expect(document.documentElement.hasAttribute('data-phone-search')).toBe(false)
    main.remove()
  })

  it('✕ empties the field and keeps the search open; Back cancels it, restores the page\'s query and frees the page', async () => {
    window.history.replaceState(null, '', '/?q=iphone')
    try {
      h.pathname.value = '/'
      render(<Header />)
      act(() => field().focus())
      fireEvent.change(field(), { target: { value: 'ipho' } })
      await waitFor(() => expect(panel()).not.toBeNull())
      // Round 13: 4px off the tile's end below sm (2px from sm, unchanged), so in the 44px typing tile its ring has 5px all round.
      expect(tokens(screen.getByRole('button', { name: 'Clear search' }))).toEqual(expect.arrayContaining(['mr-0.5', 'max-sm:mr-1', 'h-9', 'w-9', 'tap-48']))
      fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
      expect(field().value).toBe('')
      expect(h.push).not.toHaveBeenCalled()
      expect(panel()).not.toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Back' }))
      await waitFor(() => expect(panel()).toBeNull())
      expect(field().value).toBe('iphone')
      expect(document.body.style.overflow).toBe('')
    } finally {
      window.history.replaceState(null, '', '/')
    }
  })

  it('closed any other way without a search (Escape), the emptied field goes back to the page\'s query too', async () => {
    window.history.replaceState(null, '', '/?q=iphone')
    try {
      h.pathname.value = '/'
      render(<Header />)
      act(() => field().focus())
      fireEvent.change(field(), { target: { value: 'ipho' } })
      await waitFor(() => expect(panel()).not.toBeNull())
      fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
      fireEvent.keyDown(field(), { key: 'Escape' })
      await waitFor(() => expect(panel()).toBeNull())
      expect(field().value).toBe('iphone')
      // Closed with the field still focused: the box drops `data-search-open`, so the tile is the 40px one on the mark's lines.
      expect(document.activeElement).toBe(field())
      expect(pill().hasAttribute('data-search-open')).toBe(false)
    } finally {
      window.history.replaceState(null, '', '/')
    }
  })

  it('a search committed at desktop width does not stop a later phone search from restoring on Back', async () => {
    window.history.replaceState(null, '', '/?q=honda')
    try {
      h.pathname.value = '/'
      h.phone.value = false
      localStorage.setItem('eno:recent_searches', JSON.stringify(['honda']))
      const { rerender } = render(<Header />)
      act(() => field().focus())
      fireEvent.change(field(), { target: { value: 'honda' } })
      fireEvent.submit(field().closest('form')!)
      act(() => field().blur())
      h.phone.value = true
      rerender(<Header />)
      act(() => field().focus())
      await waitFor(() => expect(panel()).not.toBeNull())
      fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
      fireEvent.click(screen.getByRole('button', { name: 'Back' }))
      await waitFor(() => expect(panel()).toBeNull())
      expect(field().value).toBe('honda')
    } finally {
      window.history.replaceState(null, '', '/')
    }
  })

  it('a rotation past 640px mid-typing keeps the draft (the restore is for a closed search only)', async () => {
    window.history.replaceState(null, '', '/?q=iphone')
    try {
      h.pathname.value = '/'
      const { rerender } = render(<Header />)
      act(() => field().focus())
      fireEvent.change(field(), { target: { value: 'ipho' } })
      await waitFor(() => expect(panel()).not.toBeNull())
      h.phone.value = false
      rerender(<Header />)
      expect(field().value).toBe('ipho')
    } finally {
      window.history.replaceState(null, '', '/')
    }
  })

  it('off a phone the window is the dropdown it was: the popover shadow, no page hold', async () => {
    h.phone.value = false
    localStorage.setItem('eno:recent_searches', JSON.stringify(['honda']))
    render(<Header />)
    act(() => field().focus())
    await waitFor(() => expect(panel()).not.toBeNull())
    expect(tokens(panel())).toContain('shadow-pop')
    expect(tokens(panel())).not.toContain('kb-pad')
    expect(document.body.style.overflow).toBe('')
    // Only the installed app's own header Back (CSS-gated), never the search's.
    expect(screen.queryAllByRole('button', { name: 'Back' }).every((b) => b.hasAttribute('data-header-back'))).toBe(true)
  })
})
