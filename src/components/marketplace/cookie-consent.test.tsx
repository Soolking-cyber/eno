// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { CookieConsent } from './cookie-consent'
import { getConsent, setConsent } from '@/lib/consent'

// The route, which the /signin deferral reads twice: `usePathname()` for client navigations and
// `window.location.pathname` inside the timer. Tests move both together through `goTo`.
const nav = vi.hoisted(() => ({ pathname: '/' }))
vi.mock('next/navigation', async (orig) => ({ ...(await orig<typeof import('next/navigation')>()), usePathname: () => nav.pathname }))

// ── Consent must be GIVEN, never defaulted (audit #8) ─────────────────────────────────────────────
// The ad-personalization toggle used to start ON, so "Cookie settings" → Save on a first visit
// recorded consent to Meta/Google retargeting; and turning Personalized off with ads on saved 'all'.

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
  fireEvent.click(screen.getByRole('button', { name: /^Settings$/ }))
  await advance(400)
}

const toggle = (name: RegExp) => screen.getByRole('button', { name })
const bar = () => screen.queryByRole('dialog', { name: 'Cookie consent' })
const tokens = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/)

beforeEach(() => { vi.useFakeTimers(); clearConsent() })
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.documentElement.classList.remove('kb-open')
  document.querySelectorAll('.overlay-scrim').forEach((n) => n.remove())
  goTo('/')
})

describe('CookieConsent — settings view', () => {
  it('⛔ first visit → Settings → Save records NO ad consent', async () => {
    await openFirstVisitSettings()
    expect(toggle(/Ad personalization/).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    expect(getConsent()).toBe('personalized')
  })

  it('turning ads ON implies personalization on', async () => {
    await openFirstVisitSettings()
    fireEvent.click(toggle(/Personalized/)) // off
    fireEvent.click(toggle(/Ad personalization/)) // on → perso back on
    expect(toggle(/Personalized/).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    expect(getConsent()).toBe('all')
  })

  it('⛔ turning Personalized OFF with ads on is a "no", not "all"', async () => {
    await openFirstVisitSettings()
    fireEvent.click(toggle(/Ad personalization/)) // on
    fireEvent.click(toggle(/Personalized/)) // off → ads off too
    expect(toggle(/Ad personalization/).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    expect(getConsent()).toBe('essential')
  })
})

// ── The slim bottom bar (owner, 2026-09-25) ────────────────────────────────────────────────────────
// Presentation changed; the legal behaviour did not. The first block pins what each choice stores
// and when the prompt appears — the same as the centred card it replaced.

describe('CookieConsent — what each choice stores (unchanged)', () => {
  it('appears 4s after mount, not before', async () => {
    mount()
    await advance(3_999)
    expect(bar()).toBeNull()
    await advance(1)
    expect(bar()).not.toBeNull()
  })

  it('Accept stores "all" and closes', async () => {
    await openFirstVisitBar()
    fireEvent.click(screen.getByRole('button', { name: /^Accept$/ }))
    expect(getConsent()).toBe('all')
    await advance(500)
    expect(bar()).toBeNull()
  })

  it('Decline stores "essential" and closes', async () => {
    await openFirstVisitBar()
    fireEvent.click(screen.getByRole('button', { name: /^Decline$/ }))
    expect(getConsent()).toBe('essential')
  })

  it('Settings stores nothing — it opens the detailed choices in the same bar', async () => {
    await openFirstVisitSettings()
    expect(getConsent()).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Your choices' })).not.toBeNull()
    expect(toggle(/Personalized/)).not.toBeNull()
  })

  it('never auto-opens once a choice is stored', async () => {
    setConsent('essential')
    mount()
    await advance(10_000)
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

  it('the footer re-open acts on its first click — a deliberate open is not armed', async () => {
    mount()
    await act(async () => { window.dispatchEvent(new CustomEvent('eno:open-consent')) })
    fireEvent.click(screen.getByRole('button', { name: /^Decline all$/ }))
    expect(getConsent()).toBe('essential')
  })

  it('the footer re-open ("eno:open-consent") shows the choices at once, seeded from the stored choice', async () => {
    setConsent('all')
    mount()
    await act(async () => { window.dispatchEvent(new CustomEvent('eno:open-consent')) })
    expect(screen.getByRole('dialog', { name: 'Your choices' })).not.toBeNull()
    expect(toggle(/Ad personalization/).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('CookieConsent — the bar', () => {
  it('has no photograph (the team photo was the first-visit LCP)', async () => {
    await openFirstVisitBar()
    expect(bar()!.querySelector('img')).toBeNull()
    expect(document.querySelector('img[src*="consent-team"]')).toBeNull()
  })

  it('⛔ Accept, Decline and Settings carry EQUAL weight — identical classes, only the word differs', async () => {
    await openFirstVisitBar()
    const [a, d, s] = ['Accept', 'Decline', 'Settings'].map((n) => screen.getByRole('button', { name: new RegExp(`^${n}$`) }))
    expect(a.getAttribute('class')).toBe(d.getAttribute('class'))
    expect(a.getAttribute('class')).toBe(s.getAttribute('class'))
    // A real 44px target each, not a text link beside a filled button.
    expect(tokens(a)).toContain('min-h-11')
  })

  it('where there is no web tab bar (native tabs) it keeps the Android WebView inset fallback', async () => {
    await openFirstVisitBar()
    expect(tokens(bar()!.parentElement!)).toContain('[html.native-tabs_&]:bottom-[calc(0.5rem+max(env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px)))]')
  })

  it('asks (a request, not a notice) and says "suggest", never "rank" — /legal/ranking promises results are not reordered by personal data', async () => {
    await openFirstVisitBar()
    expect(bar()!.textContent).toMatch(/Can we use cookies to suggest listings for you .*\?/)
    expect(bar()!.textContent).not.toMatch(/\brank|reorder/i)
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
    fireEvent.click(screen.getByRole('button', { name: /^Accept$/ }))
    expect(getConsent()).toBeNull()
    expect(bar()).not.toBeNull()
    await advance(400)
    fireEvent.click(screen.getByRole('button', { name: /^Accept$/ }))
    expect(getConsent()).toBe('all')
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
    expect(getConsent()).toBeNull()
    page.remove()
  })

  it('Escape still closes it without storing anything', async () => {
    await openFirstVisitBar()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await advance(500)
    expect(bar()).toBeNull()
    expect(getConsent()).toBeNull()
  })

  it('⛔ a double tap on Settings cannot land its second half on Save', async () => {
    await openFirstVisitBar()
    fireEvent.click(screen.getByRole('button', { name: /^Settings$/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    expect(getConsent()).toBeNull()
    await advance(400)
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    expect(getConsent()).toBe('personalized')
  })

  it('Settings moves focus into the bar (the pressed button unmounts with the ask view)', async () => {
    await openFirstVisitBar()
    const settings = screen.getByRole('button', { name: /^Settings$/ })
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
    fireEvent.click(screen.getByRole('button', { name: /^Accept$/ }))
    expect(getConsent()).toBeNull()
    await advance(400)
    fireEvent.click(screen.getByRole('button', { name: /^Accept$/ }))
    expect(getConsent()).toBe('all')
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
    setConsent('essential')
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
