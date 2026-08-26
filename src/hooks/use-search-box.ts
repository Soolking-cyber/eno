'use client'

// Shared search-box machinery for the two search bars (the header bar in
// marketplace/header.tsx and the landing hero bar in marketplace/listings-explorer.tsx).
// Extracted verbatim from the two previously-duplicated copies — each export is the
// piece that was byte-identical on both sides; everything the bars genuinely do
// DIFFERENTLY (panel-open conditions, Enter fallbacks, how a committed search is
// applied) stays at the call sites. The suggest fetch/debounce/abort
// (use-search-suggest), trending (use-trending-searches) and the dropdown panel
// itself (search-suggest.tsx) were already shared before this module existed.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { suggestOptionId } from '@/components/marketplace/search-suggest'
import { runVisualSearch, imageFromPaste, isUnauthorized, type VisualSearchResult } from '@/lib/visual-search'
import { RECENT_SEARCHES_KEY } from '@/lib/reco-signals'
import type { Geo } from '@/components/marketplace/area-filter'

// Recently-used areas (province/ward picks), the sibling list to RECENT_SEARCHES_KEY
// (which lives in reco-signals.ts — the dependency-leaf home shared with the reco
// reader). Written by use-explorer's useSearchHistory; read by both search panels.
export const RECENT_LOCATIONS_KEY = 'eno:recent_locations'

export type RecentLocation = { province: Geo; ward: Geo | null }

// NOTE: both readers return null (not []) when the key is absent or the stored JSON
// is corrupt, so each call site keeps its ORIGINAL fallback semantics: the header
// re-reads on every focus and resets its state with `?? []`; the explorer reads once
// on mount and only calls setState when there is something to set. Parsing is
// deliberately unvalidated — exactly what both inline copies did (the validated
// read lives in use-explorer's saveSearchToHistory, the sole writer).
export function readRecentSearches(): string[] | null {
  try {
    const h = localStorage.getItem(RECENT_SEARCHES_KEY)
    return h ? JSON.parse(h) : null
  } catch { return null }
}

export function readRecentLocations(): RecentLocation[] | null {
  try {
    const l = localStorage.getItem(RECENT_LOCATIONS_KEY)
    return l ? JSON.parse(l) : null
  } catch { return null }
}

/** Arrow-key "virtual focus" state for a search typeahead listbox: -1 = no selection
 *  (Enter then submits the RAW free-text query, never an auto-picked suggestion),
 *  any query edit resets the highlight, ArrowDown stops at the last row and ArrowUp
 *  walks back out to -1. DOM focus never leaves the input — the call sites decide
 *  when the list is open and what Enter does with the active item. */
export function useSuggestKeyboardNav(query: string) {
  const [activeIdx, setActiveIdx] = useState(-1)
  useEffect(() => { setActiveIdx(-1) }, [query])
  const moveDown = (itemCount: number) => setActiveIdx((i) => Math.min(itemCount - 1, i + 1))
  const moveUp = () => setActiveIdx((i) => Math.max(-1, i - 1))
  return { activeIdx, moveDown, moveUp }
}

/** The aria-activedescendant value for the search input. DOM focus stays in the
 *  input while the arrows move the active index, so there is no focus event to
 *  announce the highlighted row — this id IS that announcement: it points the
 *  screen reader's "virtual focus" at the option the highlight is on. Only claimed
 *  while the panel is actually the typeahead LISTBOX (`listOpen`), and
 *  bounds-checked because a dangling id would announce nothing at all, which is
 *  the exact silence it exists to fix. */
export function activeSuggestOptionId(listboxId: string, listOpen: boolean, activeIdx: number, itemCount: number): string | undefined {
  return listOpen && activeIdx >= 0 && activeIdx < itemCount
    ? suggestOptionId(listboxId, activeIdx)
    : undefined
}

/** Paste-an-image-to-search pipeline, shared by every search bar: pasted image →
 *  loading toast → recognition → onResult(r) with the derived query (each bar
 *  decides how to apply it) — or the error toast when nothing was recognized.
 *  Does nothing (and doesn't preventDefault) when the paste has no image, so text
 *  pastes flow through untouched. */
export async function visualSearchFromPaste(
  e: { clipboardData?: DataTransfer | null; preventDefault: () => void },
  tr: (en: string, vi?: string) => string,
  onResult: (r: VisualSearchResult) => void,
) {
  const f = imageFromPaste(e)
  if (!f) return
  e.preventDefault()
  /**
   * ⛔ try/finally, BECAUSE A THROW HERE LEFT "Reading your photo…" ON SCREEN FOREVER. Only the
   * happy path and the no-match path dismissed the loading toast; `runVisualSearch` awaits a
   * `fetch` and a `res.json()`, either of which rejects on a flaky network — and Sonner ignores
   * `duration` on a loading toast, so nothing else was ever going to clear it. The sibling
   * image-search-button.tsx has had this exact try/catch/finally all along; the paste path never
   * got it. The `finally` is what makes the guarantee, not the catch.
   * ⚠️ And a 401 must be SILENT here: runVisualSearch already opened the sign-in modal, so an
   * error toast about photo quality on top of it describes a problem the visitor does not have.
   */
  toast.loading(tr('Reading your photo…', 'Đang đọc ảnh…'), { id: 'vis' })
  let settled = false
  try {
    const r = await runVisualSearch(f)
    if (isUnauthorized(r)) { toast.dismiss('vis'); settled = true; return }
    if (r && 'query' in r && r.query) { toast.dismiss('vis'); settled = true; onResult(r as VisualSearchResult); return }
    toast.error(tr("Couldn't recognize the item — try a clearer photo.", 'Không nhận ra món đồ — thử ảnh rõ hơn.'), { id: 'vis' })
    settled = true
  } catch {
    toast.error(tr('Visual search failed — try again.', 'Tìm bằng ảnh thất bại — thử lại.'), { id: 'vis' })
    settled = true
  } finally {
    if (!settled) toast.dismiss('vis')
  }
}
