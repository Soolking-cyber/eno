'use client'

import { useEffect, useState } from 'react'

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
  const q = query.trim()
  // Derive loading so it's true on the SAME render the query first qualifies —
  // avoids a one-paint "No matches yet" flash before the effect/fetch starts.
  const [results, setResults] = useState<{ q: string; listings: SuggestListing[]; categories: SuggestCategory[] }>({ q: '', listings: [], categories: [] })
  const loading = enabled && q.length >= 2 && results.q !== q

  useEffect(() => {
    if (!enabled || q.length < 2) {
      setListings([]); setCategories([])
      return
    }
    const ac = new AbortController()
    const timer = setTimeout(() => {
      fetch(`/api/search/suggest?q=${encodeURIComponent(q)}`, { signal: ac.signal })
        .then((r) => r.json())
        .then((d) => {
          setListings(d.listings || [])
          setCategories(d.categories || [])
          setResults({ q, listings: d.listings || [], categories: d.categories || [] }) // marks this q as fetched → clears loading
        })
        .catch(() => { /* aborted or failed — keep last results; loading stays until a fetch settles */ })
    }, 150)
    return () => { ac.abort(); clearTimeout(timer) }
  }, [q, enabled])

  return { listings, categories, loading }
}
