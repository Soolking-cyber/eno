// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { VI_OVERRIDES } from '@/generated/vi-overrides'

// ── Continue with Facebook (owner, 2026-10-16: "in facebook browser sign in doesnt show google sign in or apple sign in …
// if needed add sign in with facebook") — dark until GoTrue has it on, offered in every browser but never in the eno
// apps, and NOT leading (plan v4 review): under the emailed code in in-app browsers, after Google and Apple elsewhere.

vi.mock('@/lib/google-identity', () => ({ googleFirstPartyEnabled: () => true }))
const signInWithOAuth = vi.fn()
vi.mock('@/lib/supabase/browser', () => ({ createSupabaseBrowser: () => ({ auth: { signInWithOAuth: (a: unknown) => signInWithOAuth(a) } }) }))
const clearStalePkceCookies = vi.fn()
vi.mock('@/lib/auth-pkce', () => ({ clearStalePkceCookies: () => clearStalePkceCookies() }))
// The hold-back (facebookHeldBack, 2026-10-17) is real by default; `lifted` pins the order for the day it is deleted.
const hold = vi.hoisted(() => ({ lifted: false }))
vi.mock('@/lib/facebook-signin', async (orig) => {
  const m = await orig<typeof import('@/lib/facebook-signin')>()
  return { ...m, facebookHeldBack: (gate: string | undefined) => (hold.lifted ? false : m.facebookHeldBack(gate)) }
})

import { SignInDialog } from './sign-in-dialog'
import { resetFacebookFlagForTests, seedFacebookSignIn } from '@/lib/facebook-flag'

const FB_ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-A055F Build/TKQ1.221114.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/582.0.0.50.54;IABMV/1;]'
const CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
const APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1.0.3'
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
let ua = CHROME
let providers: unknown = { facebook: true }
let beacons: Array<Record<string, string>> = []
const fetchCalls: string[] = []
const loc = { pathname: '/listings/l1', search: '', hash: '', origin: 'http://localhost:3000', href: 'http://localhost:3000/listings/l1', assign: vi.fn(), reload: vi.fn() }

function popup(lang: 'en' | 'vi' = 'en') {
  return render(
    <LanguageProvider initialLang={lang} initialViDict={VI_DICT}>
      <SignInDialog open onOpenChange={() => {}} listingTitle="Sofa" sellerName="An" gate="chat" resume={null} />
    </LanguageProvider>,
  )
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const after = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

beforeEach(() => {
  ua = CHROME
  hold.lifted = false
  providers = { facebook: true }
  beacons = []
  fetchCalls.length = 0
  resetFacebookFlagForTests()
  signInWithOAuth.mockReset().mockResolvedValue({ error: null })
  clearStalePkceCookies.mockReset()
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
  vi.stubGlobal('fetch', vi.fn((u: string) => {
    fetchCalls.push(String(u))
    const body = String(u) === '/api/auth/providers' ? providers : {}
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
  }))
  Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => ua })
  Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => false })
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    value: (_u: string, b: Blob) => { void b.text().then((t) => beacons.push(JSON.parse(t))); return true },
  })
  Object.defineProperty(window, 'location', { configurable: true, value: loc })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
})

describe('Continue with Facebook — dark until GoTrue has it on', () => {
  it('off: no button in a real browser', async () => {
    providers = { facebook: false }
    popup()
    await settle()
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Facebook/ })).toBeNull()
  })

  it('off: no button in Facebook\'s in-app browser either', async () => {
    providers = { facebook: false }
    ua = FB_ANDROID
    popup()
    await settle()
    expect(screen.getByRole('button', { name: 'Send code' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Facebook/ })).toBeNull()
  })

  it('asked ONCE per page — the second form on the page reads the answer, and sessionStorage keeps it for the next page', async () => {
    popup()
    await settle()
    expect(screen.getByRole('button', { name: 'Continue with Facebook' })).toBeTruthy()
    cleanup()
    popup()
    await settle()
    expect(fetchCalls.filter((u) => u === '/api/auth/providers')).toHaveLength(1)
    // A fresh page (module state gone): the stored answer, no request.
    resetFacebookFlagForTests()
    cleanup()
    popup()
    await settle()
    expect(screen.getByRole('button', { name: 'Continue with Facebook' })).toBeTruthy()
    expect(fetchCalls.filter((u) => u === '/api/auth/providers')).toHaveLength(1)
  })

  it('a page the server seeded never asks (the teacher join page)', async () => {
    seedFacebookSignIn(true)
    popup()
    await settle()
    expect(screen.getByRole('button', { name: 'Continue with Facebook' })).toBeTruthy()
    expect(fetchCalls).not.toContain('/api/auth/providers')
  })

  it('⛔ an answer expires: a tab asks again after 5 minutes (the owner switched Facebook off meanwhile → the button goes)', async () => {
    const t0 = Date.now()
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0)
    try {
      popup()
      await settle()
      expect(screen.getByRole('button', { name: 'Continue with Facebook' })).toBeTruthy()
      cleanup()
      providers = { facebook: false }
      now.mockReturnValue(t0 + 5 * 60_000 + 1)
      popup()
      await settle()
      expect(fetchCalls.filter((u) => u === '/api/auth/providers')).toHaveLength(2)
      expect(screen.queryByRole('button', { name: /Facebook/ })).toBeNull()
    } finally {
      now.mockRestore()
    }
  })

  it('⛔ an expired "on" does not outlive a refresh that fails — the button goes', async () => {
    const t0 = Date.now()
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0)
    try {
      popup()
      await settle()
      expect(screen.getByRole('button', { name: 'Continue with Facebook' })).toBeTruthy()
      cleanup()
      vi.stubGlobal('fetch', vi.fn((u: string) => (String(u) === '/api/auth/providers' ? Promise.reject(new TypeError('offline')) : Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))))
      now.mockReturnValue(t0 + 5 * 60_000 + 1)
      popup()
      await settle()
      expect(screen.queryByRole('button', { name: /Facebook/ })).toBeNull()
    } finally {
      now.mockRestore()
    }
  })

  it('⛔ the server\'s word wins over a probe that answers after it', async () => {
    let answer: (v: unknown) => void = () => {}
    vi.stubGlobal('fetch', vi.fn((u: string) => {
      fetchCalls.push(String(u))
      if (String(u) !== '/api/auth/providers') return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      return Promise.resolve({ ok: true, json: () => new Promise((r) => { answer = r }) })
    }))
    popup()
    await settle()
    expect(fetchCalls).toContain('/api/auth/providers')
    act(() => { seedFacebookSignIn(true) })
    await act(async () => { answer({ facebook: false }); await new Promise((r) => setTimeout(r, 0)) })
    expect(screen.getByRole('button', { name: 'Continue with Facebook' })).toBeTruthy()
  })

  it('⛔ not in another app\'s Android webview (Meta ended Facebook Login there, 2021-10-05) — and held back in Meta\'s own apps until Facebook returns an email (facebookHeldBack)', async () => {
    ua = 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 Zalo android/12210160 ZaloTheme/light ZaloLanguage/vn'
    popup()
    await settle()
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Facebook/ })).toBeNull()
    cleanup()
    ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 Instagram 350.0.0.0.0 Android'
    popup()
    await settle()
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Facebook/ })).toBeNull()
  })

  it('⛔ held back at the teacher form\'s sign-in, even in a real browser (facebookHeldBack)', async () => {
    render(
      <LanguageProvider initialLang="en" initialViDict={VI_DICT}>
        <SignInDialog open onOpenChange={() => {}} gate="teacher" resume={null} />
      </LanguageProvider>,
    )
    await settle()
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Facebook/ })).toBeNull()
  })

  it('never in the eno apps, even when on', async () => {
    ua = APP
    popup()
    await settle()
    expect(screen.queryByRole('button', { name: /Facebook/ })).toBeNull()
  })
})

describe('where it sits', () => {
  it('a real browser: after Google, before the email', async () => {
    popup()
    await settle()
    const google = screen.getByRole('button', { name: 'Continue with Google' })
    const facebook = screen.getByRole('button', { name: 'Continue with Facebook' })
    const field = screen.getByRole('textbox', { name: 'Email' })
    expect(after(google, facebook)).toBe(true)
    expect(after(facebook, field)).toBe(true)
  })

  it('⛔ Facebook\'s own in-app browser: the emailed code first, then Google — no Apple, and no Facebook while it is held back', async () => {
    ua = FB_ANDROID
    popup()
    await settle()
    const send = screen.getByRole('button', { name: 'Send code' })
    const google = screen.getByRole('button', { name: 'Continue with Google' })
    expect(after(send, google)).toBe(true)
    expect(screen.queryByRole('button', { name: /Facebook/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Apple/ })).toBeNull()
  })

  it('…and once the hold-back is lifted: the emailed code, then Facebook, then Google — no Apple', async () => {
    hold.lifted = true
    ua = FB_ANDROID
    popup()
    await settle()
    const send = screen.getByRole('button', { name: 'Send code' })
    const facebook = screen.getByRole('button', { name: 'Continue with Facebook' })
    const google = screen.getByRole('button', { name: 'Continue with Google' })
    expect(after(send, facebook)).toBe(true)
    expect(after(facebook, google)).toBe(true)
    expect(screen.queryByRole('button', { name: /Apple/ })).toBeNull()
  })

  it('in Vietnamese', async () => {
    popup('vi')
    await settle()
    expect(screen.getByRole('button', { name: 'Tiếp tục với Facebook' })).toBeTruthy()
  })
})

describe('pressing it', () => {
  it('GoTrue\'s Facebook flow, back to this page through /auth/callback marked p=facebook — after clearing stale PKCE cookies — and counted', async () => {
    popup()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Facebook' }))
    await settle()
    expect(clearStalePkceCookies).toHaveBeenCalledTimes(1)
    expect(signInWithOAuth).toHaveBeenCalledWith({ provider: 'facebook', options: { redirectTo: 'http://localhost:3000/auth/callback?next=%2Flistings%2Fl1&p=facebook', queryParams: { auth_type: 'rerequest' } } })
    expect(beacons).toContainEqual({ g: 'chat', a: 'facebook', c: 'browser.desktop.en' })
  })

  it('…and inside Facebook\'s browser once the hold-back is lifted, counted as that browser', async () => {
    hold.lifted = true
    ua = FB_ANDROID
    popup()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Facebook' }))
    await settle()
    expect(signInWithOAuth).toHaveBeenCalledWith({ provider: 'facebook', options: { redirectTo: 'http://localhost:3000/auth/callback?next=%2Flistings%2Fl1&p=facebook', queryParams: { auth_type: 'rerequest' } } })
    expect(beacons).toContainEqual({ g: 'chat', a: 'facebook', c: 'inapp-fb.desktop.en' })
  })

  it('a refused start says so, in our words, and the form comes back', async () => {
    signInWithOAuth.mockResolvedValue({ error: { message: 'Unsupported provider: provider is not enabled' } })
    popup()
    await settle()
    const facebook = screen.getByRole('button', { name: 'Continue with Facebook' })
    fireEvent.click(facebook)
    await settle()
    expect(screen.getByRole('alert').textContent).toBe('Facebook sign-in didn’t start. Try again, or use another way to sign in.')
    expect((screen.getByRole('button', { name: 'Continue with Facebook' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

// Owner, 2026-10-17: "Email code now" — after Facebook shared no email (AuthErrorToast's `no_email`), the popup leads
// with the emailed code: its field focused, and no Facebook button to tap into the same refusal again.
describe('right after Facebook shared no email (emailLead)', () => {
  const leadPopup = () =>
    render(
      <LanguageProvider initialLang="en" initialViDict={VI_DICT}>
        <SignInDialog open onOpenChange={() => {}} note="Facebook didn’t share your email address." emailLead resume={null} />
      </LanguageProvider>,
    )

  it('no Facebook button, Google stays, the note says why, and the email field has the focus', async () => {
    leadPopup()
    await settle()
    expect(screen.queryByRole('button', { name: /Facebook/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy()
    expect(screen.getByText('Facebook didn’t share your email address.')).toBeTruthy()
    // The dialog moves focus on its own schedule — one tick (settle) was a race a slow CI runner lost (2026-10-18).
    await waitFor(() => expect((document.activeElement as HTMLInputElement | null)?.type).toBe('email'))
  })

  it('in Facebook\'s in-app browser too: the emailed code leads, no Facebook button', async () => {
    ua = FB_ANDROID
    leadPopup()
    await settle()
    expect(screen.getByRole('button', { name: 'Send code' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Facebook/ })).toBeNull()
  })

  it('any other popup still offers Facebook (the flag is per opening, not sticky)', async () => {
    popup()
    await settle()
    expect(screen.getByRole('button', { name: 'Continue with Facebook' })).toBeTruthy()
  })
})
