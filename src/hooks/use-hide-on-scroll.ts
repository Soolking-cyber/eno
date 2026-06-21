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
    let lastY = window.scrollY
    let ticking = false

    const update = () => {
      ticking = false
      const y = Math.max(0, window.scrollY) // clamp iOS rubber-band negatives
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
