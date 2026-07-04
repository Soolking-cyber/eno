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
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '0x4AAAAAADvYeXXUeqC3zRQC'
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
          'error-callback': () => {
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
      const timer = setTimeout(() => finish(undefined), 15000)
      function finish(token: string | undefined) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (resolverRef.current === finish) resolverRef.current = null
        resolve(token)
      }
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
