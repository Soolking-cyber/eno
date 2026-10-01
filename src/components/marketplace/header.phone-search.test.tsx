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
  return { push, router, language, auth, phone }
})

vi.mock('next/navigation', () => ({
  useRouter: () => h.router,
  usePathname: () => '/help',
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
vi.mock('./notification-bell', () => ({ NotificationBell: () => <button type="button" aria-label="Notifications" /> }))
vi.mock('./app-download', () => ({ AppDownload: () => null }))
vi.mock('@/hooks/use-is-phone', () => ({ useIsPhone: () => h.phone.value }))
vi.mock('./ai-concierge', () => ({ AISearchButton: () => <button type="button" aria-label="AI" /> }))

import { Header } from './header'

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
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const field = () => screen.getByRole('combobox') as HTMLInputElement
const panel = () => document.querySelector('#app-header form div.overflow-y-auto')

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
    fireEvent.click(screen.getByRole('button', { name: 'Ask eno AI' }))
    expect(h.push).toHaveBeenCalledWith('/messages/ai')
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
    let bottom = 130 // a 66px notice above a 64px header, at scroll-top
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { top: bottom - 64, bottom, left: 0, right: 390, width: 390, height: 64, x: 0, y: bottom - 64, toJSON: () => ({}) } as DOMRect
    })
    try {
      render(<Header />)
      act(() => field().focus())
      await waitFor(() => expect(panel()).not.toBeNull())
      const win = panel() as HTMLElement
      expect(win.style.getPropertyValue('--search-panel-top')).toBe('126px')
      // The class reads the variable, with the old constant as its fallback — top AND the height cap.
      expect(win.className).toContain('top-[var(--search-panel-top,calc(env(safe-area-inset-top)+3.75rem))]')
      expect(win.className).toContain('-var(--search-panel-top,calc(env(safe-area-inset-top)+3.75rem))-0.75rem')
      // Scrolled past the strip: the sticky header is at y=0 again, and the panel follows it up.
      bottom = 64
      await act(async () => {
        window.dispatchEvent(new Event('scroll'))
        await new Promise((r) => requestAnimationFrame(() => r(null)))
      })
      expect(win.style.getPropertyValue('--search-panel-top')).toBe('60px')
    } finally {
      rect.mockRestore()
    }
  })
})
