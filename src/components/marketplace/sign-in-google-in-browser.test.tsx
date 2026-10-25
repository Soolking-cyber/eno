// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { VI_OVERRIDES } from '@/generated/vi-overrides'

// ── Inside an app's built-in browser, "Continue with Google" continues in the phone's own browser (2026-10-25). The pairing
// hand-off signed in 2 of 62 visitors who started it there (41 finished Google in their real browser and never typed the
// code back), so there the PAGE moves: every page's sign-in opens in the phone's browser with `next`, and the teacher join
// form's step-1 answers go too, under a one-time token (src/lib/auth/carry.ts). A raw Android WebView is some app's browser
// too (inAppHost 'other') and leaves the same way; only a context with no app around it — the iOS home-screen app — keeps
// the pairing hand-off.

vi.mock('@/lib/google-identity', () => ({ googleFirstPartyEnabled: () => true }))
const signInWithOAuth = vi.fn()
vi.mock('@/lib/supabase/browser', () => ({ createSupabaseBrowser: () => ({ auth: { signInWithOAuth: (a: unknown) => signInWithOAuth(a) } }) }))
vi.mock('@/lib/auth-pkce', () => ({ clearStalePkceCookies: () => {} }))
const escapes: Array<[string, string | null]> = []
// What happened, in order — the answers' POST must leave before the browser is opened.
const order: string[] = []
vi.mock('@/lib/in-app-browser', async (orig) => ({
  ...(await orig<typeof import('@/lib/in-app-browser')>()),
  escapeInAppBrowser: (url: string, host: string | null) => { escapes.push([url, host]); order.push('escape') },
  openInSystemBrowser: (url: string) => { escapes.push([`system:${url}`, null]); return true },
}))

import { SignInDialog } from './sign-in-dialog'
import { setTeacherCarry } from '@/lib/auth/in-app-carry'

const FB_ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-A055F Build/TKQ1.221114.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/582.0.0.50.54;IABMV/1;]'
const ZALO_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Zalo iOS/473 ZaloTheme/light ZaloLanguage/en'
// A raw Android WebView in some other app: an app's browser all the same (inAppHost 'other').
const PLAIN_WEBVIEW = 'Mozilla/5.0 (Linux; Android 13; SM-A055F Build/TKQ1.221114.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36'
// eno.vn added to an iPhone's home screen: Google refuses it, and there is no app around it to leave — the pairing stays.
const IOS_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const VI_DICT = { Close: VI_OVERRIDES.Close }

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

const realLocation = window.location
let ua = FB_ANDROID
const fetches: Array<{ url: string; init?: RequestInit }> = []
let loc = { pathname: '/listings/l1', search: '', hash: '', origin: 'http://localhost:3000', href: 'http://localhost:3000/listings/l1', assign: vi.fn(), reload: vi.fn() }
const replaced: string[] = []

function popup() {
  return render(
    <LanguageProvider initialLang="en" initialViDict={VI_DICT}>
      <SignInDialog open onOpenChange={() => {}} listingTitle="Sofa" sellerName="An" gate="chat" resume={null} />
    </LanguageProvider>,
  )
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const google = () => screen.getByRole('button', { name: 'Continue with Google' })

beforeEach(() => {
  ua = FB_ANDROID
  escapes.length = 0
  order.length = 0
  fetches.length = 0
  replaced.length = 0
  loc = { pathname: '/listings/l1', search: '', hash: '', origin: 'http://localhost:3000', href: 'http://localhost:3000/listings/l1', assign: vi.fn(), reload: vi.fn() }
  setTeacherCarry(null)
  signInWithOAuth.mockReset().mockResolvedValue({ data: { url: 'https://sb.eno.vn/auth/v1/authorize?provider=google' }, error: null })
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
  vi.stubGlobal('fetch', vi.fn((u: string, init?: RequestInit) => {
    fetches.push({ url: String(u), init })
    order.push(`fetch ${String(u)}`)
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(String(u) === '/api/auth/providers' ? { facebook: false } : {}) })
  }))
  vi.spyOn(history, 'replaceState').mockImplementation((_s, _t, url) => { replaced.push(String(url)) })
  Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => ua })
  Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => false })
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: () => true })
  Object.defineProperty(window, 'location', { configurable: true, value: loc })
})
afterEach(() => {
  cleanup()
  Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => undefined })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  setTeacherCarry(null)
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
})

describe('"Continue with Google" inside an app\'s built-in browser', () => {
  it('opens THIS page\'s sign-in in the phone\'s own browser, with `next` — no pairing hand-off, nothing stored', async () => {
    popup()
    await settle()
    expect(screen.getByText('Google opens your browser — you carry on there.')).toBeTruthy()
    fireEvent.click(google())
    await settle()
    expect(escapes).toEqual([[`http://localhost:3000/signin?next=${encodeURIComponent('/listings/l1')}`, 'facebook']])
    expect(signInWithOAuth).not.toHaveBeenCalled()
    expect(fetches.map((f) => f.url).filter((u) => u.startsWith('/api/auth/handoff') || u.startsWith('/api/auth/carry'))).toEqual([])
    expect(replaced).toEqual([])
    expect(screen.getByText('Your browser is opening — sign in with Google there.')).toBeTruthy()
    // The emailed code still works right here.
    expect(screen.getByRole('button', { name: 'Send code' })).toBeTruthy()
  })

  it('"Try again" opens it again; a moment later, still in front, it says how by hand', async () => {
    popup()
    await settle()
    fireEvent.click(google())
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(escapes).toHaveLength(2)
    expect(escapes[1]).toEqual(escapes[0]) // nothing carried: the same sign-in address
    await waitFor(() => expect(screen.getByText('Still here? Tap ⋯ at the top right, then “Open in browser” — or sign in right here with a code sent to your email.')).toBeTruthy(), { timeout: 3000 })
  })

  it('…and says it on coming back to the app soon after, even when the timer fired while the page was hidden', async () => {
    let state: DocumentVisibilityState = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    try {
      popup()
      await settle()
      fireEvent.click(google())
      state = 'hidden'
      await act(async () => { await new Promise((r) => setTimeout(r, 1700)) }) // the timer fires, hidden: nothing
      expect(screen.queryByText(/^Still here\?/)).toBeNull()
      state = 'visible'
      act(() => { document.dispatchEvent(new Event('visibilitychange')) })
      expect(screen.getByText(/^Still here\?/)).toBeTruthy()
    } finally { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }) }
  })

  it('⛔ the teacher join form\'s step-1 answers go too: POSTed first (keepalive) under a one-time token that THIS tab\'s address and the opened one both carry', async () => {
    loc = { ...loc, pathname: '/teachers/join', search: '?goal=cover&teacher_signin=1', href: 'http://localhost:3000/teachers/join?goal=cover&teacher_signin=1' }
    Object.defineProperty(window, 'location', { configurable: true, value: loc })
    setTeacherCarry(() => ({ answers: 'eyJ2IjoyfQ', search: 'goal=cover' }))
    popup()
    await settle()
    expect(screen.getByText('Google opens your browser — your answers go with you, and you carry on there.')).toBeTruthy()
    fireEvent.click(google())
    await settle()
    const post = fetches.find((f) => f.url === '/api/auth/carry')!
    expect(post.init).toMatchObject({ method: 'POST', keepalive: true })
    const body = JSON.parse(String(post.init!.body)) as { t: string; carry: string }
    expect(body.carry).toBe('eyJ2IjoyfQ')
    expect(body.t).toMatch(/^[A-Za-z0-9_-]{40,90}$/)
    // Dispatched before the browser opened.
    expect(order.indexOf('fetch /api/auth/carry')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('fetch /api/auth/carry')).toBeLessThan(order.indexOf('escape'))
    // Not on THIS tab's address on a hand-over that may have worked (a link shared from here would hand the answers on)…
    expect(replaced).toEqual([])
    expect(escapes).toEqual([[`http://localhost:3000/teachers/join?goal=cover&carry=${body.t}`, 'facebook']])
    // …only once the way by hand is shown — the app's ⋯ "Open in browser" opens this address.
    await waitFor(() => expect(replaced).toEqual([`/teachers/join?goal=cover&teacher_signin=1&carry=${body.t}`]), { timeout: 3000 })
    expect(screen.getByText('Your browser is opening — sign in with Google there. Your answers go with you.')).toBeTruthy()
    expect(signInWithOAuth).not.toHaveBeenCalled()
    // ⛔ "Try again" hands over afresh: a NEW token, the answers sent again (the first may be spent, or its POST lost).
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await settle()
    const posts = fetches.filter((f) => f.url === '/api/auth/carry')
    expect(posts).toHaveLength(2)
    const t2 = (JSON.parse(String(posts[1].init!.body)) as { t: string }).t
    expect(t2).not.toBe(body.t)
    expect(escapes[1][0]).toBe(`http://localhost:3000/teachers/join?goal=cover&carry=${t2}`)
  })

  it('⛔ off the canonical origin (the POST would be refused there) nothing is carried — the sign-in still moves, without answers', async () => {
    const prev = process.env.NEXT_PUBLIC_APP_URL
    process.env.NEXT_PUBLIC_APP_URL = 'https://eno.vn'
    try {
      loc = { ...loc, origin: 'https://teacher.eno.vn', pathname: '/teachers/join', href: 'https://teacher.eno.vn/teachers/join' }
      Object.defineProperty(window, 'location', { configurable: true, value: loc })
      setTeacherCarry(() => ({ answers: 'eyJ2IjoyfQ', search: '' }))
      popup()
      await settle()
      // The line under the button promises no answers here either — the same check as the tap.
      expect(screen.getByText('Google opens your browser — you carry on there.')).toBeTruthy()
      fireEvent.click(google())
      await settle()
      expect(fetches.some((f) => f.url === '/api/auth/carry')).toBe(false)
      expect(replaced).toEqual([])
      expect(escapes).toHaveLength(1)
      expect(escapes[0][0]).toMatch(/\/signin\?next=/)
    } finally {
      // process.env coerces: assigning undefined back would set the STRING 'undefined' for every later test.
      if (prev === undefined) delete process.env.NEXT_PUBLIC_APP_URL
      else process.env.NEXT_PUBLIC_APP_URL = prev
    }
  })

  it('Zalo on an iPhone takes the same way out', async () => {
    ua = ZALO_IOS
    popup()
    await settle()
    fireEvent.click(google())
    await settle()
    expect(escapes).toEqual([[`http://localhost:3000/signin?next=${encodeURIComponent('/listings/l1')}`, 'zalo']])
  })

  it('a raw Android WebView leaves the same way (some app\'s browser: \'other\')', async () => {
    ua = PLAIN_WEBVIEW
    popup()
    await settle()
    fireEvent.click(google())
    await settle()
    expect(escapes).toEqual([[`http://localhost:3000/signin?next=${encodeURIComponent('/listings/l1')}`, 'other']])
  })

  it('the iOS home-screen app keeps the pairing hand-off (Google asked for its URL here, the hand-off opened)', async () => {
    ua = IOS_SAFARI
    Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true })
    popup()
    await settle()
    fireEvent.click(google())
    await waitFor(() => expect(fetches.some((f) => f.url === '/api/auth/handoff/open')).toBe(true))
    expect(signInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({ provider: 'google', options: expect.objectContaining({ skipBrowserRedirect: true }) }))
    expect(escapes[0][0]).toMatch(/^system:http:\/\/localhost:3000\/auth\/escape\?h=/)
    expect(fetches.some((f) => f.url === '/api/auth/carry')).toBe(false)
  })
})
