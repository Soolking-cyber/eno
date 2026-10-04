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
//   1. THE DECISION BELONGS TO THE PAGE IT WAS MADE ON. A pathname change resets `hidden` in the same
//      render that shows the new page (the "adjust state when a prop changes" pattern, no effect), so the
//      first frame of a new page has its bars whatever the old page decided — also when no scroll event
//      follows the navigation (a link with scroll={false}, a Back that restores the old position).
//   2. NEAR THE TOP ALWAYS SHOWS — EVEN IN A FRAME WHOSE DOCUMENT HEIGHT CHANGED. The arrival scroll to
//      y=0 is such a frame (the new page is a different height), and the "a document that grew is not a
//      user who scrolled" early return below used to run first and swallow it. Showing near the top was
//      always the rule (the branch existed); it now wins.
// The owner's hide-on-scroll (2026-07-16) is otherwise unchanged: scrolling down hides, up shows.
const useIsoLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect

export function useHideOnScroll({ threshold = 6, revealOffset = 80 }: { threshold?: number; revealOffset?: number } = {}) {
  const [hidden, setHidden] = React.useState(false)
  // ⚠️ `null` OUTSIDE THE APP ROUTER (a unit test that renders a consumer bare): then nothing resets, as before.
  const pathname = usePathname()
  // ⛔ THE LIVE PATH, SET IN A LAYOUT EFFECT (codex, gate 2026-10-05). A scroll frame queued on the old page can
  // run AFTER the new page has committed but BEFORE the old passive effect's cleanup flips `disposed` — React
  // runs passive cleanups after paint, while a queued rAF runs before it. A restored deep position (Back) would
  // then read as one huge scroll-down and hide the bars again. Layout effects run inside the commit, before any
  // frame callback, so a frame compares its own page against this and decides nothing for a page that is gone.
  const livePath = React.useRef(pathname)
  useIsoLayoutEffect(() => { livePath.current = pathname }, [pathname])
  const [seenPath, setSeenPath] = React.useState(pathname)
  if (pathname !== seenPath) {
    setSeenPath(pathname)
    if (hidden) setHidden(false)
  }

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
    // ⚠️ `pathname` IS A DEPENDENCY ON PURPOSE: a new page is a new reference frame, so the listener
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
      if (disposed || livePath.current !== pathname) return
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
        setHidden(false)
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
        setHidden(delta > 0) // scrolling down → hide; up → reveal
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
  }, [threshold, revealOffset, pathname])

  return hidden
}
