'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { usePathname } from 'next/navigation'
import { useLanguage } from '@/context/language-context'
import type { SerializedListing } from '@/lib/types'
import { hapticTap } from '@/lib/haptics'
import { chunkListingIds } from '@/lib/listing-ids'

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
  // The hydrating fetch did not fully succeed: either every request failed (with `saved` still
  // null, so /saved shows its retry state) or some of them did, in which case `saved` holds the
  // listings that DID load and /saved shows a retry banner above them. Never silently partial.
  savedError: boolean
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
      const requested = idKey.split(',')
      const langQuery = lang !== 'en' && lang !== 'vi' ? `&lang=${lang}` : ''
      // ⛔ CHUNKED, BECAUSE ONE REQUEST ANSWERS AT MOST IDS_FAST_PATH_MAX IDS. Sending all of
      // them in one go did not fail — it returned 200 with the surplus quietly dropped, and the
      // self-heal below then deleted every dropped id from the device. A device with 201 saved
      // listings lost the 201st on its next visit to /saved, permanently and invisibly.
      const chunks = chunkListingIds(requested)
      Promise.all(
        chunks.map((chunk) =>
          fetch(`/api/listings?ids=${encodeURIComponent(chunk.join(','))}${langQuery}`)
            // A non-ok response must NOT be read as data — that would both hide the failure and
            // let the self-heal treat an outage as "all your saved listings were deleted".
            .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
            .then((d) => ({
              listings: (d?.listings || []) as SerializedListing[],
              // ⚠️ ONLY THE SERVER SAYS WHAT WAS EVALUATED, AND ITS ABSENCE MEANS "NOTHING". A
              // response from an older revision (a rolling deploy, a cached body) carries no
              // `evaluated`, so this falls back to an empty list and the pass below prunes
              // nothing at all. Failing closed here costs a stale heart; failing open costs the
              // user their saved items.
              evaluated: Array.isArray(d?.evaluated) ? (d.evaluated as string[]) : [],
            }))
            .catch(() => null),
        ),
      ).then((results) => {
        if (cancelled) return
        const ok = results.filter((r): r is NonNullable<typeof r> => !!r)
        // Every chunk failed — say so and change nothing. `saved` stays null on a first load, so
        // /saved shows its retry state instead of an empty grid that reads as "you saved nothing".
        if (ok.length === 0) { setSavedError(true); return }

        const byId = new Map<string, SerializedListing>()
        for (const r of ok) for (const l of r.listings) byId.set(l.id, l)
        const list = requested
          .map((id) => byId.get(id))
          .filter((l): l is SerializedListing => !!l)

        const complete = ok.length === results.length
        setSavedError(!complete)
        setSaved(list)
        // ⚠️ CACHE ONLY A COMPLETE ANSWER. The cache is keyed by idKey and read back as the whole
        // set, so storing a partial merge would present a chunk failure as a shrunken library on
        // every later load — including offline ones.
        if (complete) { try { localStorage.setItem(SAVED_KEY, JSON.stringify({ idKey, list })) } catch {} }

        // Self-heal: drop saved ids that no longer resolve to a live listing (deleted / removed),
        // so count + badge match what's actually shown.
        // ⛔ SCOPED TO WHAT THE SERVER SAID IT EVALUATED — never to what this client asked for. An
        // id can be missing from `listings` for three different reasons: it is gone, it was never
        // looked at (past the per-request cap), or its chunk failed. Only the first is a deletion,
        // and `evaluated` is the only thing that tells them apart. It also still excludes a heart
        // tapped while the fetch was in flight, since that id was never sent.
        const evaluated = new Set(ok.flatMap((r) => r.evaluated))
        if (evaluated.size === 0) return
        setIds((prev) => {
          const next = new Set([...prev].filter((id) => !evaluated.has(id) || byId.has(id)))
          if (next.size === prev.size) return prev
          try { localStorage.setItem(KEY, JSON.stringify([...next])) } catch {}
          return next
        })
      })
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
