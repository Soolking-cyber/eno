import * as React from "react"

// Facebook/Chrome-style chrome auto-hide. Returns true when the top header /
// bottom nav should slide away (the user is scrolling DOWN, past the top of the
// page) and false when they should reappear (scrolling UP, or near the top).
// rAF-throttled with a small delta threshold so tiny jitters never toggle the
// bars; small slow scrolls accumulate (lastY only advances once a real move is
// registered) so the bars still respond to gentle dragging.
export function useHideOnScroll({ threshold = 6, revealOffset = 80 }: { threshold?: number; revealOffset?: number } = {}) {
  const [hidden, setHidden] = React.useState(false)

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
    let lastY: number | null = null
    let lastHeight = 0
    let ticking = false

    const update = () => {
      ticking = false
      const y = Math.max(0, window.scrollY) // clamp iOS rubber-band negatives
      // First frame: adopt the current position as the reference and decide nothing. Without this
      // the initial `lastY` would be 0 and a page restored mid-scroll would read one enormous
      // downward delta and hide the chrome on the user's first pixel of movement.
      if (lastY === null) {
        lastY = y
        lastHeight = document.documentElement.scrollHeight
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
       */
      const height = document.documentElement.scrollHeight
      if (height !== lastHeight) {
        lastHeight = height
        lastY = y
        return
      }
      // Near the top → always show (and reset the reference point).
      if (y < revealOffset) {
        setHidden(false)
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
    return () => window.removeEventListener("scroll", onScroll)
  }, [threshold, revealOffset])

  return hidden
}
