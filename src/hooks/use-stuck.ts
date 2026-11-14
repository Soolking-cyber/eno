'use client'

import { useEffect, useState, type RefObject } from 'react'

/**
 * Is `ref`'s STICKY element sitting on its sticky line — the page has scrolled and the element no longer moves with it? The
 * goods control rows read it to draw their one hairline only once the grid slides beneath them (explorer-toolbar.tsx SortStrip,
 * seller-listings.tsx PinnedStrip; owner-approved 2026-11-15 (build 8), cook r08 goods). The mock drew that line with a
 * scroll-driven animation (Chromium and Safari 18+ only); this is a passive scroll listener read once a frame, after layout —
 * the home pill row's own test (category-rail.tsx `stuck`): position sticky, the page scrolled, and the box's top at or above
 * its computed `top` (which follows the header's hide/reveal `top` swap — read again when that glide ends).
 * Off (`on` false, no element), and in the server render and the first client render, it is false, so hydration agrees; it
 * only ever changes a colour, never a box, so nothing moves when it flips.
 */
export function useStuck(ref: RefObject<HTMLElement | null>, on = true): boolean {
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!on || !el) return
    let frame = 0
    const read = () => {
      frame = 0
      const cs = getComputedStyle(el)
      const line = parseFloat(cs.top)
      setStuck(cs.position === 'sticky' && window.scrollY > 0 && Number.isFinite(line) && el.getBoundingClientRect().top <= line + 0.5)
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read) }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    // The header's hide/reveal glides the element's own `top` (250ms) with no scroll under way: read again where it lands.
    el.addEventListener('transitionend', onScroll)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      el.removeEventListener('transitionend', onScroll)
    }
  }, [ref, on])
  // Off, the last answer is ignored rather than reset: the next read after it turns back on is the truth.
  return on && stuck
}
