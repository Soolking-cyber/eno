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
// One view "counts" at most once per tab per this window — a refresh or a quick re-open
// shouldn't inflate the number. The server re-checks per (IP, listing) for 6h too.
const VIEW_TTL_MS = 6 * 60 * 60 * 1000

/**
 * ⛔ ITS OWN KEY, AND IN sessionStorage. This dedup map lived under localStorage `eno:viewed` — the
 * SAME key reco-signals.ts keeps the category/brand history in, as an ARRAY. Each writer read the
 * other's shape: `map[id] = now` on a parsed array is a property that `JSON.stringify` drops, so the
 * map never held an id and every view was "first" (measured: true on every call); and the history
 * writer's `.filter` threw on the map. So client dedup never worked and the history kept breaking.
 * ⚠️ sessionStorage because this is a counter guard, not a feature: it needs no consent only if it is
 * not a lasting record of what someone looked at. Per-tab, gone with the tab, pruned at 6h.
 */
export const VIEW_DEDUP_KEY = 'eno:view_dedup'

/** Records a tab-local view and returns true if it's the first one this window. */
export function markViewedOnce(id: string): boolean {
  try {
    const raw = sessionStorage.getItem(VIEW_DEDUP_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    const map: Record<string, number> = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, number>) : {}
    const now = Date.now()
    if (typeof map[id] === 'number' && now - map[id] < VIEW_TTL_MS) return false
    // Prune stale entries so the map can't grow without bound.
    for (const k of Object.keys(map)) if (typeof map[k] !== 'number' || now - map[k] > VIEW_TTL_MS) delete map[k]
    map[id] = now
    sessionStorage.setItem(VIEW_DEDUP_KEY, JSON.stringify(map))
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
    // Personalization signal for the "For You" rail (first-party, on-site). Both no-op
    // unless the visitor switched Personalization on (consent v2 `p`).
    recordView(categorySlug, brandSlug)
    // Remember the exact item so the buyer can re-find it ("Recently viewed").
    recordViewedListing(id)
    // Real, deduped server-side view counter (fire-and-forget — never blocks the page,
    // errors ignored). The tab-local guard above is the first dedup; the endpoint
    // re-checks per (IP, listing) and excludes the seller's own views.
    if (markViewedOnce(id)) {
      fetch(`/api/listings/${id}/view`, { method: 'POST', keepalive: true }).catch(() => {})
    }
  }, [id, title, price, currency, category, categorySlug, brandSlug])
  return null
}
