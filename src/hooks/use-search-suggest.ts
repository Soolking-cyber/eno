'use client'

import { useEffect, useState } from 'react'
import { normalizeQuery, queryLength, INSTANT_MIN_CHARS } from '@/lib/search-panel'

export type SuggestListing = {
  id: string
  title: string
  titleVi: string | null
  price: number
  currency: string
  priceUnit: string
  location: string
  image: string | null
  /** For <Price>: a price-0 job reads "Salary: see details", not "Free". */
  listingType?: string
  categorySlug: string
}
export type SuggestCategory = { slug: string; name: string; nameVi: string }
export type SuggestBrand = { slug: string; name: string }
/**
 * A product line ("iPhone · Apple") with the count its link returns. `category` is where most of the
 * line lives; the link carries it as the explorer's category boost, which does not narrow the count
 * (api/search/suggest/suggest-entities.ts).
 */
export type SuggestLine = { brand: string; brandName: string; line: string; category: string; count: number }
/** The aisle most of the query's matches live in ("“sofa” in Home › Sofa"), with its count. */
export type SuggestScope = {
  category: string
  subcategory: string
  categoryName: string
  categoryNameVi: string
  subName: string
  subNameVi: string
  count: number
}

/**
 * Instant-match suggestions for the search bars. Debounced (~150ms) so it fires
 * once typing settles, with the in-flight request aborted on every keystroke so
 * stale responses can never overwrite fresh ones. Returns nothing until `enabled`
 * (the bar is focused) and the query is ≥2 chars. Shared by the header + hero
 * search so both behave identically on mobile and desktop.
 */
export function useSearchSuggest(query: string, enabled: boolean) {
  const [listings, setListings] = useState<SuggestListing[]>([])
  const [categories, setCategories] = useState<SuggestCategory[]>([])
  const [brands, setBrands] = useState<SuggestBrand[]>([])
  const [lines, setLines] = useState<SuggestLine[]>([])
  const [scope, setScope] = useState<SuggestScope | null>(null)
  // The query `lines`/`scope` answered. They are ACTIONABLE rows ("Search in Sofas"), so unlike the listing
  // previews they are never shown for a different query — not during the debounce, not after a failed fetch
  // (gate 2026-09-30: typing "iphone" after "sofa" offered the Sofa scope).
  const [entityQ, setEntityQ] = useState('')
  // ⚠️ THE SAME MEASUREMENT AND THE SAME CONSTANT AS THE PANEL (lib/search-panel.ts). This gate is
  // the twin of `instantOpen`, so measuring differently is how the two drift apart: a decomposed
  // Vietnamese `ế` is 3 UTF-16 units, which fired this fetch at one visible character while the
  // panel was still showing history. Both the FUNCTION and the CONSTANT are imported — a hand-
  // rolled copy of either is identical today and enforced by nothing tomorrow.
  const q = normalizeQuery(query)
  // Derive loading so it's true on the SAME render the query first qualifies —
  // avoids a one-paint "No matches yet" flash before the effect/fetch starts.
  const [results, setResults] = useState<{ q: string; listings: SuggestListing[]; categories: SuggestCategory[] }>({ q: '', listings: [], categories: [] })
  const loading = enabled && queryLength(q) >= INSTANT_MIN_CHARS && results.q !== q

  useEffect(() => {
    if (!enabled || queryLength(q) < INSTANT_MIN_CHARS) {
      setListings([]); setCategories([]); setBrands([]); setLines([]); setScope(null)
      return
    }
    const ac = new AbortController()
    const timer = setTimeout(() => {
      fetch(`/api/search/suggest?q=${encodeURIComponent(q)}`, { signal: ac.signal })
        .then((r) => r.json())
        .then((d) => {
          setListings(d.listings || [])
          setCategories(d.categories || [])
          setBrands(d.brands || [])
          // Additive fields (2026-09-29): an older cached payload has neither, and reads as none.
          setLines(Array.isArray(d.lines) ? d.lines : [])
          setScope(d.scope && typeof d.scope === 'object' ? d.scope : null)
          setEntityQ(q)
          setResults({ q, listings: d.listings || [], categories: d.categories || [] }) // marks this q as fetched → clears loading
        })
        .catch(() => { /* aborted or failed — keep last results; loading stays until a fetch settles */ })
    }, 150)
    return () => { ac.abort(); clearTimeout(timer) }
  }, [q, enabled])

  const fresh = entityQ === q
  return { listings, categories, brands, lines: fresh ? lines : [], scope: fresh ? scope : null, loading }
}
