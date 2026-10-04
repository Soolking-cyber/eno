/**
 * THE "A NAVIGATION STARTED" SIGNAL BEHIND THE APP-WIDE PROGRESS BAR (FAST-2, UX3 2026-10-05) — the one
 * thing src/instrumentation-client.ts and <NavProgress> (src/components/ui/nav-progress.tsx) share.
 *
 * ⚠️ WHY THIS SHAPE, AND NOT A CLICK LISTENER, A URL WATCH OR A PATCHED `history.pushState`:
 * Next calls `onRouterTransitionStart` (the instrumentation-client file convention, Next ≥15.3) for every
 * App Router push and replace — a <Link> tap and a `router.push()` alike — synchronously INSIDE the
 * `startTransition` that dispatches it (node_modules/next/dist/client/components/app-router-instance.js
 * `dispatchNavigateAction`). The bar's listener sets an OPTIMISTIC value in that same scope, the exact
 * mechanism Next's own `useLinkStatus` is built on (links.js `setLinkForCurrentNavigation`), so React
 * reverts it when the navigation's transition COMMITS — including a navigation to the URL already shown,
 * which no URL watch would ever see end. Nothing here counts time or guesses an end.
 * ⚠️ BACK/FORWARD (`traverse`) IS NOT SIGNALLED: those restore from the router cache, and the bar clears
 * on `popstate` regardless (nav-progress.tsx).
 * ⚠️ ONE LISTENER: the bar is mounted once, in the root layout's providers.
 */

export type NavigationType = 'push' | 'replace' | 'traverse'

type Listener = (id: number) => void

let listener: Listener | null = null
let seq = 0

/** Called by src/instrumentation-client.ts at the start of every App Router navigation. */
export function navigationStarted(type: NavigationType): void {
  if (type === 'traverse') return
  seq += 1
  listener?.(seq)
}

/** The bar subscribes on mount; the returned function unsubscribes (only if it is still the listener). */
export function subscribeNavigationStart(fn: Listener): () => void {
  listener = fn
  return () => {
    if (listener === fn) listener = null
  }
}
