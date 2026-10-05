'use client'

// Extracted hooks for ListingsExplorer — cohesive, low-coupling concerns lifted out of the
// ~2100-line component to keep it readable. Each is behaviour-preserving (same effects, same
// deps): the component just calls the hook and consumes its return.

import { createElement, useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { Button } from '@/components/ui/button'
import {
  addressResumeKind,
  decideResume,
  pathnameOf,
  readIntent,
  stripResumeFromAddress,
  takeIntent,
  writeIntent,
  type IntentPayload,
} from '@/lib/pending-intent'
import type { Geo } from './area-filter'
import { readRecentSearches, readRecentLocations, RECENT_LOCATIONS_KEY, type RecentLocation } from '@/hooks/use-search-box'
import { RECENT_SEARCHES_KEY } from '@/lib/reco-signals'

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
  }, [setShowSuggestions])
}

/** Recent searches + recently-used areas (province/ward), persisted to localStorage. Reads the
 *  currently-applied area to remember it; returns the lists + setters (the "Clear" buttons) +
 *  saveSearchToHistory (called from the feed-sync / landing-search / visual-search paths). */
export function useSearchHistory(activeProvince: Geo | null, activeWard: Geo | null) {
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const [recentLocations, setRecentLocations] = useState<RecentLocation[]>([])

  // Load search + location history from localStorage on mount (shared readers return
  // null on absent/corrupt storage, so state is only touched when there IS history).
  useEffect(() => {
    const h = readRecentSearches()
    if (h) setRecentSearches(h)
    const l = readRecentLocations()
    if (l) setRecentLocations(l)
  }, [])

  // Remember the user's applied areas (province/ward) for quick re-select.
  useEffect(() => {
    if (!activeProvince) return
    const entry = { province: activeProvince, ward: activeWard }
    setRecentLocations((prev) => {
      const key = (e: typeof entry) => `${e.province.code}:${e.ward?.code ?? ''}`
      const next = [entry, ...prev.filter((e) => key(e) !== key(entry))].slice(0, 6)
      try { localStorage.setItem(RECENT_LOCATIONS_KEY, JSON.stringify(next)) } catch (_) {}
      return next
    })
  }, [activeProvince?.code, activeWard?.code])

  // Persist a committed search term (corrupt/legacy storage must never throw here).
  const saveSearchToHistory = useCallback((searchTerm: string) => {
    const trimmed = searchTerm.trim()
    if (!trimmed || trimmed.length < 2) return
    let list: string[] = []
    try {
      const parsed = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || '[]')
      if (Array.isArray(parsed)) list = parsed.filter((x): x is string => typeof x === 'string')
    } catch { /* reset on corrupt */ }
    list = [trimmed, ...list.filter((item) => item !== trimmed)].slice(0, 5)
    try { localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list)) } catch {}
    setRecentSearches(list)
  }, [])

  return { recentSearches, recentLocations, setRecentSearches, setRecentLocations, saveSearchToHistory }
}

/** The explorer's filter bag, as the saved-search flow reads it. */
export type SaveSearchFilters = {
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
}

/** What a save sends as `params` — `undefined` for every axis at its default (the POST body below). */
export function saveSearchParams(f: SaveSearchFilters) {
  const [mn, mx] = f.priceRange !== 'all' ? f.priceRange.split('-') : ['', '']
  return {
    category: f.activeCategory !== 'all' ? f.activeCategory : undefined,
    subcategory: f.activeSubcategory !== 'all' ? f.activeSubcategory : undefined,
    brand: f.activeBrand !== 'all' ? f.activeBrand : undefined,
    model: f.activeBrand !== 'all' && f.activeModel !== 'all' ? f.activeModel : undefined,
    listingType: f.listingType !== 'all' ? f.listingType : undefined,
    q: f.debouncedQuery.trim() || undefined,
    district: f.activeDistrict !== 'all' ? f.activeDistrict : undefined,
    condition: f.conditionFilter !== 'all' ? f.conditionFilter : undefined,
    priceMin: mn ? Number(mn) : undefined,
    priceMax: mx ? Number(mx) : undefined,
    attrs: Object.keys(f.customFilters).length ? f.customFilters : undefined,
  }
}

/**
 * Would a save carry ANY search? (UX3 JOIN-SAVE.) The phone's "Save search" pill shows from the FIRST query
 * or filter — but only one the saved search can keep. ⚠️ The province, ward and near-you circle are not part
 * of a saved search (src/lib/saved-search.ts), so an area alone offers nothing: saving it would save "All
 * listings" and alert on every new one.
 */
export function hasSavableSearch(f: SaveSearchFilters): boolean {
  return Object.values(saveSearchParams(f)).some((v) => v !== undefined)
}

/** Save the current filter set as a Saved Search (buyer gets alerted on new matches). Reads a
 *  read-only filter bag; writes ZERO component state — network + toast + openSignIn only.
 *
 *  ⛔ UX3 J5 (2026-10-05) — A GUEST'S SAVE IS FINISHED AFTER SIGN-IN. The 401 used to open sign-in and
 *  forget the search; the visitor came back (after Google, after /onboard) to an unsaved search and had
 *  to find the button again. Now the 401 writes the search as a pending intent (src/lib/pending-intent.ts
 *  — the rental check's resume pattern, shared) and this hook saves THOSE params once the user and their
 *  profile are loaded, through this same `post` — the existing save, not a second one (the phone's
 *  save-search pill (JOIN-SAVE) calls the function this returns, and inherits all of it). A `resume=` with
 *  nothing trusted behind it (a crafted link, a magic link's new tab) only offers one tap: "Save". */
export function useSaveSearch(filters: SaveSearchFilters) {
  const { tr } = useLanguage()
  const { user, loading, identityLoaded, accountType, openSignIn } = useAuth()
  const savingSearch = useRef(false)

  /** POST one saved search — the one save, for the button and for the resume alike. */
  const post = useCallback(async (params: Record<string, unknown>) => {
    if (savingSearch.current) return // block double-tap → duplicate rows → duplicate cron alerts
    savingSearch.current = true
    try {
      const res = await fetch('/api/saved-searches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ params }) })
      if (res.status === 401) {
        // UX3 J5: remember exactly what was asked for — finished after sign-in (see the resume below).
        const it = writeIntent('saveSearch', { params }, `${window.location.pathname}${window.location.search}`)
        openSignIn({ note: tr('Sign in to get alerts when new listings match this search.', 'Đăng nhập để nhận thông báo khi có tin mới khớp với tìm kiếm này.'), gate: 'save_search', resume: it })
        return
      }
      if (res.status === 409) { toast.error(tr("You've reached the saved-search limit", 'Bạn đã đạt giới hạn tìm kiếm đã lưu')); return }
      if (!res.ok) throw new Error()
      toast.success(tr("Saved — we'll alert you on new matches", 'Đã lưu — sẽ báo khi có tin mới phù hợp'))
    } catch { toast.error(tr('Could not save search', 'Không thể lưu tìm kiếm')) }
    finally { savingSearch.current = false }
  }, [tr, openSignIn])

  const save = useCallback(async () => {
    // JSON drops the undefined fields exactly as the body always has; the stored intent keeps the same shape.
    await post(JSON.parse(JSON.stringify(saveSearchParams(filters))) as Record<string, unknown>)
    // Keyed on the fields, not the bag's identity (a new object every render).
  }, [filters.activeCategory, filters.activeSubcategory, filters.activeBrand, filters.activeModel, filters.listingType, filters.debouncedQuery, filters.activeDistrict, filters.conditionFilter, filters.priceRange, filters.customFilters, post])

  // The latest closures, for the resume — which runs once, from an effect keyed on auth alone.
  const postRef = useRef(post)
  const saveRef = useRef(save)
  useEffect(() => { postRef.current = post; saveRef.current = save })

  /**
   * THE RESUME, ONCE PER PAGE LIFE — the rental check's rule: only once the user AND their profile are
   * loaded (a new account is sent to /onboard first; saving before that would race the redirect).
   *   act     — a fresh intent for THIS page, proven by `resume=saveSearch` in the address (a sign-in
   *             return in this tab) or by a sign-in inside its own popup: save the params it holds;
   *   confirm — `resume=saveSearch` with nothing trusted behind it: one tap, "Save" (the search on screen);
   *   a guest who lands on a `resume=` link: the marker is just removed.
   */
  const resumeRan = useRef(false)
  useEffect(() => {
    if (resumeRan.current || loading) return
    const urlKind = addressResumeKind()
    if (!user) {
      if (urlKind === 'saveSearch') stripResumeFromAddress()
      return
    }
    if (!identityLoaded || !accountType) return
    const d = decideResume({
      urlKind,
      intent: readIntent(),
      kinds: ['saveSearch'],
      matches: (it) => pathnameOf(it.path) === window.location.pathname,
    })
    if (d.action === 'none') return
    resumeRan.current = true
    stripResumeFromAddress()
    if (d.action === 'act') {
      if (takeIntent(d.intent.nonce)) void postRef.current((d.intent.payload as IntentPayload['saveSearch']).params)
      return
    }
    // ⚠️ A real <Button> in the toast, not sonner's 24px `{ label, onClick }` — the use-undo-window recipe:
    // `tap-44` for a 44px hit area, `relative` to keep the pseudo on it, and the click closes the toast.
    const id = toast(tr('You’re signed in — save this search to get alerts on new listings?', 'Bạn đã đăng nhập — lưu tìm kiếm này để nhận thông báo khi có tin mới?'), {
      duration: 15_000,
      action: createElement(Button, {
        type: 'button',
        variant: 'outline',
        size: 'sm',
        className: 'relative ml-auto font-bold tap-44',
        onClick: () => { toast.dismiss(id); void saveRef.current() },
      }, tr('Save', 'Lưu')),
    })
  }, [user, loading, identityLoaded, accountType, tr])

  return save
}
