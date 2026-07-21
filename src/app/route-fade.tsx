'use client'

import { useEffect, useRef } from 'react'

/**
 * The route enter-fade wrapper for app/template.tsx — with BACK/FORWARD suppressed.
 *
 * The fade is right for a PUSH navigation (tap a card → the new screen arrives). It is
 * WRONG for a POP: the iOS WebView edge-swipe animates WebKit's own snapshot at full
 * opacity, hands off, and tears the snapshot down — so a live DOM that starts at
 * opacity 0 reads as "native slide → blank → 150ms fade". It also hid the page while
 * scroll restoration ran. (Deliberately NOT replaced by a directional slide — that
 * experiment was tried and reverted.)
 *
 * How the suppression works, and why it is a CSS flag rather than a React state:
 *   1. `popstate` fires synchronously on a history traversal, BEFORE the Next router
 *      re-renders, so `data-nav-pop` is already on <html> when the new template div
 *      gets its very first style resolution → `animation: none` → it paints opaque and
 *      the enter animation never starts. (globals.css, "ROUTE ENTER FADE".)
 *   2. After paint, this effect pins the same `animation: none` onto the ELEMENT
 *      (.route-fade-static) and only THEN clears the <html> flag. Both mutations happen
 *      in one synchronous block — no style recalc in between — so `animation-name` goes
 *      none → none and the browser never sees a live keyframe to start. Clearing the
 *      flag first would hand the div a fresh `enter` animation and fade it in AFTER it
 *      had already painted: exactly the flash being fixed.
 *
 * Next re-mounts template (and therefore this component + its div) on every navigation,
 * so `.route-fade-static` cannot leak into a later PUSH — the element it lives on is
 * destroyed with the old tree.
 */

// Module scope on purpose: this component is re-mounted by the very navigation whose
// type it needs to remember, so an instance-scoped guard would never survive.
let listening = false

export function RouteFade({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!listening) {
      listening = true
      // Never removed — one app-lifetime listener. Re-binding it per navigation would be
      // churn, and a window with no listener between unmount and mount could miss a pop.
      window.addEventListener('popstate', () => {
        document.documentElement.setAttribute('data-nav-pop', '')
      })
    }
    const root = document.documentElement
    if (!root.hasAttribute('data-nav-pop')) return
    // Order matters — see (2) above.
    ref.current?.classList.add('route-fade-static')
    root.removeAttribute('data-nav-pop')
    // A pop that does NOT re-mount the template (hash change, or a pushState takeover
    // closing via history.back()) leaves the flag set until the next navigation, which
    // then loses its fade once. Harmless, and far cheaper than trying to time a reset.
  }, [])

  return (
    <div ref={ref} className="route-fade animate-in fade-in duration-150">
      {children}
    </div>
  )
}
