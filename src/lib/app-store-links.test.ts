// @vitest-environment jsdom
/**
 * The phone's own store (owner, 2026-11-08: "apple device should be shown ios download and android one the android
 * version"), decided the same way before paint (STORE_OS_HEAD_JS) and after (storeOs).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { IOS_APP_STORE_ID, IOS_APP_URL, STORE_OS_HEAD_JS, storeOs } from './app-store-links'

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
  iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15',
  iphoneEdge: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/131.0.2903.68 Mobile/15E148 Safari/605.1.15',
  iphoneFacebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22B83 [FBAN/FBIOS;FBAV/489.0.0.36.107;FBBV/655014785]',
  iphoneZalo: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1 Zalo iOS',
  enoTabs: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1 EnoNativeTabs/1.0.3',
  ipadDesktopSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
}

describe('the App Store link', () => {
  it('is the live listing, with no storefront country (each reader opens their own)', () => {
    expect(IOS_APP_STORE_ID).toBe('6819638569')
    expect(IOS_APP_URL).toBe('https://apps.apple.com/app/id6819638569')
  })
})

describe('storeOs', () => {
  it('names the store a device installs from', () => {
    expect(storeOs(UA.iphoneSafari)).toBe('ios')
    expect(storeOs(UA.iphoneChrome)).toBe('ios')
    expect(storeOs(UA.androidChrome)).toBe('android')
    expect(storeOs(UA.windowsChrome)).toBeNull()
    expect(storeOs(UA.macSafari, 'MacIntel', 0)).toBeNull()
  })
  it('an iPad on its default desktop agent is an iPad, by its touch points', () => {
    expect(storeOs(UA.ipadDesktopSafari, 'MacIntel', 5)).toBe('ios')
  })
})

describe('STORE_OS_HEAD_JS — the pre-paint class the footer reads', () => {
  const as = (ua: string, platform = '', touch = 0) => {
    Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })
    Object.defineProperty(window.navigator, 'platform', { value: platform, configurable: true })
    Object.defineProperty(window.navigator, 'maxTouchPoints', { value: touch, configurable: true })
    const dc = document.documentElement.classList
    dc.remove('os-ios', 'os-android')
    new Function('dc', STORE_OS_HEAD_JS)(dc)
    return [...dc].filter((c) => c.startsWith('os-'))
  }
  afterEach(() => {
    for (const k of ['userAgent', 'platform', 'maxTouchPoints'] as const) delete (window.navigator as unknown as Record<string, unknown>)[k]
    document.documentElement.classList.remove('os-ios', 'os-android')
  })
  it('agrees with storeOs on every agent, a lowercase token included (both case-sensitive)', () => {
    for (const [ua, platform, touch] of [
      [UA.iphoneSafari, '', 0], [UA.iphoneChrome, '', 0], [UA.iphoneFacebook, '', 0], [UA.ipadDesktopSafari, 'MacIntel', 5],
      [UA.androidChrome, '', 0], [UA.macSafari, 'MacIntel', 0], [UA.windowsChrome, 'Win32', 0],
      ['Mozilla/5.0 (Linux; android 14; generic)', '', 0], ['Mozilla/5.0 (iphone; cpu os 18_1)', '', 0],
    ] as const) {
      const os = storeOs(ua, platform, touch)
      expect(as(ua, platform, touch), ua).toEqual(os ? [`os-${os}`] : [])
    }
    expect(as(UA.iphoneSafari)).toEqual(['os-ios'])
    expect(as(UA.ipadDesktopSafari, 'MacIntel', 5)).toEqual(['os-ios'])
    expect(as(UA.androidChrome)).toEqual(['os-android'])
    expect(as(UA.macSafari, 'MacIntel', 0)).toEqual([])
    expect(as(UA.windowsChrome, 'Win32', 0)).toEqual([])
  })
  it('stays free of backslashes — it is spliced into a template literal', () => {
    expect(STORE_OS_HEAD_JS).not.toContain('\\')
  })
})
