// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { browserContext, deviceClass, googleOauthBlocked, inAppHost, inAppHostName, isInAppHost } from './in-app-browser'
import { parseHandoffVia } from './auth/handoff-client'

// ── UX3 J1/J2: which app's built-in browser, and the counters' coarse context class ───────────────

const UA = {
  fbIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/18.0;FBSS/3;FBID/phone;FBLC/vi_VN;FBOP/5]',
  fbAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]',
  messengerIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/480.0;FBBV/1;FBDV/iPhone14,5]',
  zaloIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Zalo iOS/25.09 ZaloTheme/light ZaloLanguage/vn',
  zaloAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 Zalo android/12210160 ZaloTheme/light ZaloLanguage/vn',
  instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0 (iPhone14,5; iOS 18_0; vi_VN)',
  gsa: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/350.0.0 Mobile/15E148 Safari/604.1',
  rawWebView: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36',
  chrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  nativeTabs: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeTabs/1',
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete (window as unknown as { Capacitor?: unknown }).Capacitor
})

describe('inAppHost — the app whose built-in browser this is', () => {
  it.each([
    ['fbIOS', 'facebook'], ['fbAndroid', 'facebook'], ['messengerIOS', 'messenger'], ['zaloIOS', 'zalo'], ['zaloAndroid', 'zalo'],
    ['instagram', 'instagram'], ['gsa', 'google'], ['rawWebView', 'other'],
  ] as const)('%s → %s', (k, host) => {
    expect(inAppHost(UA[k])).toBe(host)
  })

  it('a real browser and the eno app are not in-app browsers', () => {
    expect(inAppHost(UA.chrome)).toBeNull()
    expect(inAppHost(UA.safari)).toBeNull()
    expect(inAppHost(UA.nativeTabs)).toBeNull()
    ;(window as unknown as { Capacitor: unknown }).Capacitor = { isNativePlatform: () => true }
    expect(inAppHost(UA.rawWebView)).toBeNull() // the Capacitor WebView says `wv` too
  })

  it('covers every UA that googleOauthBlocked() refuses for being in an app (the J2 email-first set)', () => {
    for (const k of ['fbIOS', 'fbAndroid', 'messengerIOS', 'zaloIOS', 'zaloAndroid', 'instagram', 'gsa', 'rawWebView'] as const) {
      Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => UA[k] })
      expect(googleOauthBlocked(), k).toBe(true)
      expect(inAppHost(), k).not.toBeNull()
    }
  })

  it('names only hosts people know — never "other"', () => {
    expect(inAppHostName('zalo')).toBe('Zalo')
    expect(inAppHostName('facebook')).toBe('Facebook')
    expect(inAppHostName('other')).toBeNull()
    // The Google app is unnamed: "sign in with Google in Google" read as one thing (opus, gate 2026-10-05).
    expect(inAppHostName('google')).toBeNull()
    expect(inAppHostName(null)).toBeNull()
  })
})

describe('browserContext + deviceClass — the counters’ coarse class', () => {
  it.each([
    ['fbIOS', 'inapp-fb'], ['messengerIOS', 'inapp-fb'], ['zaloAndroid', 'inapp-zalo'], ['instagram', 'inapp-other'], ['rawWebView', 'inapp-other'],
    ['chrome', 'browser'], ['nativeTabs', 'native'],
  ] as const)('%s → %s', (k, ctx) => {
    expect(browserContext(UA[k])).toBe(ctx)
  })

  it('a home-screen app is "pwa"; the Capacitor app is "native"', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(display-mode: standalone)' }))
    expect(browserContext(UA.chrome)).toBe('pwa')
    ;(window as unknown as { Capacitor: unknown }).Capacitor = { isNativePlatform: () => true }
    expect(browserContext(UA.rawWebView)).toBe('native')
  })

  it('a touch-first device is a phone; anything with hover is a desktop', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(hover: none) and (pointer: coarse)' }))
    expect(deviceClass()).toBe('phone')
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    expect(deviceClass()).toBe('desktop')
  })
})

describe('the hand-off’s `via` — an allow-listed word, never text', () => {
  it('known hosts and "pwa" pass; anything else is unknown', () => {
    expect(parseHandoffVia('zalo')).toBe('zalo')
    expect(parseHandoffVia('pwa')).toBe('pwa')
    expect(parseHandoffVia('other')).toBe('other')
    for (const bad of ['Zalo', 'evil<script>', '', null, undefined, 'eno app']) expect(parseHandoffVia(bad)).toBeNull()
    expect(isInAppHost('pwa')).toBe(false)
  })
})
