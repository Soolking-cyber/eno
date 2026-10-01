// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import '@/lib/bot-ua' // in the module cache, so the controller's lazy import settles inside a tick
import { AGAIN_AFTER_MS, DEVICE_KEY, PAUSE_MS, TAB_KEY, TEST_KEY } from '@/lib/signup-prompt'
import type { SignInContext } from '@/context/auth-context'

// ── The "Join eno" prompt's controller (owner, 2026-10-01: ask after a minute; dismissible; returns) ──
// useAuth is stubbed: the controller's whole contract with auth is "who is signed in, is it known yet,
// and openSignIn(ctx)". The popup it opens is tested in sign-in-join.test.tsx; the consent gate on the
// events in src/lib/analytics.test.ts.

const auth = vi.hoisted(() => ({
  user: null as null | { id: string },
  loading: false,
  openSignIn: vi.fn(),
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth }))
const track = vi.hoisted(() => vi.fn())
vi.mock('@/lib/analytics', () => ({ trackSignupPrompt: track }))
// The route, read by the dismissed_then_continued check: `usePathname()` re-renders on a client
// navigation. Tests move it and window.location together through `goTo`.
const nav = vi.hoisted(() => ({ pathname: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }))

import { SignupPrompt } from './signup-prompt'

const T0 = new Date('2026-10-01T09:00:00Z').getTime()
const HUMAN_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  }
}

let visibility: DocumentVisibilityState = 'visible'
let webdriver = false
let ua = HUMAN_UA

const goTo = (path: string) => { nav.pathname = path; window.history.replaceState(null, '', path) }
/** The anonymous counter beacons sent so far: the event names, in order. */
let counted: string[] = []
const readBeacons = async (blobs: Blob[]) => { counted = await Promise.all(blobs.map(async (b) => JSON.parse(await b.text()).e)) }
let beaconBlobs: Blob[] = []
const counts = async () => { await readBeacons(beaconBlobs); return counted }
/** Advance the clock and let the controller's lazy bot-list import settle. */
async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  await act(async () => { await vi.dynamicImportSettled() })
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
}
async function setVisible(v: DocumentVisibilityState) {
  visibility = v
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
}
const mount = () => render(<SignupPrompt />)
/** The ctx the controller passed on its n-th openSignIn call (1-based). */
const ctx = (n = 1) => auth.openSignIn.mock.calls[n - 1][0] as SignInContext
const opens = () => auth.openSignIn.mock.calls.length
const device = () => JSON.parse(localStorage.getItem(DEVICE_KEY) ?? 'null')
/** A new tab session: sessionStorage is per tab and starts empty. */
const newTabSession = () => { cleanup(); vi.stubGlobal('sessionStorage', memoryStorage()) }

beforeEach(() => {
  vi.useFakeTimers({ now: T0 })
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => webdriver })
  Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => ua })
  beaconBlobs = []
  counted = []
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    value: (url: string, b: Blob) => { if (url === '/api/signup-prompt') beaconBlobs.push(b); return true },
  })
  visibility = 'visible'
  webdriver = false
  ua = HUMAN_UA
  auth.user = null
  auth.loading = false
  auth.openSignIn.mockReset()
  track.mockReset()
  goTo('/')
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  document.documentElement.classList.remove('kb-open')
})

describe('SignupPrompt — when', () => {
  it('opens THE sign-in popup in its join presentation after 60s of visible browsing — not before', async () => {
    mount()
    await advance(59_000)
    expect(opens()).toBe(0)
    await advance(2_000)
    expect(opens()).toBe(1)
    expect(ctx().prompt).toEqual({ onMethod: expect.any(Function), onDismiss: expect.any(Function) })
    expect(track).toHaveBeenCalledWith('shown', { count: 1 })
  })

  it('⛔ time in a hidden tab does not count', async () => {
    mount()
    await advance(30_000)
    await setVisible('hidden')
    await advance(10 * 60_000)
    await setVisible('visible')
    await advance(29_000)
    expect(opens()).toBe(0)
    await advance(2_000)
    expect(opens()).toBe(1)
  })

  it('⛔ the count survives a reload in the same tab (sessionStorage), and a client navigation (one mount)', async () => {
    mount()
    await advance(25_000)
    goTo('/c/phones') // a client navigation: the same mounted controller keeps counting
    await advance(15_000)
    cleanup() // a reload: the controller unmounts and mounts again in the same tab session
    expect(JSON.parse(sessionStorage.getItem(TAB_KEY)!).ms).toBeGreaterThanOrEqual(40_000)
    mount()
    await advance(19_000)
    expect(opens()).toBe(0)
    await advance(2_000)
    expect(opens()).toBe(1)
  })

  it('⛔ closed (×, Esc, backdrop): again after 3 more minutes of visible browsing — and at most twice per tab', async () => {
    mount()
    await advance(61_000)
    await act(async () => { ctx(1).prompt!.onDismiss!() })
    expect(track).toHaveBeenCalledWith('dismissed', { count: 1 })
    await advance(AGAIN_AFTER_MS - 2_000)
    expect(opens()).toBe(1)
    await advance(3_000)
    expect(opens()).toBe(2)
    expect(track).toHaveBeenCalledWith('shown', { count: 2 })
    await act(async () => { ctx(2).prompt!.onDismiss!() })
    await advance(60 * 60_000)
    expect(opens()).toBe(2)
  })

  it('⛔ a new tab session asks once more after 60s; the 3rd dismissal overall pauses it for 7 days', async () => {
    mount()
    await advance(61_000)
    await act(async () => { ctx(1).prompt!.onDismiss!() })
    await advance(AGAIN_AFTER_MS + 1_000)
    await act(async () => { ctx(2).prompt!.onDismiss!() })
    expect(device().dismissals).toBe(2)

    newTabSession()
    vi.setSystemTime(Date.now() + 24 * 60 * 60_000) // a later session: the next day
    mount()
    await advance(61_000)
    expect(opens()).toBe(3)
    await act(async () => { ctx(3).prompt!.onDismiss!() })
    expect(device().pausedUntil).toBeGreaterThan(Date.now() + PAUSE_MS - 60_000)

    newTabSession()
    mount()
    await advance(30 * 60_000)
    expect(opens()).toBe(3) // paused

    newTabSession()
    vi.setSystemTime(Date.now() + PAUSE_MS)
    mount()
    await advance(61_000)
    expect(opens()).toBe(4) // the week is over
  })

  it('a new tab opened right after an ask waits until 3 minutes have passed since it (wall clock)', async () => {
    mount()
    await advance(61_000)
    newTabSession()
    mount()
    await advance(61_000)
    expect(opens()).toBe(1)
    await advance(AGAIN_AFTER_MS - 61_000)
    expect(opens()).toBe(2)
  })

  it('works with storage blocked — memory carries it for the page’s life', async () => {
    const throwing = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    vi.stubGlobal('localStorage', throwing)
    vi.stubGlobal('sessionStorage', throwing)
    mount()
    await advance(61_000)
    expect(opens()).toBe(1)
  })
})

describe('SignupPrompt — who', () => {
  it('⛔ never for a signed-in visitor — and once anyone signs in here, never again on this device (sign-out included)', async () => {
    auth.user = { id: 'u1' }
    const r = mount()
    await advance(5 * 60_000)
    expect(opens()).toBe(0)
    expect(device().member).toBe(true)
    auth.user = null // signed out
    r.rerender(<SignupPrompt />)
    await advance(10 * 60_000)
    expect(opens()).toBe(0)
  })

  it('waits while the session is still being read — a signed-in visitor looks like a guest until then', async () => {
    auth.loading = true
    const r = mount()
    await advance(2 * 60_000)
    expect(opens()).toBe(0)
    auth.loading = false
    r.rerender(<SignupPrompt />)
    await advance(61_000)
    expect(opens()).toBe(1)
  })

  it('⛔ a close caused by signing in is not counted as a dismissal', async () => {
    const r = mount()
    await advance(61_000)
    auth.user = { id: 'u1' }
    r.rerender(<SignupPrompt />)
    await act(async () => { ctx().prompt!.onDismiss!() })
    expect(track).not.toHaveBeenCalledWith('dismissed', expect.anything())
    expect(device().dismissals ?? 0).toBe(0)
  })

  it('⛔ never under automation (navigator.webdriver) — so no e2e suite is interrupted', async () => {
    webdriver = true
    mount()
    await advance(10 * 60_000)
    expect(opens()).toBe(0)
  })

  it('…unless the test override is set: it runs, and its value replaces both delays', async () => {
    webdriver = true
    ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36'
    localStorage.setItem(TEST_KEY, '1500')
    mount()
    await advance(1_000)
    expect(opens()).toBe(0)
    await advance(1_000)
    expect(opens()).toBe(1)
    await act(async () => { ctx(1).prompt!.onDismiss!() })
    await advance(2_000)
    expect(opens()).toBe(2)
  })

  it.each([
    ['Googlebot (rendering)', 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
    ['PageSpeed Insights / Lighthouse', 'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse'],
    ['Meta’s renderer', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 (compatible; meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler))'],
  ])('⛔ never for a crawler: %s', async (_n, crawler) => {
    ua = crawler
    mount()
    await advance(10 * 60_000)
    expect(opens()).toBe(0)
    expect(track).not.toHaveBeenCalled()
  })

  it('never inside the native iOS app’s web tabs, where Google sign-in cannot run', async () => {
    ua = `${HUMAN_UA} EnoNativeTabs/1`
    mount()
    await advance(10 * 60_000)
    expect(opens()).toBe(0)
  })
})

describe('SignupPrompt — where, and never over anything else', () => {
  it('⛔ waits on an excluded route (a seller mid-form on /post) and asks on the next page instead', async () => {
    goTo('/post')
    mount()
    await advance(3 * 60_000)
    expect(opens()).toBe(0)
    goTo('/listings/abc-123')
    await advance(1_000)
    expect(opens()).toBe(1)
  })

  it.each(['/signin', '/onboard', '/auth/callback', '/privacy', '/terms', '/regulations/v1', '/returns', '/prohibited', '/legal/ranking', '/messages', '/listings/x/edit'])(
    'never on %s',
    async (path) => {
      goTo(path)
      mount()
      await advance(5 * 60_000)
      expect(opens()).toBe(0)
    },
  )

  it('never on a 404 or error page', async () => {
    const page = document.createElement('div')
    page.setAttribute('data-error-page', '')
    document.body.appendChild(page)
    mount()
    await advance(5 * 60_000)
    expect(opens()).toBe(0)
  })

  it('opens over the UNANSWERED auto cookie bar (it hides under the scrim) — ignoring the bar must not hide the prompt', async () => {
    const bar = document.createElement('div')
    bar.setAttribute('role', 'dialog')
    bar.setAttribute('data-open', '')
    bar.setAttribute('data-consent-auto', '')
    document.body.appendChild(bar)
    mount()
    await advance(61_000)
    expect(opens()).toBe(1)
    bar.remove()
  })

  it('⛔ waits while the cookie consent card is open, then asks at the next calm second', async () => {
    const bar = document.createElement('div')
    bar.setAttribute('role', 'dialog')
    bar.setAttribute('data-open', '')
    document.body.appendChild(bar)
    mount()
    await advance(3 * 60_000)
    expect(opens()).toBe(0)
    bar.remove()
    await advance(1_000)
    expect(opens()).toBe(1)
  })

  it('waits while a dialog, sheet or menu holds the screen (its scrim), and while the keyboard is up', async () => {
    const scrim = document.createElement('div')
    scrim.className = 'overlay-scrim'
    document.body.appendChild(scrim)
    mount()
    await advance(2 * 60_000)
    expect(opens()).toBe(0)
    scrim.remove()
    document.documentElement.classList.add('kb-open')
    await advance(60_000)
    expect(opens()).toBe(0)
    document.documentElement.classList.remove('kb-open')
    await advance(1_000)
    expect(opens()).toBe(1)
  })

  it('⛔ waits while someone is typing in a field', async () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    mount()
    await advance(2 * 60_000)
    expect(opens()).toBe(0)
    input.blur()
    await advance(1_000)
    expect(opens()).toBe(1)
  })
})

describe('SignupPrompt — what it reports', () => {
  it('the chosen method is reported with the ask number through the consent-gated helper — ONE outcome per ask', async () => {
    mount()
    await advance(61_000)
    ctx().prompt!.onMethod!('google')
    ctx().prompt!.onMethod!('email') // a second press in the same ask is not a second outcome
    expect(track.mock.calls).toEqual([['shown', { count: 1 }], ['google', { count: 1 }]])
  })
})

describe('SignupPrompt — the anonymous daily totals (owner: "how many pressed x, bounced, and how many signed up")', () => {
  it('⛔ counted WITHOUT analytics consent — the beacon carries the event name and nothing else', async () => {
    mount()
    await advance(61_000)
    expect(await counts()).toEqual(['shown'])
    const body = await beaconBlobs[0].text()
    expect(JSON.parse(body)).toEqual({ e: 'shown' })
  })

  it('× then another page in the same tab: dismissed, then dismissed_then_continued — once', async () => {
    const r = mount()
    await advance(61_000)
    await act(async () => { ctx().prompt!.onDismiss!() })
    expect(await counts()).toEqual(['shown', 'dismissed'])
    goTo('/c/phones')
    r.rerender(<SignupPrompt />)
    await advance(1_000)
    goTo('/rentals')
    r.rerender(<SignupPrompt />)
    await advance(1_000)
    expect(await counts()).toEqual(['shown', 'dismissed', 'dismissed_then_continued'])
  })

  it('× and then a RELOAD of the same page is not "continued"; a new page after it is', async () => {
    mount()
    await advance(61_000)
    await act(async () => { ctx().prompt!.onDismiss!() })
    cleanup()
    const spy = vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: 'reload' } as unknown as PerformanceEntry])
    const r = mount()
    await advance(1_000)
    expect(await counts()).toEqual(['shown', 'dismissed'])
    spy.mockRestore()
    goTo('/c/phones')
    r.rerender(<SignupPrompt />)
    await advance(1_000)
    expect(await counts()).toEqual(['shown', 'dismissed', 'dismissed_then_continued'])
  })

  it('× and then a NEW document in the same tab (a full navigation) is "continued"', async () => {
    mount()
    await advance(61_000)
    await act(async () => { ctx().prompt!.onDismiss!() })
    cleanup()
    goTo('/rentals')
    const spy = vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: 'navigate' } as unknown as PerformanceEntry])
    mount()
    await advance(0)
    spy.mockRestore()
    expect(await counts()).toEqual(['shown', 'dismissed', 'dismissed_then_continued'])
  })

  it('no dismissal, no "continued" — navigating after Google/email or without any prompt counts nothing', async () => {
    const r = mount()
    goTo('/c/phones')
    r.rerender(<SignupPrompt />)
    await advance(61_000)
    ctx().prompt!.onMethod!('email')
    await act(async () => { ctx().prompt!.onDismiss!() }) // closed after choosing email — an answer, not a ×
    goTo('/rentals')
    r.rerender(<SignupPrompt />)
    await advance(1_000)
    expect(await counts()).toEqual(['shown', 'email_click'])
    expect(track).not.toHaveBeenCalledWith('dismissed', expect.anything())
    expect(device().dismissals ?? 0).toBe(0)
  })

  it('⛔ Google chosen in the prompt, then signed in (the OAuth return, a new document): signup_completed, once', async () => {
    mount()
    await advance(61_000)
    ctx().prompt!.onMethod!('google')
    expect(await counts()).toEqual(['shown', 'google_click'])
    cleanup() // Google's round-trip leaves the page; it comes back signed in
    auth.user = { id: 'u1' }
    mount()
    await advance(1_000)
    cleanup()
    mount() // later pages of the same signed-in session count nothing more
    await advance(1_000)
    expect(await counts()).toEqual(['shown', 'google_click', 'signup_completed'])
  })

  it('a sign-in nobody started from the prompt is not the prompt’s', async () => {
    auth.user = { id: 'u1' }
    mount()
    await advance(1_000)
    expect(await counts()).toEqual([])
  })

  it('a sign-in more than an hour after choosing email is not counted', async () => {
    mount()
    await advance(61_000)
    ctx().prompt!.onMethod!('email')
    cleanup()
    vi.setSystemTime(Date.now() + 61 * 60_000)
    auth.user = { id: 'u1' }
    mount()
    await advance(1_000)
    expect(await counts()).toEqual(['shown', 'email_click'])
  })
})
