// @vitest-environment jsdom
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { runHeadScript } from '@/test/head-script'

// ── App Store review gates on the sign-in form (src/lib/app-review-gates.ts, plan R2 / R7 / R13) ──────
// Every gate is DORMANT: with NEXT_PUBLIC_APP_REVIEW_GATES unset, the form is byte-for-byte what it was
// in every context. With a gate on, only the context it names changes.
// ── And Sign in with Apple (src/lib/apple-signin.ts, ~/eno-ios-prep/siwa/plan.md §7.3 / §8) ───────────────
// NEXT_PUBLIC_APPLE_SIGNIN = `ios` / `web-test` / `web`. Empty is the dark deploy: no Apple anywhere, Google's
// old look. In the iOS app Google shows only where Apple shows (Guideline 4.8).

vi.mock('@/lib/google-identity', () => ({ googleFirstPartyEnabled: () => true }))
const browserOpen = vi.fn(async (_options: unknown) => {})
vi.mock('@capacitor/browser', () => ({ Browser: { open: (o: unknown) => browserOpen(o), close: async () => {} } }))
const clearStalePkceCookies = vi.fn(() => 0)
vi.mock('@/lib/auth-pkce', () => ({ clearStalePkceCookies: () => clearStalePkceCookies() }))
const signInWithOAuth = vi.fn(async (_args: { provider: string; options: Record<string, unknown> }) => ({ data: { url: 'https://sb.example/auth/v1/authorize?provider=apple&code_challenge=abc' }, error: null }))
vi.mock('@/lib/supabase/browser', () => ({ createSupabaseBrowser: () => ({ auth: { signInWithOAuth: (a: { provider: string; options: Record<string, unknown> }) => signInWithOAuth(a) } }) }))
// The iOS native Apple flow is native-auth's (and has its own tests); here only WHO calls it, and what a failure
// shows. nativeOAuth stays real (so the Android path really reaches Browser.open) unless a test parks it.
const nativeAppleSignIn = vi.fn(async (_next: string) => {})
const nativeOAuthCalls = vi.fn()
let parkNativeOAuth = false
vi.mock('@/lib/native-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/native-auth')>()
  return {
    ...orig,
    nativeAppleSignIn: (next: string) => nativeAppleSignIn(next),
    nativeOAuth: (sb: Parameters<typeof orig.nativeOAuth>[0], provider: 'google' | 'apple', next: string) => {
      nativeOAuthCalls(provider, next)
      return parkNativeOAuth ? new Promise<void>(() => {}) : orig.nativeOAuth(sb, provider, next)
    },
  }
})

import { SignInForm } from './sign-in-form'
import { NativeAuthError } from '@/lib/native-auth'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const IOS_APP_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const ANDROID_APP_UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 EnoNativeApp/1'
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const FBAN_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.0;FBBV/1;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.4;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]'
const ZALO_UA = 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 Zalo android/12210160 ZaloTheme/light ZaloLanguage/vn'
const IOS_SAFARI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1'

type Cap = { isNativePlatform: () => boolean; getPlatform: () => string; isPluginAvailable?: (name: string) => boolean }
type Win = { Capacitor?: Cap }
/** `plugin`: this iOS binary carries EnoSignIn (build 3) — isPluginAvailable('EnoSignIn'). */
function context(kind: 'ios-app' | 'android-app' | 'web', opts: { plugin?: boolean; ua?: string } = {}) {
  const ua = opts.ua ?? (kind === 'ios-app' ? IOS_APP_UA : kind === 'android-app' ? ANDROID_APP_UA : DESKTOP_UA)
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
  if (kind === 'web') delete (window as unknown as Win).Capacitor
  else {
    (window as unknown as Win).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => (kind === 'ios-app' ? 'ios' : 'android'),
      ...(opts.plugin ? { isPluginAvailable: (name: string) => name === 'EnoSignIn' } : {}),
    }
  }
}
function flags(gates: string, apple: string) {
  vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', gates)
  vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', apple)
}
function testerCookie(on: boolean) {
  document.cookie = on ? 'eno-siwa-test=1; path=/' : 'eno-siwa-test=; path=/; max-age=0'
}

async function renderForm(props: Partial<React.ComponentProps<typeof SignInForm>> = {}) {
  render(
    <LanguageProvider initialLang="en" initialViDict={{}}>
      <SignInForm {...props} />
    </LanguageProvider>,
  )
  await act(async () => {}) // let the mount effect read the platform
}
/** The server's markup for the same flags: renderToString runs no effect, exactly like SSR. */
function ssr(props: Partial<React.ComponentProps<typeof SignInForm>> = {}): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = renderToString(<LanguageProvider initialLang="en" initialViDict={{}}><SignInForm {...props} /></LanguageProvider>)
  return host
}
const byText = (root: ParentNode, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(text)) ?? null
const google = () => screen.queryByRole('button', { name: /Continue with Google/ })
const apple = () => screen.queryByRole('button', { name: /Continue with Apple/ })
const legal = (name: string) => screen.getByRole('link', { name })
// The Google button's classes exactly as the code before Sign in with Apple passed them to <Button> — the
// flag-empty markup must not move — merged the way ui/button merges them (it drops `transition-colors` itself).
const GOOGLE_TODAY = 'flex min-h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-line-strong bg-popover px-4 text-sm font-bold text-foreground transition-colors hover:bg-tint disabled:opacity-50 cursor-pointer'
const googleToday = (hook?: string) =>
  cn(buttonVariants({ variant: 'bare', size: 'none', className: cn(GOOGLE_TODAY, hook).split(/\s+/).filter((c) => c !== 'transition-colors').join(' ') }))
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

beforeEach(() => {
  browserOpen.mockClear()
  clearStalePkceCookies.mockClear()
  signInWithOAuth.mockClear()
  nativeAppleSignIn.mockReset()
  nativeAppleSignIn.mockImplementation(async () => {})
  nativeOAuthCalls.mockClear()
  parkNativeOAuth = false
  testerCookie(false)
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (window as unknown as Win).Capacitor
  testerCookie(false)
  document.documentElement.className = ''
  window.history.replaceState(null, '', '/')
})

describe('with every gate OFF (the shipped default)', () => {
  it.each(['ios-app', 'android-app', 'web'] as const)('%s: Google is offered and legal links open a new tab', async (kind) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    context(kind)
    await renderForm()
    expect(google()).toBeTruthy()
    expect(google()!.className).not.toContain('ios-nosiwa-hidden')
    expect(legal('Terms').getAttribute('target')).toBe('_blank')
    expect(document.querySelector('.native-app-hidden')).toBeNull()
  })
})

describe('ios-hide-google (Guideline 4.8)', () => {
  it('removes Google in the iOS app — the email form shows at once', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-google')
    context('ios-app')
    await renderForm()
    expect(google()).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeTruthy()
  })

  it.each(['android-app', 'web'] as const)('keeps Google on %s', async (kind) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-google')
    context(kind)
    await renderForm()
    expect(google()).toBeTruthy()
  })

  it('marks the server-rendered button with the iOS-only CSS hook, so the first frame is already right', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-google')
    context('web')
    await renderForm()
    // On the web the hook is inert (globals.css scopes it to html.native-ios) — but it must be there. Since Sign in
    // with Apple it is `ios-nosiwa-hidden`: hidden in the iOS app unless the head script set `native-siwa`.
    expect(google()!.className).toContain('ios-nosiwa-hidden')
    expect(google()!.className).not.toContain('ios-app-hidden')
  })
})

describe('app-signin-tidy (R7 / R13)', () => {
  it('in an app: the disabled "Phone · soon" strip is hooked out and the legal links stay in the app', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-signin-tidy')
    context('android-app')
    await renderForm()
    const strip = screen.getByRole('tablist')
    expect(strip.className).toContain('native-app-hidden')
    for (const name of ['Terms', 'Operating regulations', 'Privacy Policy']) expect(legal(name).getAttribute('target')).toBeNull()
  })

  it('in an app: a legal link opens the in-app browser sheet, so a half-finished sign-in survives', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-signin-tidy')
    context('ios-app')
    await renderForm()
    const link = legal('Terms')
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    // Marked as the app's sheet: the sheet runs with the browser's UA, so the page needs the marker to
    // behave as the app for consent and analytics (app-review-gates.ts IN_APP_SHEET_PARAM).
    await vi.waitFor(() => expect(browserOpen).toHaveBeenCalledWith({ url: `${window.location.origin}/terms?app_sheet=1` }))
  })

  it('if the sheet fails to open, it falls back to a NEW window, never this one', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-signin-tidy')
    context('ios-app')
    browserOpen.mockRejectedValueOnce(new Error('plugin missing'))
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await renderForm()
    legal('Privacy Policy').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    // The fallback is the system browser, not the app — it gets the plain URL, no sheet marker.
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith(`${window.location.origin}/privacy`, '_blank', 'noreferrer'))
  })

  it('an app page with NO bridge keeps target=_blank — a same-window link would lose the sign-in', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-signin-tidy')
    context('android-app')
    delete (window as unknown as Win).Capacitor // the UA says app, but this origin got no bridge
    await renderForm()
    expect(legal('Terms').getAttribute('target')).toBe('_blank')
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    legal('Terms').dispatchEvent(click)
    expect(click.defaultPrevented).toBe(false)
    expect(browserOpen).not.toHaveBeenCalled()
  })

  it('on the web: links still open a new tab (the CSS hook is inert without html.native)', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-signin-tidy')
    context('web')
    await renderForm()
    expect(legal('Terms').getAttribute('target')).toBe('_blank')
  })
})

// ════════════════════════════════════════════ Sign in with Apple ════════════════════════════════════════════

describe('Sign in with Apple — the flag EMPTY is the dark deploy: the markup is today’s', () => {
  it.each(['ios-app', 'android-app', 'web'] as const)('%s: no Apple node, and Google keeps its old classes', async (kind) => {
    flags('ios-hide-google,app-signin-tidy', '')
    context(kind, { plugin: true })
    await renderForm()
    expect(apple()).toBeNull()
    expect(document.querySelector('.apple-native-only')).toBeNull()
    if (kind !== 'ios-app') expect(google()!.className).toBe(googleToday('ios-nosiwa-hidden'))
    // Build 3 with the flag empty is build 2: the gate keeps Google away (the plugin alone opens nothing).
    else expect(google()).toBeNull()
  })

  it('the server markup: Google with the old classes, the divider, and no Apple at all', () => {
    flags('ios-hide-google', '')
    const html = ssr()
    expect(byText(html, 'Continue with Apple')).toBeNull()
    expect(byText(html, 'Continue with Google')!.className).toBe(googleToday('ios-nosiwa-hidden'))
    expect(html.querySelector('.ios-nosiwa-hidden.flex.items-center.gap-3.py-1')).toBeTruthy()
    expect(html.innerHTML).not.toMatch(/apple-native-only|data-loading|#747775/)
  })

  it('and with the gates off too, the Google button carries no hook at all', () => {
    flags('', '')
    expect(byText(ssr(), 'Continue with Google')!.className).toBe(googleToday())
  })
})

describe('Sign in with Apple — iOS build 2 (no EnoSignIn), gate on, even with the flag fully on', () => {
  it('shows neither Apple nor Google once mounted — the email form leads', async () => {
    flags('ios-hide-google', 'ios,web')
    context('ios-app')
    await renderForm()
    expect(apple()).toBeNull()
    expect(google()).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeTruthy()
  })

  it('its server-rendered nodes carry ios-nosiwa-hidden, so the first frame shows neither either', () => {
    flags('ios-hide-google', 'ios,web')
    const html = ssr()
    expect(byText(html, 'Continue with Google')!.className).toContain('ios-nosiwa-hidden')
    const a = byText(html, 'Continue with Apple')!
    expect(a.className).toContain('ios-nosiwa-hidden')
    // `web` is in the flag: the server node is for everyone (no apple-native-only); the iOS hook still hides it.
    expect(a.className).not.toContain('apple-native-only')
  })

  it('a tap that reaches either button anyway starts nothing (the guards ask the platform at tap time)', async () => {
    // Rendered as a browser (both buttons up), then the platform becomes iOS build 2 before the taps.
    flags('ios-hide-google', 'ios,web')
    context('web')
    await renderForm()
    const g = google()!
    const a = apple()!
    context('ios-app')
    fireEvent.click(a)
    fireEvent.click(g)
    await flush()
    expect(nativeAppleSignIn).not.toHaveBeenCalled()
    expect(nativeOAuthCalls).not.toHaveBeenCalled()
    expect(signInWithOAuth).not.toHaveBeenCalled()
    expect(clearStalePkceCookies).not.toHaveBeenCalled()
  })

  it('?g=fallback starts nothing either (the retry that fires with no tap)', async () => {
    flags('ios-hide-google', 'ios,web')
    context('ios-app')
    window.history.replaceState(null, '', '/signin?g=fallback')
    await renderForm()
    await flush()
    expect(new URLSearchParams(window.location.search).get('g')).toBeNull()
    expect(nativeOAuthCalls).not.toHaveBeenCalled()
    expect(signInWithOAuth).not.toHaveBeenCalled()
  })
})

describe('Sign in with Apple — iOS build 3 (EnoSignIn)', () => {
  it('with `ios`: Apple AND Google, in that order Google first, both the same size', async () => {
    flags('ios-hide-google', 'ios')
    context('ios-app', { plugin: true })
    await renderForm()
    const g = google()!
    const a = apple()!
    expect(g.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    for (const cls of ['min-h-11', 'w-full', 'rounded-xl']) {
      expect(g.className.split(' ')).toContain(cls)
      expect(a.className.split(' ')).toContain(cls)
    }
    // ⛔ Apple's outline takes no height (review, 2026-10-08): a 1px border inside min-h-11 under the 44px logo made it
    // 46px beside Google's 44. An inset ring is a shadow; and the title's line box scales with the apps' text zoom.
    expect(a.className.split(' ').filter((c) => /^(dark:)?border(-|$)/.test(c))).toEqual([])
    expect(a.className.split(' ')).toEqual(expect.arrayContaining(['inset-ring', 'inset-ring-black', 'dark:inset-ring-transparent']))
    expect(a.querySelector('svg')!.getAttribute('class')).toContain('h-11')
    const title = [...a.querySelectorAll('span')].find((s) => s.textContent === 'Continue with Apple' && !s.querySelector('span'))!
    expect(title.className.split(' ')).toContain('leading-tight') // unitless (1.25), never a px/rem `leading-6`
    // Apple's title is Apple's own, the logo is decorative (the name is the title alone).
    expect(a.textContent).toBe('Continue with Apple')
    expect(a.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
  })

  it('Apple runs the NATIVE sheet with this page as `next` — never the web flow', async () => {
    flags('ios-hide-google', 'ios')
    context('ios-app', { plugin: true })
    window.history.replaceState(null, '', '/listings/l1')
    await renderForm()
    fireEvent.click(apple()!)
    await vi.waitFor(() => expect(nativeAppleSignIn).toHaveBeenCalledWith('/listings/l1'))
    expect(signInWithOAuth).not.toHaveBeenCalled()
    expect(nativeOAuthCalls).not.toHaveBeenCalled()
  })

  it('Google goes through nativeOAuth (ASWebAuthenticationSession on this binary)', async () => {
    flags('ios-hide-google', 'ios')
    context('ios-app', { plugin: true })
    parkNativeOAuth = true
    await renderForm()
    fireEvent.click(google()!)
    await vi.waitFor(() => expect(nativeOAuthCalls).toHaveBeenCalledWith('google', '/'))
  })

  it('a cancelled Apple sheet is silent; unavailable and failed show their own lines', async () => {
    flags('ios-hide-google', 'ios')
    context('ios-app', { plugin: true })
    await renderForm()
    nativeAppleSignIn.mockRejectedValueOnce(new NativeAuthError('canceled'))
    fireEvent.click(apple()!)
    await flush()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(apple()!.hasAttribute('data-loading')).toBe(false) // the form came back

    nativeAppleSignIn.mockRejectedValueOnce(new NativeAuthError('apple_unavailable'))
    fireEvent.click(apple()!)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringMatching(/isn’t available right now/))

    nativeAppleSignIn.mockRejectedValueOnce(new NativeAuthError('apple_failed'))
    fireEvent.click(apple()!)
    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/didn’t finish/))
  })

  it('while Apple is running its button is busy (spinner, aria-busy) and keeps its title', async () => {
    flags('ios-hide-google', 'ios')
    context('ios-app', { plugin: true })
    nativeAppleSignIn.mockImplementation(() => new Promise<void>(() => {}))
    await renderForm()
    fireEvent.click(apple()!)
    await flush()
    const a = apple()!
    expect(a.getAttribute('aria-busy')).toBe('true')
    expect(a.textContent).toContain('Continue with Apple')
  })

  it('the plugin WITHOUT `ios` in the flag: neither (the gate keeps Google away)', async () => {
    flags('ios-hide-google', 'web-test')
    testerCookie(true)
    context('ios-app', { plugin: true })
    await renderForm()
    expect(apple()).toBeNull()
    expect(google()).toBeNull()
  })
})

describe('Sign in with Apple — the Android app and browsers (GoTrue’s Apple web flow)', () => {
  it('Android with `web`: stale PKCE cookies cleared FIRST, then a Custom Tab on provider=apple with native=1&p=apple', async () => {
    flags('ios-hide-google', 'web')
    context('android-app')
    await renderForm()
    fireEvent.click(apple()!)
    await vi.waitFor(() => expect(browserOpen).toHaveBeenCalledTimes(1))
    const [{ provider, options }] = signInWithOAuth.mock.calls[0]
    expect(provider).toBe('apple')
    expect(options.redirectTo).toMatch(/\/auth\/callback\?next=%2F&native=1&p=apple$/)
    expect(options.skipBrowserRedirect).toBe(true)
    expect(browserOpen.mock.calls[0][0]).toEqual(expect.objectContaining({ url: expect.stringContaining('provider=apple') }))
    expect(clearStalePkceCookies.mock.invocationCallOrder[0]).toBeLessThan(signInWithOAuth.mock.invocationCallOrder[0])
    expect(nativeAppleSignIn).not.toHaveBeenCalled()
  })

  it('a browser with `web`: signInWithOAuth on Apple with `&p=apple` on the callback — never /auth/google/start', async () => {
    flags('', 'web')
    context('web')
    const assign = vi.fn()
    const realLocation = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, pathname: '/', search: '', origin: realLocation.origin, href: realLocation.href, assign } })
    try {
      await renderForm()
      fireEvent.click(apple()!)
      await vi.waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(1))
      const [{ provider, options }] = signInWithOAuth.mock.calls[0]
      expect(provider).toBe('apple')
      expect(options.redirectTo).toMatch(/\/auth\/callback\?next=%2F&p=apple$/)
      expect(options.skipBrowserRedirect).toBeUndefined()
      expect(clearStalePkceCookies.mock.invocationCallOrder[0]).toBeLessThan(signInWithOAuth.mock.invocationCallOrder[0])
      expect(assign).not.toHaveBeenCalled()
      // the browser is navigating to Apple: the button stays busy
      expect(apple()!.getAttribute('aria-busy')).toBe('true')
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
    }
  })

  it('the Light-theme Google sits beside Apple whenever the flag is set', async () => {
    flags('', 'web')
    context('web')
    await renderForm()
    const g = google()!
    expect(g.className).toContain('bg-white')
    expect(g.className).toContain('border-[#747775]')
    expect(g.className).toContain('text-[#1F1F1F]')
    expect(g.className).not.toContain('bg-popover')
  })

  // Owner, 2026-10-09: "match typography continue with google and continue with apple". Apple's size is fixed by the
  // HIG (the title 43% of the 44px height); Google's label takes it, and both are bold.
  it.each(['web', 'android-app'] as const)('%s: both provider titles share ONE typography — 19px, bold, leading 1.25', async (kind) => {
    flags('', 'ios,web')
    context(kind)
    await renderForm()
    const appleTitle = [...apple()!.querySelectorAll('span')].find((s) => s.textContent === 'Continue with Apple')!
    // every size the canon knows (design-lint's scale: 3xs…9xl) or an arbitrary one, every font-*, every leading-*
    const typo = (cls: string) => cls.split(/\s+/).filter((c) => /^(text-\[[\d.]+(px|rem|em)\]|text-(\d*xs|sm|base|lg|\d*xl)|font-|leading-)/.test(c)).sort()
    expect(typo(appleTitle.className)).toEqual(['font-bold', 'leading-tight', 'text-[19px]'])
    expect(typo(google()!.className)).toEqual(typo(appleTitle.className))
    // the label colour survives the merge beside the arbitrary size (tailwind-merge tells the two apart)
    expect(google()!.className).toContain('text-[#1F1F1F]')
  })

  it('the two buttons are ONE PAIR: equal rows, so a wrapped label grows both — the flag EMPTY keeps the old markup', async () => {
    flags('', 'ios,web')
    context('web')
    await renderForm()
    const pair = google()!.parentElement!
    expect(apple()!.parentElement).toBe(pair)
    expect(pair.className.split(' ')).toEqual(expect.arrayContaining(['grid', 'auto-rows-fr', 'gap-3']))
    cleanup()
    flags('', '')
    await renderForm()
    expect(google()!.parentElement!.className).toContain('space-y-3') // straight in the form, as before
  })

  it('the pair carries its buttons\' first-frame hook under ios-hide-google — an iOS binary without the plugin gets no empty 12px box', () => {
    flags('ios-hide-google', 'ios,web')
    const host = ssr()
    const g = byText(host, 'Continue with Google')!
    const a = byText(host, 'Continue with Apple')!
    expect(g.parentElement).toBe(a.parentElement)
    // both buttons hide before hydration in that binary, so the pair does too — by the same rule
    for (const el of [g, a, g.parentElement!]) expect(el.className).toContain('ios-nosiwa-hidden')
    flags('', 'ios,web')
    const plain = byText(ssr(), 'Continue with Google')!
    expect(plain.className).not.toContain('ios-nosiwa-hidden') // Google ungated: the pair shows (it holds Google)
    expect(plain.parentElement!.className).not.toContain('ios-nosiwa-hidden')
  })

  it('Apple pressed is reported like Google: once to the prompt, as the gate’s method', async () => {
    flags('', 'web')
    context('web')
    const onMethod = vi.fn()
    await renderForm({ onMethod })
    fireEvent.click(apple()!)
    expect(onMethod).toHaveBeenCalledWith('apple')
  })
})

describe('Sign in with Apple — `web-test`: only a browser holding the tester cookie', () => {
  it('without the cookie: no Apple, and no server node either (web-test alone)', async () => {
    flags('', 'web-test')
    expect(byText(ssr(), 'Continue with Apple')).toBeNull()
    context('web')
    await renderForm()
    expect(apple()).toBeNull()
  })

  it('with the cookie: Apple appears after mount, with no apple-native-only class', async () => {
    flags('', 'web-test')
    testerCookie(true)
    context('web')
    await renderForm()
    expect(apple()).toBeTruthy()
    expect(apple()!.className).not.toContain('apple-native-only')
  })

  it('`ios,web-test`: the server node is native-only, and a tester’s browser drops that class after mount', async () => {
    flags('', 'ios,web-test')
    const a = byText(ssr(), 'Continue with Apple')!
    expect(a.className).toContain('apple-native-only')
    expect(a.className).toContain('ios-nosiwa-hidden')
    testerCookie(true)
    context('web')
    await renderForm()
    expect(apple()!.className).not.toContain('apple-native-only')
  })

  it('`ios,web-test` without the cookie: the native-only node is removed after mount on the web and in Android', async () => {
    flags('', 'ios,web-test')
    context('android-app')
    await renderForm()
    expect(apple()).toBeNull()
    expect(google()).toBeTruthy()
  })
})

describe('Sign in with Apple — D7: none in in-app browsers or the iOS home-screen app', () => {
  it.each([['Facebook', FBAN_UA], ['Zalo', ZALO_UA]] as const)('%s: no Apple, the email code leads', async (_name, ua) => {
    flags('', 'web')
    context('web', { ua })
    await renderForm()
    expect(apple()).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeTruthy()
  })

  it('the iOS home-screen PWA: no Apple', async () => {
    flags('', 'web')
    context('web', { ua: IOS_SAFARI_UA })
    Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true })
    try {
      await renderForm()
      expect(apple()).toBeNull()
    } finally {
      Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => undefined })
    }
  })

  it('the app’s in-app sheet document (?app_sheet=1): no provider at all', async () => {
    flags('app-signin-tidy', 'web')
    context('web', { ua: IOS_SAFARI_UA })
    window.history.replaceState(null, '', '/signin?app_sheet=1')
    await renderForm()
    expect(apple()).toBeNull()
    expect(google()).toBeNull()
  })
})

describe('⛔ THE INVARIANT — in the iOS app, Google is never visible without Apple', () => {
  const FLAGS = ['', 'ios', 'web', 'web-test', 'ios,web-test', 'ios,web']
  const cells = FLAGS.flatMap((flag) => [false, true].flatMap((plugin) => [false, true].map((cookie) => ({ flag, plugin, cookie }))))

  it.each(cells)('once mounted: flag "$flag", plugin $plugin, tester cookie $cookie', async ({ flag, plugin, cookie }) => {
    flags('ios-hide-google', flag)
    testerCookie(cookie)
    context('ios-app', { plugin })
    await renderForm()
    if (google()) expect(apple()).toBeTruthy()
    // and both show exactly when native Apple can run: the plugin AND `ios`
    expect(!!apple()).toBe(plugin && flag.split(',').includes('ios'))
  })

  // The FIRST FRAME, before React runs: the real head script sets the <html> classes, the real globals.css rules
  // decide display, on the server's markup. jsdom computes `display` from a <style> sheet.
  it.each(cells)('on the first frame: flag "$flag", plugin $plugin, tester cookie $cookie', ({ flag, plugin, cookie }) => {
    flags('ios-hide-google', flag)
    testerCookie(cookie)
    context('ios-app', { plugin })
    ;(window as unknown as { __enoLeaving?: number }).__enoLeaving = 1 // no splash lift in a test
    runHeadScript({ appleIos: flag.split(',').includes('ios') })
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
    const rules = css.match(/html\.native-ios:not\(\.native-siwa\) \.ios-nosiwa-hidden \{[^}]*\}|html:not\(\.native-siwa\) \.apple-native-only \{[^}]*\}/g)
    expect(rules).toHaveLength(2)
    const style = document.createElement('style')
    style.textContent = rules!.join('\n')
    document.head.appendChild(style)
    const host = ssr()
    document.body.appendChild(host)
    try {
      const shown = (b: HTMLElement | null) => !!b && getComputedStyle(b).display !== 'none'
      const g = shown(byText(host, 'Continue with Google'))
      const a = shown(byText(host, 'Continue with Apple'))
      if (g) expect(a).toBe(true)
      expect(a).toBe(plugin && flag.split(',').includes('ios'))
    } finally {
      host.remove()
      style.remove()
      delete (window as unknown as { __enoLeaving?: number }).__enoLeaving
    }
  })
})

// ── `no-apple-web` (src/lib/apple-web-head.ts): the pre-paint class is set once per document; the form's mount effect
// keeps it in step with appleAvailableHere(), so a client-side navigation can never leave it stale (commit gate). ──
describe('Sign in with Apple — `web`: the mount reconciles the pre-paint class', () => {
  it('the server node carries `apple-web` (the class the pre-paint rule hides)', () => {
    flags('', 'ios,web')
    const apple = byText(ssr(), 'Continue with Apple')
    expect(apple?.className).toContain('apple-web')
  })

  it('a stale `no-apple-web` (left by the in-app sheet\'s URL) is removed where Apple is allowed — the button shows', async () => {
    flags('', 'ios,web')
    context('web')
    document.documentElement.classList.add('no-apple-web')
    await renderForm()
    expect(document.documentElement.classList.contains('no-apple-web')).toBe(false)
    expect(apple()).toBeTruthy()
  })

  it('…and set where Apple cannot run (an in-app browser), whatever the first frame said', async () => {
    flags('', 'ios,web')
    context('web', { ua: FBAN_UA })
    await renderForm()
    expect(document.documentElement.classList.contains('no-apple-web')).toBe(true)
    expect(apple()).toBeNull()
  })

  it('without `web` the mount leaves the class alone (it hides nothing then)', async () => {
    flags('', 'ios,web-test')
    context('web')
    document.documentElement.classList.add('no-apple-web')
    await renderForm()
    expect(document.documentElement.classList.contains('no-apple-web')).toBe(true)
  })
})
