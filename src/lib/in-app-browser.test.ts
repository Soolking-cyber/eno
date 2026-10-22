// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ESCAPE_PARAM, META_IN_APP_HOSTS, browserContext, deviceClass, escapeInAppBrowser, escapeMark, escapeUrl, googleOauthBlocked, inAppHost, inAppHostName, isInAppHost, uaOs, withoutEscapeMark } from './in-app-browser'
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

// ── The way out of Meta's built-in browsers (2026-10-17, owner: "drive them to actual website not in facebook browser") ──
describe('escaping Facebook, Messenger and Instagram for the real browser', () => {
  afterEach(() => { vi.restoreAllMocks() })
  it('uaOs reads the phone, coarsely', () => {
    expect(uaOs(UA.fbAndroid)).toBe('android')
    expect(uaOs(UA.fbIOS)).toBe('ios')
    expect(uaOs(UA.instagram)).toBe('ios')
    expect(uaOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15')).toBe('other')
  })
  it('is offered in Meta\'s own browsers only — never Zalo, TikTok or another app', () => {
    for (const h of ['facebook', 'messenger', 'instagram'] as const) expect(META_IN_APP_HOSTS.has(h)).toBe(true)
    for (const h of ['zalo', 'tiktok', 'line', 'google', 'other'] as const) expect(META_IN_APP_HOSTS.has(h)).toBe(false)
  })
  it('iOS Facebook hands the page to Safari through window.open(x-safari-https://…), the address otherwise unchanged', () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => UA.fbIOS })
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    escapeInAppBrowser('https://teacher.eno.vn/?utm_source=meta&utm_content=reel_v3_benefits', 'facebook')
    expect(open).toHaveBeenCalledWith('x-safari-https://teacher.eno.vn/?utm_source=meta&utm_content=reel_v3_benefits', '_blank')
  })
  it('does nothing on a desktop browser', () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15' })
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    escapeInAppBrowser('https://teacher.eno.vn/', 'facebook')
    expect(open).not.toHaveBeenCalled()
  })
})

// ── The escape's mark (owner, 2026-10-22: "creatively route them to normal browser") ───────────────────────────────

describe('escapeUrl / escapeMark / withoutEscapeMark — the arrival a real browser can count', () => {
  const AD = 'https://teacher.eno.vn/?utm_source=meta&utm_medium=paid_social&utm_content=reel_v3_benefits&fbclid=IwZXh0bgNhZW0BMAABHQ'
  it('marks the handed link with the app it leaves, keeps every campaign tag and click id, and drops the fragment (an Android intent’s own `#Intent;…` must be its only one)', () => {
    const out = new URL(escapeUrl(`${AD}#d=answers`, 'facebook'))
    expect(out.searchParams.get(ESCAPE_PARAM)).toBe('facebook')
    for (const [k, v] of new URL(AD).searchParams) expect(out.searchParams.get(k)).toBe(v)
    expect(out.hash).toBe('')
  })
  it('reads back only a Meta app it could have come from — any other value is not ours', () => {
    expect(escapeMark(new URL(escapeUrl(AD, 'instagram')).search)).toBe('instagram')
    expect(escapeMark('?iab=messenger')).toBe('messenger')
    for (const q of ['', '?iab=', '?iab=zalo', '?iab=other', '?iab=<script>', '?utm_source=meta']) expect(escapeMark(q)).toBeNull()
  })
  it('takes the mark off and leaves the rest of the address exactly as it was', () => {
    expect(new URL(withoutEscapeMark(escapeUrl(AD, 'facebook'))).searchParams.has(ESCAPE_PARAM)).toBe(false)
    expect(withoutEscapeMark(AD)).toBe(AD) // nothing to take off: the very same string
    expect(withoutEscapeMark('https://teacher.eno.vn/?iab=facebook')).toBe('https://teacher.eno.vn/')
  })
})
