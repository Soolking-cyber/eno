// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { facebookAvailableHere, isFacebookLinked } from './facebook-signin'

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
