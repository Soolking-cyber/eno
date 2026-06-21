'use client'

import { useEffect } from 'react'

/**
 * Forces the listing detail page to open at the very top. Client navigation from
 * the feed can land mid-page (the previous scroll position is kept), so we reset
 * on mount and whenever the listing id changes (soft-nav between two listings).
 * Renders nothing.
 */
export function ScrollToTop({ id }: { id: string }) {
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 })
  }, [id])
  return null
}
