'use client'

import { fillTemplate } from '@/lib/i18n/placeholders'
import { getTrSnapshot, subscribeTr } from '@/lib/i18n/mt-client'
import { Fragment, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, type CSSProperties } from 'react'
import Image from 'next/image'
// Only the glyphs this file actually renders — the vestigial hero-search set
// (Search/MapPin/Phone/Sliders/Map/TrendingUp) died with the hero bar and was
// still being imported (icon-gauntlet cleanup, 2026-08-06).
import { Inbox, AlertTriangle, X, Clock, Bookmark } from '@/components/ui/icons'
import { toast } from 'sonner'
import type { SerializedListingCard, SerializedCategory, BuildingPin } from '@/lib/types'
import { categoryHasMap, mapPinRows } from './map-pin-rows'
// ⚠️ TYPE-ONLY, AND IT MUST STAY THAT WAY. src/lib/facet-counts.ts is `server-only` and pulls the
// Prisma chain; a value import here would drag it into the client bundle (or fail the build).
// `import type` is erased at compile, so this costs nothing at runtime.
import type { FacetCounts } from '@/lib/facet-counts'
import { CATEGORY_COLOR_CLASSES, timeAgo } from '@/lib/types'
import { IS_MARKETPLACE, SITE_NAME } from '@/lib/edition'
import { CategoryIcon } from './category-icons'
import { CategoryTileGlyph } from './category-art'
import { ListingCard } from './listing-card'
import { CompactListingRowSkeleton, COMPACT_LIST_GRID } from './compact-listing-row-skeleton'
import { CaptureCard } from './capture-card'
import { useHideOnScroll } from '@/hooks/use-hide-on-scroll'
import { BrandRail } from './brand-rail'
import { CategoryRail } from './category-rail'
import { customFilterChipLabel } from './facet-chip-label'
import { FacetBarFallback } from './facet-bar-fallback'
import { LISTING_GRID } from './listing-grid'
import { LadderCompactRow, LadderSlot, useMdUp } from './ladder-compact-row'
import { ForYouRail } from './for-you-rail'
import { RecentlyViewedRail } from './recently-viewed-rail'
import { useNearViewport } from '@/hooks/use-near-viewport'
import { BusinessRail } from './business-rail'
import { MIN_RAIL_ITEMS, SECTION_HEADER_ROW, SECTION_TITLE } from './shelf'
import { DISTRICTS, DISTRICTS_PROVINCE_CODE, districtSlugLabel, districtSurvivesArea } from './listings-explorer.constants'
import { queryChips } from '@/lib/district-query'
import { clearPlaceForTypedDistrict, queryAfterAreaPick } from './explorer-place'
import { applyFilterParams, isSeededFeed, readExplorerUrl, recentSearchTerms, RECENTS_ATTR, type ExplorerSort, type ExplorerView } from '@/lib/explorer-url'
import { publicPathname, variantOfLanguage } from '@/lib/lang-variant'
import { localizedHref } from '@/lib/lang-pinned'
import { handBackAfterLeaving, holdScrollRestoration, pinnedChromeBottom, releaseScrollRestoration, runRestore } from './feed-restore'
import { ENTRY_KEY, OVERLAY_KEY, VIEW_KEY, currentHistoryState, hasUserActivation, liveOverlayOnTop, newHistoryKey, popIsLayerClose, stripOverlayEntry, viewStamp, whenLayerPopSettles } from '@/lib/back-to-close'
import { peekWard, provinceByCode, rememberWard, resolveWard } from '@/lib/vn-areas'
import { useDropStaleDistrict } from './use-drop-stale-district'
import { type Nearby, type Geo } from './area-filter'
import { useSearchShortcuts, useSearchHistory, useSaveSearch, hasSavableSearch } from './use-explorer'
import { ViewToggles, SortStrip } from './explorer-toolbar'
import { ResultLine, resultCountLabel, shouldOfferSaveSearch } from './result-line'
import { Spinner } from '@/components/ui/spinner'
import { getListingCoordinates, haversineKm } from '@/lib/geo'
import { histogramQueryFrom } from '@/lib/price-histogram'
import { useRegisterExplorer } from '@/lib/explorer-presence'
import { trackSearch } from '@/lib/analytics'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
import { useLanguage, Tr } from '@/context/language-context'
import { Bilingual } from './bilingual'
import { useAuth } from '@/context/auth-context'
import { useDashboard } from '@/hooks/use-dashboard'
import { SUBCATEGORIES } from '@/lib/subcategories'
import { offeredKeys } from './count-chip'
import { LISTING_TYPES, INTENT_SHORTCUTS, DESK_SHORTCUTS, CONDITION_FACET, categoryHasBrand, facetsFor, typesFor } from '@/lib/taxonomy'
import { hashKey, useQuery, useQueryClient } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { EmptyState } from '@/components/ui/empty-state'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { Mascot } from './mascot'
import { useScrollArrows, ScrollArrows } from '@/hooks/use-scroll-arrows'
import { useSearchSuggest } from '@/hooks/use-search-suggest'
import { SearchSuggest, buildSuggestItems, type AnySuggestItem } from './search-suggest'
import { TrendingSearches } from './trending-searches'
import { useTrendingSearches } from '@/hooks/use-trending-searches'
import { AISearchButton } from './ai-concierge'
import { useSuggestKeyboardNav, activeSuggestOptionId, visualSearchFromPaste, RECENT_LOCATIONS_KEY } from '@/hooks/use-search-box'
import { RECENT_SEARCHES_KEY } from '@/lib/reco-signals'
import { ListingCardSkeleton } from './listing-card-skeleton'
import { scrollBehavior } from '@/lib/reduced-motion'

// Custom filters → the request / URL is `applyFilterParams` (src/lib/explorer-url.ts, moved there 2026-10-09 beside its
// inverse `parseFilterParams`): range facets travel keyed by their numeric COLUMN as `range_<col>`, everything else as
// `attr_<key>` — taxonomy.ts facetParamName, the one mapping a saved search's link and alert use too (saved-search.ts).
// `applyParams` below reads the URL back through `readExplorerUrl`.

/**
 * WHICH ANSWER A FEED PAGE BELONGS TO: its react-query key with the page taken out, and the language
 * folded to what the payload actually varies on (`answerLang`).
 * ⛔ DERIVED FROM THE KEY, NOT FROM `filterSig`. Two payloads cached under one key must carry one
 * signature, and `filterSig` cannot promise that: it JSON-stringifies `customFilters` and `nearby`
 * in insertion order, while react-query hashes the key with sorted object keys. The same filters
 * rebuilt in another order (a URL with its `attr_*` params reordered) would then read as two result
 * sets over the SAME cache entries — the sync effect's guard would reset to page 1, page 1 would
 * come back from cache under the old stamp, the sentinel would ask for page 2 again, and the feed
 * would loop. `hashKey` is react-query's own hash, so equal keys give equal signatures by
 * construction.
 */
function resultSetSig(queryKey: readonly unknown[]): string {
  const [name, params] = queryKey as [string, Record<string, unknown>]
  const set = Object.fromEntries(
    Object.entries(params).filter(([k]) => k !== 'page').map(([k, v]) => (k === 'lang' ? [k, answerLang(v as string)] : [k, v])),
  )
  return hashKey([name, set])
}
/**
 * The part of the reader's language that changes the PAYLOAD. en and vi rows carry both titles
 * (`localizeListingTitles` returns early for them), so switching between the two re-labels the same
 * rows in place; any other language gets its own `titleI18n` in the response, so rows fetched in
 * English are a different answer for a Korean reader — keeping them, or extending them with Korean
 * pages whose ids were already seen, left English titles under a Korean UI.
 */
function answerLang(lang: string): string | null {
  return lang === 'en' || lang === 'vi' ? null : lang
}

/**
 * The feed's history entry gets the browser's own scroll restoration back — unless a back-nav
 * snapshot is waiting for it. ⛔ "MANUAL WHILE A SNAPSHOT EXISTS" is the whole rule: `handleOpen`
 * holds it off when it writes one, and everything that ends a restore (done, discarded, nothing to
 * restore, unmount) lands here. Checking the store rather than trusting the caller is what keeps a
 * restore that finishes AFTER the reader has tapped the next card from releasing the hold that tap
 * just set.
 */
function feedSnapshotPending(): boolean {
  try { return sessionStorage.getItem('eno:feed-snap') != null } catch { return false /* storage blocked */ }
}
/** A store that never changes — read through useSyncExternalStore only to tell the hydration render apart. */
const subscribeNothing = () => () => {}
/**
 * Has an explorer COMMITTED in this document yet? Set by the first explorer's mount effect, never
 * unset (a module of the client bundle lives exactly as long as the document).
 * ⛔ WHY `urlInit` NEEDS IT AND NOT ONLY `hydrating` (measured on the dev build, 2026-09-29): React
 * recovers a failed hydration by CLIENT-RENDERING the nearest Suspense boundary, and that render is
 * not a hydration render — `hydrating` reads false in it exactly as in a Back. Seeding from the URL
 * there dropped the server's seed rows under a /?q= deep link and collapsed the feed (load CLS 1.1
 * at 390×844, against 0.001 without the seed). A document's FIRST explorer is either the hydrated one
 * or that recovery render; only a LATER mount — the reader coming back to the feed within the app —
 * is the client-side mount the seed is for.
 */
let explorerCommitted = false
/**
 * Tests only: a fresh "document" (no explorer committed yet). A test file is ONE module instance, so
 * without this every mount after the file's first one would take the client-side-mount path and the
 * cold path would be exercised by whichever test happened to run first.
 */
export function __resetExplorerCommittedForTests(): void {
  explorerCommitted = false
  entrySnaps.clear()
}

/**
 * THE FEED AS IT WAS ON EACH HISTORY ENTRY THE READER LEFT BY A COMMITTED VIEW CHANGE (UX3 NAV-1) — so Back
 * puts back the rows and the scroll, not just the filters. A category tile, a search, the map, an applied
 * filter sheet each push an entry (see `commitView`); the feed being left is snapshotted here, keyed by its
 * entry's `enoEntry` id, in the SAME shape as the card-tap snapshot in sessionStorage, and Back hands it to
 * the SAME restore (`pendingSnapRef` → the restore layout effect → feed-restore.ts's frame loop).
 * ⚠️ IN MEMORY, NOT sessionStorage: a document's own history (a full reload drops it, and the browser's own
 * restoration then applies as before), and it would not fit the one sessionStorage slot the card tap owns.
 * ⚠️ ONE-SHOT and TIME-BOXED like that snapshot (consumed by the Back that uses it, 30 min), and dropped
 * when Back merely closes a layer back onto the same URL — a snapshot must never fire later as a scroll
 * jump nobody asked for. At most `ENTRY_SNAP_CAP` entries; a snapshot over 120 rows is not taken.
 */
type FeedSnap = {
  sig: string; rowsSig?: string; listings: SerializedListingCard[]; page: number; totalCount: number; scrollY: number; ts: number
  unlocked?: boolean; ceiling?: number; anchorId?: string | null; anchorTop?: number | null
  /** A history-entry snapshot (this map), as opposed to the card tap's — applied now or dropped, never kept waiting. */
  fromHistory?: boolean
}
const entrySnaps = new Map<string, FeedSnap>()
const ENTRY_SNAP_CAP = 20
const ENTRY_SNAP_TTL_MS = 30 * 60 * 1000
function keepEntrySnap(id: string, snap: FeedSnap): void {
  entrySnaps.delete(id)
  entrySnaps.set(id, snap)
  while (entrySnaps.size > ENTRY_SNAP_CAP) entrySnaps.delete(entrySnaps.keys().next().value as string)
}

/**
 * history.state key of an explorer entry's EXACT area (UX3 NAV-2): the province and ward as the explorer holds
 * them, and the "near you" circle. The URL carries only the province/ward CODES and never the circle (PDPL:
 * coordinates are personal data and leak through Referer and logs); history.state never leaves the browser,
 * so Back and Forward restore a near-you search exactly while a shared link or a reload gets the codes.
 */
const AREA_KEY = 'enoArea'
type AreaState = { province: Geo | null; ward: Geo | null; nearby: Nearby | null }
const NO_AREA: AreaState = { province: null, ward: null, nearby: null }

function isGeo(v: unknown): v is Geo {
  return !!v && typeof v === 'object' && typeof (v as Geo).code === 'string' && typeof (v as Geo).name === 'string' && typeof (v as Geo).nameEn === 'string'
}
function isNearby(v: unknown): v is Nearby {
  const n = v as Nearby
  return !!n && typeof n === 'object' && Number.isFinite(n.lat) && Number.isFinite(n.lng) && Number.isFinite(n.radiusKm)
}
/** The exact area an entry's history.state recorded, or null (none recorded, or malformed). */
function historyArea(state: unknown): AreaState | null {
  const a = state && typeof state === 'object' ? (state as Record<string, unknown>)[AREA_KEY] : null
  if (!a || typeof a !== 'object') return null
  const { province, ward, nearby } = a as Record<string, unknown>
  return { province: isGeo(province) ? province : null, ward: isGeo(ward) ? ward : null, nearby: isNearby(nearby) ? nearby : null }
}

/**
 * The area a URL (and its entry's state) names, as far as it can be known SYNCHRONOUSLY:
 * · the entry's recorded area when it agrees with the URL's codes (Back, Forward, a reload) — exact, near-you
 *   included;
 * · else the URL's codes — the province from the static table, the ward only if this document already knows
 *   it (`wardPending` names the one still to fetch);
 * · null when the URL names no area and the entry recorded none.
 */
function areaForLocation(u: { province: string; ward: string }, state: unknown): { area: AreaState; wardPending?: { province: string; ward: string } } | null {
  const h = historyArea(state)
  if (h) {
    const agrees = h.nearby
      ? !u.province && !u.ward
      : (h.province?.code ?? '') === u.province && (h.ward?.code ?? '') === u.ward
    if (agrees) return { area: h }
  }
  if (!u.province) return null
  const province = provinceByCode(u.province)
  if (!province) return null
  if (!u.ward) return { area: { province, ward: null, nearby: null } }
  const ward = peekWard(u.province, u.ward)
  return ward
    ? { area: { province, ward, nearby: null } }
    : { area: { province, ward: null, nearby: null }, wardPending: { province: u.province, ward: u.ward } }
}

const sameNearby = (a: Nearby | null, b: Nearby | null) =>
  a === b || (!!a && !!b && a.lat === b.lat && a.lng === b.lng && a.radiusKm === b.radiusKm)

/**
 * WRITE THE EXPLORER'S URL INTO HISTORY — the one place the explorer touches it (UX3 NAV-1).
 *
 * ⛔ IN PLACE (replaceState) UNLESS THE READER COMMITTED A VIEW CHANGE. Typing, sort, a refinement, a tweak
 * inside a sheet: the URL follows the state and no entry is added, as before. A category tile, a search, the
 * map ⇄ list switch, an applied area, a filter taken off (`commitView` lists them): ONE new entry, so Back
 * undoes it instead of leaving eno.vn — measured on production and preview alike: tile or search, then Back,
 * landed on about:blank.
 * ⚠️ A COMMIT THAT LANDS ON A LAYER'S ENTRY TAKES IT OVER ("absorb"): the search panel or a sheet already put
 * one entry on top for itself, and pushing a second would leave a dead one under it. The layer's mark goes
 * (src/lib/back-to-close.ts sees that and leaves the entry alone) and the entry becomes the committed step.
 * ⚠️ A PUSH NEEDS THE TAP'S USER ACTIVATION (Chrome skips history entries added without one); a commit that
 * somehow lost it falls back to replacing, which is today's behaviour.
 * ⚠️ THE NEW ENTRY CARRIES NEXT'S OWN STATE (`__NA` + tree — so Next's popstate restores this same page) but
 * NOT a layer's flags (`takeover`, `lightbox`, our mark): those belong to the entry the layer pushed.
 * Every entry also records its exact area (`AREA_KEY`) and an identity (`ENTRY_KEY`, for `entrySnaps`).
 */
function writeExplorerEntry(url: string, area: AreaState, commit: boolean): void {
  const base = currentHistoryState()
  // ⚠️ THE VIEW, NOT ONLY THE URL: a near-you circle changes the feed without changing the URL, so an Apply of
  // one must still count as a change — or the Area sheet's own entry would be popped as untouched and the
  // popstate would undo the circle (review). `VIEW_KEY` is what back-to-close.ts compares for the same reason.
  const stamp = areaStamp(area)
  const changed = new URL(url, window.location.href).href !== window.location.href || base[VIEW_KEY] !== stamp
  const layer = liveOverlayOnTop()
  const keptId = typeof base[ENTRY_KEY] === 'string' ? base[ENTRY_KEY] : newHistoryKey()
  const mine = { [AREA_KEY]: area, [VIEW_KEY]: stamp }
  if (commit && changed) {
    if (layer) { stripOverlayEntry({ ...mine, [ENTRY_KEY]: newHistoryKey() }, url); return }
    if (hasUserActivation()) {
      const next: Record<string, unknown> = { ...base, ...mine, [ENTRY_KEY]: newHistoryKey() }
      delete next[OVERLAY_KEY]; delete next.takeover; delete next.lightbox
      window.history.pushState(next, '', url)
      return
    }
  }
  // A RELEASED layer entry (the search panel closed by a tap that may navigate) that the view now moves is a
  // real step from here on — unmarked, so the next navigation does not replace it (back-to-close.ts).
  if (layer?.released && changed) { stripOverlayEntry({ ...mine, [ENTRY_KEY]: newHistoryKey() }, url); return }
  // Preserve the rest of history.state — dropping it would wipe the `takeover: 'video'` flag the video-return
  // mount check depends on, and an open layer's mark.
  window.history.replaceState({ ...base, ...mine, [ENTRY_KEY]: keptId }, '', url)
}

/**
 * The part of the area the URL does not carry, as a stamp — the near-you circle (and the place it was
 * picked under). '' when the URL says it all. Written as the entry's `VIEW_KEY`.
 */
function areaStamp(a: AreaState): string {
  return a.nearby ? JSON.stringify([a.nearby.lat, a.nearby.lng, a.nearby.radiusKm, a.province?.code ?? null, a.ward?.code ?? null]) : ''
}

function releaseFeedEntry() {
  // Asked now AND again if the release has to wait for `load` — a card tapped in between holds anew.
  if (!feedSnapshotPending()) releaseScrollRestoration(window, () => !feedSnapshotPending())
}

// CategoryRails and the FacetBar are code-split out of the home route's initial bundle.
// ⚠️ NEITHER DESCRIPTION IN THE OLD VERSION OF THIS NOTE SURVIVED THE 2026-08-11 MERGE, so
// read the new positions rather than the names: CategoryRails is no longer "below the fold"
// by luck — it is now explicitly BELOW THE RESULTS GRID with the other discovery shelves —
// and the FacetBar is no longer "filter-only", because home and search are one view and the
// facets sit above the feed on both. FacetBar is therefore now a cold-path chunk that mounts
// AFTER hydration directly above the grid, which is why its slot is height-reserved at the
// call site (min-h-12 — the reasoning is spelled out there). ForYouRail + BusinessRail stay STATIC: they SSR their
// shimmer skeleton (reserving the rail's height) so they don't pop in and shift the feed
// — `ssr:false` here caused the CLS "layout shift culprits". They're tiny (reuse the
// already-bundled ListingCard), so the JS cost is negligible.
const CategoryRails = dynamic(() => import('./category-rails').then((m) => m.CategoryRails), { ssr: false })

// Perf Phase 1: mount the per-category rails only when the user approaches them —
// they injected many sections above the feed right after hydration (layout shift +
// an immediate /api/category-rails fetch on every cold load). The sentinel is
// zero-height, so deferral itself never moves anything.
// ⚠️ Since 2026-08-11 these rails render BELOW the results grid, so the sentinel is a
// full feed away from the fold and `near` no longer fires on first paint. The idle gate
// below is now belt-and-braces rather than the load-bearing half of the deferral — do not
// remove it on that basis: on a short/sparse catalogue (every rail above hidden by the
// MIN_RAIL_ITEMS floor, a single grid row) the sentinel can still start inside the fold.
function DeferredCategoryRails(props: React.ComponentProps<typeof CategoryRails>) {
  const { ref, near } = useNearViewport<HTMLDivElement>()
  // Idle-armed on top of near-viewport: when the sentinel starts at the first-paint fold
  // (see above) `near` fires immediately, and without this gate the rails — and their
  // /api/category-rails fetch — would still land inside the critical window.
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    const arm = () => setArmed(true)
    if (typeof requestIdleCallback === 'function') { const id = requestIdleCallback(arm, { timeout: 8000 }); return () => cancelIdleCallback(id) }
    const t = setTimeout(arm, 3500); return () => clearTimeout(t)
  }, [])
  // Pre-arm the sentinel is OUT OF FLOW (absolute, zero-size — the recently-viewed-rail
  // pattern, and for the same reason): this sits in a space-y container, where even a
  // zero-height in-flow div earns a full spacing unit — a permanent 32–48px dead band
  // whenever the rails are absent, PLUS a second one while they loaded. IO still fires on
  // zero-area targets, `near` latches true, and armed is a one-shot — so once mounted the
  // rails stay mounted and the wrapper isn't needed at all. NOT `hidden`/display:none —
  // those never intersect and would silently kill the rails forever.
  if (!(armed && near)) return <div ref={ref} aria-hidden="true" className="absolute h-0 w-0" />
  return <CategoryRails {...props} />
}
/**
 * ⛔ `loading` IS THE SERVER'S FACET ROW (E-TOOLBAR, 2026-09-29). Without it the ISR HTML carried only
 * Next's bail-out template inside the toolbar's `min-h-12` slot — a blank 48px band where the filters
 * go, for the whole of hydration (4s on a phone cold load). <FacetBarFallback> is the undirected row at
 * the real pills' exact geometry, so the band reads as filters from the first paint and nothing moves
 * when the chunk lands. It is also what shows between hydration and the chunk arriving.
 */
const FacetBar = dynamic(() => import('./facet-bar').then((m) => m.FacetBar), { ssr: false, loading: () => <FacetBarFallback /> })

/** Rows in one page of results. ONE constant, because the results skeleton is a promise
 *  about this number: it drew six placeholders against a twelve-row answer, so the column
 *  grew by a whole grid row (~300px on a phone) the moment the query resolved. The
 *  "Near you" path deliberately pulls a broader set — it distance-filters client-side —
 *  and is the one caller that overrides it. */
const FIRST_PAGE_SIZE = 12

/**
 * ⛔ AUTO-PAGINATION STOPS HERE AND WAITS FOR A CLICK — owner, 2026-09-24: "it auto laod too much
 * make sure user clicks load button before autoloading post 100 products".
 *
 * The feed used to auto-page forever once unlocked. Measured on prod that day (desktop 1440x900,
 * sitting still at the bottom of the home feed): the document went 3556 → 3962 → 7881px in 1.5
 * SECONDS with no user input, because each append moved the sentinel back into its own 600px
 * rootMargin. That is the "loads too much", and it also caused the header to jump — a bottom-pinned
 * viewport has `scrollY` advanced by the browser when content grows, which `useHideOnScroll` could
 * not tell from a scroll-down (fixed there, in its own comment).
 *
 * ⚠️ A CEILING, NOT A HARD STOP. Every click raises it by another 100, so the contract is "auto-load
 * a hundred, then ask" repeatedly — not "a hundred and then paginate by hand forever".
 * ⚠️ NOT A MULTIPLE OF `FIRST_PAGE_SIZE` (12) ON PURPOSE: the gate compares ROWS LOADED, so it trips
 * at the first page boundary at or past 100 (108) rather than pretending the owner said 96 or 120.
 */
const AUTO_LOAD_CAP = 100

// Perf: the LIST view's row and the MOBILE filters drawer were static imports, so both shipped
// in the home route's first load even though neither is on the default path — the feed renders
// a ListingCard grid and the drawer is a mobile overlay nobody has opened yet.
// ⚠️ THE 2026-07-25 CORRECTION THAT USED TO BE HERE IS ITSELF OUT OF DATE. It said "viewMode
// defaults to 'compact', so this row IS the default results view once the explorer opens" —
// true while there were two branches, wrong since the 2026-08-11 merge: viewMode now decides
// what the HOME page renders too, so it defaults to 'grid' (see the useState) and this row is
// an opt-in view again. That makes the deferral a straightforward win on the primary browse
// path rather than a trade. Nothing here is server-rendered, so ssr:false costs no HTML —
// keep the skeleton geometry-matched anyway, because in list view many of these mount at once.
//
// The row needs a placeholder with the real row's geometry, because in list view many of these
// render at once — a null while the chunk arrives would collapse the whole column and then push
// it back down. That placeholder is <CompactListingRowSkeleton>, in its own module: this file
// used to carry TWO hand-rolled versions of it (here, and in the first-page loading state
// further down) which had already drifted apart from each other and from the row.
const CompactListingRow = dynamic(() => import('./compact-listing-row').then((m) => m.CompactListingRow), {
  ssr: false,
  loading: () => <CompactListingRowSkeleton />,
})

const ListingsMap = dynamic(() => import('./listings-map').then((m) => m.ListingsMap), {
  ssr: false,
  // ⚠️ NO `animate-pulse`, and ink-4 rather than text-body — this is the same placeholder
  // listing-detail-map.tsx documents at length, and the fix there was never back-ported here.
  // `animate-pulse` fades the whole subtree to 50%, which drops this 10px bold label to
  // ~3.36:1 (axe AA failure); the Spinner already says "loading", so the pulse was redundant
  // with it anyway. Keep the two placeholders identical — they stand in for the same map.
  loading: () => (
    <div className="w-full h-full bg-tint flex flex-col items-center justify-center gap-2 select-none">
      <Spinner size="md" />
      <span className="text-3xs font-bold text-ink-4 uppercase tracking-wider">
        <Tr text="Loading map…" />
      </span>
    </div>
  )
})
// The TikTok-style Video view is heavy (video refs + IntersectionObserver) and only used on
// demand — lazy-load it just like the map so it never ships in the default bundle.
const VideoFeed = dynamic(() => import('./listings-video-feed').then((m) => m.VideoFeed), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black">
      <Spinner size="md" className="border-white/30 border-t-white" />
    </div>
  ),
})

// Display a brand slug ("louis-vuitton") as a label ("Louis Vuitton") without a
// catalogue round-trip. Brands recognized by simple-icons keep their canonical name.
function prettyBrand(slug: string): string {
  return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

// 'newest' is the legacy param name for the DEFAULT relevance blend (rankScore —
// the API's default case AND its semantic-search gate both key on it), shown as
// "Liên quan". TRUE recency is the separate 'recent' value.
// Both unions live with the URL reader (src/lib/explorer-url.ts), which has to produce them.
type SortKey = ExplorerSort
type ViewMode = ExplorerView

/** The view this surface opens in, and the one a "go home" reset returns to.
 *  ⚠️ It became load-bearing on 2026-08-11, when the landing branch and the results branch
 *  merged. Before that, viewMode governed only the results branch and the landing rendered a
 *  card grid unconditionally; now this single value decides what the HOME page renders, so
 *  'compact' would silently turn the home feed into bonbanh-style list rows. It also stops the
 *  presentation from CHANGING when the visitor searches — cards before, cards after — which is
 *  the whole point of merging the two. Named once because three places have to agree: the
 *  useState, the Video view's fall-back-to ref, and resetToLandingPage. */
const DEFAULT_VIEW: ViewMode = 'grid'

// The in-page typeahead's listbox id. Deliberately DISTINCT from the header bar's
// ('header-search-suggest') so the two can sit in the DOM at once without colliding.
// ⚠️ Nothing in this file renders an input bound to it today — the hero search bar moved
// into the header on 2026-08-03 and the landing branch that hosted it was merged away on
// 2026-08-11. The wiring is kept intact (see the panel/listbox derivations before the
// return) precisely so a future in-page input cannot re-derive the contract differently
// from the header's, which is how the two bars drifted apart the first time.
const SUGGEST_ID = 'hero-search-suggest'

type Props = {
  categories: SerializedCategory[]
  initialListings: SerializedListingCard[]
  initialTotal?: number
  /**
   * ⛔ SCOPES EVERY QUERY THIS COMPONENT MAKES TO ONE SHOP — set only by a storefront
   * (`apple.eno.vn`, rewritten to `/s/<handle>`), never on the marketplace home page.
   * ⚠️ IT IS NOT A FILTER THE READER CAN CLEAR. Facets, search, sort and paging all compose
   * INSIDE it; there is no chip for it and no way to widen back to the whole catalogue, because on
   * a shop's own storefront "show me everything" means everything THEY sell.
   */
  sellerId?: string
  // Server render timestamp of initialListings (Date.now() in the RSC). The homepage is 6h-ISR:
  // stamping the seed with CLIENT Date.now() marked hours-old snapshot data as fresh (within the
  // 30s staleTime), so React Query never revalidated it. With the true age, a stale snapshot
  // still paints instantly but refetches in the background.
  initialFetchedAt?: number
  // Server-known rail seeds (perf Phase 1) — rail geometry decided at first paint.
  initialBusinesses?: SerializedListingCard[]
  initialTrending?: SerializedListingCard[]
  listingsRef?: React.RefObject<HTMLDivElement | null>
  /**
   * Whether this component renders the page's sr-only `<h1>{SITE_NAME}</h1>`. Default: ON for the
   * marketplace explorer, OFF when seller-scoped (`!sellerId`).
   * ⚠️ `false` WHERE SOMETHING ELSE OWNS THE H1 — `(home)/layout.tsx` (SEO wave B, H1c) renders it above
   * the home loading boundary so crawlers can read it, and `(home)/page.tsx` passes `false` so the page
   * does not get two once `S:0` is revealed.
   * ⛔ A STOREFRONT'S H1 IS THE SHOP'S NAME, NOT THE SITE'S (ST-HEADER, 2026-09-29). `/s/[handle]` renders
   * this explorer under its own SellerCard header, whose name is the page's one <h1>; the site name
   * heading there read "eno.vn" as the title of VietKite's shop. So the default follows the scope, and
   * that page passes nothing (crawler-visible-html-contract.test.ts pins that it does not).
   */
  siteHeading?: boolean
}



export function ListingsExplorer({
  categories,
  initialListings,
  initialTotal,
  initialFetchedAt,
  initialBusinesses,
  initialTrending,
  listingsRef,
  sellerId,
  siteHeading = !sellerId,
}: Props) {
  // Tell the header an explorer is here to receive its search/area/map events (explorer-presence.ts).
  useRegisterExplorer()
  const { lang, t, tr } = useLanguage()
  // Bumps whenever a machine translation lands (see the crumbs memo below).
  const trVersion = useSyncExternalStore(subscribeTr, getTrSnapshot, () => 0)
  const { openSignIn } = useAuth()
  // Who already HAS a teacher profile: the teachers chips then open their own profile, not the sign-up form (owner,
  // 2026-10-09, "apply recommended"). The shared dashboard store — nothing is fetched for a visitor who is signed out.
  const { dash } = useDashboard()
  const hasTeacherProfile = dash?.hasTeacher === true
  // Desktop ← / → arrows for the horizontally-scrollable category grid (same primitive as the rails).
  const { scrollerRef: catScrollerRef, canLeft: catCanLeft, canRight: catCanRight, page: catPage } = useScrollArrows()
  /**
   * `hydrating` is true only in the server render and the hydration render (useSyncExternalStore's
   * server snapshot) — so it tells a COLD load (server HTML to agree with) from a CLIENT-SIDE mount
   * (Back from a listing, an in-app link: no server HTML at all). Hoisted to the top for `urlInit`;
   * `coldLoad` below records the same thing for the ladder fold.
   *
   * ⛔ A CLIENT-SIDE MOUNT STARTS AS THE URL SAYS (E-BACK, 2026-09-29). Every axis below used to start
   * at its default and take the URL from the mount effect (`applyParams`) — a PASSIVE effect, i.e.
   * after paint — and a search's words reached the fetcher 150ms later still (the debounce). The
   * back-nav restore can only fire once the feed's signature equals the snapshot's, so Back painted
   * the top of the unfiltered feed for 500ms (browse) to 750ms (search) and only then jumped to where
   * the reader had been. Seeded here, the signature matches in the FIRST render, the restore runs in
   * the first layout effect, and the first frame is already the reader's place.
   * ⚠️ NEVER ON A COLD LOAD: the server rendered the unfiltered home, so starting anywhere else would
   * be a hydration mismatch. Cold loads keep the effect path exactly as before (`urlInit` is null and
   * every initial value below is the one it always was) — and so does the FIRST explorer of a
   * document even when it is client-rendered (hydration-failure recovery), see `explorerCommitted`.
   * ⚠️ `applyParams` still runs on mount and sets the same values again — a no-op by value, which is
   * what keeps popstate and `eno:apply-url` on one reader (src/lib/explorer-url.ts).
   * ⛔ ONLY WHEN THE ADDRESS BAR IS ALREADY THIS PAGE'S (review, 2026-09-29). On Back/Forward the browser
   * moves `location` before popstate, so this render reads the target. On a `router.push` (an in-app
   * link, a header search from a listing page) Next writes history in its router's
   * `useInsertionEffect` — AFTER this render (node_modules/next/dist/client/components/app-router.js,
   * `HistoryUpdater`) — so `location` is still the page being LEFT: a storefront's `?q=` seeded the
   * home, subscribed and fetched a key nobody asked for, and set `startedOffSeed` for the wrong feed.
   * The router's own pathname (`usePathname()`, the target during this render) is the witness: a
   * mismatch means the URL cannot be read yet, and the mount takes the cold path's effect reader
   * (`applyParams`, which runs after the history write). A push inside the same page never remounts
   * this component (the layout router keys the page without its search params), so a matching
   * pathname is the Back case.
   */
  const hydrating = useSyncExternalStore(subscribeNothing, () => false, () => true)
  const pathname = publicPathname(usePathname() || '/')
  const [urlInit] = useState(() => (
    !hydrating && explorerCommitted && typeof window !== 'undefined' && publicPathname(window.location.pathname) === pathname
      ? readExplorerUrl(window.location.search)
      : null
  ))
  useEffect(() => { explorerCommitted = true }, [])
  /**
   * The area a CLIENT-SIDE mount starts in (UX3 NAV-2) — the same rule as every other axis above: Back to a
   * feed filtered to Hồ Chí Minh must start filtered to it, or the snapshot restore cannot match and the
   * reader sees the whole country first (measured on production: 14 jobs → 25 after Back). Exact from the
   * entry's own state when it has one; else the URL's codes (a ward this document has not seen yet is
   * fetched by the mount effect). `null` on a cold load, which keeps the effect path.
   */
  const [areaInit] = useState(() => (urlInit ? areaForLocation(urlInit, window.history.state) : null))
  const [activeCategory, setActiveCategory] = useState(urlInit?.category ?? 'all')
  const [query, setQuery] = useState(urlInit?.query ?? '')
  // Loose (any-word) text match — set by visual search so a photo-derived phrase
  // surfaces the closest items instead of needing an exact multi-word match.
  const [looseMatch, setLooseMatch] = useState(urlInit?.looseMatch ?? false)
  const [sort, setSort] = useState<SortKey>(urlInit?.sort ?? 'newest')
  const [verifiedOnly, setVerifiedOnly] = useState(true)
  const [activeDistrict, setActiveDistrict] = useState(urlInit?.district ?? 'all')
  // New area model (Vietnam 2025: province → ward), driven by the AreaFilter.
  const [activeProvince, setActiveProvince] = useState<Geo | null>(areaInit?.area.province ?? null)
  // ⛔ An HCMC district pick resets when the province leaves HCMC (Hà Nội AND District 1 is an empty
  // feed) — one effect for all four paths that set the province. See use-drop-stale-district.ts.
  useDropStaleDistrict(activeProvince?.code ?? null, setActiveDistrict)
  const [activeWard, setActiveWard] = useState<Geo | null>(areaInit?.area.ward ?? null)
  const [nearbyState, setNearby] = useState<Nearby | null>(areaInit?.area.nearby ?? null) // {lat,lng,radiusKm} when "search near you" is on
  /**
   * ⛔ NO "NEAR ME" RADIUS OVER A FEED WHOSE ROWS HAVE NO PLACE (teachers — map-pin-rows.ts categoryHasMap, the same reason
   * there is no map; commit gate, 2026-10-09 — Opus). A radius carried in from another browse ("Within 3 km" on rentals)
   * filtered the teachers feed to NOTHING until the reader found "Lives in" and pressed Apply. DERIVED, never reset: every
   * reader below — the request, the cache key, the area pill, the entry's history.state — sees no radius on this feed,
   * and the reader's own radius is still there when they go back to rentals.
   */
  const nearby = categoryHasMap(activeCategory) ? nearbyState : null
  // Every ward the explorer holds is remembered for the document, so Back to its URL resolves it at once (vn-areas.ts).
  useEffect(() => { rememberWard(activeProvince?.code, activeWard) }, [activeProvince?.code, activeWard])
  const [conditionFilter, setConditionFilter] = useState(urlInit?.condition ?? 'all') // 'all' | 'new' | 'used'
  /**
   * "Good price" — a FILTER (URL/API `deal=good`), not a sort, so it narrows the result set, its count
   * and its facet counts, and combines with the sort the visitor chose (Good price + Price ↑ = the
   * cheapest good deals). ⛔ It is an applied axis EVERYWHERE conditionFilter is — the show/un-latch
   * pair, the URL writer, filterSig, feedSig, the fetch params, the react-query key, the hand-built
   * prefetch key, the ISR-seed gate, the histogram params and the result chips. Miss one and that
   * surface shows the unfiltered feed under a pressed "Good price" button.
   */
  const [goodPriceOnly, setGoodPriceOnly] = useState(urlInit?.goodPrice ?? false)
  const [listingType, setListingType] = useState(urlInit?.listingType ?? 'all') // intent axis: all | sell | rent | wanted | free | service | job | event
  const [priceRange, setPriceRange] = useState(urlInit?.priceRange ?? 'all') // 'all' | 'min-max' (VND, empty max = open)
  const [customFilters, setCustomFilters] = useState<Record<string, string>>(urlInit?.customFilters ?? {})
  const [activeSubcategory, setActiveSubcategory] = useState(urlInit?.subcategory ?? 'all')
  /**
   * ⛔ A FILTER THE NEW VIEW DOES NOT OFFER IS DROPPED FROM STATE, NOT KEPT AS A CHIP THAT FILTERS
   * NOTHING. Measured on production 2026-09-25: Rentals › Apartment › 2 BR, then tap Office — the
   * request dropped `attr_bedrooms` (applyFilterParams: offices have no bedroom facet) and returned
   * all 2,270 offices, while "bedrooms: 2" stayed on screen as an applied filter and the Filter badge
   * said 0. Every path that changes the subcategory or category lands here — the rail, the chip ✕,
   * a brand pick, back/forward — so it is one effect rather than a prune in each handler.
   * ⚠️ THE SERVER COUNTS SIBLINGS THE SAME WAY (subcategoryDropPlan in src/lib/facet-counts.ts): the
   * number on "Office" is what this prune leaves the tap returning. Change one, change both.
   * ⚠️ It returns the SAME object when nothing is dropped, so the common case re-renders nothing.
   */
  useEffect(() => {
    const sub = activeSubcategory === 'all' ? null : activeSubcategory
    const valid = new Set(facetsFor(activeCategory, sub).map((f) => f.key))
    setCustomFilters((prev) => {
      const drop = Object.keys(prev).filter((k) => !valid.has(k))
      if (!drop.length) return prev
      const next = { ...prev }
      for (const k of drop) delete next[k]
      return next
    })
  }, [activeCategory, activeSubcategory])
  const [activeBrand, setActiveBrand] = useState(urlInit?.brand ?? 'all') // canonical brand slug, or 'all'
  const [activeModel, setActiveModel] = useState(urlInit?.model ?? 'all') // model display string, or 'all'
  /**
   * `?line=` — a model PREFIX from the brand cascade ("iPhone", "iPhone 17"), covering a whole
   * line or generation. ⚠️ DELIBERATELY SEPARATE FROM `activeModel`, which stays an EXACT string:
   * `?model=` is in shared links, the sitemap and indexed URLs, and teaching it to mean a prefix
   * would change what every one of those already returns. Empty string = not set.
   */
  const [activeLine, setActiveLine] = useState(urlInit?.line ?? '')
  /**
   * ⚠️ `useCallback` IS LOAD-BEARING HERE. `ModelCascade` lists this in a `useEffect` dependency
   * array (its stale-selection guard), so a fresh identity each render would re-run that effect
   * every render. The cascade also guards on the value, but two guards is the right number for an
   * effect that clears the user's filter.
   * The two are mutually exclusive by construction: a LEAF writes `model`, a BRANCH writes `line`.
   */
  const handlePickLine = useCallback((line: string, model: string) => {
    setActiveLine(line)
    setActiveModel(model || 'all')
  }, [])
  // See DEFAULT_VIEW for why this is 'grid' and not 'compact'. The compact row is one tap away
  // on the view toggles, and ?view=compact still deep-links straight to it.
  const [viewState, setViewMode] = useState<ViewMode>(urlInit?.view ?? DEFAULT_VIEW)
  /**
   * ⛔ THE TEACHERS FEED HAS NO MAP VIEW (gate review, 2026-10-09). Every row on `?category=teachers` is a teacher (only the
   * teacher form writes that category — taxonomy.ts NON_POSTING_CATEGORIES — and no other feed returns one: feed-query.ts
   * teacherExclusion), and a teacher is never a pin (map-pin-rows.ts: a person has places they can teach, not a location).
   * So that map ALWAYS came up without a single pin — 60dvh of streets over the list on a phone, a sticky column of them
   * beside it on desktop, nothing saying why — and /c/teachers' "Filters" link lands right on this feed.
   * ⛔ ONE RULE AT THE STATE, NOT A GUARD PER ROUTE. The toolbar's tab is gone (`showMap`), but 'map' also arrives from
   * `?view=map` (a client mount's seed, the `?view=` reader, Back/Forward — and links: the header's Map off the explorer
   * keeps a /c/teachers category, the /c/teachers/<district> hub has a Map link) and from a category change made ON the
   * map (a tile, a typeahead or alert URL: none of them touch the view). Patching each is how the next one gets missed —
   * the un-latch below says the same. So `viewMode` is the view ON SCREEN: on this feed a 'map' reads as the default
   * view for every reader — the map block and its queries never start, and the URL writer drops `view=map` in place.
   * ⚠️ THE STATE IS PUT BACK TOO, during render (adjust-state-during-render, as `foldArmed` below): a 'map' left behind
   * came back the moment the reader left teachers — a view the URL had stopped naming, so a reload and a Back disagreed
   * about one address. Derived AND reset: the derived value keeps even the render that resets it from starting the
   * map's queries.
   * ⚠️ Every other feed: `mapOffered` is true and `viewMode` IS `viewState` — unchanged.
   */
  const mapOffered = categoryHasMap(activeCategory)
  if (!mapOffered && viewState === 'map') setViewMode(DEFAULT_VIEW)
  const viewMode: ViewMode = !mapOffered && viewState === 'map' ? DEFAULT_VIEW : viewState
  // The full-screen Video view remembers the view to fall back to on close (so exiting the
  // takeover lands the user back where they were, not always on the grid).
  const prevViewRef = useRef<ViewMode>(DEFAULT_VIEW)
  /** The view on screen, for handlers registered once (the map switch is a committed change only when it is one). */
  const viewModeRef = useRef<ViewMode>(viewMode)
  useEffect(() => { viewModeRef.current = viewMode }, [viewMode])
  /** `mapOffered`, for the same once-registered handlers (the header's Map, "show on map"). */
  const mapOfferedRef = useRef(mapOffered)
  useEffect(() => { mapOfferedRef.current = mapOffered }, [mapOffered])
  const changeView = useCallback((m: ViewMode) => {
    /**
     * ⛔ INTO OR OUT OF THE MAP IS A STEP BACK UNDOES (UX3 NAV-1, `commitView`): the map is a takeover of the
     * results column, and Back from it should land on the list it replaced. Grid ⇄ list is a presentation
     * of the same rows (stays in place, like a sort). The Video view pushes its own entry (its takeover's),
     * so it never pushes a second one here.
     */
    const cur = viewModeRef.current
    if (m !== cur && m !== 'video' && cur !== 'video' && (m === 'map' || cur === 'map')) commitView()
    setViewMode((c) => { if (m === 'video' && c !== 'video') prevViewRef.current = c; return m })
  }, [])
  // Clip to restore when the Video feed re-opens after a back-nav from a listing.
  const [videoReturn, setVideoReturn] = useState<{ id: string; params: string } | null>(null)
  // Honor ?view=map|grid|compact|video (e.g. the footer "Map" link opens the map view), and
  // restore the Video feed after a back-nav from a listing that was opened from inside it.
  // The eno:video-return stash is consumed on EVERY mount (never left to linger), but only ACTED
  // on when this mount is the feed's own history entry coming back: the entry's state still
  // carries the takeover flag pushed when the feed opened (it survives router.push + Back). A
  // FORWARD nav to this page (logo tap, breadcrumb) mints a fresh entry without the flag, so an
  // intentional "go home" is never hijacked into the fullscreen takeover.
  useEffect(() => {
    if (typeof window === 'undefined') return
    let ret: { path?: string; id?: string; params?: string; ts?: number } | null = null
    try {
      const raw = sessionStorage.getItem('eno:video-return')
      if (raw) { sessionStorage.removeItem('eno:video-return'); ret = JSON.parse(raw) }
    } catch { /* ignore */ }
    const returning =
      !!ret && typeof ret.id === 'string' && ret.path === window.location.pathname &&
      Date.now() - (ret.ts ?? 0) <= 30 * 60 * 1000 && window.history.state?.takeover === 'video'
    if (returning) setVideoReturn({ id: ret!.id!, params: typeof ret!.params === 'string' ? ret!.params : '' })
    const v = new URLSearchParams(window.location.search).get('view')
    // Also open the results view — landing + viewMode alone left the footer's
    // "Map" link on the landing hero, which read as a dead link.
    // (⛔ `?view=map` on the teachers feed still shows the default view — `mapOffered`, beside the view state.)
    if (v === 'map' || v === 'grid' || v === 'compact' || v === 'video') { setViewMode(v); setShowExplorer(true) }
    else if (returning) { setViewMode('video'); setShowExplorer(true) }
  }, [])
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  // A listing to show on the map that isn't necessarily in the loaded feed (set when a
  // card outside the feed — e.g. the For You rail — asks to be located).
  const [focusListing, setFocusListing] = useState<SerializedListingCard | null>(null)
  const router = useRouter()
  /**
   * Where a category or intent tile LINKS (E-TILES): the page it is on — `/`, both for the marketplace
   * and for a storefront (served at `/` on the shop's own host) — with just that one filter, or bare to
   * clear it.
   * ⛔ PUBLIC PATH, NOT THE RAW `usePathname()`: the home is ISR-prerendered as `/en` / `/vi` and served
   * at `/`, so the raw value put `href="/en?category=…"` — a proxy 404 — into the cached HTML, and React
   * does not patch attributes on hydration. `publicPathname` strips the variant, so the build render and
   * the browser agree (lang-variant.ts; header.tsx's `hydrated` note is the same trap). The storefront
   * is force-dynamic, and a per-request render already reads the public `/` (src/proxy.ts).
   * (`pathname` itself is declared at the top, beside `urlInit`, which reads it too.)
   * ⛔ IN THE PAGE'S LANGUAGE ON THE MARKETPLACE (A1-LANG, home-14): the `/vi` home's public path is `/`
   * too, so its tiles linked the English-pinned `/?category=…`; `localizedHref` sends a Vietnamese page
   * to `/vi?category=…`. ⚠️ NEVER ON A STOREFRONT (`sellerId`): a shop's host has no `/vi` pilot — the
   * proxy bounces its `/vi` to the apex marketplace — so a tile there would leave the shop it filters.
   * The server variant and the first client render
   * agree (the provider starts at the variant the server rendered), so the href hydrates as rendered.
   */
  const tileVariant = sellerId ? 'en' : variantOfLanguage(lang)
  const tileHref = useCallback((param: { category?: string; type?: string } | null) => {
    if (!param) return localizedHref(pathname, tileVariant)
    const q = new URLSearchParams()
    if (param.category) q.set('category', param.category)
    if (param.type) q.set('type', param.type)
    return localizedHref(`${pathname}?${q.toString()}`, tileVariant)
  }, [pathname, tileVariant])
  // ⛔ NO FILTERS DRAWER ANY MORE, AND NO 'open-mobile-filters' LISTENER. The bottom drawer
  // (explorer-filters.tsx) could only be opened by that window event, and nothing had dispatched it
  // since the header's events moved to the `eno:*` names — so its "Quận / Huyện" picker was the one
  // district control in the app and no user could reach it (owner, 2026-09-24: "still cant search
  // by district"). The district choice now lives in the Area panel (area-filter.tsx), next to
  // province, ward and "near you", on every screen size; the drawer's other groups already had live
  // homes in the facet bar. Deleted rather than re-wired: a second place to pick the same district
  // is a second place for the two to disagree.
  const [showExplorer, setShowExplorer] = useState(urlInit?.directed ?? false)
  // The sticky sort strip tracks the auto-hiding header (same hook): header shown →
  // pinned just below it; header rolled away → pinned at the viewport top.
  const headerHidden = useHideOnScroll()

  /**
   * ⛔ "THIS TAP IS A STEP BACK CAN UNDO" (UX3 NAV-1). Called at the start of every committed view change —
   * a category or intent tile, a search (header, recents, popular, visual), a typeahead pick that applies a
   * URL, the map ⇄ list switch, an area applied from its panel, the logo's reset, and taking a filter off
   * (a chip's ✕, Clear all, a crumb, the empty state's relax buttons — in place, those rewrote a pushed
   * entry back to the URL below it and left two identical entries; review) — and of nothing else: typing,
   * sort, subcategory/brand refinements and taps inside a sheet stay in place, as the plan (§R) scopes it.
   * It does two things, both before the state changes:
   *   · snapshots the feed being LEFT (rows, depth, scroll anchor) under its history entry, so Back puts the
   *     reader exactly there (`entrySnaps`);
   *   · arms ONE push for the URL write this tap causes (the writer consumes it; a tap that changes no URL
   *     leaves nothing armed past this task).
   * ⚠️ Synchronous with the tap ON PURPOSE: the push needs the tap's user activation, and the state it
   * snapshots must be the state before the change. An async path (visual search) calls it after its await.
   */
  const historyIntentRef = useRef(false)
  /** Builds the snapshot of the feed on screen — kept current by a layout effect beside `handleOpen`. */
  const snapSourceRef = useRef<() => FeedSnap | null>(() => null)
  /** Snapshot the feed on screen under the entry it is on (a layer's entry shares its base's id until it commits). */
  const snapshotThisEntry = useCallback(() => {
    try {
      const snap = snapSourceRef.current()
      if (!snap) return
      let id = currentHistoryState()[ENTRY_KEY]
      if (typeof id !== 'string') {
        // An entry the explorer has not written yet (Next's own, after a navigation) gets its identity now.
        id = newHistoryKey()
        window.history.replaceState({ ...currentHistoryState(), [ENTRY_KEY]: id }, '')
      }
      keepEntrySnap(id as string, snap)
    } catch { /* a snapshot is a nicety — nothing depends on it */ }
  }, [])
  const commitView = useCallback(() => {
    snapshotThisEntry()
    historyIntentRef.current = true
    setTimeout(() => { historyIntentRef.current = false }, 0)
  }, [snapshotThisEntry])

  /**
   * ⚠️ A CLIENT-SIDE MOUNT OF ANY OTHER FEED STARTS WITH NO ROWS, NOT THE ISR SEED (E-BACK). The seed
   * is page one of the unfiltered home; under `?q=honda` it is twelve unrelated cards and a count that
   * contradicts the chip. With nothing to show the grid draws its first-page skeleton, and the rows
   * arrive from the snapshot restore (a layout effect, before paint), the react-query cache (adopted
   * in the first render, below the seed adoption) or the request — whichever the reader has.
   * `startedOffSeed` is false on every cold load and on a client mount of the seeded view itself.
   */
  // A near-you circle is no part of the URL but is part of the feed (it comes back from the entry's state).
  const [startedOffSeed] = useState(() => urlInit !== null && (!isSeededFeed(urlInit) || !!areaInit?.area.nearby))
  const [listings, setListings] = useState<SerializedListingCard[]>(startedOffSeed ? [] : initialListings)
  // Freshness anchor for the SSR seed: the SERVER render timestamp baked into the ISR
  // HTML (initialFetchedAt). The homepage snapshot can be up to 6h old — stamping it
  // with client Date.now() (the previous behavior) told React Query hours-old rows were
  // fresh, so sold/new listings never revalidated. With the true age the seed still
  // paints instantly (initialData always renders); it just ALSO refetches in the
  // background when the snapshot is older than the 30s staleTime — one cheap
  // /api/listings call in exchange for a feed that's actually current.
  const [seedFetchedAt] = useState(() => initialFetchedAt ?? Date.now())
  /**
   * ⚠️ THIS IS NOW A PASS-THROUGH, and the comment that stood here described the opposite. It said
   * the area was distance-FILTERED client-side while keeping the API's trust ranking with distance
   * as a tiebreaker. All three halves of that moved: the area is filtered by the database, the
   * ranking is the feed's own `rankScore` (the bounded trust⊕recency blend, so the trust hierarchy
   * is not lost), and distance ordering now lives in `mapSortedListings`, which anchors on
   * `nearby` when it is set — i.e. exactly where an area search is performed. In grid and list view
   * an area search is ordered like any other feed; a reviewer was right that this changed, and it
   * changed deliberately rather than by omission.
   */
  const shownListings = useMemo(() => {
    /**
     * ⛔ NO LONGER PRUNES, AND THAT IS THE POINT. This used to haversine-filter the fetched page,
     * which on a capped page IS data loss — the rows it dropped were ones the cap had already
     * chosen to return, so later pages could never surface them. The area is applied by the
     * database now (`lat`/`lng`/`radiusKm` → a lat/lng range pair in buildFeedFilters), so every
     * row that arrives is already inside it and re-filtering here could only ever remove something
     * the server meant to include.
     */
    return listings
  }, [listings])
  // Map view: inject the out-of-feed focus listing (For You rail / ?focus= deep
  // link) ahead of the feed. Memoized — an inline expression allocated a fresh
  // array every render, forcing the map's markers effect to re-run needlessly.
  // ⛔ A TEACHER IS NEVER A MAP PIN (2026-10-08): a person carries no coordinates, and the text fallback put teachers abroad
  // in central Saigon — mapPinRows (./map-pin-rows.ts) says why, and keeps the array's identity when it drops nothing.
  const mapListings = useMemo(
    () => mapPinRows(focusListing && !shownListings.some((l) => l.id === focusListing.id) ? [focusListing, ...shownListings] : shownListings),
    [focusListing, shownListings],
  )
  // Render the card grids off a DEFERRED copy so a facet/sort toggle paints the
  // control's new state immediately and the (heavier) grid reconciliation runs as a
  // non-urgent update — keeps INP low on mid-range Android.
  const deferredListings = useDeferredValue(shownListings)
  /**
   * ⛔ WHILE A BACK-NAV RESTORE PUTS THE READER BACK, THE GRID RENDERS THE ROWS, NOT THE DEFERRED COPY
   * (E-BACK, 2026-09-29). The restore sets the snapshot's rows in a layout effect, so its re-render is
   * urgent — and an urgent render hands `useDeferredValue` the OLD value and schedules the new one for
   * later. The tapped card therefore entered the DOM a deferred render after the restore went looking
   * for it, and the reader watched the top of the feed until it did. `restoring` makes the grid read
   * `shownListings` for exactly that window, so the card is there in the commit the restore aligns.
   * ⚠️ IT ENDS ONLY ONCE THE DEFERRED COPY HAS CAUGHT UP, NOT WHEN THE RESTORE LOOP ENDS. `runRestore`
   * can settle in two frames while a long deferred render is still time-sliced on a slow phone; handing
   * the grid back to `deferredListings` at that moment would render the PRE-restore rows (an urgent
   * render again gets the old value) — the grid collapses under the reader and the scroll clamps.
   * `restoreSettled` is the loop's half; the render-phase check below adds the other.
   */
  const [restoring, setRestoring] = useState(false)
  const [restoreSettled, setRestoreSettled] = useState(false)
  if (restoring && restoreSettled && deferredListings === shownListings) {
    setRestoring(false)
    setRestoreSettled(false)
  }
  const [, startFilterTransition] = useTransition()
  // ⚠️ SEEDED FROM THE ISR HTML, NOT 0, AND THE MERGE IS WHY. The result count is now rendered
  // on the undirected home view as well (the results header serves both states), so whatever
  // this holds at first paint is baked into the 6h-ISR HTML and served to every anonymous
  // visitor and every crawler. At 0 that HTML said the marketplace had no listings while
  // showing twelve of them, and it also made `hasMore` false, so the "Browse everything"
  // ending popped in after hydration instead of being in the markup (app/(home)/loading.tsx
  // reserved it until UX3 FAST-8 removed that file; the ending is in the inline HTML now). initialTotal is the count for exactly the rows baked beside it —
  // page.tsx runs the count() against the same predicate as the findMany().
  // Known, accepted imprecision: a FILTERED deep link (/?q=…) is served the same prerendered
  // HTML, so it shows the unfiltered total for one paint before the response corrects it. It
  // showed 0 before, which is equally wrong and worse for the common case.
  // ⚠️ A reviewer read this as "crawlers and no-JS visitors permanently get a count that
  // contradicts the filter". Measured, they do not: `listings` also initialises from
  // initialListings, so a no-JS visitor to /?q=x sees the unfiltered TWELVE CARDS and the
  // unfiltered COUNT — wrong about the query, but internally consistent, and identical to what
  // that visitor got before this line existed. The count never disagrees with the cards beside it.
  const [totalCount, setTotalCount] = useState(startedOffSeed ? 0 : (initialTotal ?? 0))
  /**
   * What the grid and list views actually render — see `restoring`. ⚠️ AND NEVER AN EMPTY DEFERRED COPY
   * BESIDE ROWS: going from no rows (a zero-result answer, a skeleton-first mount) to some, the urgent
   * render hands `useDeferredValue` the old `[]`, and the grid rendered EMPTY for that render — no cards
   * and, the skeleton being gone, no height: the page collapsed ~3,000px and came back (measured). With
   * nothing on screen to keep responsive there is nothing to defer, so the rows render at once —
   * once their COUNT has landed with them (`totalCount` covers them). The seed-reference adoption
   * (`adoptedCacheRef`, further down) sets rows a render before the sync effect sets the count; drawing twelve cards over "0 listings"
   * for that render would trade one wrong frame for another, so that render keeps the old behaviour.
   */
  const gridListings =
    restoring || (deferredListings.length === 0 && shownListings.length > 0 && totalCount >= shownListings.length)
      ? shownListings
      : deferredListings
  const [page, setPage] = useState(1)
  /**
   * The BUILDING (project) the map has drilled into, or null for the normal feed.
   * ⚠️ IT IS PART OF `filterSig` BELOW, WHICH IS WHAT MAKES DRILL-IN SAFE. Selecting a tower must
   * reset the page during render and REPLACE the loaded rows — otherwise an in-flight page of the
   * unfiltered feed lands after the switch and appends other buildings' units under this tower's
   * header. A reviewer flagged exactly that; the existing signature mechanism already handles it,
   * so this joins it rather than growing a second reset path.
   */
  const [selectedBuilding, setSelectedBuilding] = useState<string | null>(null)
  // Hard pagination stop: if a genuinely DEEPER page (offset past the deepest we've grown
  // at) comes back with zero new rows, we're done — even if totalCount still reads higher.
  // Guards against a server order/total mismatch (a query whose pages can resolve via
  // different rank paths across instances) producing a never-terminating load-more loop.
  // seenIdsRef mirrors every appended id (dedup); maxOffsetRef is the deepest grown offset,
  // so a back-nav restore re-fetch or a placeholderData replay (offset ≤ max) never trips it.
  const [reachedEnd, setReachedEnd] = useState(false)
  const seenIdsRef = useRef<Set<string>>(new Set())
  const maxOffsetRef = useRef(0)
  // Return-to-feed restoration: when set, a back-nav snapshot is being rehydrated —
  // hold the scroll target until the taller list paints, and don't let the page-1
  // query shrink the restored list. `anchorId` is the card that was TAPPED and
  // `anchorTop` where it sat in the viewport; realigning that one element is what
  // makes the restore survive a document whose height differs from the one we left
  // (on the landing feed the rails above the grid mount lazily and may be absent
  // entirely when we land deep in it — an absolute offset would be thousands of px out).
  const restoredScrollRef = useRef<{ y: number; anchorId: string | null; anchorTop: number } | null>(null)
  const restoreStopRef = useRef<(() => void) | null>(null)
  /**
   * ⛔ WHICH RESULT SET THE ROWS IN `listings` BELONG TO — `resultSetSig` of the query their
   * payload was fetched for (`fetchedFor.sig`, stamped in the queryFn; `liveSig` for an answer that
   * never went through it, i.e. the ISR seed), or the snapshot's on a back-nav restore.
   * `undefined` = unknown (an unstamped placeholder), which the append guard lets through and the
   * back-nav restore refuses (it restores only rows whose provenance IS the current query).
   * The sync effect APPENDS a page only onto rows of the same signature. It exists because the
   * owner watched a grid keep 39 "iPhone 12 Pro Max" cards under "3 listings · iPhone 13 Mini"
   * (2026-09-24): the page counter survived a filter change, the new model was fetched at
   * offset 48, and the append branch had no way to tell that the page belonged to another query.
   *
   * ⛔ `skipFirstPageResetRef` USED TO SIT HERE AND IT WAS THE CAUSE. It told the in-render page
   * reset (below, at `filterSig`) to skip "the restore's own" filter change — but the restore runs
   * in a layout effect one render AFTER that change, so nothing consumed it, and it swallowed the
   * reader's NEXT filter change instead: the reset never ran, and the new filters were fetched at
   * the restored depth. It was written for a passive-effect reset (62134f1a), where the ordering
   * held; f780cc23 moved the reset into render and the flag silently inverted. The restore needs
   * no guard at all: it runs only once `feedSig` already equals the snapshot's, and `setPage`
   * changes no signature. Do not bring it back.
   */
  const rowsSigRef = useRef<string | undefined>(undefined)
  // The back-nav snapshot, read once on mount and applied when the feed's filters
  // settle to the same signature. On a COLD load the filters hydrate from the URL in an
  // effect, so the match can't be made synchronously at mount; a client-side mount (the
  // normal Back) seeds them from `urlInit`, so there it matches in the first layout effect.
  const pendingSnapRef = useRef<FeedSnap | null>(null)
  const snapReadRef = useRef(false)
  const [subcategoryCounts, setSubcategoryCounts] = useState<Record<string, number>>({})
  /**
   * THE CONDITIONAL FACET COUNTS, straight off the feed response — this is what makes every chip
   * answer "how many results if I tap this, given everything else I have already chosen".
   *
   * ⚠️ HELD IN STATE RATHER THAN READ INLINE, for the same reason `subcategoryCounts` is: the feed
   * response for a LOAD MORE (offset > 0) carries `facets: {}` by design, and reading inline would
   * blank every number on the page the moment someone pages. Holding the last non-empty payload
   * keeps the counts on screen while more rows arrive.
   * ⚠️ THE PAYLOAD IS DEEP-FROZEN — it is a shared 60s memo entry on the server. Never sort, splice
   * or assign into it; the rails only ever read.
   * ⚠️ A HELD PAYLOAD GOES STALE ACROSS A FILTER CHANGE, and that is handled downstream rather than
   * here: after a category tap the held brand/subcategory dimensions are still keyed by the OLD
   * category's slugs, so every lookup misses — and a miss inside a PRESENT dimension is legitimately
   * 0, which would paint a wall of zeros over a full catalogue for one round trip. `railDimension`
   * in count-chip.tsx is the net: a dimension is used only if it carries at least one key the rail
   * is actually rendering. Three reviewers found that independently; do not "simplify" it away.
   */
  const [facetCounts, setFacetCounts] = useState<FacetCounts>({})
  const [categoryTotal, setCategoryTotal] = useState(0)
  const [debouncedQuery, setDebouncedQuery] = useState(query)
  /**
   * ⛔ A SEARCH THAT FINDS NOTHING IS ASKED FOR ITS LIKELY SPELLING — AND SAYS SO (S-RECALL, 2026-09-29:
   * "iphnoe" found 0 while "iphone" found 3,439). The feed corrects only a request that opts in with
   * `spell=1` (src/app/api/listings/route.ts), because another word's results are honest only beside
   * "Showing results for iphone · Search instead for “iphnoe”" — which this component draws (see
   * `correctedQuery`). So every page of a worded feed opts in (the price histogram asks for the word
   * the feed answered — see `histogramQuery`); "Search
   * instead" records the words it was pressed for in `literalFor`, and those words are then asked
   * literally. New words drop it (below), so the next search is corrected again.
   * ⚠️ `spell` IS PART OF THE REQUEST, SO IT IS PART OF THE KEY (`feedKeyFields`): the literal zero and
   * the corrected set are two different answers to the same words, and one cache entry for both would
   * hand "Search instead" the corrected rows back.
   * ⚠️ NOT sent to the Video feed, the map's building pins or anything else that cannot draw the line —
   * the route's rule is that a client which cannot say "Showing results for…" gets the literal zero.
   */
  const [literalFor, setLiteralFor] = useState<string | null>(null)
  const spellTerm = debouncedQuery.trim()
  if (literalFor !== null && literalFor !== spellTerm) setLiteralFor(null)
  const spellOn = spellTerm !== '' && literalFor !== spellTerm

  const [showSuggestions, setShowSuggestions] = useState(false)
  // Recent searches + areas (localStorage), extracted. saveSearchToHistory is consumed by the
  // feed-sync / landing-search / visual-search paths below (all after this line).
  const { recentSearches, recentLocations, setRecentSearches, setRecentLocations, saveSearchToHistory } = useSearchHistory(activeProvince, activeWard)
  const [landingQuery, setLandingQuery] = useState('')
  // Below-the-fold curated rows render only AFTER first paint, so the landing
  // hydrates ~12 cards instead of ~84 — the ~70 extra cards were saturating the
  // mobile main thread and delaying the LCP image paint (3.1s render delay).

  // Sparse-catalogue rail dedup (wow pass, 2026-08-06): with ~13 live listings the three
  // landing rails were showing the SAME cards over and over — density that reads as a
  // dead shop. The For You seed keeps first claim (it leads), Outstanding businesses is
  // deduped against it, and the per-category rails exclude both. Rails that fall below
  // the shared floor hide themselves (MIN_RAIL_ITEMS in shelf.tsx); every listing still
  // appears in the feed grid, so nothing becomes unreachable. Server seeds only — a
  // client-side personalization upgrade may reintroduce an overlap, which is acceptable:
  // this is best-effort de-repetition, not a uniqueness invariant.
  // Same render-gate rule as railExcludeIds below: a For You seed too small to render its
  // rail never showed its cards, so it may not claim them out of the businesses rail either.
  // (If the rail later appears from a >=3-item client fetch, a card can repeat — the accepted
  // best-effort tradeoff documented above.)
  const dedupedBusinesses = useMemo(() => {
    const trendingShown = initialTrending && initialTrending.length >= MIN_RAIL_ITEMS ? initialTrending : []
    return initialBusinesses?.filter((b) => !trendingShown.some((t) => t.id === b.id))
  }, [initialBusinesses, initialTrending])
  // Only rails that will actually RENDER may claim their cards: a rail hidden by the
  // MIN_RAIL_ITEMS floor never showed anything, so counting its ids here would starve the
  // category rails below of cards nobody ever saw (external diff-review catch, 2026-08-06).
  const railExcludeIds = useMemo(() => {
    const trendingShown = initialTrending && initialTrending.length >= MIN_RAIL_ITEMS ? initialTrending : []
    const businessesShown = dedupedBusinesses && dedupedBusinesses.length >= MIN_RAIL_ITEMS ? dedupedBusinesses : []
    return [...trendingShown, ...businessesShown].map((l) => l.id)
  }, [initialTrending, dedupedBusinesses])

  // ⚠️ NOT A MODE ANY MORE — A PREDICATE. Until 2026-08-11 this gated an early `return`, so
  // the home page and the search page were two different trees and moving between them
  // unmounted one and mounted the other. That boundary is gone; what survives is the QUESTION
  // it answered: "has the visitor directed this feed at anything yet?" False the moment they
  // search, pick a facet, choose an area, or ask for the map/video view.
  // ⚠️ ITS ONLY CONSUMER TODAY IS showDiscovery BELOW, AND IT IS STILL WORTH ITS OWN NAME.
  // The two are different questions — "has the visitor directed the feed" versus "is the
  // undirected-browse chrome on screen" — and they diverge on exactly one axis (the map and
  // video views, which are directed surfaces the FILTERS have not been touched for). Every
  // consumer so far has wanted the second question; folding this into it would still leave
  // that distinction to be re-derived by whoever next needs the first.
  const isLandingMode = useMemo(() => {
    return (
      !showExplorer &&
      activeCategory === 'all' &&
      activeDistrict === 'all' &&
      activeSubcategory === 'all' &&
      !activeProvince && !activeWard && !nearby &&
      Object.keys(customFilters).length === 0
    )
  }, [showExplorer, activeCategory, activeDistrict, activeSubcategory, activeProvince, activeWard, nearby, customFilters])

  // Is the undirected-browse chrome (the discovery shelves and the "Browse everything" unlock —
  // the "big category tiles" this used to list went with the tile grid; the promo banner is gone
  // from this page entirely since 2026-09-18) on screen? Everything isLandingMode asks, plus: the map and video are
  // results surfaces in their own right — the map is a 60dvh/full-column takeover and the
  // video feed is a fixed-inset one — so merchandising rails around them would be decorating a
  // view the visitor explicitly asked for.
  // ⚠️ THE viewMode HALF IS NOT COSMETIC — THE PAGINATION GATE READS THIS, NOT isLandingMode.
  // The merge put the view toggles on the home page, which created a state nobody had ever been
  // in: map view with showExplorer still false. Gate pagination on isLandingMode there and the
  // map dead-ends at twelve listings, because the map paginates through its own in-column
  // sentinel and renders no "Browse everything" button to unlock it — a feed that simply stops,
  // with nothing to click and no error. Reading showDiscovery instead means opening a takeover
  // view counts as directing the feed, which is what it is.
  const showDiscovery = isLandingMode && viewMode !== 'map' && viewMode !== 'video'

  /**
   * ⛔ ON A PHONE, A DIRECTED FEED FOLDS ITS CATEGORY LADDER INTO ONE ROW (owner decision, mobile audit
   * 2026-09-24: "Collapse to one compact row"). Measured at 390×844: with a search or filter applied
   * the first result sat at y=681 (search) / y=535, under the ~263px tile grid and the ~112px brand
   * rail. `!showDiscovery` is exactly "the reader has asked this feed something" (a query, any filter,
   * a takeover view); the undirected home keeps its tiles. `md` is the rail's own phone/desktop
   * breakpoint, and desktop keeps the full rails. See ladder-compact-row.tsx.
   * `ladderOpen` is the reader's "show me the whole ladder" — it survives filter changes (they are
   * usually made FROM the opened ladder) and resets when the feed goes back to undirected browse, so
   * the next search starts folded (adjust-state-during-render, the pattern `filterSig` uses).
   */
  const mdUp = useMdUp()
  /**
   * ⚠️ …BUT NOT UNDER A READER WHO HAS NOT TOUCHED ANYTHING YET, ON A COLD LOAD OF A DIRECTED URL. The
   * ISR HTML is the unfiltered home (one 6h copy for every URL) and the URL's filters are applied in an
   * effect after hydration, so folding THEN moves every result on screen up ~220px with no input to
   * explain it — measured at 390×844 on a cold /?category=electronics: CLS 0.54 with an unconditional
   * fold against 0.28 without it (local production builds; production itself 0.20; reviewer-flagged
   * too). So a cold load keeps the URL's own state unfolded, and the fold arms the moment the feed
   * moves off it — normally the reader's own tap, whose commit is inside the input window. A
   * client-side mount (Back, an in-app link) has no server paint to shift from and folds at once.
   * ⚠️ KNOWN EDGE: a change the explorer makes on its own after the URL landed also arms it — the
   * brand-heal fetch giving a bare `?brand=` deep link its category is the one path found. That folds
   * once, late, on a rare link; the alternative (arming from raw input events) risks folding the rail
   * between a pointerdown and its click, i.e. under a tap on its way to a card.
   * `hydrating` (declared at the top, for `urlInit`) is true only in the server render and the
   * hydration render, so `coldLoad` records how THIS mount began. A client mount has read its URL
   * already (`urlInit`), so it starts applied.
   */
  const [coldLoad] = useState(hydrating)
  /**
   * ⛔ A COLD DIRECTED DEEP LINK WAITS FOR ITS OWN ANSWER BEHIND A MASK (E-SSR phase 1, 2026-09-29).
   * The home route is one 6h-ISR document for every query string, so /?q=honda paints the UNFILTERED
   * seed — twelve unrelated cards under "Recommended" and the whole catalogue's count — and keeps it on
   * screen through hydration (≈4s on a phone), the 150ms debounce and the request. A pre-paint script
   * in (home)/layout.tsx sets `html[data-explorer-directed]` from the URL before the first paint, and
   * globals.css turns the seed's cards, count and heading into same-size placeholders while it is set
   * (geometry untouched, so lifting it moves nothing). This flag is the explorer's half: true from the
   * mount that applies such a URL until the first page of ITS answer is in hand. The attribute itself is
   * lifted only once the grid actually DRAWS that answer (see the effect beside `failedWithoutAnswer`);
   * until then the masked cards take no taps and nothing auto-pages (`seedMasked`), and the count — kept
   * in place so its row keeps its height — is `visibility: hidden`, i.e. off the screen and out of the
   * accessibility tree, so its live region cannot announce the seed's total.
   * ⚠️ Cold loads only — a client-side mount seeds its state from the URL (E-BACK) and never sees the
   * seed, and the script does not run on a client navigation (React never executes a script it
   * renders), so there is nothing to mask there.
   */
  const [awaitingUrlAnswer, setAwaitingUrlAnswer] = useState(false)
  /**
   * Is the mask still up? It outlives `awaitingUrlAnswer` by the deferred render that DRAWS the answer
   * (see the effect beside `failedWithoutAnswer`), and everything that must not act on the seed — taps
   * on the masked cards, auto-paging — reads this rather than the answer flag.
   */
  const [seedMasked, setSeedMasked] = useState(false)
  const [urlApplied, setUrlApplied] = useState(urlInit !== null)
  const ladderSig = JSON.stringify([
    activeCategory, activeSubcategory, activeBrand, activeModel, activeLine, activeDistrict, activeProvince?.code ?? null,
    activeWard?.code ?? null, nearby ? 1 : 0, conditionFilter, goodPriceOnly, listingType, query, priceRange, customFilters, viewMode,
  ])
  const [urlLadderSig, setUrlLadderSig] = useState<string | null>(null)
  const [foldArmed, setFoldArmed] = useState(!coldLoad)
  if (!foldArmed && urlApplied) {
    if (urlLadderSig === null) setUrlLadderSig(ladderSig)
    else if (urlLadderSig !== ladderSig) setFoldArmed(true)
  }
  const liveCollapse = !showDiscovery && !mdUp && foldArmed
  /**
   * ⛔ THE LADDER HOLDS STILL WHILE A FILTER PANEL IS OPEN (E-FILTER-SHEET, 2026-09-29). A price preset
   * or an area pick directs the feed, which folds the phone ladder (above) — and a fold behind an open
   * panel moved the whole page ~220px under it: an anchored popover was left hanging below a pill that
   * had jumped, and a sheet closed onto a page that was no longer where the reader left it. The value
   * is frozen when a panel opens and released when the last one closes, so the fold happens on the
   * close tap, inside that input's window.
   * `null` = no panel open, follow the live value.
   */
  const [panelFreeze, setPanelFreeze] = useState<boolean | null>(null)
  const collapseLadder = panelFreeze ?? liveCollapse
  const liveCollapseRef = useRef(liveCollapse)
  useEffect(() => { liveCollapseRef.current = liveCollapse }, [liveCollapse])
  const onFacetPanelOpenChange = useCallback((open: boolean) => {
    setPanelFreeze(open ? liveCollapseRef.current : null)
    // A phone sheet's taps can become a history step (its entry is kept when they change the URL — see
    // back-to-close.ts), so the feed under it is snapshotted now, while it is still the feed being left:
    // Back from that step then restores these rows and this scroll, not page one (NAV-1).
    if (open) snapshotThisEntry()
  }, [snapshotThisEntry])
  const [ladderOpen, setLadderOpen] = useState(false)
  // Folded again for the next search once the feed is back to undirected — or once the screen is wide
  // enough to show the whole ladder anyway (a rotated tablet), so narrowing it back starts folded.
  if ((showDiscovery || mdUp) && ladderOpen) setLadderOpen(false)

  /**
   * ⛔ THE PREDICATE THESE FOUR PARAGRAPHS DOCUMENTED IS GONE, AND THIS IS WHAT IS WORTH KEEPING.
   * `showBanner` decided where `<PromoBanner>` could appear; the banner itself was removed from this
   * page on 2026-09-18 at the owner's instruction ("remove banners on desktop … Remove on both"),
   * and the render-site note where it used to mount carries that quote and what replaced it.
   *
   * Two constraints outlived it, because they are about the SLOT rather than the predicate, and the
   * next person to put advertising on this page needs both:
   * · ⛔ NEVER ON A SHOP'S OWN STOREFRONT. Owner, 2026-08-30: *"dont show eno.vn banners in
   *   individual storefront"*. `<PromoBanner>` is eno's OWN slot — VinWonders, VietKite, GMBR — and a
   *   shop handing out `apple.eno.vn` would be handing out a page carrying a competitor's ad above
   *   its own stock. The shop's own banner is a DIFFERENT component, `<StorefrontBanner>`, one slot
   *   per storefront, and it belongs to the shop.
   * · ⚠️ A SLOT THAT MOUNTS AND UNMOUNTS WITH A FILTER IS THE BUG THE OWNER REPORTED, not a
   *   placement choice. Measured at 1440×900 when it was gated on `showDiscovery`: tapping
   *   Electronics moved the category rail from top=459 to top=135 and the document from 3822px to
   *   2639px — a 324px lurch (the banner's 292px plus its `pb-8`) with every control below it, which
   *   reads as a page change although nothing navigated. Whatever goes here next holds a fixed y in
   *   every browse state, or it re-creates that jump.
   */

  // ⚠️ THE SORT STRIP IS THE ONE CONTROL THE PREDICATES ABOVE DO NOT SEE, AND ALL THREE
  // REVIEWERS FOUND IT. Measured: the showExplorer sync effect covers category, query, district,
  // subcategory, brand, model, listingType, condition, price and the custom facets — so every one
  // of those DOES leave undirected browse. `sort` is in neither that effect nor isLandingMode,
  // deliberately (it is not a filter: it reorders the same set), and until the merge that was
  // invisible because the strip only existed in the results branch. It is on the home page now,
  // so a visitor can reorder the home feed by price while a heading names another order.
  // The FEED is fine either way; the CLAIM is what breaks, so this fixes the claim rather than
  // flipping the whole page out of discovery for a reorder — a sort tap is not a search, and
  // tearing the banner, tiles and shelves off the page for one would be the "hop" this wave
  // exists to remove.
  // ⛔ THE HEADING NOW NAMES THE ORDER, SO IT NEVER HAS TO HIDE (E-SORT, 2026-09-29). It used to be
  // "Latest listings", shown only in the default order and swapped for an sr-only heading on any
  // other sort — and "Latest" was wrong even then: 'newest' is the legacy param name for the DEFAULT
  // RELEVANCE blend (rankScore, see SortKey), shown on the strip as "Relevance". True recency is
  // 'recent' ("Newest"). So the undirected feed's visible <h2> follows the strip: Recommended ·
  // Latest listings · Most contacted · By price. The clock glyph belongs to recency alone.
  const homeFeedHeading =
    sort === 'recent' ? tr('Latest listings', 'Tin đăng mới nhất')
      : sort === 'popular' ? tr('Most contacted', 'Được quan tâm')
        : sort === 'price-low' || sort === 'price-high' ? tr('By price', 'Theo giá')
          : tr('Recommended', 'Đề xuất')

  const resetToLandingPage = useCallback(() => {
    setQuery('')
    setLandingQuery('')
    setActiveCategory('all')
    setActiveDistrict('all')
    setActiveSubcategory('all')
    setActiveBrand('all'); setActiveLine('')
    setActiveModel('all')
    // ⚠️ Reset EVERY axis applyParams() reads, not just the common ones. The
    // showExplorer sync effect re-opens the explorer whenever ANY facet is
    // non-default, so one missed axis undoes the whole reset: a lingering
    // listingType ('/?type=free' — the intent tiles) flipped the explorer straight
    // back open after a logo tap and the URL effect re-wrote the param, making the
    // wordmark appear dead (owner-reported, 2026-07-23). looseMatch/sort don't
    // re-open the explorer but would silently haunt the NEXT search from landing.
    setListingType('all')
    setConditionFilter('all')
    setGoodPriceOnly(false)
    setLooseMatch(false)
    setSort('newest')
    setCustomFilters({})
    setPriceRange('all')
    setShowExplorer(false)
    setFeedUnlocked(false) // re-gate the home feed (footer reachable again)
    setAutoLoadCeiling(AUTO_LOAD_CAP) // …and start the auto-load budget over
    // ⚠️ THE VIEW IS PART OF "GO HOME" NOW (2026-08-11). It was not, and did not need to be,
    // while the landing was its own tree that ignored viewMode entirely — a logo tap from the
    // map landed on the landing and the stale 'map' was invisible. One tree means a leftover
    // 'map'/'video' survives the reset and keeps showDiscovery false, so the visitor gets the
    // home page with no banner, no tiles and no shelves: a logo that looks broken, which is the
    // exact class of bug the setListingType line above was added for.
    setViewMode(DEFAULT_VIEW)
    // ⚠️ AND THE PAGE DEPTH, or the line above it only half-happens. Resetting a FILTER drops the
    // loaded pages for free (the filter signature changes, which resets page to 1 during render
    // and makes the sync effect REPLACE the rows). Coming home from the plain unfiltered feed
    // changes no signature, so without this a visitor who pressed "Browse everything", scrolled
    // to card 48 and tapped the logo kept all 48 rows while the gate re-armed underneath them —
    // the button reappearing in the middle of a feed it had already been used on. An external
    // reviewer measured the gap between this behaviour and the comment describing it.
    // It also reopens the hard stop: the listingsData sync effect's page===1 branch calls
    // setReachedEnd(false), so a visitor who had paged all the way to the end does not come home
    // to "You've reached the end" printed under twelve cards with no way to continue.
    setPage(1)
  }, [])

  // Clicking the header logo while already on the homepage resets the explorer back
  // to landing mode (a same-route <Link> can't reset this client state on its own).
  useEffect(() => {
    const onResetHome = () => {
      // ⛔ A COMMIT, NOT AN IN-PLACE RESET (review): the logo's own <Link> navigation finds the URL already `/`
      // and REPLACES — so an in-place reset left the results entry overwritten by a second `/`, and Back from
      // it changed nothing. Pushed, Back from home returns to the results the logo was tapped on.
      commitView()
      resetToLandingPage()
      setActiveProvince(null)
      setActiveWard(null)
      setNearby(null)
      setShowSuggestions(false)
      // Instant jump AFTER the reset re-renders: a smooth scroll from deep in the feed gets
      // clamped by a shrinking document and lands mid-page, so the logo "didn't go home".
      // rAF + `auto` fixes it. ⚠️ The document no longer shrinks as much as it did — the feed
      // used to UNMOUNT here (landing was a different tree) and now only the discovery chrome
      // toggles — but the reset still restores the pagination gate (setFeedUnlocked(false)),
      // which drops every page past the first, so the clamp is still reachable.
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'auto' }))
    }
    window.addEventListener('eno:reset-home', onResetHome)
    return () => window.removeEventListener('eno:reset-home', onResetHome)
  }, [resetToLandingPage])

  // Sync showExplorer with URL/parameters on mount or change.
  // ⚠️ useLayoutEffect SINCE 2026-08-11, AND IT IS THE SAME REASON THE UN-LATCH BELOW USES ONE.
  // As a passive effect this is flushed AFTER paint, which was invisible while it only chose
  // between two trees. Now it decides whether the promo banner, the value strip, the big category
  // tiles and four discovery shelves are on the page — so applying a filter it owns (price or
  // condition from the FacetBar, a brand from the typeahead) painted one frame of the FULL home
  // chrome above the new results and then collapsed several hundred pixels of it in the next.
  // The axes that live in isLandingMode itself (category, area, subcategory, custom facets) never
  // had this problem: that memo reads them directly, so it is already false in the same render.
  useLayoutEffect(() => {
    if (
      activeCategory !== 'all' ||
      query.trim() !== '' ||
      activeDistrict !== 'all' ||
      activeSubcategory !== 'all' ||
      activeBrand !== 'all' ||
      activeModel !== 'all' ||
      // ⚠️ `activeLine` IS AN AXIS AND BELONGS IN BOTH LISTS — see the contract note below.
      activeLine !== '' ||
      listingType !== 'all' ||
      conditionFilter !== 'all' ||
      goodPriceOnly ||
      priceRange !== 'all' ||
      Object.keys(customFilters).length > 0
    ) {
      setShowExplorer(true)
    }
  }, [activeCategory, query, activeDistrict, activeSubcategory, activeBrand, activeModel, activeLine, customFilters, listingType, conditionFilter, goodPriceOnly, priceRange])
  // ⚠️ THE AXIS LIST ABOVE IS THE CONTRACT THE UN-LATCH BELOW MIRRORS. Add an axis here and add
  // it there, or the pair disagrees about what "applied" means and the disagreement is a trap
  // rather than a bug: an axis this effect ignores but the un-latch honours can never be
  // un-latched, and one it honours but this ignores latches TRUE and is instantly cleared.

  // ⚠️ THE OTHER HALF OF THE EFFECT ABOVE, AND WITHOUT IT showExplorer IS A ONE-WAY LATCH.
  // Everything up there sets it TRUE; until 2026-08-11 nothing but resetToLandingPage ever set it
  // false, which was harmless while it merely CHOSE between two trees — a stale TRUE with nothing
  // applied still rendered a results page that looked deliberate. Since the merge it decides
  // whether the home page has a promo banner, category tiles, discovery shelves and a reachable
  // footer, so a stale TRUE is a broken home page: no chrome, BrandRail fetching /api/brands at
  // category=all, "Found N listings" where "Latest listings" belongs, and (showDiscovery false
  // while feedUnlocked is false) an armed sentinel — an infinite home feed with no footer.
  //
  // ⚠️ IT HAS TO LIVE HERE, NOT ON THE CONTROLS. Three external review rounds walked a different
  // route into that state each time — the chip's ✕, "Clear all filters", the FacetBar's own
  // "Clear" (since removed, E-ACTIVE), emptying the header search — and patching each one is how the next route gets
  // missed. This is the invariant instead: nothing applied and no takeover view means undirected
  // browse, whoever cleared the last thing and whichever control they used.
  //
  // ⚠️ useLayoutEffect, NOT useEffect: a passive effect is flushed AFTER paint, so every one of
  // those clears would show one frame of the filterless results view before the home chrome came
  // back. This runs inside the same commit.
  //
  // ⚠️ verifiedOnly IS DELIBERATELY ABSENT FROM THE TEST, AND AN EARLIER DRAFT HAD IT. Treating
  // "verified only is off" as an applied filter here — while the latch above ignores it and
  // getActiveChips emits no chip for it — made it the one axis that could latch the results view
  // and then refuse to release it: search, turn verified off, clear the search, and the visitor is
  // stranded on a filterless results view with no chip, no Save box and therefore no "Clear all".
  // Three reviewers found the asymmetry. The rule is symmetry: this test mirrors the latch's axis
  // list plus the area axes (which the header sets alongside showExplorer directly).
  // Not reachable today either way — the only caller of setVerifiedOnly left in the app is
  // clearAllFilters, which sets it TRUE (the FacetBar's own "Clear" did the same until E-ACTIVE
  // removed it, 2026-09-29; the filters drawer that held a switch for it was deleted 2026-09-24).
  //
  // ⚠️ THE MAP AND VIDEO VIEWS ARE EXEMPT ON PURPOSE. They are directed surfaces whether or not a
  // filter is set — the footer's Map link opens an unfiltered map deliberately — and they carry
  // no discovery chrome by design (see showDiscovery). Un-latching there would fight the very
  // deep links (?view=map, eno:view-map, the video back-nav restore) that set this.
  useLayoutEffect(() => {
    if (!showExplorer) return
    if (viewMode === 'map' || viewMode === 'video') return
    if (
      activeCategory !== 'all' ||
      // ⚠️ BOTH HALVES OF THE SEARCH TERM, AND THE LAGGING ONE IS THE POINT. `query` is what the
      // box holds; `debouncedQuery` (150ms behind) is what the FETCHER and getActiveChips use.
      // Testing only `query` released the chrome the instant the term was cleared, so for 150ms
      // the promo banner, the tiles, the shelves and "Latest listings" sat above the still-
      // FILTERED rows and the still-present search chip. Testing only `debouncedQuery` inverts it
      // and fights the latch above (which fires on `query`) for the same 150ms while typing.
      // Requiring both to be empty makes the chrome come back exactly when the unfiltered rows do.
      query.trim() !== '' ||
      debouncedQuery.trim() !== '' ||
      activeDistrict !== 'all' ||
      activeSubcategory !== 'all' ||
      activeBrand !== 'all' ||
      activeModel !== 'all' ||
      activeLine !== '' ||
      listingType !== 'all' ||
      conditionFilter !== 'all' ||
      goodPriceOnly ||
      priceRange !== 'all' ||
      activeProvince !== null || activeWard !== null || nearby !== null ||
      Object.keys(customFilters).length > 0
    ) return
    setShowExplorer(false)
    // Back to undirected browse → back behind the pagination gate, exactly as the logo reset
    // does. Without it the home feed keeps auto-paginating and the footer stays lost.
    setFeedUnlocked(false)
    setAutoLoadCeiling(AUTO_LOAD_CAP)
  }, [
    showExplorer, viewMode, activeCategory, query, debouncedQuery, activeDistrict, activeSubcategory, activeBrand,
    activeModel, activeLine, listingType, conditionFilter, goodPriceOnly, priceRange, activeProvince, activeWard,
    nearby, customFilters,
  ])

  // The last search term sent to analytics — so 'search' fires once per distinct
  // committed query, not again on every pagination/sort/filter refetch of the same term.
  const lastTrackedSearch = useRef<string | null>(null)



  // Match active categories for quick suggestion links in Landing Page
  // Instant matches for the hero search — server-backed (full catalog), shared
  // with the header search via the same hook + panel so both bars behave
  // identically (was a client-side filter over only the SSR-seeded listings).
  const heroSuggest = useSearchSuggest(landingQuery, showSuggestions)
  const heroSuggestItems = buildSuggestItems(landingQuery, heroSuggest.brands, heroSuggest.categories, heroSuggest.listings, heroSuggest.lines, heroSuggest.scope)
  // Arrow-key virtual focus for the hero typeahead — shared hook with the header bar
  // (state + clamps + query-edit reset; see use-search-box.ts).
  const { activeIdx: heroActiveIdx, moveDown: heroMoveDown, moveUp: heroMoveUp } = useSuggestKeyboardNav(landingQuery)

  // Trending searches for the empty-focus hero dropdown (shared hook/component with
  // the header). Fetched only while the panel is showing an empty query.
  const trending = useTrendingSearches(showSuggestions && landingQuery.trim().length < 2)

  // One pick handler for the hero dropdown (mouse + keyboard): the query row runs
  // the raw search; a brand opens its facets (dominant category resolves via the
  // brand-heal effect below); categories/listings navigate.
  const pickHeroSuggest = (it: AnySuggestItem) => {
    setShowSuggestions(false)
    if (it.type === 'query') { handleLandingSearch(landingQuery); return }
    if (it.type === 'brand') { setLandingQuery(''); commitView(); applyResolved({ brand: it.slug }); return }
    if (it.type === 'category') { handleCategorySelect(it.slug); setLandingQuery(''); return }
    /**
     * A product line and a scoped search (S-TYPEAHEAD) — the SAME urls header.tsx's pickSuggest builds,
     * applied in place through `applyUrl`, the reader behind `eno:apply-url`. ⚠️ Not `applyResolved`:
     * it has no `line`, so a line pick would silently widen to the whole brand.
     */
    if (it.type === 'line') {
      setLandingQuery('')
      applyUrl(`/?category=${encodeURIComponent(it.category)}&brand=${encodeURIComponent(it.brand)}&line=${encodeURIComponent(it.line)}`)
      return
    }
    if (it.type === 'scope') {
      applyUrl(`/?q=${encodeURIComponent(landingQuery.trim())}&category=${encodeURIComponent(it.category)}&subcategory=${encodeURIComponent(it.subcategory)}`)
      setLandingQuery('')
      return
    }
    router.push(`/listings/${it.listing.id}`)
  }

  // Open a resolved brand/model as facets (category + brand + model) instead of a
  // text search — a precise facet beats a keyword match. Clears `query` so the feed
  // isn't double-filtered (text AND brand); the bar keeps showing the brand label
  // via the eno:query broadcast below.
  const applyResolved = useCallback((d: { brand: string; model?: string | null; category?: string | null }) => {
    setQuery('')
    setLooseMatch(false)
    setActiveCategory(d.category || 'all')
    setActiveSubcategory('all')
    setActiveBrand(d.brand)
    setActiveModel(d.model || 'all')
    setCustomFilters({})
    setPriceRange('all')
  }, [])

  // A typed submit is a RAW free-text search — never silently upgraded to brand
  // facets (the dropdown's Brands group is the explicit facet path; Enter always
  // does exactly what the 'Search for "{q}"' row says). It also DROPS any stale
  // brand/model/subcategory facets so a new query can't silently AND with a
  // previous chip into phantom zero results (the category is kept; the applied
  // chips bar stays the visible receipt).
  const handleLandingSearch = useCallback((searchTerm: string) => {
    const trimmed = searchTerm.trim()
    commitView() // a search (header, recents, popular) is a step Back undoes (NAV-1)
    setShowExplorer(true)
    setShowSuggestions(false)
    setLooseMatch(false) // a typed search is strict (AND); only visual search is loose
    setActiveBrand('all'); setActiveLine('')
    setActiveModel('all')
    setActiveSubcategory('all')
    // ⛔ A district typed into the box replaces the district, ward, radius (and non-HCMC province)
    // already picked — otherwise an explicit pick silently wins over the words (explorer-place.ts).
    clearPlaceForTypedDistrict(trimmed, { setDistrict: setActiveDistrict, setWard: setActiveWard, setNearby, setProvince: setActiveProvince })
    if (trimmed.length >= 2) saveSearchToHistory(trimmed)
    setQuery(trimmed)
  }, [saveSearchToHistory])

  // Apply a VISUAL search result (photo → query + best-guess category/brand). Branded
  // items route exactly (category + brand facets); generic items scope to the detected
  // category and use a LOOSE any-word text match so the closest listings surface.
  const applyVisualSearch = useCallback(async (r: { query: string; category?: string | null; brand?: string | null }) => {
    const q = (r.query || '').trim()
    setShowExplorer(true)
    setShowSuggestions(false)
    if (q.length < 2) return
    saveSearchToHistory(q)
    try {
      const res = await fetch(`/api/search/resolve?q=${encodeURIComponent(q)}`)
      const d = res.ok ? await res.json() : null
      if (d?.brand) { commitView(); applyResolved(d); return }
    } catch {}
    // After the await, right before the state it commits (NAV-1): the snapshot must be the feed being left.
    commitView()
    if (r.category) {
      setActiveCategory(r.category)
      setActiveSubcategory('all')
      setActiveBrand('all'); setActiveLine('')
      setActiveModel('all')
      setCustomFilters({})
      setPriceRange('all')
    }
    setLooseMatch(true)
    // The same place rule as a typed search (explorer-place.ts) — every path that commits words.
    clearPlaceForTypedDistrict(q, { setDistrict: setActiveDistrict, setWard: setActiveWard, setNearby, setProvince: setActiveProvince })
    setQuery(q)
  }, [saveSearchToHistory, applyResolved])

  // Header ↔ explorer bridge (custom `eno:*` window events).
  // The header's search box + area selector drive the explorer here, and we tell the
  // header whether the hero search pill is on this page so it can reveal its own
  // search once the hero scrolls out of view.
  // Re-apply a previously-used area from the suggestions quick-select.
  const applyRecentLocation = useCallback((loc: { province: Geo; ward: Geo | null }) => {
    commitView()
    setNearby(null)
    setActiveProvince(loc.province)
    setActiveWard(loc.ward)
    // A place replaces a place — a picked or typed district included (pickDistrictFromArea).
    if (!districtSurvivesArea({ province: loc.province, ward: loc.ward, nearby: null })) replaceDistrictRef.current('all')
    setShowExplorer(true)
    setShowSuggestions(false)
  }, [])

  useEffect(() => {
    const onSearch = (e: Event) => {
      const q = (e as CustomEvent<{ query?: string }>).detail?.query ?? ''
      handleLandingSearch(q)
      document.getElementById('listings')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
    }
    // Visual search applied from the header camera button (on the explorer page).
    const onVisual = (e: Event) => {
      const d = (e as CustomEvent<{ query: string; category?: string | null; brand?: string | null }>).detail
      if (d) applyVisualSearch(d)
      document.getElementById('listings')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
    }
    window.addEventListener('eno:visual-search', onVisual)
    // Area filter (district + "near you") applied from the header search bar.
    const onArea = (e: Event) => {
      const d = (e as CustomEvent<{ province?: Geo | null; ward?: Geo | null; nearby?: Nearby | null }>).detail
      commitView() // an area picked from the header is a step Back undoes (NAV-1)
      setActiveProvince(d?.province ?? null)
      setActiveWard(d?.ward ?? null)
      setNearby(d?.nearby ?? null)
      // A ward, a radius or another province replaces a district — picked OR typed into the box
      // (districtSurvivesArea; pickDistrictFromArea strips a typed one the server applied).
      if (!districtSurvivesArea({ province: d?.province ?? null, ward: d?.ward ?? null, nearby: d?.nearby ?? null })) replaceDistrictRef.current('all')
      setShowExplorer(true)
      document.getElementById('listings')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
    }
    // ⚠️ THE HEADER'S MAP BUTTON LANDS HERE. It was restored to the search bar on 2026-08-03, when
    // the hero search that owned the old map control was deleted. The header is a SIBLING of this
    // component, not its parent, so it cannot call setViewMode — it dispatches, exactly like
    // eno:search above. WITHOUT THIS LISTENER THE BUTTON RENDERS AND DOES NOTHING, which is a
    // failure both tsc and lint wave straight through.
    const onViewMap = () => {
      /**
       * ⛔ FROM A FEED WITH NO MAP (teachers — map-pin-rows.ts `categoryHasMap`) THE HEADER'S MAP OPENS THE MARKETPLACE MAP
       * (gate review, 2026-10-09). It is the site's "browse by map", not a view of this feed: refused, the press did
       * nothing — the view stays the default one on that feed — but snapshot a Back step and scroll the list to its top.
       * So it does what "show on map" does there (`locateOnMap`): the logo's reset plus the map, as ONE step Back undoes
       * (`commitView` snapshots the teachers feed first). Off the explorer, header.tsx sends /c/teachers to the same
       * unfiltered map, so the two agree.
       */
      if (!mapOfferedRef.current) {
        commitView()
        resetToLandingPage()
        setActiveProvince(null)
        setActiveWard(null)
        setNearby(null)
      } else if (viewModeRef.current !== 'map') commitView() // into the map is a step Back undoes (NAV-1)
      setViewMode('map')
      setShowExplorer(true)
      // ⚠️ SCROLL AFTER THE RE-RENDER, NOT DURING IT. This used to be about the node being
      // REPLACED — `id="listings"` existed in both branches, so the lookup found the landing
      // section that setShowExplorer was about to swap out. Since the 2026-08-11 merge there is
      // one section and one id, and the rAF is still required for the same underlying reason:
      // setViewMode('map') + setShowExplorer(true) are batched, and BOTH move this section's
      // offset (the promo banner, the value strip, the big tile grid and the discovery shelves
      // all unmount, and a 60dvh map mounts). A smooth scroll started in this tick aims at an
      // offset that stops being true one commit later.
      requestAnimationFrame(() => {
        document.getElementById('listings')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
      })
    }
    window.addEventListener('eno:view-map', onViewMap)
    window.addEventListener('eno:search', onSearch)
    window.addEventListener('eno:set-area', onArea)
    // Consume a pending off-explorer area pick (header stashes it before navigating
    // here — the live event would have fired before this listener existed).
    try {
      const raw = sessionStorage.getItem('eno:pending-area')
      if (raw) {
        sessionStorage.removeItem('eno:pending-area')
        const d = JSON.parse(raw) as { province?: Geo | null; ward?: Geo | null; nearby?: Nearby | null }
        setActiveProvince(d?.province ?? null)
        setActiveWard(d?.ward ?? null)
        setNearby(d?.nearby ?? null)
        if (!districtSurvivesArea({ province: d?.province ?? null, ward: d?.ward ?? null, nearby: d?.nearby ?? null })) replaceDistrictRef.current('all')
        setShowExplorer(true)
        document.getElementById('listings')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
      }
    } catch { /* malformed stash — ignore */ }
    return () => {
      window.removeEventListener('eno:visual-search', onVisual)
      window.removeEventListener('eno:view-map', onViewMap)
      window.removeEventListener('eno:search', onSearch)
      window.removeEventListener('eno:set-area', onArea)
    }
  }, [handleLandingSearch, applyVisualSearch, resetToLandingPage]) // resetToLandingPage is stable (useCallback)

  // ⚠️ HEADER CONTRACT — DO NOT DELETE THIS DISPATCH. header.tsx listens for `eno:hero` and
  // changes its own chrome on it: `present: true` makes it attach an IntersectionObserver to
  // #eno-hero-search and reveal its search bar once that element scrolls past; `present: false`
  // makes it detach and show the bar outright. Today BOTH paths end at showSearch=true, because
  // no element with that id exists any more (the hero bar moved into the header on 2026-08-03) —
  // so the event is currently inert, and that is exactly why it must not be "cleaned up": the
  // day a hero search returns, this is the wire that keeps the header from double-rendering one.
  // The payload now tracks showDiscovery rather than isLandingMode, which is the honest reading
  // of "is the hero chrome on screen" — and is indistinguishable to the header while the id is
  // absent. If a hero input is ever re-added, add it to the DISCOVERY block or this lies.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('eno:hero', { detail: { present: showDiscovery } }))
  }, [showDiscovery])

  // '/' and ⌘/Ctrl+K focus the search input (extracted).
  useSearchShortcuts(setShowSuggestions)

  const handleCategorySelect = (slug: string) => {
    commitView() // a category tile is a step Back undoes (NAV-1)
    setLooseMatch(false)
    setActiveCategory(slug)
    setActiveSubcategory('all')
    setActiveBrand('all'); setActiveLine('')
    setActiveModel('all')
    setCustomFilters({})
    setPriceRange('all') // price brackets are category-specific
  }

  // Parse a query-string into the explorer's filter state. Shared by the mount/popstate
  // reader and the notification deep-link handler below.
  // ⚠️ THE READING IS `readExplorerUrl` (src/lib/explorer-url.ts) — the same function a client-side
  // mount seeds its initial state from, so the two can never read one URL two ways. This only sets
  // what it returns; the per-axis rules (district-stripped words, `match=any`, the `deal=good`
  // allowlist, the sort allowlist, the offered-facets-only custom filters) live and are tested there.
  // The view is deliberately not applied here: `?view=` has its own mount reader (it also restores
  // the Video feed), exactly as before.
  const applyParams = useCallback((raw: URLSearchParams) => {
    const u = readExplorerUrl(raw)
    setQuery(u.query)
    // ⛔ A URL'S WORDS SKIP THE DEBOUNCE (E-SSR, 2026-09-29). The 150ms exists for TYPING; a URL is a
    // discrete commit (a deep link, Back/Forward, a notification), exactly like an area pick
    // (pickDistrictFromArea). Without this a cold /?q= deep link sent its first request a further
    // 150ms after hydration — with the unfiltered seed still on screen for all of it.
    setDebouncedQuery(u.query)
    setLooseMatch(u.looseMatch)
    setActiveCategory(u.category)
    setActiveDistrict(u.district)
    setActiveSubcategory(u.subcategory)
    setActiveBrand(u.brand)
    setActiveModel(u.model)
    setActiveLine(u.line)
    setListingType(u.listingType)
    setConditionFilter(u.condition)
    setGoodPriceOnly(u.goodPrice)
    // Sort is shareable/back-button state like any filter (see SortKey).
    setSort(u.sort)
    setPriceRange(u.priceRange)
    setCustomFilters(u.customFilters)
  }, [])

  /**
   * Put an area in place (UX3 NAV-2) — the URL's or an entry's. Each axis keeps its current object when the
   * code (or circle) is the same, so re-applying the area already held re-renders nothing.
   */
  const applyArea = useCallback((a: AreaState) => {
    setActiveProvince((p) => (p?.code === a.province?.code ? p : a.province))
    setActiveWard((w) => (w?.code === a.ward?.code ? w : a.ward))
    setNearby((n) => (sameNearby(n, a.nearby) ? n : a.nearby))
  }, [])

  /** The view (URL + stamp, back-to-close.ts `viewStamp`) this explorer last wrote or arrived at — "did Back
   *  change the view, or only close a layer?" */
  const lastStampRef = useRef<string | null>(null)
  /** Bumped when the URL no longer says what the state is and nothing in the state changed — the writer re-runs. */
  const [urlNudge, setUrlNudge] = useState(0)
  /**
   * A URL's ward still being looked up (/api/geo) on a mount or a Back that applied its province already.
   * While it is, the URL writer keeps `?ward=` (or the look-up would erase the very link it is resolving),
   * and the answer applies only if nothing has replaced the place since (a pick, another Back).
   */
  const pendingWardRef = useRef<{ province: string; ward: string } | null>(null)
  const activeProvinceCodeRef = useRef<string | null>(activeProvince?.code ?? null)
  useEffect(() => { activeProvinceCodeRef.current = activeProvince?.code ?? null }, [activeProvince?.code])

  // URL state synchronization: Read from URL on mount and on popstate
  useEffect(() => {
    let cancelled = false
    /** One location, applied: its params, its area (when it names one), and on Back/Forward its view. */
    const applyLocation = (search: string, area: AreaState | null, withView: boolean) => {
      const raw = new URLSearchParams(search)
      applyParams(raw)
      if (area) applyArea(area)
      if (withView) {
        // ⛔ THE VIEW IS PART OF WHAT BACK RESTORES NOW (UX3 NAV-1): the map ⇄ list switch pushes an entry, so
        // Back from the map must land on the list (and vice versa). `?view=` is written for every non-grid
        // view, so its absence IS the grid. Same opening rule as the mount reader below for map.
        // ⛔ BUT VIDEO ONLY ON THE TAKEOVER'S OWN ENTRY (review): the Video chunk loads lazily, so `?view=video`
        // is written onto the entry UNDER the takeover before the takeover pushes its own; closing it pops
        // back onto that entry, and re-opening the video from its URL looped ✕ → reopen forever. The video
        // view's own close already put the right view back; the takeover's entry carries `takeover`.
        const v = readExplorerUrl(raw).view
        const takeover = (window.history.state as { takeover?: unknown } | null)?.takeover === 'video'
        if (v !== 'video' || takeover) {
          setViewMode(v ?? DEFAULT_VIEW)
          if (v === 'map' || v === 'video') setShowExplorer(true)
        } else {
          // …and that entry's URL still says `view=video`: have the writer put the view on screen back into it,
          // or a reload of this entry would open the takeover again.
          setUrlNudge((n) => n + 1)
        }
      }
    }
    /** A ward this document has not seen yet: fetched, and applied only if its place still stands (`pendingWardRef`). */
    const wardLater = (pending: { province: string; ward: string }) => {
      pendingWardRef.current = pending
      void resolveWard(pending.province, pending.ward).then((ward) => {
        if (cancelled || pendingWardRef.current !== pending) return
        pendingWardRef.current = null
        if (ward && activeProvinceCodeRef.current === pending.province) setActiveWard((w) => (w?.code === ward.code ? w : ward))
      })
    }

    // ── MOUNT ──
    // E-SSR: the pre-paint script marked a directed URL — hold the mask until this URL's answer lands.
    // Anything else (a client mount, or no mark) must not leave one behind.
    const root = document.documentElement
    const masked = coldLoad && root.hasAttribute('data-explorer-directed')
    if (!masked) root.removeAttribute('data-explorer-directed')
    const mountSearch = window.location.search
    const found = areaForLocation(readExplorerUrl(mountSearch), window.history.state)
    /** The URL is read (once): its params applied, the writer released, the mask armed for its answer. */
    let mounted = false
    const settleMount = () => {
      if (mounted) return false
      mounted = true
      setUrlApplied(true) // batched with the params: the render that applies them knows it (see `foldArmed`)
      if (masked) { setAwaitingUrlAnswer(true); setSeedMasked(true) }
      return true
    }
    const applyMount = (area: AreaState | null) => {
      if (mounted) return // a Back already applied a newer location (below)
      applyLocation(mountSearch, area, false)
      settleMount()
    }
    if (coldLoad && found?.wardPending) {
      /**
       * ⛔ A COLD LINK TO A WARD THIS DOCUMENT HAS NOT SEEN (NAV-2): its name comes from /api/geo, so the WHOLE
       * URL is applied once it is known — not the province now and the ward later, which would fetch, paint
       * and unmask the province's answer and then replace it. The seed stays masked and inert meanwhile
       * (`seedMasked`), and the URL writer waits for `urlApplied`, so nothing rewrites the link either.
       * 2.5s at most: a ward /api/geo does not know is dropped and the rest of the URL still applies.
       * ⛔ A SLOW ANSWER IS NOT A MISSING WARD (codex, gate 2026-10-05): past 2.5 s the rest of the URL applies
       * now and the ward goes on as `wardLater` — `?ward=` stays in the address and the ward lands when its
       * answer does (unless the reader has picked another place by then), instead of a link silently broadened.
       */
      if (masked) setSeedMasked(true)
      const pending = found.wardPending
      void Promise.race([
        resolveWard(pending.province, pending.ward).then((ward) => ({ ward, late: false })),
        new Promise<{ ward: null; late: true }>((r) => setTimeout(() => r({ ward: null, late: true }), 2500)),
      ]).then(({ ward, late }) => {
        if (cancelled) return
        applyMount({ ...found.area, ward: ward ?? null })
        if (late) wardLater(pending)
      })
    } else {
      applyMount(found?.area ?? null)
      if (found?.wardPending) wardLater(found.wardPending)
    }
    lastStampRef.current = viewStamp()

    // ── BACK / FORWARD ──
    const onPop = () => {
      // A Back while a cold ward link is still being looked up supersedes it: this location is the newer one.
      settleMount()
      const st = window.history.state
      const stamp = viewStamp()
      const viewChanged = stamp !== lastStampRef.current
      lastStampRef.current = stamp
      // A layer popping its OWN untouched entry (back-to-close.ts) lands on the URL the feed already shows —
      // and if the reader tapped something meanwhile, the state here is newer than that URL. Not a Back.
      if (popIsLayerClose()) return
      if (viewChanged) {
        // ⛔ A RESTORE STILL ALIGNING IS FOR THE VIEW BEING LEFT (review): stop it on every view-changing Back,
        // or a fast second Back lands the new view at the old one's offset.
        restoreStopRef.current?.()
        // A building drill-in is map state the URL does not carry; Back leaves it, and it must go in THIS
        // render — it is part of the rows' signature, and a snapshot of the list taken without it would
        // otherwise be refused (the passive clean-up below runs too late for the restore).
        setSelectedBuilding(null)
      }
      /**
       * ⛔ THE ENTRY'S OWN SNAPSHOT PUTS THE ROWS AND THE SCROLL BACK (NAV-1) — see `entrySnaps`. One-shot,
       * and only when Back actually changed the view: a popstate onto the SAME URL is a layer (a sheet, the
       * search panel) closing over a feed that never moved, and restoring there would be a jump from nowhere.
       * The arriving entry is set to 'manual' first, so the browser's own restoration — which runs right
       * after this event, against the feed being left — cannot fight the restore; the restore hands it
       * 'auto' back when it settles (releaseFeedEntry). Not matched in the render it causes → dropped.
       */
      const id = st && typeof st === 'object' ? (st as Record<string, unknown>)[ENTRY_KEY] : null
      if (typeof id === 'string') {
        const snap = entrySnaps.get(id)
        entrySnaps.delete(id)
        if (snap && viewChanged && Date.now() - snap.ts <= ENTRY_SNAP_TTL_MS && !liveOverlayOnTop()) {
          const pending: FeedSnap = { ...snap, fromHistory: true }
          pendingSnapRef.current = pending
          try { window.history.scrollRestoration = 'manual' } catch { /* unsupported */ }
          requestAnimationFrame(() => {
            if (pendingSnapRef.current === pending) { pendingSnapRef.current = null; releaseFeedEntry() }
          })
        }
      }
      // The URL is the whole truth on Back: an area it does not name (and the entry did not record) is gone.
      pendingWardRef.current = null
      const found = areaForLocation(readExplorerUrl(window.location.search), st)
      applyLocation(window.location.search, found?.area ?? NO_AREA, true)
      if (found?.wardPending) wardLater(found.wardPending)
    }
    window.addEventListener('popstate', onPop)
    return () => {
      cancelled = true
      window.removeEventListener('popstate', onPop)
    }
  }, [applyParams, applyArea, coldLoad])

  // A notification / deep-link (e.g. a saved-search alert) routes to `/?<filters>`. When
  // we're ALREADY on the home route that's a soft <Link> nav the reader above can't see
  // (no popstate, no remount), so the bell also fires `eno:apply-url` with the target —
  // apply those filters here and switch to the results view.
  // ⚠️ EXTRACTED VERBATIM from the listener below so the pinned e-Visa tile can reuse it. This is
  // a PURE MOVE — the `eno:apply-url` listener still calls it and behaves identically. Two live
  // flows depend on that path (the notification bell's deep link and the header's brand pick), so
  // any change in behaviour here breaks them rather than this tile.
  const applyUrl = useCallback((url: string) => {
    const qs = url.includes('?') ? url.slice(url.indexOf('?') + 1) : ''
    // A typeahead pick, a notification's search, eno's own shortcut tiles: each is a view the reader asked for (NAV-1).
    commitView()
    applyParams(new URLSearchParams(qs))
    setShowExplorer(true)
    requestAnimationFrame(() => document.getElementById('listings')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' }))
  }, [applyParams])

  useEffect(() => {
    const onApply = (e: Event) => {
      const url = (e as CustomEvent<{ url?: string }>).detail?.url
      if (!url) return
      applyUrl(url)
    }
    window.addEventListener('eno:apply-url', onApply)
    return () => window.removeEventListener('eno:apply-url', onApply)
  }, [applyUrl])

  // NOTE: a plain `?q=` arrival stays a RAW text search on purpose (same convention
  // as Enter in every search bar) — brand facets only open via an explicit pick from
  // the typeahead's Brands group, a visual search, or a `?brand=` deep link.

  // Safety net for brand searches: if a brand ends up active but its category never
  // stuck (a stale/raced resolution leaves the top nav on "All"), open the brand's
  // dominant category so the rail highlights it + category facets appear. At most once
  // per brand, and it never overrides a category the user picks themselves.
  const healedBrandRef = useRef<string | null>(null)
  useEffect(() => {
    if (activeBrand === 'all' || activeModel !== 'all' || activeCategory !== 'all') return
    if (healedBrandRef.current === activeBrand) return
    healedBrandRef.current = activeBrand
    let cancelled = false
    fetch(`/api/search/resolve?q=${encodeURIComponent(activeBrand.replace(/-/g, ' '))}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d?.category) setActiveCategory((c) => (c === 'all' ? d.category : c)) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [activeBrand, activeModel, activeCategory])

  // URL state synchronization: Write back to URL as filters change
  useEffect(() => {
    /**
     * ⛔ NOT BEFORE THE URL HAS BEEN READ (UX3 NAV-2). On a cold load this effect used to run once with the
     * DEFAULT state, in the mount commit, before the reader's state had rendered — so it rewrote `/?q=honda`
     * to `/` for a moment and broadcast an empty query to the header box. Harmless while every axis was
     * re-applied a render later; not once a ward link waits for /api/geo before it applies (the reader
     * above), where that write would have erased the ward from the address bar. A client-side mount has
     * read its URL already (`urlApplied` starts true).
     */
    if (!urlApplied) return
    const params = new URLSearchParams(window.location.search)
    
    if (activeCategory !== 'all') {
      params.set('category', activeCategory)
    } else {
      params.delete('category')
      params.delete('subcategory')
    }

    if (query.trim()) {
      params.set('q', query.trim())
    } else {
      params.delete('q')
    }

    // match=any must round-trip with the query (audit P2): a visual-search URL
    // reloaded/shared without it re-runs the photo terms as a strict AND → 0 results.
    if (looseMatch && query.trim()) {
      params.set('match', 'any')
    } else {
      params.delete('match')
    }

    if (activeDistrict !== 'all') {
      params.set('district', activeDistrict)
    } else {
      params.delete('district')
    }

    if (activeSubcategory !== 'all' && activeCategory !== 'all') {
      params.set('subcategory', activeSubcategory)
    } else {
      params.delete('subcategory')
    }

    if (activeBrand !== 'all') params.set('brand', activeBrand)
    else params.delete('brand')

    if (activeModel !== 'all' && activeBrand !== 'all') params.set('model', activeModel)
    else params.delete('model')
    if (activeLine && activeBrand !== 'all') params.set('line', activeLine)
    else params.delete('line')

    if (listingType !== 'all') params.set('type', listingType)
    else params.delete('type')

    if (conditionFilter !== 'all') params.set('condition', conditionFilter)
    else params.delete('condition')

    if (goodPriceOnly) params.set('deal', 'good')
    else params.delete('deal')

    // The default relevance blend stays out of the URL so plain links keep clean.
    if (sort !== 'newest') params.set('sort', sort)
    else params.delete('sort')

    /**
     * ⛔ THE VIEW IS URL STATE TOO (E-VIEWS, 2026-09-29). `?view=` was READ on mount (the footer's Map
     * link) and never written: List view did not survive a reload or a shared link, and a stale
     * `?view=map` rode along after switching back to the grid. The default (grid) stays out of the
     * URL, like the default sort.
     */
    if (viewMode !== DEFAULT_VIEW) params.set('view', viewMode)
    else params.delete('view')

    /**
     * ⛔ THE AREA IS URL STATE TOO (UX3 NAV-2, nav audit N3) — the province and ward CODES (vn-areas.ts turns
     * them back), exactly when the feed sends them: under "near you" the API ignores both, so the URL does
     * too. ⛔ NEVER THE CIRCLE ITSELF: coordinates are personal data (PDPL) and a URL travels — Referer,
     * logs, a shared link. The circle lives in the entry's own history.state (`AREA_KEY`), so Back and
     * Forward still restore it; a reload or a shared link gets the codes, or no area at all.
     */
    if (!nearby && activeProvince) params.set('province', activeProvince.code)
    else params.delete('province')
    // A ward still being looked up keeps its place in the URL — until the province it belongs to changes.
    const lookingUp = pendingWardRef.current
    if (lookingUp && lookingUp.province !== activeProvince?.code) pendingWardRef.current = null
    if (!nearby && activeProvince && activeWard) params.set('ward', activeWard.code)
    else if (!nearby && activeProvince && pendingWardRef.current) params.set('ward', pendingWardRef.current.ward)
    else params.delete('ward')

    params.delete('priceMin'); params.delete('priceMax')
    if (priceRange !== 'all') {
      const [mn, mx] = priceRange.split('-')
      if (mn) params.set('priceMin', mn)
      if (mx) params.set('priceMax', mx)
    }

    // Clear old attr_/range_ params and set the current ones.
    Array.from(params.keys()).forEach((key) => {
      if (key.startsWith('attr_') || key.startsWith('range_')) params.delete(key)
    })
    applyFilterParams(params, customFilters, activeCategory, activeSubcategory)

    const newSearch = params.toString()
    const newUrl = newSearch ? `?${newSearch}` : window.location.pathname

    // In place, or — when the reader committed a view change (`commitView`) — one new entry. See writeExplorerEntry.
    // ⚠️ After a layer's own `history.back()` has landed, if one is on its way (a tap right after closing a
    // sheet): a push now would be cancelled by that traversal, and its popstate would undo this state.
    const commit = historyIntentRef.current
    historyIntentRef.current = false
    const area = { province: activeProvince, ward: activeWard, nearby }
    whenLayerPopSettles(() => {
      writeExplorerEntry(newUrl, area, commit)
      lastStampRef.current = viewStamp()
    })
    // replaceState bypasses Next's router, so the persistent header search bar won't
    // see the query change — broadcast it so the top bar stays in sync. When a search
    // resolved to a brand/model (no text query), show the brand label so the bar still
    // reflects what was searched (e.g. "Huawei MatePad 11").
    const brandLabel = activeBrand !== 'all'
      ? [prettyBrand(activeBrand), activeModel !== 'all' ? activeModel : null].filter(Boolean).join(' ')
      : ''
    window.dispatchEvent(new CustomEvent('eno:query', { detail: { query: query.trim() || brandLabel } }))
  }, [activeCategory, query, activeDistrict, activeSubcategory, activeBrand, activeModel, activeLine, customFilters, listingType, conditionFilter, goodPriceOnly, priceRange, sort, looseMatch, viewMode, activeProvince, activeWard, nearby, urlApplied, urlNudge])

  // Debounce search query input to avoid making API requests on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query)
    }, 150)
    return () => clearTimeout(timer)
  }, [query])

  // Reset to page 1 the MOMENT the filter/query signature changes — DURING render (React's
  // "adjust state on input change" pattern), NOT in a post-render effect. An effect reset
  // fired one render late, so the new query first refetched at the STALE page (offset>0) and
  // the list visibly reshuffled to the page-1 results — the "double-sort" search jitter.
  // Doing it here means useQuery (below) reads page=1 on the SAME render → a single offset-0
  // fetch, no flip.
  // ⛔ UNCONDITIONAL. There used to be a "skip once for the back-nav restore" exception here and it
  // is what broke the first filter change after every deep Back — see `rowsSigRef` above.
  // `looseMatch`, `answerLang` and the shop are in the signature because they are in the request
  // and the query key: a request that changes without resetting the page is exactly the bug this
  // block prevents (see `answerLang` for why en↔vi does not count; the shop changes when a
  // storefront-to-storefront navigation keeps this component mounted). `spellOn` joins them for the
  // same reason: "Search instead for …" asks the typed words from the top, not at the corrected
  // feed's depth.
  const filterSig = JSON.stringify([
    activeCategory, debouncedQuery, activeDistrict, conditionFilter, goodPriceOnly, listingType, verifiedOnly,
    sort, activeSubcategory, activeBrand, activeModel, activeLine, customFilters, priceRange, nearby,
    activeProvince?.code ?? null, activeWard?.code ?? null, selectedBuilding, looseMatch, answerLang(lang), sellerId ?? null, spellOn,
  ])
  const prevFilterSigRef = useRef(filterSig)
  if (prevFilterSigRef.current !== filterSig) {
    prevFilterSigRef.current = filterSig
    if (page !== 1) setPage(1)
  }

  /**
   * ⛔ EVERY QUERY STARTS HERE SO NONE OF THEM CAN FORGET THE SHOP. On a storefront the seller
   * scope is not one filter among many — it is the boundary of the page, and a request that omits
   * it returns the WHOLE marketplace under the shop's own domain. There are four fetch sites in
   * this component (grid, prefetch, histogram, video probe) and this file already records what
   * happens when one of several call sites drops a parameter the others carry: the subcategory bug
   * a few lines below, where a brand selection silently widened 8 results to 44. Seeding the
   * builder is the version of that fix which a fifth fetch site inherits for free.
   * ⚠️ ON THE MARKETPLACE `sellerId` IS UNDEFINED and this returns an empty set of params, so the
   * home page's queries are byte-identical to what they were.
   */
  const scopedParams = useCallback(
    () => new URLSearchParams(sellerId ? { seller: sellerId } : undefined),
    [sellerId],
  )

  // Fetch listings dynamically from API on parameter/page modifications using React Query SWR cache
  // The current filters as URL query params, WITHOUT paging — the single source of truth for
  // both the grid query below and the Video feed (which appends hasVideo + its own paging).
  const baseParamsString = useMemo(() => {
    const params = scopedParams()
    /**
     * ⛔ THE SUBCATEGORY IS SENT WHATEVER ELSE IS PICKED. It used to live only in the no-brand
     * branch, so choosing a brand SILENTLY DROPPED IT: owner, 2026-08-25 — "i look for cases for
     * iphone 16 pro max. i select electronics cases apple iphone 16 promax it should show only
     * iphone 16 pro max cases". Measured on production: the rail, the breadcrumb and the URL all
     * kept `subcategory=phone-cases`, while the request went out as
     * `brand=apple&model=iPad+Pro&category=electronics` and returned 44 instead of 8. Nothing on
     * screen contradicted itself — the filter simply was not applied — which is the hardest kind
     * of wrong to notice.
     * ⚠️ The hierarchy is category → subcategory → brand → model, and every level a person has
     * explicitly chosen must AND with the rest.
     */
    if (activeSubcategory !== 'all') params.set('subcategory', activeSubcategory)
    if (activeBrand !== 'all') {
      params.set('brand', activeBrand)
      if (activeLine) params.set('line', activeLine)
      if (activeModel !== 'all') {
        params.set('model', activeModel)
        if (activeCategory !== 'all') params.set('category', activeCategory)
      } else if (activeCategory !== 'all') {
        /**
         * A bare brand search is deliberately SOFT on category — `priorityCategory` boosts rather
         * than filters, so "Apple" does not hide Apple listings that sit elsewhere.
         * ⚠️ But an explicit subcategory is not a guess: once someone has picked "Cases & covers",
         * the category it belongs to is implied and must filter hard, or a soft boost lets other
         * categories' listings back in underneath the chosen subcategory.
         */
        params.set(activeSubcategory !== 'all' ? 'category' : 'priorityCategory', activeCategory)
      }
    } else if (activeCategory !== 'all') {
      params.set('category', activeCategory)
    }
    // Language in the CACHE KEY (audit P2): the response body varies on language for
    // non-en/vi viewers, but the edge caches by URL — a ru/ko variant could poison the
    // shared entry for everyone. en/vi (the vast majority) send nothing and share one
    // deterministic cached variant.
    if (lang !== 'en' && lang !== 'vi') params.set('lang', lang)
    if (!nearby && activeDistrict !== 'all') params.set('district', activeDistrict)
    if (!nearby && activeProvince) params.set('province', activeProvince.nameEn)
    if (!nearby && activeWard) params.set('ward', activeWard.nameEn)
    /**
     * ⛔ THE AREA IS A SERVER FILTER NOW. It used to exist only in the browser: the page size was
     * raised to 100, pagination was switched off, and those hundred rows were haversine-filtered —
     * so an area search on 19,359 listings silently considered page one and nothing else. These
     * three params put the same question to the database, where it can see every row.
     */
    if (nearby) {
      params.set('lat', String(nearby.lat))
      params.set('lng', String(nearby.lng))
      params.set('radiusKm', String(nearby.radiusKm))
    }
    if (conditionFilter !== 'all') params.set('condition', conditionFilter)
    if (goodPriceOnly) params.set('deal', 'good')
    if (listingType !== 'all') params.set('type', listingType)
    if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim())
    if (looseMatch && debouncedQuery.trim()) params.set('match', 'any')
    params.set('sort', sort)
    params.set('verified', verifiedOnly ? 'true' : 'all')
    if (priceRange !== 'all') {
      const [mn, mx] = priceRange.split('-')
      if (mn) params.set('priceMin', mn)
      if (mx) params.set('priceMax', mx)
    }
    applyFilterParams(params, customFilters, activeCategory, activeSubcategory)
    return params.toString()
    // ⚠️ `scopedParams` IS A DEPENDENCY, not decoration: it carries the shop. Omitting it would
    // memoise the marketplace's params on a storefront's first render and never widen them again.
  }, [scopedParams, activeBrand, activeModel, activeLine, activeCategory, activeSubcategory, nearby, activeDistrict, activeProvince, activeWard, conditionFilter, goodPriceOnly, listingType, debouncedQuery, looseMatch, sort, verifiedOnly, priceRange, customFilters, lang])

  /**
   * ⛔ ONE KEY BUILDER FOR EVERY PAGE OF THE FEED — the live query below AND `prefetchNextPage` read it.
   * The prefetch used to hand-copy this object and had drifted: it carried no `match`, so its key never
   * equalled the live one and every page was downloaded TWICE — measured on production, offsets 12…96
   * each requested twice within ~200ms, on the phone connections where the next page is already slow.
   * A key written once cannot drift; `page` is the only thing the two callers vary.
   * ⚠️ `resultSetSig` reads this same object (minus `page`), so the snapshot provenance and the append
   * guard stay keyed on exactly what the request asks for.
   */
  const feedKeyFields = useMemo(() => (
    {
      // ⛔ THE SHOP IS PART OF THE REQUEST (`scopedParams`), SO IT IS PART OF THE KEY — the same class
      // as `line` and `near` below: without it two storefronts' feeds shared cache entries, and
      // `resultSetSig` could not tell their pages apart. `null` on the marketplace.
      seller: sellerId ?? null,
      category: activeCategory,
      subcategory: activeSubcategory,
      brand: activeBrand,
      model: activeModel,
      /**
       * ⛔ `line` IS PART OF THE KEY BECAUSE IT IS PART OF THE REQUEST. Without it, changing only
       * the cascade's line or generation produced the SAME cache key: the fetch went out and came
       * back correct (measured: `?line=iPhone 20` returns 1), and react-query served the previous
       * payload anyway — so the feed sat at 978 iPhones under a selected "iPhone 20 1" chip. It
       * reads as "the filter does nothing", and it is worst exactly where the new result is
       * SMALLEST, because a large overlap hides the staleness.
       * Same class as `lang` below, which this file already documents.
       */
      line: activeLine,
      district: activeDistrict,
      province: activeProvince?.code ?? null,
      ward: activeWard?.code ?? null,
      /**
       * ⛔ THE CIRCLE, NOT "IS THERE A CIRCLE". This was `nearby ? 1 : 0` while the request sends
       * `lat`/`lng`/`radiusKm`, so widening "Near you" from 5 km to 10 km produced the SAME key:
       * no request went out and the 5 km rows sat under a "Within 10 km" chip (measured in
       * listings-explorer.back-nav-filter.test.tsx). Same class as `line` above. The prefetch
       * key below carries the same value — both keys or neither.
       */
      near: nearby ? [nearby.lat, nearby.lng, nearby.radiusKm] : 0,
      condition: conditionFilter,
      deal: goodPriceOnly ? 'good' : 'all',
      type: listingType,
      q: debouncedQuery,
      // The spelling opt-in (see `literalFor`): the corrected set and the literal answer are two keys.
      spell: spellOn,
      match: looseMatch ? 'any' : 'all',
      sort,
      verified: verifiedOnly ? 'true' : 'all',
      price: priceRange,
      building: selectedBuilding,
      customFilters,
      // ⛔ `lang` IS PART OF THE KEY BECAUSE IT IS NOW PART OF THE RESPONSE. The feed used to
      // carry titles in every prewarmed language, so an in-place language switch could re-render
      // from the SAME cached payload. Asking the server for one language (21% smaller) makes the
      // response language-specific — and a key that ignores it would leave a Korean reader
      // looking at the English titles react-query already had, with no refetch to correct it.
      // Caught in review before it shipped; a language switch is rare, so the extra fetch is free.
      lang,
    }
  ), [
    sellerId, activeCategory, activeSubcategory, activeBrand, activeModel, activeLine, activeDistrict,
    activeProvince?.code, activeWard?.code, nearby, conditionFilter, goodPriceOnly, listingType, debouncedQuery,
    spellOn, looseMatch, sort, verifiedOnly, priceRange, selectedBuilding, customFilters, lang,
  ])
  const feedKey = useCallback((p: number) => ['listings', { ...feedKeyFields, page: p }] as const, [feedKeyFields])
  // The feed query's key, named so `resultSetSig` can read the same object the query is keyed on.
  const listingsQueryKey = feedKey(page)
  /**
   * ⛔ ONE FETCHER FOR EVERY PAGE, FOR THE SAME REASON AS `feedKey`. The prefetch used to build its own
   * params by hand, and they had drifted too: with a brand picked it dropped `subcategory`, and it never
   * sent `match=any`. That was harmless only BECAUSE its key never matched — the rows it fetched were
   * never read. With one key, whatever the prefetch fetches IS the live page, so it must be the live
   * request, byte for byte, and carry the same `fetchedFor` provenance stamp.
   * The page comes from the KEY, not from the closure: a prefetch of page N+1 and the live page N are
   * built by the same function in the same render.
   */
  const fetchFeedPage = useCallback(async ({ queryKey }: { queryKey: readonly unknown[] }) => {
      const pageNo = (queryKey[1] as { page: number }).page
      // Structural filters come from the shared memo; only paging is per-query here.
      // "Near you" ignores area filters and pulls a broad set to distance-filter client-side.
      const params = new URLSearchParams(baseParamsString)
      // ⚠️ ORDINARY PAGE SIZE EVEN WITH AN AREA SET. The 100 existed only to give the old
      // client-side filter enough rows to sieve; with the filter in the database an area search
      // paginates like any other.
      const limit = FIRST_PAGE_SIZE
      const offset = (pageNo - 1) * limit
      params.set('limit', String(limit))
      params.set('offset', String(offset))
      // ⛔ THE VIEWER'S LANGUAGE, AND IT IS A PAYLOAD FIX, NOT A CORRECTNESS ONE. Without `lang`
      // the feed route attaches `titleI18n` for EVERY prewarmed language — measured on
      // /api/listings?limit=24: nine of them (zh-Hans, ko, ja, ru, fr, km, hi, ms, th), 7,924 of
      // 38,618 bytes, 21% of the response, to a reader who needs one. `localizeListingTitles`
      // already takes `onlyLang` and early-returns for en/vi (both titles are in the row), so an
      // English or Vietnamese viewer now receives NONE of it. The one-listing focus fetch below
      // has always done this; the two feed fetches — the ones every visitor pays on every page —
      // did not.
      params.set('lang', lang)
      // A worded feed opts in to the zero-result spelling correction on EVERY page (see `literalFor`):
      // the route repeats its decision per page, so page 2 of "iphnoe" is page 2 of "iphone".
      if (spellOn) params.set('spell', '1')
        /**
         * Drill-in to one BUILDING. Applied server-side by `buildFeedFilters`, the same builder
         * /api/listings/buildings uses for its counts — so the pin that says 157 and the list it
         * opens cannot disagree.
         * ⛔ THIS MUST BE ON THE LIVE QUERY, NOT ONLY THE PREFETCH. It was added to the prefetch's
         * queryFn by mistake: the key changed on select so the feed REFETCHED, but without this
         * line the request went out unfiltered — the pin highlighted and the list never moved,
         * which is exactly what "clicking a building does nothing" looked like.
         */
        if (selectedBuilding) params.set('building', selectedBuilding)

      const res = await fetch(`/api/listings?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch listings')
      /**
       * ⛔ STAMP WHAT THIS PAYLOAD WAS FETCHED FOR. `placeholderData` below hands the PREVIOUS
       * query's rows to the next render, and nothing else on screen records which filters those
       * rows belong to — so the stale-category guard downstream would have to infer it. Inferring
       * it from the first row's own category is wrong (a mixed "all" set can start with a row of
       * the category you just picked), and recording it in a ref written during render is a
       * purity violation a reviewer rightly flagged. The payload carrying its own provenance is
       * both exact and pure: it survives `placeholderData` because it IS the data.
       * ⚠️ NOT A RACE, THOUGH IT READS LIKE ONE. A reviewer argued that reading `activeCategory`
       * after the `await` stamps the NEW category onto an OLD in-flight response. It does not:
       * this `queryFn` is a fresh closure whenever the category changes (its `useCallback` deps) and
       * captures the value current when the request STARTED, so a
       * request started under Services keeps stamping `services` however many times the reader
       * taps afterwards. Changing this to read from a ref WOULD introduce the bug described.
       * `sig` is the result set (see `resultSetSig`), for the sync effect's append guard and the
       * back-nav snapshot — see `rowsSigRef`. It comes from THIS request's own key.
       */
      return { ...(await res.json()), fetchedFor: { category: activeCategory, subcategory: activeSubcategory, sig: resultSetSig(queryKey) } }
  }, [baseParamsString, lang, spellOn, selectedBuilding, activeCategory, activeSubcategory])
  /** The result set the CURRENT key asks for — the provenance of any non-placeholder answer. */
  const liveSig = resultSetSig(listingsQueryKey)
  const { data: listingsData, isLoading: queryLoading, isFetching: queryFetching, isPlaceholderData: queryShowingStaleSet, isError: queryError, isPaused: queryPaused, refetch: refetchListings } = useQuery({
    queryKey: listingsQueryKey,
    queryFn: fetchFeedPage,
    placeholderData: (previousData) => previousData,
    // Seed the DEFAULT view (page 1, no filters) with the server-rendered data so
    // React Query treats it as fresh (global staleTime 30s) and skips the
    // redundant /api/listings refetch on mount. Strictly gated — filtered/sorted
    // views get no seed and fetch normally. Must match the /api/listings shape.
    initialData:
      page === 1 && activeCategory === 'all' && activeSubcategory === 'all' &&
      activeBrand === 'all' && activeModel === 'all' &&
      activeDistrict === 'all' && conditionFilter === 'all' && !goodPriceOnly && priceRange === 'all' &&
      listingType === 'all' &&
      // ⛔ AND NO AREA (NAV-2): a province, ward or near-you circle is part of the key, and the seed is the
      // whole catalogue — seeding an area's key with it painted the unfiltered rows as that area's answer
      // (and, within 30s of the ISR render, kept them: the seed reads as fresh). Same gate as isSeededFeed.
      !activeProvince && !activeWard && !nearby &&
      sort === 'newest' && verifiedOnly && !debouncedQuery.trim() &&
      Object.keys(customFilters).length === 0
        ? { listings: initialListings, total: initialTotal ?? initialListings.length, subcategoryCounts: {}, categoryTotal: 0 }
        : undefined,
    initialDataUpdatedAt: seedFetchedAt,
  })

  // First-render adoption of a diverged cache (setState-during-render — React's derived-state
  // pattern; re-renders synchronously BEFORE paint). On back-nav to the home explorer the
  // query cache usually holds FRESHER rows than the ISR seed (the honest initialDataUpdatedAt
  // above makes background revalidation the norm), but `listings` state re-initializes from
  // the seed and the sync effect below only swaps AFTER paint → one visible frame of stale
  // rows reshuffling. Adopt the cache synchronously instead. First visit is a no-op: the
  // cache is empty, so useQuery adopts initialData and `listingsData.listings` IS the
  // initialListings reference.
  const adoptedCacheRef = useRef(false)
  if (
    !adoptedCacheRef.current && listingsData && page === 1 &&
    listings === initialListings && listingsData.listings !== initialListings
  ) {
    adoptedCacheRef.current = true
    setListings(listingsData.listings)
  }
  /**
   * THE SAME ADOPTION FOR A MOUNT THAT DID NOT START ON THE SEED (`startedOffSeed`, E-BACK) — the check
   * above keys on the seed's reference, which such a mount never holds. Its rows start EMPTY, so
   * without this a react-query cache that already answers the URL (Back, with no snapshot to restore —
   * a card opened from a rail) would paint "No listings match these filters." for the one frame before
   * the sync effect adopts the rows. Only a real page-1 answer to the CURRENT key is taken, and the
   * count comes with it, for the same reason the sync effect never splits the two.
   * ⚠️ One-shot, like the check above: it fires at most once, in the first render that holds an answer
   * while the rows are still empty (a restored snapshot is never empty, so it never fires over one).
   * After that the sync effect owns `listings`, and its page-1 updater re-adopts the same array.
   */
  const adoptedOffSeedRef = useRef(false)
  if (
    startedOffSeed && !adoptedOffSeedRef.current && listingsData && !queryShowingStaleSet && page === 1 &&
    listings.length === 0 && (listingsData.offset ?? 0) === 0 && listingsData.listings.length > 0
  ) {
    adoptedOffSeedRef.current = true
    setListings(listingsData.listings)
    setTotalCount(listingsData.total)
  }

  /**
   * ⛔ THE DISTRICT THE SERVER READ OUT OF THE WORDS, AS THE SERVER SAID IT — never re-derived here.
   * The feed may decline a reading the parser makes: an explicit district wins, and a reading that
   * finds nothing where the plain words find something is dropped (resolveFeedFilters in
   * feed-query.ts, verifier 2026-09-24: "Hồi ức Phú Nhuận", a book, went 46 → 0 as Phú Nhuận). A chip
   * recomputed in the browser would then name a district the results are not in. So the chip reads
   * the response's `inferredDistrict`, remembered with the words and the district param it answered,
   * and shows no district chip for words the server has not answered yet.
   * ⚠️ NOT WHILE `placeholderData` IS SHOWING: that is the PREVIOUS key's payload — another query's
   * answer. A sort or page change keeps the same words and district, so the remembered answer still
   * matches them and the chip does not flicker while the new page loads.
   */
  const districtParamSent = !nearby && activeDistrict !== 'all' ? activeDistrict : ''
  const [serverDistrict, setServerDistrict] = useState<{ q: string; sent: string; slug: string | null } | null>(null)
  useEffect(() => {
    if (!listingsData || queryShowingStaleSet) return
    const slug = (listingsData as { inferredDistrict?: string | null }).inferredDistrict ?? null
    setServerDistrict({ q: debouncedQuery.trim(), sent: districtParamSent, slug })
  }, [listingsData, queryShowingStaleSet, debouncedQuery, districtParamSent])
  const serverInferredDistrict =
    serverDistrict && serverDistrict.q === debouncedQuery.trim() && serverDistrict.sent === districtParamSent ? serverDistrict.slug : null

  /**
   * THE SPELLING THE SERVER ANSWERED FOR, AS THE SERVER SAID IT (`correctedQuery`, folded — "iphone") —
   * read exactly like `inferredDistrict` above, for the same reasons: remembered with the words and the
   * opt-in it answered, never while `placeholderData` (another key's payload) is showing, and held
   * across a load-more so the line does not flicker while the next page arrives. `null` = the words
   * were searched as typed.
   * ⛔ THE CORRECTED ROWS NEVER PAINT WITHOUT THIS LINE, AND READING IT IN RENDER DOES NOT CHANGE THAT
   * (review claim, MEASURED AND REFUTED 2026-09-29). This effect runs in the same passive flush as the
   * rows sync effect, so the line commits WITH the rows state — and the grid draws a
   * `useDeferredValue` copy of those rows, so the line is on screen a commit BEFORE the corrected cards,
   * never after. Per-frame trace (mocked /api/listings, typed "sofaa" over a "honda" feed, 1440 and
   * 390): `line | old cards` → `line | corrected cards`, never `no line | corrected cards`. Reading
   * `listingsData` in render was tried and measured identical (same frames, CLS 0.0129 at 1440 and
   * 0.028 at 390, both ways), while showing the line one commit earlier over the old cards — so it
   * was removed. That CLS is the cost of inserting a 20px line + the column gap above the results,
   * which no ordering removes; it is paid only on a corrected search.
   * ⛔ AND IT DOES NOT LEAVE BEFORE THEM EITHER (review, 2026-09-29 — the reviewer's per-frame trace on :3300, 300ms stub).
   * This used to be gated on `spellOn` too, so "Search instead for …" dropped the line in the tap's
   * own render while `placeholderData` kept the corrected cards and "499 listings" on screen, dimmed
   * and unexplained, for the whole literal round trip. `spellOn` is the REQUEST; what the rows on
   * screen are is `serverCorrection`, which only an answer rewrites — so the line stays until the
   * literal answer replaces them, and it leaves in the same flush as the rows (the literal answer is
   * zero, and the grid is unmounted on `shownListings`, not its deferred copy, so no card outlives it).
   */
  const [serverCorrection, setServerCorrection] = useState<{ q: string; spell: boolean; to: string | null } | null>(null)
  useEffect(() => {
    if (!listingsData || queryShowingStaleSet) return
    const to = (listingsData as { correctedQuery?: string | null }).correctedQuery ?? null
    setServerCorrection({ q: spellTerm, spell: spellOn, to })
  }, [listingsData, queryShowingStaleSet, spellTerm, spellOn])
  const correctedQuery =
    serverCorrection && serverCorrection.spell && serverCorrection.q === spellTerm ? serverCorrection.to : null

  /**
   * The Area panel's district pick (and every area pick that REPLACES the district — the facet bar
   * calls this with 'all' then, see districtSurvivesArea). ⚠️ A PLACE REPLACES A PLACE, TYPED ONES
   * INCLUDED: a district the server read out of the search box would otherwise stay applied under
   * the new pick — beside an explicit district it is ignored while its chip still shows it, beside a
   * ward it ANDs into an empty feed — so its words leave the box (the district chip's own clear).
   *
   * ⛔ AND THE WORDS LEAVE THE FETCHER'S COPY IN THE SAME COMMIT (mobile audit, 2026-09-24). The pick
   * sets the district at once, but the words used to reach `debouncedQuery` — what the fetch, the chips
   * and the Area pill read — 150ms later. For that window the chips showed the old "Quận 7" text chip
   * beside the new District 7 chip (two chips for ~134ms, two layout shifts, measured), and one request
   * went out pairing the new district with the old words. The debounce exists for TYPING; a place pick
   * is a discrete commit, so it skips it and everything moves together. The box itself still takes the
   * updater form: if it moved in the same tick, the debounce effect reconciles the copy as before.
   */
  const pickDistrictFromArea = useCallback((slug: string) => {
    setActiveDistrict(slug)
    // Read from the LIVE box: newer typing is never overwritten with older words (explorer-place.ts).
    setQuery((live) => queryAfterAreaPick(live, debouncedQuery, slug, serverInferredDistrict))
    setDebouncedQuery(queryAfterAreaPick(query, debouncedQuery, slug, serverInferredDistrict))
  }, [query, debouncedQuery, serverInferredDistrict])
  // The header's area events and the recent-location chips are registered once; they reach the
  // CURRENT replace rule through this ref (synced in an effect, never assigned during render).
  const replaceDistrictRef = useRef(pickDistrictFromArea)
  useEffect(() => { replaceDistrictRef.current = pickDistrictFromArea }, [pickDistrictFromArea])

  // Does the feed on screen have ANY video listings? Gates the ▷ Video view toggle — with zero
  // videos the takeover is a guaranteed dead end, so the tab stays hidden until at least
  // one exists (filter-scoped since E-VIEWS — see the query below).
  // Perf Phase 1: this probe is display-only (shows the ▷ toggle) — keep it out of
  // the critical cold path; run it in the first post-load idle slot instead.
  const [videoProbeReady, setVideoProbeReady] = useState(false)
  useEffect(() => {
    const arm = () => setVideoProbeReady(true)
    if (typeof requestIdleCallback === 'function') { const id = requestIdleCallback(arm, { timeout: 10_000 }); return () => cancelIdleCallback(id) }
    const t = setTimeout(arm, 4000); return () => clearTimeout(t)
  }, [])
  /**
   * BUILDING PINS for the map view. One row per project, counted across the WHOLE filtered set —
   * not over the 24 rows currently loaded, which would print "24 units" on a 157-unit tower and
   * climb as the user scrolled. `/api/listings/buildings` shares `buildFeedFilters` with the feed,
   * so the pin count and the list it opens are answers to the same question.
   * ⚠️ Same `baseParamsString` as the feed, MINUS the drill-in: while one tower is selected the
   * other pins must stay on the map at their real sizes, or drilling in would erase the map.
   * ⚠️ Map view only — this is a second query per filter change and every other view ignores it.
   */
  const { data: buildingsData } = useQuery({
    queryKey: ['listing-buildings', baseParamsString],
    enabled: viewMode === 'map',
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch(`/api/listings/buildings?${baseParamsString}`)
      if (!res.ok) return { buildings: [] as BuildingPin[] }
      return (await res.json()) as { buildings: BuildingPin[] }
    },
  })
  /**
   * ⛔ MEMOIZED, AND NOT AS A MICRO-OPTIMISATION. `?? []` allocates a fresh array on every render,
   * and this value is in the map's marker-effect deps — so an unmemoized version tore down and
   * rebuilt every marker on every render, which looked exactly like "clicking a building does
   * nothing and the map snaps back". `mapListings` above carries the same warning for the same
   * reason; a reviewer had already paid for that lesson once.
   */
  /**
   * ⛔ STALE ROWS FROM ANOTHER CATEGORY MUST NOT BE ACTIVATABLE. `placeholderData` deliberately
   * holds the previous results on screen during a refetch, and the dim below says so — but its
   * note justifies leaving them live because the old rows are "still valid and still tappable".
   * True of a SORT change (same set, new order); FALSE of a CATEGORY change: tap Services and the
   * Rentals cards stay on screen AND clickable, so the next tap opens an apartment. An automated
   * suite hit exactly that ("Selecting Services led to a Rentals apartment listing", 2026-09-22).
   *
   * ⛔ ASK WHAT THE DATA WAS FETCHED FOR, NEVER WHAT THE FIRST ROW CONTAINS. The first version
   * compared `shownListings[0].category.slug` to `activeCategory` and both reviewers refuted it
   * for the same reason: coming from `all` to Services, if the old mixed set merely HAPPENS to
   * begin with a Services listing the guard reads false and every Rentals card below it stays
   * tappable — the exact bug, surviving the fix. The second version recorded it in a ref written
   * during render, which a reviewer refuted too, and fairly: a render React discards can still
   * have advanced the ref. The payload now carries `fetchedFor` (see the queryFn), so this is a
   * pure comparison of two values that are both on screen.
   * ⚠️ SUBCATEGORY IS PART OF THE KEY TOO. Rentals › Studios showing Rentals › all rows is milder
   * than a cross-category leak but is the same class, so the pair moves together.
   *
   * ⚠️ `activeCategory === 'all'` IS DELIBERATELY EXEMPT, and a reviewer called that a defect
   * twice. It is not: under "all" every row on screen is a legitimate member of the result set, so
   * a tap goes somewhere the reader asked to see. Blocking there would freeze a correct grid.
   * ⛔ NO PROVENANCE COUNTS AS STALE — FAIL CLOSED. `fetchedFor` is stamped in `queryFn`, and the
   * default view does NOT come from `queryFn`: it is seeded with the server-rendered rows (see
   * `initialData` below). So the very first category tap after a cold load hands `placeholderData`
   * a seed with no stamp. An earlier version required `!!fetchedFor`, which turned the guard OFF
   * for exactly that path — the most likely way to reproduce the reported bug, disabled by the
   * fix for it. BOTH reviewers found this independently, which is the whole reason the panel
   * exists. Any other producer that fills this key without `queryFn` (a restored or adopted cache
   * entry) has the same shape and is covered by the same rule.
   * ⚠️ AND FAILING CLOSED DOES NOT OVER-FIRE, because the seed is gated to the UNFILTERED "all"
   * view (`initialData` below requires category, subcategory, brand, district, price, sort and
   * query to all be at their defaults). A reviewer argued the opposite — that a server-rendered
   * CATEGORY view would lack a stamp and lock the grid on a district or price change. There is no
   * such view to seed: once `activeCategory !== 'all'` the rows came through `queryFn` and carry
   * `fetchedFor`, so an in-category filter change compares stamp to stamp and stays live. The
   * unstamped branch is reachable only on the first tap away from the seeded "all" feed, which is
   * exactly the case it exists for.
   *
   * ⚠️ SCOPE, STATED HONESTLY: the feed grid, keyed on category and subcategory. Change DISTRICT
   * or price and the old rows stay live though they no longer match; map pins and video mode read
   * different queries and are not guarded at all. Those are pre-existing, none of them is what the
   * owner hit, and widening this to every filter would freeze the grid on every refetch — that
   * trade-off deserves its own change.
   */
  const fetchedFor = (listingsData as { fetchedFor?: { category: string; subcategory: string } } | undefined)?.fetchedFor
  const staleFromOtherCategory =
    queryShowingStaleSet &&
    /**
     * ⛔ A FAILED FETCH MUST RELEASE THE LOCK, OR THE GRID DIES. `isPlaceholderData` stays TRUE
     * when a query errors while placeholder rows are on screen, so without this a reader on a
     * flaky connection taps Services, the request fails, and the Rentals grid sits dimmed and
     * inert with nothing to press and no way back except another chip that happens to succeed,
     * or a reload. A reviewer caught this and it is the same family as the known
     * "a failed /api/listings is invisible" problem — the lock must fail OPEN even though the
     * staleness test fails CLOSED. Wrong-category rows that are tappable beat a dead screen.
     */
    !queryError &&
    activeCategory !== 'all' &&
    shownListings.length > 0 &&
    (!fetchedFor || fetchedFor.category !== activeCategory || fetchedFor.subcategory !== activeSubcategory)

  /**
   * WHAT TO OUTLINE: the most specific area the reader has chosen, ward first.
   *
   * ⚠️ A DISTRICT IS THE `DISTRICTS` DISPLAY NAME, NOT THE SLUG. OSM has never heard of `d1`; it
   * knows "Quận 1" — and that is also the vocabulary these listings use, which is why the abolished
   * districts still match as historic boundaries. `all` is not an area and outlines nothing.
   */
  const outlineTarget = useMemo(() => {
    if (activeWard && activeProvince) return { kind: 'ward' as const, name: activeWard.name, province: activeProvince.name }
    if (activeDistrict && activeDistrict !== 'all') {
      const d = DISTRICTS.find((x) => x.slug === activeDistrict)
      if (d) return { kind: 'district' as const, name: d.name, province: 'Hồ Chí Minh' }
    }
    return null
  }, [activeWard, activeProvince, activeDistrict])

  /**
   * ⚠️ MAP VIEW ONLY, and cached hard. An outline is only ever drawn on the map, so fetching it for
   * a grid reader is pure waste; and an administrative boundary does not move, so once the server
   * has it there is no reason to ask again this session.
   */
  const { data: outlineData } = useQuery({
    queryKey: ['geo-boundary', outlineTarget?.kind, outlineTarget?.name, outlineTarget?.province],
    enabled: viewMode === 'map' && !!outlineTarget,
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000,
    queryFn: async () => {
      const t = outlineTarget!
      const res = await fetch(`/api/geo/boundary?kind=${t.kind}&name=${encodeURIComponent(t.name)}&province=${encodeURIComponent(t.province)}`)
      if (!res.ok) return { boundary: null }
      return (await res.json()) as { boundary: unknown }
    },
  })

  /**
   * EVERY DISTRICT'S SHAPE, so the map can be used to PICK one — owner, 2026-09-24: "on district
   * mode user can click and select dirstict on map show outlines on hover".
   *
   * ⚠️ "DISTRICT MODE" IS DERIVED, NOT A NEW TOGGLE. The map is at district granularity whenever the
   * reader has not narrowed to a ward; adding a mode switch for something the filter state already
   * says would be a second place to get it wrong. A ward reader has already chosen a finer area, and
   * painting the surrounding districts over it would invite them to throw that choice away by
   * accident.
   * ⚠️ HCMC ONLY, because `DISTRICTS` is a curated Hồ Chí Minh list (DISTRICTS_PROVINCE_CODE '79').
   * Outside it there is nothing to offer, and the endpoint would answer with an empty array anyway.
   * ⚠️ Map view only and cached for the session, for the same reason the single outline above is.
   */
  const districtPickEnabled = viewMode === 'map' && !activeWard
    && (!activeProvince || activeProvince.code === DISTRICTS_PROVINCE_CODE)
  const { data: districtShapesData } = useQuery({
    queryKey: ['geo-boundaries', 'district', 'Hồ Chí Minh'],
    enabled: districtPickEnabled,
    /**
     * ⚠️ THREE STATES, NOT TWO, AND BOTH EXTREMES WERE WRONG IN TURN (reviewers, three rounds).
     * Pinning any non-empty answer kept a mid-warm SUBSET for the whole session; then pinning only
     * a complete one sent `staleTime` to 0 for every partial answer, so a district added but not
     * yet warmed made every map mount refetch the entire shape payload, sitewide, until someone
     * ran `npm run geo:warm`. A partial answer is perfectly usable — it just should be re-asked
     * soon rather than trusted forever, which is what the server's own 5-minute partial TTL says.
     * Only an EMPTY answer is worth nothing and must not be pinned at all.
     */
    staleTime: (q) => {
      const d = q.state.data as { complete?: boolean; boundaries?: unknown[] } | undefined
      if (d?.complete) return Infinity           // settled: shapes do not move
      if (d?.boundaries?.length) return 5 * 60_000 // partial: usable now, re-ask soon
      return 0                                   // nothing yet: do not pin an empty answer
    },
    gcTime: 60 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/geo/boundaries?province=${encodeURIComponent('Hồ Chí Minh')}`)
      if (!res.ok) return { boundaries: [], complete: false }
      return (await res.json()) as { boundaries: { slug: string; name: string; nameEn: string; geojson: unknown }[]; complete?: boolean }
    },
  })
  /**
   * ⚠️ THE ACTIVE DISTRICT IS EXCLUDED FROM THE PICK LAYER. It already has its own solid outline
   * (the `boundary` prop); leaving it in would stack a hover highlight on top of that and let the
   * reader "select" what is already selected.
   */
  const districtShapes = useMemo(
    () => (districtShapesData?.boundaries ?? []).filter((d) => d.slug !== activeDistrict),
    [districtShapesData, activeDistrict],
  )
  /**
   * ⛔ "ASK TO NARROW IT DOWN" ON THE MOBILE MAP — owner, 2026-09-24: "if there are more than 100
   * available options ask to narrow it down with price range popup and filter popup like 2bd 3bd etc".
   *
   * ⚠️ IT OPENS THE FILTER PANEL THAT ALREADY EXISTS rather than adding popups. <FacetBar>'s advanced
   * panel already carries price, rooms and the rest of the category's facets, so building a second
   * price popover beside it would be the hand-rolled duplicate CLAUDE.md's Base-UI policy exists to
   * prevent. (It used to open the old mobile filters drawer; that component was deleted upstream
   * when filtering moved into this bar and the Area panel — do not name it here, a wiring test
   * asserts no dead reference to it survives anywhere in this file, comments included.)
   *
   * ⛔ ROOMS IS OFFERED ONLY WHEN IT EXISTS, AND THAT IS NOT A DETAIL. `facetsFor()` returns a facet
   * carrying `subcats` ONLY when a matching subcategory is active, so on "all categories" it returns
   * NOTHING — a "2BR / 3BR" button on the default map would open a drawer with no such control in it.
   * The label is read from the taxonomy too, because `bedrooms` is defined TWICE (under `rentals` and
   * under `property`) with different option sets.
   */

  const handleSelectDistrict = useCallback((slug: string) => {
    // Through the Area panel's replace rule (pickDistrictFromArea): a district typed into the box
    // leaves it, so the map pick is the one district applied.
    pickDistrictFromArea(slug)
    /**
     * ⚠️ CLEAR THE NARROWER FILTERS THE NEW AREA CANNOT CONTAIN (reviewer). `selectedBuilding` is a
     * single tower and `nearby` is a radius somewhere else entirely; either one surviving a district
     * pick intersects with it and hands back an empty feed that nothing on screen explains — the
     * same trap the building-selection guard elsewhere in this file exists to close.
     */
    setSelectedBuilding(null)
    setNearby(null)
    // Picking an area is a new feed: start it at page one, and put the auto-load budget back so a
    // deep previous browse does not carry its spent ceiling into a fresh district.
    setPage(1)
    setAutoLoadCeiling(AUTO_LOAD_CAP)
  }, [pickDistrictFromArea])

  const buildingPins = useMemo(() => buildingsData?.buildings ?? [], [buildingsData])
  const activeBuilding = useMemo(
    () => (selectedBuilding ? buildingPins.find((b) => b.key === selectedBuilding) ?? null : null),
    [selectedBuilding, buildingPins],
  )
  /**
   * ⛔ A BUILDING FILTER THE USER CANNOT SEE MUST NOT SURVIVE. `selectedBuilding` narrows EVERY feed
   * fetch, but the header that names it and the "All buildings" button that clears it render only
   * in map view — and the pin that would clear it is on the map too. So two states trap the reader
   * with no way out and nothing on screen explaining the empty feed. Both were found in review:
   *
   *   1. Drill into a tower, switch to grid → the whole feed is one building, unlabelled. Changing
   *      category then returns nothing, because that tower has no phones.
   *   2. Drill in, then apply a price/district filter that excludes the tower → it drops out of
   *      /api/listings/buildings, so there is no header and no pin, and the list comes back empty.
   *
   * Clearing it the moment it stops being representable is the fix: the selection only exists while
   * something on screen can undo it.
   * ⚠️ Guarded on `buildingsData` being loaded — clearing on `undefined` would cancel the selection
   * during the first fetch, before the pins have arrived.
   */
  useEffect(() => {
    if (viewMode !== 'map' && selectedBuilding) setSelectedBuilding(null)
  }, [viewMode, selectedBuilding])
  useEffect(() => {
    if (!buildingsData || !selectedBuilding) return
    if (!buildingsData.buildings.some((b) => b.key === selectedBuilding)) setSelectedBuilding(null)
  }, [buildingsData, selectedBuilding])

  // The map view's result list. ⚠️ It is NOT a scroll box any more (E-MAP, 2026-09-29): it used to
  // scroll inside its own column on desktop, which is why its sentinel lived in the column and was
  // observed against it. The window scrolls it now, like every other view.
  const mapListRef = useRef<HTMLDivElement | null>(null)
  /**
   * The sticky toolbar's height, for the desktop map's `--map-top` (it pins under the header AND this
   * bar, which hide together). ~49px at desktop, but it can wrap, so it is measured — only while the
   * map is on screen, which is the only reader.
   */
  const [toolbarH, setToolbarH] = useState(49)
  useEffect(() => {
    if (viewMode !== 'map' || typeof ResizeObserver === 'undefined') return
    const bar = document.getElementById('explorer-toolbar')
    if (!bar) return
    const read = () => setToolbarH(bar.offsetHeight)
    read()
    const ro = new ResizeObserver(read)
    ro.observe(bar)
    return () => ro.disconnect()
  }, [viewMode])
  /**
   * Back to the top of the map's list after it is REPLACED (a building drill-in or out). It used to
   * reset the list's own scroll box; the window scrolls it now, so this brings the list's top back
   * under the pinned chrome — but only when the reader has scrolled past it, and only on desktop,
   * where the list sits beside the map (on a phone it is below the map, and jumping there would drag
   * the page off the map — the 2026-07-14 decision the pin handler below also keeps).
   */
  const scrollMapListToTop = useCallback(() => {
    const list = mapListRef.current
    if (!list || !window.matchMedia('(min-width: 1024px)').matches) return
    const chrome = pinnedChromeBottom(document)
    const top = list.getBoundingClientRect().top
    if (top < chrome) window.scrollTo({ top: top + window.scrollY - chrome - 8, behavior: scrollBehavior() })
  }, [])
  /** Stable identity for the map's click handler — see the ref note in listings-map.tsx. */
  const handleSelectBuilding = useCallback((key: string | null) => {
    setSelectedBuilding(key)
    /**
     * ⚠️ SCROLL THE LIST BACK TO THE TOP. `filterSig` resets the page and replaces the rows, but
     * the column keeps its scrollTop — so drilling in from halfway down the feed lands you at
     * unit 14 of 157 with no indication why.
     */
    scrollMapListToTop()
  }, [scrollMapListToTop])

  /**
   * ⛔ ASKED OF THE FEED ON SCREEN, NOT OF THE WHOLE SITE (E-VIEWS, 2026-09-29). The probe used to ask
   * "does ANY listing have a clip" once per session, so Rentals — no videos at all — still offered a
   * Video view that could only open onto nothing. It now carries the feed's own filters (with a fixed
   * sort, which cannot change a count — see below) and the shop, so the tab is offered exactly where it has
   * something to play. `placeholderData` keeps the previous answer during a filter change, so the tab
   * does not blink out and back on every tap; one limit=1, facet-free request per filter change, edge-
   * cached like the feed.
   * ⛔ `sort=recent`, NOT NO SORT (review, 2026-09-29). With the sort dropped the route took its default
   * ('newest'), and on that sort a worded feed goes through the relevance ranker (keyword-rank.ts): a
   * separate 600+300-row candidate read and scoring — cached per `where`, and `hasVideo` makes it a
   * different `where` — to answer limit=1 (measured: cold /?q=iphnoe fired it right after the feed).
   * A browse feed paid the diversity window the same way. 'recent' is a plain ORDER BY that no ranker,
   * window or Vertex call applies to, so the probe is one LIMIT 1 read and the memoized count; the sort
   * changes no `total`, and one fixed value keeps a single edge entry per filter set.
   * ⚠️ On a Vertex-configured server the count is then the keyword matches only (the semantic ids are
   * a default-sort path) — the tab can stay hidden for a semantic-only video match. Display-only, and
   * Vertex is off in production.
   */
  const videoProbeParams = useMemo(() => {
    const p = new URLSearchParams(baseParamsString)
    p.set('sort', 'recent')
    return p.toString()
  }, [baseParamsString])
  const { data: videoAvail } = useQuery({
    // The params carry the shop (`scopedParams`), so two storefronts can no longer share an answer.
    queryKey: ['video-availability', videoProbeParams],
    enabled: videoProbeReady,
    queryFn: async () => {
      const res = await fetch(`/api/listings?${videoProbeParams}&hasVideo=1&limit=1&facets=0`)
      if (!res.ok) return { total: 0 }
      return res.json() as Promise<{ total: number }>
    },
    placeholderData: (prev) => prev,
    staleTime: 5 * 60_000,
  })
  // An open Video view keeps its own tab, whatever the probe says about the next filter.
  const showVideoView = viewMode === 'video' || (videoAvail?.total ?? 0) > 0

  /**
   * The price-histogram request: the FEED'S OWN params (plus the building drill-in the live query
   * adds), minus price/sort/paging — so "{n} available" counts exactly the set the grid shows.
   * ⛔ DERIVED, NOT REBUILT. This used to be a hand-written copy of the feed's params and it
   * drifted twice: with a brand picked it dropped `subcategory` (the 2026-08-25 phone-cases fix
   * reached `baseParamsString` and not here) and it never sent `match=any`, so the panel counted
   * a different set than the grid beneath it. `histogramQueryFrom` explains what it strips.
   * ⛔ THE WORD THE FEED ANSWERED, NEVER A SPELLING DECISION OF ITS OWN (review, 2026-09-29). This sent
   * `spell=1` and the route corrected the histogram from ITS zero — but its zero is not the feed's:
   * it drops the price band (a word whose literal matches all sit outside the chosen range is zero in
   * the feed and non-zero here) and never takes the semantic path. The reviewer measured it on :3300: the feed stayed
   * literal (73, semantic) while the histogram switched to "iphone" (3,433), so the slider described
   * another word than the grid. It now asks for `correctedQuery` — what the feed's answer says it
   * searched — and otherwise the typed words, literally.
   */
  const histogramQuery = useMemo(() => {
    const p = new URLSearchParams(baseParamsString)
    if (selectedBuilding) p.set('building', selectedBuilding)
    if (correctedQuery) p.set('q', correctedQuery)
    return histogramQueryFrom(p)
  }, [baseParamsString, selectedBuilding, correctedQuery])

  // Identity of the current feed (every filter that defines "this result set"), used
  // to key the back-nav snapshot so it only restores onto the exact same feed.
  const feedSig = useMemo(
    () => JSON.stringify([
      activeCategory, activeSubcategory, activeBrand, activeModel, activeLine, activeDistrict,
      activeProvince?.code ?? null, activeWard?.code ?? null, nearby ? 1 : 0,
      conditionFilter, goodPriceOnly, listingType, debouncedQuery, sort, verifiedOnly, priceRange, customFilters,
    ]),
    // ⚠️ `activeLine` WAS MISSING HERE while it sat in the array above, so a line-only change kept
    // the previous feed's signature on the back-nav snapshot.
    [activeCategory, activeSubcategory, activeBrand, activeModel, activeLine, activeDistrict, activeProvince?.code, activeWard?.code, nearby, conditionFilter, goodPriceOnly, listingType, debouncedQuery, sort, verifiedOnly, priceRange, customFilters],
  )

  /**
   * ⛔ THE AUTO-LOAD BUDGET BELONGS TO ONE FEED, NOT TO THE SESSION (reviewer). It was reset on the
   * logo/home paths and on a district pick, but not when the reader changed category, query, price,
   * province, brand or condition — so someone who clicked "Load more" up to 200 on one feed got the
   * NEXT one auto-loading to 200 as well, which defeats the cap on every path except the three that
   * happened to be wired. `feedSig` is this file's existing identity for "these are different
   * results", and it is exactly the right granularity: it changes when the query does and not when
   * a new page of the same query arrives.
   * ⚠️ Skips the first run so a restored back-nav ceiling is not immediately thrown away — the
   * restore effect runs on the same signature.
   */
  const feedSigForCap = useRef<string | null>(null)
  useEffect(() => {
    if (feedSigForCap.current === null) { feedSigForCap.current = feedSig; return }
    if (feedSigForCap.current === feedSig) return
    feedSigForCap.current = feedSig
    setAutoLoadCeiling(AUTO_LOAD_CAP)
  }, [feedSig])

  const NARROW_PROMPT_MIN = 100
  /**
   * ⚠️ THE DISMISSAL IS KEYED TO THE FEED, NOT TO THE SESSION (reviewers, twice). Plain `useState`
   * made one "Dismiss" silence the prompt for the rest of the visit — change category, clear the
   * filters, pan somewhere denser, and it never came back, so the owner's "ask to narrow it down"
   * simply stopped working. Storing the feed signature that was dismissed means a NEW search asks
   * again while the one you waved away stays quiet.
   */
  const [dismissedForSig, setDismissedForSig] = useState<string | null>(null)
  /**
   * ⛔ THE PROMPT'S BUTTON LOST ITS TARGET IN A REBASE, AND IT WAS A DELETED COMPONENT. It opened
   * the old mobile filters drawer, which upstream removed when filtering moved into <FacetBar> and
   * the Area panel — that file no longer exists. Only `tsc` caught it: the 3-way merge applied
   * cleanly and nothing complained until the type-check ran after the rebase.
   * The surviving surface with the same facets is FacetBar's own filter panel, so the prompt bumps
   * a counter it watches. A counter, not a boolean, so the reader closing the panel sticks.
   */
  const [openFilterSignal, setOpenFilterSignal] = useState(0)
  const roomsFacet = useMemo(
    () => facetsFor(activeCategory, activeSubcategory === 'all' ? null : activeSubcategory)
      .find((f) => f.key === 'bedrooms'),
    [activeCategory, activeSubcategory],
  )
  /**
   * ⚠️ `nearby` COUNTS WHAT IS ON SCREEN, NOT `totalCount` — the same split the result line makes.
   * A radius search is one broad fetch narrowed client-side, so `totalCount` is the unnarrowed city
   * and would show the prompt over a handful of pins.
   */
  const narrowPromptCount = nearby ? shownListings.length : totalCount
  const showNarrowPrompt = viewMode === 'map'
    && dismissedForSig !== feedSig
    && narrowPromptCount > NARROW_PROMPT_MIN


  // Rehydrate the feed after a back-nav from a listing: restore the accumulated rows,
  // page depth and scroll position (Baymard: dumping the buyer at the top of a reset
  // feed is a leading cause of abandonment). The snapshot is read once on mount, then
  // applied the moment the URL-driven filters settle to the same signature.
  useLayoutEffect(() => {
    if (!snapReadRef.current) {
      snapReadRef.current = true
      try {
        const raw = sessionStorage.getItem('eno:feed-snap')
        if (raw) {
          sessionStorage.removeItem('eno:feed-snap')
          const s = JSON.parse(raw)
          // Recent, and with something to restore. This used to demand MORE rows than a
          // fresh page-1 load, which silently threw away every shallow snapshot — the home
          // feed's most common one (scrolled a screen or two, never hit "Load more"). The
          // rows are only half the point; the SCROLL POSITION is the other half, and it is
          // worth restoring even when the row count is unchanged.
          if (s && Array.isArray(s.listings) && s.listings.length > 0 && Date.now() - s.ts <= 30 * 60 * 1000) {
            pendingSnapRef.current = s
          }
        }
      } catch { /* ignore */ }
      // Nothing to restore → this entry gets the browser's own restoration back (see feed-restore.ts).
      // A snapshot that has not matched the URL's filters once they have settled (it may never) must
      // not keep the entry on 'manual' either: the browser decided this arrival long before then, and
      // a LATER Back to this entry would otherwise get neither its restoration nor ours.
      if (!pendingSnapRef.current) releaseFeedEntry()
      else setTimeout(() => { if (pendingSnapRef.current) releaseFeedEntry() }, 1500)
    }
    const snap = pendingSnapRef.current
    if (snap && snap.sig === feedSig) {
      pendingSnapRef.current = null
      /**
       * ⛔ ONLY ROWS THAT ANSWER THE CURRENT QUESTION ARE RESTORED — the snapshot's `rowsSig` must
       * equal `liveSig` exactly, or it is dropped and the feed loads normally from the top.
       * `feedSig` alone is too coarse to decide this: it ignores the exact "near you" circle, the
       * drill-in building, `match=any` and the payload language, and it names the filters that were
       * SELECTED, not the ones the rows on screen came from. Each gap put foreign rows back on screen
       * — live and tappable, since restored rows are not a react-query placeholder and nothing dims
       * them — until the current query answered: a card tapped while the next model was still
       * loading brought the previous model's rows back under the new count; an English snapshot
       * came back under a Korean UI. A snapshot with no `rowsSig` (written before it existed, or
       * of rows with no known provenance) cannot match either, which costs a one-time lost restore
       * after a deploy. Never widen this to "close enough": a missed restore lands at the top of a
       * correct feed, a wrong one shows the owner's screenshot.
       * ⚠️ CONSUMED ON THE FIRST MATCH, NOT KEPT WAITING — deliberately. A version that kept a
       * mismatched snapshot pending (so a late-settling input could still match it) left it armed for
       * as long as the reader stayed on that feed, to fire later when they happened to recreate the
       * rows' exact query — a scroll jump out of nowhere. The one known late input is the language of
       * the nine machine-translated locales on a FULL-DOCUMENT Back (the provider's effect lands a
       * render after this one); such a reader lands at the top of a correct feed instead. A
       * client-side Back — the normal one — keeps the provider mounted, so its language is settled.
       */
      if (snap.rowsSig !== liveSig) { releaseFeedEntry(); return }
      restoredScrollRef.current = {
        y: snap.scrollY,
        anchorId: typeof snap.anchorId === 'string' ? snap.anchorId : null,
        anchorTop: typeof snap.anchorTop === 'number' ? snap.anchorTop : 0,
      }
      setListings(snap.listings)
      // The grid renders these rows in THIS commit, not a deferred one later — see `restoring`.
      setRestoring(true)
      setRestoreSettled(false)
      rowsSigRef.current = snap.rowsSig // === liveSig, checked above
      seenIdsRef.current = new Set(snap.listings.map((l: SerializedListingCard) => l.id))
      maxOffsetRef.current = (snap.page - 1) * 12 // deepest offset already loaded (feed page size)
      setReachedEnd(false)
      setTotalCount(snap.totalCount)
      setPage(snap.page)
      // Restore the home feed's pagination MODE too, not just its depth: without this the
      // buyer came back to a deep feed whose infinite scroll was re-locked, so the next
      // scroll dead-ended at a "Load more" button they had already pressed. (Declared
      // further down the component — read inside an effect, so it is initialised by now.)
      setFeedUnlocked(snap.unlocked === true)
      /**
       * Restore the auto-load budget, and never restore one SMALLER than the rows coming back — an
       * older snapshot without a ceiling would otherwise re-gate a feed mid-scroll.
       * ⚠️ AND NEVER A BIGGER ONE EITHER (reviewer). Rounding the restored length UP to the next
       * whole cap handed 108 restored rows a ceiling of 200 — so a back-nav, the most common path
       * on this marketplace, auto-paged to twice the budget the owner asked for. The floor is the
       * row count itself: the reader gets back exactly what they had, and the button is waiting.
       */
      setAutoLoadCeiling(Math.max(
        typeof snap.ceiling === 'number' ? snap.ceiling : AUTO_LOAD_CAP,
        snap.listings.length || 0,
        AUTO_LOAD_CAP,
      ))
      /**
       * ⛔ CLAIM THIS SIGNATURE FOR THE CAP, OR THE RESTORE IS UNDONE ONE TICK LATER (reviewer).
       * The per-feed reset below fires whenever `feedSig` CHANGES and skips only its own first run —
       * but the filters hydrate from the URL asynchronously, so the signature changes again just
       * after this restore and threw the recovered ceiling away. The reader came back to 108 rows
       * and was immediately gated behind a "Load more" they had already pressed, which is the exact
       * dead end the snapshot exists to prevent.
       */
      feedSigForCap.current = feedSig
    } else if (snap?.fromHistory) {
      // A Back's snapshot (NAV-1, `entrySnaps`) answers THIS render or never: a feed that does not match now
      // is not the one it was taken of, and keeping it armed would fire it later as a jump from nowhere.
      pendingSnapRef.current = null
      releaseFeedEntry()
    }
    // ⚠️ `viewMode` too: Back from the map to the list changes no filter, so without it a list snapshot would
    // never be looked at (the view is not in `feedSig` — the rows are the same set).
  }, [feedSig, liveSig, viewMode])

  // Put the buyer back where they were, once the restored rows are actually IN THE DOM.
  // A single scrollTo in the commit that restored them is not enough: the grid renders off
  // a useDeferredValue copy (so the urgent commit can still be painting the SHORT list, and
  // scrollTo would clamp against a document that is not tall enough yet), and on the landing
  // feed the rails above the grid mount lazily. (Since E-BACK the grid renders the restored rows
  // directly while `restoring` holds, so the FIRST step usually lands before paint; the loop is
  // still what absorbs everything that grows above the card afterwards.) Aligning the tapped CARD (rather than an
  // absolute offset) is what makes this correct when the content above the feed has a
  // different height than it did when we left. Any real user scroll input aborts it: we never
  // fight a finger.
  // ⛔ THE FRAME LOOP LIVES IN feed-restore.ts (`runRestore`), unit-tested frame by frame, and it
  // no longer stops at the first jump. Measured on production (390×844, Back from ~card 60): the
  // card came back 294–365px off, under the sticky header and filter strip, because everything that
  // grew ABOVE it after the one jump (the deferred grid commit, lazily mounted chrome) pushed it
  // away. It now keeps aligning until two consecutive frames agree within 1px (cap 30 frames once
  // found, 40 to find it), and never places the card under the pinned `#app-header` /
  // `#explorer-toolbar` (`pinnedChromeBottom`).
  useLayoutEffect(() => {
    const target = restoredScrollRef.current
    // Already aligning — do NOT restart (or tear down) the loop just because more rows
    // arrived; the page-1 refetch swaps `listings` mid-restore and used to kill it.
    if (!target || restoreStopRef.current) return
    const abort = () => restoreStopRef.current?.()
    // touchMOVE, not touchstart: a bare tap (or the tail of the edge-swipe that brought us
    // here) must not silently cancel the restore — only an actual drag counts as "the user
    // is scrolling now".
    window.addEventListener('touchmove', abort, { passive: true })
    window.addEventListener('wheel', abort, { passive: true })
    window.addEventListener('keydown', abort)
    let finished = false
    const cardSelector = (id: string) => `[data-feed-card="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id}"]`
    // The first step runs SYNCHRONOUSLY, in the layout phase, so that when the rows are already
    // in the DOM the jump happens before the browser paints (no visible flash of the top of the
    // feed). `runRestore` schedules its own rAF frames after that.
    const stop = runRestore(target, {
      anchorTopOf: (id) => document.querySelector(cardSelector(id))?.getBoundingClientRect().top ?? null,
      chromeBottom: () => pinnedChromeBottom(document),
      scrollBy: (dy) => window.scrollBy(0, dy),
      scrollTo: (y) => window.scrollTo(0, y),
      fits: (y) => document.documentElement.scrollHeight >= y + window.innerHeight,
      raf: (cb) => requestAnimationFrame(cb),
      caf: (id) => cancelAnimationFrame(id),
    }, () => {
      finished = true
      setRestoreSettled(true) // the grid returns to the deferred copy once it has caught up (`restoring`)
      window.removeEventListener('touchmove', abort)
      window.removeEventListener('wheel', abort)
      window.removeEventListener('keydown', abort)
      restoreStopRef.current = null
      restoredScrollRef.current = null
      releaseFeedEntry()
    })
    if (!finished) restoreStopRef.current = stop
  }, [listings])

  // Unmount is the only thing that cancels an in-flight restore from outside (the loop above
  // deliberately survives re-renders, so it can't return its own cleanup). useLayoutEffect,
  // NOT useEffect: a passive cleanup is flushed AFTER paint, so on a fast back-then-forward
  // the loop would get one more frame and scroll the DESTINATION route. Layout cleanups run
  // synchronously in the commit that removes the tree.
  // ⚠️ AND IT HANDS 'auto' BACK TO WHERE THE READER WENT, if a card tap's hold is still out — the
  // destination entry inherited 'manual' from this one (feed-restore.ts, `handBackAfterLeaving`).
  useLayoutEffect(() => () => { restoreStopRef.current?.(); handBackAfterLeaving() }, [])

  // Synchronize state and trigger history caching when data changes
  useEffect(() => {
    if (listingsData) {
      // Page 1 (or any filter change, which resets page→1) replaces; later pages append
      // for the infinite feed. Dedupe by id so the placeholderData transition between
      // pages can't double-insert. seenIdsRef (kept in step here) measures "new rows this
      // page" outside the updater; only a deeper page with nothing new stops pagination.
      //
      // ⛔ THE ROWS AND THE COUNT MUST ALWAYS COME FROM THE SAME QUERY STATE. Every early `return`
      // below skips `setTotalCount` on purpose: a count adopted from a payload whose rows were
      // NOT adopted is exactly "3 listings" printed over 39 iPhone 12 Pro Max cards (owner,
      // 2026-09-24). A payload that is NOT a placeholder is the answer to the current key, so it
      // belongs to `liveSig` even without a stamp — that is what gives the ISR seed (`initialData`,
      // which never passes through the queryFn) its provenance. Only an unstamped PLACEHOLDER is
      // unknown, and unknown on either side is let through.
      const stamped = (listingsData as { fetchedFor?: { sig?: string } }).fetchedFor?.sig
      const payloadSig = stamped ?? (queryShowingStaleSet ? undefined : liveSig)
      const otherFeed = payloadSig !== undefined && rowsSigRef.current !== undefined && payloadSig !== rowsSigRef.current
      if (page === 1) {
        // ⛔ ONLY AN OFFSET-0 PAYLOAD ANSWERS PAGE 1. Anything deeper is `placeholderData` replaying
        // the page the reader was on before the filter change — the OLD query's rows, and after a
        // Back from the end of a feed that page is empty, which painted "No listings match" for
        // the length of the request. Leave the rows (dimmed by `queryShowingStaleSet`) and the
        // count as they are until the page-1 answer lands.
        if ((listingsData.offset ?? 0) > 0) return
        // Mid-restore the snapshot already holds more rows than a fresh page 1 — keep it
        // (seenIdsRef/maxOffsetRef were set by the restore effect; don't reset them). Only for
        // the SAME feed: a page 1 of other filters replaces, restore or not.
        const keepRestored = restoredScrollRef.current != null && !otherFeed
        setListings((prev) => {
          if (keepRestored && prev.length > listingsData.listings.length) return prev
          seenIdsRef.current = new Set(listingsData.listings.map((l: SerializedListingCard) => l.id))
          maxOffsetRef.current = 0
          // Set WITH the rows, in the same updater as the two refs above, so the rows and their
          // provenance can never be observed apart. Idempotent if React replays the updater; not
          // reached on the keep-restored bail-out, whose rows keep the snapshot's provenance.
          rowsSigRef.current = payloadSig
          return listingsData.listings
        })
        setReachedEnd(false) // a fresh feed (filter change / reload) — paging is open again
      } else if (otherFeed) {
        // ⛔ A LATER PAGE OF A DIFFERENT RESULT SET: the page counter outlived a filter change
        // (the stale `skipFirstPageResetRef` did exactly this). Appending it is how "iPhone 17 Pro
        // Max" rows ended up under 39 "iPhone 12 Pro Max" ones. Start the new filters from the top.
        setPage(1)
        return
      } else if (listingsData.offset === (page - 1) * FIRST_PAGE_SIZE) {
        // Real data for THIS page (not a placeholderData replay, whose offset lags a page).
        const fresh = listingsData.listings.filter((l: SerializedListingCard) => !seenIdsRef.current.has(l.id))
        if (fresh.length > 0) {
          fresh.forEach((l: SerializedListingCard) => seenIdsRef.current.add(l.id))
          maxOffsetRef.current = Math.max(maxOffsetRef.current, listingsData.offset)
          if (rowsSigRef.current === undefined) rowsSigRef.current = payloadSig
          setListings((prev) => [...prev, ...fresh])
        } else if (listingsData.offset > maxOffsetRef.current) {
          setReachedEnd(true) // a genuinely deeper page returned nothing new — stop the loop
        }
      }
      setTotalCount(listingsData.total)
      if (listingsData.subcategoryCounts) {
        setSubcategoryCounts(listingsData.subcategoryCounts)
      }
      if (listingsData.categoryTotal !== undefined) {
        setCategoryTotal(listingsData.categoryTotal)
      }
      // ⚠️ ONLY ADOPT A NON-EMPTY PAYLOAD. `facets` is `{}` on a load-more (offset > 0) and under
      // `?facets=0`, and an empty object is "nothing to say", NOT "everything is zero" — adopting
      // it would strip every number off the page the instant someone paged. Keeping the previous
      // payload means the counts stay put while more rows arrive, which is what a reader expects
      // from a number that was true a second ago.
      if (listingsData.facets && Object.keys(listingsData.facets).length > 0) {
        setFacetCounts(listingsData.facets)
      }
      const term = debouncedQuery.trim()
      if (term.length >= 2) {
        saveSearchToHistory(debouncedQuery)
        // Settled query (debounced + a successful /api/listings response) → a real
        // search event, deduped so refetches of the same term don't re-fire.
        if (lastTrackedSearch.current !== term) {
          lastTrackedSearch.current = term
          trackSearch({
            term,
            results: listingsData.total,
            category: activeCategory !== 'all' ? activeCategory : undefined,
            contentIds: listingsData.listings.slice(0, 10).map((l) => l.id),
          })
          // Log the committed query to the trending counters (fire-and-forget,
          // keepalive so it survives a navigation; fails silently).
          try {
            void fetch('/api/search/trending', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ q: term }),
              keepalive: true,
            }).catch(() => {})
          } catch { /* fail-open */ }
        }
      }
    }
  }, [listingsData, page, debouncedQuery, saveSearchToHistory, activeCategory, queryShowingStaleSet, liveSig])

  // Loading is DERIVED from the query — it was mirrored into state via an effect,
  // which lagged a render behind and added a redundant state/effect pair.
  //
  // ⛔ NOTHING TIME-DEPENDENT MAY DECIDE THIS FLAG. It picks between two structurally DIFFERENT
  // TREES — the skeleton grid below (:2744) and renderEmptyState() (:2760) — so if the server and
  // the client disagree about it, hydration fails outright.
  //
  // That is exactly what shipped, and it was firing on 100% of eno.vn home loads:
  //   · (home)/page.tsx stamps `initialFetchedAt={Date.now()}` into HTML that ISR then serves for
  //     up to SIX HOURS, and :354 seeds `initialDataUpdatedAt` from it.
  //   · React Query's OPTIMISTIC result runs shouldFetchOnMount() -> isStaleByTime(30s) against
  //     that stamp on the FIRST render, before any effect
  //     (query-core/build/modern/queryObserver.js:248-256).
  //   · On the server the stamp is the Date.now() of that same RSC render — age ~0, not stale,
  //     `isFetching` false -> EmptyState. In the browser the stamp is whatever was baked into the
  //     cached HTML — measured 7,581s old — stale, `isFetching` TRUE -> 12 skeletons.
  //   · Precondition `listings.length === 0`: only eno.vn has an empty catalogue (the licensing
  //     hide-list), which is why eno.forum never showed it and why this looked edition-specific.
  // Measured 32/32 across desktop, iPhone and Android profiles. It reads as INTERMITTENT if you
  // listen on `page.on('console')` — it is an UNCAUGHT EXCEPTION, not a console.error, so a
  // console listener sees nothing and you conclude it is a race. It is not a race.
  // Isolated causally on the live artifact: rewriting ONLY `initialFetchedAt` in the served HTML
  // gave 0/4 errors with a fresh stamp against 3/3 with the baked one.
  //
  // ⚠️ THE FIX IS THE `!hasSeededAnswer` TERM, AND IT IS A SEMANTIC CLAIM, NOT A GUARD:
  // a background revalidation of a question we ALREADY have an answer for is not a loading state.
  // With `initialData` present this makes the flag agree on both sides by construction, because it
  // no longer consults the clock at all. Routes that mount this WITHOUT a seed still get skeletons
  // (`listingsData` is undefined there), and the `queryFetching` opacity dim further down is
  // untouched, so the "refreshing" affordance survives.
  const hasSeededAnswer = listingsData !== undefined
  const isLoading = queryLoading || (queryFetching && listings.length === 0 && !hasSeededAnswer)
  /**
   * ⛔ THE CURRENT QUESTION FAILED AND NOTHING ON SCREEN ANSWERS IT: page 1 of the current key errored
   * with no data of its own, so whatever `listings` still holds is the PREVIOUS filters' rows (or the
   * ISR seed) — showing them under the new chips is the owner's screenshot again, reached through a
   * failed request instead of a stale page. The grid below yields to the error state (with Try again)
   * instead. Measured before this: a deep feed whose next model request 503'd kept every old card on
   * screen, dimmed, with no error, for as long as the reader looked.
   * ⚠️ PAGE 1 ONLY. A failed LOAD-MORE leaves rows that are genuinely this feed's; hiding them would
   * throw away a good answer to report a missing tail. And a background refetch that errors keeps its
   * data (`listingsData` defined), so a feed that already answered is never replaced by this.
   * ⚠️ The load-more sentinel lives inside the grid block, so it unmounts with it — nothing can page
   * past a page 1 that never arrived. That is an unmount on "no rows to show", like the empty state,
   * NOT the `hidden` sentinel the landmine note forbids.
   * ⚠️ KNOWN AND ACCEPTED: after a full-document Back (sessionStorage survives, the react-query cache
   * does not), a SHALLOW restore whose page-1 refetch then fails shows this error over rows that did
   * match. Those rows are a minutes-old snapshot rather than an answer; an honest error with Try
   * again is the safe side of that trade.
   */
  const failedWithoutAnswer = queryError && page === 1 && listingsData === undefined
  /**
   * ⛔ A LOAD-MORE PAGE WITH NO ANSWER OF ITS OWN STOPS THE FEED THERE (Emil-skills audit, split out of tier 1 #4).
   * Page N failed (after its retry) or is waiting for the network (paused offline). The observer re-armed the
   * moment `queryFetching` went false, and a reader still at the bottom paged straight on to N+1: page N's rows
   * skipped for good (measured in listings-explorer.feed-ux.test.tsx: rows 0–11 then 24–35), and with every
   * request failing it walked the catalogue a page at a time. Now nothing pages past it — the sentinel is not
   * observed and "Load more" is not offered — and the footer says so with a Try again that asks for page N
   * again. Offline it simply waits: React Query resumes the paused fetch on reconnect, and the app-wide offline
   * banner already says why. (The cap's "Load more" needs no gate of its own: pressing it raises the ceiling, so
   * it is never on screen beside a page that failed after it.)
   * ⚠️ `listingsData === undefined`, NOT `queryError` alone: a page that HAS its answer and whose background
   * refetch failed keeps that answer (`data` stays defined) — stopping there would end the feed over good rows.
   * ⚠️ A Try again's refetch puts the page back to pending (no data of its own → status 'pending', the
   * placeholder again), so for its duration this is false and the page's skeleton cells show — its own loading
   * state; a second failure brings the row back.
   */
  const pageWithoutAnswer = page > 1 && ((queryError && listingsData === undefined) || (queryPaused && queryShowingStaleSet))

  /**
   * E-SSR (see `awaitingUrlAnswer`): the URL's answer is in hand once page 1 of the CURRENT key has
   * landed (not a placeholder, the words settled) — or the request failed, which must not keep a mask
   * over the error state. A 12s ceiling lifts it whatever happens (the script's own 15s is the no-JS
   * net), so a stuck request degrades to today's behaviour, never to a page of grey boxes.
   */
  useEffect(() => {
    if (!awaitingUrlAnswer) return
    if (queryError || (listingsData && !queryShowingStaleSet && page === 1 && query.trim() === debouncedQuery.trim())) {
      setAwaitingUrlAnswer(false)
    }
  }, [awaitingUrlAnswer, queryError, listingsData, queryShowingStaleSet, page, query, debouncedQuery])
  useEffect(() => {
    if (!awaitingUrlAnswer) return
    const t = setTimeout(() => setAwaitingUrlAnswer(false), 12_000)
    return () => clearTimeout(t)
  }, [awaitingUrlAnswer])
  /**
   * ⛔ THE MASK LIFTS WHEN THE GRID DRAWS THE ANSWER, NOT WHEN THE ANSWER ARRIVES. The grid renders a
   * `useDeferredValue` copy of the rows, so the commit that adopts the answer still DRAWS the seed; lifting
   * the mask there flashed the twelve unrelated cards for one deferred render. `gridListings === shownListings`
   * is "the deferred copy has caught up" — the count below is deferred alongside it (`shownTotal`), so the
   * cards and their number unmask in the same frame.
   */
  // ⚠️ `urlApplied` FIRST: on a cold load this effect also runs in the hydration commit, AFTER the mount
  // effect has asked for `awaitingUrlAnswer` but BEFORE that state exists (this closure still reads the
  // initial false) — so without the gate it lifted the mask in the very commit that armed it (measured:
  // the seed and its count on screen from hydration to the answer). `urlApplied` is set in that same
  // mount effect, so the first render that can see it can also see the decision.
  useEffect(() => {
    // Nothing to lift once it is down — this runs on every grid change, so it must cost nothing then.
    if (!seedMasked || !urlApplied || awaitingUrlAnswer || gridListings !== shownListings) return
    document.documentElement.removeAttribute('data-explorer-directed')
    setSeedMasked(false)
  }, [seedMasked, urlApplied, awaitingUrlAnswer, gridListings, shownListings])
  /**
   * ⛔ THE COUNT COMMITS WITH THE CARDS (E-SSR, 2026-09-29). The grid draws a deferred copy of the rows
   * (see `deferredListings`) while this line drew `totalCount` directly, so a new answer's number landed
   * one render BEFORE its cards — "3 listings" over the previous feed's cards, for a frame. Deferring the
   * count with the same hook puts both in the same deferred render.
   */
  const liveTotal = nearby ? shownListings.length : totalCount
  const deferredTotal = useDeferredValue(liveTotal)
  // ⚠️ THE COUNT FOLLOWS WHATEVER THE GRID DRAWS, INCLUDING ITS BYPASSES: the grid reads the rows
  // directly while a back-nav restore aligns and when rows arrive over an empty grid (`gridListings`),
  // and a deferred count there printed "0 listings" over three cards. Same rows, same number.
  const shownTotal = gridListings === shownListings ? liveTotal : deferredTotal
  // `null` while the current filters' page 1 FAILED (the held count is the previous filters' answer),
  // and while the first page is a skeleton with no rows at all (a client-side mount that did not start
  // on the seed): there is no answer yet in either.
  // ⚠️ NOT nulled while a cold deep link's seed is masked (E-SSR): the mask's `visibility: hidden` already
  // takes the seed's count off the screen AND out of the accessibility tree, so its live region cannot
  // announce it — and emptying the line instead collapsed the phone's count row, which moved the grid
  // up and back down again (measured: two 0.0069 shifts at 390×844 on /?q=iphone).
  const resultLineCount = failedWithoutAnswer || (isLoading && listings.length === 0) ? null : shownTotal
  // The zero-result state's "Popular searches" (E-ZERO) — fetched only once a worded search has come
  // back empty; the hook memoises the list for the session, shared with the search panels.
  const zeroTrending = useTrendingSearches(!isLoading && !queryError && shownListings.length === 0 && debouncedQuery.trim() !== '')

  // Count helper for subcategory items
  const getSubcategoryCount = useCallback(
    (subcatSlug: string) => {
      if (subcatSlug === 'all') {
        return categoryTotal
      }
      return subcategoryCounts[subcatSlug] ?? 0
    },
    [subcategoryCounts, categoryTotal],
  )

  const queryClient = useQueryClient()

  /**
   * Warm page+1 alongside the page bump. ⛔ THROUGH `feedKey` + `fetchFeedPage`, NOT A COPY OF THEM —
   * see `feedKey`: the hand-copied version lacked `match`, never shared a cache entry with the live
   * query, and doubled every page's download. Called in the same tick as `setPage(p => p + 1)`, so the
   * live query attaches to this in-flight request instead of starting its own.
   * ⚠️ `maxPage` DIVIDES BY THE PAGE SIZE THE FETCHER USES. It divided by 24 while pages are 12, so on a
   * feed of 30 the warm-up for page 3 was skipped as "past the end".
   */
  const prefetchNextPage = useCallback(() => {
    const nextPage = page + 1
    const maxPage = Math.ceil(totalCount / FIRST_PAGE_SIZE)
    if (nextPage > maxPage) return
    queryClient.prefetchQuery({ queryKey: feedKey(nextPage), queryFn: fetchFeedPage, staleTime: 60 * 1000 })
  }, [page, totalCount, feedKey, fetchFeedPage, queryClient])

  // Infinite feed (FB-style): an off-screen sentinel below the list bumps the page
  // as it nears the viewport. Disabled for "near you" (single broad client-filtered
  // fetch) — there's nothing more to page through.
  // ⚠️ UNDIRECTED BROWSE IS NOT AN INFINITE FEED, AND THE MERGE DID NOT CHANGE THAT. The
  // results grid is now on screen from the first paint, which makes it tempting to read
  // "results are always shown" as "the home page is now an endless scroll". It is not: while
  // showDiscovery holds, the sentinel below is inert and the feed ends on the "Browse
  // everything" button, so the FOOTER stays reachable on the site's most-visited page. The
  // button loads page 2 and sets this to true, which hands the rest over to the sentinel.
  // A searched or faceted view auto-paginates from the start, exactly as before — the moment
  // the visitor directs the feed they have opted in.
  // ⚠️ Restored from the back-nav snapshot too (see the restore effect, which calls
  // setFeedUnlocked(snap.unlocked === true)): coming back to a deep feed with the gate re-armed
  // dead-ends the buyer at a button they already pressed.
  // ⚠️ KNOWN GAP, NOT CLOSED ON PURPOSE (external reviewer): the MAP view paginates through its
  // own in-column sentinel without ever setting this, so map-then-grid on the home page can land
  // on sixty loaded cards with the gate re-armed and the "Browse everything" button back. That is
  // an odd affordance, not a dead end — the button works and loads from where the feed actually
  // is. The obvious fix (unlock on any auto-pagination) is worse: it would leave the home feed
  // infinite after any directed browsing, which is precisely the footer-loss this gate exists to
  // prevent, so it trades a cosmetic oddity for the regression.
  const [feedUnlocked, setFeedUnlocked] = useState(false)
  /**
   * How many rows auto-pagination may reach before it stops and waits for a click. Raised by one
   * CAP per press, so the feed alternates auto-load → button → auto-load. See AUTO_LOAD_CAP.
   */
  const [autoLoadCeiling, setAutoLoadCeiling] = useState(AUTO_LOAD_CAP)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  // Map viewport centre (moveend) — anchors the nearest-first list sort.
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null)
  // Map-view list ranking (user decision 2026-07-14): nearest first with the
  // seller's trust score carrying HALF the weight — a close low-trust listing
  // shouldn't outrank a slightly-farther Trusted seller. Proximity is normalized
  // across the visible set; trust against the ladder's practical 160 ceiling.
  const mapSortedListings = useMemo(() => {
    const anchor = nearby ? { lat: nearby.lat, lng: nearby.lng } : mapCenter
    if (!anchor) return shownListings
    // (plain record — kept from when `Map` was shadowed by a lucide icon import here)
    const dists: Record<string, number> = {}
    for (const l of shownListings) {
      const c = getListingCoordinates(l)
      dists[l.id] = c ? haversineKm(anchor, c) : Number.POSITIVE_INFINITY
    }
    const finite = Object.values(dists).filter((d) => Number.isFinite(d))
    const min = Math.min(...finite), max = Math.max(...finite)
    const span = Math.max(1e-6, max - min)
    const score = (l: (typeof shownListings)[number]) => {
      const d = dists[l.id] ?? Number.POSITIVE_INFINITY
      const prox = Number.isFinite(d) ? 1 - (d - min) / span : 0
      const trust = Math.min(l.seller?.trustScore ?? 60, 160) / 160
      return 0.5 * trust + 0.5 * prox
    }
    return [...shownListings].sort((a, b) => score(b) - score(a))
  }, [shownListings, nearby, mapCenter])
  const mapSentinelRef = useRef<HTMLDivElement | null>(null)
  const mapWrapRef = useRef<HTMLDivElement | null>(null)
  /**
   * ⚠️ `nearby` NO LONGER DISABLES PAGINATION. It had to while the area was filtered in the browser:
   * page two would have been sieved against the same circle and produced ragged, half-empty pages.
   * The database applies the area now, so an area search pages exactly like an unfiltered one — and
   * `totalCount` is the count of the area rather than of the whole city.
   */
  const hasMore = !reachedEnd && listings.length < totalCount
  /**
   * ⛔ THE NEXT ROWS ARE RESERVED IN THE GRID THE MOMENT THEY ARE ASKED FOR — as skeleton cells in the
   * SAME grid, so a page that is on its way already has its height.
   * Measured on production, "Browse everything" at 390×844: CLS 0.514, 3 of 3 runs. The tap unmounted
   * the button, the discovery shelves below rose ~95px into its place UNDER THE FINGER and sat there
   * for 0.7–0.9s, then the page-2 rows landed and threw them 2,000px down — a shift nobody's input
   * explained. With the cells appended in the tap's own commit the shelves move down inside the input
   * window (not counted as layout shift), and the cards then replace the cells in place:
   * ListingCardSkeleton is the card's own box model, class for class.
   * Three moments, each bounded by the query's own state so a cell can never be left behind:
   *   · the grid LAGGING the rows it was handed (`useDeferredValue`) — exactly the missing count;
   *   · the next page IN FLIGHT: `isFetching` AND `isPlaceholderData` (the rows on screen are the
   *     previous page's answer). A background revalidation of a page already shown is not
   *     placeholder data, so a window-focus refetch reserves nothing;
   *   · that page's answer LANDED but the sync effect (a passive effect) has not appended it yet —
   *     then EXACTLY its not-yet-loaded rows, the same `fresh` set the effect is about to append
   *     (same offset test, same "not already loaded" test), so the count falls to 0 in the commit
   *     that appends them. A page of duplicates has no such rows, and an empty deeper page sets
   *     `reachedEnd`.
   * ⚠️ KNOWN AND ACCEPTED: cells reserved for rows that then do not come — a failed request, a page
   * of duplicates, a page shorter than the count promised — collapse when the answer says so. That
   * is a shift, but a rare one, and the alternative (keeping cells for rows that are not coming) is a
   * feed that ends in grey cards.
   * ⚠️ Page 1 never reserves: a filter change REPLACES the rows (placeholder dim), it does not extend
   * them. Grid and list views (each with its own row skeleton); map and video page elsewhere. The
   * sentinel is untouched and stays mounted below the grid, cells or not (landmine).
   */
  const loadedIds = useMemo(() => new Set(listings.map((l) => l.id)), [listings])
  const pendingRows = (() => {
    if ((viewMode !== 'grid' && viewMode !== 'compact') || page <= 1 || failedWithoutAnswer) return 0
    // Against what the grid RENDERS (`gridListings`): while a restore renders the rows directly there
    // is no lag, and counting the deferred copy's would draw skeleton cells under rows already shown.
    const lag = shownListings.length - gridListings.length
    if (lag > 0) return lag
    if (!hasMore || queryError) return 0
    const next = Math.min(FIRST_PAGE_SIZE, totalCount - listings.length)
    if (next <= 0) return 0
    if (queryFetching && queryShowingStaleSet) return next
    const landed = listingsData as { offset?: number; listings?: SerializedListingCard[] } | undefined
    if (queryShowingStaleSet || landed?.offset !== (page - 1) * FIRST_PAGE_SIZE) return 0
    return Math.min(next, (landed.listings ?? []).filter((l) => !loadedIds.has(l.id)).length)
  })()
  useEffect(() => {
    if (!hasMore) return
    // ⚠️ THE GATE, AND IT IS THE REASON THE HOME PAGE HAS A FOOTER. Undirected browse never
    // arms this observer until the visitor presses "Browse everything" (see feedUnlocked).
    // showDiscovery, NOT isLandingMode — see the note where it is derived: the map view is
    // undirected browsing too, but it has no "Browse everything" button to unlock with, so
    // gating it produces a dead end rather than a reachable footer.
    if (showDiscovery && !feedUnlocked) return
    // ⛔ THE CAP. Past the ceiling the observer is never created, so the sentinel sits inert and the
    // footer's "Load more" is the only way on. Deliberately NOT done by unmounting the sentinel:
    // this file's standing invariant is that the sentinel div must never be hidden/display:none
    // (a hidden element is never intersected and pagination dies silently) — leaving it mounted and
    // simply not observing it keeps that guarantee true while still stopping the auto-fetch.
    if (listings.length >= autoLoadCeiling) return
    // ⚠️ NEVER AUTO-PAGE A FEED WHOSE QUERY HAS NOT LANDED YET. `query` is the committed search
    // and `debouncedQuery` is what the fetcher actually uses, 150ms behind it; while they differ
    // the rows on screen belong to the PREVIOUS query, so appending page 2 appends the wrong
    // inventory and then throws it away when the filter signature settles and resets page to 1.
    // The window that matters is a deep link: /?q=… is served the UNFILTERED prerender, so twelve
    // unrelated cards paint with the sentinel 600px below them, inside the viewport on a desktop
    // screen, before the query has been debounced even once. Measured as pre-existing rather than
    // new — the listingsData sync effect sets totalCount to initialTotal on the first effect flush
    // whether or not the state is seeded, so the observer armed one commit later without this
    // guard — but seeding totalCount widened it, and an external reviewer was right to say so.
    if (query.trim() !== debouncedQuery.trim()) return
    // Nor while a cold deep link's seed is still masked (E-SSR): those rows are not this URL's answer.
    if (seedMasked) return
    // Nor past a page that has no answer of its own — it would be skipped for good (see `pageWithoutAnswer`).
    if (pageWithoutAnswer) return
    const isMap = viewMode === 'map'
    // ⚠️ THE WINDOW IS THE ROOT IN EVERY VIEW NOW (E-MAP, 2026-09-29). The desktop map list used to be
    // its own scroll box and this observed against it; the list scrolls with the page since, so its
    // sentinel is simply the one at the bottom of the list column.
    const el = isMap ? mapSentinelRef.current : loadMoreRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !queryFetching) {
          prefetchNextPage() // warm page+1 so the swap is instant
          setPage((p) => p + 1)
        }
      },
      { root: null, rootMargin: '600px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, queryFetching, prefetchNextPage, viewMode, showDiscovery, feedUnlocked, query, debouncedQuery, listings.length, autoLoadCeiling, seedMasked, pageWithoutAnswer])

  // One detail view everywhere: any card/pin click navigates to the full listing
  // page (no modal).
  const handleOpen = useCallback((l: SerializedListingCard) => {
    // Snapshot the feed so a back-nav lands the buyer exactly where they left off
    // (rows + page + scroll), not at the top of a reset feed. Cap the payload so a
    // very deep scroll can't bloat sessionStorage.
    try {
      // The HOME feed snapshots too (it used to be excluded by `!isLandingMode`, which is
      // exactly the feed that needed it most: it is fully paginated — Load more, then
      // infinite scroll — so back-nav dumped the buyer on a reset page 1 at scroll 0, and
      // the native edge-swipe made that reset read as a bug because it animates a snapshot
      // of the deep feed first). The landing RAILS are not restored — only the paginated
      // grid below them, realigned on the card that was tapped.
      if (listings.length <= 120) {
        const card = document.querySelector(`[data-feed-card="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(l.id) : l.id}"]`)
        sessionStorage.setItem('eno:feed-snap', JSON.stringify({
          sig: feedSig, listings, page, totalCount, scrollY: window.scrollY, ts: Date.now(),
          // Where THESE rows came from — not the current filters, which can already be the next
          // ones while their rows are still loading. See `rowsSigRef`.
          rowsSig: rowsSigRef.current,
          // The home feed's infinite scroll is opt-in; restoring depth without the unlock
          // would strand the buyer behind a "Load more" they already pressed.
          unlocked: feedUnlocked,
          // ⚠️ The auto-load ceiling rides along for the same reason `unlocked` does: coming back
          // to 108 restored rows with the budget reset to 100 would strand the buyer behind a
          // "Load more" they already pressed.
          ceiling: autoLoadCeiling,
          anchorId: l.id,
          anchorTop: card ? card.getBoundingClientRect().top : null,
        }))
        // A snapshot now waits for this entry: hold the browser's own scroll restoration off it, or on
        // Back it clamps the old offset against the short document and shows the FOOTER first
        // (feed-restore.ts has the measurement and why the destination gets 'auto' back).
        holdScrollRestoration(window.location.pathname)
      }
    } catch { /* ignore quota/serialization */ }
    router.push(`/listings/${l.id}`)
  }, [listings, page, totalCount, feedSig, feedUnlocked, autoLoadCeiling, router])
  /**
   * What `commitView` snapshots (NAV-1, `entrySnaps`): the same fields as the card tap's snapshot above, with
   * the ANCHOR being the first card on screen below the pinned chrome — there is no tapped card — so Back
   * realigns that card where it was (feed-restore.ts) whatever grew or shrank above the grid meanwhile. The
   * map's list is not anchored (its cards are not `data-feed-card`): the raw offset stands in. The rows are a
   * COPY, so restoring them is always a new array and the restore's `[listings]` effect always runs.
   * Rebuilt every commit (a layout effect with no deps) so a handler registered once still reads this render.
   */
  useLayoutEffect(() => {
    snapSourceRef.current = () => {
      if (listings.length === 0 || listings.length > 120) return null
      let anchorId: string | null = null
      let anchorTop: number | null = null
      if (viewMode === 'grid' || viewMode === 'compact') {
        const chrome = pinnedChromeBottom(document)
        for (const el of document.querySelectorAll<HTMLElement>('[data-feed-card]')) {
          const r = el.getBoundingClientRect()
          // The first card whose TOP is on screen below the chrome: a card half under the header would be
          // clamped below it by the restore (restoreTargetTop) and land the reader a card higher.
          if (r.top >= chrome - 1 && r.top < window.innerHeight) { anchorId = el.getAttribute('data-feed-card'); anchorTop = r.top; break }
        }
      }
      return {
        sig: feedSig, rowsSig: rowsSigRef.current, listings: [...listings], page, totalCount, scrollY: window.scrollY,
        ts: Date.now(), unlocked: feedUnlocked, ceiling: autoLoadCeiling, anchorId, anchorTop,
      }
    }
  })

  // Warm the listing page before the click (hover on desktop, touchstart on mobile)
  // so it opens instantly instead of SSR-ing on click. De-duped by Next's prefetch cache.
  /**
   * ⛔ DEDUPED, BECAUSE `onFocus` BUBBLES (reviewer). React's `onFocus` is `focusin`, so the wrapper
   * that carries it fires once per FOCUSABLE DESCENDANT — a card with an image button, a title link
   * and a locate button warms the same route three times, and tabbing a 50-card feed would have
   * issued ~150 prefetches. Hover has the same shape on a fast mouse sweep. One route is warmed
   * once per session; `router.prefetch` caches internally too, but not before paying the call.
   */
  const prefetchedRef = useRef<Set<string>>(new Set())
  const prefetchListing = useCallback((id: string) => {
    if (prefetchedRef.current.has(id)) return
    prefetchedRef.current.add(id)
    router.prefetch(`/listings/${id}`)
  }, [router])

  // "Locate on map" from any card/row → switch to the map view focused on this
  // listing (the map flies to + opens its pin). Scrolls the feed into view so the
  // map is visible after the mode switch.
  const locateOnMap = useCallback((id: string) => {
    /**
     * ⛔ FROM THE TEACHERS FEED, "SHOW ON MAP" OPENS THE MARKETPLACE MAP (gate review, 2026-10-09). The map cannot open
     * over that feed (`mapOffered`), and no teacher card or row offers this — what reaches here from it is a card in the
     * sparse-results recovery rail (ForYouRail `recovery` → `eno:locate`): a rental, a job, something with a place.
     * Refused, the tap would do nothing but scroll. So it opens the map a card OUTSIDE the explorer opens (listing-card.tsx,
     * `/?focus=`): the unfiltered map, focused on that listing — the logo's reset plus the map, as ONE step Back undoes
     * (`commitView` snapshots the teachers feed first).
     * ⚠️ The whole reset, not just the category: the reader's search words can match nothing under 'all', and a feed with
     * no rows draws the empty state instead of the map — the located listing would not be on screen at all.
     */
    if (!mapOfferedRef.current) {
      commitView()
      resetToLandingPage()
      setActiveProvince(null)
      setActiveWard(null)
      setNearby(null)
    } else if (viewModeRef.current !== 'map') commitView() // "show on map" takes the reader into the map (NAV-1)
    setViewMode('map')
    setShowExplorer(true)
    setHoveredId(id)
    setFocusId(id)
    // Land ON the map (under the sticky header) — NOT at the top of the rails. The
    // map mounts on this same render; wait two frames for the commit, then scroll the
    // map element itself (its scroll-mt clears the header).
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        (mapWrapRef.current ?? document.getElementById('listings'))?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
      }),
    )
  }, [commitView, resetToLandingPage]) // both stable (useCallback, no changing deps) — the cards' callback stays one identity
  // ONE stable per-feed callback for cards (not a fresh `() => locateOnMap(l.id)`
  // per card per render) — lets the memoized ListingCard skip re-render during the
  // map hover/focus storm. The card hands back its own listing.
  const locateListing = useCallback((l: SerializedListingCard) => locateOnMap(l.id), [locateOnMap])

  // A card outside the feed (e.g. the For You rail) asks us to open it on the map. It
  // passes the full listing so we can inject it into the map even if it isn't in the
  // currently-loaded feed (otherwise focus would find nothing to fly to).
  useEffect(() => {
    const onLocate = (e: Event) => {
      const d = (e as CustomEvent<{ id?: string; listing?: SerializedListingCard }>).detail
      if (!d?.id) return
      if (d.listing) setFocusListing(d.listing)
      locateOnMap(d.id)
    }
    window.addEventListener('eno:locate', onLocate)
    return () => window.removeEventListener('eno:locate', onLocate)
  }, [locateOnMap])

  // Deep-link from a card on another page (seller storefront, /saved): `/?focus=<id>`
  // opens THAT listing on the map view, zoomed in — even if it isn't in the home feed
  // (we fetch it by id and inject it). Runs once on mount.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('focus')
    if (!id) return
    setViewMode('map'); setShowExplorer(true) // switch immediately, no landing-mode flash
    fetch(`/api/listings?ids=${encodeURIComponent(id)}${lang !== 'en' && lang !== 'vi' ? `&lang=${lang}` : ''}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const l = d?.listings?.[0] as SerializedListingCard | undefined
        if (l) { setFocusListing(l); locateOnMap(l.id) }
      })
      .catch(() => {})
    // Strip the param so a later filter change / refresh doesn't re-trigger.
    const u = new URLSearchParams(window.location.search); u.delete('focus')
    // Keep history.state (see the write-back effect) — null would drop the video-return flag.
    window.history.replaceState(window.history.state, '', u.toString() ? `?${u}` : window.location.pathname)
    // lang: re-runs are no-ops after the focus param is stripped above.
  }, [locateOnMap, lang])

  // Intent shortcuts (Free / Wanted) from the landing grid → open the explorer
  // filtered by listingType across all categories.
  const browseIntent = useCallback((type: string) => {
    setListingType(type)
    setShowExplorer(true)
    document.getElementById('listings')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
  }, [])

  // Save the current filter set → the buyer gets alerted (in-app + push) on new matches. (extracted)
  const saveSearchFilters = {
    activeCategory, activeSubcategory, activeBrand, activeModel, listingType,
    debouncedQuery, activeDistrict, conditionFilter, priceRange, customFilters,
  }
  /**
   * ⛔ NULL ON THE TEACHERS CATEGORY (owner decision, 2026-10-09 — saved-search.ts savedSearchOffered): the alert cron
   * never sends a teachers alert, so no button here may promise one. Every "Save search" / "Create an alert for this
   * search" below renders under `saveSearch && …` — `onClick={saveSearch}` does not type-check otherwise, so a new
   * entry point cannot skip the rule. Every other category: exactly as before.
   */
  const saveSearch = useSaveSearch(saveSearchFilters)
  /**
   * ⛔ ON A PHONE, "SAVE SEARCH" IS OFFERED FROM THE FIRST QUERY OR FILTER, LABELLED, AT 44px (UX3 JOIN-SAVE —
   * UX2 B1 items 3-4, handed over). It was an unlabelled 36×24 bookmark that appeared only from the SECOND
   * filter (`SAVE_SEARCH_MIN_FILTERS`), so "tell me when a new flat appears" — the account's best promise on
   * rental pages, where 0 of 32 sampled listings have chat — was invisible on the device most visitors use.
   * Same flow as before (`saveSearch`: a guest gets the sign-in sheet with its note), shown whenever a save
   * would keep something (`hasSavableSearch` — an area alone is not part of a saved search). From sm up the
   * labelled button keeps its two-filter offer beside the view modes, as before.
   */
  const phoneSaveOffered = !showDiscovery && hasSavableSearch(saveSearchFilters)

  // Distinct from the empty state: a failed fetch (DB down, 500) must NOT read as
  // "no listings" — show an error + retry so the marketplace never looks empty.
  // (It was hoisted here to clear the old isLandingMode early return's TDZ. That return is
  // gone as of 2026-08-11 — there is one tree now — so the position is no longer load-bearing;
  // it is left where it is because moving it would be churn for nothing.)
  // ⛔ THE FAULT COIN, NOT THE BRAND ONE (D-STATES, 2026-09-29). This rendered a failure on the warm
  // `bg-brand-50` "nothing here yet" disc — EmptyState's `variant="fault"` exists for exactly this
  // (neutral disc, destructive ink; see ui/empty-state.tsx) and had no call site. `tone="bare"`: flat
  // canon §3b, no box on the canvas. The retry is the primitive CTA at its own size, not a hand-sized one.
  const renderErrorState = (className?: string) => (
    <EmptyState
      variant="fault"
      tone="bare"
      icon={AlertTriangle}
      // `role="alert"` on the text itself: when a filter change fails, the result line's live count
      // goes blank (see `failedWithoutAnswer`), so without this a screen-reader user would hear the
      // number vanish and never be told why. On the text, not a wrapper, so the button is not in it.
      title={<span role="alert">{tr("Couldn't load listings.", 'Không tải được tin đăng.')}</span>}
      className={className}
      action={
        <Button variant="cta" onClick={() => refetchListings()}>
          {tr('Try again', 'Thử lại')}
        </Button>
      }
    />
  )

  // A load-more page that failed (see `pageWithoutAnswer`): said where its rows would have been, with the one
  // way on — asking for THAT page again. `role="alert"` on the text, as the page-1 error state above does, so
  // the reader who scrolled into it is told; the button is not in it. tap-44: the sm button draws 32px.
  const renderMoreError = (className?: string) => (
    <div className={cn('flex flex-col items-center gap-3 text-center', className)}>
      <p className="text-sm text-muted-foreground"><span role="alert">{tr('Couldn’t load more listings.', 'Không tải thêm được tin đăng.')}</span></p>
      <Button variant="outline" size="sm" className="relative tap-44" onClick={() => { void refetchListings() }}>
        {tr('Try again', 'Thử lại')}
      </Button>
    </div>
  )

  // ── THE TYPEAHEAD'S PANEL / LISTBOX DERIVATIONS ─────────────────────────────────────
  // These were locals of the old `if (isLandingMode) return (…)` branch, which is gone: home
  // and search are ONE view as of 2026-08-11 (see isLandingMode above). The hero search INPUT
  // they described went earlier — 2026-08-03, when the bar moved into the header — so nothing
  // in this file has rendered an input for them since that date.
  //
  // ⚠️ THEY ARE KEPT, NOT DELETED, AND THE REST OF THE TYPEAHEAD ABOVE THEM WITH THEM
  // (landingQuery, heroSuggest, heroSuggestItems, the arrow-key nav, pickHeroSuggest). Together
  // they are the COMPLETE a11y contract for an in-page search input: which panel is open, whether
  // that panel is the listbox (≥2 chars) rather than the recents/Popular panel, and the
  // active-descendant id. Re-deriving that from scratch is exactly how the hero and header bars
  // drifted apart the first time; use-search-box.ts documents the contract.
  //
  // ⚠️ THE LIVE TYPEAHEAD IS header.tsx's, and it is untouched. It reaches this component through
  // the `eno:search` / `eno:visual-search` / `eno:set-area` events, and since the merge those
  // events filter the results IN PLACE — they no longer swap the page into a second layout.
  const heroPanelOpen = showSuggestions && (
    landingQuery.trim().length >= 2 || recentSearches.length > 0 || recentLocations.length > 0 || categories.length > 0 || trending.length > 0
  )
  const heroListOpen = showSuggestions && landingQuery.trim().length >= 2
  const heroActiveOptionId = activeSuggestOptionId(SUGGEST_ID, heroListOpen, heroActiveIdx, heroSuggestItems.length)

  /**
   * THE LADDER PATH, AS THE BREADCRUMB ON THE INFO LINE — "Vehicles › Manual › Honda › Vision".
   *
   * ⚠️ IT NAMES THE TAPS, NOT THE FILTERS, and that is why it is separate from the chips beside
   * it. A crumb is a level of the one ladder the whole product walks (category → subcategory →
   * brand → model); a chip is anything else the visitor applied (an area, a price ceiling, a
   * condition). Rendering the ladder as chips too would print "Honda" twice on the same line.
   * ⚠️ Each crumb TRUNCATES BACK TO ITS OWN LEVEL rather than clearing everything: tapping
   * "Manual" should drop the brand and the model and keep the subcategory, which is what someone
   * reaching back up a path means. That is why they carry their own handlers instead of reusing
   * the chips' onClear.
   */
  const ladderCrumbs = useMemo(() => {
    const crumbs: { label: string; onSelect?: () => void }[] = []
    if (activeCategory !== 'all') {
      const cat = categories.find((c) => c.slug === activeCategory)
      crumbs.push({
        label: cat ? tr(cat.name, cat.nameVi || cat.name) : activeCategory,
        onSelect: () => { commitView(); setActiveSubcategory('all'); setActiveBrand('all'); setActiveLine(''); setActiveModel('all') },
      })
    }
    if (activeSubcategory !== 'all') {
      const sub = SUBCATEGORIES[activeCategory]?.find((s) => s.slug === activeSubcategory)
      crumbs.push({
        label: sub ? tr(sub.name, sub.nameVi || sub.name) : activeSubcategory,
        onSelect: () => { commitView(); setActiveBrand('all'); setActiveLine(''); setActiveModel('all') },
      })
    }
    if (activeBrand !== 'all') {
      crumbs.push({ label: prettyBrand(activeBrand), onSelect: () => { commitView(); setActiveModel('all') } })
    }
    // The deepest crumb is where you already are, so it gets no handler — a control that does
    // nothing is worse than plain text, and ResultLine renders a handler-less crumb as text.
    if (activeModel !== 'all') crumbs.push({ label: activeModel })
    return crumbs
  // `tr` AND `trVersion`, not just `lang`: the crumbs are translated, and a translation that lands after the
  // first render changes `tr` (the warmed batch re-renders the provider) or only the store version (a lazy,
  // per-string arrival) — never `lang`.
  }, [activeCategory, activeSubcategory, activeBrand, activeModel, categories, lang, tr, trVersion])

  /** The words the grid answers: the server's corrected spelling when it corrected them, else the typed ones. */
  const resultsTerm = correctedQuery ?? debouncedQuery.trim()

  /**
   * The returning-visitor recents row (E-RETURNING, O-16) — see the row's own note in the render. At
   * most eight: one swipe of chips, not the history page.
   * ⚠️ THE ATTRIBUTE IS KEPT IN STEP FROM STORAGE AS WELL AS STATE. `useSearchHistory` loads the list in
   * its own mount effect, so on a cold load this effect first runs with an EMPTY `recentSearches`;
   * dropping the pre-paint reservation then would collapse the row and shift the feed, only to reopen
   * it a render later. Storage is the list the pre-paint script read, so it is the tie-breaker.
   */
  const recentTerms = useMemo(() => recentSearchTerms(recentSearches).slice(0, 8), [recentSearches])
  const showRecentsRow = showDiscovery && !sellerId
  useEffect(() => {
    if (!showRecentsRow) return
    let stored: string[] = []
    try { stored = recentSearchTerms(JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || '[]')) } catch { /* blocked or corrupt: no row */ }
    const root = document.documentElement
    if (recentTerms.length > 0 || stored.length > 0) root.setAttribute(RECENTS_ATTR, '')
    else root.removeAttribute(RECENTS_ATTR)
  }, [showRecentsRow, recentTerms])

  /**
   * ⛔ THE TAB SAYS WHAT THE FEED IS (E-TITLE, 2026-09-29). Home is one 6h-ISR document with one static
   * title, so /?q=honda, /?category=rentals and the bare home all read "eno.vn - Trusted Expat
   * Marketplace in Vietnam" in the tab, the history list and a shared bookmark. A directed feed now
   * titles itself `“honda” · 1,204 listings | eno.vn` (the deepest ladder rung stands in for the words:
   * `Rentals · 5,432 listings | eno.vn`), and undirected browse hands the page's own title back.
   * ⚠️ ONLY FROM AN ANSWER TO THE CURRENT QUESTION. Not while `placeholderData` (the previous key's rows)
   * is showing, not over a failed page 1, and only once the count on screen IS that answer's
   * (`totalCount` is adopted by the passive sync effect, a render after the payload lands — naming the
   * new words beside the old number for that render is the "3 listings over 39 cards" class again).
   * ⚠️ IT NEVER OVERWRITES A TITLE IT DID NOT WRITE. Next owns <title> and re-renders it on navigation,
   * and this effect's cleanup runs AFTER that commit — so the base is re-read whenever the tab no
   * longer shows ours, and it is only restored while the tab still shows ours. Otherwise leaving for a
   * listing would put the home title on the listing's tab.
   * ⚠️ Storefronts (`sellerId`) own their title and are left alone.
   */
  const titleRef = useRef<{ base: string; mine: string } | null>(null)
  useEffect(() => {
    if (sellerId) return
    const held = titleRef.current
    const handBack = () => {
      if (held && document.title === held.mine) document.title = held.base
      titleRef.current = null
    }
    if (showDiscovery || failedWithoutAnswer) { handBack(); return }
    if (!listingsData || queryShowingStaleSet) return
    const count = nearby ? shownListings.length : totalCount
    if (!nearby && count !== listingsData.total) return
    const lead = resultsTerm ? `“${resultsTerm}”` : ladderCrumbs[ladderCrumbs.length - 1]?.label
    const next = `${[lead, resultCountLabel(count, lang, tr)].filter(Boolean).join(' · ')} | ${SITE_NAME}`
    const base = held && document.title === held.mine ? held.base : document.title
    if (document.title !== next) document.title = next
    titleRef.current = { base, mine: next }
  }, [sellerId, showDiscovery, failedWithoutAnswer, listingsData, queryShowingStaleSet, nearby, shownListings, totalCount, resultsTerm, ladderCrumbs, lang, tr])
  // Leaving the page hands the tab back — unless the next page has already titled it (see above).
  useEffect(() => () => {
    const held = titleRef.current
    if (held && document.title === held.mine) document.title = held.base
  }, [])

  /**
   * The applied chips in the shape <ResultLine> takes. The ladder levels are dropped because the
   * BREADCRUMB above already names them — the subcategory and the brand+model chips would
   * otherwise print the same words twice on one line.
   * ⚠️ The id is the label rather than an index: ResultLine keys on it to know when a removal has
   * landed, and an index shifts under every neighbouring removal.
   */
  // Active applied-filter chips — shared by the persistent results bar AND the
  // empty state so the two never drift. Brand+model collapse into one chip.
  /**
   * ⛔ WHAT THE FACET PILLS ALREADY SAY (E-ACTIVE, owner O-14, 2026-09-30). The Area, Price, Condition
   * and Type pills print their applied value in the sticky bar ("Quận 7", "1.5M–3.9M ₫", "Used", "For
   * rent"), so a chip for the same value on the result line was the same fact twice, one row apart. A
   * chip is `pill: true` exactly when its pill shows its value — mirrored from facet-bar.tsx's own
   * rules, which is why each line below names the rule it copies — and <ResultLine> draws only the
   * rest. `getActiveChips()` itself still returns EVERY applied filter: the empty state's relax list,
   * "Clear all" and the save-search threshold count what is applied, not what is drawn.
   * ⚠️ A FILTER WHOSE PILL CANNOT SHOW IT KEEPS ITS CHIP — a listing type the category's Type pill does
   * not offer (the pill then reads its placeholder), a condition value outside the category's facet,
   * and every area chip other than the ONE place the Area pill names (ward, else radius, else district,
   * else province). A chip is only dropped when the value is on screen elsewhere.
   */
  const pillTypeValues = activeCategory === 'all' ? LISTING_TYPES.map((t) => t.value as string) : (typesFor(activeCategory) as string[])
  const typePillShows = listingType !== 'all' && pillTypeValues.length > 1 && pillTypeValues.includes(listingType)
  const pillConditionFacet = activeCategory === 'all'
    ? CONDITION_FACET
    : facetsFor(activeCategory, activeSubcategory === 'all' ? null : activeSubcategory).find((f) => f.key === 'condition') ?? CONDITION_FACET
  const conditionPillShows = conditionFilter !== 'all' && pillConditionFacet.options.some((o) => o.value === conditionFilter)
  // facet-bar.tsx `areaLabel`, with the district it is handed (`district=` on <FacetBar> below).
  const pillDistrict = activeDistrict !== 'all' ? activeDistrict : (serverInferredDistrict ?? 'all')
  const areaPillLabel = activeWard
    ? (lang === 'vi' ? activeWard.name : activeWard.nameEn)
    : nearby
    ? fillTemplate(tr('Within {radiusKm} km', 'Trong {radiusKm} km'), 'Within {radiusKm} km', { radiusKm: String(nearby.radiusKm) })
    : pillDistrict !== 'all'
    ? districtSlugLabel(pillDistrict, lang)
    : activeProvince
    ? (lang === 'vi' ? activeProvince.name : activeProvince.nameEn)
    : null
  const getActiveChips = (): { label: string; onClear: () => void; pill?: boolean }[] => {
    const chips: { label: string; onClear: () => void; pill?: boolean }[] = []
    /**
     * ⚠️ A DISTRICT READ OUT OF THE QUERY GETS ITS OWN CHIP — WHEN THE SERVER SAYS IT APPLIED ONE.
     * The server turns "căn hộ quận 7" into the d7 scope plus the text "căn hộ" (src/lib/
     * district-query.ts), unless an explicit district wins or the reading finds nothing where the
     * plain words find something; `serverInferredDistrict` is its answer (see above), so the chip can
     * never name a district the grid is not in. Two chips say what was applied, and each one clears
     * ONLY itself: removing the district leaves the words, removing the words leaves the district
     * phrase in the box (which re-infers the same district).
     */
    for (const c of queryChips(debouncedQuery, serverInferredDistrict, lang)) {
      if (c.kind === 'text') chips.push({ label: `"${c.text}"`, onClear: () => setQuery(c.clearTo) })
      else {
        const d = DISTRICTS.find((x) => x.slug === c.slug)
        if (d) { const label = lang === 'vi' ? d.name : d.nameEn; chips.push({ label, onClear: () => setQuery(c.clearTo), pill: label === areaPillLabel }) }
      }
    }
    if (activeSubcategory !== 'all') {
      const sub = SUBCATEGORIES[activeCategory]?.find((s) => s.slug === activeSubcategory)
      chips.push({ label: sub ? tr(sub.name, sub.nameVi || sub.name) : activeSubcategory, onClear: () => setActiveSubcategory('all') })
    }
    if (activeBrand !== 'all') {
      chips.push({ label: activeModel !== 'all' ? `${prettyBrand(activeBrand)} · ${activeModel}` : prettyBrand(activeBrand), onClear: () => { setActiveBrand('all'); setActiveLine(''); setActiveModel('all') } })
    } else if (activeModel !== 'all') {
      chips.push({ label: activeModel, onClear: () => setActiveModel('all') })
    }
    if (activeDistrict !== 'all') {
      // ⚠️ A DISTRICT SLUG DOES NOT HAVE TO COME FROM `DISTRICTS`. The /c/<category>/<district>
      // landing pages send their own slugified district name (`thao-dien`), which the API resolves
      // (src/lib/district-slug.ts) but this list does not carry. The chip must still read as a
      // place rather than as a URL fragment, so an unknown slug is de-slugified for display — the
      // filter itself is the server's answer, not this label (districtSlugLabel, shared with the
      // facet bar's Area pill).
      const label = districtSlugLabel(activeDistrict, lang)
      chips.push({ label, onClear: () => setActiveDistrict('all'), pill: label === areaPillLabel })
    }
    // Area / location (new province→ward model + "near you" radius) — so the saved
    // search + alert clearly include where the user is looking.
    if (nearby) {
      const label = fillTemplate(tr('Within {radiusKm} km', 'Trong {radiusKm} km'), 'Within {radiusKm} km', { radiusKm: String(nearby.radiusKm) })
      chips.push({ label, onClear: () => { setNearby(null); setActiveProvince(null); setActiveWard(null) }, pill: label === areaPillLabel })
    } else if (activeWard) {
      const label = lang === 'vi' ? activeWard.name : activeWard.nameEn
      chips.push({ label, onClear: () => setActiveWard(null), pill: label === areaPillLabel })
    } else if (activeProvince) {
      const label = lang === 'vi' ? activeProvince.name : activeProvince.nameEn
      chips.push({ label, onClear: () => { setActiveProvince(null); setActiveWard(null) }, pill: label === areaPillLabel })
    }
    // The Price pill is always drawn and prints the applied range (price-range-filter.tsx `triggerText`).
    if (priceRange !== 'all') chips.push({ label: tr('Price range', 'Khoảng giá'), onClear: () => setPriceRange('all'), pill: true })
    if (conditionFilter !== 'all') chips.push({ label: conditionFilter === 'new' ? tr('New', 'Mới') : tr('Used', 'Đã dùng'), onClear: () => setConditionFilter('all'), pill: conditionPillShows })
    // A chip as well as the pressed toggle: the chip row is what the empty state and "Clear all"
    // read, and a filter with no chip would leave "No listings found" with nothing to remove.
    if (goodPriceOnly) chips.push({ label: tr('Good price', 'Giá tốt'), onClear: () => setGoodPriceOnly(false) })
    if (listingType !== 'all') {
      const lt = LISTING_TYPES.find((t) => t.value === listingType)
      chips.push({ label: lt ? tr(lt.label, lt.labelVi) : listingType, onClear: () => setListingType('all'), pill: typePillShows })
    }
    // ⛔ NAMED BY THE TAXONOMY, NOT BY THE STATE KEY (E-ACTIVE, 2026-09-29): "bedrooms: 2" and
    // "areaM2: 30-80" read as debug output on the one line that says what is narrowing the feed.
    const facetDefs = facetsFor(activeCategory, activeSubcategory === 'all' ? null : activeSubcategory)
    Object.entries(customFilters).forEach(([k, v]) =>
      chips.push({
        label: customFilterChipLabel(facetDefs.find((f) => f.key === k), k, v, lang, tr),
        onClear: () => setCustomFilters((prev) => { const n = { ...prev }; delete n[k]; return n }),
      }),
    )
    return chips
  }

  // The labels the breadcrumb already shows. A chip carrying one of these would print the same
  // word twice on one line, which is what made the old two-row layout read as noise.
  const ladderChipLabels = useMemo(
    () => new Set(ladderCrumbs.map((c) => c.label)),
    [ladderCrumbs],
  )

  // Every applied filter the breadcrumb does not already name — what "Clear all" and the save-search
  // threshold count. `resultFilters` below is the subset the line DRAWS (no pill duplicates, O-14).
  const appliedChips = useMemo(
    () => getActiveChips().filter((c) => !ladderChipLabels.has(c.label)),
    // ⚠️ `activeLine` BELONGS HERE: the chip row is what tells a user a filter is applied, and a
    // cascade line selection is a filter. The eslint-disable that used to sit on this line is gone
    // because it was reported UNUSED once the array was complete — a stale suppression is worse
    // than none, since it hides the next omission too.
    // `serverInferredDistrict` too: the district chip is the server's answer and arrives after the words.
    // `activeCategory` + `tr`: the custom-filter chips are named from the category's facets (E-ACTIVE).
    [debouncedQuery, serverInferredDistrict, activeCategory, activeSubcategory, activeBrand, activeModel, activeLine, activeDistrict, activeProvince, activeWard, conditionFilter, goodPriceOnly, listingType, priceRange, customFilters, verifiedOnly, nearby, lang, tr],
  )
  /**
   * ⛔ REMOVING A FILTER IS A STEP TOO (UX3 NAV-1, review): a search or a tile pushed an entry, and taking the
   * chip off in place rewrote that entry back to the URL BELOW it — two identical entries, so the next Back
   * changed nothing. As a commit it pushes, and Back puts the filter back (Baymard: Back undoes the last
   * filter change, in either direction). `commitView` is stable, so the memo still only follows the chips.
   */
  const resultFilters = useMemo(
    () => appliedChips.filter((c) => !c.pill).map((c) => ({ id: c.label, label: c.label, onRemove: () => { commitView(); c.onClear() } })),
    [appliedChips, commitView],
  )


  const clearAllFilters = () => {
    setQuery('')
    // ⚠️ THE CATEGORY IS A FILTER, WHATEVER ELSE IT ALSO IS. It was the one axis this function
    // left standing — the component treats the category as navigation (it drives the rail, the
    // facet set and the brand directory) rather than as a removable chip, so getActiveChips()
    // does not emit one for it and this reset skipped it. The result was a button labelled
    // "Clear all filters" that left the visitor inside an empty category with zero results and
    // nothing on screen admitting why; two external reviewers found it independently. Clearing it
    // is also what the merged tree makes coherent: with one page, dropping the category puts the
    // visitor back on the home tiles (in the grid and compact views — see the note on viewMode at
    // the end of this function) instead of on a second, emptier page.
    setActiveCategory('all')
    setActiveSubcategory('all')
    setActiveBrand('all'); setActiveLine('')
    setActiveModel('all')
    setActiveDistrict('all')
    setActiveProvince(null)
    setActiveWard(null)
    setNearby(null)
    setPriceRange('all')
    setConditionFilter('all')
    setGoodPriceOnly(false)
    setListingType('all')
    setCustomFilters({})
    setVerifiedOnly(true)
    // ⚠️ AND showExplorer, OR NOTHING ABOVE IS OBSERVABLE. Measured: the ONLY other place in this
    // file that sets it false is resetToLandingPage — the sync effect one-way-latches it TRUE and
    // never clears it. So without this line "Clear all filters" cleared the filters and left the
    // visitor on a filterless RESULTS view: no banner, no tiles, no shelves, BrandRail firing
    // /api/brands at category=all, "Found N listings" where "Latest listings" belongs, and —
    // because showDiscovery false + feedUnlocked false arms the sentinel — an infinite home feed
    // with no reachable footer. Two external reviewers found this independently, and it was
    // introduced by this wave: before the merge showExplorer only chose between two trees, so a
    // stale TRUE with nothing applied rendered a results page that looked deliberate.
    // ⚠️ CLEARING showExplorer AND RE-GATING THE FEED IS NOT DONE HERE — the un-latch layout
    // effect further up owns both, for every route out of a filtered state rather than just this
    // button. Doing it here as well was the first attempt; it left the FacetBar's own "Clear",
    // the chip ✕ and an emptied header search still stranding the visitor.
    // ⚠️ THE VIEW IS DELIBERATELY *NOT* RESET HERE, and that is the one place this function and
    // resetToLandingPage differ. Two reviewers called it an omission; it is a decision. The logo
    // means "take me home", so it restores the home view wholesale. "Clear all filters" is a
    // control ON the results, and a visitor who chose the map does not expect clearing a price
    // range to close it. Clearing in map/video therefore keeps showDiscovery false and leaves
    // them on a filterless MAP — which is a real destination (the footer's Map link opens exactly
    // it) carrying the category rail, brand rail, facets, sort and the view toggles, not a dead
    // end. That is why the setActiveCategory note above is scoped to grid and compact rather
    // than claiming a home reset outright.
  }

  // Save-search + active-filter chips box. `compact` = the desktop version that sits on
  // the sort row and fills the space up to the "Newest" dropdown (one horizontal line:
  // chips left, Save right). Non-compact = the full-width mobile version on its own
  // line. Each chip removes its own filter; "Clear all" resets them.
  const renderSaveBox = (compact: boolean, className?: string) => {
    const chips = getActiveChips()
    if (chips.length === 0) return null
    const chipBtns = (
      <>
        {chips.map((c, i) => (
          <Button
            key={i}
            variant="bare"
            size="none"
            onClick={c.onClear}
            aria-label={tr('Remove filter', 'Bỏ bộ lọc') + `: ${c.label}`}
            className="whitespace-normal text-left inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 text-xs font-semibold text-foreground shadow-sm transition-colors hover:bg-muted cursor-pointer"
          >
            {c.label}
            <X className="h-3 w-3 text-ink-4" />
          </Button>
        ))}
        {/* ⚠️ > 0, NOT > 1 — REMOVING THE LAST CHIP IS NOT THE SAME ACTION AS CLEARING. It was
            > 1 on the reasonable theory that with one chip its own ✕ does the same job. Since the
            merge it does not, because clearAllFilters drops axes that emit no chip of their own —
            the CATEGORY above all. With one chip applied inside an empty category the ✕ removed
            the chip and left the category standing, so > 1 hid the only control that could clear
            it. (Leaving the RESULTS view is not the difference: the un-latch layout effect does
            that for every route out of a filtered state.) The redundancy at exactly one chip is
            the cheap half of the trade. */}
        {chips.length > 0 && (
          <Button variant="bare" size="none" onClick={clearAllFilters} className="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold text-accent-foreground hover:bg-accent transition-colors cursor-pointer">
            {tr('Clear all', 'Xóa tất cả')}
          </Button>
        )}
      </>
    )
    if (compact) {
      // Desktop: one horizontal row — chips fill the left up to the sort dropdown, Save on the right.
      return (
        <div className={cn('flex items-center gap-2 rounded-2xl bg-brand-50 px-2.5 py-2', className)}>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{chipBtns}</div>
          {/* No save on the teachers category — `saveSearch` is null there (see its declaration). */}
          {saveSearch && (
            <Button onClick={saveSearch} variant="cta" size="none" className="shrink-0 gap-1.5 px-3.5 py-1.5 text-xs shadow-sm active:scale-[0.96] cursor-pointer">
              <Bookmark className="h-4 w-4" /> {tr('Save search', 'Lưu tìm kiếm')}
            </Button>
          )}
        </div>
      )
    }
    // Mobile: vertical — chips above a full-width save button.
    return (
      <div className={cn('space-y-2.5 rounded-2xl bg-brand-50 p-3', className)}>
        <div className="flex flex-wrap items-center gap-1.5">{chipBtns}</div>
        {saveSearch && (
          <Button variant="bare" size="none" onClick={saveSearch} className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-card py-2 text-sm font-bold text-accent-foreground shadow-sm transition-colors hover:bg-accent cursor-pointer">
            <Bookmark className="h-4 w-4" /> {tr('Save this search', 'Lưu tìm kiếm này')}
            <span className="text-2xs font-normal text-muted-foreground">{tr('— alerts on new matches', '— báo khi có tin mới')}</span>
          </Button>
        )}
      </div>
    )
  }

  // Empty state that diagnoses WHY there are no results and offers one-tap relaxation.
  // Rendered through the foundation EmptyState primitive (icon-language §6): the raw
  // oversized muted Inbox becomes the coin treatment — glyph on a brand-50 disc at the
  // display stroke — so zero results still looks like eno rather than a gray void.
  //
  // ⚠️ TWO EMPTY STATES, ONE FUNCTION, AND THE BRANCH IS `chips.length` — NOT isLandingMode.
  // The merged landing branch had its own zero-results block, and it said something different
  // and correct: with nothing applied there are no filters to relax, so "No listings match
  // these filters" is a lie and a "Clear all filters" button clears nothing. What is true then
  // is that the catalogue itself came back empty, and the only useful exits are an alert or a
  // Wanted post. Keyed on the CHIPS because the chips are the relaxable set — sort and the
  // verified default produce none, and an empty-string search commit leaves showExplorer true
  // with nothing to remove, which isLandingMode would have got wrong.
  // ⚠️ The landing block also carried a "Widen the area" button gated on nearby/ward/province/
  // district, and it was DEAD THERE BY CONSTRUCTION — every one of those axes produces a chip, so
  // the branch it lived in could never see one. It is reproduced in the FILTERED branch instead,
  // which is the only branch that can actually reach it.
  // ⚠️ SEAM FOR THE ZERO-RESULTS COMPONENT (stream D): this function is the single call site
  // for "the grid has nothing to show and the fetch did not fail" — see the results block. A
  // replacement needs both branches, because the marketplace-is-empty case is reachable on the
  // home page (thin catalogue, edition scoping) and reads as a broken site if it is skipped.
  const renderEmptyState = () => {
    const chips = getActiveChips()

    // ⚠️ INTENT-WARM, NOT VIEWPORT-PREFETCH — THIS ONE `<Link>` WAS 29% OF "REDUCE UNUSED JS".
    // Measured on prod 2026-08-23 (headless chromium, mobile emulation, 4x CPU throttle): the
    // zero-results CTA below lands at y=966 on an 823px viewport, i.e. INSIDE Next's viewport
    // prefetch margin, so the App Router RSC-prefetched /post and preloaded its six route chunks
    // for every visitor who saw an empty grid. The largest was 31,678 B transfer / 31,625 B of it
    // unused (100%) — 30.9 KiB, 29% of the Lighthouse "Reduce unused JavaScript" total. Proven by
    // counterfactual, not inference: viewport height 823 → 6/6 chunks fetched, height 300 → 0/6.
    // The fix is the intent-warm pattern already used in dashboard-listing-row.tsx: kill the
    // automatic prefetch and warm the route only once the visitor signals intent, so tapping is
    // still instant (pointerdown fires ~100ms before the click) but a visitor who never reaches
    // for it pays nothing. onMouseEnter covers desktop hover; onPointerDown covers touch, where
    // there is no hover to hover with.
    const warmPost = () => router.prefetch('/post')

    // ⚠️ `activeCategory === 'all'` IS NOT REDUNDANT WITH `chips.length === 0`, AND LEAVING IT
    // OUT WAS A REAL BUG (external reviewer). getActiveChips() covers the query, subcategory,
    // brand/model, district, area, price, condition, intent and the custom facets — but NOT the
    // CATEGORY, which is the one filter this component treats as navigation rather than as a
    // chip. So an empty category (tap a tile with no live listings) produced zero chips and was
    // told "No listings found", i.e. the whole marketplace is empty — with no way back except
    // the browser button. It now falls through to the filtered branch, whose "Or browse" row of
    // category chips is exactly the recovery that case needs.
    // ⚠️ THE OTHER HALF OF THAT GAP IS CLOSED IN clearAllFilters (it now resets the category too).
    // What remains open, deliberately, is that getActiveChips() still emits no chip for the
    // category: the chips row is also the SAVED-SEARCH receipt and the applied-filter bar, so
    // adding one there changes surfaces this wave does not own. The recovery path below covers
    // the case that matters.
    // ⚠️ `tone="bare"` ON BOTH BRANCHES, AND NO `bg-card/60` (E-ZERO, 2026-09-29): the dashed card on a
    // tinted fill predates the flat canon (docs/design-language.md §3b — lines, not boxes).
    if (chips.length === 0 && activeCategory === 'all') {
      return (
        <EmptyState
          tone="bare"
          title={
            <>
              <Mascot name="search" className="mx-auto mb-3 h-32 w-32" />
              <span className="block">{tr('No listings found.', 'Không có tin đăng nào.')}</span>
            </>
          }
          action={
            <div className="flex w-full max-w-xs flex-col items-stretch gap-2">
              {/* `activeCategory === 'all'` here, so it is always offered — `saveSearch &&` is the rule, not a special case. */}
              {saveSearch && (
                <Button
                  variant="outline"
                  size="none"
                  onClick={saveSearch}
                  className="rounded-xl px-4 py-2.5 text-sm font-semibold cursor-pointer"
                >
                  {tr('Create an alert for this search', 'Tạo thông báo cho tìm kiếm này')}
                </Button>
              )}
              <Button asChild variant="outline" size="none" className="rounded-xl px-4 py-2.5 text-sm font-semibold">
                <Link href="/post" prefetch={false} onPointerDown={warmPost} onMouseEnter={warmPost}>
                  {tr('Post a Wanted — let sellers come to you', 'Đăng tin cần tìm — để người bán tìm đến bạn')}
                </Link>
              </Button>
            </div>
          }
        />
      )
    }

    // ⛔ "NO LISTINGS MATCH THESE FILTERS" WAS FALSE WHEN THE ONLY THING APPLIED IS THE WORDS (S-RECALL,
    // 2026-09-29: /?q=iphnoe). A search is not a filter the reader thinks of as one; name the words.
    const term = debouncedQuery.trim()
    const onlyTheWords = term !== '' && chips.length === 1 && activeCategory === 'all'
    // Popular searches: other words people found things with. The current one is excluded — it just
    // found nothing — and so is anything that differs from it only in case or spacing.
    const popular = term ? zeroTrending.filter((t) => t.trim().toLowerCase() !== term.toLowerCase()).slice(0, 6) : []
    return (
      <EmptyState
        tone="bare"
        icon={Inbox}
        title={onlyTheWords
          ? <>{tr('No results for', 'Không có kết quả cho')} “{term}”</>
          : tr('No listings match these filters.', 'Không có tin nào khớp với bộ lọc này.')}
        action={
          <div className="flex flex-col items-center gap-4">
            {chips.length > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <span className="text-xs text-ink-4">{tr('Remove:', 'Bỏ bớt:')}</span>
                {chips.map((c, i) => (
                  <Button
                    key={i}
                    variant="bare"
                    size="none"
                    onClick={() => { commitView(); c.onClear() }}
                    className="inline-flex items-center gap-1 whitespace-normal rounded-xl px-3 py-1.5 text-xs font-semibold text-body hover:bg-muted transition-colors cursor-pointer"
                  >
                    {c.label}
                    <X className="h-3 w-3" />
                  </Button>
                ))}
              </div>
            )}

            {/* ⚠️ `|| activeCategory !== 'all'` ON THE CLEAR BUTTON, AND WITHOUT IT THIS SCREEN IS
                A TRAP. The category emits no chip (see getActiveChips), so tapping a tile with no
                live listings lands here with chips.length === 0 — which used to hide the Remove
                row AND the Clear CTA, while "Widen the area" is hidden too (every area axis emits
                a chip, so zero chips means none is set) and the "Or browse" chips only move to a
                DIFFERENT category. The visitor was left reading "No listings match these filters"
                with no filter on screen and no way back to the home view except the browser's
                Back button. External reviewer; it is the mirror image of the defect the branch
                above this one exists to fix. */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              {/* The most specific relaxation first: a too-narrow AREA is the commonest cause of a
                  zero-result set, and clearing it keeps every other filter the visitor chose.
                  Same four clears as the area chip in getActiveChips, one tap instead of hunting
                  for the chip's exit. 'outline', not 'cta' — "Clear all filters" beside it is already
                  the group's one brand CTA (design canon), and two would compete. */}
              {(nearby !== null || activeWard !== null || activeProvince !== null || activeDistrict !== 'all') && (
                <Button
                  variant="outline"
                  size="none"
                  onClick={() => { commitView(); setNearby(null); setActiveWard(null); setActiveProvince(null); setActiveDistrict('all') }}
                  className="rounded-xl px-4 py-2 text-xs font-semibold cursor-pointer"
                >
                  {tr('Widen the area', 'Mở rộng khu vực tìm kiếm')}
                </Button>
              )}
              {(chips.length > 0 || activeCategory !== 'all') && (
                <Button variant="cta" size="none"
                  onClick={() => { commitView(); clearAllFilters() }}
                  className="rounded-xl px-4 py-2 text-xs transition-colors cursor-pointer"
                >
                  {tr('Clear all filters', 'Xóa tất cả bộ lọc')}
                </Button>
              )}
              {/* The other two exits of the recovery trio (widening = the chip row above):
                  turn this search into an alert, or flip the intent and post a Wanted.
                  ⛔ No alert on the teachers category — none would ever be sent (`saveSearch` is null there). */}
              {saveSearch && (
                <Button variant="outline" size="none"
                  onClick={saveSearch}
                  className="rounded-xl px-4 py-2 text-xs font-semibold cursor-pointer"
                >
                  {tr('Create an alert for this search', 'Tạo thông báo cho tìm kiếm này')}
                </Button>
              )}
              <Button asChild variant="outline" size="none" className="rounded-xl px-4 py-2 text-xs font-semibold">
                <Link href="/post" prefetch={false} onPointerDown={warmPost} onMouseEnter={warmPost}>
                  {tr('Post a Wanted — let sellers come to you', 'Đăng tin cần tìm — để người bán tìm đến bạn')}
                </Link>
              </Button>
            </div>

            {/* ⛔ POPULAR SEARCHES (E-ZERO, 2026-09-29): a search that found nothing is best rescued by
                another search, so the words people are finding things with come before the category
                jump. Same chip as "Or browse" below; no uppercase eyebrow (the owner retired kicker
                eyebrows). Edition-scoped by the trending endpoint itself (src/lib/trending.ts). */}
            {popular.length > 0 && (
              <div className="flex flex-col items-center gap-2">
                <p className="text-xs text-ink-4">{tr('Popular searches', 'Tìm kiếm phổ biến')}</p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {popular.map((t) => (
                    <Button
                      key={t}
                      variant="bare"
                      size="none"
                      onClick={() => handleLandingSearch(t)}
                      className="inline-flex items-center rounded-full bg-tint px-3.5 py-1.5 text-xs font-semibold text-body transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer"
                    >
                      {t}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* A dead end orients nobody — offer a one-tap jump to popular categories. */}
            {categories.length > 0 && (
              <div className="flex flex-col items-center gap-2">
                <span className="text-xs text-ink-4">{tr('Or browse', 'Hoặc xem')}</span>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {categories.slice(0, 4).map((c) => (
                    <Button
                      key={c.slug}
                      variant="bare"
                      size="none"
                      onClick={() => handleCategorySelect(c.slug)}
                      className="inline-flex items-center rounded-full bg-tint px-3.5 py-1.5 text-xs font-semibold text-body transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer"
                    >
                      <Bilingual en={c.name} vi={c.nameVi || c.name} />
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        }
      />
    )
  }

  // List / Grid / Map view toggles — one source for the desktop sort row AND the
  // mobile results-count row (where the collapsed sort/view row's controls live).
  // Sort tabs + view toggles are presentational (see ./explorer-toolbar). pickSort keeps the
  // filter transition here since it owns setSort + the useTransition.
  const pickSort = (val: SortKey) => startFilterTransition(() => setSort(val))

  // ⚠️ ONE RETURN. There used to be two, and the boundary between them was the product bug this
  // component was rewritten to remove: `if (isLandingMode) return (…)` rendered the home page —
  // ad, value strip, category tiles, rails, a feed — and the second return rendered a DIFFERENT
  // page for anyone who searched or tapped a facet. A search therefore unmounted the whole
  // surface and mounted another one, which is what "users hop between pages" meant even though
  // home, browse and search have always been the same route.
  //
  // Now: the ladder (category row → facets → toolbar → sort) and the results are ALWAYS mounted;
  // `showDiscovery` only decides whether the undirected-browse chrome (the discovery shelves and
  // the "Browse everything" unlock) is also on screen. Typing filters the grid in place.
  // ⚠️ THE PROMO BANNER LEFT THAT LIST ON 2026-08-12 (for a `showBanner` predicate) and left the
  // PAGE on 2026-09-18 — nothing above the fold recomposes on a filter now. The note below is kept
  // because the reasoning about what may and may not unmount above the fold still applies to the
  // next thing that wants to live there.
  // ⚠️ NOT "on any tap" — an earlier draft of this line said that and codex was right to call it
  // false. Switching to the map or video view still removed the banner's whole height. That is a
  // takeover the visitor explicitly asked for, replacing the grid rather than re-laying it out, so
  // it is a view change and reads as one; a category chip is not.
  return (
    // overflow-x-CLIP (not hidden): hidden would make this section the sort strip's
    // scroll box and position:sticky would never pin; clip contains the horizontal
    // bleed without creating a scroll container.
    // ⚠️ THE OLD LANDING BRANCH USED `overflow-hidden` AND THAT IS NOW A TRAP: it could afford
    // to, because the sticky sort strip lived only in the other branch. The strip is on every
    // view now, so `overflow-hidden` here would silently un-stick it and nothing would fail.
    //
    // ⚠️ `pt-5 sm:pt-6` IS MEASURED, NOT CHOSEN. It used to set the gap above the promo banner and
    // now sets the gap above the CATEGORY GRID, which is the first thing on the page (2026-09-18).
    // It was tuned by measuring the built page, not by arithmetic on the
    // class names:
    //   desktop (1280px): 8.5px (header→<main>) + 16px (<main> pt-4) + 24px (pt-6) = 48.5px
    //                     against 48.0px measured from banner bottom to the hairline
    //   mobile   (390px): 8.5px + 16px + 20px (pt-5) = 44.5px, against 44.3px measured
    // ⚠️ The gap BELOW is NOT simply the space-y class — on mobile it measured 44.3px, not the
    // 32px space-y-8 suggests, because the banner's own section contributes the rest. If you
    // touch the spacing below, RE-MEASURE the real gap rather than recomputing from the classes.
    // ⚠️ `pt-3` ON MOBILE IS A MEASURED TRADE, NOT A TIDY-UP (review UI/UX 1, 2026-09-06). At
    // 390×844 the first card's image began at y=667 and its PRICE at y=856 — below the 772px
    // bottom nav, so the first screen of a marketplace showed no price and no title, only chrome.
    // The two safe levers are here and on the promo wrapper below. The dominant term is the
    // promo's own `aspect-[2.04]` (179px of the 667), and that is the owner's creative, not ours
    // to crop. RE-MEASURE after touching this, as the note above already says: the gap below is
    // not the space-y class.
    // ⛔ pt-0 / sm:pt-2 (was pt-3 / sm:pt-6) — HOME FOLD TRIM, owner 2026-09-30: "Home fold: mobile or
    // desktop try a little from both categ and filter". The category rail is the first thing under the
    // header now and its opening tiles carry their own slack above the glyph, so the 12/24px of section
    // padding read as a dead band (<main>'s pt-4 still spaces it from the header hairline). Measured
    // with the rail, facet-pill and gap trims (category-rail.tsx, facet-bar.tsx, `space-y-3` below):
    // first card top 517 → 447 at 360×740 and 390×844, 407 → 367 at 1440×900, CLS unchanged.
    // (home)/loading.tsx mirrored every one of these numbers until UX3 FAST-8 removed it. The notes above are the older layout's.
    // ⛔ A `{/* … */}` COMMENT CANNOT LIVE HERE — right after `return (` is expression position,
    // where JSX comment syntax is a syntax error (tsc TS1005). This is the second time in one
    // night; CLAUDE.md records the rule.
    <section ref={listingsRef} id="listings" className="scroll-mt-20 relative overflow-x-clip pc:overflow-visible pt-0 pb-5 sm:pt-2 sm:pb-8">
      {/* Width + edge gutter are owned by the parent page <main> (canonical
          max-w-7xl px-3 sm:px-6 lg:px-8) so the feed lines up with Header/Footer. */}
      <div className="relative w-full">
        {/* ⚠️ ZERO-HEIGHT WRAPPER — IT MUST NEVER CARRY SPACING, AND IT MUST NEVER BE THE FIRST
            CHILD OF A `space-y-*` CONTAINER. It holds nothing but an sr-only <h1>, and sr-only is
            position:absolute, so any margin/padding on this element is real height with no box to
            justify it. Three separate dead bands have been found here (`mb-5`, `pb-2`, and the
            `space-y-12` that collapsed straight through it and landed ABOVE the banner). It sits
            outside the stacks below for exactly that reason. */}
        <div className="relative text-center">
          {/* ⚠️ READ THE BLOCKS BELOW AS A CHRONOLOGICAL RECORD, OLDEST FIRST — THE LAST ONE IS
              THE ONLY ONE THAT DESCRIBES THE CODE. Six Google OAuth brand-review submissions are
              recorded here and each block was written while a different state was live, so the
              early ones say things ("THIS HEADING IS VISIBLE ON PURPOSE") that the CURRENT code
              deliberately contradicts: the owner removed every painted heading on 2026-08-02 and
              the <h1> is sr-only today. An external reviewer read the stack as a set of live
              claims and reported the sr-only h1 as a fresh bug; it is neither fresh nor a bug the
              code can fix — it is an owner decision, with the cost of reversing it written out
              below. The record is kept whole because each state's VERDICT is the evidence.

              ⚠️ THIS HEADING IS VISIBLE ON PURPOSE, AND IT MUST STAY THAT WAY.
              It was `sr-only` from 2026-07-16 (when the wordmark + tagline were stripped to
              leave just the search) until 2026-08-02, when GOOGLE REJECTED OAUTH BRAND
              VERIFICATION THREE TIMES over it — verbatim: "Your home page does not explain the
              purpose of your app", "The app name … does not match the app name on your home
              page", and "Your home page is behind a login page".

              None of that was a login problem: the page is public and server-renders its
              listings. The problem was that every description of the product lived in <meta>
              tags and a hidden <h1>, so a human reviewer saw the "eno" wordmark, a search box
              and a grid of products — no service name in text, no statement of what the site
              is for. Reviewers read the rendered page, not the head.

              So the hero states the name and the purpose in one compact block: two lines, above
              the search, at the smallest weight that still reads as the page's title. If it is
              ever hidden again, brand verification breaks and the consent screen keeps showing
              the raw Supabase project ref instead of the eno logo.

              ⚠️ NAME COMES FROM SITE_NAME, NOT A LITERAL. The old hardcoded string said
              "eno.vn" on BOTH editions, so eno.forum's own home page announced itself as the
              licensed marketplace. */}
          {/* ⚠️ THE HERO HAS NO VISIBLE HEADING ON EITHER EDITION (owner, 2026-08-02: "also
              remove this from eno.vn", after the same removal on eno.forum). The <h1> still
              carries the site name for crawlers and screen readers, but nothing is painted: what
              a visitor sees at the top of the page is the search bar.

              ⚠️ READ THIS BEFORE RESTORING ANYTHING HERE. This is the third time this block has
              been emptied, and the previous two both ended in a Google OAuth brand-verification
              rejection — "Your home page does not explain the purpose of your app" and "The app
              name … does not match the app name on your home page" — because a reviewer reads the
              RENDERED page, and `sr-only` is position:absolute with clip-path:inset(50%), so no
              visible-text extractor sees it. Measured 2026-08-02, before this removal: zero
              painted "eno.vn" text nodes in the first 800px, with JS on and with JS off; the
              first plain-text occurrence sat at y=3691 of a 4396px page, in the footer.

              What still names the page to a human: the header wordmark (an <img>, on every
              route). What names it to a machine: <title>, og:site_name, the JSON-LD Organization
              block, and the manifest — all of which now say exactly SITE_NAME.

              The verification failure being chased when this was removed turned out to be a
              DIFFERENT problem entirely (the live OAuth client lives in project eno-vn/
              671626883615 and is still named "eno", while the brand titled "eno.vn" sits in a
              second project that renders identically in the console picker). So emptying this
              block is not believed to be what fixes or breaks verification — but if the
              name-mismatch or purpose complaint returns after the project mix-up is sorted, a
              painted text heading here is the first thing to try, NOT another image. */}
          {/* ⚠️ VISIBLE, PAINTED TEXT — AND IT IS THE ONLY STATE OF THIS HEADING THAT GOOGLE HAS
              NEVER REJECTED. The history, because it has now cost six submissions:
                sr-only text        → "does not explain the purpose" + "name does not match"
                visible plain text  → the purpose complaint CLEARED
                wordmark <img>      → "name does not match" returned
                nothing at all      → "name does not match" again (2026-08-02)
              Measured on the live page in the last state: zero painted "eno.vn" text nodes in
              the top 800px with JS on AND off — the name existed only as an <img> in the header
              and as plain text at y=3691, in the footer. An automated checker reading rendered
              text finds nothing to match the console's "eno.vn" against.

              ⚠️ SO IT MUST STAY TEXT. Not an image, not sr-only, not a background. If the hero
              is restyled, the literal string SITE_NAME has to remain something a text extractor
              can see above the fold. One line carries both complaints at once — the name for the
              match, the trailing clause for "explain the purpose of your app" — which is why it
              is a single sentence rather than the heading-plus-paragraph the owner twice called
              "ugly ducklings". */}
          {/* ⚠️ THE NAME IS AN IMAGE AGAIN, AND THAT HAS A KNOWN COST (owner, 2026-08-02, after
              seeing the tagline: "and remove this"). The <h1> keeps SITE_NAME for crawlers and
              screen readers via sr-only; the only thing a sighted visitor gets is the wordmark.

              The record, because this block has now changed five times and each state was
              answered by Google:
                sr-only text only   → "does not explain the purpose" + "name does not match"
                visible plain text  → the purpose complaint CLEARED
                wordmark <img>      → "name does not match" returned
                nothing             → "name does not match"
                img + visible text  → shipped ~1h, no verdict received before this removal
              An `alt` attribute does not substitute: alt is never painted, and /logo-dotvn.svg is
              a single <path> with 0 <text>, so a text extractor finds no glyph anywhere. (It was
              3 paths until the wordmark was re-set in Open Runde Bold on 2026-08-13; converted
              font outlines are still outlines, so the point stands unchanged.)

              So if brand review answers "the app name … does not match the app name on your home
              page" again, THIS is the cause, and the fix is a painted text node containing
              SITE_NAME above the fold — not another image, not alt text, not sr-only.

              Marketplace-only: /logo-dotvn.svg spells the LICENSED company's name and must never
              render on eno.forum. */}
          {/* ⚠️ THE HERO WORDMARK IS GONE (owner, 2026-08-03) — the brand now lives at the top of
              the left rail and in the header, so repeating it here was a third copy above the
              fold. The <h1> keeps SITE_NAME as sr-only text for crawlers and screen readers.
              ⚠️ Google's brand review has rejected this app for "the app name does not match the
              app name on your home page" whenever the name was NOT painted text above the fold;
              the header wordmark is what answers that now. If that complaint returns, restore a
              PAINTED TEXT name here — not an image, and not sr-only.
              ⚠️ NO LAYOUT CLASSES. This carried `mb-5 flex justify-center` while the wordmark was
              inside it; with only an sr-only child left, the element has zero height but the
              margin does not — a 20px dead band right where the owner asked the feed to start
              with the categories scroller. sr-only content must not carry spacing. */}
          {/* ⚠️ THIS IS THE PAGE'S ONLY <h1>, AND THAT IS NEW (2026-08-11). The results branch
              used to carry a second sr-only <h1> ("Marketplace listings") because it was a
              separate tree that never coexisted with this one. One tree means one h1, and it has
              to be the SITE_NAME one — the whole Google brand-review record above hangs on it.
              Outline stays sequential: h1 (site name) → h2 (results section) → h3 (cards).
              ⚠️ ON THE HOME PAGE THIS ONE IS OFF (`siteHeading={false}`, SEO wave B, H1c): the same
              sr-only SITE_NAME heading renders in `(home)/layout.tsx`, above the loading boundary,
              because inside it React outlines the page into `<div hidden id="S:0">` and crawlers read
              the H1 as hidden. It is OFF on a storefront too (the default follows `sellerId`,
              ST-HEADER): there the shop's name in its SellerCard is the H1.
              Text and sr-only are unchanged, so the brand-review record above still holds. */}
          {siteHeading && <h1 className="sr-only">{SITE_NAME}</h1>}
          {/* ⚠️ THE PURPOSE SENTENCE THAT SAT HERE IS GONE (owner, 2026-08-02) — and it was not
              decoration, so anyone restoring copy to this hero should know what it was doing.
              Google's OAuth brand review rejected this page with "Your home page does not explain
              the purpose of your app", and that complaint cleared only once a visible purpose
              statement existed. The owner removed the visible sentence; the page still states its
              purpose in <title>, meta description and og:description (all "…marketplace for
              expats and internationals in Vietnam…"), which is what remains answering that
              complaint. If brand review raises "does not explain the purpose" again, THIS is the
              cause and a one-line visible tagline under the wordmark is the fix. */}
          {/* ⚠️ DO NOT re-add an element with id="eno-hero-search". The header's reveal effect
              does `const el = document.getElementById('eno-hero-search'); if (!el) setShowSearch(true)`,
              so that id's mere presence flips the header's own search bar back to
              hidden-until-scrolled — and the header bar is now the ONLY search input on the page
              (owner, 2026-08-03: "move main searchbar to top navbar so feed starts with
              categories scroller"). */}
        </div>

        {/* ⛔ NO PROMO BANNER ON THE HOME FEED (owner, 2026-09-18, applying 58's playbook:
            "remove banners on desktop … categories" and, asked about mobile, "Remove on both").
            The categories are now the first thing under the header on every screen, as they are on
            58: their home page opens straight into the icon grid and carries its campaign slots
            inside it. <PromoBanner> and its slides are still in the tree (src/lib/promo-slides.ts)
            for a future slot; nothing renders them today, which also takes the banner artwork off
            the first-screen byte budget. */}

        {/* ── THE LADDER + THE RESULTS ─────────────────────────────────────────────────────
            Always mounted, in this order: category row → brand row → facets → toolbar → sort →
            results. Nothing here unmounts when a filter is applied; the pieces that are specific
            to undirected browse swap IN PLACE (the big tile grid becomes the compact
            <CategoryRail>) so a search never tears the page down and rebuilds it.
            ⚠️ `lg:space-y-8` on the block ABOVE tightens desktop back to the mobile rhythm on
            purpose. Measured 2026-08-09 at 1440×900: the first product sat at y=983 on a 900px
            viewport, i.e. a MARKETPLACE whose first screen contained zero merchandise. This is a
            dense feed in the Shopee/Lazada family, where the reference sits nearer 24–32px, and
            the air was buying nothing except distance from the listings.
            ⚠️ NO ENTRANCE ANIMATION ON THIS WORKSPACE, DELIBERATELY, AND THE RECORD MOVED HERE
            WITH IT. The results tree used to carry
            `animate-in fade-in slide-in-from-bottom-3 duration-300` around the ENTIRE workspace —
            category rail, brand rail, facets, toolbar and grid. That is page-load choreography on
            an Operate surface: every visitor waited 300ms and watched the whole view translate
            12px before they could act. It was also the middle of THREE stacked opacity-0
            entrances on one home navigation (.route-fade 150ms → this 300ms → the grid's own
            200ms), i.e. the "one identical entrance on every section" pattern, twice, on the
            money path. The feed should simply be there — and now that this tree is also the
            LANDING tree, an entrance here would fire on every cold home load. */}
        {/* ⚠️ space-y-3, NOT 4 (home fold trim, 2026-09-30): 4px back between each rung — rail, recents,
            strip, results header — at every width. (home)/loading.tsx mirrored this rhythm until UX3 FAST-8. */}
        <div className="space-y-3">

          {/* CATEGORY LADDER — ONE SLOT, TWO REPRESENTATIONS.
              Undirected: the FINN-style two-row tile grid (big tiles, eno's own two products
              pinned first, Free/Wanted intent tiles at the tail) — the cold-start affordance.
              Directed: <CategoryRail>, the compact strip that can show WHICH category is active
              and roll its subcategories out beside it, which a tile grid cannot.
              ⚠️ They are alternatives, never both: two category ladders on one screen is the
              duplication the merge exists to remove. The swap costs ~150px of height and happens
              on a tap, so it is a user-initiated reflow, not layout shift. */}
          {/* ⚠️ ONE REPRESENTATION, ALWAYS — the two-row tile grid is GONE (owner, 2026-08-12,
              with a layout mock: "look at the homepage layout this what i was asking about").
              The grid could only ever show fifteen closed doors; this rail shows the same doors
              on ONE line and rolls the ACTIVE category's subcategories out beside it, which is
              the whole ladder (category → subcategory → brand → model) in the space the grid
              used for its first row.

              ⚠️ THE PINNED eno TILES SURVIVED THE SWAP, WHICH IS THE PART THAT WAS EASY TO LOSE.
              The grid's own comment warned that replacing it with this rail "would have deleted
              the bet silently" — two of roughly six above-the-fold slots belong to eno's own
              products after a measurement showing /vietnam-evisa took ZERO page views in a week.
              CategoryRail grew a `shortcuts` slot for exactly that, and they keep their position
              ahead of the demand order rather than being appended at the tail.

              ⚠️ NOTHING UNMOUNTS ON A FILTER ANY MORE. The old pair swapped one ladder for
              another on the first tap — a user-initiated reflow of ~150px that this removes
              outright, because there is now only one component to render in either state. */}
          {/* ⛔ …EXCEPT ON A PHONE ONCE THE FEED IS DIRECTED: then the ladder folds into ONE compact
              row with the full rails one tap behind it (see `collapseLadder`). Undirected, and on
              desktop, LadderSlot is a fragment and the rails below render exactly as they did. */}
          <LadderSlot
            collapsed={collapseLadder}
            open={ladderOpen}
            onOpenChange={setLadderOpen}
            row={
              <LadderCompactRow
                categories={categories}
                activeCategory={activeCategory}
                activeSubcategory={activeSubcategory}
                onCategory={handleCategorySelect}
                onSubcategory={setActiveSubcategory}
                intents={sellerId ? undefined : INTENT_SHORTCUTS}
                activeType={listingType}
                onIntent={(type) => { commitView(); setListingType(listingType === type ? 'all' : type) }}
                expanded={ladderOpen}
                // The same counts the full rail reads, so the phone row offers the same chips (E-TILES).
                facets={facetCounts}
                subcategoryCounts={subcategoryCounts}
                teacherProfile={hasTeacherProfile}
              />
            }
          >
          <CategoryRail
            categories={categories}
            teacherProfile={hasTeacherProfile}
            activeCategory={activeCategory}
            activeSubcategory={activeSubcategory}
            subcategoryCounts={subcategoryCounts}
            facets={facetCounts}
            /* ⚠️ `queryFetching`, not `queryLoading`: the jump happens on a REFETCH — tap a
               category and the held payload is still last second's, so every chip in the new row
               has no number yet. `isLoading` is only true on the very first fetch and would leave
               exactly the case the owner reported unfixed. */
            countsPending={queryFetching}
            onCategory={handleCategorySelect}
            onSubcategory={setActiveSubcategory}
            /**
             * ⛔ NEITHER SHORTCUT GROUP BELONGS ON A SHOP'S STOREFRONT. Owner, 2026-08-30, with a
             * screenshot of `gmbr.eno.vn` — one listing, five chips: *"3 seperate categories still
             * show ... only categories subcategories brands models that are present"*.
             * `DESK_SHORTCUTS` is eno's OWN merchandising (its services tile, pinned ahead of the
             * demand order) and `INTENT_SHORTCUTS` are marketplace-wide listingType filters — Free
             * & Giveaways, Wanted, Wholesale. Both are eno navigating its own catalogue, so on a
             * shop's page they advertise filters that shop cannot fill: every one of those chips
             * led to an empty feed, which is the same rail-vs-feed disagreement the category rail
             * had. A storefront shows what the shop HAS.
             */
            shortcuts={sellerId ? undefined : DESK_SHORTCUTS}
            onShortcut={(sc) => { if (sc.kind === 'filter') applyUrl(sc.href); else router.push(sc.href) }}
            // Free / Wanted shortcuts — the intent tiles, at the tail.
            intents={sellerId ? undefined : INTENT_SHORTCUTS}
            activeType={listingType}
            onIntent={(type) => { commitView(); setListingType(listingType === type ? 'all' : type) }}
            // Tiles are links (E-TILES): new-tab and crawlable, filtering in place on a plain click.
            hrefFor={tileHref}
          />

          {/* Brand rail — brands present in this category + subcategory (logo +
              name), tap to filter + expand the brand's models. Brand categories — and
              ALL (owner 2026-07-23: "when all selected show all brands available"):
              /api/brands treats category=all as the most-listed-overall directory.
              ⚠️ `!showDiscovery` GUARDS THE HOME COLD PATH. This rail fetches /api/brands on
              mount and it accepts category=all, so without the guard every anonymous home load
              — the most-served request on the site — would fire a brand-directory query before
              the visitor has expressed any interest in a brand. It appears the moment they do.
              ⛔ …BUT NOT OVER A FREE-TEXT SEARCH ON "ALL" (E-RESULTS, 2026-09-29). There the rail is
              the most-listed-overall directory — /api/brands does not read `q`, and outside a brand
              category the feed sends no brand facet to narrow it — so /?q=honda showed Apple,
              Samsung, Xiaomi… (no Honda) and pushed the first result from y≈407 to y=519 at 1440×900.
              A brand category, a brand pick and undirected browse are unchanged.
              ⚠️ BOTH HALVES OF THE WORDS, like the un-latch: `debouncedQuery` alone trails a URL's
              words by 150ms, so a cold /?q= load drew the directory for that window and then pulled
              it — a 112px drop-and-return of every result under it (measured, CLS +0.11 at 390). */}
          {!showDiscovery && (activeCategory === 'all' || categoryHasBrand(activeCategory))
            && !(activeCategory === 'all' && activeBrand === 'all' && (query.trim() !== '' || debouncedQuery.trim() !== '')) && (
            <BrandRail
              category={activeCategory}
              subcategory={activeSubcategory}
              activeBrand={activeBrand}
              activeModel={activeModel}
              activeLine={activeLine}
              facets={facetCounts}
              sellerId={sellerId}
              // ⚠️ A NEW BRAND DROPS THE OLD BRAND'S LINE. Without this the previous `?line=`
              // stayed applied under a brand that has no such line — the cascade's own stale
              // guard would clear it a render later, but the feed would flash the empty result.
              onPickBrand={(b) => { setActiveBrand(b); setActiveLine('') }}
              onPickModel={setActiveModel}
              onPickLine={handlePickLine}
            />
          )}
          </LadderSlot>

          {/* ⛔ THE RETURNING VISITOR'S RECENT SEARCHES (E-RETURNING option 1, owner O-16, 2026-09-30).
              One 44px row, undirected home only, and only for someone who has searched before — a
              first visit renders the slot and shows NOTHING (globals.css keeps `.recents-row` at
              display:none unless `html[data-has-recents]`).
              ⚠️ THE ROW IS HELD OPEN BEFORE IT HAS CONTENT, ON PURPOSE. The list is in localStorage,
              so the server cannot know it; the home layout's pre-paint script (PREPAINT_SCRIPT,
              explorer-url.ts) sets the attribute from the same list before the first paint, the
              44px are there from the first frame, and the chips land inside them after hydration —
              no shift of the toolbar or the feed. The effect beside `recentTerms` keeps the
              attribute in step afterwards (a first search in this session, a client-side mount).
              ⚠️ Chips run the search through `handleLandingSearch`, the same path as the header's
              box, so a tap is a search — never a navigation. */}
          {showRecentsRow && (
            <div
              data-recent-searches=""
              role="group"
              aria-label={tr('Recent searches', 'Tìm kiếm gần đây')}
              className="recents-row h-11 items-center gap-2 overflow-x-auto overscroll-x-contain scrollbar-none"
            >
              <Clock className="h-4 w-4 shrink-0 text-ink-4" aria-hidden />
              {recentTerms.map((term) => (
                <Chip key={term} size="sm" tone="neutral" onClick={() => handleLandingSearch(term)} className="relative tap-44 max-w-[14rem]">
                  <span className="truncate">{term}</span>
                </Chip>
              ))}
            </div>
          )}

          {/* Category-aware facet bar (replaces the old sidebar). Now on the HOME view too —
              area, price, condition and intent are what "home is also a search page" means in
              practice, and they were previously unreachable without first leaving the landing.
              ⚠️ min-h-12 IS A RESERVATION, NOT DECORATION. <FacetBar> is a `ssr:false` dynamic
              (see the import), so it is absent from the ISR HTML and mounts after hydration —
              directly ABOVE the feed. Without a reserved row the whole grid would be pushed down
              on every cold load, which is precisely the CLS class this page paid 0.142 → 0.002 to
              get rid of. 44px (48 until 2026-09-30) is the bar's own single-row height, not a guess: every
              pill is a <CustomSelect> whose trigger carries facet-bar's `min-h-11` `cls`, and the bar is
              one `flex items-center` row (flex-nowrap + overflow-x-auto on mobile, so it can
              never wrap there). It can wrap to a second row on a narrow DESKTOP window, which
              costs one late row of shift; re-measure here if that becomes visible. */}

          {/* Save-search box — the applied-filter chips plus "Save search". Desktop gets the
              compact one-line version, mobile the stacked one; both return NULL when nothing is
              applied, so on the undirected home view this costs zero height.
              ⚠️ THE DESKTOP VIEW TOGGLES USED TO HAVE THEIR OWN ROW HERE, and it is gone on
              purpose (2026-08-11). That row was `hidden lg:flex` with the save box on the left
              and the toggles pinned right — fine when this tree only ever rendered for someone
              who had already searched, but it is now on the HOME page, where the save box is
              always null and the row was 56px of empty space (a 40px toggle row plus the stack
              gap) sitting between the ad and the first listing. The toggles moved to the results
              header row below, which already carried them on mobile and had spare width on the
              right at every size. One row, one place, ~56px of fold recovered on desktop. */}
          {/* ⛔ THE SAVE BOX IS GONE — ITS CONTENTS MOVED INTO THE ONE INFO LINE BELOW (owner,
              2026-08-12, from the wireframe). The applied-filter chips, the result count, the
              ladder breadcrumb and "Save search" were three separate rows stacked above the feed;
              they are now a single line under a hairline, with Save search and the four view modes
              sharing its right edge. Rendering `renderSaveBox` here as well would print every chip
              twice. The function itself is retained for the mobile-drawer caller. */}

          {/* One-row sort strip — sticks under the header while the results scroll. */}
          {/* ⛔ ONE LINE: FILTERS LEFT, SORT RIGHT (owner, 2026-08-12: "clean 2 lines fit all").
              The facet bar is passed INTO the sort strip rather than rendered above it, because
              the strip is the sticky bar and its top offsets carry the safe-area / Capacitor /
              edge-bleed behaviour — see the `leading` prop's note. `min-h-12` rides along: the
              FacetBar is a ssr:false dynamic, so without a reserved row the grid below shifts on
              every cold load, which is the CLS class this page paid 0.142 → 0.002 to remove.
              ⛔ LOCAL TRY, 2026-09-30 — THE OWNER ASKED TO TRY ONE ROW ON PHONES, reversing "clean 2 lines
              fit all" below sm (kept above as the history): the filter pills and the sort no longer take two
              rows there. SortStrip draws ONE horizontally scrolling line — a compact sort pill first (the
              current order, opening the five choices), the facet pills, then Good price; the tab row is
              desktop-only. sm and up are unchanged. Measured (next dev, headless, cold): first card top
              447 → 406 at 360×740 and 390×844, en and vi; 367 unchanged at 1440×900.
              FacetBarFallback mirrors the one-row phone geometry ((home)/loading.tsx did too until UX3 FAST-8). */}
          <SortStrip
            sort={sort}
            onPickSort={pickSort}
            priceLabel={activeCategory === 'jobs' ? 'salary' : 'price'}
            goodPrice={goodPriceOnly}
            onGoodPrice={(on) => startFilterTransition(() => setGoodPriceOnly(on))}
            // Drawn only while it would narrow the feed (facets.deal — the same rule as every rail).
            goodPriceOffered={offeredKeys(facetCounts.deal, ['good'], null, { hideNoOp: true }).length > 0}
            headerHidden={headerHidden}
            leading={
              <div className="min-h-11">
                <FacetBar
                  openFilterSignal={openFilterSignal}
                  facetCounts={facetCounts}
                  activeCategory={activeCategory}
                  activeSubcategory={activeSubcategory}
                  province={activeProvince}
                  setProvince={setActiveProvince}
                  ward={activeWard}
                  setWard={setActiveWard}
                  nearby={nearby}
                  setNearby={setNearby}
                  /* ⛔ THE DISTRICT THE FEED IS IN, NOT ONLY THE ONE PICKED HERE (mobile audit,
                     2026-09-24): "Quận 7" typed into search gave 2,655 listings and a "District 7"
                     chip while this pill still read "Area" and the panel had nothing selected — two
                     controls disagreeing about what is applied. When no district is picked, the one
                     the server read out of the words is the applied one, so the pill names it and the
                     panel shows it selected. Tapping it there again drops it the way the chip's ✕ does
                     (area-filter.tsx re-emits 'all' for the picked chip): pickDistrictFromArea('all')
                     strips the typed district from the box (queryAfterAreaPick), leaving any other
                     words. Same answer the chips read (`serverInferredDistrict`), so the pill, the
                     chips and the clear path can never disagree. */
                  district={activeDistrict !== 'all' ? activeDistrict : (serverInferredDistrict ?? 'all')}
                  setDistrict={pickDistrictFromArea}
                  priceRange={priceRange}
                  setPriceRange={setPriceRange}
                  conditionFilter={conditionFilter}
                  setConditionFilter={setConditionFilter}
                  listingType={listingType}
                  setListingType={setListingType}
                  customFilters={customFilters}
                  setCustomFilters={setCustomFilters}
                  histogramQuery={histogramQuery}
                  histogramApproximate={!!nearby || debouncedQuery.trim().length > 0}
                  // The phone Filter sheet's "Show {n} results" — the same deferred figure as the
                  // result line, so the button and the count behind the sheet never disagree. Not the
                  // masked seed's (E-SSR): the sheet is not under the mask, so it says no number yet.
                  resultCount={seedMasked ? null : resultLineCount}
                  onPanelOpenChange={onFacetPanelOpenChange}
                  // An area applied from its panel is a committed change (NAV-1); on a phone it lands on the
                  // sheet's own history entry, from sm up it pushes one.
                  onCommit={commitView}
                />
              </div>
            }
          />
          {/* ⚠️ The reservation above is `min-h-11` since 2026-09-30: the facet pills went 48 → 44 (the
              44px floor) as the "filter" half of the home-fold trim. It must equal the pills' height. */}

          {/* THE RESULTS HEADER — one row that serves both states, which is the point.
              Undirected it is the feed's section heading, styled like every other home section
              (SECTION_* from shelf.tsx, wow pass 2026-08-06 — the grid used to be the one
              section on the page with no name). Directed it collapses to the result count, which
              is what a search view owes the visitor. The count is the aria-live region in BOTH
              states: it is the thing that changes, and a heading whose text changes announces
              badly. The view toggles live on this row at every breakpoint — the desktop-only
              toolbar row that used to hold them was 56px of empty space on the home page.
              ⚠️ SEAM FOR THE COUNTS API (stream A): the number rendered here is `totalCount`, the
              `total` field of the /api/listings response, or `shownListings.length` when "near
              you" is on (that path distance-filters client-side, so the server total is wrong by
              construction). A per-facet counts endpoint plugs in HERE and nowhere else. */}
          {/* ⚠️ ON A PHONE THE META LINE DROPS TO ITS OWN ROW, DIRECTLY ABOVE THE GRID (owner,
              2026-08-12: "move this line below right above products but thinner"). Measured at
              390px before this: the row held the count, ONE truncated chip, Save search and four
              view toggles in 366px, and the breadcrumb — the thing that says where you are — was
              scrolled out of sight entirely. Splitting gives it the full width and puts it where a
              caption belongs, touching the merchandise it describes.
              ⚠️ ORDER CLASSES, NOT A SECOND <ResultLine>. It owns an `aria-live` region and a
              focus-restore target, so rendering a phone copy beside a desktop one would announce
              every count twice and give the chip ✕ two possible destinations. One node, moved.
              ⚠️ KNOWN, AND STATED RATHER THAN GLOSSED: `order` MOVES THE PAINT, NOT THE DOM, so
              under sm the tab order is path → chips → controls while the eye sees chips →
              controls → path (codex). It cannot be made to agree here: the chrome is a SIBLING
              between the two halves visually, and the halves are adjacent children of one
              component, so no DOM arrangement produces both. The displaced element is the count
              (a non-focusable <p>) plus the breadcrumb rungs, and both readings — "where you are,
              then what you filtered" and "what you filtered, then where you are" — are coherent,
              so this is a deviation rather than a trap. Closing it properly means splitting the
              line into two exported slots the caller places itself.
              ⚠️ UNCONDITIONAL ON A PHONE — IT IS NOT WORTH MAKING CONDITIONAL, AND THE FIRST DRAFT
              PROVED IT. That draft split the line out only when it had crumbs or chips, to spare
              the home feed ~22px on the surface whose measured problem is that the first screen
              holds no merchandise. Measuring the other branch killed it: on the mobile HOME view
              the line shares the row with a 146px section title and 172px of view toggles, which
              leaves it 32px to print a 62px string — "33 listings" was CLIPPED, and had been
              before this change too, invisibly, because the half is an `overflow-x-auto` scroller
              and a scroller does not look broken, it just shows less. A legible count is worth
              22px, and one rule that always holds is worth more than two that each hold sometimes. */}
          {/* ⛔ "SHOWING RESULTS FOR iphone · SEARCH INSTEAD FOR “iphnoe”" (S-RECALL, 2026-09-29). The
              server answered a zero-result search for its likely spelling (see `literalFor`), and
              another word's results are honest only with this line above them — the header box
              still holds what was typed. The button asks the typed words literally (0 results, and
              the empty state names them).
              ⚠️ `role="status"`: the count's own live region announces only the number, so without
              this a screen-reader user would hear "3,439 listings" for "iphnoe" and never learn the
              words were changed.
              ⛔ THE REGION IS ALWAYS MOUNTED; ONLY THE SENTENCE COMES AND GOES (review, 2026-09-29). A
              live region announces CHANGES to itself — one inserted already holding its text is
              silent on several screen-reader/browser pairs, which is what the first draft did. Empty,
              the wrapper is a zero-height block in this `space-y-4` column, so its margins collapse
              into its neighbours' and it adds no gap (measured: the results header does not move).
              ⚠️ The link colour is `accent-foreground`, not `ui/button`'s `link` variant: that one is
              `text-primary`, which stays #0a66c2 in dark mode (a button FILL colour) and fails AA as
              text on the dark canvas. Underlined at rest because colour alone must not carry "this is
              a control" inside a sentence (WCAG 1.4.1); `tap-44` + `relative` give the inline control a
              44px hit area without changing the line (see globals.css). */}
          <div role="status" data-slot="spell-correction">
            {correctedQuery && !failedWithoutAnswer && (
              <p className="text-sm text-body">
                {tr('Showing results for', 'Đang hiển thị kết quả cho')}{' '}
                <strong className="font-semibold text-foreground">{correctedQuery}</strong>.{' '}
                <Button
                  type="button"
                  variant="bare"
                  size="none"
                  onClick={() => setLiteralFor(spellTerm)}
                  className="tap-44 relative inline-block whitespace-normal text-left align-baseline text-sm font-semibold text-accent-foreground underline decoration-1 underline-offset-4 hover:decoration-2"
                >
                  {tr('Search instead for', 'Tìm chính xác')} “{spellTerm}”
                </Button>
              </p>
            )}
          </div>
          {/* `id="results"` + `tabIndex={-1}`: the target of "Skip to listings" (skip-link.tsx, D-KEYBOARD).
              NOT `#listings` — that section opens with the category rail and the toolbar, the ~30 Tab
              stops the skip exists to pass; from here the next stops are this row's own controls and
              then the first card. `scroll-mt-*` lands it below the sticky header + toolbar. */}
          {/* ⛔ ON THE UNDIRECTED HOME THE COUNT SITS ON THE HEADING ROW AGAIN, UNDER THE TITLE (E-FOLD
              option C, owner O-10, 2026-09-30). The phone split above gave the count a whole 22px row
              of its own to keep it from being clipped beside a 132px title and 172px of view toggles
              (46px left for a 91px string, measured at 390). It is not squeezed back in beside them:
              under `sm` this row becomes a two-column GRID — the title and, beneath it, the count in
              the left column, the view toggles centred in the right column across both — so the row
              is the title's 28px + the count's 16px, 44px, against 62px for the two rows (measured:
              the first card 535 → 517 at 390×844). The count keeps its full width and its whole
              string; nothing truncates.
              ⚠️ ONLY WHILE `showDiscovery`: the home has no chips and no crumbs, so the dissolved
              ResultLine contributes exactly one grid item (the count half) and auto-placement drops
              it into the one free cell, under the title. A directed feed keeps the flex split above
              unchanged — its chips half needs the wrapping line.
              ⛔ THE GRID LIVES IN globals.css (`#results[data-home-row]`), NOT IN max-sm: CLASSES, AND
              THAT IS A MEASURED FIX. The ISR HTML is always the undirected home, so a cold /?q= deep
              link painted the 44px grid row, then hydration flipped `showDiscovery` off and the row
              grew to 62px — an 18px shift of the whole grid (CLS 0.018 at 390×844, 2026-09-30). The
              CSS rule is also gated on `html:not([data-explorer-directed])`, the pre-paint mask
              (E-SSR), so a directed URL paints the flex row from its first frame and never moves. */}
          <div id="results" tabIndex={-1} data-home-row={showDiscovery ? '' : undefined} className={cn(SECTION_HEADER_ROW, 'scroll-mt-40 select-none max-sm:flex-wrap max-sm:gap-y-1.5 sm:scroll-mt-32')}>
            {/* ⚠️ THE HEADING NO LONGER WRAPS <ResultLine>, WHICH IS WHAT LETS IT MOVE. They were
                nested — heading and line inside one `flex-1` box — and a nested child cannot
                reorder past its parent's SIBLING, so the line could never get below the toggles.
                They are siblings now, ordered explicitly.
                ⚠️ THE `flex-1` MOVED WITH IT, TO <ResultLine>, AND IT IS STILL THE THING THAT
                MAKES THE HALVES MEAN ANYTHING. Without it the line is content-sized — measured at
                203px on a 1440px viewport — so its two `basis-1/2` halves split 203px and the row
                shows a cramped left cluster with ~900px of dead space before "Save search". This
                box now takes its content width instead: the order-named heading ("Recommended",
                "Latest listings", …) on the undirected feed, and zero on a directed one where the
                heading is sr-only. */}
            {/* `data-feed-heading`: masked with the seed on a cold deep link (E-SSR, globals.css) — the
                ISR copy says "Recommended" over a feed the URL has directed elsewhere. */}
            <div data-feed-heading="" className="order-1 flex min-w-0 shrink-0 items-center gap-2">
              {showDiscovery ? (
                <>
                  {sort === 'recent' && <Clock className="h-4 w-4 shrink-0 text-accent-foreground" aria-hidden />}
                  <h2 className={SECTION_TITLE}>{homeFeedHeading}</h2>
                </>
              ) : (
                /* ⚠️ THE HEADING GOES SR-ONLY RATHER THAN AWAY. The results need A heading for the
                   outline to stay sequential (h1 site name → h2 here → h3 cards), but a big painted
                   heading over a result set the visitor defined themselves is noise, and beside the
                   count it says the same thing twice.
                   ⛔ IT NAMES THE RESULTS (E-TITLE, 2026-09-29): "Results for “honda”" (the words the
                   grid answers — the corrected spelling when the server corrected them), else the
                   deepest ladder rung ("Rentals"), else the old generic "Marketplace listings". A
                   heading list that reads "Marketplace listings" on every search tells a screen-reader
                   user nothing about where they are. */
                <h2 className="sr-only">
                  {resultsTerm
                    ? tr('Results for {q}', 'Kết quả cho {q}').replace('{q}', `“${resultsTerm}”`)
                    : ladderCrumbs[ladderCrumbs.length - 1]?.label ?? tr('Marketplace listings', 'Tin đăng')}
                </h2>
              )}
            </div>

            {/* ⛔ THE COUNT MOVED INTO <ResultLine> — DO NOT PUT A SECOND ONE BACK HERE.
                  A local aria-live <p> used to print it, and mounting ResultLine beside it printed
                  the figure TWICE on one line ("Found 0 listings  0 listings") — caught on the
                  rendered page, not in review. ResultLine's own count is the better of the two: it
                  is `polite`, it carries a tabIndex={-1} focus target so removing the last chip
                  lands the reader somewhere real, and it is the layout the wireframe asks for
                  (count, then the ladder path, then the chips).
                  ⚠️ Two live regions announcing the same number is worse than none — they
                  interleave, and a reader cannot tell which is authoritative. */}
              {/* ⛔ THE LADDER PATH AND THE APPLIED CHIPS LIVE ON THIS LINE (owner, 2026-08-12).
                  They were two rows above the feed; the wireframe puts count → breadcrumb → chips
                  on ONE line, with Save search and the view modes sharing its right edge.
                  <ResultLine> was built for exactly this in wave 1 and shipped unmounted; this is
                  the mount. It renders NOTHING of its own count — `count={-1}` would be a lie and
                  the live region above already owns the number and its announcement, so the line
                  is handed only the crumbs and the chips. Two elements announcing the same figure
                  is how a live region becomes noise. */}
            <ResultLine
              // See `resultLineCount`: null while there is no answer to state (a failed page 1, a cold
              // deep link still on the seed, a skeleton-first client mount), else the deferred count.
              count={resultLineCount}
              crumbs={ladderCrumbs}
              filters={resultFilters}
              appliedCount={appliedChips.length}
              onClearAll={appliedChips.length > 1 ? () => { commitView(); clearAllFilters() } : undefined}
              // The results header on a search (E-RESULTS, O-13): "N results for “q”". Not on the
              // undirected home, where there are no words to answer, and not while the grid still holds
              // the PREVIOUS words' rows (placeholderData): their count beside the new words would be a
              // number that answers a different question — the plain "N listings" stands until it lands.
              term={showDiscovery || queryShowingStaleSet ? undefined : resultsTerm}
              // Turns on the two-row phone layout; `max-sm:contents` below is what lets the halves
              // reach past this row's other children. Both are needed — see the prop's own note.
              splitOnMobile
              // ⚠️ `flex-1` IS WHAT LETS THE TWO HALVES DIVIDE ANYTHING — see the note on the
              // heading box above.
              // ⚠️ `max-sm:contents` DISSOLVES THIS BOX ON A PHONE, DELIBERATELY, and it is the
              // whole mechanism behind the two-row phone layout (owner, 2026-08-12: "put the chips
              // to the empty space to the left of save search on mobile"). The halves have to land
              // on DIFFERENT rows — chips beside Save search, count and path against the grid —
              // and a nested child cannot order past its parent's siblings. `display: contents`
              // removes this wrapper from the box tree so both halves become flex items of the row
              // itself, where their own `max-sm:order-*` (see result-line.tsx) can place them.
              // It stays a real flex box at sm+, where one row is the right answer.
              className="order-2 min-w-0 flex-1 max-sm:contents"
              // The phone's "Save search" pill (JOIN-SAVE, see `phoneSaveOffered`): at the end of the count row,
              // outside its scroller. `sm:hidden` — from sm the offer is the labelled button beside the view modes.
              // `outline`, never `cta`: an offer on the filter row is not the page's one brand CTA (canon).
              // (`hasSavableSearch` already says no on the teachers category; `saveSearch &&` is the same rule, typed.)
              countTrailing={phoneSaveOffered && saveSearch ? (
                <Button type="button" variant="outline" size="none" onClick={saveSearch} className="min-h-11 shrink-0 gap-1.5 rounded-full px-3.5 text-sm font-semibold sm:hidden">
                  <Bookmark className="size-4" aria-hidden />
                  {tr('Save search', 'Lưu tìm kiếm')}
                </Button>
              ) : undefined}
            />
            {/* ⛔ SAVE SEARCH SITS LEFT OF THE VIEW MODES, ON THE SAME LINE — owner, 2026-08-12,
                and the order is the instruction, not a preference. Both are right-aligned by this
                row's justify-between, so the count and the path own the left and these two own the
                right regardless of how long the breadcrumb gets.
                ⚠️ Save search is OFFERED, NOT ALWAYS SHOWN: below two applied filters it is an
                offer to save nothing (see shouldOfferSaveSearch in result-line.tsx), so it renders
                null on the undirected home view and costs no width there. */}
            {/* ⚠️ `order-3` AT EVERY BREAKPOINT, AND IT HAS TO STAY AHEAD OF THE COUNT HALF. On a
                phone the row reads heading(1) → chips(2) → this(3) → count+path(last), so Save
                search keeps the chips on its left and the caption still lands under all of it.
                ⚠️ `max-sm:ml-auto` IS FOR THE LINE THIS LANDS ON WHEN THE CHIPS PUSH IT OFF THE
                FIRST ONE (owner, 2026-08-12: "when chips overflow the line the view selector box
                goes to next lines right side not left"). The row's `justify-between` only governs
                a line with two or more items — alone on a wrapped line this cluster is a single
                item and packs to the START, i.e. hard left under the chips, which reads as a
                different control group rather than the same one displaced. `ml-auto` pins it to
                the right edge on that line and changes nothing on a line it shares. */}
            <div data-view-cluster="" className="order-3 flex shrink-0 items-center gap-1 max-sm:ml-auto">
              {/* ⚠️ THE LADDER COUNTS AS FILTERS HERE, AND LEAVING IT OUT HID THIS BUTTON ON THE
                  SEARCHES MOST WORTH SAVING. `resultFilters` deliberately EXCLUDES the ladder
                  levels because the breadcrumb beside it already names them — printing "Honda"
                  as a crumb and again as a chip is the duplication that list exists to avoid.
                  But "how many constraints are applied" is a different question from "what should
                  this line print", and using the display list for both meant Vehicles › Manual ›
                  Honda › Vision — four taps deep, and exactly the search in the owner's wireframe
                  — counted as ZERO and offered no save. Raised by two reviewers; confirmed on the
                  page by drilling category + brand and watching the button never appear.
                  ⛔ `saveSearch &&` first: never on the teachers category, however many filters (2026-10-09). */}
              {saveSearch && shouldOfferSaveSearch(appliedChips.length + ladderCrumbs.length) && (
                <Button
                  onClick={saveSearch}
                  variant="bare"
                  size="none"
                  // ⚠️ IT WAS ONCE `hidden sm:inline-flex`, which put "tell me when something like this
                  // appears" out of reach on a phone. Below sm it is hidden again, but now because the
                  // phone has its OWN offer: the labelled 44px pill at the end of the count row, from the
                  // first query or filter (JOIN-SAVE, `phoneSaveOffered`). One offer per screen size.
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent max-sm:hidden"
                >
                  <Bookmark className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">{tr('Save search', 'Lưu tìm kiếm')}</span>
                  <span className="sr-only sm:hidden">{tr('Save search', 'Lưu tìm kiếm')}</span>
                </Button>
              )}
              {/* ⛔ No Map tab over the teachers feed — `mapOffered` (gate review, 2026-10-09). */}
              <ViewToggles viewMode={viewMode} onViewMode={changeView} showVideo={showVideoView} showMap={mapOffered} />
            </div>
          </div>

          {/* Video view (4th mode): its own vertical clip feed with a self-contained
              data fetch (hasVideo=1) + loading/empty states — replaces the grid/list/map
              results area entirely, so the blocks below are skipped in this mode. */}
          {viewMode === 'video' && (
            <VideoFeed baseParams={baseParamsString} onOpen={handleOpen} onPrefetch={prefetchListing} onClose={() => { setViewMode(prevViewRef.current); setVideoReturn(null) }} restoreTo={videoReturn} />
          )}

          {/* LISTINGS CONTAINER */}
          {/* First-page placeholders. ⚠️ FIRST_PAGE_SIZE of them, not six: the query's `limit`
              is 12 (see the fetcher above), so six left the results area a full grid row
              short on every breakpoint and the column jumped down when the answer landed.
              The list branch renders the SAME row placeholder and the SAME container as the
              real compact view — it used to hand-roll a wider, unrounded row inside a
              single-column `space-y-2`, which on desktop was six stacked rows standing in
              for three rows of two.
              ⚠️ Not reached on a cold HOME load: the query is seeded with the ISR listings
              (initialData below), so `isLoading` is false and the real cards paint first. */}
          {viewMode !== 'video' && isLoading && listings.length === 0 && (
            viewMode === 'grid' ? (
              <div className={LISTING_GRID}>
                {Array.from({ length: FIRST_PAGE_SIZE }).map((_, i) => (
                  <ListingCardSkeleton key={i} />
                ))}
              </div>
            ) : (
              <div className={COMPACT_LIST_GRID}>
                {Array.from({ length: FIRST_PAGE_SIZE }).map((_, i) => (
                  <CompactListingRowSkeleton key={i} />
                ))}
              </div>
            )
          )}

          {viewMode !== 'video' && !isLoading && (shownListings.length === 0 || failedWithoutAnswer) && (
            queryError ? renderErrorState(showDiscovery ? 'gap-3 py-16' : undefined) : renderEmptyState()
          )}

          {/* ⚠️ THE TRANSITION LIVES OUTSIDE THE CONDITIONAL, AND THE PREDICATE IS `queryFetching`.
              Both were wrong together, and the pair made this the one motion in the app that lied.
              · `transition-opacity` used to sit INSIDE the `isLoading &&` string, so the utility was
                added and removed WITH the opacity: the dim could fade in, but the recovery — the
                moment results actually arrive — was a hard snap. The arrival was never animated.
              · `isLoading` is `queryLoading || (queryFetching && listings.length === 0)`, and
                `placeholderData: (previousData) => previousData` keeps the old rows on screen, so
                on a facet or sort tap `listings.length` is never 0 and this was false for the WHOLE
                refetch. The only "results are loading" affordance on the surface never fired on the
                interaction it exists for.
              `queryFetching` is true for exactly the window between the tap and the new inventory.
              The dim is gentler than the old `opacity-60`, which read as DISABLED on results that
              are still valid and still tappable; pointer-events are left alone for the same reason.
              ⚠️ AND `page === 1`, WHICH THE MERGE MADE NECESSARY. queryFetching is also true while
              a LATER page is being appended, so without this the whole grid dimmed on every step
              of the infinite feed — the one thing an infinite feed must not do, since the rows
              being dimmed are the ones the reader is looking at and nothing about them is
              changing. That was survivable while this block only served the results view; the
              merge points it at the home feed, where "Browse everything" and every scroll after it
              would flash the page. Page 1 is exactly the refetch that REPLACES the set (a filter
              or sort change — placeholderData holds the old rows meanwhile), which is the case
              this affordance was written for. External reviewer. */}
          {/* ⛔ `queryShowingStaleSet`, NOT `queryFetching` ALONE — THE PAGE-1 NARROWING IS NOT
                ENOUGH ON THE HOME FEED. The home route bakes 12 cards into 6h ISR HTML and seeds the
                query with them; staleTime is 30s, so `refetchOnMount` fires a page-1 revalidation
                the moment the tree hydrates, on 100% of cold loads. With only `queryFetching &&
                page === 1` that meant: frame A the grid paints at full opacity, frame B the WHOLE
                grid dips to 70% and the footer button is replaced by a shorter spinner, frame C it
                all comes back — a flash and a shift on the site's most-served route, none of which
                happened before the landing and results branches were merged.
                `isPlaceholderData` is the honest signal for what this affordance was written for:
                it is true only while the rows on screen belong to the PREVIOUS query (a filter or
                sort change, held over by `placeholderData`), which is exactly when dimming says
                something true — "these are the old results". A background revalidation of the set
                you are already looking at is not that, and must be invisible.
                ⚠️ THIS COMMENT SITS OUTSIDE THE `&& (` ON PURPOSE. A braced JSX comment is only
                valid as a CHILD; in expression position — directly after `cond && (` — it is a
                syntax error, not a comment. Putting it there is what broke this file for one edit.
                ⚠️ And do not write the closing marker of a block comment inside one, even as prose:
                it ends the comment there and the remainder becomes JSX text with stray braces.
                That is what broke it a second time, one line below this. */}
          {viewMode !== 'video' && shownListings.length > 0 && !failedWithoutAnswer && (
            /* ⚠️ `inert` AND `pointer-events-none` TOGETHER — not one or the other. The class alone
               only blocks the mouse: a keyboard reader can still Tab onto a stale card and press
               Enter, and a screen reader can still activate it, which is the wrong listing opening
               by the path least likely to be tested. `inert` closes all three (focus, hit-testing,
               the a11y tree) but is Chromium 102+, and this ships inside an Android WebView whose
               version follows the device — so the class stays as the floor for old WebViews, where
               dropping it would be a straight regression. `aria-busy` tells AT why it went quiet.
               ⚠️ DIM WHENEVER IT IS INERT. The dim is otherwise gated on `page === 1` while the
               lock is not, and a reviewer caught the gap: at page > 1 the reader would get
               full-opacity cards that silently ignore taps, which reads as a frozen app.
               ⚠️ A PLAIN BLOCK COMMENT, NOT THE BRACED JSX KIND — this sits in EXPRESSION position,
               right after `&& (`, where the braced form is a syntax error. The sibling comment
               above says exactly this and I still wrote it wrong here; it cost a typecheck round. */
            <div
              /* ⚠️ `|| undefined`, NEVER a bare `false`. React 19 does serialise `inert={false}` as
                 "no attribute", but `inert` is a BOOLEAN attribute — present at all means inert,
                 `inert="false"` included — so any renderer that stringifies it would freeze the
                 grid for every reader in the normal case. `undefined` is unambiguous everywhere
                 and costs nothing. A reviewer raised this against pre-19 React; we are on 19, but
                 the failure it describes is bad enough to be worth insuring against. */
              // ⚠️ AND WHILE A COLD DEEP LINK'S SEED IS MASKED (E-SSR): those placeholders are twelve
              // unrelated listings underneath — a tap on one would open a card the reader never saw.
              // Not dimmed on top of the mask, though: the placeholders are already the loading state.
              inert={staleFromOtherCategory || seedMasked || undefined}
              aria-busy={staleFromOtherCategory || seedMasked || undefined}
              className={cn(
                'transition-opacity duration-200',
                (((queryShowingStaleSet && page === 1) && !seedMasked) || staleFromOtherCategory) && 'opacity-70',
                (staleFromOtherCategory || seedMasked) && 'pointer-events-none',
              )}
            >
              {/* ⚠️ NO `key` AND NO ENTRANCE. The key was
                  `viewMode|activeCategory|activeSubcategory|activeDistrict|sort|verifiedOnly|conditionFilter`,
                  which forced a full unmount/remount of every card on each filter change: every
                  <Image placeholder="blur"> re-entered blurred, CardVideo tore down and re-observed,
                  per-card carousel idx/expanded state reset, the LCP card re-preloaded, and the
                  memo() on ListingCard was defeated for that commit. All of it paid for a 200ms
                  `animate-in fade-in slide-in-from-bottom-1` that — because placeholderData holds the
                  previous rows — animated the OLD results in, then swapped the real ones in silently.
                  The entrance was literally animating the wrong data. The key was also only a PARTIAL
                  signature (it omitted priceRange, listingType, brand, model and the query), so it
                  did not even remount consistently. Cards now update in place, which is what a
                  continuous surface should do — and since the merge that is true across the
                  landing↔search boundary as well, not just within one of them. */}
              <div>
              {viewMode === 'grid' && (
                /* Grid Mode (Standard Cards) — the home feed's presentation, and now the DEFAULT
                   everywhere (see the viewMode useState).
                   `data-feed-restoring`: every restored card renders at its REAL size while the
                   back-nav restore aligns — see the rule beside `[data-feed-card]` in globals.css. */
                <div data-feed-restoring={restoring || undefined} className={cn('feed-grid', LISTING_GRID)}>
                  {gridListings.map((l, index) => (
                    <Fragment key={l.id}>
                      {/* data-feed-card = the back-nav restore ANCHOR. The return-to-feed
                          effect realigns this exact element, which is what makes "put me
                          back where I was" survive a page whose height changed while we
                          were away (the discovery shelves mount lazily). */}
                      <div
                        data-feed-card={l.id}
                        className="flex flex-col h-full"
                        onMouseEnter={() => prefetchListing(l.id)}
                        // ⚠️ FOCUS AS WELL AS HOVER. Keyboard and switch users never fire a pointer
                        // event, so every warm-up in this app was mouse-only and they alone paid the
                        // full navigation. `onFocus` is the keyboard's hover. (A `{/* */}` comment
                        // here is a SYNTAX ERROR — it is only valid in child position.)
                        onFocus={() => prefetchListing(l.id)}
                        onTouchStart={() => prefetchListing(l.id)}
                      >
                        {/* ⚠️ `lcp` IS CONDITIONAL, AND THE CONDITION IS "IS THE PROMO BANNER ON
                            SCREEN". `lcp` turns on next/image `priority`, i.e. emits a
                            <link rel=preload>. Measured at 390×844 / 4× CPU / 1.6 Mbps on the
                            undirected home view, the browser picks `/banners/promo-1.svg` as LCP at
                            1816 ms — not a card photo — so spending the preload budget on the first
                            card there both misses AND competes with the element that wins. This
                            used to be two separate call sites in two separate branches that had to
                            be kept deliberately out of agreement; one tree means one call site and
                            one predicate.
                            ⛔ "THE BANNER PRELOADS ITSELF FROM promo-banner.tsx" USED TO BE THE
                            NEXT SENTENCE HERE AND IT IS FALSE. Measured 2026-08-12 on the built
                            page: the only `link[rel=preload][as=image]` entries are
                            `/logo-mark.svg` and one rail thumbnail — no `/banners/promo-*`.
                            promo-banner.tsx says so itself in its own header ("nothing preloads
                            it"), having tried `preload()` and reverted it because the tag LEAKED
                            across soft navigations. So the banner wins LCP UNPRELOADED, which
                            makes not spending the budget against it more important, not less.
                            ⛔ IT IS NOW UNCONDITIONAL, BECAUSE THE BANNER IS GONE (2026-09-18).
                            This read `!showBanner` for as long as a promo banner could sit above the
                            grid: preloading a card while a 232px-tall banner owned the first screen
                            spends the preload budget on something that is not the largest paint. The
                            banner was removed from this page, so the first card IS the first image
                            the visitor sees and the hint belongs on it. If ANY full-width media ever
                            returns above this grid, restore a condition here — that is the invariant,
                            not the specific predicate.
                            ⛔ MAP AND VIDEO MODE CANNOT REACH THIS LINE, AND THE COMPILER SAYS SO —
                            two reviewers asked for `viewMode !== 'map' && viewMode !== 'video'` here
                            and adding it is a TYPE ERROR: "types '\"grid\"' and '\"map\"' have no
                            overlap". This branch renders only in grid mode, so the takeover surfaces
                            never ship this card, let alone its preload. Left unguarded deliberately;
                            a guard here would read as though the modes were a live risk.
                            ✅ MEASURED 2026-09-18 ON THE AUDIENCE'S PROFILE (4x CPU, ~1.1 Mbps,
                            150 ms), and this is the claim a reviewer asked to see tested: the LCP
                            element IS this card's image — 2,288 ms on a 393px phone and 2,200 ms on
                            a 1,280px desktop, both resolving to the same listing webp — and the
                            `lcp` prop's output in the served HTML is a `<link rel="preload"
                            as="image" imageSrcSet=…>` for exactly that URL. So the hint is spent on
                            the element it names, on both viewports, even though the 280px category
                            grid now sits above the grid on a phone.
                            ⚠️ AN UNTHROTTLED RUN WITH JS COVERAGE ON SAID THE LOGO WAS THE LCP at
                            1,044 ms, and that reading is the harness, not the site: with no network
                            throttling the SVG logo paints before any photo arrives. Measure this on
                            the throttled profile or the answer inverts.
                            ⚠️ `priority` STAYS UNCONDITIONAL. It is a different lever: without
                            `lcp` it resolves to `loading="eager"` (listing-card.tsx ~435), so the
                            first card still skips lazy-loading — it just stops claiming the preload. */}
                        <ListingCard listing={l} onOpen={handleOpen} priority={index === 0} lcp={index === 0} onLocate={locateListing} />
                      </div>
                      {/* Guest capture (5a #7): one full-width signup ROW after the first page.
                          Renders null once signed in (and while auth is still loading).
                          ⛔ AFTER THE 12TH, NOT THE 8TH, AND FULL WIDTH (E-ORPHAN, 2026-09-29). It was
                          one CELL inserted after the 8th listing, which made page one 13 cells — a
                          multiple of nothing — so every breakpoint ended on an orphan (desktop rows
                          4·4·4·1, phone 2·2·2·2·2·2·1). `FIRST_PAGE_SIZE` divides 2, 3 and 4 columns,
                          and the row spans the grid (`col-span-full`), so every listing row stays full:
                          on the undirected home it sits directly above "Browse everything", on a
                          search between page one and page two, and a feed shorter than a page has
                          none. */}
                      {index === FIRST_PAGE_SIZE - 1 && <CaptureCard />}
                    </Fragment>
                  ))}
                  {/* The next page's reserved cells — see `pendingRows`. Decorative: the rows
                      they stand in for announce themselves when they land. */}
                  {Array.from({ length: pendingRows }, (_, i) => (
                    <div key={`pending-${i}`} data-feed-skeleton="" aria-hidden="true" className="flex flex-col h-full">
                      <ListingCardSkeleton />
                    </div>
                  ))}
                </div>
              )}

              {viewMode === 'map' && (
                /* Airbnb-style split: the list scrolls WITH THE PAGE (left) beside a sticky map (right).
                   ⛔ ONE SCROLLER, THE WINDOW (E-MAP, 2026-09-29). The list used to be its own
                   `100dvh-8rem` scroll box beside a map of the same height in a grid row of exactly that
                   height — so the map's `sticky` could never stick, page scroll moved BOTH, and at
                   1440×900 the map's bottom sat at y=1179, under the fold. Now the grid is as tall as the
                   list, the map pins under the chrome (`--map-top`, set here so the building header in
                   the list can pin to the same line) and ends 1rem above the fold. Phone: unchanged —
                   the 60dvh inset with the list below is a recorded decision (2026-07-14, see below). */
                <div
                  className="grid grid-cols-1 lg:grid-cols-12 lg:items-start gap-4"
                  style={{ '--map-top': headerHidden ? '1rem' : `calc(4rem + max(env(safe-area-inset-top), var(--safe-area-inset-top, 0px)) + ${toolbarH}px + 1rem)` } as CSSProperties}
                >
                  {/* Left: the result list — one column at lg, two from xl, in the page's own scroll. */}
                  <div ref={mapListRef} className="min-w-0 lg:col-span-5 xl:col-span-6 grid grid-cols-1 xl:grid-cols-2 gap-4 content-start order-2 lg:order-1">
                    {/*
                      * THE DRILLED-IN BUILDING: what you are looking at, how big it is, and the way
                      * out. Sticky (under the pinned chrome, at the map's own top line) — otherwise the
                      * header leaves the viewport on the second card and a reader 40 units deep has no
                      * reminder they are inside one tower rather than the whole city.
                      * ⚠️ The count is the SERVER's, across the whole filtered set — not
                      * `mapSortedListings.length`, which is only the pages loaded so far and would
                      * climb from 24 toward 157 as the reader scrolled.
                      */}
                    {/* ⚠️ NOT A COUNT READOUT. <ResultLine> already announces the total in a live
                        region on this surface; repeating it here would make a screen reader say it
                        twice on every filter change. This is a PROMPT — it names the problem and
                        hands over the control, and it is dismissible so it never becomes a nag.
                        ⚠️ `lg:hidden` — desktop has the whole filter rail beside the map and needs
                        no prompt. In the flow (not sticky) so it never covers the map or fights the
                        sticky sort strip above it. */}
                    {showNarrowPrompt && (
                      <div className="material -mx-1 mb-1 rounded-xl border border-border/70 bg-card/70 p-2.5 backdrop-blur lg:hidden">
                        <p className="text-xs font-semibold text-foreground">
                          {tr('Too many places to see clearly', 'Quá nhiều chỗ để xem rõ')}
                        </p>
                        <p className="mt-0.5 text-xs text-body">
                          {roomsFacet
                            ? tr('Filter by price or rooms to see the photos properly.', 'Lọc theo giá hoặc số phòng để xem ảnh rõ hơn.')
                            : tr('Filter by price or area to see the photos properly.', 'Lọc theo giá hoặc khu vực để xem ảnh rõ hơn.')}
                        </p>
                        {/**
                          * ⛔ ONE BUTTON, NOT THREE — and the reason is honesty, not tidiness. The first
                          * cut offered "Price", a rooms chip and "All filters" side by side; a reviewer
                          * pointed out all three opened the same panel and nothing else,
                          * so "Price" did not take you to price and the rooms chip did not take you to
                          * rooms. The filter panel takes no section target, so per-facet buttons
                          * cannot honour their own labels without threading a scroll/focus anchor
                          * through it — and three controls that lie about where they go are worse than
                          * one that says exactly what it does. The copy names what is inside instead.
                          */}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <Button
                            variant="bare"
                            size="none"
                            onClick={() => setOpenFilterSignal((n) => n + 1)}
                            className="rounded-full border border-line-strong px-3.5 py-1.5 text-xs font-bold text-foreground transition-colors hover:bg-muted"
                          >
                            {tr('Narrow it down', 'Thu hẹp kết quả')}
                          </Button>
                          <Button
                            variant="bare"
                            size="none"
                            onClick={() => setDismissedForSig(feedSig)}
                            className="ml-auto px-2 py-1.5 text-xs font-semibold text-body transition-colors hover:text-foreground"
                          >
                            {tr('Dismiss', 'Bỏ qua')}
                          </Button>
                        </div>
                      </div>
                    )}
                    {/* ⚠️ NO `relative` ON THE ROW BELOW — `sticky` already establishes the containing
                        block the ✕ anchors to, and adding both emits two position utilities where the
                        later one in Tailwind's order wins (reviewer), so `relative` would be a no-op
                        that reads like the thing making the corner button work. `pr-8` reserves the
                        corner. (This comment sits OUTSIDE the `&&` — a JSX comment in expression
                        position is a syntax error, per CLAUDE.md's landmine list.) */}
                    {activeBuilding && (
                      // `col-span-full`: the list is two columns from xl; the header spans both. It pins
                      // to the map's own top line on desktop (the window scrolls now, E-MAP), and at the
                      // viewport top on a phone, as before.
                      <div className="material sticky top-0 z-10 -mx-1 mb-1 col-span-full flex items-center gap-3 rounded-xl border border-border/70 bg-card/70 p-2 pr-8 backdrop-blur lg:top-[var(--map-top)] lg:transition-[top] lg:duration-[var(--duration-sticky,250ms)] motion-reduce:transition-none">
                        {activeBuilding.hero && (
                          <Image
                            src={activeBuilding.hero}
                            alt={activeBuilding.name}
                            width={96}
                            height={64}
                            className="size-16 shrink-0 rounded-lg object-cover"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground">{activeBuilding.name}</p>
                          <p className="text-xs text-body">
                            {activeBuilding.count} {tr('units available', 'căn cho thuê')}
                            {activeBuilding.district ? ` · ${activeBuilding.district}` : ''}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0"
                          onClick={() => { setSelectedBuilding(null); scrollMapListToTop() }}
                        >
                          {tr('All buildings', 'Tất cả')}
                        </Button>
                        {/**
                          * ⛔ THE CORNER ✕ — owner, 2026-09-24: "add x closing button top right of this
                          * card to close the building mode and continue surfing the other apartments".
                          * The action is identical to "All buildings" beside it (`setSelectedBuilding(null)`),
                          * and that is the point: the labelled button reads as a FILTER — "Tất cả" is
                          * literally the word every other filter uses for its unset state — so a reader
                          * who has drilled into one tower does not recognise it as the way out. A ✕ in
                          * the corner is the one affordance nobody has to interpret. Keeping both is the
                          * ordinary dialog shape (an ✕ and a labelled action), not a duplicate to tidy
                          * away; the ✕ says "close", the button says where you land.
                          * ⚠️ `pr-8` on the row above reserves this corner so the ✕ never sits on top of
                          * the button or the truncated building name.
                          */}
                        <IconButton
                          size="xs"
                          onClick={() => { setSelectedBuilding(null); scrollMapListToTop() }}
                          aria-label={tr('Close building', 'Đóng toà nhà')}
                          className="absolute right-1.5 top-1.5 h-6 w-6 text-ink-4 hover:bg-muted hover:text-foreground"
                        >
                          <X className="h-4 w-4 shrink-0" />
                        </IconButton>
                      </div>
                    )}
                    {mapSortedListings.map((l) => (
                      <div
                        key={l.id}
                        data-lid={l.id}
                        onMouseEnter={() => setHoveredId(l.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        className={cn(
                          // The pin handler scrolls the WINDOW to this card now (E-MAP): land it
                          // below the pinned header + toolbar, where the map's own top line is.
                          'rounded-xl lg:scroll-mt-[var(--map-top)]',
                          // Highlight the IMAGE only (user-picked 2026-07-14):
                          // ringing the whole card incl. the text block read badly.
                          hoveredId === l.id && '[&_[data-protected]]:ring-2 [&_[data-protected]]:ring-inset [&_[data-protected]]:ring-brand/40',
                        )}
                      >
                        <ListingCard listing={l} onOpen={handleOpen} onLocate={locateListing} />
                      </div>
                    ))}
                    {/* The list's infinite-scroll sentinel — observed against the WINDOW since E-MAP (the
                        list no longer scrolls on its own). ⚠️ Never `hidden` (the landmine rule). */}
                    {!nearby && (
                      <div ref={mapSentinelRef} className="col-span-full select-none py-2">
                        {pageWithoutAnswer && queryError && renderMoreError('py-2')}
                        {queryFetching && hasMore && (
                          <div className="flex items-center justify-center gap-2 text-xs font-semibold text-muted-foreground">
                            <Spinner size="sm" className="border-border border-t-brand" />
                            {tr('Loading more…', 'Đang tải thêm…')}
                          </div>
                        )}
                        {/* ⛔ THE CAP'S BUTTON HAS TO EXIST HERE TOO. The footer that carries it for
                            the grid is gated on `viewMode !== 'map'`, and the map column paginates
                            through its OWN sentinel — so without this the map reader hits the
                            ceiling and auto-load simply stops with no control, which is precisely
                            the dead end the `feedUnlocked` gate was written to avoid. An external
                            reviewer flagged it as the one thing to check before committing, and it
                            was real. */}
                        {/* ⚠️ THE SAME GUARDS THE SENTINEL AND THE FOOTER BUTTON CARRY (reviewer).
                            `query !== debouncedQuery` is the one that matters: the fetcher runs
                            150ms behind the committed search, so a press inside that window pages
                            the PREVIOUS query's inventory and then throws it away when the filter
                            signature settles. `showDiscovery && !feedUnlocked` keeps this from
                            appearing beside the undirected feed's own unlock button. */}
                        {hasMore && listings.length >= autoLoadCeiling && !queryFetching
                          && query.trim() === debouncedQuery.trim()
                          && !(showDiscovery && !feedUnlocked) && (
                          <Button
                            variant="bare"
                            size="none"
                            onClick={() => { prefetchNextPage(); setPage((p) => p + 1); setAutoLoadCeiling((c) => c + AUTO_LOAD_CAP) }}
                            className="w-full rounded-xl border border-line-strong px-4 py-2.5 text-sm font-bold text-foreground transition-colors hover:bg-muted"
                          >
                            {tr('Load more', 'Tải thêm')}
                          </Button>
                        )}
                        {!hasMore && totalCount > 24 && (
                          <p className="text-center text-xs font-semibold text-ink-4">{tr("You've reached the end", 'Bạn đã xem hết')}</p>
                        )}
                      </div>
                    )}
                  </div>
                  {/* Right: big sticky map. On mobile it's a tall-but-not-full 60dvh
                      so the listings peek below it stays a thumb-scrollable strip (a
                      full-bleed map would swallow every touch as pan/zoom). scroll-mt
                      clears the sticky header so locate lands ON the map. */}
                  {/* ⚠️ `self-start` + the grid's `items-start`: a stretched grid item is as tall as the row,
                      and a sticky box as tall as its container has nowhere to stick — the old bug. The
                      height follows `--map-top` so the map always ends 1rem above the fold; listings-map
                      re-measures itself when its box resizes (its ResizeObserver). */}
                  <div
                    ref={mapWrapRef}
                    className="min-w-0 h-[60dvh] rounded-2xl overflow-hidden order-1 lg:order-2 lg:col-span-7 xl:col-span-6 scroll-mt-[calc(4rem+env(safe-area-inset-top))] lg:scroll-mt-24 lg:sticky lg:self-start lg:top-[var(--map-top)] lg:h-[calc(100dvh-var(--map-top)-1rem)] lg:transition-[top,height] lg:duration-[var(--duration-sticky,250ms)] lg:ease-out motion-reduce:transition-none">
                    <ListingsMap
                      listings={mapListings}
                      buildings={buildingPins}
                      selectedBuilding={selectedBuilding}
                      onSelectBuilding={handleSelectBuilding}
                  feedParams={baseParamsString}
                  boundary={outlineData?.boundary ?? null}
                  districtShapes={districtPickEnabled ? districtShapes : undefined}
                  onSelectDistrict={districtPickEnabled ? handleSelectDistrict : undefined}
                      activeDistrict={activeDistrict}
                      onOpenListing={handleOpen}
                      selectedId={hoveredId ?? focusId}
                      onHover={setHoveredId}
                      onPinOpen={(id) => {
                        // Surface the listing's card in the list. WHEN this fires is the
                        // map's call: desktop = on pin open (the list is a side column beside
                        // a STICKY map, so scrolling the page to it moves nothing on the map —
                        // and the card's scroll margin keeps it clear of the pinned chrome);
                        // touch = only on the first tap of the popup card (on mobile the list
                        // is BELOW the map, so scrolling on a pin tap would drag the page off
                        // the map — user decision 2026-07-14).
                        mapListRef.current?.querySelector(`[data-lid="${id}"]`)?.scrollIntoView({ behavior: scrollBehavior(), block: 'nearest' })
                      }}
                      onMove={setMapCenter}
                      focusId={focusId}
                      nearby={nearby}
                      areaKey={`${activeProvince?.code ?? ''}|${activeWard?.code ?? ''}|${activeDistrict}`}
                    />
                  </div>
                </div>
              )}

              {viewMode === 'compact' && (
                /* Compact Row Mode (bonbanh-style list rows). Two columns on
                   desktop so the wide row doesn't strand the actions far right
                   with a big empty middle; single column on mobile.
                   ⚠️ SEAM FOR THE NEW RESULT LINE (stream C): this is the row it replaces.
                   <CompactListingRow> is a `ssr:false` dynamic with a geometry-matched
                   skeleton (compact-listing-row-skeleton.tsx) — a replacement needs the same
                   pair or the column collapses and rebounds while the chunk arrives. */
                <div data-feed-restoring={restoring || undefined} className={COMPACT_LIST_GRID}>
                  {gridListings.map((l, index) => (
                    /* data-feed-card = the back-nav restore anchor (see the grid above). */
                    <div key={l.id} data-feed-card={l.id}>
                      <CompactListingRow
                        listing={l}
                        index={index}
                        onOpen={handleOpen}
                        onPrefetch={prefetchListing}
                        onLocate={locateOnMap}
                      />
                    </div>
                  ))}
                  {/* The next page's reserved rows — see `pendingRows`. */}
                  {Array.from({ length: pendingRows }, (_, i) => (
                    <div key={`pending-${i}`} data-feed-skeleton="" aria-hidden="true">
                      <CompactListingRowSkeleton />
                    </div>
                  ))}
                </div>
              )}
              </div>

              {/* PAGINATION FOOTER — ONE FOOTER FOR BOTH STATES, and the "Browse everything"
                  button is the whole reason it has to be one.
                  · Undirected browse is NOT an infinite feed: the sentinel below is inert until
                    the visitor presses the button (see the IntersectionObserver effect's
                    `showDiscovery && !feedUnlocked` guard), so the FOOTER stays reachable on the
                    home page. Pressing it loads page 2 AND unlocks infinite scroll from there on.
                  · A searched/faceted view auto-paginates immediately, as it always did.
                  ⚠️ THE SENTINEL DIV MUST NEVER BE `hidden`/display:none. A hidden element is
                  never intersected, so pagination would die silently — no error, no empty state,
                  just a feed that stops. It renders whenever there are results and we are not in
                  the map view (which observes its own in-column sentinel above).
                  "Near you" is excluded because it pulls one broad set and distance-filters it
                  client-side: there is no further page to fetch. */}
              {!nearby && viewMode !== 'map' && (
                <div ref={loadMoreRef} className="mt-6 select-none">
                  {pageWithoutAnswer && queryError && <div className="border-t border-border pt-6">{renderMoreError()}</div>}
                  {/* ⚠️ THE BUTTON AND THE SPINNER ARE MUTUALLY EXCLUSIVE AND BOTH KEY OFF THE SAME
                      CONDITION, or the footer swaps a 44px button for a ~19px spinner and shifts the
                      page. Gated on a fetch that is actually LOADING MORE (page > 1) rather than any
                      fetch: the automatic page-1 revalidation on every cold home load is not the
                      user asking for more, and treating it as such is what made this region flicker. */}
                  {showDiscovery && hasMore && !feedUnlocked && !(queryFetching && page > 1) && (
                    <div className="border-t border-border pt-6">
                      {/* The undirected feed's ONE ending (wow pass, 2026-08-06): a full-width
                          continuation instead of a small centred "Load more" — on a sparse
                          catalogue the shelves below may all hide, so the page needs to end on
                          an invitation, not trail off. */}
                      <Button
                        variant="bare"
                        size="none"
                        onClick={() => { prefetchNextPage(); setPage((p) => p + 1); setFeedUnlocked(true) }}
                        className="w-full rounded-xl border border-line-strong px-6 py-3 text-sm font-bold text-foreground transition-colors hover:bg-muted"
                      >
                        {tr('Browse everything', 'Xem tất cả tin đăng')}
                      </Button>
                    </div>
                  )}
                  {/* ⛔ THE AUTO-LOAD CAP'S BUTTON (owner, 2026-09-24). Shown once the feed has
                      auto-paged to the ceiling; pressing it raises the ceiling by another 100 and
                      hands the next stretch back to the sentinel.
                      ⚠️ Carries the SAME `!(queryFetching && page > 1)` guard as the "Browse
                      everything" button above, for the same reason recorded there: the button and
                      the spinner must be mutually exclusive or the footer swaps a 44px control for
                      a ~19px spinner and shifts the page under the reader.
                      ⚠️ Mutually exclusive with "Browse everything" too — that one only renders
                      while `!feedUnlocked`, which on this feed means 12 rows, far below the cap;
                      the explicit `!(showDiscovery && !feedUnlocked)` keeps that true even if the
                      unlock gate's own condition is changed later. */}
                  {hasMore
                    && listings.length >= autoLoadCeiling
                    && !(showDiscovery && !feedUnlocked)
                    && !(queryFetching && page > 1) && (
                    <div className="border-t border-border pt-6">
                      <Button
                        variant="bare"
                        size="none"
                        onClick={() => { prefetchNextPage(); setPage((p) => p + 1); setAutoLoadCeiling((c) => c + AUTO_LOAD_CAP) }}
                        className="w-full rounded-xl border border-line-strong px-6 py-3 text-sm font-bold text-foreground transition-colors hover:bg-muted"
                      >
                        {tr('Load more', 'Tải thêm')}
                      </Button>
                    </div>
                  )}
                  {queryFetching && page > 1 && hasMore && (
                    <div className="flex items-center justify-center gap-2 border-t border-border pt-5 text-xs font-semibold text-muted-foreground">
                      <Spinner size="sm" className="border-border border-t-brand" />
                      {tr('Loading more…', 'Đang tải thêm…')}
                    </div>
                  )}
                  {!hasMore && totalCount > 24 && (
                    <p className="border-t border-border pt-5 text-center text-xs font-semibold text-ink-4">
                      {tr("You've reached the end", 'Bạn đã xem hết')}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── DISCOVERY SHELVES — BELOW THE RESULTS, NOT ABOVE THEM ───────────────────────
            ⚠️ THIS IS THE ONE THING THE MERGE REORDERED, AND IT IS DELIBERATE. These four rails
            used to sit between the category tiles and the feed, where they were the landing's
            content. With a results grid always present they were competing with it for the same
            vertical space — up to four ~350px rails ahead of the first row of merchandise on a
            marketplace whose measured problem was already that the first screen contained none
            (y=983 at 1440×900, 2026-08-09). Below the grid they become the "keep browsing" band
            a visitor reaches after the first page, which is what they are for.
            ⚠️ NOT the promo banner and NOT <WhyEno> — those two keep their owner-decided place
            above (2026-08-05). Only the shelves moved.
            ⚠️ Each rail self-hides under MIN_RAIL_ITEMS (shelf.tsx) and renders no box when it
            does, so `space-y-*` adds no gap for an absent one — the band simply disappears on a
            sparse catalogue. Every listing is still in the grid above, so nothing here is the
            only route to anything.
            ⚠️ KNOWN AND ACCEPTED: ONCE THE FEED IS UNLOCKED THESE SIT BELOW AN INFINITE SCROLL,
            like the site footer does. An external reviewer called it an uncatchable band, and the
            mechanism is real — the pagination sentinel is above them, so scrolling toward them
            fetches another page and pushes them down. It is bounded by being the SAME contract
            the footer has lived under since the "Browse everything" gate was added: in the
            DEFAULT state the feed stops at one page, so the shelves sit a screen below the button
            and are trivially reachable; only a visitor who has explicitly asked to browse
            everything scrolls past them, and burying merchandising shelves under the thing they
            asked for is the right answer. If that ever stops being true, the fix is the footer's
            fix too (a page cap or a "back to top" jump), not moving these back above the grid. */}
        {/* ⛔ A SEARCH THAT FOUND ONE TO SEVEN THINGS ENDS ON SOMETHING TO DO NEXT (E-ZERO, 2026-09-29).
            The discovery shelves are undirected-browse only, so a 1-result search ended in blank
            space under a single card. The owner's rule for sparse results is "add recovery, never
            hide", so the trending rail follows a short, complete answer — same spacing as the shelf
            band below, and it self-hides under MIN_RAIL_ITEMS like every rail.
            ⚠️ `recovery` lifts the rail's own "hide when the URL is filtered" rule, which exists for
            its home placement (above-the-fold redundancy) and is exactly wrong here.
            ⛔ NEVER ON A STOREFRONT: it is marketplace-wide merchandising, and a shop's page shows
            what the shop has (owner, 2026-08-30 — the same reason the promo slot is not there).
            ⚠️ ONLY ONCE THE GRID SHOWS THE ANSWER (`gridListings === shownListings`). The grid renders a
            deferred copy, so for a render it still held the twelve previous cards while this rail —
            not deferred — mounted under them, then rose ~1,500px when the grid caught up (measured:
            CLS 0.26 on a cold /?q=kindel at 390). Gated on the grid, both land in one commit. */}
        {!showDiscovery && !sellerId && viewMode === 'grid' && !isLoading && !queryError && !failedWithoutAnswer
          && shownListings.length > 0 && gridListings === shownListings && totalCount > 0 && totalCount < 8 && !hasMore && (
          <div className="mt-8 sm:mt-12 lg:mt-8">
            <ForYouRail initial={initialTrending} recovery />
          </div>
        )}

        {showDiscovery && (
          <div className="mt-8 space-y-8 sm:mt-12 sm:space-y-12 lg:mt-8 lg:space-y-8">
            {/* Recently viewed — the returning buyer's own trail. Self-hides for new visitors. */}
            <RecentlyViewedRail />

            {/* For You — the trending seed. It LEADS, so it keeps first claim on its cards and
                the two rails below are deduped against it (see dedupedBusinesses/railExcludeIds). */}
            <ForYouRail initial={initialTrending} />

            {/* Outstanding businesses — the highest-trust business storefronts. Seeded with the
                DEDUPED set (see railExcludeIds above) so it never repeats For You card-for-card. */}
            <BusinessRail initial={dedupedBusinesses} />

            {/* Browse by category — one horizontal rail per category, most-used first.
                Tapping a heading / "See all" opens that category (same as a tile). */}
            <DeferredCategoryRails categories={categories} onCategory={handleCategorySelect} excludeIds={railExcludeIds} />
          </div>
        )}
      </div>
    </section>
  )
}
