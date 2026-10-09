import { appReviewGate, inAppSheetDocument, isNativeIOSClient } from './app-review-gates'
import { googleOauthBlocked, isNativeTabs } from './in-app-browser'

/**
 * SIGN IN WITH APPLE — THE ROLLOUT FLAG AND THE ONE ANSWER TO "MAY APPLE (AND, ON iOS, GOOGLE) SHOW HERE?"
 *
 * Plan: ~/eno-ios-prep/siwa/plan.md §7.1. One BUILD-TIME variable, a comma list like the review gates:
 *
 *   NEXT_PUBLIC_APPLE_SIGNIN=ios,web-test      (the order is dark → `ios,web-test` → `ios,web`)
 *
 * | token    | effect                                                                                     |
 * |----------|--------------------------------------------------------------------------------------------|
 * | ios      | Apple (native ASAuthorizationController) and Google in an iOS binary that carries the      |
 * |          | `EnoSignIn` plugin (build 3 of 1.0.3 on). Build 2 has no plugin and shows neither.          |
 * | web-test | Apple on the web and in the Android app, only for a browser holding the tester cookie      |
 * |          | (`?siwa_test=1` on any page sets it for 7 days, `?siwa_test=0` clears it — SiwaTestFlag).   |
 * | web      | Apple for everyone on the web and in the Android app (GoTrue's own Apple OAuth).            |
 *
 * Unset or empty (the dark deploy) ⇒ every helper below answers false and nothing changes anywhere. It is a
 * NEXT_PUBLIC_* value, so it is inlined at build: set it in /opt/eno/secrets/eno-vn.env (and in eno-forum.env
 * only if the owner extends Apple to the forum — D2 says eno.vn only at launch) and deploy. The code is
 * edition-neutral; the env file is the edition switch.
 *
 * ⛔ next.config.ts IMPORTS THIS FILE AT BUILD TIME (to refuse an unknown token, the UNKNOWN_GATES pattern), so
 * it may only import RELATIVE modules that are themselves dependency-free — today `./app-review-gates` and
 * `./in-app-browser`, neither of which imports anything. A `@/…` alias or a package import here breaks the
 * config load. apple-signin.test.ts pins the import list.
 *
 * ⚠️ CLIENT HELPERS ARE FALSE DURING SSR, like the review gates. The first frame in the iOS app is decided by
 * the pre-paint head script instead (`native-siwa` on <html>, layout.tsx), keyed off the same two facts:
 * `Capacitor.isPluginAvailable('EnoSignIn')` and `appleIosEnabled()` inlined at build.
 */

export const APPLE_SIGNIN_TOKENS = ['ios', 'web-test', 'web'] as const
export type AppleSignInToken = (typeof APPLE_SIGNIN_TOKENS)[number]

/** Parse the comma list; unknown tokens are ignored at runtime (next.config.ts refuses to build on one). */
export function parseAppleSignInFlag(raw: string | undefined | null): Set<AppleSignInToken> {
  const known = new Set<string>(APPLE_SIGNIN_TOKENS)
  const out = new Set<AppleSignInToken>()
  for (const t of (raw ?? '').split(',')) {
    const token = t.trim().toLowerCase()
    if (known.has(token)) out.add(token as AppleSignInToken)
  }
  return out
}

/**
 * Tokens in the variable that name nothing. next.config.ts refuses to build when this is non-empty: `web_test`
 * or `iso` would otherwise build green with Apple silently off — and on iOS, with Google silently off too.
 */
export function unknownAppleSignInTokens(raw: string | undefined | null): string[] {
  const known = new Set<string>(APPLE_SIGNIN_TOKENS)
  return (raw ?? '').split(',').map((t) => t.trim().toLowerCase()).filter((t) => t && !known.has(t))
}

/** The tokens this build was made with. Read per call so tests can stub the env. */
export function appleSignInTokens(): Set<AppleSignInToken> {
  return parseAppleSignInFlag(process.env.NEXT_PUBLIC_APPLE_SIGNIN)
}

/**
 * Any token at all — the switch for the restyled Google button (Apple's look and title, sign-in-form.tsx
 * GOOGLE_BUTTON) that sits beside Apple. Empty ⇒ the provider markup is byte-identical to before this work (plan B4).
 */
export function appleFlagSet(): boolean {
  return appleSignInTokens().size > 0
}

/** `ios` is in the flag (server or client — a build-time fact). */
export function appleIosEnabled(): boolean {
  return appleSignInTokens().has('ios')
}

// ── The web tester cookie (`web-test`) ────────────────────────────────────────────────────────────

/**
 * The tester cookie. ⚠️ HARMLESS IF DISCOVERED: it only reveals the real Apple flow a week or two early, to
 * whoever holds it — it grants nothing, and with `web-test` out of the flag it does nothing at all.
 */
export const SIWA_TEST_COOKIE = 'eno-siwa-test'
/** `?siwa_test=1` on ANY page sets the cookie, `=0` clears it — not only on /signin, because both apps refuse
 *  deep links to /signin and /auth (MainActivity / AppDelegate), and the Android tester arrives by deep link. */
export const SIWA_TEST_PARAM = 'siwa_test'
export const SIWA_TEST_MAX_AGE = 7 * 24 * 60 * 60

/** Client only: this browser holds the tester cookie. */
export function siwaTester(): boolean {
  if (typeof document === 'undefined') return false
  try {
    return document.cookie.split(';').some((c) => c.trim() === `${SIWA_TEST_COOKIE}=1`)
  } catch {
    return false
  }
}

/**
 * Client only: apply `?siwa_test=` from this page's query string. Returns what it did, for the test.
 * ⛔ ONLY WHILE `web-test` IS IN THE FLAG — with the flag empty (the dark deploy) or at `web`, the parameter is
 * ignored and no cookie is ever written, so the dark deploy really is a no-op.
 */
export function syncSiwaTestCookie(search: string): 'set' | 'cleared' | null {
  if (typeof document === 'undefined' || !appleSignInTokens().has('web-test')) return null
  let v: string | null = null
  try { v = new URLSearchParams(search).get(SIWA_TEST_PARAM) } catch { return null }
  if (v !== '1' && v !== '0') return null
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : ''
  try {
    document.cookie = v === '1'
      ? `${SIWA_TEST_COOKIE}=1; Path=/; Max-Age=${SIWA_TEST_MAX_AGE}; SameSite=Lax${secure}`
      : `${SIWA_TEST_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
  } catch {
    return null
  }
  return v === '1' ? 'set' : 'cleared'
}

/** Client: the web/Android Apple flow is on for THIS browser — `web`, or `web-test` plus the tester cookie. */
export function appleWebEnabled(): boolean {
  const t = appleSignInTokens()
  if (t.has('web')) return true
  return t.has('web-test') && siwaTester()
}

// ── The iOS app ───────────────────────────────────────────────────────────────────────────────────

/**
 * The in-repo Capacitor plugin (ios/App/App/EnoSignInPlugin.swift, build 3 on): `signInWithApple({nonce})`
 * and `webAuth({url, ephemeral})`. ⚠️ Not `EnoAuth` — auth-context.tsx already posts to a webkit `enoAuth`
 * message handler. src/lib/native-sign-in-plugin.ts holds the JS proxy and the result types.
 */
export const SIGN_IN_PLUGIN = 'EnoSignIn'

type CapGlobal = { getPlatform?: () => string; isNativePlatform?: () => boolean; isPluginAvailable?: (name: string) => boolean }
const capacitor = (): CapGlobal | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { Capacitor?: CapGlobal }).Capacitor

/** Client: THIS iOS binary carries `EnoSignIn` (build 3 on). False on the web, Android and build 2. */
export function iosSignInPluginPresent(): boolean {
  const c = capacitor()
  if (c?.getPlatform?.() !== 'ios') return false
  try { return !!c.isPluginAvailable?.(SIGN_IN_PLUGIN) } catch { return false }
}

/** Client: native Sign in with Apple can run here — the iOS app, a binary with the plugin, and `ios` in the flag. */
export function iosNativeAppleReady(): boolean {
  return iosSignInPluginPresent() && appleIosEnabled()
}

/**
 * Client: Google must not show in this iOS app — the NEW meaning of the `ios-hide-google` gate (Guideline 4.8):
 * hide Google UNLESS this binary can offer Sign in with Apple beside it. Build 2 (no plugin) therefore keeps
 * showing neither, whatever the flag says; build 3 shows both once `ios` is in the flag.
 * ⛔ THE INVARIANT: with the gate on, Google is never visible in the iOS app without Apple — both answers come
 * from `iosNativeAppleReady()`, so they cannot disagree.
 */
export function iosGoogleHidden(): boolean {
  return appReviewGate('ios-hide-google') && isNativeIOSClient() && !iosNativeAppleReady()
}

/**
 * Client: may "Continue with Apple" show in THIS context?
 *   · the iOS app       → `iosNativeAppleReady()` (native sheet, never the web flow);
 *   · the Android app   → `appleWebEnabled()` (GoTrue's web flow in a Custom Tab, back through `native=1`);
 *   · a browser         → `appleWebEnabled()`, and NOT in an in-app browser or the iOS home-screen PWA
 *                         (`googleOauthBlocked()` — D7: the email code leads there), NOT in the shelved SwiftUI
 *                         tabs (`EnoNativeTabs`), and NOT in the app's in-app sheet (`inAppSheetDocument()`).
 * ⚠️ An app user agent WITHOUT a Capacitor bridge (an app page off server.url) gets nothing: it is neither the
 * app's native path nor a real browser.
 */
export function appleAvailableHere(): boolean {
  if (typeof window === 'undefined') return false
  const c = capacitor()
  if (c?.isNativePlatform?.()) {
    const platform = c.getPlatform?.()
    if (platform === 'ios') return iosNativeAppleReady()
    if (platform === 'android') return appleWebEnabled()
    return false
  }
  if (typeof navigator !== 'undefined' && /EnoNativeApp|EnoNativeTabs/.test(navigator.userAgent || '')) return false
  return appleWebEnabled() && !googleOauthBlocked() && !isNativeTabs() && !inAppSheetDocument()
}

// ── Apple-sourced identity, server or client ──────────────────────────────────────────────────────

/**
 * Apple's private email relay domains (Hide My Email). `privaterelay.appleid.com` is the classic one; new
 * relay addresses arrive on `private.icloud.com`. Matched on the address's domain, case-insensitively.
 */
export const APPLE_RELAY_DOMAINS = ['privaterelay.appleid.com', 'private.icloud.com'] as const

export function isAppleRelayEmail(email: string | null | undefined): boolean {
  const at = (email ?? '').lastIndexOf('@')
  if (at < 0) return false
  const domain = (email as string).slice(at + 1).trim().toLowerCase()
  return (APPLE_RELAY_DOMAINS as readonly string[]).includes(domain)
}

/**
 * The account has an Apple identity: `app_metadata.providers` (or the first `provider`) names Apple, IN ANY CASE.
 * ⛔ GoTrue keeps a provider as the /authorize request spelled it — only its provider lookup lowercases — and the nginx
 * guard pins redirect_to and PKCE, not the provider: `provider=Apple` makes an `Apple` account. A strict 'apple' read
 * that as not linked, and D14 hashed its shared email for Meta (commit gate round 2, verifier). Every caller moves the
 * safe way: no `em` (meta-capi.ts), the Apple notice at deletion, the name optional at onboarding. appleIdentityState
 * and pkceCodeProvider (auth/apple-siwa.ts) lowercase for the same reason.
 */
export function isAppleLinked(appMetadata: unknown): boolean {
  if (!appMetadata || typeof appMetadata !== 'object') return false
  const m = appMetadata as { provider?: unknown; providers?: unknown }
  const isApple = (p: unknown) => typeof p === 'string' && p.trim().toLowerCase() === 'apple'
  return isApple(m.provider) || (Array.isArray(m.providers) && m.providers.some(isApple))
}

/**
 * Apple's own page for removing an app from "Sign in with Apple", in the reader's language — the link in the
 * deletion notice when a token could not be revoked (D9, B9). Measured 2026-10-08: the vi-vn page answers 200,
 * titled "Quản lý ứng dụng bằng tính năng Đăng nhập bằng Apple".
 */
export function appleSupportUrl(lang: string | null | undefined): string {
  return (lang ?? '').toLowerCase().startsWith('vi')
    ? 'https://support.apple.com/vi-vn/102571'
    : 'https://support.apple.com/en-us/102571'
}
