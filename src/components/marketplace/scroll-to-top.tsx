'use client'

import { useEffect } from 'react'

/**
 * Forces a page to open at the very top. Client navigation can land mid-page
 * (previous scroll kept — especially into routes with a loading.tsx Suspense
 * boundary), so we reset on mount and whenever `id` changes (soft-nav between
 * two listings). Renders nothing. Replaces the near-identical ScrollTop.
 */
export function ScrollToTop({ id }: { id?: string } = {}) {
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 })
  }, [id])
  return null
}
