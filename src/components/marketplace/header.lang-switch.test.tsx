// @vitest-environment jsdom
/**
 * ⛔ THE DESKTOP HEADER'S LANGUAGE BUTTON (owner, 2026-10-18: "go on apply all recommended" — the before/after
 * report's "add a small language button to the desktop header", once the `/vi` pilot's "Tiếng Việt" link had left
 * the first screen for the end of <main>).
 *
 * Pinned through the REAL Header (the harness of header.phone-search.test.tsx and its siblings):
 *   · one tap between the two server-rendered languages — "Tiếng Việt" (lang="vi") on an English page, "English"
 *     (lang="en") on a Vietnamese page AND in each of the nine machine-translated languages (back to the source);
 *   · a click is ONE `setLang(target)`, a keyboard press too, and a double-click's second click is not a second one;
 *   · the accessible name is the visible word — no aria-label (WCAG 2.5.3), the word in its own language (3.1.2);
 *   · `hidden pc:flex`, the complement of the tab bar's `pc:hidden` (its Account tab carries Language);
 *   · guests and members alike, first in the actions row;
 *   · ⚠️ HYDRATION, through the REAL LanguageProvider: a machine-translated reader is served the English variant, whose
 *     edge-cached HTML says "Tiếng Việt" for everyone; hydration agrees with it, and only after it does the label
 *     turn to "English" — no mismatch, and nothing per-visitor in the server HTML.
 * ⚠️ NO NETWORK: `fetch` never answers, and the real provider's catalogue imports and machine translation are stubbed.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { renderToString } from 'react-dom/server'
import { hydrateRoot, type Root } from 'react-dom/client'
import { act, cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A full Header render is heavy on a loaded machine (header.history.test.tsx).
configure({ asyncUtilTimeout: 5_000 })
vi.setConfig({ testTimeout: 30_000 })

const h = vi.hoisted(() => {
  const router = { push: () => {}, prefetch: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }
  const setLang = vi.fn()
  const language = { lang: 'en', t: (k: string) => k, tr: (en: string) => en, setLang }
  const auth: { user: null | { id: string }; profile: null; loading: boolean; openSignIn: () => void } = { user: null, profile: null, loading: false, openSignIn: () => {} }
  // true → the Header reads the REAL LanguageProvider (the hydration test); false → the stand-in above.
  const real = { value: false }
  const nav = { pathname: '/c/rentals' }
  return { router, setLang, language, auth, real, nav }
})

vi.mock('next/navigation', () => ({
  useRouter: () => h.router,
  usePathname: () => h.nav.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}))
// The typeahead listbox is a code-split chunk and is not under test here (search-suggest.test.tsx).
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/context/language-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/language-context')>()
  return {
    LanguageProvider: actual.LanguageProvider,
    useLanguage: () => (h.real.value ? actual.useLanguage() : h.language),
    useTr: (s: string) => s,
    Tr: ({ text }: { text?: string | null }) => <>{text}</>,
  }
})
// The real provider's machine-translated path, kept off the network: the UI catalogues it lazy-loads for a
// third language, and the per-string translator behind tr().
vi.mock('@/generated/ui-strings', () => ({ UI_STRINGS: [] }))
vi.mock('@/generated/ui-strings.services', () => ({ UI_STRINGS_SERVICES: [] }))
vi.mock('@/lib/i18n/mt-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/i18n/mt-client')>()),
  translateText: () => new Promise<string>(() => {}),
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => h.auth, preloadSignIn: () => {} }))
vi.mock('./account-panel', () => ({ useAccountPanel: () => ({ open: false }) }))
vi.mock('@/lib/safe-back', () => ({ useSafeBack: () => () => {} }))
vi.mock('./notification-bell', () => ({ NotificationBell: () => <button type="button" aria-label="Notifications" /> }))
vi.mock('./app-download', () => ({ AppDownload: () => null }))
vi.mock('@/hooks/use-is-phone', () => ({ useIsPhone: () => false }))
vi.mock('./ai-concierge', () => ({ AISearchButton: () => <button type="button" aria-label="AI" /> }))

import { Header } from './header'
import { LanguageProvider } from '@/context/language-context'
import { LANGUAGES } from '@/lib/i18n/langs'

/** The machine-translated languages — every site language but the two the server renders (nine today). */
const MT = LANGUAGES.map((l) => l.code).filter((c) => c !== 'en' && c !== 'vi')

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
  vi.stubGlobal('sessionStorage', memoryStorage())
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  h.setLang.mockClear()
  h.language.lang = 'en'
  h.auth.user = null
  h.real.value = false
  h.nav.pathname = '/c/rentals' // a browse page: the button shows only there (see its own block below)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  // The real provider writes these (the hydration test); nothing may leak into the next test.
  document.documentElement.lang = ''
  for (const c of ['lang', 'lang-choice']) document.cookie = `${c}=;path=/;max-age=0`
})

const langButton = () => document.querySelector<HTMLButtonElement>('[data-header-lang]')!

describe('one tap between the two server-rendered languages', () => {
  it('the roster still has nine machine-translated languages (the header\'s note counts them)', () => {
    expect(MT).toHaveLength(9)
  })

  it('on an English page it reads "Tiếng Việt", in Vietnamese (lang="vi")', () => {
    render(<Header />)
    const b = screen.getByRole('button', { name: 'Tiếng Việt' })
    expect(b).toBe(langButton())
    expect(b.getAttribute('lang')).toBe('vi')
  })

  it('on a Vietnamese page it reads "English", in English (lang="en")', () => {
    h.language.lang = 'vi'
    render(<Header />)
    const b = screen.getByRole('button', { name: 'English' })
    expect(b).toBe(langButton())
    expect(b.getAttribute('lang')).toBe('en')
  })

  it.each(MT)('in a machine-translated language (%s) it reads "English" — back to the source language', (code) => {
    h.language.lang = code
    render(<Header />)
    expect(langButton().textContent).toBe('English')
    expect(langButton().getAttribute('lang')).toBe('en')
  })
})

describe('a click is one setLang(target)', () => {
  it.each([
    ['en', 'vi'],
    ['vi', 'en'],
    ...MT.map((code) => [code, 'en']),
  ])('from %s: setLang(%s), once', (from, to) => {
    h.language.lang = from
    render(<Header />)
    fireEvent.click(langButton(), { detail: 1 })
    expect(h.setLang).toHaveBeenCalledTimes(1)
    expect(h.setLang).toHaveBeenCalledWith(to)
  })

  it('a keyboard press (a click with detail 0) switches too', () => {
    render(<Header />)
    fireEvent.click(langButton(), { detail: 0 })
    expect(h.setLang).toHaveBeenCalledTimes(1)
    expect(h.setLang).toHaveBeenCalledWith('vi')
  })

  it('⚠️ a double-click\'s second click is dropped — setLang flips the label first, so it would choose the first language back', () => {
    render(<Header />)
    fireEvent.click(langButton(), { detail: 1 })
    fireEvent.click(langButton(), { detail: 2 })
    expect(h.setLang).toHaveBeenCalledTimes(1)
    expect(h.setLang).toHaveBeenCalledWith('vi')
  })

  it('⛔ a held Enter or a second click right after (detail 0, detail 1) is still ONE switch (gate 2026-10-18)', () => {
    render(<Header />)
    fireEvent.click(langButton(), { detail: 0 })
    fireEvent.click(langButton(), { detail: 0 })
    fireEvent.click(langButton(), { detail: 1 })
    expect(h.setLang).toHaveBeenCalledTimes(1)
  })

  it('⛔ once a navigation began (beforeunload), the button holds while the page goes — a reload still loading at 5s (gate round 2)', () => {
    vi.useFakeTimers()
    try {
      h.setLang.mockImplementation(() => { window.dispatchEvent(new Event('beforeunload')) })
      render(<Header />)
      fireEvent.click(langButton(), { detail: 1 })
      vi.advanceTimersByTime(5_000) // a reload still loading after 5s on a slow connection
      fireEvent.click(langButton(), { detail: 1 })
      expect(h.setLang).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
      h.setLang.mockImplementation(() => {})
    }
  })

  it('⛔ a page Back restores from the back-forward cache (pageshow, persisted) has a working button again (gate round 3)', () => {
    vi.useFakeTimers()
    try {
      h.setLang.mockImplementation(() => { window.dispatchEvent(new Event('beforeunload')) })
      render(<Header />)
      fireEvent.click(langButton(), { detail: 1 })
      fireEvent.click(langButton(), { detail: 1 })
      expect(h.setLang).toHaveBeenCalledTimes(1)
      const restored = new Event('pageshow') as PageTransitionEvent
      Object.defineProperty(restored, 'persisted', { value: true })
      act(() => { window.dispatchEvent(restored) })
      fireEvent.click(langButton(), { detail: 1 })
      expect(h.setLang).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
      h.setLang.mockImplementation(() => {})
    }
  })

  it('a navigation that began but never left (cancelled, stalled) frees the button 10s later', () => {
    vi.useFakeTimers()
    try {
      h.setLang.mockImplementation(() => { window.dispatchEvent(new Event('beforeunload')) })
      render(<Header />)
      fireEvent.click(langButton(), { detail: 1 })
      vi.advanceTimersByTime(9_000)
      fireEvent.click(langButton(), { detail: 1 })
      expect(h.setLang).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(1_500)
      fireEvent.click(langButton(), { detail: 1 })
      expect(h.setLang).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
      h.setLang.mockImplementation(() => {})
    }
  })

  it('a switch that navigated nowhere (an in-place swap) frees the button after 1s for a deliberate switch back', () => {
    vi.useFakeTimers()
    try {
      render(<Header />)
      fireEvent.click(langButton(), { detail: 1 })
      vi.advanceTimersByTime(900)
      fireEvent.click(langButton(), { detail: 1 })
      expect(h.setLang).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(200)
      fireEvent.click(langButton(), { detail: 1 })
      expect(h.setLang).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('⛔ browse pages only — where the switch sat, and where nothing is half-typed (gate 2026-10-18)', () => {
  const button = () => document.querySelector('[data-header-lang]')
  it.each(['/', '/c/rentals', '/listings/abc123', '/sellers/abc', '/s/apple', '/brands', '/vi', '/en/c/rentals', '/vi/c/furniture-appliances'])(
    '%s: the button is there (the server\'s internal /en/… path answers like the public one)',
    (path) => {
      h.nav.pathname = path
      render(<Header />)
      expect(button()).not.toBeNull()
    },
  )
  it.each(['/post', '/listings/abc123/edit', '/en/post', '/messages/abc', '/messages/ai', '/dashboard', '/dashboard/settings', '/help', '/contact', '/appeal'])(
    '%s: no button — a switch reloads, and unsaved input would go',
    (path) => {
      h.nav.pathname = path
      render(<Header />)
      expect(button()).toBeNull()
    },
  )
})

describe('the control itself', () => {
  it('is a real <button type="button"> whose accessible name is its visible word — no aria-label (WCAG 2.5.3)', () => {
    render(<Header />)
    const b = langButton()
    expect(b.tagName).toBe('BUTTON')
    expect(b.getAttribute('type')).toBe('button')
    expect(b.hasAttribute('aria-label')).toBe(false)
    expect(b.hasAttribute('aria-labelledby')).toBe(false)
    expect(b.textContent).toBe('Tiếng Việt')
    expect(screen.getByRole('button', { name: b.textContent! })).toBe(b)
  })

  it('is desktop-only — `hidden pc:flex`, the exact complement of the tab bar\'s `pc:hidden` (Account › Language)', () => {
    render(<Header />)
    const cls = langButton().className.split(/\s+/)
    expect(cls).toEqual(expect.arrayContaining(['hidden', 'pc:flex']))
    // `hidden` must win over ui/button's base `inline-flex` (tailwind-merge keeps the caller's), and no width-only gate.
    expect(cls).not.toContain('inline-flex')
    for (const gate of ['sm:flex', 'md:flex', 'lg:flex', 'mobile:flex']) expect(cls).not.toContain(gate)
    // The other half of the contract: the tab bar, whose Account tab carries Language on phones and tablets.
    expect(readFileSync('src/components/marketplace/mobile-nav.tsx', 'utf8')).toMatch(/'mobile-nav pc:hidden /)
  })

  it('wears the Sign in link\'s box — h-9, rounded-xl, px-2.5, text-sm font-semibold text-body, the accent hover — and its 48px target', () => {
    render(<Header />)
    const cls = langButton().className.split(/\s+/)
    expect(cls).toEqual(expect.arrayContaining(['h-9', 'rounded-xl', 'px-2.5', 'text-sm', 'font-semibold', 'text-body', 'hover:bg-accent', 'hover:text-accent-foreground', 'relative', 'tap-48']))
    // ui/button's own press feedback, the Sign in link's scale.
    expect(cls).toContain('active:scale-[0.97]')
  })

  it('is there for a signed-in member too, still first in the actions row', () => {
    h.auth.user = { id: 'u1' }
    render(<Header />)
    expect(langButton().textContent).toBe('Tiếng Việt')
    expect(langButton().parentElement!.firstElementChild).toBe(langButton())
  })

  it('opens the actions row: before the guest\'s Saved heart, the bell and Sign in', () => {
    render(<Header />)
    const b = langButton()
    expect(b.parentElement!.firstElementChild).toBe(b)
    // Sign in's href carries `?next=` once hydrated (header.tsx `offHome`), hence the prefix match.
    const later = [document.querySelector('[data-header-saved]'), screen.getByRole('button', { name: 'Notifications' }), document.querySelector('a[href^="/signin"]')]
    for (const after of later) {
      expect(after).not.toBeNull()
      expect(b.compareDocumentPosition(after!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })
})

describe('⚠️ the server HTML holds the variant, never the visitor', () => {
  const serverButton = (lang: string) => {
    h.language.lang = lang
    const doc = new DOMParser().parseFromString(renderToString(<Header />), 'text/html')
    return doc.querySelector('[data-header-lang]')!
  }
  it('the English variant says "Tiếng Việt" (lang="vi"); the Vietnamese one "English" (lang="en")', () => {
    expect(serverButton('en').textContent).toBe('Tiếng Việt')
    expect(serverButton('en').getAttribute('lang')).toBe('vi')
    expect(serverButton('vi').textContent).toBe('English')
    expect(serverButton('vi').getAttribute('lang')).toBe('en')
  })

  it('a machine-translated reader, through the REAL provider: the English variant hydrates "Tiếng Việt" with no mismatch, then reads "English"', async () => {
    h.real.value = true
    // What the edge serves every English-variant reader: the provider starts at the variant (initialLang).
    const app = <LanguageProvider initialLang="en"><Header /></LanguageProvider>
    const container = document.createElement('div')
    container.innerHTML = renderToString(app)
    document.body.appendChild(container)
    expect(langButton().textContent).toBe('Tiếng Việt')
    expect(langButton().getAttribute('lang')).toBe('vi')

    // The reader's own choice, which only their browser knows: Russian (served the English variant).
    localStorage.setItem('lang', 'ru')
    const recoverable: unknown[] = []
    const logged: string[] = []
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(' ')) })
    let root: Root | undefined
    try {
      await act(async () => {
        root = hydrateRoot(container, app, { onRecoverableError: (e) => { recoverable.push(e) } })
      })
      // After hydration the provider adopts the stored language (same variant — no reload), and the label follows.
      await waitFor(() => expect(langButton().textContent).toBe('English'))
      expect(langButton().getAttribute('lang')).toBe('en')
      expect(document.documentElement.lang).toBe('ru')
      // …and hydration itself agreed with the server HTML: no text mismatch, no attribute mismatch.
      expect(recoverable).toEqual([])
      expect(logged.filter((m) => /hydrat|did not match|didn't match/i.test(m))).toEqual([])
    } finally {
      act(() => root?.unmount())
      container.remove()
    }
  })
})
