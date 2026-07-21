'use client'

import { useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
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
 *     WebKit shipped it in Safari 26.2, so NEW iOS gets the exact answer too — but every
 *     deployed WKWebView older than that still lands on the fallbacks below, which is why
 *     they carry the weight they do.
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
 *     has since client-navigated is sitting on an entry we created. Only while that is
 *     still TRUE OF THE CURRENT ENTRY, which is why it is a latch on the last history
 *     event and not a count: once the user has traversed back onto the path the document
 *     was LOADED with, everything we pushed is forward of them and rule 4 is the only
 *     thing left that can speak (see `hasClientNavigated`).
 *
 * `history.length > 1` is never sufficient on its own, and not only because of foreign
 * entries: it counts FORWARD entries too, so at index 0 with a forward entry a pop does
 * nothing at all. Every signal above can only be a heuristic on WebKit, so the handler
 * also watches the pop it fires and falls back if nothing moved — see `traverseBack`.
 * A back control is never allowed to become a dead tap.
 *
 * Known, accepted gap: a hard RELOAD deep in an SPA session (cross-origin or absent
 * referrer, no client navigation yet in the NEW document) reads as "no history" without
 * the Navigation API and pushes instead of popping. That is the pre-existing behaviour and
 * the safe direction — the alternative is popping to a page we cannot prove is ours.
 */

/* ── "Have WE put an entry behind us?" ─────────────────────────────────────────────── */

/** Did the LAST thing that moved this document put one of our own entries behind us?
 *
 *  Not a counter — a latch on the last history event, which is the only shape of this
 *  question that survives the user pressing Back:
 *
 *   · a URL-changing `pushState` sets it. The entry we were on is now behind us, and it is
 *     one we made.
 *   · any `popstate` clears it. We have MOVED, and whatever we pushed is now forward of us,
 *     not behind. A count could never express this — it can only grow, so after a
 *     cross-origin arrival (Google → us) a stale count would keep claiming the entry behind
 *     us is ours right up to the moment the chevron pops the user clean off the site.
 *
 *  `history.pushState` is the one place that can't lie about this: it is how Next 16's
 *  `HistoryUpdater` commits every client PUSH (`window.history.pushState(state, '',
 *  canonicalUrl)`), while `router.replace` goes to `replaceState` and a push whose target
 *  equals the current URL is downgraded to a replace by Next before it reaches us. That
 *  distinction is the whole point:
 *
 *   · `router.push('?tab=x')` adds a REAL entry that a path-only comparison cannot see —
 *     it reads as "no history" and the back control pushes the parent on top instead of
 *     popping, which is exactly the stack growth this file exists to prevent; while
 *   · `router.replace('?tab=x')`, which merely seeds UI state, adds NO entry and must
 *     keep reading as "no history".
 *
 *  Both are invisible to `usePathname()`. Only the history call itself tells them apart. */
let ownEntryBehind = false
let historyWatchInstalled = false

/** Watch `history.pushState` and `popstate` once, and drive the latch above.
 *
 *  Only URL-CHANGING pushes count — not "the calls that add an entry", since every
 *  pushState adds one. The fullscreen video takeover and the PDP lightbox each push a
 *  state-only entry (`pushState({lightbox:true}, '')`, no url) so that back closes them;
 *  those entries are overlay handles, not places, and treating one as a navigation would
 *  make a PDP whose lightbox was merely opened and closed claim it had moved.
 *
 *  Interop with Next's own pushState patch works in either order: Next binds whatever
 *  `window.history.pushState` is when its AppRouter effect runs and calls it for its own
 *  commits, so the call passes through this wrapper whether we installed before it (module
 *  evaluation precedes hydration on a route that ships a back control) or after it (the
 *  chunk was loaded by a later client navigation). The one hole is Next's effect CLEANUP,
 *  which would restore the pushState it captured before us — it runs only if the App Router
 *  root itself unmounts, which does not happen in production. */
function installHistoryWatch(): void {
  if (historyWatchInstalled || typeof window === 'undefined') return
  historyWatchInstalled = true
  const native = window.history.pushState.bind(window.history)
  window.history.pushState = function watchedPushState(...args: Parameters<History['pushState']>) {
    const before = window.location.href
    native(...args)
    if (window.location.href !== before) ownEntryBehind = true
  }
  window.addEventListener('popstate', () => { ownEntryBehind = false })
}
// Install as early as this module can run on the client — before hydration, so the latch is
// already watching when the first client navigation commits. No-op on the server.
installHistoryWatch()

/** Trailing slash is not a navigation (the App Router replaceState()s a canonicalised href
 *  on mount, and a redirect can add or drop one). */
const normalizePath = (p: string): string => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p)

/** Path this DOCUMENT was served as (post-redirect), from the Navigation Timing entry.
 *  Unlike the latch above, this is immune to when our chunk happened to evaluate, so it
 *  still sees the navigation that brought the user to the screen the back control is on —
 *  and it keeps working after a pop, because being anywhere OTHER than the served path
 *  means there is a path we came from and it is ours.
 *
 *  It is a SNAPSHOT, not a live view of `document.URL`: Resource Timing sets the entry's
 *  `name` once, from the requested URL, in "setup the resource timing entry", and a
 *  same-document navigation creates no new navigation entry — so `pushState`/`replaceState`
 *  cannot move it. (If an engine ever did make it live this would simply always answer
 *  "same", which costs a pop on the web/cross-origin path and errs towards pushing the
 *  parent — the safe direction, never towards leaving the site.) */
const servedPath = (): string | null => {
  try {
    const entry = performance.getEntriesByType('navigation')[0] as { name?: string } | undefined
    if (!entry?.name) return null
    const url = new URL(entry.name)
    return url.origin === window.location.origin ? normalizePath(url.pathname) : null
  } catch { return null }
}

/** Has this document put an entry BEHIND the one we are on?
 *
 *  Two independent signals, and the second is what makes the first safe to keep simple:
 *   · the latch — the last history event was a URL-changing push of ours;
 *   · the served path — we are on a different PATH from the one the document loaded with,
 *     so however we got here, the place we came from is ours to return to. This is what
 *     answers a multi-level pop (served /a, push /b, push /c, pop to /b: the latch is
 *     cleared, but /b ≠ /a and the entry behind /b really is ours).
 *  Land back on the served path with the latch cleared and the answer is NO — everything we
 *  pushed is forward of us, and the entry behind belongs to whoever linked to us. That is
 *  the case that otherwise pops a cross-origin visitor clean off the site.
 *
 *  The served comparison stays PATH-only on purpose: without a history call to look at, a
 *  query change cannot be told apart from a query-only `replace()` that added nothing, and
 *  guessing "navigation" there would pop the user off a screen they never left. Query-only
 *  PUSHES are not lost by that — the latch sees them, which is the whole reason it exists.
 *
 *  Residual, accepted, and all in the SAFE direction (push the parent, never throw the user
 *  off the site): a `router.replace()` to a DIFFERENT path reads as a navigation even though
 *  it added no entry; a multi-level pop that lands back on the served path with only the
 *  query differing reads as "no history"; and a plain `<a href="#x">` adds an entry without
 *  going through `pushState`, so the latch never sees it. (A `hashchange` listener would
 *  catch that last one, but it fires on a hash POP too — where popstate has just correctly
 *  cleared the latch — so it would trade a stack-growth miss for an off-origin pop.) All of
 *  these need a cross-origin arrival AND no Navigation API to matter at all. */
const hasClientNavigated = (): boolean => {
  if (ownEntryBehind) return true
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

/* ── Firing the pop ────────────────────────────────────────────────────────────────── */

/** How long to wait for a GUESSED pop to show any sign of life before treating it as a
 *  dead tap. A same-document traversal (every SPA entry) fires popstate within a task, so
 *  this is already an eternity for the case the watchdog is actually for.
 *
 *  ⚠️ Deliberately NOT longer. Nothing in any web standard bounds how long a traversal
 *  takes — a cross-document back whose target is no longer in the bfcache is a network
 *  fetch, and `pagehide`/`pageswap` do not fire until the destination has been populated —
 *  so no timeout can be "long enough". Lengthening it only makes the race rarer, which is
 *  worse than useless: it converts a reproducible bug into an intermittent one. The fix is
 *  to make the fallback HARMLESS when a traversal lands late (see `traverseBack`), not to
 *  try to outrun it.
 *
 *  There IS an early "a traversal has started" signal — the Navigation API's `navigate`
 *  event, which fires before the destination is fetched — but it exists precisely where
 *  `navigation.canGoBack` does, and there this watchdog is never armed. On the legacy
 *  WebKit builds that do arm it, no bfcache-safe equivalent exists (`beforeunload` and
 *  `unload` both cost bfcache eligibility, which is not a trade a back control may make). */
const POP_SETTLE_MS = 400

/** Belt for the double-tap latch ALONE — it releases the latch and never navigates.
 *  A real cross-document traversal can legitimately take seconds, and every tap in that
 *  window must be swallowed or the user pops twice; but a latch with no release at all
 *  would turn one stuck traversal into a permanently dead back control.
 *
 *  ⚠️ Accepted, and unavoidable without a cancellable traversal: a tap AFTER this deadline
 *  while the first traversal is still in flight queues a second `history.back()`, and the
 *  traversal queue resolves it against the step the first one lands on — two entries for
 *  one intent. Three seconds of a back control doing nothing is already a broken-feeling
 *  app, so the deadline treats a tap that late as a fresh intent rather than a mis-tap. */
const GUARD_RELEASE_MS = 3000

/** A traversal is in flight — swallow further taps so an impatient double-tap can't pop
 *  twice. Module scope, because the two back controls on a screen (and the same control
 *  across a remount) must share one latch. */
let popping = false

/**
 * Fire the pop, guard the double-tap, and — when the pop was only a GUESS — guarantee it
 * did something.
 *
 * `history.length > 1` can be true while the only other entries are FORWARD of us (user
 * went back, then tapped Back again), and there `history.back()` is a silent no-op: a dead
 * back button, which is worse than the bug this file exists to fix. So a guessed pop is
 * watched, and the parent screen is used if nothing moved.
 *
 * ⚠️ The watchdog's fallback is a **replace, never a push**, and that is load-bearing.
 * `history.back()` starts a traversal this code cannot cancel or bound: if the entry behind
 * us is a separate document that has fallen out of the bfcache, the browser must re-fetch
 * it, and neither `popstate` nor `pagehide` fires until it commits — possibly long after
 * the watchdog has given up. So the fallback must be safe against a traversal landing
 * afterwards:
 *   · `pushState` runs the URL-and-history-update steps with a PUSH: it removes every
 *     entry after the current one and appends a new one. So a single tap would commit
 *     TWO navigations — the fallback's, which destroys the forward entries and grows the
 *     stack, plus the traversal's when it finally lands. Growing the stack on a back
 *     press is the exact bug this file exists to prevent, and here a slow network is all
 *     it takes to trigger it.
 *   · `replaceState` runs the same steps WITHOUT the push: the entry count and the step
 *     numbers behind us are unchanged, and the forward entries survive. Whichever of the
 *     two wins — the late traversal (user lands on the previous screen, as asked) or the
 *     fallback (user lands on the parent screen) — the destination is sensible and the
 *     stack is the same size as before the tap.
 *
 * Known cost of that choice, weighed and accepted: `replace` rewrites the entry the user
 * was ON, so in the genuine no-op case the screen they pressed Back FROM is no longer in
 * history. That is the direction this file wants. `push` there would leave
 * `[thread, parent]` with the user on `parent` — hardware back returns to the thread, its
 * chevron pushes the parent again, and that is precisely the "one tap forward, one tap
 * back, forever" loop the whole module exists to remove.
 *
 * Disarming on `visibilitychange` covers the other half of the same problem: a backgrounded
 * WebView freezes timers, and without it the fallback could fire minutes later, on resume,
 * on top of a page the user has since traversed away from. It only disarms — it must not
 * release the latch, because the traversal it was watching may still be in flight.
 *
 * NOTE the asymmetry with the cold-start path in `useSafeBack`, which still PUSHES: there
 * no traversal was ever started, so there is nothing to race, and pushing the parent keeps
 * the deep-linked screen reachable by hardware back.
 */
function traverseBack(back: () => void, fallback: () => void, verify: boolean): void {
  if (popping) return
  popping = true
  const startedAt = window.location.href
  let watchdog: ReturnType<typeof setTimeout> | null = null
  let guard: ReturnType<typeof setTimeout> | null = null

  // TWO separate concerns, and conflating them is itself a double-pop bug:
  //   · disarm()  — stop the watchdog from firing a fallback.
  //   · release() — drop the double-tap latch.
  // The watchdog must disarm WITHOUT releasing. At the moment it gives up, the traversal it
  // was watching is (in the case that makes it fire late) still in flight — that is WHY it
  // gave up — and a second tap would queue a second `history.back()` behind the first. The
  // traversal queue serialises them and resolves the second against the step the first
  // lands on, so one impatient tap costs two entries. Only a real sign of life, or the
  // latch's own deadline, may release.
  const disarm = () => { if (watchdog) { clearTimeout(watchdog); watchdog = null } }
  // A hidden document is either unloading into the traversal or backgrounded; either way
  // firing a navigation from a timer is the wrong thing to do. Disarm only — see above.
  const onHidden = () => { if (document.visibilityState === 'hidden') disarm() }
  const release = () => {
    if (!popping) return
    popping = false
    disarm()
    if (guard) { clearTimeout(guard); guard = null }
    window.removeEventListener('popstate', release)
    window.removeEventListener('pagehide', release)
    document.removeEventListener('visibilitychange', onHidden)
  }

  // ANY popstate counts as a sign of life — deliberately not just one that changed the URL.
  // The pop we fired may have consumed a STATE-ONLY entry (the PDP lightbox and the video
  // takeover each push one so that back closes them), which leaves `location.href` untouched;
  // treating that as "nothing moved" would fire the fallback on top of a back press that did
  // exactly what the user asked. The cost of the loose check is that an unrelated traversal
  // elsewhere in the app releases the latch early, which at worst allows the second tap it
  // was meant to swallow.
  window.addEventListener('popstate', release) // same-document traversal (the SPA case)
  window.addEventListener('pagehide', release) // cross-document traversal — we're unloading
  document.addEventListener('visibilitychange', onHidden)

  if (verify) {
    watchdog = setTimeout(() => {
      watchdog = null
      if (window.location.href !== startedAt) { release(); return } // it moved after all
      fallback() // the pop went nowhere — never leave the user on a dead tap
      // NOT release() — see the disarm/release split above. But the deadline is re-cut
      // SHORT from here, because the fallback has just put the user on a DIFFERENT screen
      // whose own back control shares this latch: holding the full deadline would leave that
      // chevron dead for seconds, which is a bug report, while one more settle window still
      // swallows the reflexive re-tap the latch is really for. The residual — a deliberate
      // tap after that, while a cross-document traversal is somehow still in flight, queuing
      // a second one — is the price of a traversal we are not allowed to cancel.
      if (guard) clearTimeout(guard)
      guard = setTimeout(release, POP_SETTLE_MS)
    }, POP_SETTLE_MS)
  }
  guard = setTimeout(release, GUARD_RELEASE_MS)
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
  // Idempotent belt: module evaluation already installs the watch, but a mount is the one
  // moment we can be certain we are on a client with a live `window`.
  useEffect(() => { installHistoryWatch() }, [])

  return useCallback((e?: BackClickEvent) => {
    // Let the browser own a modified click on a real link (new tab / new window).
    if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (typeof e.button === 'number' && e.button !== 0))) return
    e?.preventDefault() // we navigate explicitly below — never let an <a> push on top of it
    hapticTap()
    const exact = navApiCanGoBack()
    // Cold start: nothing behind us at all, so no traversal is started and nothing can race
    // the push. This is the deep-link / push-notification path — it must always land.
    if (!(exact ?? guessCanGoBack())) { router.push(fallbackHref); return }
    // An exact `true` proves a same-origin entry exists behind us, so the pop cannot go
    // NOWHERE the way a guessed one can, and no fallback is armed (`verify: false`). It is
    // not an absolute commit guarantee — a cross-document target answering 204/205 or
    // `Content-Disposition: attachment` never commits, and there the tap is dead until the
    // user taps again — but that is the pre-existing behaviour of this branch and firing a
    // fallback into an uncancellable traversal is the worse of the two failures.
    // The latch DOES apply here, and that is the (b) fix: without it a rapid second tap
    // pops two entries while the first traversal is in flight.
    traverseBack(() => router.back(), () => router.replace(fallbackHref), exact === null)
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
