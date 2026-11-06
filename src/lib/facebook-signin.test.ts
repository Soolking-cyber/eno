// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { facebookAvailableHere, facebookIosApp, facebookSignInInIosApp, isFacebookLinked } from './facebook-signin'

// An account carries a Facebook identity — its email is then Platform Data that never reaches another ad network.
describe('isFacebookLinked', () => {
  it('the first provider or any linked one, in any case', () => {
    expect(isFacebookLinked({ provider: 'facebook', providers: ['facebook'] })).toBe(true)
    expect(isFacebookLinked({ provider: 'email', providers: ['email', 'Facebook'] })).toBe(true)
    expect(isFacebookLinked({ provider: ' FACEBOOK ' })).toBe(true)
  })
  it('anything else is not', () => {
    expect(isFacebookLinked({ provider: 'google', providers: ['google', 'apple'] })).toBe(false)
    expect(isFacebookLinked({ provider: 'facebook_page' })).toBe(false)
    for (const v of [null, undefined, 'facebook', 42, {}, { providers: 'facebook' }]) expect(isFacebookLinked(v)).toBe(false)
  })
})

// Every real browser and Meta's own in-app browsers (the 10-17 hold-back on those was lifted 10-19); never another app's
// Android webview (Meta ended Facebook Login there, 2021-10-05), never inside the eno apps.
describe('facebookAvailableHere', () => {
  const setUa = (ua: string) => Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => ua })
  it('a real browser, and Facebook, Messenger or Instagram on Android or iOS', () => {
    for (const ua of [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Linux; Android 14; SM-A546E; wv) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]',
      'Mozilla/5.0 (Linux; Android 14; SM-A546E; wv) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/480.0.0.0;]',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 Instagram 350.0.0.0.0 Android',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.0;]',
    ]) {
      setUa(ua)
      expect(facebookAvailableHere(), ua).toBe(true)
    }
  })
  it('⛔ not in another app\'s Android webview — Zalo, TikTok, an unnamed `wv` — nor in the eno app', () => {
    for (const ua of [
      'Mozilla/5.0 (Linux; Android 14; SM-A546E; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 Zalo android/12210160',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 musical_ly_2024103020 BytedanceWebview/d8a21c6',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1.0.3',
    ]) {
      setUa(ua)
      expect(facebookAvailableHere(), ua).toBe(false)
    }
  })
})

// The iOS app (owner, 2026-11-06): Connect and Import through its in-app browser sheet; sign-in only beside Apple (Guideline 4.8).
describe('the iOS app', () => {
  const cap = (platform: string | null, plugin = true) => {
    vi.stubGlobal('Capacitor', platform ? { isNativePlatform: () => true, getPlatform: () => platform, isPluginAvailable: (n: string) => plugin && n === 'EnoSignIn' } : undefined)
  }
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
  it('Connect and Import: the iOS app, never Android\'s app or a browser', () => {
    cap('ios')
    expect(facebookIosApp()).toBe(true)
    cap('android')
    expect(facebookIosApp()).toBe(false)
    cap(null)
    expect(facebookIosApp()).toBe(false)
  })
  it('⛔ sign-in: only where the native Apple sheet runs beside it', () => {
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'ios')
    cap('ios')
    expect(facebookSignInInIosApp()).toBe(true)
    cap('ios', false)
    expect(facebookSignInInIosApp()).toBe(false)
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', '')
    cap('ios')
    expect(facebookSignInInIosApp()).toBe(false)
  })
})
