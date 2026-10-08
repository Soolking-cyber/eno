// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APPLE_SIGNIN_TOKENS,
  SIGN_IN_PLUGIN,
  SIWA_TEST_COOKIE,
  appleAvailableHere,
  appleFlagSet,
  appleIosEnabled,
  appleSupportUrl,
  appleWebEnabled,
  iosGoogleHidden,
  iosNativeAppleReady,
  isAppleLinked,
  isAppleRelayEmail,
  parseAppleSignInFlag,
  siwaTester,
  syncSiwaTestCookie,
  unknownAppleSignInTokens,
} from './apple-signin'

/**
 * Sign in with Apple's rollout flag (NEXT_PUBLIC_APPLE_SIGNIN = ios | web-test | web) and the one answer to
 * "may Apple — and, in the iOS app, Google — show here?". Plan ~/eno-ios-prep/siwa/plan.md §7.1 and §8.
 */

const IOS_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1'
const IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const ANDROID_APP = 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 EnoNativeApp/1'
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const FBAN = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0]'
const ZALO = 'Mozilla/5.0 (Linux; Android 15; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 Zalo android/12345 ZaloTheme/light'
const SWIFTUI_TABS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeTabs/1'

type Cap = { getPlatform: () => string; isNativePlatform: () => boolean; isPluginAvailable: (n: string) => boolean }
const setApp = (platform: 'ios' | 'android' | null, plugins: string[] = []) => {
  const w = window as unknown as { Capacitor?: Cap }
  if (platform === null) { delete w.Capacitor; return }
  w.Capacitor = { getPlatform: () => platform, isNativePlatform: () => true, isPluginAvailable: (n) => plugins.includes(n) }
}
let ua: ReturnType<typeof vi.spyOn>
const setUa = (s: string) => ua.mockReturnValue(s)
const clearCookies = () => {
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0]?.trim()
    if (name) document.cookie = `${name}=; Path=/; Max-Age=0`
  }
}

beforeEach(() => {
  ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(DESKTOP)
  clearCookies()
})
afterEach(() => {
  vi.unstubAllEnvs()
  ua.mockRestore()
  setApp(null)
  clearCookies()
  delete (navigator as Navigator & { standalone?: boolean }).standalone
  window.history.replaceState(null, '', '/')
})

describe('parseAppleSignInFlag / unknownAppleSignInTokens (next.config.ts refuses the build on any)', () => {
  it('is empty for an unset or blank variable — the dark deploy', () => {
    expect(parseAppleSignInFlag(undefined).size).toBe(0)
    expect(parseAppleSignInFlag('').size).toBe(0)
    expect(parseAppleSignInFlag(' , ').size).toBe(0)
  })
  it('reads the three tokens, trimmed and lower-cased', () => {
    expect([...parseAppleSignInFlag(' IOS , Web-Test ')]).toEqual(['ios', 'web-test'])
    expect(parseAppleSignInFlag(APPLE_SIGNIN_TOKENS.join(',')).size).toBe(3)
  })
  it('names every token that is not one, and nothing else', () => {
    expect(unknownAppleSignInTokens(undefined)).toEqual([])
    expect(unknownAppleSignInTokens('ios,web')).toEqual([])
    expect(unknownAppleSignInTokens('ios,web_test,iso,all')).toEqual(['web_test', 'iso', 'all'])
  })
  it('next.config.ts actually refuses the build on an unknown token', () => {
    const cfg = readFileSync('next.config.ts', 'utf8')
    expect(cfg).toContain('import { unknownAppleSignInTokens } from "./src/lib/apple-signin"')
    expect(cfg).toMatch(/unknownAppleSignInTokens\(process\.env\.NEXT_PUBLIC_APPLE_SIGNIN\)[\s\S]{0,200}throw new Error/)
  })
})

describe('the flag readers', () => {
  it('appleFlagSet is any token; appleIosEnabled is `ios`', () => {
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', '')
    expect(appleFlagSet()).toBe(false)
    expect(appleIosEnabled()).toBe(false)
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'web-test')
    expect(appleFlagSet()).toBe(true)
    expect(appleIosEnabled()).toBe(false)
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'ios,web')
    expect(appleIosEnabled()).toBe(true)
  })
})

describe('the web tester cookie (`web-test`)', () => {
  it('does nothing at all while `web-test` is not in the flag — the dark deploy writes no cookie', () => {
    for (const flag of ['', 'ios', 'web', 'ios,web']) {
      vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', flag)
      expect(syncSiwaTestCookie('?siwa_test=1')).toBeNull()
      expect(siwaTester()).toBe(false)
    }
  })
  it('?siwa_test=1 sets it for 7 days, ?siwa_test=0 clears it, anything else is ignored', () => {
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'ios,web-test')
    // Record the raw writes (document.cookie reads back names and values only, never the attributes).
    const writes: string[] = []
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => desc.get!.call(document),
      set: (v: string) => { writes.push(v); desc.set!.call(document, v) },
    })
    expect(syncSiwaTestCookie('?q=x&siwa_test=1')).toBe('set')
    expect(writes.at(-1)).toMatch(new RegExp(`^${SIWA_TEST_COOKIE}=1; Path=/; Max-Age=604800; SameSite=Lax`))
    expect(siwaTester()).toBe(true)
    expect(syncSiwaTestCookie('?siwa_test=yes')).toBeNull()
    expect(syncSiwaTestCookie('')).toBeNull()
    expect(siwaTester()).toBe(true)
    expect(syncSiwaTestCookie('?siwa_test=0')).toBe('cleared')
    expect(writes.at(-1)).toContain('Max-Age=0')
    expect(siwaTester()).toBe(false)
    delete (document as unknown as { cookie?: string }).cookie
  })
  it('appleWebEnabled: `web` for everyone; `web-test` only with the cookie; nothing otherwise', () => {
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'web')
    expect(appleWebEnabled()).toBe(true)
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'ios,web-test')
    expect(appleWebEnabled()).toBe(false)
    document.cookie = `${SIWA_TEST_COOKIE}=1; Path=/`
    expect(appleWebEnabled()).toBe(true)
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'ios')
    expect(appleWebEnabled()).toBe(false) // the cookie alone opens nothing
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', '')
    expect(appleWebEnabled()).toBe(false)
  })
})

describe('the iOS app: Apple needs the plugin AND `ios`; Google shows only where Apple does', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-google,app-signin-tidy'))

  it('build 2 (no plugin), even with the flag fully on: no Apple, no Google', () => {
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'ios,web')
    setUa(IOS_APP); setApp('ios', [])
    expect(iosNativeAppleReady()).toBe(false)
    expect(appleAvailableHere()).toBe(false)
    expect(iosGoogleHidden()).toBe(true)
  })
  it('build 3 with `ios`: both', () => {
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'ios')
    setUa(IOS_APP); setApp('ios', [SIGN_IN_PLUGIN])
    expect(iosNativeAppleReady()).toBe(true)
    expect(appleAvailableHere()).toBe(true)
    expect(iosGoogleHidden()).toBe(false)
  })
  it('the plugin without `ios` (the dark deploy, or `web` alone): neither', () => {
    for (const flag of ['', 'web', 'web-test']) {
      vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', flag)
      setUa(IOS_APP); setApp('ios', [SIGN_IN_PLUGIN])
      expect(appleAvailableHere()).toBe(false)
      expect(iosGoogleHidden()).toBe(true)
    }
  })
  it('⛔ INVARIANT: in the iOS app Google is never visible without Apple', () => {
    for (const flag of ['', 'ios', 'web', 'web-test', 'ios,web', 'ios,web-test']) {
      for (const plugins of [[], [SIGN_IN_PLUGIN]]) {
        vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', flag)
        setUa(IOS_APP); setApp('ios', plugins)
        const googleVisible = !iosGoogleHidden()
        if (googleVisible) expect(appleAvailableHere(), `flag=${flag} plugins=${plugins}`).toBe(true)
      }
    }
  })
  it('the gate off is the owner turning it off: Google follows the old rule there (not hidden)', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', '')
    setUa(IOS_APP); setApp('ios', [])
    expect(iosGoogleHidden()).toBe(false)
  })
  it('Google is never hidden by this off iOS (Android, the web)', () => {
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', '')
    setUa(ANDROID_APP); setApp('android', [SIGN_IN_PLUGIN])
    expect(iosGoogleHidden()).toBe(false)
    setApp(null); setUa(IOS_SAFARI)
    expect(iosGoogleHidden()).toBe(false)
  })
})

describe('appleAvailableHere — the Android app and browsers', () => {
  it('the Android app follows the web flag (the Custom Tab flow), tester cookie included', () => {
    setUa(ANDROID_APP); setApp('android')
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'ios')
    expect(appleAvailableHere()).toBe(false)
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'web')
    expect(appleAvailableHere()).toBe(true)
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'ios,web-test')
    expect(appleAvailableHere()).toBe(false)
    document.cookie = `${SIWA_TEST_COOKIE}=1; Path=/`
    expect(appleAvailableHere()).toBe(true)
  })
  it('a real browser follows the web flag', () => {
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'web')
    for (const s of [DESKTOP, IOS_SAFARI, ANDROID_CHROME]) { setUa(s); expect(appleAvailableHere(), s).toBe(true) }
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'ios')
    setUa(DESKTOP)
    expect(appleAvailableHere()).toBe(false)
  })
  it('D7: no Apple in Facebook or Zalo in-app browsers, the iOS home-screen PWA or the SwiftUI tabs', () => {
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'web')
    for (const s of [FBAN, ZALO, SWIFTUI_TABS]) { setUa(s); expect(appleAvailableHere(), s).toBe(false) }
    setUa(IOS_SAFARI)
    ;(navigator as Navigator & { standalone?: boolean }).standalone = true
    expect(appleAvailableHere()).toBe(false)
  })
  it('no Apple in the app\'s in-app sheet document, nor on an app page without the bridge', () => {
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'web')
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-signin-tidy')
    setUa(IOS_SAFARI)
    window.history.replaceState(null, '', '/privacy?app_sheet=1')
    expect(appleAvailableHere()).toBe(false)
    window.history.replaceState(null, '', '/')
    setUa(ANDROID_APP) // app UA, no window.Capacitor (a page off server.url)
    expect(appleAvailableHere()).toBe(false)
  })
  it('the flag empty: nowhere', () => {
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', '')
    document.cookie = `${SIWA_TEST_COOKIE}=1; Path=/`
    setUa(DESKTOP); expect(appleAvailableHere()).toBe(false)
    setUa(ANDROID_APP); setApp('android'); expect(appleAvailableHere()).toBe(false)
    setUa(IOS_APP); setApp('ios', [SIGN_IN_PLUGIN]); expect(appleAvailableHere()).toBe(false)
  })
})

describe('Apple-sourced identity', () => {
  it('recognises both relay domains, case-insensitively, and nothing else', () => {
    expect(isAppleRelayEmail('abc123@privaterelay.appleid.com')).toBe(true)
    expect(isAppleRelayEmail('x@Private.iCloud.com')).toBe(true)
    expect(isAppleRelayEmail('x@icloud.com')).toBe(false)
    expect(isAppleRelayEmail('privaterelay.appleid.com@evil.example')).toBe(false)
    expect(isAppleRelayEmail('x@evil-privaterelay.appleid.com.example')).toBe(false)
    expect(isAppleRelayEmail(null)).toBe(false)
    expect(isAppleRelayEmail('no-at-sign')).toBe(false)
  })
  it('isAppleLinked reads app_metadata.providers (and a first provider of apple)', () => {
    expect(isAppleLinked({ provider: 'google', providers: ['google', 'apple'] })).toBe(true)
    expect(isAppleLinked({ provider: 'apple' })).toBe(true)
    expect(isAppleLinked({ provider: 'email', providers: ['email', 'google'] })).toBe(false)
    expect(isAppleLinked(null)).toBe(false)
    expect(isAppleLinked('apple')).toBe(false)
  })
  // ⛔ Commit gate round 2 (verifier): GoTrue keeps the provider as the authorize request spelled it, so a hand-made
  // `provider=Apple` makes an `Apple` account — read as not linked, its shared email reached Meta past D14.
  it('isAppleLinked reads Apple in any case — however an authorize request spelled it', () => {
    expect(isAppleLinked({ provider: 'Apple', providers: ['Apple'] })).toBe(true)
    expect(isAppleLinked({ provider: 'APPLE' })).toBe(true)
    expect(isAppleLinked({ provider: 'google', providers: ['google', 'Apple'] })).toBe(true)
    expect(isAppleLinked({ providers: [' apple '] })).toBe(true)
    expect(isAppleLinked({ provider: 'Google', providers: ['Google', 'email', 7, null] })).toBe(false)
    expect(isAppleLinked({ provider: 'apple.com', providers: ['appleid'] })).toBe(false)
  })
  it('appleSupportUrl follows the reader\'s language (B9)', () => {
    expect(appleSupportUrl('vi')).toBe('https://support.apple.com/vi-vn/102571')
    expect(appleSupportUrl('en')).toBe('https://support.apple.com/en-us/102571')
    expect(appleSupportUrl('ko')).toBe('https://support.apple.com/en-us/102571')
    expect(appleSupportUrl(undefined)).toBe('https://support.apple.com/en-us/102571')
  })
})

describe('next.config.ts can load this module', () => {
  /** next.config.ts imports apple-signin.ts at build time; its import graph must stay relative and dependency-free. */
  const importsOf = (file: string) => [...readFileSync(file, 'utf8').matchAll(/^import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1])
  it('imports only ./app-review-gates and ./in-app-browser, which import nothing', () => {
    expect(importsOf('src/lib/apple-signin.ts').sort()).toEqual(['./app-review-gates', './in-app-browser'])
    expect(importsOf('src/lib/app-review-gates.ts')).toEqual([])
    expect(importsOf('src/lib/in-app-browser.ts')).toEqual([])
  })
})
