// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

/**
 * ⛔ THE `/vi` PILOT'S CHROME (SEO wave B, V3b — dormant until V5; copy sheet CS-3 V3b-4…12, approved
 * 2026-10-01): the switcher, the suggestion banner, and the links a Vietnamese page renders. The lists
 * are switched on here by a mock; the merged constants are empty, and with them every piece below
 * renders nothing or returns its input.
 */
const pilot = vi.hoisted(() => ({ on: true }))
vi.mock('@/lib/lang-pinned', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/lang-pinned')>()
  const lists = () => (pilot.on ? { live: ['/', '/c/furniture-appliances'], retired: [] } : { live: [], retired: [] })
  return {
    ...real,
    get VI_PILOT() { return lists() },
    pinnedPair: (p: string, l?: Parameters<typeof real.pinnedPair>[1]) => real.pinnedPair(p, l ?? lists()),
    pinnedVariant: (p: string, l?: Parameters<typeof real.pinnedVariant>[1]) => real.pinnedVariant(p, l ?? lists()),
    stripViPrefix: (p: string, l?: Parameters<typeof real.stripViPrefix>[1]) => real.stripViPrefix(p, l ?? lists()),
    localizedHref: (h: string, v: string, l?: Parameters<typeof real.localizedHref>[2]) => real.localizedHref(h, v, l ?? lists()),
  }
})
const { BANNER_COPY, BANNER_DISMISS_KEY, LangSuggestionBanner, bannerFor } = await import('./lang-suggestion-banner')
const { LangPilotSwitch } = await import('./lang-pilot-switch')
const { LanguageProvider } = await import('@/context/language-context')

const ON = { live: ['/', '/c/furniture-appliances'], retired: [] as string[] }
const OFF = { live: [] as string[], retired: [] as string[] }
const prefs = (o: Partial<{ stored: string | null; cookie: string | null; languages: string[] }> = {}) => ({ stored: null, cookie: null, languages: ['en-US'], ...o })

describe('bannerFor — the visibility matrix (CS-3 V3b-7, V3b-10)', () => {
  it('plain piloted page, a Vietnamese visitor by stored choice, cookie or first supported browser language → the vi banner', () => {
    for (const p of [prefs({ stored: 'vi' }), prefs({ cookie: 'vi' }), prefs({ languages: ['vi-VN', 'en'] }), prefs({ languages: ['xx', 'vi'] })]) {
      expect(bannerFor('/', p, false, ON), JSON.stringify(p)).toMatchObject({ target: 'vi', href: '/vi' })
    }
    expect(bannerFor('/c/furniture-appliances', prefs({ stored: 'vi' }), false, ON)).toMatchObject({ target: 'vi', href: '/vi/c/furniture-appliances' })
  })

  it('the stored choice outranks the cookie, which outranks the browser', () => {
    expect(bannerFor('/', prefs({ stored: 'en', cookie: 'vi', languages: ['vi'] }), false, ON)).toBeNull()
    expect(bannerFor('/', prefs({ cookie: 'en', languages: ['vi'] }), false, ON)).toBeNull()
  })

  it('/vi page, an English (or machine-translated) visitor → the en banner, choice kept', () => {
    expect(bannerFor('/vi', prefs(), false, ON)).toEqual({ target: 'en', href: '/', choice: 'en' })
    expect(bannerFor('/vi/c/furniture-appliances', prefs({ stored: 'ko' }), false, ON)).toEqual({ target: 'en', href: '/c/furniture-appliances', choice: 'ko' })
  })

  it('no banner: matching language, no known preference, dismissed, or a page outside the live list', () => {
    expect(bannerFor('/', prefs(), false, ON)).toBeNull()
    expect(bannerFor('/vi', prefs({ stored: 'vi' }), false, ON)).toBeNull()
    expect(bannerFor('/', prefs({ languages: ['xx-YY'] }), false, ON)).toBeNull()
    expect(bannerFor('/', prefs({ stored: 'vi' }), true, ON)).toBeNull()
    for (const p of ['/c/rentals', '/vi/c/rentals', '/thanh-ly-do-gia-dung-cu-tphcm', '/about']) expect(bannerFor(p, prefs({ stored: 'vi' }), false, ON), p).toBeNull()
  })

  it('lists off (the merged state): never', () => {
    for (const p of ['/', '/vi', '/c/furniture-appliances']) expect(bannerFor(p, prefs({ stored: 'vi' }), false, OFF), p).toBeNull()
  })
})

describe('<LangSuggestionBanner>', () => {
  const assign = vi.fn()
  const at = (pathname: string) => Object.defineProperty(window, 'location', { configurable: true, value: { pathname, hostname: 'eno.vn', search: '', hash: '', reload: vi.fn(), assign } })
  const fake = (m: Record<string, string>) => ({ getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => { m[k] = v }, removeItem: (k: string) => { delete m[k] }, clear: () => {} })
  let store: Record<string, string>
  beforeEach(() => {
    pilot.on = true
    assign.mockReset()
    store = {}
    Object.defineProperty(window, 'localStorage', { configurable: true, value: fake(store) })
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: fake({}) })
    Reflect.deleteProperty(document, 'cookie')
    document.cookie = 'lang=; path=/; max-age=0'
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['vi-VN'] })
  })
  afterEach(() => cleanup())

  it('shows the Vietnamese literal with lang="vi" on the root, the twin link with hreflang, and a Vietnamese dismiss label', () => {
    at('/')
    render(<LanguageProvider initialLang="en"><LangSuggestionBanner /></LanguageProvider>)
    const text = screen.getByText(BANNER_COPY.vi.text, { exact: false })
    expect(text.closest('[lang]')?.getAttribute('lang')).toBe('vi')
    const link = screen.getByRole('link', { name: 'Xem bản tiếng Việt' })
    expect(link.getAttribute('href')).toBe('/vi')
    expect(link.getAttribute('hreflang')).toBe('vi-VN')
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeTruthy()
  })

  it('one tap goes to the twin and stores the choice', () => {
    at('/')
    render(<LanguageProvider initialLang="en"><LangSuggestionBanner /></LanguageProvider>)
    act(() => { screen.getByRole('link', { name: 'Xem bản tiếng Việt' }).click() })
    expect(assign).toHaveBeenCalledWith('/vi')
    expect(store.lang).toBe('vi')
  })

  it('dismiss hides it and is remembered', () => {
    at('/')
    render(<LanguageProvider initialLang="en"><LangSuggestionBanner /></LanguageProvider>)
    act(() => { screen.getByRole('button', { name: 'Đóng' }).click() })
    expect(screen.queryByText(BANNER_COPY.vi.text, { exact: false })).toBeNull()
    expect(store[BANNER_DISMISS_KEY]).toBe('1')
    cleanup()
    render(<LanguageProvider initialLang="en"><LangSuggestionBanner /></LanguageProvider>)
    expect(screen.queryByText(BANNER_COPY.vi.text, { exact: false })).toBeNull()
  })

  it('on /vi for an English browser: the English literal, lang="en", "Dismiss"', () => {
    at('/vi')
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['en-US'] })
    render(<LanguageProvider initialLang="vi" initialViDict={{}}><LangSuggestionBanner /></LanguageProvider>)
    expect(screen.getByText(BANNER_COPY.en.text, { exact: false }).closest('[lang]')?.getAttribute('lang')).toBe('en')
    expect(screen.getByRole('link', { name: 'View in English' }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy()
  })

  it('renders nothing on the server (after-mount only)', async () => {
    const { renderToString } = await import('react-dom/server')
    at('/')
    expect(renderToString(<LanguageProvider initialLang="en"><LangSuggestionBanner /></LanguageProvider>)).not.toContain(BANNER_COPY.vi.text)
  })

  it('the copy is CS-3\'s, verbatim', () => {
    expect(BANNER_COPY).toEqual({
      vi: { text: 'Trang này có bản tiếng Việt.', link: 'Xem bản tiếng Việt', dismiss: 'Đóng', hrefLang: 'vi-VN' },
      en: { text: 'This page is also available in English.', link: 'View in English', dismiss: 'Dismiss', hrefLang: 'en' },
    })
  })
})

describe('<LangPilotSwitch> (CS-3 V3b-4, V3b-5)', () => {
  beforeEach(() => { pilot.on = true })
  const props = async (path: string, lang: string) => {
    const el = await LangPilotSwitch({ path, params: Promise.resolve({ lang }) })
    return el ? (el as { props: Record<string, string> }).props : null
  }
  it('on a plain piloted page: "Tiếng Việt" to the /vi twin, hreflang vi-VN', async () => {
    expect(await props('/', 'en')).toEqual({ href: '/vi', target: 'vi', hrefLang: 'vi-VN', label: 'Tiếng Việt' })
    expect(await props('/c/furniture-appliances', 'en')).toMatchObject({ href: '/vi/c/furniture-appliances' })
  })
  it('on /vi: "English" to the plain path, hreflang en', async () => {
    expect(await props('/c/furniture-appliances', 'vi')).toEqual({ href: '/c/furniture-appliances', target: 'en', hrefLang: 'en', label: 'English' })
  })
  it('renders nothing outside the live list (no link to a /vi 404 from /c/rentals), or with the lists off', async () => {
    expect(await props('/c/rentals', 'en')).toBeNull()
    pilot.on = false
    expect(await props('/', 'en')).toBeNull()
  })
})

/**
 * Every link V3b localizes goes through `localizedHref` (plan V3b's list) — a source contract, since most
 * sites are server pages with a database behind them; the function itself is tested in lang-pinned.test.ts.
 */
describe('localizedHref at each link site (source contract)', () => {
  const src = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
  const SITES: [string, RegExp[]][] = [
    ['src/components/marketplace/header.tsx', [/href=\{localizedHref\('\/', variantOfLanguage\(lang\)\)\}\s*prefetch=\{false\}\s*data-header-logo/]],
    ['src/components/marketplace/mobile-nav.tsx', [/<Link href=\{localizedHref\('\/', variantOfLanguage\(lang\)\)\} prefetch=\{at\('\/'\)/]],
    ['src/components/marketplace/footer.tsx', [/<a href=\{localizedHref\(`\/c\/\$\{cat\.slug\}`, variantOfLanguage\(lang\)\)\}/]],
    ['src/app/[lang]/c/[category]/(index)/layout.tsx', [/<Link href=\{localizedHref\('\/', lang\)\} \/>/]],
    ['src/app/[lang]/c/[category]/[district]/page.tsx', [/<Link href=\{localizedHref\('\/', lang\)\} \/>/, /<Link href=\{localizedHref\(`\/c\/\$\{cat\.slug\}`, lang\)\} \/>/, /<Link href=\{localizedHref\(`\/c\/\$\{cat\.slug\}`, lang\)\} className=/]],
    ['src/app/[lang]/listings/[id]/(pdp)/page.tsx', [/<Link href=\{localizedHref\('\/', pageVariant\)\}/, /<Link href=\{localizedHref\(`\/c\/\$\{rawListing\.category\.slug\}`, pageVariant\)\}/]],
  ]
  it.each(SITES)('%s', (file, patterns) => {
    const s = src(file)
    for (const re of patterns) expect(s, String(re)).toMatch(re)
  })
  it('the sibling-category badges on the category page, both of them', () => {
    expect(src('src/app/[lang]/c/[category]/(index)/page.tsx').match(/render=\{<Link href=\{localizedHref\(`\/c\/\$\{c\.slug\}`, pageLang\(lang\)\)\} \/>\}/g)).toHaveLength(2)
  })
  it('the category head takes the pilot alternates (langAlternates is null off the list, and on eno.forum)', () => {
    const s = src('src/app/[lang]/c/[category]/(index)/page.tsx')
    expect(s).toMatch(/const pilot = langAlternates\(`\/c\/\$\{cat\.slug\}`, pageLang\(lang\), hostUrl\)/)
    expect(s).toMatch(/alternates: pilot \? \{ canonical: pilot\.canonical, languages: pilot\.languages \} : \{ canonical: url \}/)
    expect(s).toMatch(/pageShare\(\{ title, description, url \}\)/)
  })
  it('district chips stay plain: their /vi twins would 404', () => {
    expect(src('src/app/[lang]/c/[category]/[district]/page.tsx')).toMatch(/<Link href=\{`\/c\/\$\{cat\.slug\}\/\$\{d\.slug\}`\} \/>/)
  })
})
