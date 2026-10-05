// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NATIVE_UA_RE as CONSENT_NATIVE_UA_RE } from './consent-value'
import {
  APP_REVIEW_GATES,
  appReviewGate,
  brandForCopy,
  unknownAppReviewGates,
  inAppSheetDocument,
  iosAppGate,
  isIosAppUserAgent,
  isNativeAppClient,
  isNativeAppUserAgent,
  nativeAppGate,
  parseAppReviewGates,
} from './app-review-gates'

const IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const IPAD_APP = 'Mozilla/5.0 (iPad; CPU OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const ANDROID_APP = 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 EnoNativeApp/1'
const IOS_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1'
const SWIFTUI_TABS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeTabs/1'
// The same iOS binary on an Apple-silicon Mac ("Designed for iPhone").
const MAC_IOS_APP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) EnoNativeApp/1'

type Win = { Capacitor?: { getPlatform?: () => string } }
const setPlatform = (platform: string | null) => {
  if (platform === null) delete (window as unknown as Win).Capacitor
  else (window as unknown as Win).Capacitor = { getPlatform: () => platform }
}

afterEach(() => {
  vi.unstubAllEnvs()
  setPlatform(null)
})

describe('parseAppReviewGates', () => {
  it('is empty for an unset or blank variable — the shipped default', () => {
    expect(parseAppReviewGates(undefined).size).toBe(0)
    expect(parseAppReviewGates('').size).toBe(0)
    expect(parseAppReviewGates(' , ,').size).toBe(0)
  })

  it('reads a comma list, trimming and lower-casing', () => {
    expect([...parseAppReviewGates(' iOS-Hide-Google , app-no-gtm ')]).toEqual(['ios-hide-google', 'app-no-gtm'])
  })

  it('ignores unknown tokens, so a typo switches nothing on', () => {
    expect(parseAppReviewGates('ios-hide-gogle,all,1,true').size).toBe(0)
  })

  it('knows every token the docs table names', () => {
    expect(parseAppReviewGates(APP_REVIEW_GATES.join(',')).size).toBe(APP_REVIEW_GATES.length)
  })
})

describe('unknownAppReviewGates (next.config.ts refuses the build on any)', () => {
  it('names every token that is not a gate, and nothing else', () => {
    expect(unknownAppReviewGates(undefined)).toEqual([])
    expect(unknownAppReviewGates('ios-hide-google, app-no-gtm')).toEqual([])
    expect(unknownAppReviewGates('ios-hide-walet,app-no-gtm,all')).toEqual(['ios-hide-walet', 'all'])
  })
})

describe('the native UA pattern', () => {
  it('is the same one consent forcing uses', () => {
    for (const ua of [IOS_APP, ANDROID_APP, SWIFTUI_TABS, IOS_SAFARI]) expect(isNativeAppUserAgent(ua)).toBe(CONSENT_NATIVE_UA_RE.test(ua))
  })
})

describe('appReviewGate', () => {
  it('is off when NEXT_PUBLIC_APP_REVIEW_GATES is unset', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    for (const g of APP_REVIEW_GATES) expect(appReviewGate(g)).toBe(false)
  })

  it('turns on exactly the listed gates', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-wallet')
    expect(appReviewGate('ios-hide-wallet')).toBe(true)
    expect(appReviewGate('ios-hide-google')).toBe(false)
  })
})

describe('user-agent detection', () => {
  it('recognises the iOS app on iPhone and iPad, and nothing else', () => {
    expect(isIosAppUserAgent(IOS_APP)).toBe(true)
    expect(isIosAppUserAgent(IPAD_APP)).toBe(true)
    // getPlatform() says 'ios' there too, so the server must agree with the client.
    expect(isIosAppUserAgent(MAC_IOS_APP)).toBe(true)
    expect(isIosAppUserAgent(ANDROID_APP)).toBe(false)
    expect(isIosAppUserAgent(IOS_SAFARI)).toBe(false)
    // The shelved SwiftUI app's tabs are not this app and must not inherit its gates.
    expect(isIosAppUserAgent(SWIFTUI_TABS)).toBe(false)
    expect(isIosAppUserAgent(null)).toBe(false)
  })

  it('recognises either native app by the UA token on any origin', () => {
    expect(isNativeAppUserAgent(IOS_APP)).toBe(true)
    expect(isNativeAppUserAgent(ANDROID_APP)).toBe(true)
    expect(isNativeAppUserAgent(IOS_SAFARI)).toBe(false)
  })
})

describe('iosAppGate / nativeAppGate (client)', () => {
  it('needs BOTH the gate and the platform', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-google')
    setPlatform('android')
    expect(iosAppGate('ios-hide-google')).toBe(false)
    setPlatform('ios')
    expect(iosAppGate('ios-hide-google')).toBe(true)
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    expect(iosAppGate('ios-hide-google')).toBe(false)
  })

  it('a both-apps gate follows the UA token, not window.Capacitor (Android has none off server.url)', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-no-gtm')
    const ua = vi.spyOn(navigator, 'userAgent', 'get')
    ua.mockReturnValue(ANDROID_APP)
    expect(nativeAppGate('app-no-gtm')).toBe(true)
    ua.mockReturnValue(IOS_SAFARI)
    expect(nativeAppGate('app-no-gtm')).toBe(false)
    ua.mockRestore()
  })
})

describe('brandForCopy', () => {
  it("keeps today's words until the gate is on, then names this edition", () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    expect(brandForCopy('eno.forum')).toBe('eno.vn')
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'site-brand-copy')
    expect(brandForCopy('eno.forum')).toBe('eno.forum')
    expect(brandForCopy('eno.vn')).toBe('eno.vn')
  })
})

describe('the in-app browser sheet marker (?app_sheet=1)', () => {
  // The sheet (SFSafariViewController / Custom Tab) runs with the BROWSER's UA, so the page it shows must
  // be told it is the app's — or it is the ordinary web site, consent bar and GTM included (P10a).
  const at = (path: string, fn: () => void) => {
    window.history.replaceState(null, '', path)
    try { fn() } finally { window.history.replaceState(null, '', '/'); sessionStorage.clear() }
  }
  // The sheet only exists when `app-signin-tidy` opens first-party pages in it.
  const sheetOn = () => vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-signin-tidy')
  it('⛔ is dormant while app-signin-tidy is off — the marker changes nothing on either site', () => {
    at('/privacy?app_sheet=1', () => expect(inAppSheetDocument()).toBe(false))
    expect(sessionStorage.getItem('eno:app-sheet')).toBeNull()
  })
  it('marks the document the app opened in its sheet', () => {
    sheetOn()
    at('/privacy?app_sheet=1', () => expect(inAppSheetDocument()).toBe(true))
  })
  it('⛔ is ONE document: the next page in the same tab is the ordinary web site again', () => {
    sheetOn()
    window.history.replaceState(null, '', '/terms?app_sheet=1')
    expect(inAppSheetDocument()).toBe(true)
    at('/c/rentals', () => expect(inAppSheetDocument()).toBe(false))
    expect(sessionStorage.length).toBe(0) // nothing is remembered for the tab
  })
  it('is absent on an ordinary page, and only "1" counts', () => {
    sheetOn()
    at('/privacy', () => expect(inAppSheetDocument()).toBe(false))
    at('/privacy?app_sheet=0', () => expect(inAppSheetDocument()).toBe(false))
    at('/privacy?xapp_sheet=1', () => expect(inAppSheetDocument()).toBe(false))
  })
  it('⛔ is TRACKING-ONLY: it never turns the app gates on (anyone can put it on a link)', () => {
    at('/terms?app_sheet=1', () => {
      vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-signin-tidy,app-no-gtm')
      expect(isNativeAppClient()).toBe(false)
      expect(nativeAppGate('app-signin-tidy')).toBe(false)
    })
  })
})
