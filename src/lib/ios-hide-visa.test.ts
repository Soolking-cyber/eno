// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { iosHideVisaClient, iosHideVisaFor } from './ios-hide-visa'
import { IOS_HIDDEN_WRITE_PREFIXES, iosHideVisaRefusesApi } from './ios-hide-visa-api'

// ── App Store gate `ios-hide-visa` (D5 = b): the predicates every layer uses ─────────────────────────
// Off ⇒ false for everyone. On ⇒ only the iOS app; Android, Safari and the shelved SwiftUI app are untouched.

const IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const MAC_IOS_APP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) EnoNativeApp/1'
const ANDROID_APP = 'Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 EnoNativeApp/1'
const IOS_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1'
const SWIFTUI_TABS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeTabs/1'

type Win = { Capacitor?: { getPlatform?: () => string } }
afterEach(() => {
  vi.unstubAllEnvs()
  delete (window as unknown as Win).Capacitor
})

const WRITES: [string, string][] = [
  ['POST', '/api/visa/applications/start'],
  ['POST', '/api/visa/applications'],
  ['PATCH', '/api/visa/applications/abc'],
  ['POST', '/api/visa/applications/abc/documents'],
  ['POST', '/api/visa/applications/abc/extract'],
  ['POST', '/api/visa/applications/abc/select-product'],
  ['POST', '/api/visa/applications/abc/submit'],
  ['POST', '/api/visa/applications/abc/checkout'],
  ['POST', '/api/visa/cards/m1/act'],
  ['POST', '/api/seller/identity/challenge'],
  ['POST', '/api/seller/identity/documents'],
  ['POST', '/api/seller/identity/submit'],
  ['POST', '/api/seller/verification'],
  ['POST', '/api/seller/verification/documents'],
]

describe('gate OFF (the shipped default)', () => {
  it('nothing is hidden or refused for anyone', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    for (const ua of [IOS_APP, ANDROID_APP, IOS_SAFARI, null]) {
      expect(iosHideVisaFor(ua)).toBe(false)
      for (const [m, p] of WRITES) expect(iosHideVisaRefusesApi(p, m, ua)).toBe(false)
    }
    ;(window as unknown as Win).Capacitor = { getPlatform: () => 'ios' }
    expect(iosHideVisaClient()).toBe(false)
  })

  it('every other gate on still hides nothing', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-google,ios-hide-wallet,app-signin-tidy,app-no-gtm,site-brand-copy,ugc-safety,app-ai-notice')
    expect(iosHideVisaFor(IOS_APP)).toBe(false)
    expect(iosHideVisaRefusesApi('/api/visa/applications/start', 'POST', IOS_APP)).toBe(false)
  })
})

describe('gate ON', () => {
  it('server: the iOS app (incl. the same binary on a Mac), and nobody else', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    expect(iosHideVisaFor(IOS_APP)).toBe(true)
    expect(iosHideVisaFor(MAC_IOS_APP)).toBe(true)
    for (const ua of [ANDROID_APP, IOS_SAFARI, SWIFTUI_TABS, '', null, undefined]) expect(iosHideVisaFor(ua)).toBe(false)
  })

  it('client: only when Capacitor reports ios', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    expect(iosHideVisaClient()).toBe(false)
    ;(window as unknown as Win).Capacitor = { getPlatform: () => 'android' }
    expect(iosHideVisaClient()).toBe(false)
    ;(window as unknown as Win).Capacitor = { getPlatform: () => 'ios' }
    expect(iosHideVisaClient()).toBe(true)
  })

  it.each(WRITES)('refuses %s %s from the iOS app', (method, path) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    expect(iosHideVisaRefusesApi(path, method, IOS_APP)).toBe(true)
    expect(iosHideVisaRefusesApi(path, method.toLowerCase(), IOS_APP)).toBe(true)
  })

  it.each(WRITES)('leaves %s %s alone for Android, Safari and no user agent', (method, path) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    for (const ua of [ANDROID_APP, IOS_SAFARI, null]) expect(iosHideVisaRefusesApi(path, method, ua)).toBe(false)
  })

  it('reads stay open — a status, the applicant’s own case, a finished e-Visa — and so does DELETE (captures nothing)', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    for (const [m, p] of [
      ['GET', '/api/seller/identity/status'],
      ['GET', '/api/visa/applications/abc'],
      ['GET', '/api/visa/applications/abc/result'],
      ['HEAD', '/api/visa/applications'],
      ['OPTIONS', '/api/visa/applications/start'],
      ['DELETE', '/api/visa/applications/abc'],
      ['DELETE', '/api/visa/applications/abc/documents/d1'],
    ]) expect(iosHideVisaRefusesApi(p, m, IOS_APP)).toBe(false)
  })

  it('touches nothing outside its prefixes — the desk admin, chat, look-alike paths', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    for (const p of [
      '/api/visa/admin/applications/abc/result',
      '/api/conversations',
      '/api/conversations/c1/messages',
      '/api/messages/translate',
      '/api/visa/applicationsX',
      '/api/seller/identityX/documents',
      '/api/seller/payout',
      '/api/listings',
    ]) expect(iosHideVisaRefusesApi(p, 'POST', IOS_APP)).toBe(false)
  })

  it('the prefix list is exactly the four write surfaces the runbook names', () => {
    expect([...IOS_HIDDEN_WRITE_PREFIXES]).toEqual(['/api/visa/applications', '/api/visa/cards', '/api/seller/identity', '/api/seller/verification'])
  })
})

describe('the backstop list on the marketplace build', () => {
  it('is EMPTY there — the literal folds away, so no e-Visa route name ships in eno.vn\'s proxy', async () => {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    const mod = await import('./ios-hide-visa-api')
    expect(mod.IOS_HIDDEN_WRITE_PREFIXES).toEqual([])
    expect(mod.iosHideVisaRefusesApi('/api/visa/applications/start', 'POST', IOS_APP)).toBe(false)
    vi.resetModules()
  })
})
