'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { SerializedListing } from '@/lib/types'
import { useLanguage } from '@/context/language-context'
import { haptic } from '@/lib/haptics'

const KEY = 'eno:favorites'
const SAVED_KEY = 'eno-saved-cache' // { idKey, list } — device-local functional cache

type FavoritesCtx = {
  ids: Set<string>
  isFavorite: (id: string) => boolean
  toggle: (id: string) => void
  count: number
  saved: SerializedListing[] | null // preloaded hydrated saved listings (null = loading)
  savedError: boolean // the hydrating fetch failed AND there was no cache — /saved shows retry
  retrySaved: () => void // re-run the hydrating fetch (clears savedError)
}

const FavoritesContext = createContext<FavoritesCtx | undefined>(undefined)

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<Set<string>>(new Set())
  const router = useRouter()
  const { tr } = useLanguage()

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) setIds(new Set(JSON.parse(raw)))
    } catch { /* ignore */ }
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
    // Favorites are device-local, so "did it save? where?" is genuinely ambiguous —
    // confirm on ADD only, with a jump to /saved. A shared toast id means rapid
    // hearting replaces rather than stacks.
    if (added) {
      haptic()
      // First save = the contextual-signup moment (5a #10). The sheet component
      // decides whether to show (guest + not shown before); we just announce.
      window.dispatchEvent(new Event('eno:first-save'))
      toast(tr('Saved on this device', 'Đã lưu trên thiết bị này'), {
        id: 'fav-saved',
        action: { label: tr('View', 'Xem'), onClick: () => router.push('/saved') },
      })
    }
  }, [ids, tr, router])

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
      fetch(`/api/listings?ids=${encodeURIComponent(idKey)}`)
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
  }, [idKey, fetchTick])

  const value = useMemo(() => ({ ids, isFavorite, toggle, count: ids.size, saved, savedError, retrySaved }), [ids, isFavorite, toggle, saved, savedError, retrySaved])

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
