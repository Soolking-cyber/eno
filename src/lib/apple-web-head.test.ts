// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { noAppleWebHeadJs } from './apple-web-head'
import { appleAvailableHere } from './apple-signin'

/**
 * THE WEB APPLE BUTTON'S FIRST FRAME — `no-apple-web` (src/lib/apple-web-head.ts). With `web` in the flag the
 * server renders the Apple button for everyone and the mount effect removes it where appleAvailableHere() says no.
 * The pre-paint snippet must make THE SAME CALL, or the button flashes (snippet too lenient) or never shows where
 * it should (too strict). These tests run the real snippet and hold it to appleAvailableHere() itself.
 */

const UA = {
  desktopChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1',
  ipadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  androidWebView: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36',
  facebookIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.40.94;FBBV/600000000]',
  messengerIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/470.0.0.24.109]',
  instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 334.0.4.32.98 (iPhone15,2; iOS 17_5; vi_VN; vi; scale=3.00)',
  zaloAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 Zalo android/12210160 ZaloTheme/light',
  line: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.8.0',
  googleApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/321.0.645944285 Mobile/15E148 Safari/604.1',
  tabs: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeTabs/1',
  appUaNoBridge: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1',
}

type Ctx = { ua: string; standalone?: boolean; ipad?: boolean; search?: string; sheetGate?: boolean }

function setUp(c: Ctx): void {
  document.documentElement.className = ''
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(c.ua)
  Object.defineProperty(navigator, 'standalone', { configurable: true, value: c.standalone ?? false })
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(c.ipad ? 'MacIntel' : '')
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: c.ipad ? 5 : 0 })
  window.history.replaceState(null, '', `/signin${c.search ?? ''}`)
  vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'ios,web')
  vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', c.sheetGate ? 'app-signin-tidy' : '')
}
const run = (c: Ctx) => new Function(noAppleWebHeadJs({ web: true, sheetGate: !!c.sheetGate }))()
const hidden = () => document.documentElement.classList.contains('no-apple-web')

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  delete (window as unknown as { Capacitor?: unknown }).Capacitor
  document.documentElement.className = ''
  window.history.replaceState(null, '', '/')
})

describe('no-apple-web — the snippet makes the mount effect\'s call, before paint', () => {
  const corpus: Array<[string, Ctx, boolean]> = [
    ['desktop Chrome', { ua: UA.desktopChrome }, false],
    ['iPhone Safari', { ua: UA.iphoneSafari }, false],
    ['Android Chrome', { ua: UA.androidChrome }, false],
    ['iPhone home-screen web app (standalone)', { ua: UA.iphoneSafari, standalone: true }, true],
    ['iPad in desktop mode, home-screen web app', { ua: UA.ipadDesktopMode, ipad: true, standalone: true }, true],
    ['Facebook (iOS)', { ua: UA.facebookIos }, true],
    ['Messenger (iOS)', { ua: UA.messengerIos }, true],
    ['Instagram', { ua: UA.instagram }, true],
    ['Zalo (Android)', { ua: UA.zaloAndroid }, true],
    ['LINE', { ua: UA.line }, true],
    ['the Google app (GSA)', { ua: UA.googleApp }, true],
    ['an Android System WebView', { ua: UA.androidWebView }, true],
    ['the shelved native tabs (EnoNativeTabs)', { ua: UA.tabs }, true],
    ['the app\'s UA without its bridge', { ua: UA.appUaNoBridge }, true],
    ['the app\'s in-app sheet, gate on', { ua: UA.iphoneSafari, search: '?app_sheet=1', sheetGate: true }, true],
    ['?app_sheet=1 with the gate off — an ordinary page', { ua: UA.iphoneSafari, search: '?app_sheet=1', sheetGate: false }, false],
  ]
  it.each(corpus)('%s → hidden %s, exactly where appleAvailableHere() says no', (_name, c, want) => {
    setUp(c)
    run(c)
    expect(hidden()).toBe(want)
    expect(hidden()).toBe(!appleAvailableHere())
  })

  it.each([
    ['iOS', 'ios'],
    ['Android', 'android'],
  ] as const)('never inside the Capacitor app (%s): the native branch decides there', (_name, platform) => {
    setUp({ ua: platform === 'ios' ? UA.appUaNoBridge : UA.androidWebView })
    ;(window as unknown as { Capacitor: unknown }).Capacitor = { isNativePlatform: () => true, getPlatform: () => platform }
    run({ ua: '' })
    expect(hidden()).toBe(false)
  })

  it('a throw costs only this class (nothing escapes the snippet)', () => {
    setUp({ ua: UA.facebookIos })
    vi.spyOn(navigator, 'userAgent', 'get').mockImplementation(() => { throw new Error('boom') })
    expect(() => run({ ua: '' })).not.toThrow()
    expect(hidden()).toBe(false)
  })
})

describe('…and where it lives', () => {
  it('without `web` the build emits nothing — no script tag at all', () => {
    expect(noAppleWebHeadJs({ web: false, sheetGate: true })).toBe('')
  })

  it('globals.css hides `.apple-web` under `no-apple-web`, unlayered beside the other first-frame rules', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
    expect(css).toMatch(/html\.no-apple-web \.apple-web \{\n {2}display: none;\n\}/)
    expect(css.indexOf('html.no-apple-web .apple-web')).toBeGreaterThan(css.indexOf('html:not(.native-siwa) .apple-native-only'))
  })

  it('layout.tsx emits it as its own <script>, right after the pre-paint head script', () => {
    const layout = readFileSync(join(process.cwd(), 'src/app/[lang]/layout.tsx'), 'utf8')
    const tag = '{NO_APPLE_WEB_JS ? <script dangerouslySetInnerHTML={{ __html: NO_APPLE_WEB_JS }} /> : null}'
    expect(layout).toContain(tag)
    expect(layout.indexOf(tag)).toBeGreaterThan(layout.indexOf('__html: `(function(){try{var m=matchMedia'))
  })

  it('the sign-in form puts `apple-web` on the Apple button exactly when `web` is on', () => {
    const form = readFileSync(join(process.cwd(), 'src/components/marketplace/sign-in-form.tsx'), 'utf8')
    expect(form).toContain("appleWebAll && 'apple-web'")
  })
})
