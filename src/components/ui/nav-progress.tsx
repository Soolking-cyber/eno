'use client'

import { startTransition, useEffect, useOptimistic, useRef, useState } from 'react'
import { subscribeNavigationStart } from '@/lib/nav-progress'

/**
 * THE APP-WIDE NAVIGATION PROGRESS BAR (FAST-2, UX3 2026-10-05): one thin brand line at the top of the
 * viewport while a client navigation is STILL pending after 400ms. Mounted once, in the root layout's
 * providers, on both editions.
 *
 * Measured (research R8, speed report): card → listing takes 0.45–0.75s at 1x CPU and 1.4–2.4s at 4x, with
 * only the card's static pressed state as feedback, and every other link — breadcrumbs, the seller, the
 * similar rail, the header, the footer, the /c chips — showed nothing at all while it waited.
 *
 * HOW "PENDING" IS KNOWN, AND WHEN IT ENDS — no timers, no URL watching:
 *   · START: Next's instrumentation hook (src/instrumentation-client.ts → src/lib/nav-progress.ts) calls the
 *     listener below inside the navigation's own startTransition, and the listener sets an OPTIMISTIC id —
 *     the mechanism behind Next's useLinkStatus.
 *   · COMMIT: React reverts an optimistic value when its transition completes, i.e. when the new page (or
 *     its loading skeleton) commits — so the bar leaves at exactly that moment, even for a navigation to
 *     the URL already on screen.
 *   · POPSTATE, PAGESHOW (bfcache), ERROR: the page has given up on the navigation in flight, or was frozen
 *     with it (a hard navigation to the other language's root layout, then Back); `dismissed` hides it even
 *     though that transition may never settle.
 *   · And globals.css fades it out at 15s whatever happens, so nothing can leave it looping forever.
 * WHEN IT IS SEEN is CSS (globals.css, "THE NAVIGATION PROGRESS BAR"): invisible for the first 400ms, so a
 * fast navigation unmounts it before it ever showed — Next's "debounced hint" — then an indeterminate sweep;
 * under prefers-reduced-motion a full-width bar that pulses in opacity instead of travelling.
 *
 * ⚠️ DECORATIVE (`aria-hidden`), AND THAT IS WHY IT IS NOT BASE UI's <Progress>: Progress is a widget —
 * role="progressbar", a value, a label — and this is a transient visual hint on a 0.4–15s wait whose
 * outcome Next's route announcer already speaks (the new page's title). Base UI ships nothing decorative
 * for this; ui/spinner and ui/skeleton are hand-rolled for the same reason.
 * ⚠️ NO PER-CARD RING (plan rev 2, §R): this one bar is the whole feature.
 */
export function NavProgress() {
  // The id of the navigation in flight, held optimistically; 0 = idle (React's base value).
  const [pending, setPending] = useOptimistic(0)
  // The newest navigation the page gave up on; it and every older one stay hidden.
  const [dismissed, setDismissed] = useState(0)
  const latest = useRef(0)

  useEffect(
    () =>
      subscribeNavigationStart((id) => {
        latest.current = id
        // Nested in the navigation's transition (same event, same lane) — React then reverts it on that
        // navigation's commit. Called outside any transition, this one completes at once: no bar, never a
        // stuck one.
        startTransition(() => setPending(id))
      }),
    [setPending],
  )

  useEffect(() => {
    const dismiss = () => setDismissed(latest.current)
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) dismiss()
    }
    window.addEventListener('popstate', dismiss)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      window.removeEventListener('popstate', dismiss)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [])

  // A navigation that never settles is let go at 16 s — after the CSS fade-out at 15 s — so no invisible bar keeps
  // sweeping forever (codex, gate 2026-10-05). The next navigation has a new id and shows again.
  useEffect(() => {
    if (pending === 0) return
    const t = setTimeout(() => setDismissed((d) => Math.max(d, pending)), 16_000)
    return () => clearTimeout(t)
  }, [pending])

  if (pending === 0 || pending <= dismissed) return null
  return (
    // Under the status bar in the native shell and an installed PWA (edge-to-edge: #app-header pads itself
    // by the same inset — Capacitor's CSS var is the Android WebView < 140 fallback), at y=0 in a browser
    // tab. `z-tooltip`: "a hint over the overlay that owns its trigger" (canon §4) — a link inside a sheet
    // starts a navigation too.
    <div
      // ⛔ ONE ELEMENT PER NAVIGATION (codex + opus, gate 2026-10-05): a reused node keeps its finished CSS
      // animations, so a tap made during — or 15 s after — a slow navigation got no bar at all, or one that faded
      // a second later. Keyed on the navigation id, every navigation starts its own 400 ms delay and sweep.
      key={pending}
      aria-hidden
      data-nav-progress
      className="nav-progress pointer-events-none fixed inset-x-0 top-[max(env(safe-area-inset-top),var(--safe-area-inset-top,0px))] z-tooltip h-[3px] overflow-hidden bg-brand/20"
    >
      <div className="nav-progress-bar h-full w-2/5 rounded-full bg-brand" />
    </div>
  )
}
