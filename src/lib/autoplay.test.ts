// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { autoplayAllowed } from './autoplay'

const UA = {
  safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  zaloIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Zalo iOS/550 ZaloTheme/light ZaloLanguage/vn',
  zaloAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.135 Mobile Safari/537.36 Zalo android/12100752 ZaloTheme/light',
  facebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/490.0.0.38.107]',
  googleApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/350.0.698 Mobile/15E148 Safari/604.1',
  // eno's own app (in-app-browser.ts insideEnoApp): never "another app's" browser, so it keeps autoplay.
  enoApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1.3',
  // An Android System WebView inside an app we cannot name (`; wv`): in-app-browser.ts calls it 'other'.
  androidWv: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240905.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.135 Mobile Safari/537.36',
}
const as = (ua: string) => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('autoplayAllowed: never inside another app\'s in-app browser (owner 2026-11-25, Zalo went fullscreen on scroll)', () => {
  it('a browser autoplays; so do the Google app and eno\'s own app', () => {
    for (const ua of [UA.safari, UA.googleApp, UA.enoApp]) { as(ua); expect(autoplayAllowed(), ua.slice(-40)).toBe(true) }
  })
  it('Zalo (iOS and Android), Facebook and an unnamed Android WebView do not', () => {
    for (const ua of [UA.zaloIos, UA.zaloAndroid, UA.facebook, UA.androidWv]) { as(ua); expect(autoplayAllowed(), ua.slice(-40)).toBe(false) }
  })
  it('the existing gates still hold in a browser: reduced motion and Save-Data', () => {
    as(UA.safari)
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }))
    expect(autoplayAllowed()).toBe(false)
    as(UA.safari)
    Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } })
    expect(autoplayAllowed()).toBe(false)
    Object.defineProperty(navigator, 'connection', { configurable: true, value: undefined })
  })
})
