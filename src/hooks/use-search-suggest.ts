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
  categorySlug: string
}
export type SuggestCategory = { slug: string; name: string; nameVi: string }
export type SuggestBrand = { slug: string; name: string }

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
      setListings([]); setCategories([]); setBrands([])
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
          setResults({ q, listings: d.listings || [], categories: d.categories || [] }) // marks this q as fetched → clears loading
        })
        .catch(() => { /* aborted or failed — keep last results; loading stays until a fetch settles */ })
    }, 150)
    return () => { ac.abort(); clearTimeout(timer) }
  }, [q, enabled])

  return { listings, categories, brands, loading }
}
