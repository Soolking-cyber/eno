'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'

/**
 * THE PASSIVE CHROME — loaded and hydrated only after the page is usable.
 *
 * Owner, 2026-08-13: *"work on load speed lazyload whats not important"*. The cookie banner and the
 * install hint mount on EVERY route, in the root provider tree, at first paint — and neither has
 * anything to show in the first seconds. Their code was parsed, compiled, evaluated and hydrated
 * while the visitor was still waiting for the listings.
 *
 * Measured against production with Lighthouse 12.8: LCP 9.6s, TBT 520ms, 1632ms of script
 * evaluation, with the react-dom chunk alone costing 1701ms of bootup. The bottleneck is
 * main-thread work at startup, not bandwidth — so the fix that matters is doing less of it, not
 * downloading less of it. That is why this is `next/dynamic` and not a bare `useState` gate: a gate
 * alone still ships and evaluates every module at startup and merely skips the render.
 *
 * ⛔ THREE COMPONENTS WERE TRIED HERE AND SENT BACK, AND THE RULE THEY SHARE IS THE POINT OF THIS
 * FILE. `next/dynamic` mounts ASYNCHRONOUSLY: `wake()` starts a module fetch and queues a React
 * state update while the browser dispatches the trailing `pointerup`/`click`/`contextmenu` in the
 * same tick. So the gesture that wakes this boundary is ALWAYS dispatched before the boundary
 * exists. Anything whose job is to answer a gesture therefore cannot live here — a fact all three
 * external reviewers caught independently, against a first version that claimed the opposite.
 *   · SaveSignupSheet listens for `eno:first-save`. A guest's first heart tap — the conversion
 *     moment it exists for — would have been dropped.
 *   · ImageShield blocks the context menu on a protected photo; the first right-click would have
 *     got the native "Save image as…" menu.
 *   · sonner's <Toaster>, the biggest single item at ~66 KB, for the same reason one step removed:
 *     `Observer.addToast` publishes only to CURRENT subscribers and the Toaster starts from
 *     `useState([])` (verified in node_modules/sonner/dist/index.mjs), so a toast raised before it
 *     mounts is dropped with no error. That window looked negligible described as "until load" —
 *     until `load` was MEASURED on this app under 4x CPU and slow 4G: **6.8 to 8.5 seconds**, while
 *     hydration finishes seconds earlier. Five seconds of a fully interactive page where "Offer
 *     sent" silently does not appear, on exactly the slow phones this marketplace is built for.
 * All three are mounted eagerly in providers.tsx. ⛔ Do not move them back for the byte count: the
 * bytes are real, the failures are silent, and silent loses.
 *
 * ⚠️ WHAT IS DELIBERATELY *NOT* HERE EITHER. MobileNav and BottomNavSpacer are visible chrome and
 * part of the layout — deferring them trades a load metric for a bottom bar that pops in late.
 * KeyboardViewportSync must be listening before the first field is focused. The native badges are
 * already no-ops on web and cost nothing where they are.
 *
 * ⚠️ DEFERRING THE COOKIE BANNER IS NOT A CONSENT REGRESSION, and it was checked rather than
 * assumed — both external reviewers raised it at plan time. Consent is enforced at the READER, not
 * at the banner: analytics-tags.tsx calls `hasAdConsent()` and subscribes to the `eno:consent`
 * event, so with no stored consent it loads zero third-party JS no matter when — or whether — the
 * banner renders. The banner is the UI for granting consent; it is not the gate.
 *
 * The gate itself opens on the first of load+idle or any interaction. The interaction term is no
 * longer load-bearing for correctness (nothing here answers a gesture any more); it just means a
 * visitor who scrolls immediately gets the banner without waiting for idle.
 */

// `ssr: false` on both: none renders anything at first paint anyway (the banner is gated on
// stored consent, the hint on a visit count), so server-rendering them only spends HTML on markup
// the client immediately re-decides.
const CookieConsent = dynamic(() => import('./cookie-consent').then((m) => m.CookieConsent), { ssr: false })
const InstallHint = dynamic(() => import('./install-hint').then((m) => m.InstallHint), { ssr: false })

export function AmbientChrome() {
  const [awake, setAwake] = useState(false)

  useEffect(() => {
    let done = false
    const wake = () => {
      if (done) return
      done = true
      setAwake(true)
      cleanup()
    }

    // ⚠️ `{ once: true }` IS NOT ENOUGH ON ITS OWN — there are five listeners and only one of them
    // fires, so the other four have to be removed by hand or they outlive the component.
    // `capture: true` so a handler that stops propagation (the image shield's own contextmenu
    // guard, once it exists) cannot prevent the wake that mounts it.
    const EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel'] as const
    // ⚠️ THE HANDLE CARRIES ITS OWN KIND. An idle handle and a timeout handle are both numbers and
    // are NOT interchangeable — cancelling one with the other's canceller is a silent no-op that
    // leaves a callback armed after unmount.
    let pending: { kind: 'idle' | 'timeout'; id: number } | undefined
    const cleanup = () => {
      for (const e of EVENTS) window.removeEventListener(e, wake, { capture: true })
      window.removeEventListener('load', onLoad)
      if (pending?.kind === 'idle') window.cancelIdleCallback?.(pending.id)
      else if (pending) window.clearTimeout(pending.id)
    }

    // requestIdleCallback is Baseline-2024 but still absent in Safari < 17.4, which is a real share
    // of this audience (iOS, Vietnam) — so the timeout fallback is the path many visitors take, not
    // a formality. Either way the 2s `timeout` option caps how long a busy main thread can starve it.
    // ⚠️ Read off `window`, not as a bare global: an undeclared identifier throws a ReferenceError
    // rather than evaluating to undefined, so `typeof requestIdleCallback` guards the call but a
    // bare `cancelIdleCallback?.()` in cleanup would still have thrown on exactly those browsers.
    const onLoad = () => {
      pending = typeof window.requestIdleCallback === 'function'
        ? { kind: 'idle', id: window.requestIdleCallback(wake, { timeout: 2000 }) }
        : { kind: 'timeout', id: window.setTimeout(wake, 200) }
    }

    for (const e of EVENTS) window.addEventListener(e, wake, { capture: true, passive: true })
    // `load` has usually ALREADY fired by the time a client component's effect runs on a soft nav,
    // and a listener added afterwards never fires — hence the readyState check rather than a bare
    // addEventListener, which would leave the whole group waiting on an interaction that may
    // never come.
    if (document.readyState === 'complete') onLoad()
    else window.addEventListener('load', onLoad)

    return cleanup
  }, [])

  if (!awake) return null
  return (
    <>
      <CookieConsent />
      <InstallHint />
    </>
  )
}
