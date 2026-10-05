import * as React from "react"
import { usePathname } from "next/navigation"

// Facebook/Chrome-style chrome auto-hide. Returns true when the top header /
// bottom nav should slide away (the user is scrolling DOWN, past the top of the
// page) and false when they should reappear (scrolling UP, or near the top).
// rAF-throttled with a small delta threshold so tiny jitters never toggle the
// bars; small slow scrolls accumulate (lastY only advances once a real move is
// registered) so the bars still respond to gentle dragging.
//
// ⛔ EVERY NEW PAGE STARTS WITH THE BARS SHOWING (NAV-3, UX3 2026-10-05). Measured on prod and on the UX2
// preview (nav audit N4): scroll a feed until the bars retract, tap a card, and the listing page opened at
// y=0 with the tab bar at opacity 0 — and it stayed hidden until the reader happened to scroll UP (6.5 s in
// the measured run). Native apps show their bars on every new screen. Two halves, because there are two
// ways the old page's "hidden" outlived it:
//   1. THE DECISION BELONGS TO THE PAGE VISIT IT WAS MADE ON. A hide is stored as the visit it hid — a token
//      minted per pathname — and the bars are hidden only while that token is the current one. So the first
//      render of a new page (or of a return to an old one) has its bars, whatever any page decided, also when
//      no scroll event follows the navigation (a link with scroll={false}, a Back that restores the old
//      position) — and there is no state to reset.
//      ⛔ NOT a render-phase reset ("adjust state when a prop changes"). That shipped first and the preview
//      measured it failing in Chromium and WebKit: shown, then hidden again inside the arrival commit. The
//      repeat scroll-down frames on the old page set the value the state already held; React bails out of
//      each but keeps it queued at the event's lane. The navigation renders in a TRANSITION, which skips
//      those, and a render-phase update is not written to the base state while skipped updates remain — so
//      the follow-up render replayed "hidden" over the reset. A replayed hide now names the old visit and
//      hides nothing (test: "a hidden React replays after the navigation…"). The same holds for a frame the
//      old page queued that runs after the new page commits (codex, gate 2026-10-05): it can only name the
//      old visit, so no live-path check is needed.
//   2. NEAR THE TOP ALWAYS SHOWS — EVEN IN A FRAME WHOSE DOCUMENT HEIGHT CHANGED. The arrival scroll to
//      y=0 is such a frame (the new page is a different height), and the "a document that grew is not a
//      user who scrolled" early return below used to run first and swallow it. Showing near the top was
//      always the rule (the branch existed); it now wins.
// The owner's hide-on-scroll (2026-07-16) is otherwise unchanged: scrolling down hides, up shows.
export function useHideOnScroll({ threshold = 6, revealOffset = 80 }: { threshold?: number; revealOffset?: number } = {}) {
  // ⚠️ `null` OUTSIDE THE APP ROUTER (a unit test that renders a consumer bare): then it is one visit for good, as before.
  const pathname = usePathname()
  // One token per page visit: a new object whenever the path changes, so Back to a path is a new visit too.
  const visit = React.useMemo(() => ({ pathname }), [pathname])
  // The visit the bars were hidden on, or null. A repeat frame passes the SAME token, so React still bails out
  // of every frame after the first, as it did for `setHidden(true)` — scrolling costs no extra renders.
  const [hiddenOn, setHiddenOn] = React.useState<object | null>(null)

  React.useEffect(() => {
    // ⚠️ ANCHOR LAZILY, ON THE FIRST SCROLL FRAME — DO NOT READ `window.scrollY` HERE.
    // This effect runs inside React's COMMIT, with the tree React just mutated still dirty, so a
    // scroll-position read forces a full style+layout recalc before the browser would have done one
    // anyway. Measured on prod 2026-08-23 (headless chromium, mobile emulation, 4x CPU): 46.9 ms and
    // 53.5 ms for the two instances that mount on the homepage — 100.4 ms of the 314.01 ms total
    // forced style+layout on that load. The IDENTICAL read from inside `update()` costs 0.0 ms,
    // because rAF runs after layout has already settled.
    // The trade is that `hidden` cannot change until the user's first scroll frame, which is exactly
    // when it could first be meaningful: the bars start visible and a scroll is what hides them.
    // ⚠️ `visit` IS A DEPENDENCY ON PURPOSE: a new page is a new reference frame, so the listener
    // re-anchors lazily on that page's first scroll frame instead of measuring a delta against the old
    // page's last position.
    let lastY: number | null = null
    let lastHeight = 0
    let ticking = false
    // A frame already queued when this listener was torn down (the page changed under it) decides nothing:
    // its reference point belongs to the page that is gone.
    let disposed = false

    const update = () => {
      ticking = false
      if (disposed) return
      const y = Math.max(0, window.scrollY) // clamp iOS rubber-band negatives
      const height = document.documentElement.scrollHeight
      // First frame: adopt the current position as the reference and decide nothing. Without this
      // the initial `lastY` would be 0 and a page restored mid-scroll would read one enormous
      // downward delta and hide the chrome on the user's first pixel of movement.
      if (lastY === null) {
        lastY = y
        lastHeight = height
        return
      }
      // Near the top → always show (and reset the reference point). ⛔ BEFORE the height check below,
      // not after it — see (2) at the top of this file: a new page arrives at y=0 in a frame whose height
      // changed, and that frame must still bring the bars back.
      if (y < revealOffset) {
        setHiddenOn(null)
        lastY = y
        lastHeight = height
        return
      }
      /**
       * ⛔ A DOCUMENT THAT GREW IS NOT A USER WHO SCROLLED — AND AT THE BOTTOM OF AN INFINITE
       * FEED THAT IS THE ONLY THING HAPPENING. Measured on prod 2026-09-24, desktop 1440x900,
       * sitting still at the bottom of the home feed: the next page appends, `scrollHeight` goes
       * 3524 → 3962, and because the viewport is pinned to the bottom the browser advances
       * `window.scrollY` by the SAME 438px to keep the content anchored. Nobody touched the
       * wheel. This hook then read +438 as a deliberate scroll-down and slid the 64px header
       * away; the next page did it again, which is the "navbar jumping at the bottom" the owner
       * reported. It is desktop-visible because a tall viewport reaches the sentinel's 600px
       * rootMargin while still pinned at the bottom.
       * ⚠️ RE-ANCHOR AND DECIDE NOTHING, rather than trying to subtract the growth. The delta is
       * only meaningless when it came from the resize; a user genuinely scrolling through a frame
       * that also appended simply has that one frame skipped, and the next frame reads true.
       * Deciding nothing for a frame is invisible; guessing a correction is not.
       * (Near the top is decided above: showing the bars there is right whatever the height did.)
       */
      if (height !== lastHeight) {
        lastHeight = height
        lastY = y
        return
      }
      const delta = y - lastY
      if (Math.abs(delta) > threshold) {
        setHiddenOn(delta > 0 ? visit : null) // scrolling down → hide (this visit); up → reveal
        lastY = y
      }
    }

    const onScroll = () => {
      if (!ticking) {
        ticking = true
        requestAnimationFrame(update)
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      disposed = true
      window.removeEventListener("scroll", onScroll)
    }
  }, [threshold, revealOffset, visit])

  return hiddenOn === visit
}
