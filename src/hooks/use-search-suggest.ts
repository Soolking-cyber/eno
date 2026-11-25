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
  /** For <Price>: the listing links out to an original posting (an imported job) — a price-0 job
   *  without one is an employer's own with the pay left negotiable. */
  linked?: boolean
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
/**
 * ⚡ ONE EMPTY ARRAY PER KIND, SHARED (phone home, 2026-11-25). The reset below runs on every mount (the header's box and the
 * explorer's both start with no query), and `setListings([])` with a NEW array is a real state change. Measured with an
 * instrumented React build: 12 updates after the hydration commit that re-rendered the header and the explorer for nothing.
 * Resetting to the same empty array is no change, so React skips it. Nothing mutates these arrays (state is replaced).
 */
const NO_LISTINGS: SuggestListing[] = []
const NO_CATEGORIES: SuggestCategory[] = []
const NO_BRANDS: SuggestBrand[] = []
const NO_LINES: SuggestLine[] = []

export function useSearchSuggest(query: string, enabled: boolean) {
  const [listings, setListings] = useState<SuggestListing[]>(NO_LISTINGS)
  const [categories, setCategories] = useState<SuggestCategory[]>(NO_CATEGORIES)
  const [brands, setBrands] = useState<SuggestBrand[]>(NO_BRANDS)
  const [lines, setLines] = useState<SuggestLine[]>(NO_LINES)
  const [scope, setScope] = useState<SuggestScope | null>(null)
  // The corrected query for a typo that suggests nothing ("iphnoe" → "iphone"), or null. Actionable like
  // `lines`/`scope`, so it is gated on `entityQ` the same way.
  const [didYouMean, setDidYouMean] = useState<string | null>(null)
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
      setListings(NO_LISTINGS); setCategories(NO_CATEGORIES); setBrands(NO_BRANDS); setLines(NO_LINES); setScope(null); setDidYouMean(null)
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
          // Additive (2026-10-04): an older cached payload has none.
          setDidYouMean(typeof d.didYouMean === 'string' && d.didYouMean ? d.didYouMean : null)
          setEntityQ(q)
          setResults({ q, listings: d.listings || [], categories: d.categories || [] }) // marks this q as fetched → clears loading
        })
        .catch(() => { /* aborted or failed — keep last results; loading stays until a fetch settles */ })
    }, 150)
    return () => { ac.abort(); clearTimeout(timer) }
  }, [q, enabled])

  const fresh = entityQ === q
  return { listings, categories, brands, lines: fresh ? lines : [], scope: fresh ? scope : null, didYouMean: fresh ? didYouMean : null, loading }
}
