'use client'

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'

const KEY = 'eno:favorites'

type FavoritesCtx = {
  ids: Set<string>
  isFavorite: (id: string) => boolean
  toggle: (id: string) => void
  count: number
}

const FavoritesContext = createContext<FavoritesCtx | undefined>(undefined)

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<Set<string>>(new Set())

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
    setIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try { localStorage.setItem(KEY, JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }, [])

  const isFavorite = useCallback((id: string) => ids.has(id), [ids])

  return (
    <FavoritesContext.Provider value={{ ids, isFavorite, toggle, count: ids.size }}>
      {children}
    </FavoritesContext.Provider>
  )
}

export function useFavorites() {
  const ctx = useContext(FavoritesContext)
  if (!ctx) throw new Error('useFavorites must be used within a FavoritesProvider')
  return ctx
}
