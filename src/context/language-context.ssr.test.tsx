// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { LanguageProvider, useLanguage, Tr, type Language } from '@/context/language-context'

/**
 * ⛔ THE SERVER NOW PICKS THE LANGUAGE (src/proxy.ts → the `[lang]` segment), SO THE PROVIDER MUST
 * START THERE. These pin the three things the server-rendered language depends on: the first render
 * is already in `initialLang` (no swap), the Vietnamese dictionary is usable in that first render
 * (or SSR and hydration disagree), and a switch across server variants reloads while a switch within
 * one does not.
 */

let setLangRef: ((l: Language) => void) | null = null
const expose = (fn: (l: Language) => void) => { setLangRef = fn }
function Probe() {
  const { lang, tr, setLang } = useLanguage()
  React.useEffect(() => { expose(setLang) })
  return (
    <p data-testid="probe">
      {lang}|{tr('Latest listings', 'Tin mới nhất')}|<Tr text="Every" />
    </p>
  )
}

const reload = vi.fn()
beforeEach(() => {
  reload.mockReset()
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } })
  try { window.localStorage?.clear?.() } catch { /* ignore */ }
  document.cookie = 'lang=; path=/; max-age=0'
  Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['en-US'] })
})
afterEach(() => { cleanup(); setLangRef = null })

describe('LanguageProvider with a server-chosen language', () => {
  it('server-renders Vietnamese on the vi variant — inline strings AND dictionary strings', () => {
    const html = renderToString(
      <LanguageProvider initialLang="vi" initialViDict={{ Every: 'Mỗi' }}>
        <Probe />
      </LanguageProvider>,
    )
    expect(html.replace(/<!-- -->/g, '')).toContain('vi|Tin mới nhất|Mỗi')
  })

  it('server-renders English on the en variant', () => {
    const html = renderToString(
      <LanguageProvider initialLang="en">
        <Probe />
      </LanguageProvider>,
    )
    expect(html.replace(/<!-- -->/g, '')).toContain('en|Latest listings|Every')
  })

  it('does not swap after mount when the device agrees with the server', () => {
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['vi-VN', 'vi'] })
    render(
      <LanguageProvider initialLang="vi" initialViDict={{ Every: 'Mỗi' }}>
        <Probe />
      </LanguageProvider>,
    )
    expect(screen.getByTestId('probe').textContent).toBe('vi|Tin mới nhất|Mỗi')
    expect(document.cookie).toContain('lang=vi')
  })

  it('reloads when the choice crosses server variants (vi → en)', () => {
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['vi-VN'] })
    render(<LanguageProvider initialLang="vi" initialViDict={{}}><Probe /></LanguageProvider>)
    act(() => setLangRef!('en'))
    expect(reload).toHaveBeenCalledTimes(1)
    expect(document.cookie).toContain('lang=en')
  })

  it('⛔ reloads ONCE on mount when the stored choice needs the other variant, then stops', () => {
    const store: Record<string, string> = { lang: 'vi' }
    const session: Record<string, string> = {}
    const fake = (m: Record<string, string>) => ({ getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => { m[k] = v }, removeItem: (k: string) => { delete m[k] }, clear: () => { for (const k of Object.keys(m)) delete m[k] } })
    Object.defineProperty(window, 'localStorage', { configurable: true, value: fake(store) })
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: fake(session) })
    render(<LanguageProvider initialLang="en"><Probe /></LanguageProvider>)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(document.cookie).toContain('lang=vi')
    cleanup()
    // the reload did not take (cookies blocked): the second mount must not loop — it swaps client-side
    render(<LanguageProvider initialLang="en"><Probe /></LanguageProvider>)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('probe').textContent?.startsWith('vi|')).toBe(true)
  })

  it('keeps an explicit choice where localStorage is blocked — the choice cookie carries it', () => {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => {}, clear: () => {} } })
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['vi-VN'] })
    document.cookie = 'lang=en; path=/'
    document.cookie = 'lang-choice=1; path=/'
    render(<LanguageProvider initialLang="en"><Probe /></LanguageProvider>)
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByTestId('probe').textContent?.startsWith('en|')).toBe(true)
    document.cookie = 'lang-choice=; path=/; max-age=0'
  })

  it('clears a spent reload marker once server and client agree', () => {
    const session: Record<string, string> = { 'lang-reload:vi': '1' }
    const store: Record<string, string> = { lang: 'vi' }
    const fake = (m: Record<string, string>) => ({ getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => { m[k] = v }, removeItem: (k: string) => { delete m[k] }, clear: () => { for (const k of Object.keys(m)) delete m[k] } })
    Object.defineProperty(window, 'localStorage', { configurable: true, value: fake(store) })
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: fake(session) })
    render(<LanguageProvider initialLang="vi" initialViDict={{}}><Probe /></LanguageProvider>)
    expect(session['lang-reload:vi']).toBeUndefined()
    expect(reload).not.toHaveBeenCalled()
  })

  it('does not reload on mount for a machine-translated language on the English variant', () => {
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['ko-KR'] })
    render(<LanguageProvider initialLang="en"><Probe /></LanguageProvider>)
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByTestId('probe').textContent?.startsWith('ko|')).toBe(true)
  })

  it('⛔ does not reload on an explicit switch the cookie cannot hold — the choice would be lost', () => {
    Object.defineProperty(document, 'cookie', { configurable: true, get: () => 'eno-consent=essential', set: () => {} })
    render(<LanguageProvider initialLang="en"><Probe /></LanguageProvider>)
    act(() => setLangRef!('vi'))
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByTestId('probe').textContent?.startsWith('vi|')).toBe(true)
  })

  it('does NOT reload within a variant (en → a machine-translated language)', () => {
    render(<LanguageProvider initialLang="en"><Probe /></LanguageProvider>)
    act(() => setLangRef!('ko'))
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByTestId('probe').textContent?.startsWith('ko|')).toBe(true)
  })
})

/**
 * ⛔ A FIXED-LANGUAGE GUIDE CANNOT CHANGE VARIANT (SEO wave B, V1 — src/lib/lang-pinned.ts). The proxy
 * pins the path, so a reload comes back in the same language and a client swap is the mixed page the pin
 * exists to end. These pin the provider's half: no reload and no cross-variant swap on mount, a switch
 * goes to the guide's translation, and a soft navigation into the other variant is adopted.
 */
describe('LanguageProvider on a fixed-language guide', () => {
  const VI = '/thanh-ly-do-gia-dung-cu-tphcm'
  const EN = '/secondhand-furniture-ho-chi-minh-city'
  const assign = vi.fn()
  const at = (pathname: string, hostname = 'eno.vn') =>
    Object.defineProperty(window, 'location', { configurable: true, value: { pathname, hostname, search: '', hash: '', reload, assign } })
  const fake = (m: Record<string, string>) => ({ getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => { m[k] = v }, removeItem: (k: string) => { delete m[k] }, clear: () => { for (const k of Object.keys(m)) delete m[k] } })
  let store: Record<string, string>
  afterEach(() => vi.unstubAllEnvs())
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
    assign.mockReset()
    store = {}
    Object.defineProperty(window, 'localStorage', { configurable: true, value: fake(store) })
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: fake({}) })
    // An earlier test replaces document.cookie with a fixed getter; drop it so the real jar is back.
    Reflect.deleteProperty(document, 'cookie')
    document.cookie = 'lang=; path=/; max-age=0'
    document.cookie = 'lang-choice=; path=/; max-age=0'
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['en-US'] })
  })

  it('an English browser on a Vietnamese guide: no reload, stays Vietnamese, writes no cookie', () => {
    at(VI)
    render(<LanguageProvider initialLang="vi" initialViDict={{}}><Probe /></LanguageProvider>)
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByTestId('probe').textContent?.startsWith('vi|')).toBe(true)
    expect(document.cookie).not.toContain('lang=')
  })

  it('a stored Vietnamese choice on an English guide: no reload, stays English', () => {
    at(EN)
    store.lang = 'vi'
    render(<LanguageProvider initialLang="en"><Probe /></LanguageProvider>)
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByTestId('probe').textContent?.startsWith('en|')).toBe(true)
  })

  it('a machine-translated language on an English guide is adopted as on any English page — same variant', () => {
    at(EN)
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['ko-KR'] })
    render(<LanguageProvider initialLang="en"><Probe /></LanguageProvider>)
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByTestId('probe').textContent?.startsWith('ko|')).toBe(true)
  })

  it('choosing English on a paired Vietnamese guide goes to its English guide, choice stored', () => {
    at(VI)
    render(<LanguageProvider initialLang="vi" initialViDict={{}}><Probe /></LanguageProvider>)
    act(() => setLangRef!('en'))
    expect(assign).toHaveBeenCalledWith(EN)
    expect(reload).not.toHaveBeenCalled()
    expect(store.lang).toBe('en')
    expect(document.cookie).toContain('lang=en')
  })

  it('choosing English on an unpaired Vietnamese guide stores the choice, keeps the page, and reloads to drop the router cache', () => {
    at('/dang-tin-ban-hang-mien-phi')
    render(<LanguageProvider initialLang="vi" initialViDict={{}}><Probe /></LanguageProvider>)
    act(() => setLangRef!('en'))
    expect(assign).not.toHaveBeenCalled()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(store.lang).toBe('en')
    expect(document.cookie).toContain('lang=en')
    expect(screen.getByTestId('probe').textContent?.startsWith('vi|')).toBe(true)
    // …and the reload is not a loop: the page comes back pinned, and the mount leaves it alone
    cleanup()
    render(<LanguageProvider initialLang="vi" initialViDict={{}}><Probe /></LanguageProvider>)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('⛔ a signed-in reader\'s profile gets THEIR language from a pinned guide, never the article\'s', () => {
    vi.useFakeTimers()
    const fetchSpy = vi.fn(() => Promise.resolve({ ok: true } as Response))
    vi.stubGlobal('fetch', fetchSpy)
    document.cookie = 'sb-x-auth-token=1; path=/'
    const sent = () => (fetchSpy.mock.calls as unknown as [string, { body: string }][]).map((c) => JSON.parse(c[1].body).locale)
    try {
      // an English device on a Vietnamese guide: 'en', not the page's 'vi'
      at(VI)
      render(<LanguageProvider initialLang="vi" initialViDict={{}}><Probe /></LanguageProvider>)
      act(() => { vi.advanceTimersByTime(2000) })
      expect(sent()).toEqual(['en'])
      cleanup(); fetchSpy.mockClear(); delete store['lang-synced']
      // English chosen on an UNPAIRED Vietnamese guide: the page stays Vietnamese, the profile gets 'en'
      store.lang = 'en'
      at('/dang-tin-ban-hang-mien-phi')
      render(<LanguageProvider initialLang="vi" initialViDict={{}}><Probe /></LanguageProvider>)
      act(() => { vi.advanceTimersByTime(2000) })
      expect(screen.getByTestId('probe').textContent?.startsWith('vi|')).toBe(true)
      expect(sent()).toEqual(['en'])
      cleanup(); fetchSpy.mockClear(); delete store['lang-synced']
      // a reader whose own choice IS the guide's language
      store.lang = 'vi'
      at(VI)
      render(<LanguageProvider initialLang="vi" initialViDict={{}}><Probe /></LanguageProvider>)
      act(() => { vi.advanceTimersByTime(2000) })
      expect(sent()).toEqual(['vi'])
    } finally {
      document.cookie = 'sb-x-auth-token=; path=/; max-age=0'
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it('a same-variant choice on a guide reloads (the router cache may hold the other variant), and the mount adopts it', () => {
    at(EN)
    render(<LanguageProvider initialLang="en"><Probe /></LanguageProvider>)
    act(() => setLangRef!('ko'))
    expect(assign).not.toHaveBeenCalled()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(document.cookie).toContain('lang=ko')
    cleanup()
    render(<LanguageProvider initialLang="en"><Probe /></LanguageProvider>)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('probe').textContent?.startsWith('ko|')).toBe(true)
  })

  it('where the cookie cannot hold a choice, nothing reloads; a same-variant choice switches in place', () => {
    at(EN)
    Object.defineProperty(document, 'cookie', { configurable: true, get: () => '', set: () => {} })
    try {
      render(<LanguageProvider initialLang="en"><Probe /></LanguageProvider>)
      act(() => setLangRef!('ko'))
      expect(reload).not.toHaveBeenCalled()
      expect(screen.getByTestId('probe').textContent?.startsWith('ko|')).toBe(true)
      act(() => setLangRef!('vi'))
      expect(reload).not.toHaveBeenCalled()
      expect(assign).toHaveBeenCalledWith('/thanh-ly-do-gia-dung-cu-tphcm')
    } finally {
      Reflect.deleteProperty(document, 'cookie')
    }
  })

  it('a machine-translated choice on a paired Vietnamese guide goes to the English pair, query kept', () => {
    Object.defineProperty(window, 'location', { configurable: true, value: { pathname: VI, hostname: 'eno.vn', search: '?utm_source=x', hash: '#muc-1', reload, assign } })
    render(<LanguageProvider initialLang="vi" initialViDict={{}}><Probe /></LanguageProvider>)
    act(() => setLangRef!('ko'))
    expect(assign).toHaveBeenCalledWith(`${EN}?utm_source=x`)
    expect(store.lang).toBe('ko')
  })

  it('choosing the page\'s own language on a guide stores it and reloads, so the next pages follow it', () => {
    at(VI)
    render(<LanguageProvider initialLang="vi" initialViDict={{}}><Probe /></LanguageProvider>)
    act(() => setLangRef!('vi'))
    expect(assign).not.toHaveBeenCalled()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(store.lang).toBe('vi')
  })

  it('⛔ a soft navigation into the other variant is adopted — no mixed chrome, no reload', () => {
    at('/c/rentals')
    const { rerender } = render(<LanguageProvider initialLang="en" initialViDict={{}}><Probe /></LanguageProvider>)
    expect(screen.getByTestId('probe').textContent).toBe('en|Latest listings|Every')
    at(VI)
    rerender(<LanguageProvider initialLang="vi" initialViDict={{}}><Probe /></LanguageProvider>)
    expect(screen.getByTestId('probe').textContent?.startsWith('vi|Tin mới nhất')).toBe(true)
    expect(document.documentElement.lang).toBe('vi')
    // …and back: an English page again, not the Vietnamese state carried along
    at('/c/rentals')
    rerender(<LanguageProvider initialLang="en" initialViDict={{}}><Probe /></LanguageProvider>)
    expect(screen.getByTestId('probe').textContent?.startsWith('en|')).toBe(true)
    expect(document.documentElement.lang).toBe('en')
    expect(reload).not.toHaveBeenCalled()
    expect(assign).not.toHaveBeenCalled()
  })

  it('coming back from a guide restores a machine-translated choice that shares the variant', () => {
    at('/c/rentals')
    store.lang = 'ko'
    const { rerender } = render(<LanguageProvider initialLang="en" initialViDict={{}}><Probe /></LanguageProvider>)
    expect(screen.getByTestId('probe').textContent?.startsWith('ko|')).toBe(true)
    at(VI)
    rerender(<LanguageProvider initialLang="vi" initialViDict={{}}><Probe /></LanguageProvider>)
    expect(screen.getByTestId('probe').textContent?.startsWith('vi|')).toBe(true)
    at('/c/rentals')
    rerender(<LanguageProvider initialLang="en" initialViDict={{}}><Probe /></LanguageProvider>)
    expect(screen.getByTestId('probe').textContent?.startsWith('ko|')).toBe(true)
  })

  it('a storefront host whose negotiated variant equals the guide\'s is treated as pinned — harmless, the page is consistent', () => {
    at(EN, 'apple.eno.vn')
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['vi-VN'] })
    render(<LanguageProvider initialLang="en"><Probe /></LanguageProvider>)
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByTestId('probe').textContent?.startsWith('en|')).toBe(true)
  })

  it('a guide rendered in the other variant than its pin (the server did not pin it) keeps the old behaviour, reload included', () => {
    at(VI)
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['vi-VN'] })
    render(<LanguageProvider initialLang="en"><Probe /></LanguageProvider>)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
