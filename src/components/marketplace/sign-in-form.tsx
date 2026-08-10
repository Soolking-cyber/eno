'use client'

import { useEffect, useRef, useState } from 'react'
import { Mail, Phone, Loader2, ExternalLink } from 'lucide-react'
import { STROKE_DISPLAY } from '@/lib/icon-tokens'
import { useLanguage } from '@/context/language-context'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { googleOauthBlocked, isNativeTabs, openInSystemBrowser } from '@/lib/in-app-browser'
import { HANDOFF_NEXT_KEY, handoffNonce } from '@/lib/auth/handoff-client'
import { isNativeApp, nativeGoogleSignIn } from '@/lib/native-auth'
import { googleIdentityEnabled, requestGoogleIdToken } from '@/lib/google-identity'
import { useTurnstile } from './turnstile'
import { canonicalEmail } from '@/lib/email-alias'
import { isVietnamesePhone, normalizePhoneForRouting } from '@/lib/phone'
import { AUTH_USES_REQUEST_ORIGIN } from '@/lib/auth-origin'

const RESEND_SECONDS = 60
// SMS resend cooldown escalates per send (mirrors the server schedule in
// api/auth/send-sms — the server is the enforcement; this keeps the button
// honest so it never invites a tap that would be rejected).
const SMS_RESEND_STEPS = [60, 300, 900, 1800]
// Same contract for email, mirroring RESEND_STEPS_SEC in api/auth/email-link.
const EMAIL_RESEND_STEPS = [30, 60, 300, 900]
// generateLink's email_otp is EIGHT digits, and leading zeros are real (observed 00730251)
// — it is a string end to end, never Number().
const EMAIL_CODE_LEN = 8
const fmtCountdown = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/**
 * ⚠️ AN ERROR CODE, NOT A SENTENCE — and that refactor IS the fix, not scaffolding around it.
 *
 * This state used to hold a pre-translated string. That made every error indistinguishable from
 * every other error, so "clear the captcha message when the widget succeeds" was not expressible:
 * the only available move was to wipe `error` wholesale, which would also erase a rate-limit or
 * cooldown message the visitor still needs to read. A code can be asked what it is.
 *
 * `raw` is the escape hatch for provider text we have no mapping for (GoTrue messages, a thrown
 * Error). It is shown verbatim, exactly as before, and is deliberately NOT clearable by the widget.
 */
export type SignInErrorCode =
  | 'captcha'
  | 'network'
  | 'email_unreachable'
  | 'invalid_email'
  | 'cooldown'
  | 'rate_limited'
  | 'send_failed'
  | 'bad_code'
  | 'unknown'

export type SignInError =
  | { code: SignInErrorCode; retryAfterSec?: number }
  | { code: 'raw'; message: string }
  | null

/**
 * What the error becomes once Turnstile hands us a token.
 *
 * ⚠️ ONLY the captcha message clears, and the asymmetry is the point of the task rather than an
 * optimisation. A widget event says nothing about whether the account is rate-limited, whether a
 * resend is still on cooldown, or whether the last typed code was wrong — wiping those because a
 * checkbox got ticked would delete the one instruction the visitor needs.
 *
 * Exported and pure so the behaviour is testable without a DOM; this repo has no component-render
 * harness (vitest runs `environment: 'node'`, and there is no @testing-library).
 */
export function errorAfterCaptchaSolved(current: SignInError): SignInError {
  return current?.code === 'captcha' ? null : current
}

/** The visitor-facing sentence for an error, resolved at RENDER time in their language. */
export function signInErrorText(e: SignInError, t: (en: string, vi: string) => string): string {
  if (!e) return ''
  switch (e.code) {
    case 'raw':
      return e.message
    case 'captcha':
      return t("The security check didn't complete — try again, and tick the verification box if one appears.", 'Kiểm tra bảo mật chưa hoàn tất — thử lại và đánh dấu ô xác minh nếu nó hiện ra nhé.')
    case 'network':
      return t('Connection problem — check your network and try again.', 'Sự cố kết nối — kiểm tra mạng và thử lại.')
    case 'email_unreachable':
      return t('Could not reach eno.vn — check your connection and try again.', 'Không kết nối được tới eno.vn — kiểm tra kết nối và thử lại nhé.')
    case 'invalid_email':
      return t('That email address doesn’t look right.', 'Địa chỉ email này có vẻ không đúng.')
    case 'cooldown': {
      const n = Math.max(1, Number(e.retryAfterSec) || 30)
      // Placeholder + .replace, never a template literal: gen-ui-strings.mjs harvests string
      // LITERALS only, so an interpolated t() silently ships untranslated.
      return t('Just sent one — try again in {n} seconds.', 'Vừa gửi rồi — thử lại sau {n} giây nhé.').replace('{n}', String(n))
    }
    case 'rate_limited':
      return t('Too many sign-in attempts. Try again in an hour.', 'Quá nhiều lần thử đăng nhập. Vui lòng thử lại sau một giờ.')
    case 'send_failed':
      return t("We couldn't send the email just now. Try again in a moment, or sign in with your phone.", 'Chúng tôi chưa gửi được email lúc này. Thử lại sau giây lát, hoặc đăng nhập bằng số điện thoại nhé.')
    case 'bad_code':
      return t('That code is wrong or has expired. Send a new one and try again.', 'Mã không đúng hoặc đã hết hạn. Hãy gửi mã mới rồi thử lại nhé.')
    case 'unknown':
      return t('Something went wrong. Please try again.', 'Đã có lỗi xảy ra. Vui lòng thử lại.')
  }
}

/** Cryptic GoTrue captcha errors → our captcha code; anything else stays verbatim. */
export function authErrorToCode(message: string): SignInError {
  return /captcha/i.test(message) ? { code: 'captcha' } : { code: 'raw', message }
}

/** OUR server's email-send codes → ours. Unlike the provider path these are a closed set. */
export function emailSendErrorToCode(code: unknown, retryAfterSec?: number): SignInError {
  if (code === 'captcha_failed') return { code: 'captcha' }
  if (code === 'invalid_email') return { code: 'invalid_email' }
  if (code === 'cooldown') return { code: 'cooldown', retryAfterSec }
  if (code === 'rate_limited') return { code: 'rate_limited' }
  if (code === 'send_failed') return { code: 'send_failed' }
  return { code: 'unknown' }
}

/** All sign-in logic + UI, with NO outer chrome — rendered by both the modal
 *  (SignInDialog) and the dedicated /signin page so they share identical
 *  handlers (Google OAuth, email magic-link, phone OTP). */
export function SignInForm({ className }: { className?: string }) {
  const { tr, lang } = useLanguage()
  const t = (en: string, vi: string) => tr(en, vi)

  const [tab, setTab] = useState<'email' | 'phone'>('phone')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  // ⚠️ PASSWORD IS A STAGE, NOT A TAB. The owner's decision (2026-08-10) is that the code /
  // link path stays primary and password is the alternative reached from inside whichever
  // tab you are already on — so the identifier the visitor already typed carries straight
  // over, and someone who never sets a password never sees a password field at all. Making
  // it a third tab would have put a credential most accounts do NOT have on equal footing
  // with the two that always work.
  const [password, setPassword] = useState('')
  const [stage, setStage] = useState<'input' | 'code' | 'sent' | 'password'>('input')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<SignInError>(null)
  const [countdown, setCountdown] = useState(0)
  // Which channel the code actually landed on (telegram/whatsapp/zalo/sms) —
  // written by the delivery hook, read back so we can point at ONE inbox.
  const [sentChannel, setSentChannel] = useState<string | null>(null)
  // ⚠️ WHICH CHANNELS THE SERVER CAN ACTUALLY SEND THROUGH — capability, not preference.
  // null = not asked yet. Fetched once on mount so the pre-send warning is honest on FIRST paint:
  // with SpeedSMS gone a wrong promise is a dead end (the hook answers 200 even when every channel
  // fails), and today production has only Telegram configured, so naming Zalo would be a lie.
  const [configured, setConfigured] = useState<{ telegram: boolean; whatsapp: boolean; zalo: boolean } | null>(null)
  const smsSends = useRef(0) // client-side mirror of the server's escalation counter
  const emailSends = useRef(0) // same, for the magic-link ladder
  // In the native shells a magic LINK is a dead end: it opens in the system browser, so the
  // session lands in Safari's cookie jar and the app stays logged out. /auth/* is excluded
  // from the AASA allowlist on purpose, so Universal Links cannot bring it back either.
  // There we email an 8-digit code and verify it in-app, exactly like phone OTP.
  const [emailCode, setEmailCode] = useState(false)
  const lastSubmitted = useRef('')
  // Google blocks OAuth inside in-app browsers / iOS PWAs (403 disallowed_useragent).
  // Detect that client-side and hand off to the real browser instead of dead-ending.
  // ⚠️ EXCEPT in the native Capacitor app: its WebView UA also contains "wv" (so googleOauthBlocked
  // is true), but oauth() routes native taps through nativeGoogleSignIn — a Custom Tab /
  // SFSafariViewController that Google DOES allow. So treat native as NOT blocked: show the normal
  // "Continue with Google" button, not the "open in your browser" fallback + hint.
  const [oauthBlocked, setOauthBlocked] = useState(false)
  const [iosHint, setIosHint] = useState(false)
  // Native iOS app's embedded tabs: Google can't work there at all (no escape
  // hatch, no session handoff) — hide it and lead with Phone/Email.
  const [hideGoogle, setHideGoogle] = useState(false)
  useEffect(() => {
    setOauthBlocked(googleOauthBlocked() && !isNativeApp())
    setHideGoogle(isNativeTabs() && !isNativeApp())
    // ⚠️ EVERY CONTEXT WITH A SEPARATE COOKIE JAR NEEDS THE CODE, NOT THE LINK — and the set of
    // those is exactly `googleOauthBlocked()`, which is why it now drives both.
    //
    // A magic LINK opens in the system browser, so the session lands in the BROWSER'S jar and the
    // in-app browser / PWA the visitor is actually looking at stays signed out. That is the same
    // wrong-jar failure as the Google one — on the path we offer as the ALTERNATIVE to Google. So a
    // Facebook or Zalo in-app visitor had Google refused by Google, email silently signing in a
    // window they had already left, and only phone OTP genuinely working in place — and phone
    // delivery is Telegram-only in production today. That is close to no way in at all.
    //
    // The 8-digit code is typed where the visitor already is, so it cannot care about jars.
    // The previous comment noted the iOS PWA \"has the same broken-link problem\" and deferred it to
    // limit blast radius; the blast radius of NOT doing it is a visitor who cannot sign in.
    setEmailCode(isNativeApp() || isNativeTabs() || googleOauthBlocked())
  }, [])

  // supabase-js (~248 KB) is loaded on demand, per handler, instead of at module
  // scope: /signin must render its form without shipping the auth SDK first. The
  // client is a SINGLETON (src/lib/supabase/browser.ts), so calling this in each
  // handler costs one dynamic import and returns the same instance every time —
  // which is what keeps Realtime on a single socket and auth in sync.
  // Fails SOFT and returns null: a dynamic import can reject where a static one
  // never could — offline, or a stale chunk 404ing after a deploy. Left to throw,
  // it would escape the handler as an unhandled rejection, so the button would
  // keep spinning (setLoading(false) is never reached) and the user would be told
  // nothing. Every caller must therefore bail on null. (codex + Gemini both
  // flagged exactly this on the first cut of this change.)
  const getSupabase = async () => {
    try {
      return (await import('@/lib/supabase/browser')).createSupabaseBrowser()
    } catch {
      setError({ code: 'network' })
      setLoading(false)
      // Unlock the OTP auto-submit latch. The verify handlers bail on `!sb` BEFORE their own
      // `lastSubmitted.current = ''` reset, so without this a failed chunk load leaves the
      // typed code latched and onCodeComplete swallows the identical re-entry — the user
      // retypes the same digits and nothing happens. Resetting here means every future
      // caller inherits the unlock. (Integration review, 2026-07-25.)
      lastSubmitted.current = ''
      return null
    }
  }
  // Cloudflare Turnstile — mints a fresh single-use token for each OTP send so Supabase
  // Auth CAPTCHA can gate SMS/email OTP against spam + SMS-pumping toll fraud. Only the
  // send steps (signInWithOtp) are gated; verifyOtp and OAuth are not (per Supabase).
  // ⚠️ `onSolved` IS THE FIX. The widget produces a token whether or not a send is waiting for one,
  // so this is what retracts a captcha message the moment it stops being true — see the hook.
  // A function updater, so it reads the error that is actually on screen rather than one captured
  // when this callback was created.
  //
  // ⚠️ IT CLEARS THE MESSAGE BUT IT DOES NOT FINISH THE JOB, WHICH IS WHY THE RETRY EXISTS.
  // Reported from production on the password path: the widget demands a visible challenge,
  // getToken() gives up before the visitor finishes ticking it, the form says "the security
  // check didn't complete" — and then Cloudflare shows "Success!" underneath. Pressing Sign in
  // again does NOT recover, because getToken() calls reset() before execute(), which THROWS AWAY
  // the token that was just solved and starts another challenge. So the visitor loops: solve,
  // press, discarded, solve again. onSolved retracting the message only made the loop quieter.
  // `retryOnCaptchaSolvedRef` lets the stage that is waiting resume itself with the token that
  // actually arrived. The OTP paths do not set it and are unaffected.
  const retryOnCaptchaSolvedRef = useRef<((token: string) => void) | null>(null)
  // ⚠️ READ AT SUBMIT TIME, NOT CAPTURED AT RENDER TIME. All three reviewers found the same
  // defect in the first version of the resume: it stored the closure from the render that
  // FAILED, so it carried that render's `password`/`email`/`phone`. The visible challenge is up
  // for seconds and the form stays interactive, so the realistic sequence is — visitor mistypes,
  // presses Sign in, sees the challenge, fixes the typo while it is up, ticks it — and the resume
  // then submits the TYPO, fails, and spends one of their five lockout attempts on a password
  // they had already corrected. This ref always holds what is on screen now.
  const liveRef = useRef({ tab, email, phone, password })
  liveRef.current = { tab, email, phone, password }
  const { getToken: getCaptchaToken, Widget: Turnstile } = useTurnstile({
    onSolved: (token?: string) => {
      setError(errorAfterCaptchaSolved)
      const resume = retryOnCaptchaSolvedRef.current
      if (resume && token) {
        retryOnCaptchaSolvedRef.current = null
        resume(token)
      }
    },
  })
  // Return the user to the page they triggered sign-in from (continuum of their
  // action) — not always home. Phone OTP stays in place (no redirect; the modal
  // just closes); OAuth + magic-link round-trip through /auth/callback, which
  // honors this ?next (and threads it through onboarding).
  // Round-trip through the CANONICAL origin, not window.location.origin: a visitor on www.eno.vn
  // or a preview host must still land on the eno.vn/auth/callback that's in Supabase's redirect
  // allow-list (and whose session cookies are scoped to eno.vn) — otherwise OAuth returns to a host
  // where the cookie doesn't apply and the login never sticks. Dev keeps the local origin.
  // AUTH_USES_REQUEST_ORIGIN covers `next dev` AND `npm run preview:*` (a production build that
  // opted in via NEXT_PUBLIC_LOCAL_AUTH=1) — without the second case, signing in on localhost:3100
  // bounced to https://eno.vn. src/lib/auth-origin.ts explains why the flag is explicit.
  const authOrigin = (() => {
    if (typeof window === 'undefined') return ''
    if (AUTH_USES_REQUEST_ORIGIN) return window.location.origin
    return process.env.NEXT_PUBLIC_APP_URL || window.location.origin
  })()
  // Where to resume after signing in — the page the visitor triggered sign-in from.
  const nextPath = (() => {
    if (typeof window === 'undefined') return '/'
    const { pathname, search } = window.location
    if (pathname === '/signin') return new URLSearchParams(search).get('next') || '/' // the intended dest, not /signin
    if (pathname.startsWith('/auth') || pathname.startsWith('/onboard')) return '/'
    return pathname + search
  })()
  // OAuth still round-trips through Supabase, so it needs the full allow-listed callback
  // URL. The magic link does not: it is minted and delivered by us, and lands on
  // /auth/confirm, so that path only needs `nextPath`.
  const redirectTo = typeof window === 'undefined' ? undefined : `${authOrigin}/auth/callback?next=${encodeURIComponent(nextPath)}`

  // Resend countdown tick.
  useEffect(() => {
    if (countdown <= 0) return
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(id)
  }, [countdown])

  // Re-open the sign-in page in the device's real browser (escaping the in-app
  // webview), preserving where the user wanted to go.
  /**
   * Google, from a context Google refuses: an in-app browser, an Android System WebView, or an iOS
   * home-screen PWA.
   *
   * ⚠️ THIS USED TO SEND THEM TO THE BROWSER AND STOP, WHICH SIGNED IN THE WRONG BROWSER. It opened
   * `${authOrigin}/signin` in the system browser; the visitor signed in fine — in the BROWSER'S
   * cookie jar — and this context stayed logged out with no way back. The file said so itself.
   *
   * Now it runs the native app's trick: ask Supabase for the Google URL WITHOUT navigating, so the
   * PKCE code_verifier is written HERE. Whatever browser finishes can only park an authorization
   * code, which is worthless without that verifier — and the visitor carries a short code back from
   * the browser to prove the two halves belong to the same person. See src/lib/auth/handoff.ts.
   *
   * ⚠️ THE BROWSER IS OPENED BEFORE THE AWAITS, NOT AFTER. `openInSystemBrowser` needs the live user
   * gesture; three awaits later the activation is gone and nothing opens. So the escape URL is
   * launched first with a nonce we have already chosen, and the row is written behind it.
   */
  const openGoogleInBrowser = () => {
    if (typeof window === 'undefined') return
    const { pathname, search } = window.location
    let next = pathname + search
    if (pathname === '/signin') next = new URLSearchParams(search).get('next') || '/'
    if (pathname.startsWith('/auth') || pathname.startsWith('/onboard')) next = '/'

    const nonce = handoffNonce()
    try { localStorage.setItem(HANDOFF_NEXT_KEY, next) } catch { /* private mode */ }

    // Synchronous, inside the gesture. The browser lands on /auth/escape, which will not have the
    // row yet — it re-checks, so a moment of "expired" is not possible; see the escape page.
    const escapePath = `/auth/escape?h=${encodeURIComponent(nonce)}`
    const handed = openInSystemBrowser(`${authOrigin}${escapePath}`)
    if (!handed) setIosHint(true)

    void (async () => {
      const sb = await getSupabase()
      if (!sb) return
      const { data, error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${authOrigin}/auth/callback?handoff=${encodeURIComponent(nonce)}`, skipBrowserRedirect: true },
      })
      if (error || !data?.url) { setError({ code: 'raw', message: error?.message || 'Google sign-in failed' }); return }
      await fetch('/api/auth/handoff/open', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce, authUrl: data.url }),
      })
      // The app moves to the waiting room, which doubles as the manual-escape URL on iOS.
      window.location.assign(escapePath)
    })()
  }

  const oauth = async (provider: 'google') => {
    // In-flight guard + synchronous `loading`, the same way sendPhone/sendEmail do it. The
    // client is now a dynamic import, so there is a real chunk-fetch gap between the tap and
    // signInWithOAuth — long enough to tap twice. Two concurrent calls both reach
    // signInWithOAuth, which writes the PKCE verifier under ONE shared storage key, so the
    // second overwrites the first; on iOS-Capacitor the second Browser.open is then swallowed
    // (SFSafariViewController is already presented) and the user is left on an authorize page
    // whose verifier is gone. Recoverable by re-tapping, but it should not happen.
    // (Integration review, 2026-07-25.)
    if (loading) return
    // Native app (Capacitor): Google rejects OAuth in the embedded WebView, so open it in a real
    // in-app browser tab and finish via the deep-link handler in native-bootstrap. `googleOauthBlocked`
    // does NOT catch the Capacitor WebView (it's not a known in-app browser UA), so gate on isNativeApp.
    if (isNativeApp()) {
      setError(null)
      setLoading(true)
      const { pathname, search } = window.location
      let next = pathname + search
      if (pathname === '/signin') next = new URLSearchParams(search).get('next') || '/'
      if (pathname.startsWith('/auth') || pathname.startsWith('/onboard')) next = '/'
      const sb = await getSupabase()
      if (!sb) return // getSupabase already cleared loading and set the error
      try { await nativeGoogleSignIn(sb, next) }
      catch (e) { setError({ code: 'raw', message: e instanceof Error ? e.message : 'Google sign-in failed' }) }
      finally { setLoading(false) }
      return
    }
    // In an in-app browser / iOS PWA, OAuth is rejected (disallowed_useragent) — break
    // out to the real browser instead of letting Google show its block page. Stays BEFORE any
    // await on purpose: openInSystemBrowser needs the live user gesture.
    if (oauthBlocked) { openGoogleInBrowser(); return }
    setError(null)
    setLoading(true)
    const sb = await getSupabase()
    if (!sb) return

    // ── BRANDED PATH (web only, opt-in) ───────────────────────────────────────────────────────
    // Do the Google half against OUR OWN OAuth client via Google Identity Services, so the
    // consent screen shows eno's app name and logo instead of "continue to
    // xihiryllwmjoouipkyhw.supabase.co". Supabase still owns the session: the ID token goes
    // straight to signInWithIdToken, which verifies it, creates/links the user and issues the
    // normal session into this same client. See src/lib/google-identity.ts for the full contract.
    //
    // ⚠️ INERT UNTIL NEXT_PUBLIC_GOOGLE_CLIENT_ID IS SET. googleIdentityEnabled() is false
    // without it (and false in the native shell), so an unconfigured build skips this whole
    // block and runs the signInWithOAuth call below exactly as it always did.
    //
    // ⚠️ EVERY FAILURE FALLS THROUGH, NONE SURFACES. No credential, a blocked GIS script, a
    // rejected token — all of them drop to signInWithOAuth rather than showing an error. An
    // unbranded consent screen is cosmetic; a visitor who cannot sign in is not. The only thing
    // logged is a console.warn, because none of it is actionable by the person signing in.
    if (googleIdentityEnabled()) {
      const cred = await requestGoogleIdToken()
      if (cred) {
        // ⚠️ THE try/catch IS NOT DECORATION — signInWithIdToken RETHROWS. Verified in
        // @supabase/auth-js GoTrueClient.signInWithIdToken: its catch is
        // `if (isAuthError(error)) return {…error}; throw error`. A transport failure is an
        // AuthError and comes back in `error`, but anything else escapes — and two realistic
        // things live inside that try AFTER the token is accepted: `_saveSession` (a storage
        // write, which is a DOMException in Safari with cookies blocked, not an AuthError) and
        // `_notifyAllSubscribers('SIGNED_IN')`, which synchronously runs our own
        // onAuthStateChange handlers. An escape here becomes an unhandled rejection in this
        // handler, so `loading` never clears and the sign-in button is dead until a reload —
        // the exact failure getSupabase() above was hardened against for the same reason.
        // Catching it keeps the fallback chain intact: worst case we redirect a user who is
        // already signed in through Google, which returns them signed in.
        //
        // `nonce` is the RAW value; google-identity gave Google the SHA-256 hex. Forward it
        // unchanged — and forward `undefined` when there is none, because Supabase requires the
        // passed nonce and the id_token claim to both exist or both be absent.
        const { error } = await sb.auth
          .signInWithIdToken({ provider, token: cred.token, nonce: cred.nonce })
          .catch((e: unknown) => ({ error: { message: e instanceof Error ? e.message : String(e) } }))
        // Success: the session is live in this client. No redirect happens here and none is
        // needed — auth-context's onAuthStateChange closes the dialog (so `nextPath` is simply
        // where the visitor already is), and the /signin page runs its own router.replace(next).
        // `loading` stays set for the same reason the OAuth branch leaves it set: the form is
        // about to unmount or navigate, and a second tap in that window would start a second
        // sign-in. If neither happened the visitor is signed in anyway, so a disabled sign-in
        // button is the correct end state, not a trap.
        // ⚠️ /auth/callback's server-side finishSignIn() (ensureProfile + the /onboard hop) is
        // NOT reached on this path — exactly as it is not on the phone-OTP and email-code paths.
        // Both are covered client-side by auth-context: /api/me lazily provisions the Profile via
        // getCurrentProfile(), and its gate sends an account with no accountType to /onboard.
        if (!error) return
        console.warn('[auth] signInWithIdToken failed, falling back to redirect OAuth:', error.message)
      }
    }

    const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo } })
    // On success supabase-js calls location.assign and this document is going away — leave
    // `loading` set so the button cannot be tapped again during the navigation.
    if (error) { setError({ code: 'raw', message: error.message }); setLoading(false) }
  }

  // Magic link goes through OUR endpoint, not supabase.auth.signInWithOtp — see the
  // header of api/auth/email-link for why (Supabase's SMTP credentials silently expired
  // and took email sign-in down for three days). The captcha token and the redirect are
  // the same values signInWithOtp received; only the sender changed.
  const sendEmail = async () => {
    setLoading(true); setError(null)
    const captchaToken = await getCaptchaToken()
    try {
      const res = await fetch('/api/auth/email-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), captchaToken, next: nextPath, lang, deliver: emailCode ? 'code' : 'link' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(emailSendErrorToCode(data?.error, data?.retryAfterSec)); return }
      // Native gets the code-entry screen; web keeps the "check your inbox" screen.
      if (emailCode) { setCode(''); lastSubmitted.current = ''; setStage('code') } else setStage('sent')
      setCountdown(EMAIL_RESEND_STEPS[Math.min(emailSends.current, EMAIL_RESEND_STEPS.length - 1)])
      emailSends.current += 1
    } catch {
      setError({ code: 'email_unreachable' })
    } finally {
      setLoading(false)
    }
  }


  // The hook finishes before signInWithOtp resolves, so one read usually hits;
  // the retry covers replication lag. Fire-and-forget — unknown just means the
  // code screen shows no inbox hint, never a blocked login.
  // Ask once on mount — no phone needed, the endpoint answers `configured` regardless.
  useEffect(() => {
    let off = false
    fetch('/api/auth/otp-channel?phone=')
      .then((r) => r.json())
      .then((d) => { if (!off && d?.configured) setConfigured(d.configured) })
      .catch(() => { /* leave null → the copy falls back to the generic line */ })
    return () => { off = true }
  }, [])

  const fetchChannel = async (p: string) => {
    setSentChannel(null)
    for (let i = 0; i < 2; i++) {
      try {
        const r = await fetch(`/api/auth/otp-channel?phone=${encodeURIComponent(p)}`)
        const { channel } = await r.json()
        if (channel) { setSentChannel(channel); return }
      } catch {}
      await new Promise((res) => setTimeout(res, 1200))
    }
  }

  // ⚠️ THE SAME NORMALIZER *AND* THE SAME PREDICATE THE SERVER ROUTES ON (lib/phone.ts), because
  // the form PROMISES which app the code arrives in and there is no SMS fallback to cover a wrong
  // guess. It used normalizePhoneNoPlus until 2026-08-03, which DIVERGES on a bare 9-digit mobile
  // ('912345678' stays as-is there but becomes '84912345678' for routing) — both external reviewers
  // caught the split. normalizePhoneForRouting is the one the hook uses.
  const phoneWantsZalo = isVietnamesePhone(normalizePhoneForRouting(phone))

  /**
   * ⚠️ NAMES ONLY APPS THAT CAN ACTUALLY RECEIVE THE CODE — capability ∩ preference.
   *
   * Both external reviewers refuted the first version of this line for the same reason: it named
   * the PREFERRED channel, so a Vietnamese user was told "check Zalo" while production has no Zalo
   * keys and the server would skip it. With SpeedSMS gone that is not a slower path, it is silence
   * — the hook returns 200 even when nothing was delivered, so the user waits forever with no error.
   *
   * So: intersect what this deployment has configured with what this number can use (Zalo is
   * Vietnam-only; WhatsApp is for everyone else). Three outcomes, all honest:
   *   · some apps usable       → name exactly those
   *   · capability unknown yet → the generic line (fetch failed / still in flight)
   *   · none usable            → say so plainly, and point at email, which always works
   */
  const otpAppHint = (() => {
    if (!configured) {
      return t('The code arrives in a messaging app — Zalo, WhatsApp or Telegram.', 'Mã sẽ được gửi qua ứng dụng nhắn tin — Zalo, WhatsApp hoặc Telegram.')
    }
    const usable: string[] = []
    if (phoneWantsZalo && configured.zalo) usable.push('Zalo')
    if (!phoneWantsZalo && configured.whatsapp) usable.push('WhatsApp')
    if (configured.telegram) usable.push('Telegram')
    if (usable.length === 0) {
      // The dead end, said out loud instead of discovered by waiting. Email needs no app at all.
      return t('Phone codes are unavailable right now — please sign in with email instead.', 'Hiện chưa gửi được mã qua điện thoại — vui lòng đăng nhập bằng email nhé.')
    }
    if (usable.length === 1) {
      return t('The code arrives on {app} — you need it on this number.', 'Mã sẽ được gửi qua {app} — bạn cần có ứng dụng này trên số máy đó.').replace('{app}', usable[0])
    }
    // The joiner is copy too — 'WhatsApp or Telegram' inside a Vietnamese sentence was
    // the one untranslated word on the /signin screenshot.
    return t('The code arrives on {apps} — you need one of them on this number.', 'Mã sẽ được gửi qua {apps} — bạn cần có một trong số đó trên số máy đó.').replace('{apps}', usable.length > 1 ? usable.slice(0, -1).join(', ') + t(' or ', ' hoặc ') + usable[usable.length - 1] : usable[0] ?? '')
  })()

  const sendPhone = async () => {
    setLoading(true); setError(null)
    const d = phone.replace(/\D/g, '')
    const intl = d.startsWith('0') ? `+84${d.slice(1)}` : d.startsWith('84') ? `+${d}` : `+${d}`
    const captchaToken = await getCaptchaToken()
    const sb = await getSupabase()
    if (!sb) return
    const { error } = await sb.auth.signInWithOtp({ phone: intl, options: { captchaToken } })
    setLoading(false)
    if (error) { setError(authErrorToCode(error.message)); return }
    setPhone(intl); setCode(''); lastSubmitted.current = ''
    setStage('code')
    setCountdown(SMS_RESEND_STEPS[Math.min(smsSends.current, SMS_RESEND_STEPS.length - 1)])
    smsSends.current += 1
    fetchChannel(intl)
  }

  const verifyPhone = async (c = code) => {
    setLoading(true); setError(null)
    const sb = await getSupabase()
    if (!sb) return
    const { error } = await sb.auth.verifyOtp({ phone, token: c.trim(), type: 'sms' })
    setLoading(false)
    if (error) { setError({ code: 'raw', message: error.message }); lastSubmitted.current = '' }
    // success → auth-context onAuthStateChange closes the modal / the page redirects
  }

  // The emailed 8-digit code, verified through the SAME client SDK the phone flow uses —
  // no custom endpoint. Measured 2026-07-22: type:'email' is a superset that accepts both
  // 'magiclink'-minted (existing account) and 'signup'-minted (new account) codes, so the
  // client never has to be told which it got — which is exactly what keeps this free of an
  // account-existence oracle. A wrong code returns the byte-identical 403 either way, and
  // does NOT create a user. Rate limiting is GoTrue's own.
  //
  // ⚠️ Verify against the CANONICAL address. The send route mints for canonicalEmail(),
  // so a visitor who typed an alias (support@eno.vn → support@eno.forum) holds a token
  // issued to a different string; verifying the typed one fails every time.
  const verifyEmailCode = async (c = code) => {
    setLoading(true); setError(null)
    const sb = await getSupabase()
    if (!sb) return
    const { error } = await sb.auth.verifyOtp({
      email: canonicalEmail(email.trim().toLowerCase()),
      token: c.trim(),
      type: 'email',
    })
    setLoading(false)
    if (error) {
      setError(/expired|invalid/i.test(error.message) ? { code: 'bad_code' } : authErrorToCode(error.message))
      lastSubmitted.current = '' // unlock retry, same as verifyPhone
    }
    // success → auth-context's onAuthStateChange closes the modal / redirects / hands the
    // session to the native shell. Nothing else to do here.
  }

  // Auto-submit once the code is complete (guarded so a failed code can be retried,
  // and the same code never double-submits).
  const onCodeComplete = (val: string) => {
    if (loading || val === lastSubmitted.current) return
    lastSubmitted.current = val
    if (tab === 'email') verifyEmailCode(val); else verifyPhone(val)
  }

  // WebOTP: on Android Chrome, read the incoming SMS one-time code and auto-fill +
  // submit it — zero typing. Progressive enhancement only: unsupported browsers
  // (iOS/desktop) are unaffected and still get keyboard autofill via the input's
  // autocomplete="one-time-code". The request is aborted when leaving the code
  // stage so it never lingers.
  useEffect(() => {
    // `tab !== 'phone'` is load-bearing: an SMS-transport OTPCredential request opened on
    // the EMAIL code screen can never resolve, and would sit pending until aborted.
    if (stage !== 'code' || tab !== 'phone') return
    if (typeof window === 'undefined' || !('OTPCredential' in window)) return
    const ac = new AbortController()
    navigator.credentials
      .get({ otp: { transport: ['sms'] }, signal: ac.signal } as CredentialRequestOptions)
      .then((cred) => {
        const otp = (cred as { code?: string } | null)?.code
        if (otp) { setCode(otp); onCodeComplete(otp) }
      })
      .catch(() => { /* aborted, no SMS, or denied — manual entry still works */ })
    return () => ac.abort()
  }, [stage])

  // Escalation counter resets too — the server tracks it PER NUMBER, so a
  // different number legitimately starts back at 60s.
  // Both ladders reset: the server keys its cooldowns per channel, so leaving an armed
  // phone countdown behind would disable the email tab's resend for no reason.
  const reset = () => { setStage('input'); setCode(''); setPassword(''); setError(null); lastSubmitted.current = ''; smsSends.current = 0; emailSends.current = 0; setCountdown(0) }

  /**
   * Password sign-in — posts to OUR route, never supabase.auth.signInWithPassword().
   *
   * ⚠️ THE CLIENT SDK CALL IS THE BUG, not a shortcut. GoTrue answers "no such user" and
   * "wrong password" differently, so a browser-side call would turn this form into an
   * account-existence oracle for every address and phone number on the platform — undoing
   * the effort api/auth/email-link spends returning a generic 200 for every outcome. The
   * route normalises every cause to one 401 and adds our own per-IP and per-identifier
   * limits. Both external reviewers raised this independently at plan stage.
   *
   * The captcha token is minted here and FORWARDED by the route rather than verified by it:
   * Supabase enforces a captcha on the password grant itself (measured), and a Turnstile
   * token is single-use, so it can only be spent once — upstream.
   *
   * On success the route has already written the auth cookies, which the browser client
   * shares; getSession() makes it notice, and auth-context's onAuthStateChange does the
   * rest exactly as it does for OTP.
   */
  const signInWithPassword = async (presetToken?: string) => {
    // ⚠️ DISARM FIRST. A manual retry must cancel any pending resume, or a visitor who presses
    // Sign in again while the challenge is still up gets TWO submissions racing — one with the
    // token they just solved and one from the resume — and the loser burns a lockout attempt.
    retryOnCaptchaSolvedRef.current = null
    setLoading(true); setError(null)
    const live = liveRef.current
    const identifier = live.tab === 'email' ? live.email.trim().toLowerCase() : live.phone.trim()
    const password = live.password
    try {
      // ⚠️ INSIDE THE try, AND THE RESULT IS CHECKED. Two separate bugs a reviewer found
      // here, both of which stranded the user on a spinner:
      //  · getCaptchaToken() REJECTING escaped the function, so setLoading(false) never ran
      //    and the CTA span forever with no error and no way back. This project has already
      //    shipped a live Turnstile 110200 on one edition, so that is a real state.
      //  · a token that resolves UNDEFINED (widget blocked, or a password manager
      //    autofilling and submitting before the widget finished mounting) used to be
      //    posted anyway. Supabase rejects it, the route collapses every cause to
      //    bad_credentials, and the user is told their correct password is wrong — while
      //    burning one of their five lockout attempts. Bail before the request instead.
      // A token handed in by onSolved is one the visitor JUST completed — use it rather than
      // calling getToken(), which would reset the widget and discard it.
      const captchaToken = presetToken ?? await getCaptchaToken()
      if (!captchaToken) {
        setLoading(false)
        setError({ code: 'captcha' })
        // ⚠️ ARM THE RESUME. Without this the visitor is stuck in the loop described at the
        // useTurnstile call site: every retry resets the widget and throws away the token they
        // just solved. Armed only while they are actually waiting on this screen — cleared on
        // success, on any other error, and whenever they leave the password stage.
        retryOnCaptchaSolvedRef.current = (token: string) => { void signInWithPassword(token) }
        return
      }
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password, captchaToken }),
      })
      retryOnCaptchaSolvedRef.current = null
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setLoading(false)
        if (res.status === 429) {
          // ⚠️ STATIC STRINGS WITH THE VALUE APPENDED, NOT A TEMPLATE LITERAL INSIDE t().
          // scripts/gen-ui-strings.mjs harvests tr()/t() call sites by STATIC analysis, so
          // `t(\`… ${x} …\`)` is invisible to it and ships untranslated — the Vietnamese
          // half never reaches the dictionary. Caught by a reviewer reading the generated
          // ui-strings.ts in the same diff and noticing these were absent from it.
          setError({ code: 'raw', message: data?.retryAfterSec
            ? `${t('Too many attempts. Try again in', 'Quá nhiều lần thử. Thử lại sau')} ${fmtCountdown(data.retryAfterSec)}.`
            : t('Too many attempts. Try again later.', 'Quá nhiều lần thử. Thử lại sau.') })
          return
        }
        // ⚠️ THE 403 MUST NOT BE FLATTENED INTO "wrong password" — I DID EXACTLY THAT AND TWO
        // REVIEWERS CAUGHT IT INDEPENDENTLY. The route goes out of its way to separate a
        // captcha verdict from a credential verdict, precisely because a visitor whose token
        // is rejected upstream would otherwise be told their correct password is wrong, retype
        // it, and be told the same thing again. Special-casing only 429 here re-collapsed them
        // and defeated the server-side fix in the same commit that made it. `captcha` renders
        // the existing "the security check didn't complete" copy, which names something the
        // user can actually act on.
        if (res.status === 403 && data?.error === 'captcha_failed') {
          setError({ code: 'captcha' })
          return
        }
        // ⚠️ ONE MESSAGE FOR EVERY CAUSE, and it names BOTH fields on purpose. "We don't
        // recognise that email" would leak exactly what the route refuses to say.
        setError({ code: 'raw', message: live.tab === 'email'
          ? t('Wrong email or password.', 'Email hoặc mật khẩu không đúng.')
          : t('Wrong phone number or password.', 'Số điện thoại hoặc mật khẩu không đúng.') })
        return
      }
      // ⚠️ RELOAD IN PLACE — NOT a navigation to `next`, and NOT getSession().
      //
      // Two separate corrections live in this one line. First, the session was created by
      // the ROUTE, which wrote the auth cookies server-side, so nothing happened inside this
      // tab's supabase client and there is no guarantee it emits SIGNED_IN — the event every
      // other path in this form relies on to close the modal or redirect. Reading the cookie
      // back with getSession() is not reliably enough to wake the rest of the app.
      //
      // Second, the fix for that must not be `assign(next || '/')`. A reviewer caught that
      // this form is ALSO rendered in a modal, opened from a listing, where the URL has no
      // `?next=` — so every modal password sign-in would have hard-navigated to the HOMEPAGE,
      // losing the listing entirely.
      //
      // ⚠️ To be accurate about what this does and does not save, because an earlier version of
      // this comment over-claimed and a reviewer called it: a reload keeps the PAGE, not the
      // React state on it. A half-written message in the composer is gone either way. What it
      // buys is that the user is still looking at the listing they were buying, instead of the
      // homepage. Matching OTP exactly would mean waking auth-context in place rather than
      // reloading, which is the better end state and needs the SIGNED_IN question settled
      // first — see above.
      //
      // Reloading the current URL is correct in BOTH places without a branch: in the modal it
      // re-renders the same listing, signed in; on /signin the page's own effect sees `user`
      // and performs the ?next= redirect it already owns. One behaviour, no special case.
      window.location.reload()
    } catch {
      retryOnCaptchaSolvedRef.current = null
      setLoading(false)
      setError({ code: 'raw', message: t('Could not sign in. Check your connection and try again.', 'Không thể đăng nhập. Kiểm tra kết nối và thử lại.') })
    }
  }

  // ⚠️ RENDERED AS ITS OWN STAGE RATHER THAN INSIDE BOTH <TabsContent>s. The block is
  // identical for email and phone apart from one label, so putting it in each tab would have
  // been the same markup twice, drifting the moment one is edited. It keeps `tab` for the
  // wording and for which identifier it reads.
  if (stage === 'password') {
    const identifier = tab === 'email' ? email : phone
    return (
      <div className={cn(className, 'space-y-2')}>
        <p className="text-sm text-muted-foreground">
          {t('Signing in as', 'Đăng nhập với')} <span className="font-semibold text-foreground">{identifier}</span>
        </p>
        {/* ⚠️ THE HIDDEN USERNAME FIELD IS REQUIRED, NOT BELT-AND-BRACES. A reviewer caught
            that rendering the identifier as static text leaves a password input with no
            username anywhere in the form, and every password manager — 1Password, Chrome,
            Safari Keychain — keys on that pairing. Without it they cannot reliably offer the
            saved credential, and crucially cannot offer to SAVE one after a successful
            sign-in, so the feature quietly fails for exactly the people most likely to use a
            password. It stays hidden because the visible identifier is not editable here.
            autoComplete="username" is the documented hook; readOnly stops it becoming a
            second source of truth. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={identifier}
          readOnly
          hidden
          aria-hidden
          tabIndex={-1}
        />
        {/* autoComplete="current-password" (not new-password) so a password manager offers the
            SAVED credential here rather than proposing a fresh one. */}
        <Input
          type="password"
          autoComplete="current-password"
          enterKeyHint="go"
          aria-label={t('Password', 'Mật khẩu')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !loading && password) void signInWithPassword() }}
          placeholder={t('Password', 'Mật khẩu')}
        />
        <Button
          variant="cta"
          size="none"
          onMouseDown={(e) => e.preventDefault()}
          // ⚠️ ARROW, NOT A BARE REFERENCE. signInWithPassword now takes an optional preset
          // captcha token, and onClick would pass React's MouseEvent straight into it — sending
          // a synthetic event object to the server as `captchaToken`. tsc caught it; it would
          // otherwise have failed as "the security check didn't complete", i.e. indistinguishable
          // from the very bug this change exists to fix.
          onClick={() => signInWithPassword()}
          disabled={loading || !password}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm disabled:opacity-100 disabled:bg-muted disabled:text-ink-4 transition-colors cursor-pointer"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />} {t('Sign in', 'Đăng nhập')}
        </Button>
        {error && <p role="alert" className="text-xs font-semibold text-destructive">{signInErrorText(error, t)}</p>}
        {/* ⚠️ THIS LINK IS ALSO THE FORGOT-PASSWORD FLOW, AND THAT IS WHY THERE ISN'T ONE.
            The plan carried a fourth workstream — mint a recovery token, send a reset email,
            build a set-new-password screen — and it turned out to be entirely redundant.
            Every account on this platform can ALWAYS sign in with a code or a link, because
            that is the only way accounts are created in the first place. So the recovery path
            for a forgotten password already exists, is already the most-tested flow in the
            app, and is one tap away: sign in with a code, then change the password in
            Settings. A bespoke reset flow would have added a second credential-bearing email
            template, another token type to expire correctly, and another anti-enumeration
            surface to get right — to reach a screen the user can already reach.
            The copy therefore names BOTH jobs, so someone who has simply forgotten their
            password recognises the way out instead of hunting for the words "forgot".
            ⚠️ It is also not optional for a second reason: password is opt-in from Settings,
            so most visitors who land here never set one at all. */}
        <Button
          variant="bare"
          size="none"
          onClick={() => { retryOnCaptchaSolvedRef.current = null; setStage('input'); setPassword(''); setError(null) }}
          className="w-full pt-1 text-center text-sm font-semibold text-accent-foreground hover:underline cursor-pointer"
        >
          {tab === 'email'
            ? t('Forgot it? Use a code or link instead', 'Quên mật khẩu? Dùng mã hoặc liên kết')
            : t('Forgot it? Use a code instead', 'Quên mật khẩu? Dùng mã đăng nhập')}
        </Button>
        {/* Mounted so signInWithPassword() can mint a token — Supabase enforces a captcha on
            the password grant, so without this every attempt would fail as bad credentials. */}
        <Turnstile />
      </div>
    )
  }

  if (stage === 'sent') {
    return (
      // className FIRST so this stage's text-center beats the page's text-left
      // (tailwind-merge: last conflicting class wins).
      <div className={cn(className, 'text-center')}>
        {/* Anchored success mark — the chrome coin (icon-language §6), byte-matching
            ui/empty-state's recipe: brand-50 disc + h-8 glyph at the display stroke.
            bg-tint (a gray) made this the one off-family coin in the app; the blue
            disc is what keeps "check your email" looking like eno, in both themes. */}
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-50">
          <Mail className="h-8 w-8 text-brand" strokeWidth={STROKE_DISPLAY} />
        </span>
        <p className="mt-4 text-lg font-bold text-foreground">{t('Check your email', 'Kiểm tra email của bạn')}</p>
        <p className="mt-1.5 text-sm text-muted-foreground">{t('We sent a magic link to', 'Chúng tôi đã gửi liên kết đăng nhập tới')}</p>
        <p className="text-sm font-semibold text-foreground">{email}</p>
        <p className="mt-3 text-xs text-muted-foreground">
          {t("Didn't get it? Check spam, or", 'Không thấy email? Kiểm tra spam, hoặc')}{' '}
          {/* text-xs: the base is text-sm and this button lives in a text-xs <p> — without it the label jumps 12→14px. disabled:opacity-100 cancels the base's disabled:opacity-50 so it doesn't double-dim against disabled:text-ink-4. */}
          <Button variant="bare" size="none" onClick={sendEmail} disabled={countdown > 0 || loading} className="text-xs font-semibold text-accent-foreground hover:underline disabled:opacity-100 disabled:text-ink-4 disabled:no-underline cursor-pointer disabled:cursor-default">
            {countdown > 0 ? `${t('resend in', 'gửi lại sau')} ${fmtCountdown(countdown)}` : t('resend', 'gửi lại')}
          </Button>
        </p>
        {error && <p role="alert" className="mt-2 text-xs font-semibold text-destructive">{signInErrorText(error, t)}</p>}
        <Button variant="bare" size="none" onClick={reset} className="mt-3 text-sm font-semibold text-accent-foreground hover:underline cursor-pointer">
          {t('Use another method', 'Dùng cách khác')}
        </Button>
        {/* Kept mounted here too so the email "resend" above can mint a fresh token. */}
        <Turnstile />
      </div>
    )
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* OAuth — in an in-app browser / iOS PWA, Google rejects OAuth, so this hands
          off to the real browser (Android: automatic; iOS: shows the manual hint).
          In the native app's embedded tabs it's hidden outright (isNativeTabs). */}
      {!hideGoogle && (
        <>
          <Button variant="ghost" size="none" disabled={loading} onClick={() => oauth('google')} className="w-full py-2.5 font-bold text-foreground hover:bg-muted hover:text-foreground cursor-pointer">
            <GoogleIcon /> {oauthBlocked ? t('Open Google in your browser', 'Mở Google trong trình duyệt') : t('Continue with Google', 'Tiếp tục với Google')}
            {oauthBlocked && <ExternalLink className="size-3.5 text-ink-4" />}
          </Button>
          {oauthBlocked && (
            <p className="rounded-xl bg-tint px-3 py-2 text-2xs leading-relaxed text-muted-foreground">
              {iosHint
                ? t('Tap ••• at the top, choose “Open in Safari/Browser”, then sign in with Google. Or just use Phone/Email below — they work right here.', 'Chạm ••• ở trên rồi chọn “Mở trong Safari”, sau đó đăng nhập với Google. Hoặc dùng SĐT/email bên dưới — vẫn hoạt động ngay tại đây.')
                : t('Google sign-in needs your real browser. Phone or email below work right here.', 'Google chỉ hoạt động trong trình duyệt thật. Dùng SĐT hoặc email bên dưới — vẫn hoạt động ngay tại đây.')}
            </p>
          )}

          <div className="flex items-center gap-3 py-1">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-ink-4">{t('or', 'hoặc')}</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}

      {/* Email / Phone tabs — real tab semantics (role=tablist/tab/tabpanel, aria-selected,
          roving arrow-key focus) via ui/tabs, CONTROLLED by our own `tab` state: the OTP
          flow below is driven by that state + `stage`, not by Tabs' internal value.
          Two rules govern the classes here, and both are load-bearing:
          1. These className strings hit the PRIMITIVE's own cn(), so tailwind-merge DELETES
             the conflicting base class outright (inline-flex/w-fit/rounded-lg/p-[3px]/bg-muted
             on the list; h-[calc(100%-1px)]/border/px-1.5/py-0.5/font-medium/transition-all on
             the tab). Never pass these via a `render` child — Base UI CONCATENATES a child's
             className, so `font-semibold` would silently lose to the base `font-medium`.
          2. The ACTIVE branch must be written as `data-active:*`, not a JS ternary: Base UI
             emits data-active, and the primitive's `.data-active\:bg-background[data-active]`
             is specificity (0,2,0) — it would beat a plain `.bg-card` (0,1,0). Same-modifier
             overrides make tailwind-merge drop the base ones instead of racing them.
          `group-data-horizontal/tabs:h-auto` drops the list's h-8 (which would squash the
          40px strip to 32px); `outline-none` + duration-100 + active:scale-[0.97] restore
          exactly what ui/button's base was giving these buttons before. */}
      {/* Deliberate behaviour change (2026-07-14), noted so nobody "restores" it: the old strip ran
          reset() on EVERY click, including a re-tap of the tab you were already on — so brushing
          "Phone" while an OTP code was half-typed threw you back to the number field and wiped it.
          onValueChange only fires on an actual change, so a re-tap is now a no-op. "Change number"
          is still the way back. This is the one place the tabs migration is not pixel/behaviour
          identical, and it is an improvement. */}
      <Tabs value={tab} onValueChange={(v) => { setTab(v as 'email' | 'phone'); reset() }} className="gap-3">
        <TabsList className="flex w-full items-stretch rounded-full bg-tint p-1 text-sm font-semibold group-data-horizontal/tabs:h-auto">
          {(['phone', 'email'] as const).map((m) => (
            // Selecting a method is LOCATION state (icon-language §5): the active glyph takes
            // the soft duotone — SAME line, plus the brand-100 interior wash (more wash, same
            // line, exactly the bottom nav's active treatment). The washes are LOCAL per-glyph
            // classes (lead ruling, R2 — icon-tokens stays untouched).
            // ⚠️ Mail washes its FLAP PATH, not its rect, and the reason is PAINT ORDER, verified
            // in the rendered DOM: this lucide version emits <path d="m22 7-8.991…"/> (the flap)
            // BEFORE <rect …/> (the body), and SVG paints in document order — so an opaque
            // fill-brand-100 on the rect lands ON TOP of the flap line and deletes it (measured:
            // the glyph became a lineless washed box). §0's signature is "one ink line OVER a
            // soft wash"; a wash that erases the line fails the law it serves. The flap region
            // (the fill an open V encloses) tints the envelope's upper interior and leaves every
            // ink line intact. Phone's single handset path has no such hazard.
            // The condition lives in cn() because the tabs are controlled by our own `tab` state
            // (`tab === m` IS Base UI's data-active), and a runtime `data-active:`-prefixed
            // template string would never be seen by Tailwind's scanner. One closed region each,
            // never the whole silhouette (§0).
            <TabsTrigger key={m} value={m} className="flex h-auto cursor-pointer rounded-full border-0 px-0 py-1.5 text-sm font-semibold outline-none transition-colors duration-100 active:scale-[0.97] text-muted-foreground hover:text-muted-foreground dark:text-muted-foreground dark:hover:text-muted-foreground data-active:bg-popover data-active:text-accent-foreground data-active:shadow-sm dark:data-active:bg-popover dark:data-active:text-accent-foreground">
              {m === 'email'
                ? <Mail className={cn('h-4 w-4', tab === m && '[&>path]:fill-brand-100')} />
                : <Phone className={cn('h-4 w-4', tab === m && '[&>path]:fill-brand-100')} />}
              {m === 'email' ? tr('Email') : t('Phone', 'Điện thoại')}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="email" className="space-y-2">
          {stage === 'input' && (
            <>
              {/* Enter submits, and the on-screen keyboard's return key SAYS so (enterKeyHint) —
                  identical to the phone field below. The guard mirrors the button's `disabled`
                  exactly, so Enter can never fire a send the button itself would refuse. */}
              <Input type="email" inputMode="email" autoComplete="email" enterKeyHint="send" aria-label={tr('Email')} value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !loading && email.includes('@')) sendEmail() }} placeholder="you@email.com" />
              {/* onMouseDown+preventDefault holds the email field's focus through the tap. On the
                  native code path this is a focus TRANSFER into the code strip inside one keyboard
                  session — the same invariant the phone "Send code" button documents. Never
                  onPointerDown: that fires before the browser's focus handling and loses the field.
                  Disabled = bg-muted + text-ink-4 (here and on every full-width CTA in this flow,
                  onboarding included), NOT the base's opacity fade: cta's white-on-brand at 40%
                  opacity was white on ~brand-200 — far below AA and still reading as tappable.
                  A flat gray field is unmistakably inert; disabled:opacity-100 cancels the base. */}
              <Button variant="cta" size="none" onMouseDown={(e) => e.preventDefault()} onClick={sendEmail} disabled={loading || !email.includes('@')} className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm disabled:opacity-100 disabled:bg-muted disabled:text-ink-4 transition-colors cursor-pointer">
                {loading && <Loader2 className="h-4 w-4 animate-spin" />} {emailCode ? t('Send code', 'Gửi mã') : t('Send magic link', 'Gửi liên kết đăng nhập')}
              </Button>
              {/* Secondary by construction: a text button under the CTA, shown only once the
                  field holds something that could BE an account. Password is opt-in from
                  Settings, so most visitors have none — leading with it, or making it a third
                  tab, would put a credential most accounts lack beside the two that always
                  work. Enabled state mirrors the CTA's so it cannot advance on an empty box. */}
              <PasswordSwitch
                show={email.includes('@')}
                onClick={() => { setStage('password'); setPassword(''); setError(null) }}
                label={t('Use a password instead', 'Dùng mật khẩu')}
              />
            </>
          )}

          {/* Native only (emailCode) — a link cannot deliver a session into the app, so the
              code lands here instead. Structurally the phone code stage with an 8-slot strip;
              the two are deliberately NOT yet extracted into one component because the phone
              block carries a dense set of load-bearing comments (autoFocus/keyboard behaviour,
              the disabled= progress-cue tradeoff) that a refactor would have to relocate
              verbatim. Worth doing; not worth doing in the same change that introduces the flow. */}
          {stage === 'code' && (
            <div className="space-y-3">
              <p className="text-center text-xs text-muted-foreground">
                {t('Enter the 8-digit code sent to', 'Nhập mã 8 số gửi tới')} <strong className="text-foreground">{email}</strong>
              </p>
              <p className="-mt-1.5 text-center text-2xs text-ink-4">{t('Check spam if it is not there in a minute.', 'Nếu chưa thấy sau một phút, hãy kiểm tra thư rác.')}</p>
              {/* w-9 not w-12: eight slots at the phone strip's width would overflow the dialog's
                  content box on a 320px device. 8 × 36px == 6 × 48px, so the strip is the same
                  total width as the phone one and the panel never reflows between tabs. */}
              <InputOTP maxLength={EMAIL_CODE_LEN} value={code} onChange={setCode} onComplete={onCodeComplete} autoFocus autoComplete="one-time-code" inputMode="numeric" containerClassName="justify-center" disabled={loading}>
                <InputOTPGroup>
                  {Array.from({ length: EMAIL_CODE_LEN }, (_, i) => (
                    <InputOTPSlot key={i} index={i} className="h-12 w-9 text-base font-semibold data-[active=true]:border-brand data-[active=true]:ring-brand/30" />
                  ))}
                </InputOTPGroup>
              </InputOTP>
              <Button variant="cta" size="none" onClick={() => verifyEmailCode()} disabled={loading || code.length < EMAIL_CODE_LEN} className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm disabled:opacity-100 disabled:bg-muted disabled:text-ink-4 transition-colors cursor-pointer">
                {loading && <Loader2 className="h-4 w-4 animate-spin" />} {t('Verify', 'Xác nhận')}
              </Button>
              <div className="flex items-center justify-between px-1 text-xs">
                <Button variant="bare" size="none" onClick={reset} className="text-xs font-semibold text-muted-foreground hover:text-accent-foreground cursor-pointer">{t('Change email', 'Đổi email')}</Button>
                <Button variant="bare" size="none" onClick={sendEmail} disabled={countdown > 0 || loading} className="text-xs font-semibold text-accent-foreground hover:underline disabled:opacity-100 disabled:text-ink-4 disabled:no-underline cursor-pointer disabled:cursor-default">
                  {countdown > 0 ? `${t('Resend in', 'Gửi lại sau')} ${fmtCountdown(countdown)}` : t('Resend code', 'Gửi lại mã')}
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* One phone panel, two stages (input → code) — the panel only mounts while the
            Phone tab is active, so the old `tab === 'phone' &&` guards are now implicit. */}
        <TabsContent value="phone">
          {stage === 'input' && (
            <div className="space-y-2">
              <Input type="tel" inputMode="tel" autoComplete="tel" enterKeyHint="send" aria-label={t('Phone', 'Điện thoại')} value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !loading && phone.replace(/\D/g, '').length >= 9) sendPhone() }} placeholder="0901 234 567" />
              {/* onMouseDown + preventDefault — the composer focus-hold invariant (see
                  messages/[id]/page.tsx + CLAUDE.md). Tapping this button would otherwise blur
                  the number field, so iOS tears the keyboard down mid-send; the OTP field then
                  mounts and autoFocuses OUTSIDE any user gesture, which on iOS focuses the field
                  without ever re-opening the keyboard. Holding focus here keeps the keyboard up
                  across the handoff. NEVER onPointerDown — that fires before focus and does not
                  hold it. Click is unaffected (preventDefault on mousedown does not cancel it),
                  and keyboard activation goes through keydown, so Tab+Enter is untouched. */}
              <Button variant="cta" size="none" onMouseDown={(e) => e.preventDefault()} onClick={sendPhone} disabled={loading || phone.replace(/\D/g, '').length < 9} className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm disabled:opacity-100 disabled:bg-muted disabled:text-ink-4 transition-colors cursor-pointer">
                {loading && <Loader2 className="h-4 w-4 animate-spin" />} {t('Send code', 'Gửi mã')}
              </Button>
              {/* ⚠️ SET EXPECTATIONS BEFORE THE SEND — THERE IS NO SMS FALLBACK ANY MORE.
                  SpeedSMS was removed on 2026-08-02 ("remove speed sms from both"), and it was the
                  only channel that needed nothing installed. A code can now only land in Zalo,
                  WhatsApp or Telegram, so someone with none of them gets NOTHING and no error
                  worth acting on: the hook deliberately answers 200 even when every channel fails,
                  because a non-200 would abort a login Supabase has already recorded.
                  A line the user reads BEFORE tapping is therefore the only honest place to say it.
                  The app named follows the same country rule the server routes on — Zalo for a
                  Vietnamese number, WhatsApp for a foreign one — so the two cannot disagree. */}
              <p className="text-2xs leading-snug text-muted-foreground">{otpAppHint}</p>
              {/* Sits BELOW the delivery warning, not above it: with no SMS fallback the
                  warning is the thing a visitor most needs to read before tapping send, and
                  password is the rarer path. Same 9-digit threshold as the CTA. */}
              <PasswordSwitch
                show={phone.replace(/\D/g, '').length >= 9}
                onClick={() => { setStage('password'); setPassword(''); setError(null) }}
                label={t('Use a password instead', 'Dùng mật khẩu')}
              />
            </div>
          )}

          {stage === 'code' && (
            <div className="space-y-3">
              <p className="text-center text-xs text-muted-foreground">{t('Enter the 6-digit code sent to', 'Nhập mã 6 số gửi tới')} <strong className="text-foreground">{phone}</strong></p>
              {/* Point at the ONE inbox the hook actually delivered to — shown only
                  once /api/auth/otp-channel confirms it, never a guess. */}
              {sentChannel && (
                <p className="-mt-1.5 text-center text-2xs text-ink-4">
                  {sentChannel === 'sms'
                    ? t('Sent by SMS — check your messages.', 'Đã gửi qua SMS — kiểm tra tin nhắn của bạn.')
                    : `${t('Sent to your', 'Đã gửi tới')} ${sentChannel === 'telegram' ? 'Telegram' : sentChannel === 'whatsapp' ? 'WhatsApp' : 'Zalo'}.`}
                </p>
              )}
              {/* autoFocus lands in the commit that swaps input→code — i.e. AFTER the awaited send,
                  outside any user gesture. Two DIFFERENT platforms, and the difference is why this
                  is written down (an earlier reading of it was wrong in both directions):
                   · NATIVE (Capacitor): the keyboard opens anyway. @capacitor/ios swizzles
                     WKContentView's _elementDidFocus and calls
                     setKeyboardShouldRequireUserInteraction(false) on every WebView it builds
                     (CAPBridgeViewController.swift) — so a programmatic .focus() raises the
                     keyboard with no gesture. Nothing to fix here.
                   · MOBILE SAFARI / iOS PWA (web): it does NOT. There the only reason the keyboard
                     survives is that the keyboard is ALREADY up — the Send button holds the number
                     field's focus (see its comment), making this a focus TRANSFER inside one
                     keyboard session. So don't "fix" the autoFocus (focusing earlier, or on a
                     timer, can't help on web and isn't needed on native) — protect the focus-hold.
                  KNOWN GAP on both, deliberately not papered over: `disabled={loading}` blurs this
                  field for the length of a verify (and of a resend), so a REJECTED code returns to a
                  field that is enabled but unfocused — no keyboard until the user taps a slot. The
                  obvious "fix" is to drop `disabled`; don't. It is also the only PROGRESS cue here
                  (ui/input-otp dims the whole strip via has-disabled:opacity-50), so the strip would
                  sit inert and identical while the network call runs. Note what is NOT the reason:
                  a concurrent verify is already blocked by onCodeComplete's own `loading` guard, so
                  dropping `disabled` would cost the feedback, not the guard. One extra tap after a
                  wrong code is the cheaper bug. */}
              <InputOTP maxLength={6} value={code} onChange={setCode} onComplete={onCodeComplete} autoFocus autoComplete="one-time-code" inputMode="numeric" containerClassName="justify-center" disabled={loading}>
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <InputOTPSlot key={i} index={i} className="h-12 w-12 text-lg font-semibold data-[active=true]:border-brand data-[active=true]:ring-brand/30" />
                  ))}
                </InputOTPGroup>
              </InputOTP>
              <Button variant="cta" size="none" onClick={() => verifyPhone()} disabled={loading || code.length < 6} className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm disabled:opacity-100 disabled:bg-muted disabled:text-ink-4 transition-colors cursor-pointer">
                {loading && <Loader2 className="h-4 w-4 animate-spin" />} {t('Verify', 'Xác nhận')}
              </Button>
              <div className="flex items-center justify-between px-1 text-xs">
                {/* text-xs on both: the base is text-sm and this row is text-xs. disabled:opacity-100 cancels the base's disabled:opacity-50 (would double-dim with disabled:text-ink-4). */}
                <Button variant="bare" size="none" onClick={reset} className="text-xs font-semibold text-muted-foreground hover:text-accent-foreground cursor-pointer">{t('Change number', 'Đổi số')}</Button>
                {/* Deliberately NO onMouseDown focus-hold here, unlike "Send code" above — it would
                    be theatre. sendPhone() flips `loading`, which DISABLES the OTP field above, and
                    disabling the focused element blurs it anyway; holding focus through the tap only
                    delays the same blur by one render. The hold is worth it exactly where the field
                    it protects stays ENABLED across the await — the number field in the input
                    stage — and nowhere else. */}
                <Button variant="bare" size="none" onClick={sendPhone} disabled={countdown > 0 || loading} className="text-xs font-semibold text-accent-foreground hover:underline disabled:opacity-100 disabled:text-ink-4 disabled:no-underline cursor-pointer disabled:cursor-default">
                  {countdown > 0 ? `${t('Resend in', 'Gửi lại sau')} ${fmtCountdown(countdown)}` : t('Resend code', 'Gửi lại mã')}
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {error && <p role="alert" className="text-center text-xs font-semibold text-destructive">{signInErrorText(error, t)}</p>}
      {/* Invisible Turnstile — renders a visible challenge only if one is required. */}
      <Turnstile />
      <p className="pt-1 text-center text-2xs text-ink-4">
        {t('By continuing you confirm you are 18 or older and agree to our', 'Tiếp tục nghĩa là bạn xác nhận đủ 18 tuổi và đồng ý với')}{' '}
        <a href="/terms" target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2 hover:text-accent-foreground">{t('Terms', 'Điều khoản')}</a>
        {' '}{t('and', 'và')}{' '}
        <a href="/privacy" target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2 hover:text-accent-foreground">{t('Privacy Policy', 'Chính sách bảo mật')}</a>.
      </p>
    </div>
  )
}

/**
 * The "use a password instead" switch, shared by both tabs.
 *
 * ⚠️ IT RESERVES ITS SPACE WHEN HIDDEN. Rendering `show && <Button/>` made the whole form
 * grow by a row the moment the visitor typed an "@", which pushed the CTA out from under a
 * thumb already travelling toward it — the tap-target-moves-mid-gesture failure the app has
 * hit before. `invisible` keeps the row in the layout at all times, and `pointer-events-none`
 * + `tabIndex -1` + `aria-hidden` keep the hidden state genuinely unreachable rather than
 * merely unseen: an invisible button that a screen reader still announces, or that Tab still
 * lands on, is worse than one that is simply absent.
 */
function PasswordSwitch({ show, onClick, label }: { show: boolean; onClick: () => void; label: string }) {
  return (
    <div className={cn('pt-0.5 text-center', !show && 'invisible pointer-events-none')} aria-hidden={!show}>
      <Button
        variant="bare"
        size="none"
        tabIndex={show ? undefined : -1}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className="text-xs font-semibold text-muted-foreground hover:text-accent-foreground hover:underline cursor-pointer"
      >
        {label}
      </Button>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"/><path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52Z"/></svg>
  )
}
