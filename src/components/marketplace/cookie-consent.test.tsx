// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { CookieConsent } from './cookie-consent'
import { consentAnswered, hasAdConsent, hasAnalyticsConsent, personalizationAllowed, readConsent, setConsent } from '@/lib/consent'
import { CONSENT_COPY_VERSION } from '@/lib/consent-value'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The route, which the /signin deferral reads twice: `usePathname()` for client navigations and
// `window.location.pathname` inside the timer. Tests move both together through `goTo`.
const nav = vi.hoisted(() => ({ pathname: '/' }))
vi.mock('next/navigation', async (orig) => ({ ...(await orig<typeof import('next/navigation')>()), usePathname: () => nav.pathname }))

// ── Consent v2 on the slim bottom bar ───────────────────────────────────────────────────────────
// v2 (owner decision 2026-09-23): three purposes — personalization, analytics, advertising — each its
// own switch, ALL OFF until chosen, refusing exactly as easy as accepting, every choice recorded.
// The bar (owner, 2026-09-25): one question, Accept / Decline / Settings of equal weight, Settings
// expands the same bar into the switches. v1 pre-ticked "Personalized", coupled the toggles, and
// stored one nested level.

// A fresh in-memory localStorage per test: the runtime's global one is not a full Storage here.
function clearConsent() {
  const m = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  })
  document.cookie.split(';').forEach((c) => { document.cookie = `${c.split('=')[0].trim()}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/` })
}

let beacons: string[] = []

const ui = () => <LanguageProvider><CookieConsent /></LanguageProvider>
const mount = () => render(ui())
const goTo = (path: string) => { nav.pathname = path; window.history.replaceState(null, '', path) }
const advance = (ms: number) => act(async () => { vi.advanceTimersByTime(ms) })
/** The first-visit bar, shown and past its arming window. (Two steps: the window starts from the
 *  render that shows the bar, which lands when the first `act` flushes.) */
async function openFirstVisitBar() {
  mount()
  await advance(4_000)
  await advance(400)
}
/** …then Settings, and past the window that re-arms on the view change. */
async function openFirstVisitSettings() {
  await openFirstVisitBar()
  fireEvent.click(screen.getByRole('button', { name: /^Choose/ }))
  await advance(400)
}

const sw = (name: RegExp) => screen.getByRole('switch', { name })
const btn = (name: RegExp) => screen.getByRole('button', { name })
const checked = (el: HTMLElement) => el.getAttribute('aria-checked') === 'true'
const bar = () => screen.queryByRole('dialog', { name: /^Cookie consent/ })
const tokens = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/)
/** What is granted right now, as [personalization, analytics, advertising]. */
const granted = () => [personalizationAllowed(), hasAnalyticsConsent(), hasAdConsent()]
const ALL = [true, true, true]
const NONE = [false, false, false]
const META = { surface: 'banner', action: 'save', locale: 'en' } as const

beforeEach(() => {
  vi.useFakeTimers()
  clearConsent()
  beacons = []
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: (url: string) => { beacons.push(url); return true } })
  delete (window as unknown as { Capacitor?: unknown }).Capacitor
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.documentElement.classList.remove('kb-open')
  document.querySelectorAll('.overlay-scrim').forEach((n) => n.remove())
  goTo('/')
})

describe('CookieConsent — the question', () => {
  it('appears 4s after mount, not before', async () => {
    mount()
    await advance(3_999)
    expect(bar()).toBeNull()
    await advance(1)
    expect(bar()).not.toBeNull()
  })

  it('Accept grants all three purposes, is recorded, and closes', async () => {
    await openFirstVisitBar()
    fireEvent.click(btn(/^Sounds good/))
    expect(granted()).toEqual(ALL)
    expect(beacons).toEqual(['/api/consent'])
    await advance(500)
    expect(bar()).toBeNull()
  })

  it('Decline is an ANSWER that grants nothing, and is recorded', async () => {
    await openFirstVisitBar()
    fireEvent.click(btn(/^No thanks/))
    expect(consentAnswered()).toBe(true)
    expect(granted()).toEqual(NONE)
    expect(beacons).toEqual(['/api/consent'])
  })

  it('Settings stores nothing — it opens the switches in the same bar, all OFF', async () => {
    await openFirstVisitSettings()
    expect(consentAnswered()).toBe(false)
    expect(screen.getByRole('dialog', { name: 'Your choices' })).not.toBeNull()
    for (const n of [/^Personalization$/, /^Analytics$/, /^Advertising$/]) expect(checked(sw(n))).toBe(false)
  })

  it('names every purpose and vendor, says why nothing is on yet, and never promises "keep you signed in"', async () => {
    await openFirstVisitBar()
    const text = bar()!.textContent ?? ''
    expect(text).toContain('Google Analytics')
    expect(text).toContain('Meta')
    expect(text).toMatch(/sensitive personal data under Vietnamese law/)
    expect(text).not.toMatch(/keep you signed in/i)
  })

  it('asks (a request, not a notice) and says "suggest", never "rank" — /legal/ranking promises results are not reordered by personal data', async () => {
    await openFirstVisitBar()
    expect(bar()!.textContent).toMatch(/Can we use cookies to suggest listings you’ll like.*\?/)
    expect(bar()!.textContent).not.toMatch(/\brank|reorder/i)
  })

  it('⛔ the friendly rewrite (2026-10-01c): a visible warm title, while the dialog’s name still starts "Cookie consent"', async () => {
    await openFirstVisitBar()
    expect(bar()!.textContent).toContain('Help us make eno better for you')
    expect(bar()!.getAttribute('aria-labelledby')).toBeTruthy()
    expect(document.getElementById(bar()!.getAttribute('aria-labelledby')!)!.textContent).toBe('Cookie consent: Help us make eno better for you')
    // …and it says the choice is not final — the withdrawal path is named in the first layer.
    expect(bar()!.textContent).toMatch(/change this anytime in Cookie settings/)
  })

  it('⛔ each friendly label is unambiguous to a screen reader: the aria-label starts with the visible words, then says the effect', async () => {
    await openFirstVisitBar()
    for (const [visible, effect] of [['Sounds good', 'accept all'], ['No thanks', 'decline all'], ['Choose', 'pick what to allow']]) {
      const b = screen.getByRole('button', { name: new RegExp(`^${visible}`) })
      expect(b.textContent).toBe(visible)
      expect(b.getAttribute('aria-label')).toBe(`${visible} — ${effect}`)
    }
  })

  it('⛔ "Sounds good" records allow_all and "No thanks" records decline_all, each under the CURRENT copy version', async () => {
    const sent: Blob[] = []
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: (_u: string, b: Blob) => { sent.push(b); return true } })
    await openFirstVisitBar()
    fireEvent.click(btn(/^Sounds good/))
    cleanup()
    clearConsent()
    await openFirstVisitBar()
    fireEvent.click(btn(/^No thanks/))
    const bodies = await Promise.all(sent.map(async (b) => JSON.parse(await b.text())))
    expect(bodies.map((x) => [x.action, x.copy])).toEqual([['allow_all', CONSENT_COPY_VERSION], ['decline_all', CONSENT_COPY_VERSION]])
  })

  it('never auto-opens once a choice is stored', async () => {
    setConsent({ p: false, a: false, d: false }, META)
    mount()
    await advance(10_000)
    expect(bar()).toBeNull()
  })

  it('⛔ a visitor holding a bare v1 "all" is ASKED AGAIN, and nothing is granted meanwhile', async () => {
    localStorage.setItem('eno-cookie-consent', 'all')
    document.cookie = 'eno-consent=all; path=/'
    expect(hasAdConsent()).toBe(false)
    mount()
    await advance(5_000)
    expect(bar()).not.toBeNull()
  })

  it('a visitor who answered "essential" under v1 is NOT asked again', async () => {
    localStorage.setItem('eno-cookie-consent', 'essential')
    mount()
    await advance(5_000)
    expect(bar()).toBeNull()
  })

  it('fired on /signin it is deferred, not dropped — and shown on the next page', async () => {
    goTo('/signin')
    const r = mount()
    await advance(6_000)
    expect(bar()).toBeNull()
    goTo('/')
    r.rerender(ui())
    await advance(0)
    expect(bar()).not.toBeNull()
  })

  it('⛔ already up when the visitor arrives at /signin, it steps aside — and returns on the next page', async () => {
    const r = mount()
    await advance(4_000)
    expect(bar()).not.toBeNull()
    goTo('/signin')
    r.rerender(ui())
    await advance(500)
    expect(bar()).toBeNull()
    goTo('/')
    r.rerender(ui())
    await advance(0)
    expect(bar()).not.toBeNull()
  })
})

describe('CookieConsent — the switches (consent v2)', () => {
  it('⛔ Save with nothing switched on is a REFUSAL, not a yes', async () => {
    await openFirstVisitSettings()
    fireEvent.click(btn(/^Save my choices$/))
    expect(consentAnswered()).toBe(true)
    expect(granted()).toEqual(NONE)
  })

  it.each([
    [/^Personalization$/, [true, false, false]],
    [/^Analytics$/, [false, true, false]],
    [/^Advertising$/, [false, false, true]],
  ] as const)('⛔ each switch maps ONLY to its own purpose (%s)', async (name, expected) => {
    await openFirstVisitSettings()
    fireEvent.click(sw(name))
    // Independent: flipping one never moves another (v1 coupled ads ⇒ personalized).
    expect([sw(/^Personalization$/), sw(/^Analytics$/), sw(/^Advertising$/)].map(checked)).toEqual(expected)
    fireEvent.click(btn(/^Save my choices$/))
    expect(granted()).toEqual(expected)
  })

  it('"Allow all" grants all three; "Decline all" grants none — and both are recorded', async () => {
    await openFirstVisitSettings()
    fireEvent.click(btn(/^Allow all$/))
    expect(granted()).toEqual(ALL)
    expect(beacons).toEqual(['/api/consent'])
    cleanup()
    clearConsent()
    await openFirstVisitSettings()
    fireEvent.click(btn(/^Decline all$/))
    expect(consentAnswered()).toBe(true)
    expect(granted()).toEqual(NONE)
    expect(beacons).toEqual(['/api/consent', '/api/consent'])
  })

  it('⛔ Advertising alone reaches META: Google is named only "if Analytics is on too" (GA is never loaded without it)', async () => {
    await openFirstVisitSettings()
    const desc = document.getElementById(sw(/^Advertising$/).getAttribute('aria-describedby')!)!.textContent ?? ''
    expect(desc).toContain('with Meta (and with Google, if Analytics is on too)')
    expect(desc).not.toMatch(/Meta and Google/)
  })

  it('⛔ the Vietnamese says the email is HASHED ("băm"), never "mã hoá" — hashing is not encryption', async () => {
    render(<LanguageProvider initialLang="vi" initialViDict={{}}><CookieConsent /></LanguageProvider>)
    await advance(4_000)
    await advance(400)
    fireEvent.click(screen.getByRole('button', { name: /^Tùy chọn/ }))
    await advance(400)
    const desc = document.getElementById(screen.getByRole('switch', { name: /^Quảng cáo$/ }).getAttribute('aria-describedby')!)!.textContent ?? ''
    expect(desc).toContain('được xáo trộn (băm)')
    expect(desc).toContain('nếu Phân tích cũng bật')
    expect(desc).not.toMatch(/mã hoá|mã hóa/)
  })

  it('⛔ the purpose descriptions — where each vendor is named — are text-xs body copy, not the bar’s smallest type', async () => {
    await openFirstVisitSettings()
    for (const n of [/^Personalization$/, /^Analytics$/, /^Advertising$/]) {
      const cls = document.getElementById(sw(n).getAttribute('aria-describedby')!)!.className.split(/\s+/)
      expect(cls).toContain('text-xs')
      expect(cls).toContain('text-muted-foreground')
      expect(cls).not.toContain('text-2xs')
      expect(cls).not.toContain('text-ink-4')
    }
  })

  it('the switches view says declining costs nothing, sign-in included, and never says "rank"', async () => {
    await openFirstVisitSettings()
    const text = screen.getByRole('dialog', { name: 'Your choices' }).textContent ?? ''
    expect(text).toMatch(/including sign-in/)
    expect(text).not.toMatch(/\brank|reorder/i)
  })

  it('⛔ "Save my choices", "Decline all" and "Allow all" carry EQUAL weight — identical classes', async () => {
    await openFirstVisitSettings()
    const [s, d, a] = [/^Save my choices$/, /^Decline all$/, /^Allow all$/].map(btn)
    expect(d.className).toBe(a.className)
    expect(s.className).toBe(a.className)
  })
})

describe('CookieConsent — re-open (footer / settings / privacy)', () => {
  it('the footer re-open acts on its first click — a deliberate open is not armed', async () => {
    mount()
    await act(async () => { window.dispatchEvent(new CustomEvent('eno:open-consent')) })
    fireEvent.click(btn(/^Decline all$/))
    expect(consentAnswered()).toBe(true)
    expect(granted()).toEqual(NONE)
  })

  it('pre-fills the switches from the stored answer and saves changes (withdrawal)', async () => {
    setConsent({ p: false, a: true, d: false }, META)
    mount()
    await act(async () => { window.dispatchEvent(new CustomEvent('eno:open-consent')) })
    expect(screen.getByRole('dialog', { name: 'Your choices' })).not.toBeNull()
    expect([sw(/^Personalization$/), sw(/^Analytics$/), sw(/^Advertising$/)].map(checked)).toEqual([false, true, false])
    fireEvent.click(sw(/^Analytics$/)) // withdraw
    fireEvent.click(btn(/^Save my choices$/))
    expect(hasAnalyticsConsent()).toBe(false)
    expect(readConsent()).toMatchObject({ p: false, a: false, d: false, source: 'v2' })
  })

  it('⛔ a deliberate open inside the first-visit delay is NOT overrun by the pending auto-open', async () => {
    mount()
    await advance(1_000)
    await act(async () => { window.dispatchEvent(new CustomEvent('eno:open-consent')) })
    fireEvent.click(sw(/^Analytics$/))
    await advance(5_000) // the 4 s auto-open would have fired here
    expect(checked(sw(/^Analytics$/))).toBe(true)
    fireEvent.click(btn(/^Save my choices$/))
    expect(hasAnalyticsConsent()).toBe(true)
  })
})

describe('CookieConsent — inside the native app', () => {
  it('⛔ analytics and advertising are shown LOCKED OFF, and "Accept" grants personalization only', async () => {
    ;(window as unknown as { Capacitor: unknown }).Capacitor = { isNativePlatform: () => true }
    await openFirstVisitBar()
    expect(bar()!.textContent).toMatch(/Analytics and advertising are always off in the app/)
    fireEvent.click(btn(/^Sounds good/))
    // Stored as p only — the record must not claim a grant the app can never act on.
    expect(readConsent()).toMatchObject({ p: true, a: false, d: false })
  })

  it('⛔ the switches render the two locked', async () => {
    ;(window as unknown as { Capacitor: unknown }).Capacitor = { isNativePlatform: () => true }
    await openFirstVisitSettings()
    expect(sw(/^Analytics$/).hasAttribute('data-disabled')).toBe(true)
    expect(sw(/^Advertising$/).hasAttribute('data-disabled')).toBe(true)
    fireEvent.click(btn(/^Allow all$/))
    expect(readConsent()).toMatchObject({ p: true, a: false, d: false })
  })
})

describe('CookieConsent — the bar', () => {
  it('has no photograph (the team photo was the first-visit LCP)', async () => {
    await openFirstVisitBar()
    expect(bar()!.querySelector('img')).toBeNull()
    expect(document.querySelector('img[src*="consent-team"]')).toBeNull()
  })

  it('⛔ Sounds good, No thanks and Choose carry EQUAL weight — identical classes, only the word differs', async () => {
    await openFirstVisitBar()
    const [a, d, s] = ['Sounds good', 'No thanks', 'Choose'].map((n) => screen.getByRole('button', { name: new RegExp(`^${n}`) }))
    expect(a.getAttribute('class')).toBe(d.getAttribute('class'))
    expect(a.getAttribute('class')).toBe(s.getAttribute('class'))
    // A real 44px target each, not a text link beside a filled button.
    expect(tokens(a)).toContain('min-h-11')
  })

  it('where there is no web tab bar (native tabs) it keeps the Android WebView inset fallback', async () => {
    await openFirstVisitBar()
    expect(tokens(bar()!.parentElement!)).toContain('[html.native-tabs_&]:bottom-[calc(0.5rem+max(env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px)))]')
  })

  it('docks at the bottom, above the tab bar and the safe area — never centred', async () => {
    await openFirstVisitBar()
    const wrapper = bar()!.parentElement!
    expect(tokens(wrapper)).toEqual(expect.arrayContaining([
      'pointer-events-none', 'fixed', 'items-end',
      'bottom-[calc(5rem+max(env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px)))]', 'lg:bottom-4',
    ]))
    expect(tokens(wrapper)).not.toContain('items-center')
    expect(tokens(wrapper)).not.toContain('inset-0')
    // …and the bar itself takes every tap in its box, so none reaches the page underneath.
    expect(tokens(bar()!)).toContain('pointer-events-auto')
  })

  it('⛔ a tap already in flight when the bar appears records nothing (400ms arming)', async () => {
    mount()
    await advance(4_000) // the bar has just appeared
    fireEvent.click(btn(/^Sounds good/))
    expect(consentAnswered()).toBe(false)
    expect(bar()).not.toBeNull()
    await advance(400)
    fireEvent.click(btn(/^Sounds good/))
    expect(granted()).toEqual(ALL)
  })

  it('⛔ a tap on the page does not dismiss it — it stays until it is answered', async () => {
    // Part of the page BEFORE the bar renders: Base UI deliberately ignores presses on elements
    // injected after its popup (third-party overlays), which would make this test pass vacuously.
    const page = document.createElement('button')
    document.body.appendChild(page)
    await openFirstVisitBar()
    fireEvent.pointerDown(page, { pointerType: 'mouse', button: 0 })
    fireEvent.mouseDown(page, { button: 0 })
    fireEvent.pointerUp(page, { pointerType: 'mouse', button: 0 })
    fireEvent.mouseUp(page, { button: 0 })
    fireEvent.click(page, { button: 0 })
    await advance(500)
    expect(bar()).not.toBeNull()
    expect(consentAnswered()).toBe(false)
    page.remove()
  })

  it('Escape still closes it without storing anything', async () => {
    await openFirstVisitBar()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await advance(500)
    expect(bar()).toBeNull()
    expect(consentAnswered()).toBe(false)
  })

  it('⛔ a double tap on Settings cannot land its second half on a choice', async () => {
    await openFirstVisitBar()
    fireEvent.click(btn(/^Choose/))
    fireEvent.click(btn(/^Allow all$/))
    expect(consentAnswered()).toBe(false)
    await advance(400)
    fireEvent.click(btn(/^Save my choices$/))
    expect(consentAnswered()).toBe(true)
    expect(granted()).toEqual(NONE)
  })

  it('Settings moves focus into the bar (the pressed button unmounts with the ask view)', async () => {
    await openFirstVisitBar()
    const settings = btn(/^Choose/)
    settings.focus()
    fireEvent.click(settings)
    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'Your choices' }))
  })

  it('the auto-prompt takes no focus from the page', async () => {
    mount()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    await advance(5_000)
    expect(bar()).not.toBeNull()
    expect(document.activeElement).toBe(input)
    input.remove()
  })

  it('⛔ waits while a scrimmed overlay is open, instead of covering its bottom actions', async () => {
    mount()
    const scrim = document.createElement('div')
    scrim.className = 'overlay-scrim'
    document.body.appendChild(scrim)
    await advance(6_000)
    expect(bar()).toBeNull()
    scrim.remove()
    await advance(250)
    expect(bar()).not.toBeNull()
  })

  it('⛔ steps aside when an overlay opens while it is up, and comes back re-armed when it closes', async () => {
    await openFirstVisitBar()
    const scrim = document.createElement('div')
    scrim.className = 'overlay-scrim'
    document.body.appendChild(scrim)
    await advance(250)
    await advance(500)
    expect(bar()).toBeNull()
    scrim.remove()
    await advance(250)
    expect(bar()).not.toBeNull()
    // Back under a finger that just closed the overlay: the first 400ms record nothing.
    fireEvent.click(btn(/^Sounds good/))
    expect(consentAnswered()).toBe(false)
    await advance(400)
    fireEvent.click(btn(/^Sounds good/))
    expect(granted()).toEqual(ALL)
  })

  it('is display:none the instant a scrim or the keyboard appears, before the state catches up', async () => {
    await openFirstVisitBar()
    expect(tokens(bar()!.parentElement!)).toEqual(expect.arrayContaining(['[html.kb-open_&]:hidden', '[body:has(.overlay-scrim)_&]:hidden']))
  })

  it('⛔ waits while the keyboard is up', async () => {
    mount()
    document.documentElement.classList.add('kb-open')
    await advance(6_000)
    expect(bar()).toBeNull()
    document.documentElement.classList.remove('kb-open')
    await advance(250)
    expect(bar()).not.toBeNull()
  })

  it('leaving /signin with an overlay still open hands the deferral to the wait, not to the bar', async () => {
    goTo('/signin')
    const r = mount()
    await advance(6_000)
    const scrim = document.createElement('div')
    scrim.className = 'overlay-scrim'
    document.body.appendChild(scrim)
    goTo('/')
    r.rerender(ui())
    await advance(1_000)
    expect(bar()).toBeNull()
    scrim.remove()
    await advance(250)
    expect(bar()).not.toBeNull()
  })

  it('a choice made while it waits (another tab, the footer) ends the wait for good', async () => {
    mount()
    document.documentElement.classList.add('kb-open')
    await advance(6_000)
    setConsent({ p: false, a: false, d: false }, META)
    document.documentElement.classList.remove('kb-open')
    await advance(1_000)
    expect(bar()).toBeNull()
  })

  it('a deliberate open while it waits supersedes the wait — closing it does not bring the auto-prompt back', async () => {
    mount()
    document.documentElement.classList.add('kb-open')
    await advance(6_000)
    await act(async () => { window.dispatchEvent(new CustomEvent('eno:open-consent')) })
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await advance(500)
    expect(screen.queryByRole('dialog')).toBeNull()
    document.documentElement.classList.remove('kb-open')
    await advance(1_000)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

/**
 * ⛔ THE RECORDED COPY VERSION MUST CHANGE WHEN THE WORDS DO. Every consent record carries
 * CONSENT_COPY_VERSION so it can say which notice a "yes" was given to; a copy edit under an unchanged
 * version makes every later record claim the OLD words. This fingerprints every tr() pair in the card
 * (English AND Vietnamese) and pins it to the version.
 * When this fails: bump CONSENT_COPY_VERSION in src/lib/consent-value.ts (and note why there), then
 * add the new version with the hash this test prints. Never just update the hash under the old version.
 */
const COPY_FINGERPRINTS: Record<string, string> = {
  '2026-09-24': '2a8cc32679e60f73',
  '2026-10-01': '70c54c3ebf2cb94c',
  '2026-10-01b': 'a2d0ceff8ab7b8ca',
  '2026-10-01c': '428474a228f1b272',
}

describe('CookieConsent — the copy version is held to the words', () => {
  it('⛔ the card’s copy matches the fingerprint recorded for CONSENT_COPY_VERSION', () => {
    const src = readFileSync(join(__dirname, 'cookie-consent.tsx'), 'utf8')
    const pairs = [...src.matchAll(/\btr\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*,?\s*\)/g)].map((m) => [m[1], m[2]])
    expect(pairs.length).toBeGreaterThan(15) // the extractor is really reading the card
    // ⛔ …AND IT READS ALL OF IT. Copy written any other way — `<Tr>`, a template literal, a double-quoted
    // or three-argument tr() — would change the notice without moving the hash, so every tr( outside a
    // comment must be one the extractor matched, and the card must not use <Tr> at all.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code.match(/\btr\(/g)?.length, 'a tr() call the fingerprint cannot read').toBe(pairs.length)
    expect(code).not.toMatch(/<Tr\b/)
    const hash = createHash('sha256').update(JSON.stringify(pairs)).digest('hex').slice(0, 16)
    expect({ version: CONSENT_COPY_VERSION, hash }).toEqual({ version: CONSENT_COPY_VERSION, hash: COPY_FINGERPRINTS[CONSENT_COPY_VERSION] })
  })
})
