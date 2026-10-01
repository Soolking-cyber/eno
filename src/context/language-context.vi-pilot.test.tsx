// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

/**
 * ⛔ THE `/vi` PILOT, PROVIDER HALF (SEO wave B, V3a — dormant until V5). With the pilot ON (the lists are
 * switched on here by a mock; the merged constants are empty), a piloted plain path is pinned to `en`
 * and its `/vi` twin to `vi`: the mount never reloads across them, whatever the visitor stored, and a
 * switch goes to the twin with `location.assign`. With the lists OFF (the merged state) nothing changes.
 */
const pilot = vi.hoisted(() => ({ on: true }))
vi.mock('@/lib/lang-pinned', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/lang-pinned')>()
  const lists = () => (pilot.on ? { live: ['/', '/c/furniture-appliances'], retired: [] } : { live: [], retired: [] })
  return {
    ...real,
    pinnedVariant: (p: string) => real.pinnedVariant(p, lists()),
    pinnedPair: (p: string) => real.pinnedPair(p, lists()),
  }
})
const { LanguageProvider, useLanguage } = await import('@/context/language-context')
type Language = import('@/context/language-context').Language

let setLangRef: ((l: Language) => void) | null = null
function Probe() {
  const { lang, setLang } = useLanguage()
  React.useEffect(() => { setLangRef = setLang })
  return <p data-testid="probe">{lang}</p>
}
const reload = vi.fn()
const assign = vi.fn()
const at = (pathname: string, search = '') =>
  Object.defineProperty(window, 'location', { configurable: true, value: { pathname, hostname: 'eno.vn', search, hash: '', reload, assign } })
const fake = (m: Record<string, string>) => ({ getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => { m[k] = v }, removeItem: (k: string) => { delete m[k] }, clear: () => { for (const k of Object.keys(m)) delete m[k] } })
let store: Record<string, string>

beforeEach(() => {
  pilot.on = true
  reload.mockReset(); assign.mockReset()
  store = {}
  Object.defineProperty(window, 'localStorage', { configurable: true, value: fake(store) })
  Object.defineProperty(window, 'sessionStorage', { configurable: true, value: fake({}) })
  Reflect.deleteProperty(document, 'cookie')
  document.cookie = 'lang=; path=/; max-age=0'
  document.cookie = 'lang-choice=; path=/; max-age=0'
  Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['en-US'] })
})
afterEach(() => { cleanup(); setLangRef = null })
const shown = () => screen.getByTestId('probe').textContent

describe('LanguageProvider under the /vi pilot (lists on)', () => {
  it('a stored Vietnamese choice on the plain piloted `/`: no reload, the state stays en, no cookie written', () => {
    at('/')
    store.lang = 'vi'
    render(<LanguageProvider initialLang="en"><Probe /></LanguageProvider>)
    expect(reload).not.toHaveBeenCalled()
    expect(assign).not.toHaveBeenCalled()
    expect(shown()).toBe('en')
    expect(document.cookie).not.toContain('lang=vi')
  })

  it('a Vietnamese device on /c/furniture-appliances: no reload, stays en', () => {
    at('/c/furniture-appliances')
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['vi-VN', 'vi'] })
    render(<LanguageProvider initialLang="en"><Probe /></LanguageProvider>)
    expect(reload).not.toHaveBeenCalled()
    expect(shown()).toBe('en')
  })

  it('an English choice on `/vi`: no reload, stays vi', () => {
    at('/vi')
    store.lang = 'en'
    render(<LanguageProvider initialLang="vi" initialViDict={{}}><Probe /></LanguageProvider>)
    expect(reload).not.toHaveBeenCalled()
    expect(shown()).toBe('vi')
  })

  it('setLang round trip: vi on `/` goes to `/vi`, en on `/vi` comes back to `/`, query kept, choice stored', () => {
    at('/', '?utm_source=x')
    render(<LanguageProvider initialLang="en"><Probe /></LanguageProvider>)
    act(() => setLangRef!('vi'))
    expect(assign).toHaveBeenLastCalledWith('/vi?utm_source=x')
    expect(store.lang).toBe('vi')
    expect(document.cookie).toContain('lang=vi')
    expect(reload).not.toHaveBeenCalled()
    cleanup()
    at('/vi', '?utm_source=x')
    render(<LanguageProvider initialLang="vi" initialViDict={{}}><Probe /></LanguageProvider>)
    act(() => setLangRef!('en'))
    expect(assign).toHaveBeenLastCalledWith('/?utm_source=x')
    expect(store.lang).toBe('en')
  })

  it('setLang on `/vi/c/furniture-appliances` goes to the plain category', () => {
    at('/vi/c/furniture-appliances')
    render(<LanguageProvider initialLang="vi" initialViDict={{}}><Probe /></LanguageProvider>)
    act(() => setLangRef!('en'))
    expect(assign).toHaveBeenCalledWith('/c/furniture-appliances')
  })

  it('a non-piloted page keeps reloading across variants as before', () => {
    at('/c/rentals')
    store.lang = 'vi'
    render(<LanguageProvider initialLang="en"><Probe /></LanguageProvider>)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('LanguageProvider with the lists off (the merged state)', () => {
  it('`/` negotiates exactly as before: a stored vi reloads into the vi variant', () => {
    pilot.on = false
    at('/')
    store.lang = 'vi'
    render(<LanguageProvider initialLang="en"><Probe /></LanguageProvider>)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(assign).not.toHaveBeenCalled()
  })
})
