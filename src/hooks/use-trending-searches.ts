import { useEffect, useState } from 'react'

// Shared trending-searches source for BOTH the header search panel and the landing
// hero panel (one hook → mobile + desktop behave identically). Lazily fetches
// GET /api/search/trending only while `enabled` (the empty-focus panel is open),
// cancels stale requests on toggle/unmount, and fails silently to an empty list so
// the trending row simply doesn't render when the backend is unavailable.

/** A category shortcut for the empty-focus panel — the most-wanted categories with live listings. */
export type TrendingCategory = { slug: string; name: string; nameVi: string }
export type TrendingPanel = { items: string[]; categories: TrendingCategory[] }

const EMPTY: TrendingPanel = { items: [], categories: [] }

// Module-scoped memo so re-focusing the search (which remounts the panel) doesn't
// refetch within the window — mirrors the endpoint's own short CDN cache. It holds BOTH
// halves of the response, so the terms and the category shortcuts arrive and expire together.
let memo: ({ at: number } & TrendingPanel) | null = null
const MEMO_MS = 5 * 60 * 1000

const isCategory = (x: unknown): x is TrendingCategory =>
  !!x && typeof x === 'object' &&
  typeof (x as TrendingCategory).slug === 'string' && typeof (x as TrendingCategory).name === 'string' && typeof (x as TrendingCategory).nameVi === 'string'

/**
 * The empty-focus panel's data: trending terms (`items`) and category shortcuts (`categories`,
 * S-TYPEAHEAD 2026-09-29 — a first visit has no history and trending needs three distinct searchers
 * before it shows a term, so the panel was often a single chip or nothing).
 * ⚠️ `categories` IS ADDITIVE ON THE WIRE: an older cached response has none and reads as [].
 */
export function useTrendingPanel(enabled: boolean): TrendingPanel {
  const [panel, setPanel] = useState<TrendingPanel>(() => memo ?? EMPTY)

  useEffect(() => {
    if (!enabled) return
    if (memo && Date.now() - memo.at < MEMO_MS) {
      setPanel(memo)
      return
    }
    const ac = new AbortController()
    fetch('/api/search/trending', { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const items: string[] = Array.isArray(d?.trending) ? d.trending.filter((x: unknown): x is string => typeof x === 'string') : []
        const categories: TrendingCategory[] = Array.isArray(d?.categories) ? d.categories.filter(isCategory) : []
        memo = { at: Date.now(), items, categories }
        setPanel(memo)
      })
      .catch(() => {
        /* fail-open: trending is optional, never surface an error to search */
      })
    return () => ac.abort()
  }, [enabled])

  return panel
}

/**
 * The trending terms alone — the hero panel's original contract (listings-explorer.tsx), unchanged:
 * same fetch, same memo, same `string[]`.
 */
export function useTrendingSearches(enabled: boolean): string[] {
  return useTrendingPanel(enabled).items
}
