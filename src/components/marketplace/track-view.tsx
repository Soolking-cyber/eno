'use client'

import { useEffect, useRef } from 'react'
import { trackViewListing, type Currency } from '@/lib/analytics'
import { recordView, recordViewedListing } from '@/lib/reco-signals'

/**
 * Fires the GA4 view_item / Meta ViewContent conversion once per listing view.
 * Rendered from the (server) listing page so the data comes straight off the
 * serialized listing. A ref keyed on the id makes it idempotent under React
 * StrictMode's double-invoke and re-fires correctly on soft-nav to another listing.
 * Renders nothing.
 */
export function TrackView({ id, title, price, currency, category, categorySlug, brandSlug }: { id: string; title: string; price: number; currency: Currency; category: string; categorySlug?: string | null; brandSlug?: string | null }) {
  const fired = useRef<string | null>(null)
  useEffect(() => {
    if (fired.current === id) return
    fired.current = id
    trackViewListing({ id, title, price, currency, category })
    // Personalization signal for the "For You" rail (first-party, on-site).
    recordView(categorySlug, brandSlug)
    // Remember the exact item so the buyer can re-find it ("Recently viewed").
    recordViewedListing(id)
  }, [id, title, price, currency, category, categorySlug, brandSlug])
  return null
}
