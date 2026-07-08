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
// One view "counts" at most once per device per this window — a refresh or a quick
// re-open shouldn't inflate the number. The server re-checks per (IP, listing) too.
const VIEW_TTL_MS = 6 * 60 * 60 * 1000

/** Records a device-local view and returns true if it's the first one this window. */
function markViewedOnce(id: string): boolean {
  try {
    const raw = localStorage.getItem('eno:viewed')
    const map: Record<string, number> = raw ? JSON.parse(raw) : {}
    const now = Date.now()
    if (map[id] && now - map[id] < VIEW_TTL_MS) return false
    // Prune stale entries so the map can't grow without bound.
    for (const k of Object.keys(map)) if (now - map[k] > VIEW_TTL_MS) delete map[k]
    map[id] = now
    localStorage.setItem('eno:viewed', JSON.stringify(map))
    return true
  } catch {
    return true // storage blocked (private mode) → let the server dedup by IP
  }
}

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
    // Real, deduped server-side view counter (fire-and-forget — never blocks the page,
    // errors ignored). Client localStorage guard is the primary dedup; the endpoint
    // re-checks per (IP, listing) and excludes the seller's own views.
    if (markViewedOnce(id)) {
      fetch(`/api/listings/${id}/view`, { method: 'POST', keepalive: true }).catch(() => {})
    }
  }, [id, title, price, currency, category, categorySlug, brandSlug])
  return null
}
