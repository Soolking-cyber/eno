'use client'

import { useCallback, useEffect, useRef } from 'react'

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
 * `onSolved` fires whenever the widget produces a token, WHETHER OR NOT a getToken() call is
 * waiting for one — and that "whether or not" is the whole reason it exists.
 *
 * ⚠️ THE STATE IT FIXES IS NOT A STALE-STATE BUG, it is an unconsumed token. In `execute` mode a
 * visitor who has to solve a visible challenge can finish AFTER the in-flight getToken() has already
 * timed out and resolved undefined. The send then went out tokenless, the server answered 403, and
 * the form put "the security check didn't complete" on screen — and only THEN does the widget's own
 * `callback` arrive with a good token and flip itself to a green "Success!". Nothing was listening,
 * so the red text sat above the green tick until the next submit. The owner read that as still
 * broken and said "same" twice while the challenge was in fact passing (screenshot, 2026-07-27).
 *
 * So the signal has to be the callback ITSELF, not the promise: by the time a token exists, the
 * promise that asked for it may be long gone.
 *
 * useTurnstile — render <Widget/> once inside the form, then `await getToken()` right
 * before each OTP send. Resolves with a fresh single-use token, or `undefined` if the
 * script is blocked / errors / times out (in which case the auth call proceeds without
 * a token — a no-op while Supabase CAPTCHA is disabled, and a clean surfaced error once
 * it's enabled). The widget container must stay in the DOM (not display:none) so a
 * visible challenge can render on the rare occasions one is required.
 */
export function useTurnstile(opts?: { onSolved?: (token?: string) => void }) {
  const widgetIdRef = useRef<string | null>(null)
  /** Held in a ref, and updated in an effect rather than during render, so a changing callback never
   *  re-runs `attach` — re-attaching would tear down and re-render the live widget, losing an
   *  in-progress challenge. */
  /** Cloudflare's last widget-error code, kept so a failure can name itself. Cleared on success. */
  const lastErrorRef = useRef<string | null>(null)
  const onSolvedRef = useRef(opts?.onSolved)
  useEffect(() => { onSolvedRef.current = opts?.onSolved }, [opts?.onSolved])
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
            // BEFORE resolving, so a listener sees "solved" even when nothing is waiting — see the
            // note on onSolved in the hook's doc comment. Guarded because a throw from a consumer's
            // callback here would run inside Turnstile's own callback and lose the token.
            lastErrorRef.current = null
            try {
              // ⚠️ THE TOKEN IS PASSED, and that is load-bearing rather than tidy. A caller whose
              // getToken() already gave up cannot ask for this token afterwards: getToken() begins
              // with reset(), which discards exactly the token that was just solved and starts a
              // fresh challenge. Handing it to the listener is the only way a screen that timed
              // out can finish with the answer the visitor actually gave. Optional, so the OTP
              // callers that only want to retract a stale message are unaffected.
              onSolvedRef.current?.(token)
            } catch (e) {
              console.warn('[turnstile] onSolved threw', (e as Error)?.message)
            }
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
            // ⚠️ KEEP THE CODE, DO NOT JUST LOG IT. The comment above says the code is
            // diagnostic and not something a visitor can act on, and that is true — but it is
            // also the ONLY thing that separates causes needing completely different fixes, and
            // throwing it away means every one of them reaches the user as the same sentence.
            // Twice now a blocking sign-in failure has been reported as "same", and the only way
            // to tell "hostname not allow-listed" (110200, a dashboard fix) from a plain
            // challenge failure was to ask someone to open a console. Retaining it lets the form
            // show it in small print, so a screenshot is a diagnosis.
            lastErrorRef.current = code ?? null
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
      // ⚠️ THE CODE IS **NOT** CLEARED HERE, AND THAT IS THE SECOND ANSWER TO THIS QUESTION.
      // Round one of review said clear it per attempt, so a stale code cannot be pinned on a
      // later failure. I did, and round two showed that erases the very case worth reporting:
      // a hostname rejection (110200) fires from `error-callback` at WIDGET RENDER time, before
      // anyone presses anything, so clearing at the start of getToken() wiped it and the visitor
      // got the generic sentence again after a 15s hang. The two rounds are both right about
      // their own case, and only one of them is about a bug someone can act on.
      // So it is cleared on SUCCESS alone: a token proves the widget works, and until one
      // arrives an unreset error code is still TRUE. The residual imprecision — a challenge
      // failure from an earlier attempt shown against a later timeout — mislabels one challenge
      // failure as another, which changes nobody's next move.
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

  return { getToken, Widget, lastErrorRef }
}
