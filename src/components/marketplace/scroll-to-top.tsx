'use client'

import { useEffect, useRef, useSyncExternalStore } from 'react'

/** A store that never changes, read only to tell the hydration render from a client render. */
const subscribeNothing = () => () => {}

/**
 * Forces a page to open at the very top. Client navigation can land mid-page
 * (previous scroll kept — especially into routes with a loading.tsx Suspense
 * boundary), so we reset on mount and whenever `id` changes (soft-nav between
 * two listings). Renders nothing. Replaces the near-identical ScrollTop.
 *
 * ⛔ NEVER ON THE MOUNT THAT HYDRATES A PAGE THE BROWSER LOADED (SEO wave B, P0t). There the browser
 * already opened the page at the top, or at its #hash, or where a reload left it, and any scroll since
 * is the reader's own. On a slow phone there is time to scroll: measured on a production build at 6x
 * CPU, the listing's server HTML is on screen ~1.2s in and hydrates ~2.7s in, and this reset then threw
 * a reader who had scrolled down to the reports-and-disputes row back to the top. A tap already on its
 * way to the row opened the photo gallery instead: the touch hit the row, the reset ran, and the click
 * that followed was hit-tested at the top of the page (3 runs of 3). After the reset the row was off
 * screen (its top at 1058px in an 844px window), so the reader had to find it and tap again.
 * `useSyncExternalStore` is false only in the render that hydrates server HTML, so a soft navigation,
 * which mounts on the client, still resets, and so does a change of `id` after hydration.
 * ⚠️ UNTIL SEO WAVE B, H1a (2026-09-28) A HARD LOAD COULD ALSO MOUNT THIS ON THE CLIENT: the listing
 * body was streamed into a hidden container by the segment's `loading.tsx`, and on a fast load React
 * sometimes rendered it on the client instead of revealing that copy (4 of 6 runs at 1x CPU; 0 of 12
 * at 2x-6x). It reset there, ~0.4s in, before any of the body had been on screen. H1a deleted that
 * file, so the body arrives in place in the server HTML and hydrates where it is, at every speed.
 */
export function ScrollToTop({ id }: { id?: string } = {}) {
  const clientRender = useSyncExternalStore(subscribeNothing, () => true, () => false)
  // True only for a component that hydrated server HTML, until its first effect has run.
  const hydrated = useRef(!clientRender)
  useEffect(() => {
    if (hydrated.current) {
      hydrated.current = false
      return
    }
    window.scrollTo({ top: 0, left: 0 })
  }, [id])
  return null
}
