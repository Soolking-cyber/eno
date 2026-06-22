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
  const [loading, setLoading] = useState(false)
  const q = query.trim()

  useEffect(() => {
    if (!enabled || q.length < 2) {
      setListings([]); setCategories([]); setLoading(false)
      return
    }
    const ac = new AbortController()
    setLoading(true)
    const timer = setTimeout(() => {
      fetch(`/api/search/suggest?q=${encodeURIComponent(q)}`, { signal: ac.signal })
        .then((r) => r.json())
        .then((d) => { setListings(d.listings || []); setCategories(d.categories || []); setLoading(false) })
        .catch(() => { /* aborted or failed — keep last results, drop the spinner on the next run */ })
    }, 150)
    return () => { ac.abort(); clearTimeout(timer) }
  }, [q, enabled])

  return { listings, categories, loading }
}
