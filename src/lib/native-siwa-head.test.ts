// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nativeSiwaHeadJs } from './native-siwa-head'
import { headScriptSource, runHeadScript } from '@/test/head-script'

/**
 * THE iOS APP'S FIRST FRAME FOR SIGN IN WITH APPLE — `native-siwa` on <html> (plan §7.2, §8 "Head script").
 *
 * The sign-in providers are server-rendered into HTML shared by the web, both apps and every iOS binary, so the
 * first frame is decided by the pre-paint head script plus two CSS rules (globals.css). These tests run the REAL
 * head script, assembled from layout.tsx's own template (src/test/head-script.ts), against a stubbed Capacitor
 * bridge, and hold the CSS rules to their selectors.
 */

type Cap = { isNativePlatform?: () => boolean; getPlatform?: () => string; isPluginAvailable?: (name: string) => boolean; nativePromise?: (...a: unknown[]) => unknown }
type Win = Window & { Capacitor?: Cap; __enoLeaving?: number }
const win = window as unknown as Win

const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const IOS_APP_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const TABS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeTabs/1'

const classes = () => [...document.documentElement.classList]

/** The bridge an iOS / Android binary injects at document start. `plugin` is what isPluginAvailable('EnoSignIn') says. */
function bridge(platform: 'ios' | 'android', plugin: boolean | 'throws', ua = IOS_APP_UA) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
  const nativePromise = vi.fn(() => Promise.resolve())
  win.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => platform,
    isPluginAvailable: (name: string) => {
      if (plugin === 'throws') throw new Error('bridge not ready')
      return plugin && name === 'EnoSignIn'
    },
    nativePromise,
  }
  return nativePromise
}

beforeEach(() => {
  document.documentElement.className = ''
  // The splash lift is not under test except where a test says so: skip it unless a test clears this.
  win.__enoLeaving = 1
})
afterEach(() => {
  delete win.Capacitor
  delete win.__enoLeaving
  document.documentElement.className = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('native-siwa — only an iOS binary with EnoSignIn, built with `ios`', () => {
  it('iOS + the plugin + `ios` → native, native-ios AND native-siwa (build 3 after the flip)', () => {
    bridge('ios', true)
    runHeadScript({ appleIos: true })
    expect(classes()).toEqual(expect.arrayContaining(['native', 'native-ios', 'native-siwa']))
  })

  it('build 2 (no plugin), even with `ios` in the flag → no native-siwa', () => {
    bridge('ios', false)
    runHeadScript({ appleIos: true })
    expect(classes()).toEqual(expect.arrayContaining(['native', 'native-ios']))
    expect(classes()).not.toContain('native-siwa')
  })

  it('the plugin without `ios` (the dark deploy) → no native-siwa, and the script carries no Apple code at all', () => {
    bridge('ios', true)
    runHeadScript({ appleIos: false })
    expect(classes()).toEqual(expect.arrayContaining(['native', 'native-ios']))
    expect(classes()).not.toContain('native-siwa')
    expect(nativeSiwaHeadJs(false)).toBe('')
    expect(headScriptSource({ appleIos: false })).not.toMatch(/EnoSignIn|native-siwa/)
  })

  it('never on the web', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(DESKTOP_UA)
    runHeadScript({ appleIos: true })
    expect(classes()).not.toContain('native-siwa')
    expect(classes()).not.toContain('native')
  })

  it('never in the Android app, even if a bridge there claimed the plugin', () => {
    bridge('android', true, 'Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 EnoNativeApp/1')
    runHeadScript({ appleIos: true })
    expect(classes()).toEqual(expect.arrayContaining(['native', 'native-android']))
    expect(classes()).not.toContain('native-siwa')
  })

  it('never in the shelved SwiftUI tabs (EnoNativeTabs) — no bridge, so no plugin', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(TABS_UA)
    runHeadScript({ appleIos: true })
    expect(classes()).toEqual(expect.arrayContaining(['native', 'native-ios', 'native-tabs']))
    expect(classes()).not.toContain('native-siwa')
  })
})

describe('a throwing bridge costs only native-siwa', () => {
  it('isPluginAvailable throws → native and native-ios stay set, no native-siwa, and the splash still lifts', () => {
    const nativePromise = bridge('ios', 'throws')
    delete win.__enoLeaving // run the splash lift this time: it follows the snippet in the same branch
    vi.stubGlobal('PerformanceObserver', undefined)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0 })
    runHeadScript({ appleIos: true })
    expect(classes()).toEqual(expect.arrayContaining(['native', 'native-ios']))
    expect(classes()).not.toContain('native-siwa')
    expect(nativePromise).toHaveBeenCalledWith('SplashScreen', 'hide', { fadeOutDuration: 200 })
  })
})

describe('the snippet and its place', () => {
  it('is safe inside the template literal: no backslash, no backtick, no ${', () => {
    expect(nativeSiwaHeadJs(true)).not.toMatch(/\\|`|\$\{/)
  })

  it('is spliced into the native branch right after the native-<platform> class', () => {
    const layout = readFileSync(join(process.cwd(), 'src/app/[lang]/layout.tsx'), 'utf8')
    expect(layout).toContain("dc.add('native-'+(C.getPlatform?C.getPlatform():'ios'));${NATIVE_SIWA_JS}")
  })
})

describe('globals.css — the two first-frame rules the classes drive', () => {
  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
  it('hides `ios-nosiwa-hidden` in the iOS app unless native-siwa is set', () => {
    expect(css).toMatch(/html\.native-ios:not\(\.native-siwa\)\s+\.ios-nosiwa-hidden\s*\{\s*display:\s*none;?\s*\}/)
  })
  it('hides `apple-native-only` everywhere native-siwa is not set', () => {
    expect(css).toMatch(/html:not\(\.native-siwa\)\s+\.apple-native-only\s*\{\s*display:\s*none;?\s*\}/)
  })
})
