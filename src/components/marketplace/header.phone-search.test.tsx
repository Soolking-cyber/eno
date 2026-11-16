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
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const push = vi.fn()
  const router = { push, prefetch: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }
  const tr = (en: string) => en
  const language = { lang: 'en', t: (k: string) => k, tr, setLang: () => {} }
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
vi.mock('./ai-concierge', () => ({ AISearchButton: () => <button type="button" aria-label="AI" />, GuideMark: () => null }))

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
 * ⛔ "SLIMMER + CALM" (owner, 2026-10-18): a 56px bar and no glow. From sm up a 40px logo mark matches the 40px tint
 * field beside it (the owner's 2026-08-02 rule). ON A PHONE (owner-approved 2026-11-14, the redesign) the field is a
 * 44px round, white, raised pill with a 1px edge and the mark is 36px — every geometry class behind `max-sm:`.
 * jsdom has no layout, so the classes that make the geometry are what is pinned.
 */
describe('the header bar: 56px, no glow; a 40px tint field + 40px logo from sm, a 44px raised pill + 36px logo on a phone', () => {
  it('h-14 bar, a 36/40px logo, a py-2 field that keeps text-base (iOS zooms under 16px)', () => {
    render(<Header />)
    const header = document.getElementById('app-header')!
    const bar = header.querySelector(':scope > div') as HTMLElement
    expect(bar.className.split(/\s+/)).toContain('h-14')
    expect(bar.className.split(/\s+/)).not.toContain('h-16')
    const logo = header.querySelector('[data-header-logo] img') as HTMLImageElement
    expect(logo.className.split(/\s+/)).toEqual(expect.arrayContaining(['h-9', 'w-9', 'sm:h-10', 'sm:w-10']))
    const input = field().className.split(/\s+/)
    expect(input).toEqual(expect.arrayContaining(['py-2', 'text-base']))
    expect(input).not.toContain('py-3')
  })

  it('the idle pill: a raised white 44px pill on a phone, the bare tint from sm — and never a search-beam', () => {
    render(<Header />)
    const pill = field().closest('form')!.querySelector('div.relative.z-50') as HTMLElement
    const cls = pill.className.split(/\s+/)
    expect(cls).toEqual(expect.arrayContaining([
      'max-sm:h-11', 'max-sm:rounded-full', 'max-sm:border', 'max-sm:border-search-edge', 'max-sm:bg-background', 'max-sm:shadow-raised',
      'sm:rounded-2xl', 'sm:bg-tint',
    ]))
    expect(cls).not.toContain('search-beam')
    // Every edge and lift is phone-only: from sm the idle pill is still bare tint (owner, 2026-10-18).
    expect(cls.some((c) => /^(ring|border|shadow)(-|$)/.test(c))).toBe(false)
    expect(cls.some((c) => /^sm:(ring|border|shadow)/.test(c))).toBe(false)
  })
})

/**
 * ⛔ BUILD 8 (owner-approved 2026-11-15, cook r08 home): on the home route's phone header the search pill is the one primary
 * action — 46px, a stronger lift, an empty state that is a centred bold ink label beside its own magnifier (the ONE-word rung:
 * the mock's centred "Search eno…" read as cut copy), the ✨ / bell muted (the download glyph too, until it left the phone header
 * on 2026-11-16 — owner, hub Q12, app-download.tsx) — and the bar stays put while the home
 * lanes are drawn (use-header-pin.ts), with no hairline under it (the pinned pills carry the one). Every other route is the
 * r05 header, class for class (the pins above run on /help).
 */
describe('build 8: the home route\'s phone header', () => {
  const pill = () => field().closest('form')!.querySelector('div.relative.z-50') as HTMLElement
  const tokens = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/)
  const hairline = () => document.querySelector('#app-header > div > span[aria-hidden].absolute')!

  it('on /: a 46px pill with the stronger lift; the leading magnifier steps out while the field is empty', () => {
    h.pathname.value = '/'
    render(<Header />)
    const cls = tokens(pill())
    expect(cls).toEqual(expect.arrayContaining(['max-sm:h-11.5', 'max-sm:shadow-search', 'max-sm:has-[input:placeholder-shown]:[--lead-glyph:hidden]', 'max-sm:rounded-full', 'max-sm:border-search-edge', 'sm:rounded-2xl', 'sm:bg-tint']))
    expect(cls).not.toContain('max-sm:h-11')
    expect(cls).not.toContain('max-sm:shadow-raised')
    // The pill says when its field is empty (a :has() on itself); the leading glyph reads it.
    expect(tokens(pill().querySelector(':scope > svg'))).toContain('max-sm:[visibility:var(--lead-glyph,visible)]')
  })

  it('on /: the empty label is centred, bold ink, beside its own magnifier, and it is the one-word rung below sm', () => {
    h.pathname.value = '/'
    render(<Header />)
    const overlay = document.querySelector('[data-search-placeholder]')!
    expect(tokens(overlay)).toEqual(expect.arrayContaining(['max-sm:left-0', 'max-sm:right-0', 'max-sm:justify-center', 'max-sm:gap-2', 'max-sm:font-bold', 'max-sm:text-foreground', 'text-t-card']))
    expect(tokens(overlay.querySelector(':scope > svg'))).toEqual(expect.arrayContaining(['hidden', 'max-sm:block']))
    // The long rung waits for sm; the short rung ("Search" — the field's own name) is the phone's label.
    const long = overlay.querySelector('[data-rung="long"]')!
    const short = overlay.querySelector('[data-rung="short"]')!
    expect(tokens(long)).toEqual(expect.arrayContaining(['hidden', 'sm:@min-[8.6em]/q:block']))
    expect(tokens(long)).not.toContain('@min-[8.6em]/q:block')
    expect(tokens(short)).toContain('sm:@min-[8.6em]/q:hidden')
    expect(short.textContent).toBe(field().getAttribute('aria-label'))
    // The bell steps back with the rest.
    expect(screen.getByRole('button', { name: 'Notifications' }).hasAttribute('data-quiet')).toBe(true)
  })

  it('off /: the r05 pill, the ladder and the bell exactly as they were', () => {
    render(<Header />)
    expect(tokens(pill())).toEqual(expect.arrayContaining(['max-sm:h-11', 'max-sm:shadow-raised']))
    expect(tokens(pill())).not.toContain('max-sm:shadow-search')
    expect(tokens(pill().querySelector(':scope > svg'))).not.toContain('max-sm:[visibility:var(--lead-glyph,visible)]')
    expect(tokens(pill()).some((c) => c.includes('placeholder-shown'))).toBe(false)
    const overlay = document.querySelector('[data-search-placeholder]')!
    expect(overlay.querySelector(':scope > svg')).toBeNull()
    expect(tokens(overlay)).not.toContain('max-sm:font-bold')
    expect(tokens(overlay.querySelector('[data-rung="long"]'))).toContain('@min-[8.6em]/q:block')
    expect(screen.getByRole('button', { name: 'Notifications' }).hasAttribute('data-quiet')).toBe(false)
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

  it('open on /: Back + a flat left-aligned field; logo and actions step out; the window fills the screen; the page is held', async () => {
    h.pathname.value = '/'
    const main = document.body.appendChild(Object.assign(document.createElement('main'), { id: 'main' }))
    const { unmount } = render(<Header />)
    act(() => field().focus())
    await waitFor(() => expect(panel()).not.toBeNull())
    expect(tokens(document.getElementById('app-header'))).toContain('max-sm:z-overlay')
    expect(tokens(document.querySelector('[data-header-logo]'))).toContain('max-sm:hidden')
    expect(tokens(screen.getByRole('button', { name: 'Notifications' }).closest('div.shrink-0'))).toContain('max-sm:hidden')
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy()
    const p = tokens(pill())
    expect(p).toContain('max-sm:h-11.5')
    for (const gone of ['max-sm:shadow-search', 'max-sm:has-[input:placeholder-shown]:[--lead-glyph:hidden]']) expect(p).not.toContain(gone)
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
