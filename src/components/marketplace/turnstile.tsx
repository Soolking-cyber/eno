'use client'

import { useCallback, useRef } from 'react'

// Cloudflare Turnstile — invisible bot check that gates Supabase Auth's SMS/email OTP
// send (signInWithOtp). The token is single-use, so we run the widget in `execute` mode
// and mint a FRESH token on each send (and each resend). appearance:'interaction-only'
// means legit users see nothing; a visible challenge appears only for suspicious traffic.
//
// The SECRET key is NOT here — it lives only in the Supabase dashboard (Auth → Attack
// Protection), where Supabase verifies the token server-side. Only the PUBLIC site key
// is embedded (it's visible in the rendered widget anyway), matching how the public
// GA/Pixel IDs are hardcoded — no Vercel env write needed.
// ⚠️ NO hardcoded fallback. There used to be one, and it is what made a total sign-in
// outage invisible: NEXT_PUBLIC_TURNSTILE_SITE_KEY was never set in production, so every
// build silently used a key that Cloudflare rejects on this hostname (challenges.cloudflare.com
// answered 401, no token was ever issued). Supabase captcha was meanwhile switched ON, so
// every email-magic-link and phone-OTP send waited the full 15s for a token that could not
// arrive, then failed `captcha_failed`. Nobody could sign in except via Google.
//
// A fallback that CANNOT work is worse than no fallback: it turns "not configured" into
// "configured and mysteriously broken". Unset now means unset — getToken() resolves
// undefined immediately, so the failure is instant and legible instead of a 15s hang, and
// the app behaves exactly as it did before captcha existed.
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || null
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  execute: (id: string, opts?: Record<string, unknown>) => void
  reset: (id: string) => void
  remove: (id: string) => void
}
declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let scriptPromise: Promise<void> | null = null
function loadScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT_SRC
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => {
      scriptPromise = null
      reject(new Error('turnstile script failed to load'))
    }
    document.head.appendChild(s)
  })
  return scriptPromise
}

/**
 * useTurnstile — render <Widget/> once inside the form, then `await getToken()` right
 * before each OTP send. Resolves with a fresh single-use token, or `undefined` if the
 * script is blocked / errors / times out (in which case the auth call proceeds without
 * a token — a no-op while Supabase CAPTCHA is disabled, and a clean surfaced error once
 * it's enabled). The widget container must stay in the DOM (not display:none) so a
 * visible challenge can render on the rare occasions one is required.
 */
export function useTurnstile() {
  const widgetIdRef = useRef<string | null>(null)
  const resolverRef = useRef<((t: string | undefined) => void) | null>(null)
  /** Set by the in-flight getToken() call; the widget invokes it when a challenge is about to be
   *  shown, so the timeout can be re-based to human time. See the note in getToken. */
  const interactiveRef = useRef<(() => void) | null>(null)

  // Callback ref so the widget re-attaches wherever <Widget/> mounts — the sign-in form
  // has separate branches (input / code / email-sent) and the widget must survive stage
  // changes so `resend` in the email-sent view can still mint a token.
  const attach = useCallback((el: HTMLDivElement | null) => {
    if (!el) {
      const id = widgetIdRef.current
      if (id && typeof window !== 'undefined' && window.turnstile) {
        try {
          window.turnstile.remove(id)
        } catch {
          /* already gone */
        }
      }
      widgetIdRef.current = null
      resolverRef.current = null
      return
    }
    if (widgetIdRef.current) return // already attached to a live node
    if (!SITE_KEY) return // unconfigured — render nothing, getToken() resolves undefined
    loadScript()
      .then(() => {
        // el may have unmounted while the script loaded, or another mount won the race.
        if (!window.turnstile || widgetIdRef.current || !el.isConnected) return
        widgetIdRef.current = window.turnstile.render(el, {
          sitekey: SITE_KEY,
          execution: 'execute',
          appearance: 'interaction-only',
          callback: (token: string) => {
            resolverRef.current?.(token)
            resolverRef.current = null
          },
          // ⚠️ LOG THE CODE. This used to swallow it, and that is why a total email sign-in
          // outage took a dozen browser probes to pin down on 2026-07-27 instead of one glance at
          // a console: the widget failed, getToken() resolved undefined, the server answered 403
          // captcha_failed, and the only thing anyone could see was "the security check didn't
          // complete". Cloudflare's code says WHICH failure it is — 110200 is "this hostname is
          // not on the widget's allow-list", 400020 is a bad sitekey, 300xxx/600xxx are challenge
          // failures — and those demand completely different fixes, one of them not in this repo.
          // It stays a console.warn rather than surfacing to the visitor: the code is diagnostic,
          // not something a person signing in can act on.
          // Fires the moment the widget decides this visitor must solve something visible. The
          // in-flight getToken() uses it to stop counting in machine time — see the note there.
          'before-interactive-callback': () => {
            interactiveRef.current?.()
          },
          'error-callback': (code?: string) => {
            console.warn('[turnstile] widget error', code ?? '(no code)')
            resolverRef.current?.(undefined)
            resolverRef.current = null
          },
        })
      })
      .catch(() => {
        /* blocked (adblock/CSP/offline) — getToken() resolves undefined */
      })
  }, [])

  const getToken = useCallback((): Promise<string | undefined> => {
    return new Promise((resolve) => {
      const api = window.turnstile
      const id = widgetIdRef.current
      if (!api || !id) {
        resolve(undefined)
        return
      }
      let settled = false
      let timer = setTimeout(() => finish(undefined), 15000)
      function finish(token: string | undefined) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (interactiveRef.current === extend) interactiveRef.current = null
        if (resolverRef.current === finish) resolverRef.current = null
        resolve(token)
      }
      /**
       * ⚠️ A HUMAN CANNOT TICK A CHECKBOX IN 15 SECONDS THEY HAVE NOT SEEN YET.
       *
       * 15s is the right budget for the SILENT path — the widget is `interaction-only`, so a
       * trusted visitor gets a token in well under a second and a hung network should not stall
       * sign-in. But when Cloudflare decides this visitor must solve something, that same 15s
       * starts running against a person who has to notice a checkbox appear low in the form, move
       * to it and click. Miss the window and getToken() resolves undefined, the send goes out with
       * no token, and the server answers 403 — surfaced as "the security check didn't complete,
       * tick the verification box if one appears". The copy was describing a box the timeout was
       * pulling out from under them.
       *
       * `before-interactive-callback` fires exactly when the widget is about to demand interaction,
       * so that is the moment to stop counting like a machine and start counting like a person.
       * The clock is not removed — an abandoned challenge must still settle rather than leaving the
       * button spinning forever — it is re-based to two minutes from the moment the challenge
       * appears.
       */
      const extend = () => {
        clearTimeout(timer)
        timer = setTimeout(() => finish(undefined), 120000)
      }
      interactiveRef.current = extend
      // Settle any superseded caller immediately (instead of leaving it to its 15s timeout).
      resolverRef.current?.(undefined)
      resolverRef.current = finish
      try {
        // reset() before execute() so subsequent sends always mint a new token rather
        // than replay the consumed one.
        api.reset(id)
        api.execute(id)
      } catch {
        finish(undefined)
      }
    })
  }, [])

  const Widget = useCallback(
    () => <div ref={attach} className="flex justify-center empty:hidden" />,
    [attach],
  )

  return { getToken, Widget }
}
