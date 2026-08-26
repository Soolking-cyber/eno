'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { usePathname } from 'next/navigation'
import { useLanguage } from '@/context/language-context'
import type { SerializedListing } from '@/lib/types'
import { hapticTap } from '@/lib/haptics'

const KEY = 'eno:favorites'
const SAVED_KEY = 'eno-saved-cache' // { idKey, list } — device-local functional cache

type FavoritesCtx = {
  ids: Set<string>
  isFavorite: (id: string) => boolean
  toggle: (id: string) => void
  count: number
  // Net saves made THIS session that aren't yet in a page's SSR savedCount, so a card's
  // displayed count updates the instant you tap the heart without double-counting your
  // own save once the server value (which now includes it) is reloaded. Reset on nav.
  savedDelta: (id: string) => number
  saved: SerializedListing[] | null // preloaded hydrated saved listings (null = loading)
  savedError: boolean // the hydrating fetch failed AND there was no cache — /saved shows retry
  retrySaved: () => void // re-run the hydrating fetch (clears savedError)
}

const FavoritesContext = createContext<FavoritesCtx | undefined>(undefined)

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<Set<string>>(new Set())
  const pathname = usePathname()
  const { lang } = useLanguage() // third-language titles come server-localized (en/vi are in the payload)

  // Per-listing net saves made in the current view (this session, this route). The
  // server savedCount already reflects saves persisted before the page loaded (they're
  // baked into the SSR base), so we only add THIS session's not-yet-in-base toggles on
  // top of the base. Reset on route change — a freshly loaded page carries a fresh base
  // that already accounts for them, so keeping the delta would double-count.
  const [optimisticSaves, setOptimisticSaves] = useState<Record<string, number>>({})
  useEffect(() => { setOptimisticSaves({}) }, [pathname])
  const savedDelta = useCallback((id: string) => optimisticSaves[id] ?? 0, [optimisticSaves])

  /**
   * ⛔ `idsHydrated` EXISTS BECAUSE /saved CONTRADICTED ITSELF. `ids` is filled HERE, in an effect,
   * so for the first client render it is empty — and the fetch effect below read that empty set as
   * "this device has saved nothing", set `saved = []`, and /saved dropped out of its loading branch
   * into the mascot "No saved listings yet" while its own heading, reading the freshly-hydrated
   * `ids.size`, said "5 saved listings". Reproduced with the listings fetch held 2.5s: the
   * contradictory pair was on screen for 12 of 16 samples.
   * ⚠️ An empty `ids` means "we have not looked yet" until this flag flips. The flag is set in a
   * `finally` so a thrown/absent localStorage (private mode, storage disabled) still releases the
   * page rather than pinning it in skeletons forever.
   */
  const [idsHydrated, setIdsHydrated] = useState(false)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) setIds(new Set(JSON.parse(raw)))
    } catch { /* ignore */ } finally { setIdsHydrated(true) }
    // keep tabs in sync
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) {
        try { setIds(new Set(JSON.parse(e.newValue || '[]'))) } catch { /* ignore */ }
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const toggle = useCallback((id: string) => {
    const added = !ids.has(id)
    setIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try { localStorage.setItem(KEY, JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
    // Optimistically move THIS session's displayed count (base + delta) so the number
    // updates the instant the heart is tapped.
    setOptimisticSaves((m) => ({ ...m, [id]: (m[id] ?? 0) + (added ? 1 : -1) }))
    // Persist the aggregate savedCount server-side (fire-and-forget — the local favorite
    // is the source of truth for the heart; this only feeds the social-proof number).
    fetch(`/api/listings/${id}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saved: added }),
      keepalive: true,
    }).catch(() => {})
    // The heart filling IS the confirmation — no toast (user decision 2026-07-06:
    // success popups only where nothing else visibly changes).
    // Touch feedback is SYMMETRIC — un-saving used to be silent, so the two directions
    // felt like different controls. Both tick; the weights differ (firmer landing in
    // Saved, lighter leaving it) so the direction is legible without looking. A tap, not
    // hapticConfirm: the heart is a cheap, repeatable gesture down a feed and a
    // success pattern on every one of them is exactly the over-firing to avoid.
    hapticTap(added ? 18 : 10)
    if (added) {
      // First save = the contextual-signup moment (5a #10). The sheet component
      // decides whether to show (guest + not shown before); we just announce.
      window.dispatchEvent(new Event('eno:first-save'))
    }
  }, [ids])

  const isFavorite = useCallback((id: string) => ids.has(id), [ids])

  // Preload the hydrated saved listings so opening /saved is instant. Cached to
  // localStorage as { idKey, list } (consent-gated); favorites are device-local
  // so no per-user scoping is needed.
  const [saved, setSaved] = useState<SerializedListing[] | null>(null)
  // Surfaced so /saved can show an error + retry instead of shimmering forever
  // when the hydrating fetch fails with no cache to fall back on.
  const [savedError, setSavedError] = useState(false)
  const [fetchTick, setFetchTick] = useState(0)
  const retrySaved = useCallback(() => { setSavedError(false); setFetchTick((t) => t + 1) }, [])
  const idKey = [...ids].sort().join(',')
  useEffect(() => {
    // ⚠️ WAIT FOR THE IDS. Before hydration an empty `idKey` is "unknown", not "none" — see
    // idsHydrated above. Returning early keeps /saved in its loading branch, which is the honest
    // state, instead of asserting the device has nothing saved.
    if (!idsHydrated) return
    if (!idKey) { setSaved([]); return }
    // Instant paint from cache (functional first-party cache of the user's own
    // saved items — works without the cookie banner).
    try {
      const c = JSON.parse(localStorage.getItem(SAVED_KEY) || 'null')
      if (c && c.idKey === idKey) setSaved(c.list)
    } catch {}
    // Debounce so rapid hearting while browsing coalesces into one request.
    let cancelled = false
    const t = setTimeout(() => {
      fetch(`/api/listings?ids=${encodeURIComponent(idKey)}${lang !== 'en' && lang !== 'vi' ? `&lang=${lang}` : ''}`)
        // A non-ok response must land in .catch — treating it as data would both
        // hide the failure AND let the self-heal below wrongly prune saved ids.
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
        .then((d) => {
          if (cancelled) return
          const list: SerializedListing[] = d.listings || []
          setSavedError(false)
          setSaved(list)
          try { localStorage.setItem(SAVED_KEY, JSON.stringify({ idKey, list })) } catch {}
          // Self-heal: drop saved ids that no longer resolve to a live listing
          // (deleted / removed), so count + badge match what's actually shown.
          // Scoped to the ids THIS request asked for, so a heart tapped while the
          // fetch was in flight isn't wrongly pruned.
          const requested = new Set(idKey.split(','))
          const returned = new Set(list.map((l) => l.id))
          setIds((prev) => {
            const next = new Set([...prev].filter((id) => !requested.has(id) || returned.has(id)))
            if (next.size === prev.size) return prev
            try { localStorage.setItem(KEY, JSON.stringify([...next])) } catch {}
            return next
          })
        })
        .catch(() => { if (!cancelled) setSavedError(true) })
    }, 400)
    return () => { cancelled = true; clearTimeout(t) }
  }, [idKey, fetchTick, lang, idsHydrated])

  const value = useMemo(() => ({ ids, isFavorite, toggle, count: ids.size, savedDelta, saved, savedError, retrySaved }), [ids, isFavorite, toggle, savedDelta, saved, savedError, retrySaved])

  return (
    <FavoritesContext.Provider value={value}>
      {children}
    </FavoritesContext.Provider>
  )
}

export function useFavorites() {
  const ctx = useContext(FavoritesContext)
  if (!ctx) throw new Error('useFavorites must be used within a FavoritesProvider')
  return ctx
}
