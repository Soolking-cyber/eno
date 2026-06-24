'use client'

import { useEffect } from 'react'

// Force the window to the top on mount. Next's scroll-to-top doesn't reliably
// fire when navigating into a route that has a loading.tsx (the Suspense
// boundary), so a deep-scrolled page would open the new page mid-scroll. Drop
// this at the top of such a page (and its loading skeleton) to guarantee the
// top. Renders nothing.
export function ScrollTop() {
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])
  return null
}
