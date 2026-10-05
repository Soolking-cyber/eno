// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { VI_OVERRIDES } from '@/generated/vi-overrides'
import type { PendingIntent } from '@/lib/pending-intent'

// ── UX3 J2 (in-app browsers lead with the emailed code) and J5 (`next` carries resume=) ───────────
// Google refuses webviews, so in Facebook / Zalo / Instagram … the popup used to lead with a 9–11-screen
// hand-off. These hold the new order, the honest copy, the focus, and that the sign-in's way back carries
// the gate's `resume=<kind>` on every path out of the form.

vi.mock('@/lib/google-identity', () => ({ googleFirstPartyEnabled: () => true }))

import { SignInDialog } from './sign-in-dialog'
import { signInNextPath } from './sign-in-form'

const ZALO = 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 Zalo android/12210160 ZaloTheme/light ZaloLanguage/vn'
const CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
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

const assign = vi.fn()
const realLocation = window.location
let ua = ZALO
let beacons: Array<Record<string, string>> = []
const loc = { pathname: '/listings/l1', search: '', hash: '', origin: 'http://localhost:3000', href: 'http://localhost:3000/listings/l1', assign, reload: vi.fn() }
const intent: PendingIntent = { kind: 'chat', payload: { listingId: 'l1', body: 'Chào bạn! Món này còn không?' }, at: Date.now(), nonce: 'n-1', path: '/listings/l1' }

function popup(lang: 'en' | 'vi' = 'en', resume: PendingIntent | null = intent) {
  return render(
    <LanguageProvider initialLang={lang} initialViDict={VI_DICT}>
      <SignInDialog open onOpenChange={() => {}} listingTitle="Sofa" sellerName="An" gate="chat" resume={resume} />
    </LanguageProvider>,
  )
}

beforeEach(() => {
  ua = ZALO
  beacons = []
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
  Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => ua })
  Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => false })
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    value: (_u: string, b: Blob) => { void b.text().then((t) => beacons.push(JSON.parse(t))); return true },
  })
  Object.assign(loc, { pathname: '/listings/l1', search: '', href: 'http://localhost:3000/listings/l1' })
  Object.defineProperty(window, 'location', { configurable: true, value: loc })
  assign.mockReset()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
})

describe('in an in-app browser (Zalo), the emailed code leads', () => {
  it('⛔ the email field and "Send code" come FIRST; Google is a quiet link below that says what it does', async () => {
    popup()
    await act(async () => {})
    const dialog = screen.getByRole('dialog')
    const field = screen.getByRole('textbox', { name: 'Email' })
    const send = screen.getByRole('button', { name: 'Send code' })
    const google = screen.getByRole('button', { name: /^Use Google instead/ })
    // Document order: field → Send code → Google.
    expect(field.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(send.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The link is described: it opens the browser, and they bring a code back.
    const note = document.getElementById(google.getAttribute('aria-describedby')!)
    expect(note?.textContent).toBe('Opens your browser — then you bring a short code back here.')
    // No full-width Google button, no "Open Google in your browser" lead.
    expect(screen.queryByRole('button', { name: /Continue with Google|Open Google in your browser/ })).toBeNull()
    // ⛔ Truth: nothing promises phone sign-in while it is off — only the tab label "Phone · soon" names it.
    const text = (dialog.textContent ?? '').replace('Phone · soon', '')
    expect(text).not.toMatch(/phone|SĐT/i)
  })

  it('the email field takes the focus when the popup opens', async () => {
    popup()
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Email' }))
  })

  it('in Vietnamese: "Gửi mã" first, "Dùng Google" below', async () => {
    popup('vi')
    await act(async () => {})
    expect(screen.getByRole('button', { name: 'Gửi mã' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Dùng Google/ })).toBeTruthy()
    expect(screen.getByText('Sẽ mở trình duyệt — sau đó bạn mang một mã ngắn về đây.')).toBeTruthy()
  })

  it('⛔ the Google link hands off with `next` carrying resume= and the host app named for the real browser', async () => {
    popup()
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: /^Use Google instead/ }))
    expect(localStorage.getItem('eno:handoff:next')).toBe('/listings/l1?resume=chat')
    // Android: the escape page opens in the system browser through an intent: URL, with `via=zalo`.
    expect(loc.href).toMatch(/^intent:\/\/localhost:3000\/auth\/escape\?h=[^&]+&via=zalo#Intent;/)
    await act(async () => {})
    expect(beacons).toContainEqual({ g: 'chat', a: 'google', c: 'inapp-zalo.desktop.en' })
    expect(JSON.parse(localStorage.getItem('eno:signin-gate')!)).toMatchObject({ g: 'chat' })
  })
})

describe('in a real browser, Google still leads — and its round trip carries the gate’s resume=', () => {
  it('⛔ /auth/google/start?next=<the listing with resume=chat>', async () => {
    ua = CHROME
    popup()
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))
    expect(assign).toHaveBeenCalledWith('/auth/google/start?next=%2Flistings%2Fl1%3Fresume%3Dchat')
    await act(async () => {})
    expect(beacons).toContainEqual({ g: 'chat', a: 'google', c: 'browser.desktop.en' })
  })

  it('CONTROL: no resume, no marker — the current page as before', async () => {
    ua = CHROME
    loc.search = '?ref=feed'
    popup('en', null)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))
    expect(assign).toHaveBeenCalledWith('/auth/google/start?next=%2Flistings%2Fl1%3Fref%3Dfeed')
  })
})

describe('signInNextPath', () => {
  it('the page, /signin’s own next, or home from the auth routes — plus the gate’s resume', () => {
    expect(signInNextPath({ pathname: '/c/phones', search: '?q=iphone' })).toBe('/c/phones?q=iphone')
    expect(signInNextPath({ pathname: '/signin', search: '?next=%2Fsaved' })).toBe('/saved')
    expect(signInNextPath({ pathname: '/onboard', search: '' })).toBe('/')
    // A card's chat finishes on the listing, wherever the card was.
    expect(signInNextPath({ pathname: '/', search: '?q=sofa' }, { kind: 'chat', path: '/listings/l9' })).toBe('/listings/l9?resume=chat')
    expect(signInNextPath({ pathname: '/', search: '?q=sofa' }, { kind: 'saveSearch', path: '/?q=sofa' })).toBe('/?q=sofa&resume=saveSearch')
  })
})
