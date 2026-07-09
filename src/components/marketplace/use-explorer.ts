'use client'

// Extracted hooks for ListingsExplorer — cohesive, low-coupling concerns lifted out of the
// ~2100-line component to keep it readable. Each is behaviour-preserving (same effects, same
// deps): the component just calls the hook and consumes its return.

import { useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import type { Geo } from './area-filter'

/** '/' and ⌘/Ctrl+K focus the listings search input (the '/' path also opens the suggestions
 *  dropdown). One window keydown listener; ignores '/' while typing in an input/textarea. */
export function useSearchShortcuts(setShowSuggestions: (v: boolean) => void) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault()
        const input = document.getElementById('listings-search-input') as HTMLInputElement | null
        if (input) {
          input.focus()
          setShowSuggestions(true)
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        document.getElementById('listings-search-input')?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

/** Recent searches + recently-used areas (province/ward), persisted to localStorage. Reads the
 *  currently-applied area to remember it; returns the lists + setters (the "Clear" buttons) +
 *  saveSearchToHistory (called from the feed-sync / landing-search / visual-search paths). */
export function useSearchHistory(activeProvince: Geo | null, activeWard: Geo | null) {
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const [recentLocations, setRecentLocations] = useState<{ province: Geo; ward: Geo | null }[]>([])

  // Load search + location history from localStorage on mount.
  useEffect(() => {
    try {
      const h = localStorage.getItem('eno:recent_searches')
      if (h) setRecentSearches(JSON.parse(h))
    } catch (_) {}
    try {
      const l = localStorage.getItem('eno:recent_locations')
      if (l) setRecentLocations(JSON.parse(l))
    } catch (_) {}
  }, [])

  // Remember the user's applied areas (province/ward) for quick re-select.
  useEffect(() => {
    if (!activeProvince) return
    const entry = { province: activeProvince, ward: activeWard }
    setRecentLocations((prev) => {
      const key = (e: typeof entry) => `${e.province.code}:${e.ward?.code ?? ''}`
      const next = [entry, ...prev.filter((e) => key(e) !== key(entry))].slice(0, 6)
      try { localStorage.setItem('eno:recent_locations', JSON.stringify(next)) } catch (_) {}
      return next
    })
  }, [activeProvince?.code, activeWard?.code])

  // Persist a committed search term (corrupt/legacy storage must never throw here).
  const saveSearchToHistory = useCallback((searchTerm: string) => {
    const trimmed = searchTerm.trim()
    if (!trimmed || trimmed.length < 2) return
    let list: string[] = []
    try {
      const parsed = JSON.parse(localStorage.getItem('eno:recent_searches') || '[]')
      if (Array.isArray(parsed)) list = parsed.filter((x): x is string => typeof x === 'string')
    } catch { /* reset on corrupt */ }
    list = [trimmed, ...list.filter((item) => item !== trimmed)].slice(0, 5)
    try { localStorage.setItem('eno:recent_searches', JSON.stringify(list)) } catch {}
    setRecentSearches(list)
  }, [])

  return { recentSearches, recentLocations, setRecentSearches, setRecentLocations, saveSearchToHistory }
}

/** Save the current filter set as a Saved Search (buyer gets alerted on new matches). Reads a
 *  read-only filter bag; writes ZERO component state — network + toast + openSignIn only. */
export function useSaveSearch(filters: {
  activeCategory: string
  activeSubcategory: string
  activeBrand: string
  activeModel: string
  listingType: string
  debouncedQuery: string
  activeDistrict: string
  conditionFilter: string
  priceRange: string
  customFilters: Record<string, string>
}) {
  const { tr } = useLanguage()
  const { openSignIn } = useAuth()
  const savingSearch = useRef(false)
  const {
    activeCategory, activeSubcategory, activeBrand, activeModel, listingType,
    debouncedQuery, activeDistrict, conditionFilter, priceRange, customFilters,
  } = filters
  return useCallback(async () => {
    if (savingSearch.current) return // block double-tap → duplicate rows → duplicate cron alerts
    savingSearch.current = true
    const [mn, mx] = priceRange !== 'all' ? priceRange.split('-') : ['', '']
    const params = {
      category: activeCategory !== 'all' ? activeCategory : undefined,
      subcategory: activeSubcategory !== 'all' ? activeSubcategory : undefined,
      brand: activeBrand !== 'all' ? activeBrand : undefined,
      model: activeBrand !== 'all' && activeModel !== 'all' ? activeModel : undefined,
      listingType: listingType !== 'all' ? listingType : undefined,
      q: debouncedQuery.trim() || undefined,
      district: activeDistrict !== 'all' ? activeDistrict : undefined,
      condition: conditionFilter !== 'all' ? conditionFilter : undefined,
      priceMin: mn ? Number(mn) : undefined,
      priceMax: mx ? Number(mx) : undefined,
      attrs: Object.keys(customFilters).length ? customFilters : undefined,
    }
    try {
      const res = await fetch('/api/saved-searches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ params }) })
      if (res.status === 401) { openSignIn(); return }
      if (res.status === 409) { toast.error(tr("You've reached the saved-search limit", 'Bạn đã đạt giới hạn tìm kiếm đã lưu')); return }
      if (!res.ok) throw new Error()
      toast.success(tr("Saved — we'll alert you on new matches", 'Đã lưu — sẽ báo khi có tin mới phù hợp'))
    } catch { toast.error(tr('Could not save search', 'Không thể lưu tìm kiếm')) }
    finally { savingSearch.current = false }
  }, [activeCategory, activeSubcategory, activeBrand, activeModel, listingType, debouncedQuery, activeDistrict, conditionFilter, priceRange, customFilters, tr, openSignIn])
}
