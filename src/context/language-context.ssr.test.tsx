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
