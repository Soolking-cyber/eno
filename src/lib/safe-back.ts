'use client'

import { useCallback, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { hapticTap } from '@/lib/haptics'

/**
 * The shared back-control brain.
 *
 * In a wrapped app the back gesture is the PRIMARY navigation, so a back chevron that
 * `push`es its parent instead of popping is felt constantly: the stack grows, and the
 * next hardware-back / edge-swipe walks the user straight back INTO the screen they just
 * left. One tap forward, one tap back, forever.
 *
 * The rule is the native one: **pop when there is one of our own entries behind us, push
 * the parent only when there isn't** — a deep link, a push-notification tap, a shared
 * link, a cold native start all legitimately have an empty back stack and must still be
 * able to reach the parent screen.
 *
 * "Is one of our own entries behind us" has no single portable answer, so this asks, in
 * order of precision:
 *
 *  1. **The Navigation API** (`navigation.canGoBack`) — exact where it exists, and the
 *     only signal that is. Its entry list is the CONTIGUOUS SAME-ORIGIN one (cross-origin
 *     entries are withheld from it by spec), and `canGoBack` is `currentEntry.index > 0`
 *     within that list — i.e. precisely "there is an entry of ours behind this one".
 *     `history.pushState`, which is how the App Router commits every client navigation,
 *     creates entries it counts. Chromium ships it (so does the Android System WebView);
 *     WebKit is the laggard, so iOS mostly lands on the fallbacks below.
 *  2. **`history.length <= 1`** — nothing behind us at all. Fresh tab, cold native start.
 *  3. **The native shell** — the WebView boots on our own server URL and only first-party
 *     domains are `allowNavigation`ed, so its session history is first-party BY
 *     CONSTRUCTION: any prior entry is one we can safely return to.
 *  4. **A same-origin referrer** (web). `document.referrer` describes the DOCUMENT load and
 *     stays pinned to it for the whole SPA session, so it only ever describes the entry
 *     behind our FIRST one — which is exactly the entry in question while we haven't
 *     navigated since. An EMPTY referrer is deliberately NOT treated as friendly: a
 *     bookmark or a typed URL opened in a tab that already showed another site has no
 *     referrer either, and popping there would throw the user off the site.
 *  5. **Proof we pushed an entry ourselves** — a cross-origin arrival (Google → us) that
 *     has since client-navigated is sitting on an entry we created.
 *
 * `history.length > 1` is never sufficient on its own, and not only because of foreign
 * entries: it counts FORWARD entries too, so at index 0 with a forward entry a pop does
 * nothing at all. Every signal above can only be a heuristic on WebKit, so the handler
 * also watches the pop it fires and falls back to the push if nothing moved — see
 * `useSafeBack`. A back control is never allowed to become a dead tap.
 *
 * Known, accepted gap: a hard RELOAD deep in an SPA session (cross-origin or absent
 * referrer, no client navigation yet in the NEW document) reads as "no history" without
 * the Navigation API and pushes instead of popping. That is the pre-existing behaviour and
 * the safe direction — the alternative is popping to a page we cannot prove is ours.
 */

/** Client-side navigations THIS document has performed while a back control was mounted.
 *  Module scope survives route changes and resets on a full load — exactly the lifetime
 *  history entries share. `document.referrer` can't stand in for it: it stays pinned to
 *  the ORIGINAL referrer for the whole SPA session.
 *
 *  ⚠️ Counts pathname CHANGES, not effect runs. A plain counter would be defeated by two
 *  back controls mounted on one screen, by a remount, and by StrictMode's double-invoked
 *  effects in dev — each of which would fake a navigation that never happened and quietly
 *  disable the cold-start fallback. */
let lastSeenPath: string | null = null
let clientNavCount = 0

/** Trailing slash is not a navigation (the App Router replaceState()s a canonicalised href
 *  on mount, and a redirect can add or drop one). */
const normalizePath = (p: string): string => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p)

/** Path this DOCUMENT was served as (post-redirect), from the Navigation Timing entry.
 *  Unlike the counter above, this is immune to when our chunk happened to evaluate, so it
 *  still sees the navigation that brought the user to the screen the back control is on. */
const servedPath = (): string | null => {
  try {
    const entry = performance.getEntriesByType('navigation')[0] as { name?: string } | undefined
    if (!entry?.name) return null
    const url = new URL(entry.name)
    return url.origin === window.location.origin ? normalizePath(url.pathname) : null
  } catch { return null }
}

/** Has this document moved off the page it was loaded with? Compared on PATH only: a
 *  `router.replace('?tab=…')` that merely seeds UI state is not a navigation and must not
 *  be mistaken for one (it replaces our entry — it does not add one).
 *  Residual, accepted: a `router.replace()` to a DIFFERENT path still reads as a navigation
 *  even though it added no entry. It takes a cross-origin arrival + a path-changing replace
 *  + no Navigation API to matter, and the cost is one back-press landing where the browser's
 *  own Back would have landed anyway. */
const hasClientNavigated = (): boolean => {
  if (clientNavCount > 0) return true
  const served = servedPath()
  return !!served && served !== normalizePath(window.location.pathname)
}

const sameOriginReferrer = (): boolean => {
  const ref = document.referrer
  if (!ref) return false // no referrer tells us NOTHING about the entry behind us
  const origin = window.location.origin
  return ref === origin || ref.startsWith(`${origin}/`)
}

/** The Navigation API's exact answer, or `null` where the engine doesn't expose it.
 *  `null` is the signal that everything below is a GUESS and the pop needs verifying. */
const navApiCanGoBack = (): boolean | null => {
  const nav = (window as unknown as { navigation?: { canGoBack?: unknown } }).navigation
  return typeof nav?.canGoBack === 'boolean' ? nav.canGoBack : null
}

const guessCanGoBack = (): boolean => {
  // 2. Nothing behind us at all.
  if (window.history.length <= 1) return false
  // 3. Native shell: the whole session history is first-party by construction.
  if (document.documentElement.classList.contains('native')) return true
  // 4-5. Web: a same-origin referrer, or proof we pushed an entry ourselves.
  return sameOriginReferrer() || hasClientNavigated()
}

/** True when the entry behind the current one is (as far as we can tell) ours to return to.
 *  Exported for callers that need the answer without the handler. */
export function canGoBackInApp(): boolean {
  if (typeof window === 'undefined') return false
  return navApiCanGoBack() ?? guessCanGoBack()
}

/** How long to wait for the pop to actually happen before treating it as a dead tap.
 *  A same-document traversal (every SPA entry) fires popstate within a task, so this is
 *  already an eternity; the cross-document case unloads us and fires pagehide first. */
const POP_SETTLE_MS = 400
/** A pop is in flight — swallow further taps so an impatient double-tap can't pop twice. */
let popping = false

/** Fire the pop, and guarantee it did something. `history.length > 1` can be true while
 *  the only other entries are FORWARD of us (user went back, then tapped Back again), and
 *  there `history.back()` is a no-op — a dead back button, which is worse than the bug this
 *  file exists to fix. So: watch for the traversal, and push the parent if it never lands. */
function popOrFallback(back: () => void, push: () => void): void {
  if (popping) return
  popping = true
  const startedAt = window.location.href
  let timer: ReturnType<typeof setTimeout> | null = null
  const settle = () => {
    if (!popping) return
    popping = false
    if (timer) clearTimeout(timer)
    window.removeEventListener('popstate', settle)
    window.removeEventListener('pagehide', settle)
  }
  timer = setTimeout(() => {
    const moved = window.location.href !== startedAt
    settle()
    if (!moved) push() // the pop went nowhere — never leave the user on a dead tap
  }, POP_SETTLE_MS)
  window.addEventListener('popstate', settle) // same-document traversal (the SPA case)
  window.addEventListener('pagehide', settle) // cross-document traversal — we're unloading
  back()
}

/**
 * The click handler every back chevron should use.
 *
 * @param fallbackHref where Back lands when there is NO history to pop (deep link / fresh
 *   tab / cold native start). Pass the screen's real parent — this is the cold-start path,
 *   so it must never be a dead tap.
 *
 * The returned handler drops straight onto a `<button>` OR an `<a>`/`<Link>` — it takes the
 * click event so it can keep a real link intact: a MODIFIED click (⌘/ctrl/shift/middle —
 * "open the parent screen in a new tab") is left entirely to the browser, and every other
 * click is handled here, so the anchor's `href` stays a genuine, SSR-visible link to
 * `fallbackHref` while the tap itself pops. (next/link bails out of its own navigation when
 * the click was `preventDefault()`ed, so there is no double navigation.)
 */
export function useSafeBack(fallbackHref: string) {
  const router = useRouter()
  const pathname = usePathname()
  useEffect(() => {
    if (lastSeenPath !== null && lastSeenPath !== pathname) clientNavCount += 1
    lastSeenPath = pathname
  }, [pathname])

  return useCallback((e?: BackClickEvent) => {
    // Let the browser own a modified click on a real link (new tab / new window).
    if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (typeof e.button === 'number' && e.button !== 0))) return
    e?.preventDefault() // we navigate explicitly below — never let an <a> push on top of it
    hapticTap()
    const push = () => router.push(fallbackHref)
    const exact = navApiCanGoBack()
    if (!(exact ?? guessCanGoBack())) { push(); return }
    // An exact `true` GUARANTEES a same-origin entry behind us, so the pop cannot no-op and
    // the watchdog would only add a way to go wrong (a slow cross-document traversal racing
    // its own fallback). Only the guess gets verified.
    if (exact !== null) { router.back(); return }
    popOrFallback(() => router.back(), push)
  }, [router, fallbackHref])
}

/** Structurally the bit of React's MouseEvent this needs — so the handler drops onto a
 *  `<button>`, an `<a>`, or a Base UI `render` child without any of them having to agree
 *  on an element type. */
type BackClickEvent = {
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  button?: number
  preventDefault: () => void
}
