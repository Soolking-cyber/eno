'use client'

import { useEffect, useState, type RefObject } from 'react'

/**
 * Has `ref`'s element scrolled up past the top of the screen? True once its whole box is above the viewport, false while any of
 * it is on screen or below — one IntersectionObserver, so nothing reads layout on a scroll frame and nothing is measured after
 * paint to move something. Off (`on` false, no element, no IntersectionObserver — jsdom, a very old WebView) it is false, and
 * so it is in the server render and the first client render (the observer answers after mount), so hydration agrees.
 * An element that is `display:none` (a phone-only box on a desktop) has an empty rect at 0 and is never "past".
 * The floating Map pill reads it (src/components/marketplace/map-float.ts): /c/rentals' list header and the rentals feed's
 * results line are each the end of their page's head.
 */
export function useScrolledPast(ref: RefObject<Element | null> | undefined, on = true): boolean {
  const [past, setPast] = useState(false)
  useEffect(() => {
    const el = ref?.current
    if (!on || !el || typeof IntersectionObserver === 'undefined') return
    // The root reaches far below the screen, so the element counts as "in" whenever it is on screen OR below it: a jump straight
    // from below the screen to above it (a restored scroll, an anchor) still crosses the edge and calls back (review).
    const io = new IntersectionObserver(([e]) => { if (e) setPast(!e.isIntersecting && e.boundingClientRect.bottom < 0) }, { rootMargin: '0px 0px 100000px 0px' })
    io.observe(el)
    // Turned off (or the element changed): forget the last answer, so turning back on never shows a stale "past" for the
    // frame before the observer's first callback (commit review).
    return () => { io.disconnect(); setPast(false) }
  }, [ref, on])
  return on && past
}
