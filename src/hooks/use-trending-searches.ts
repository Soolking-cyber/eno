import { useEffect, useState } from 'react'

// Shared trending-searches source for BOTH the header search panel and the landing
// hero panel (one hook → mobile + desktop behave identically). Lazily fetches
// GET /api/search/trending only while `enabled` (the empty-focus panel is open),
// cancels stale requests on toggle/unmount, and fails silently to an empty list so
// the trending row simply doesn't render when the backend is unavailable.

// Module-scoped memo so re-focusing the search (which remounts the panel) doesn't
// refetch within the window — mirrors the endpoint's own short CDN cache.
let memo: { at: number; items: string[] } | null = null
const MEMO_MS = 5 * 60 * 1000

export function useTrendingSearches(enabled: boolean): string[] {
  const [items, setItems] = useState<string[]>(() => (memo ? memo.items : []))

  useEffect(() => {
    if (!enabled) return
    if (memo && Date.now() - memo.at < MEMO_MS) {
      setItems(memo.items)
      return
    }
    const ac = new AbortController()
    fetch('/api/search/trending', { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list: string[] = Array.isArray(d?.trending) ? d.trending.filter((x: unknown): x is string => typeof x === 'string') : []
        memo = { at: Date.now(), items: list }
        setItems(list)
      })
      .catch(() => {
        /* fail-open: trending is optional, never surface an error to search */
      })
    return () => ac.abort()
  }, [enabled])

  return items
}
