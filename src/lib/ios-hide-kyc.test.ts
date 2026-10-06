// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { iosHideKycClient, iosHideKycFor, iosHideKycOn } from './ios-hide-kyc'
import { IOS_HIDDEN_KYC_WRITE_PREFIXES, iosHideKycRefusesApi, iosHideVisaRefusesApi } from './ios-hide-visa-api'

// ── App Store gate `ios-hide-kyc` (D5 = b for eKYC; split from ios-hide-visa 2026-10-06): the predicates ──────────
// Off ⇒ false for everyone. On ⇒ only the iOS app, and only identity / business-document capture. The e-Visa
// application — `ios-hide-visa`'s, which the owner keeps in BOTH apps — is untouched by this switch.

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

const KYC_WRITES: [string, string][] = [
  ['POST', '/api/seller/identity/challenge'],
  ['POST', '/api/seller/identity/documents'],
  ['POST', '/api/seller/identity/submit'],
  ['POST', '/api/seller/verification'],
  ['POST', '/api/seller/verification/documents'],
]
// The e-Visa flow the owner wants in the iOS app: the two document uploads (passport + portrait), their check, a card.
const VISA_WRITES: [string, string][] = [
  ['POST', '/api/visa/applications/start'],
  ['POST', '/api/visa/applications/abc/documents'],
  ['POST', '/api/visa/applications/abc/extract'],
  ['POST', '/api/visa/cards/m1/act'],
]

describe('gate OFF (the shipped default)', () => {
  it('nothing is hidden or refused for anyone', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    for (const ua of [IOS_APP, ANDROID_APP, IOS_SAFARI, null]) {
      expect(iosHideKycFor(ua)).toBe(false)
      for (const [m, p] of KYC_WRITES) expect(iosHideKycRefusesApi(p, m, ua)).toBe(false)
    }
    ;(window as unknown as Win).Capacitor = { getPlatform: () => 'ios' }
    expect(iosHideKycClient()).toBe(false)
  })

  it('every other gate on (ios-hide-visa excepted) still hides no identity capture', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-google,ios-hide-wallet,app-signin-tidy,app-no-gtm,site-brand-copy,ugc-safety,app-ai-notice')
    expect(iosHideKycOn()).toBe(false)
    expect(iosHideKycFor(IOS_APP)).toBe(false)
    for (const [m, p] of KYC_WRITES) expect(iosHideKycRefusesApi(p, m, IOS_APP)).toBe(false)
    ;(window as unknown as Win).Capacitor = { getPlatform: () => 'ios' }
    expect(iosHideKycClient()).toBe(false)
  })

  it('⛔ ios-hide-visa ALONE (an env line from before the split) still hides identity capture — the camera never reopens', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    expect(iosHideKycOn()).toBe(true)
    expect(iosHideKycFor(IOS_APP)).toBe(true)
    for (const [m, p] of KYC_WRITES) expect(iosHideKycRefusesApi(p, m, IOS_APP)).toBe(true)
    ;(window as unknown as Win).Capacitor = { getPlatform: () => 'ios' }
    expect(iosHideKycClient()).toBe(true)
  })
})

describe('gate ON', () => {
  it('server: the iOS app (incl. the same binary on a Mac), and nobody else', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-kyc')
    expect(iosHideKycFor(IOS_APP)).toBe(true)
    expect(iosHideKycFor(MAC_IOS_APP)).toBe(true)
    for (const ua of [ANDROID_APP, IOS_SAFARI, SWIFTUI_TABS, '', null, undefined]) expect(iosHideKycFor(ua)).toBe(false)
  })

  it('client: only when Capacitor reports ios', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-kyc')
    expect(iosHideKycClient()).toBe(false)
    ;(window as unknown as Win).Capacitor = { getPlatform: () => 'android' }
    expect(iosHideKycClient()).toBe(false)
    ;(window as unknown as Win).Capacitor = { getPlatform: () => 'ios' }
    expect(iosHideKycClient()).toBe(true)
  })

  it.each(KYC_WRITES)('refuses %s %s from the iOS app', (method, path) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-kyc')
    expect(iosHideKycRefusesApi(path, method, IOS_APP)).toBe(true)
    expect(iosHideKycRefusesApi(path, method.toLowerCase(), IOS_APP)).toBe(true)
  })

  it.each(KYC_WRITES)('leaves %s %s alone for Android, Safari and no user agent', (method, path) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-kyc')
    for (const ua of [ANDROID_APP, IOS_SAFARI, null]) expect(iosHideKycRefusesApi(path, method, ua)).toBe(false)
  })

  it('reads stay open — the person’s own status and case', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-kyc')
    for (const [m, p] of [
      ['GET', '/api/seller/identity/status'],
      ['GET', '/api/seller/verification'],
      ['HEAD', '/api/seller/identity/status'],
      ['OPTIONS', '/api/seller/identity/challenge'],
    ]) expect(iosHideKycRefusesApi(p, m, IOS_APP)).toBe(false)
  })

  it.each(VISA_WRITES)('the e-Visa flow stays open in the iOS app: %s %s (owner, 2026-10-06)', (method, path) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-kyc')
    expect(iosHideKycRefusesApi(path, method, IOS_APP)).toBe(false)
    expect(iosHideVisaRefusesApi(path, method, IOS_APP)).toBe(false)
  })

  it('touches nothing outside its prefixes — chat, payout, look-alike paths', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-kyc')
    for (const p of [
      '/api/conversations',
      '/api/conversations/c1/messages',
      '/api/seller/identityX/documents',
      '/api/seller/verificationX',
      '/api/seller/payout',
      '/api/listings',
    ]) expect(iosHideKycRefusesApi(p, 'POST', IOS_APP)).toBe(false)
  })

  it('the prefix list is exactly the two identity write surfaces the runbook names', () => {
    expect([...IOS_HIDDEN_KYC_WRITE_PREFIXES]).toEqual(['/api/seller/identity', '/api/seller/verification'])
  })
})

describe('the backstop list on the marketplace build (the one both apps load)', () => {
  it('is the SAME list there, and refuses the iOS app on eno.vn', async () => {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-kyc')
    const mod = await import('./ios-hide-visa-api')
    expect([...mod.IOS_HIDDEN_KYC_WRITE_PREFIXES]).toEqual(['/api/seller/identity', '/api/seller/verification'])
    expect(mod.iosHideKycRefusesApi('/api/seller/identity/challenge', 'POST', IOS_APP)).toBe(true)
    expect(mod.iosHideKycRefusesApi('/api/seller/identity/challenge', 'POST', ANDROID_APP)).toBe(false)
    expect(mod.iosHideVisaRefusesApi('/api/visa/applications/start', 'POST', IOS_APP)).toBe(false)
    vi.resetModules()
  })
})
