'use client'

import { Fragment, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from 'react'
import {
  Search,
  Inbox,
  AlertTriangle,
  MapPin,
  Phone,
  X,
  Sliders,
  Clock,
  Map,
  Bookmark,
  TrendingUp,
} from 'lucide-react'
import { toast } from 'sonner'
import type { SerializedListingCard, SerializedCategory } from '@/lib/types'
import { CATEGORY_COLOR_CLASSES, timeAgo } from '@/lib/types'
import { SITE_NAME } from '@/lib/edition'
import { CategoryIcon } from './category-icons'
import { ListingCard } from './listing-card'
import { CaptureCard } from './capture-card'
import { useHideOnScroll } from '@/hooks/use-hide-on-scroll'
import { BrandRail } from './brand-rail'
import { CategoryRail } from './category-rail'
import { ForYouRail } from './for-you-rail'
import { RecentlyViewedRail } from './recently-viewed-rail'
import { useNearViewport } from '@/hooks/use-near-viewport'
import { BusinessRail } from './business-rail'
import { DISTRICTS } from './listings-explorer.constants'
import { type Nearby, type Geo } from './area-filter'
import { useSearchShortcuts, useSearchHistory, useSaveSearch } from './use-explorer'
import { ViewToggles, SortStrip } from './explorer-toolbar'
import { Spinner } from '@/components/ui/spinner'
import { getListingCoordinates, haversineKm } from '@/lib/geo'
import { trackSearch } from '@/lib/analytics'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useLanguage, Tr } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { SUBCATEGORIES } from '@/lib/subcategories'
import { LISTING_TYPES, INTENT_SHORTCUTS, DESK_SHORTCUTS, categoryHasBrand, rangeFacetsFor, facetsFor } from '@/lib/taxonomy'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { Mascot } from './mascot'
import { useScrollArrows, ScrollArrows } from '@/hooks/use-scroll-arrows'
import { useSearchSuggest } from '@/hooks/use-search-suggest'
import { SearchSuggest, buildSuggestItems, type SuggestItem } from './search-suggest'
import { TrendingSearches } from './trending-searches'
import { useTrendingSearches } from '@/hooks/use-trending-searches'
import { AISearchButton } from './ai-concierge'
import { useSuggestKeyboardNav, activeSuggestOptionId, visualSearchFromPaste, RECENT_LOCATIONS_KEY } from '@/hooks/use-search-box'
import { RECENT_SEARCHES_KEY } from '@/lib/reco-signals'
import { ListingCardSkeleton } from './listing-card-skeleton'

// Custom filters are keyed by facet KEY in state, but range facets (year/mileage/
// engine) travel in the URL + API keyed by their numeric COLUMN as `range_<col>`
// (so the API can do a numeric range query); everything else is `attr_<key>`.
function applyFilterParams(p: URLSearchParams, customFilters: Record<string, string>, categorySlug: string, subcategorySlug: string) {
  const sub = subcategorySlug === 'all' ? null : subcategorySlug
  const facets = facetsFor(categorySlug, sub)
  Object.entries(customFilters).forEach(([key, val]) => {
    if (!val || val === 'all') return
    const f = facets.find((x) => x.key === key)
    if (!f) return // facet not valid for this (category, subcategory) — drop stale value
    if (f.kind === 'range' && f.range) p.set(`range_${f.range.column}`, val)
    else p.set(`attr_${key}`, val)
  })
}
function parseFilterParams(p: URLSearchParams, categorySlug: string, subcategorySlug: string): Record<string, string> {
  const sub = subcategorySlug === 'all' ? null : subcategorySlug
  const rf = rangeFacetsFor(categorySlug, sub)
  const out: Record<string, string> = {}
  p.forEach((value, key) => {
    if (key.startsWith('attr_')) out[key.replace('attr_', '')] = value
    else if (key.startsWith('range_')) {
      const col = key.replace('range_', '')
      const f = rf.find((x) => x.range.column === col)
      if (f) out[f.key] = value
    }
  })
  return out
}

// CategoryRails (below the fold) + the filter-only FacetBar are code-split out of the
// landing's initial bundle. ForYouRail + BusinessRail stay STATIC: they SSR their
// shimmer skeleton (reserving the rail's height) so they don't pop in and shift the feed
// — `ssr:false` here caused the CLS "layout shift culprits". They're tiny (reuse the
// already-bundled ListingCard), so the JS cost is negligible.
const CategoryRails = dynamic(() => import('./category-rails').then((m) => m.CategoryRails), { ssr: false })

// Perf Phase 1: mount the per-category rails only when the user approaches them —
// they injected many sections above the feed right after hydration (layout shift +
// an immediate /api/category-rails fetch on every cold load). The sentinel is
// zero-height, so deferral itself never moves anything.
function DeferredCategoryRails(props: React.ComponentProps<typeof CategoryRails>) {
  const { ref, near } = useNearViewport<HTMLDivElement>()
  // Idle-armed on top of near-viewport: the sentinel sits at the first-paint fold,
  // so near fires immediately — without the idle gate the rails (and their
  // /api/category-rails fetch) would still land inside the critical window.
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    const arm = () => setArmed(true)
    if (typeof requestIdleCallback === 'function') { const id = requestIdleCallback(arm, { timeout: 8000 }); return () => cancelIdleCallback(id) }
    const t = setTimeout(arm, 3500); return () => clearTimeout(t)
  }, [])
  return (
    <div ref={ref}>
      {armed && near ? <CategoryRails {...props} /> : null}
    </div>
  )
}
const FacetBar = dynamic(() => import('./facet-bar').then((m) => m.FacetBar), { ssr: false })

// Perf: the LIST view's row and the MOBILE filters drawer were static imports, so both shipped
// in the home route's first load even though neither is on the landing path — the landing mode
// renders its own ListingCard grid and the drawer is a mobile overlay nobody has opened yet.
// ⚠️ NOT because "the default view is the grid" — it is not. viewMode defaults to 'compact'
// (see the useState below), so this row IS the default results view once the explorer opens;
// almost all of the saved bytes are the drawer. Nothing here was ever server-rendered
// (showExplorer starts false), so ssr:false costs no HTML, but the row's chunk does land on the
// primary browse path — keep the skeleton geometry-matched. (Corrected 2026-07-25.)
//
// The row needs a placeholder with the real row's geometry, because in list view many of these
// render at once — a null while the chunk arrives would collapse the whole column and then push
// it back down. Mirrors CompactListingRow's own box: p-1.5 pr-1 around an h-14 thumbnail.
const CompactListingRow = dynamic(() => import('./compact-listing-row').then((m) => m.CompactListingRow), {
  ssr: false,
  loading: () => (
    <div className="flex items-center gap-3 rounded-xl p-1.5 pr-1">
      <Skeleton className="h-14 w-16 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-[15px] w-3/4" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  ),
})

const ExplorerFiltersDrawer = dynamic(() => import('./explorer-filters').then((m) => m.ExplorerFiltersDrawer), {
  ssr: false,
})

const ListingsMap = dynamic(() => import('./listings-map').then((m) => m.ListingsMap), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-tint flex flex-col items-center justify-center gap-2 select-none animate-pulse">
      <Spinner size="md" />
      <span className="text-3xs font-bold text-body uppercase tracking-wider">
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
type SortKey = 'newest' | 'recent' | 'price-low' | 'price-high' | 'popular'
type ViewMode = 'compact' | 'grid' | 'map' | 'video'

// The hero typeahead's listbox. Distinct from the header bar's ('header-search-suggest')
// so both can sit in the DOM at once — the header search reveals itself on scroll while
// the hero is still mounted — without colliding ids.
const SUGGEST_ID = 'hero-search-suggest'

type Props = {
  categories: SerializedCategory[]
  initialListings: SerializedListingCard[]
  initialTotal?: number
  // Server render timestamp of initialListings (Date.now() in the RSC). The homepage is 6h-ISR:
  // stamping the seed with CLIENT Date.now() marked hours-old snapshot data as fresh (within the
  // 30s staleTime), so React Query never revalidated it. With the true age, a stale snapshot
  // still paints instantly but refetches in the background.
  initialFetchedAt?: number
  // Server-known rail seeds (perf Phase 1) — rail geometry decided at first paint.
  initialBusinesses?: SerializedListingCard[]
  initialTrending?: SerializedListingCard[]
  listingsRef?: React.RefObject<HTMLDivElement | null>
}



export function ListingsExplorer({
  categories,
  initialListings,
  initialTotal,
  initialFetchedAt,
  initialBusinesses,
  initialTrending,
  listingsRef,
}: Props) {
  const { lang, t, tr } = useLanguage()
  const { openSignIn } = useAuth()
  // Desktop ← / → arrows for the horizontally-scrollable category grid (same primitive as the rails).
  const { scrollerRef: catScrollerRef, canLeft: catCanLeft, canRight: catCanRight, page: catPage } = useScrollArrows()
  const [activeCategory, setActiveCategory] = useState('all')
  const [query, setQuery] = useState('')
  // Loose (any-word) text match — set by visual search so a photo-derived phrase
  // surfaces the closest items instead of needing an exact multi-word match.
  const [looseMatch, setLooseMatch] = useState(false)
  const [sort, setSort] = useState<SortKey>('newest')
  const [verifiedOnly, setVerifiedOnly] = useState(true)
  const [activeDistrict, setActiveDistrict] = useState('all')
  // New area model (Vietnam 2025: province → ward), driven by the AreaFilter.
  const [activeProvince, setActiveProvince] = useState<Geo | null>(null)
  const [activeWard, setActiveWard] = useState<Geo | null>(null)
  const [nearby, setNearby] = useState<Nearby | null>(null) // {lat,lng,radiusKm} when "search near you" is on
  const [conditionFilter, setConditionFilter] = useState('all') // 'all' | 'new' | 'used'
  const [listingType, setListingType] = useState('all') // intent axis: all | sell | rent | wanted | free | service | job | event
  const [priceRange, setPriceRange] = useState('all') // 'all' | 'min-max' (VND, empty max = open)
  const [customFilters, setCustomFilters] = useState<Record<string, string>>({})
  const [activeSubcategory, setActiveSubcategory] = useState('all')
  const [activeBrand, setActiveBrand] = useState('all') // canonical brand slug, or 'all'
  const [activeModel, setActiveModel] = useState('all') // model display string, or 'all'
  const [viewMode, setViewMode] = useState<ViewMode>('compact')
  // The full-screen Video view remembers the view to fall back to on close (so exiting the
  // takeover lands the user back where they were, not always on the grid).
  const prevViewRef = useRef<ViewMode>('grid')
  const changeView = useCallback((m: ViewMode) => {
    setViewMode((cur) => { if (m === 'video' && cur !== 'video') prevViewRef.current = cur; return m })
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
    if (v === 'map' || v === 'grid' || v === 'compact' || v === 'video') { setViewMode(v); setShowExplorer(true) }
    else if (returning) { setViewMode('video'); setShowExplorer(true) }
  }, [])
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  // A listing to show on the map that isn't necessarily in the loaded feed (set when a
  // card outside the feed — e.g. the For You rail — asks to be located).
  const [focusListing, setFocusListing] = useState<SerializedListingCard | null>(null)
  const router = useRouter()
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false)
  // Deferring the drawer's IMPORT is not enough on its own: it was rendered unconditionally, so
  // next/dynamic would fetch the chunk the moment the page hydrates and the bytes would still
  // arrive on every home load — the import alone would only move them out of the first bundle.
  //
  // Rendered on `isMobileFilterOpen || filtersEverOpened`: the first term mounts it in the SAME
  // render as the open, so nothing waits a tick; the latch then keeps it mounted afterwards, so
  // closing still plays the drawer's exit animation instead of unmounting mid-flight.
  //
  // ⚠️ Today this is moot, and the reason is worth knowing: the drawer is UNREACHABLE. The only
  // caller of setIsMobileFilterOpen(true) is the 'open-mobile-filters' listener below, and
  // NOTHING in the repo dispatches that event — Header's events were renamed to the `eno:*`
  // convention and this one was orphaned (grepped src/, apps/, capacitor/). So its bytes were
  // shipping on every home load for a panel no user can open. Deferring it is the safe half of
  // the fix; whether to re-wire the trigger or delete the drawer is a product call, not this
  // task's. Deferring this and the list row together measured -118.4 KB of downloaded JS on the
  // home route; that total is not separable per component, so don't quote a figure for either.
  //
  // If the trigger is ever re-wired, consider a `loading:` for this dynamic — the first open
  // waits on the chunk with no visual feedback (both reviewers raised it; untestable while the
  // drawer is unreachable, so no speculative UI was added).
  const [filtersEverOpened, setFiltersEverOpened] = useState(false)
  useEffect(() => {
    if (isMobileFilterOpen) setFiltersEverOpened(true)
  }, [isMobileFilterOpen])
  const [showExplorer, setShowExplorer] = useState(false)
  // The sticky sort strip tracks the auto-hiding header (same hook): header shown →
  // pinned just below it; header rolled away → pinned at the viewport top.
  const headerHidden = useHideOnScroll()

  const [listings, setListings] = useState<SerializedListingCard[]>(initialListings)
  // Freshness anchor for the SSR seed: the SERVER render timestamp baked into the ISR
  // HTML (initialFetchedAt). The homepage snapshot can be up to 6h old — stamping it
  // with client Date.now() (the previous behavior) told React Query hours-old rows were
  // fresh, so sold/new listings never revalidated. With the true age the seed still
  // paints instantly (initialData always renders); it just ALSO refetches in the
  // background when the snapshot is older than the 30s staleTime — one cheap
  // /api/listings call in exchange for a feed that's actually current.
  const [seedFetchedAt] = useState(() => initialFetchedAt ?? Date.now())
  // When "search near you" is on, distance-FILTER the fetched set client-side, but keep
  // the TRUST-first ranking the API already applied (higher-trust sellers first), with
  // distance only as a tiebreaker. So "near you" narrows by radius without throwing away
  // the trust hierarchy. (Coordinates are approximate — district-derived — for now.)
  const shownListings = useMemo(() => {
    if (!nearby) return listings
    return listings
      .map((l) => ({ l, d: haversineKm(nearby, getListingCoordinates(l)) }))
      .filter((x) => x.d <= nearby.radiusKm)
      .sort((a, b) => (b.l.seller.trustScore - a.l.seller.trustScore) || (a.d - b.d))
      .map((x) => x.l)
  }, [listings, nearby])
  // Map view: inject the out-of-feed focus listing (For You rail / ?focus= deep
  // link) ahead of the feed. Memoized — an inline expression allocated a fresh
  // array every render, forcing the map's markers effect to re-run needlessly.
  const mapListings = useMemo(
    () => (focusListing && !shownListings.some((l) => l.id === focusListing.id) ? [focusListing, ...shownListings] : shownListings),
    [focusListing, shownListings],
  )
  // Render the card grids off a DEFERRED copy so a facet/sort toggle paints the
  // control's new state immediately and the (heavier) grid reconciliation runs as a
  // non-urgent update — keeps INP low on mid-range Android.
  const deferredListings = useDeferredValue(shownListings)
  const [, startFilterTransition] = useTransition()
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
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
  const restoreRafRef = useRef(0)
  const restoreStopRef = useRef<(() => void) | null>(null)
  const skipFirstPageResetRef = useRef(false)
  // The back-nav snapshot, read once on mount and applied when the feed's filters
  // settle to the same signature (filters hydrate from the URL in an effect, so the
  // match can't be made synchronously at mount).
  const pendingSnapRef = useRef<{ sig: string; listings: SerializedListingCard[]; page: number; totalCount: number; scrollY: number; ts: number; unlocked?: boolean; anchorId?: string | null; anchorTop?: number | null } | null>(null)
  const snapReadRef = useRef(false)
  const [subcategoryCounts, setSubcategoryCounts] = useState<Record<string, number>>({})
  const [categoryTotal, setCategoryTotal] = useState(0)
  const [debouncedQuery, setDebouncedQuery] = useState(query)

  const [showSuggestions, setShowSuggestions] = useState(false)
  // Recent searches + areas (localStorage), extracted. saveSearchToHistory is consumed by the
  // feed-sync / landing-search / visual-search paths below (all after this line).
  const { recentSearches, recentLocations, setRecentSearches, setRecentLocations, saveSearchToHistory } = useSearchHistory(activeProvince, activeWard)
  const [landingQuery, setLandingQuery] = useState('')
  // Below-the-fold curated rows render only AFTER first paint, so the landing
  // hydrates ~12 cards instead of ~84 — the ~70 extra cards were saturating the
  // mobile main thread and delaying the LCP image paint (3.1s render delay).

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

  const resetToLandingPage = useCallback(() => {
    setQuery('')
    setLandingQuery('')
    setActiveCategory('all')
    setActiveDistrict('all')
    setActiveSubcategory('all')
    setActiveBrand('all')
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
    setLooseMatch(false)
    setSort('newest')
    setCustomFilters({})
    setPriceRange('all')
    setShowExplorer(false)
    setFeedUnlocked(false) // re-gate the home feed (footer reachable again)
  }, [])

  // Clicking the header logo while already on the homepage resets the explorer back
  // to landing mode (a same-route <Link> can't reset this client state on its own).
  useEffect(() => {
    const onResetHome = () => {
      resetToLandingPage()
      setActiveProvince(null)
      setActiveWard(null)
      setNearby(null)
      setShowSuggestions(false)
      // Instant jump AFTER the landing layout re-renders (the feed unmounts → the
      // page shrinks): a smooth scroll from deep in the feed gets clamped by the
      // shrink and lands mid-page, so the logo "didn't go home". rAF + auto fixes it.
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'auto' }))
    }
    window.addEventListener('eno:reset-home', onResetHome)
    return () => window.removeEventListener('eno:reset-home', onResetHome)
  }, [resetToLandingPage])

  // Sync showExplorer with URL/parameters on mount or change
  useEffect(() => {
    if (
      activeCategory !== 'all' ||
      query.trim() !== '' ||
      activeDistrict !== 'all' ||
      activeSubcategory !== 'all' ||
      activeBrand !== 'all' ||
      activeModel !== 'all' ||
      listingType !== 'all' ||
      conditionFilter !== 'all' ||
      priceRange !== 'all' ||
      Object.keys(customFilters).length > 0
    ) {
      setShowExplorer(true)
    }
  }, [activeCategory, query, activeDistrict, activeSubcategory, activeBrand, activeModel, customFilters, listingType, conditionFilter, priceRange])

  // Listen to open-mobile-filters event from Header
  useEffect(() => {
    const handleOpenFilters = () => setIsMobileFilterOpen(true)
    window.addEventListener('open-mobile-filters', handleOpenFilters)
    return () => window.removeEventListener('open-mobile-filters', handleOpenFilters)
  }, [])

  // The last search term sent to analytics — so 'search' fires once per distinct
  // committed query, not again on every pagination/sort/filter refetch of the same term.
  const lastTrackedSearch = useRef<string | null>(null)



  // Match active categories for quick suggestion links in Landing Page
  // Instant matches for the hero search — server-backed (full catalog), shared
  // with the header search via the same hook + panel so both bars behave
  // identically (was a client-side filter over only the SSR-seeded listings).
  const heroSuggest = useSearchSuggest(landingQuery, showSuggestions)
  const heroSuggestItems = buildSuggestItems(landingQuery, heroSuggest.brands, heroSuggest.categories, heroSuggest.listings)
  // Arrow-key virtual focus for the hero typeahead — shared hook with the header bar
  // (state + clamps + query-edit reset; see use-search-box.ts).
  const { activeIdx: heroActiveIdx, moveDown: heroMoveDown, moveUp: heroMoveUp } = useSuggestKeyboardNav(landingQuery)

  // Trending searches for the empty-focus hero dropdown (shared hook/component with
  // the header). Fetched only while the panel is showing an empty query.
  const trending = useTrendingSearches(showSuggestions && landingQuery.trim().length < 2)

  // One pick handler for the hero dropdown (mouse + keyboard): the query row runs
  // the raw search; a brand opens its facets (dominant category resolves via the
  // brand-heal effect below); categories/listings navigate.
  const pickHeroSuggest = (it: SuggestItem) => {
    setShowSuggestions(false)
    if (it.type === 'query') { handleLandingSearch(landingQuery); return }
    if (it.type === 'brand') { setLandingQuery(''); applyResolved({ brand: it.slug }); return }
    if (it.type === 'category') { handleCategorySelect(it.slug); setLandingQuery(''); return }
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
    setShowExplorer(true)
    setShowSuggestions(false)
    setLooseMatch(false) // a typed search is strict (AND); only visual search is loose
    setActiveBrand('all')
    setActiveModel('all')
    setActiveSubcategory('all')
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
      if (d?.brand) { applyResolved(d); return }
    } catch {}
    if (r.category) {
      setActiveCategory(r.category)
      setActiveSubcategory('all')
      setActiveBrand('all')
      setActiveModel('all')
      setCustomFilters({})
      setPriceRange('all')
    }
    setLooseMatch(true)
    setQuery(q)
  }, [saveSearchToHistory, applyResolved])

  // Header ↔ explorer bridge (custom events, same pattern as 'open-mobile-filters').
  // The header's search box + area selector drive the explorer here, and we tell the
  // header whether the hero search pill is on this page so it can reveal its own
  // search once the hero scrolls out of view.
  // Re-apply a previously-used area from the suggestions quick-select.
  const applyRecentLocation = useCallback((loc: { province: Geo; ward: Geo | null }) => {
    setNearby(null)
    setActiveProvince(loc.province)
    setActiveWard(loc.ward)
    setShowExplorer(true)
    setShowSuggestions(false)
  }, [])

  useEffect(() => {
    const onSearch = (e: Event) => {
      const q = (e as CustomEvent<{ query?: string }>).detail?.query ?? ''
      handleLandingSearch(q)
      document.getElementById('listings')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    // Visual search applied from the header camera button (on the explorer page).
    const onVisual = (e: Event) => {
      const d = (e as CustomEvent<{ query: string; category?: string | null; brand?: string | null }>).detail
      if (d) applyVisualSearch(d)
      document.getElementById('listings')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    window.addEventListener('eno:visual-search', onVisual)
    // Area filter (district + "near you") applied from the header search bar.
    const onArea = (e: Event) => {
      const d = (e as CustomEvent<{ province?: Geo | null; ward?: Geo | null; nearby?: Nearby | null }>).detail
      setActiveProvince(d?.province ?? null)
      setActiveWard(d?.ward ?? null)
      setNearby(d?.nearby ?? null)
      setShowExplorer(true)
      document.getElementById('listings')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
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
        setShowExplorer(true)
        document.getElementById('listings')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    } catch { /* malformed stash — ignore */ }
    return () => {
      window.removeEventListener('eno:visual-search', onVisual)
      window.removeEventListener('eno:search', onSearch)
      window.removeEventListener('eno:set-area', onArea)
    }
  }, [handleLandingSearch, applyVisualSearch])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('eno:hero', { detail: { present: isLandingMode } }))
  }, [isLandingMode])

  // '/' and ⌘/Ctrl+K focus the search input (extracted).
  useSearchShortcuts(setShowSuggestions)

  const handleCategorySelect = (slug: string) => {
    setLooseMatch(false)
    setActiveCategory(slug)
    setActiveSubcategory('all')
    setActiveBrand('all')
    setActiveModel('all')
    setCustomFilters({})
    setPriceRange('all') // price brackets are category-specific
  }

  // Parse a query-string into the explorer's filter state. Shared by the mount/popstate
  // reader and the notification deep-link handler below.
  const applyParams = useCallback((params: URLSearchParams) => {
    setQuery(params.get('q') || '')
    setLooseMatch(params.get('match') === 'any') // visual search lands with ?match=any
    setActiveCategory(params.get('category') || 'all')
    setActiveDistrict(params.get('district') || 'all')
    setActiveSubcategory(params.get('subcategory') || 'all')
    setActiveBrand(params.get('brand') || 'all')
    setActiveModel(params.get('model') || 'all')
    setListingType(params.get('type') || 'all')
    setConditionFilter(params.get('condition') || 'all')
    // Sort is shareable/back-button state like any filter; unknown/absent → the
    // default relevance blend ('newest' — legacy param name, see SortKey).
    const sortParam = params.get('sort')
    setSort(sortParam === 'recent' || sortParam === 'price-low' || sortParam === 'price-high' || sortParam === 'popular' ? sortParam : 'newest')
    const pmin = params.get('priceMin'), pmax = params.get('priceMax')
    setPriceRange(pmin || pmax ? `${pmin || ''}-${pmax || ''}` : 'all')
    // Parse custom filters (attr_* + range_* → keyed back by facet key).
    setCustomFilters(parseFilterParams(params, params.get('category') || 'all', params.get('subcategory') || 'all'))
  }, [])

  // URL state synchronization: Read from URL on mount and on popstate
  useEffect(() => {
    const handleUrlChange = () => applyParams(new URLSearchParams(window.location.search))
    handleUrlChange() // Initial check
    window.addEventListener('popstate', handleUrlChange)
    return () => window.removeEventListener('popstate', handleUrlChange)
  }, [applyParams])

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
    applyParams(new URLSearchParams(qs))
    setShowExplorer(true)
    requestAnimationFrame(() => document.getElementById('listings')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
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

    if (listingType !== 'all') params.set('type', listingType)
    else params.delete('type')

    if (conditionFilter !== 'all') params.set('condition', conditionFilter)
    else params.delete('condition')

    // The default relevance blend stays out of the URL so plain links keep clean.
    if (sort !== 'newest') params.set('sort', sort)
    else params.delete('sort')

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

    // Preserve the existing history.state — replacing it with null would wipe the
    // `takeover: 'video'` flag the video-return mount check depends on.
    window.history.replaceState(window.history.state, '', newUrl)
    // replaceState bypasses Next's router, so the persistent header search bar won't
    // see the query change — broadcast it so the top bar stays in sync. When a search
    // resolved to a brand/model (no text query), show the brand label so the bar still
    // reflects what was searched (e.g. "Huawei MatePad 11").
    const brandLabel = activeBrand !== 'all'
      ? [prettyBrand(activeBrand), activeModel !== 'all' ? activeModel : null].filter(Boolean).join(' ')
      : ''
    window.dispatchEvent(new CustomEvent('eno:query', { detail: { query: query.trim() || brandLabel } }))
  }, [activeCategory, query, activeDistrict, activeSubcategory, activeBrand, activeModel, customFilters, listingType, conditionFilter, priceRange, sort, looseMatch])

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
  // fetch, no flip. Skips the back-nav restore (which intentionally rehydrates a deeper page).
  const filterSig = JSON.stringify([
    activeCategory, debouncedQuery, activeDistrict, conditionFilter, listingType, verifiedOnly,
    sort, activeSubcategory, activeBrand, activeModel, customFilters, priceRange, nearby,
    activeProvince?.code ?? null, activeWard?.code ?? null,
  ])
  const prevFilterSigRef = useRef(filterSig)
  if (prevFilterSigRef.current !== filterSig) {
    prevFilterSigRef.current = filterSig
    if (skipFirstPageResetRef.current) skipFirstPageResetRef.current = false
    else if (page !== 1) setPage(1)
  }

  // Fetch listings dynamically from API on parameter/page modifications using React Query SWR cache
  // The current filters as URL query params, WITHOUT paging — the single source of truth for
  // both the grid query below and the Video feed (which appends hasVideo + its own paging).
  const baseParamsString = useMemo(() => {
    const params = new URLSearchParams()
    if (activeBrand !== 'all') {
      params.set('brand', activeBrand)
      if (activeModel !== 'all') {
        params.set('model', activeModel)
        if (activeCategory !== 'all') params.set('category', activeCategory)
      } else if (activeCategory !== 'all') {
        params.set('priorityCategory', activeCategory)
      }
    } else {
      if (activeCategory !== 'all') params.set('category', activeCategory)
      if (activeSubcategory !== 'all') params.set('subcategory', activeSubcategory)
    }
    // Language in the CACHE KEY (audit P2): the response body varies on language for
    // non-en/vi viewers, but the edge caches by URL — a ru/ko variant could poison the
    // shared entry for everyone. en/vi (the vast majority) send nothing and share one
    // deterministic cached variant.
    if (lang !== 'en' && lang !== 'vi') params.set('lang', lang)
    if (!nearby && activeDistrict !== 'all') params.set('district', activeDistrict)
    if (!nearby && activeProvince) params.set('province', activeProvince.nameEn)
    if (!nearby && activeWard) params.set('ward', activeWard.nameEn)
    if (conditionFilter !== 'all') params.set('condition', conditionFilter)
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
  }, [activeBrand, activeModel, activeCategory, activeSubcategory, nearby, activeDistrict, activeProvince, activeWard, conditionFilter, listingType, debouncedQuery, looseMatch, sort, verifiedOnly, priceRange, customFilters, lang])

  const { data: listingsData, isLoading: queryLoading, isFetching: queryFetching, isError: queryError, refetch: refetchListings } = useQuery({
    queryKey: [
      'listings',
      {
        category: activeCategory,
        subcategory: activeSubcategory,
        brand: activeBrand,
        model: activeModel,
        district: activeDistrict,
        province: activeProvince?.code ?? null,
        ward: activeWard?.code ?? null,
        near: nearby ? 1 : 0,
        condition: conditionFilter,
        type: listingType,
        q: debouncedQuery,
        match: looseMatch ? 'any' : 'all',
        sort,
        verified: verifiedOnly ? 'true' : 'all',
        price: priceRange,
        page,
        customFilters,
      },
    ],
    queryFn: async () => {
      // Structural filters come from the shared memo; only paging is per-query here.
      // "Near you" ignores area filters and pulls a broad set to distance-filter client-side.
      const params = new URLSearchParams(baseParamsString)
      const limit = nearby ? 100 : 12
      const offset = (page - 1) * limit
      params.set('limit', String(limit))
      params.set('offset', String(offset))

      const res = await fetch(`/api/listings?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch listings')
      return res.json()
    },
    placeholderData: (previousData) => previousData,
    // Seed the DEFAULT view (page 1, no filters) with the server-rendered data so
    // React Query treats it as fresh (global staleTime 30s) and skips the
    // redundant /api/listings refetch on mount. Strictly gated — filtered/sorted
    // views get no seed and fetch normally. Must match the /api/listings shape.
    initialData:
      page === 1 && activeCategory === 'all' && activeSubcategory === 'all' &&
      activeBrand === 'all' && activeModel === 'all' &&
      activeDistrict === 'all' && conditionFilter === 'all' && priceRange === 'all' &&
      listingType === 'all' &&
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

  // Does the catalog have ANY video listings? Gates the ▷ Video view toggle — with zero
  // videos the takeover is a guaranteed dead end, so the tab stays hidden until at least
  // one exists. Site-wide (not filter-scoped) + long staleTime: one cheap query per session.
  // Perf Phase 1: this probe is display-only (shows the ▷ toggle) — keep it out of
  // the critical cold path; run it in the first post-load idle slot instead.
  const [videoProbeReady, setVideoProbeReady] = useState(false)
  useEffect(() => {
    const arm = () => setVideoProbeReady(true)
    if (typeof requestIdleCallback === 'function') { const id = requestIdleCallback(arm, { timeout: 10_000 }); return () => cancelIdleCallback(id) }
    const t = setTimeout(arm, 4000); return () => clearTimeout(t)
  }, [])
  const { data: videoAvail } = useQuery({
    queryKey: ['video-availability'],
    enabled: videoProbeReady,
    queryFn: async () => {
      const res = await fetch('/api/listings?hasVideo=1&limit=1')
      if (!res.ok) return { total: 0 }
      return res.json() as Promise<{ total: number }>
    },
    staleTime: 5 * 60_000,
  })
  const showVideoView = (videoAvail?.total ?? 0) > 0

  // Filter signature (no price/sort/pagination) for the price-histogram fetch, so
  // the slider's distribution reflects every OTHER active filter.
  const histogramQuery = useMemo(() => {
    const p = new URLSearchParams()
    p.set('histogram', '1')
    if (activeBrand !== 'all') {
      p.set('brand', activeBrand)
      if (activeModel !== 'all') {
        p.set('model', activeModel)
        if (activeCategory !== 'all') p.set('category', activeCategory)
      }
    } else {
      if (activeCategory !== 'all') p.set('category', activeCategory)
      if (activeSubcategory !== 'all') p.set('subcategory', activeSubcategory)
    }
    if (!nearby && activeDistrict !== 'all') p.set('district', activeDistrict)
    if (!nearby && activeProvince) p.set('province', activeProvince.nameEn)
    if (!nearby && activeWard) p.set('ward', activeWard.nameEn)
    if (conditionFilter !== 'all') p.set('condition', conditionFilter)
    if (listingType !== 'all') p.set('type', listingType)
    if (debouncedQuery.trim()) p.set('q', debouncedQuery.trim())
    applyFilterParams(p, customFilters, activeCategory, activeSubcategory)
    return p.toString()
  }, [activeCategory, activeSubcategory, activeBrand, activeModel, nearby, activeDistrict, activeProvince, activeWard, conditionFilter, listingType, debouncedQuery, customFilters])

  // Identity of the current feed (every filter that defines "this result set"), used
  // to key the back-nav snapshot so it only restores onto the exact same feed.
  const feedSig = useMemo(
    () => JSON.stringify([
      activeCategory, activeSubcategory, activeBrand, activeModel, activeDistrict,
      activeProvince?.code ?? null, activeWard?.code ?? null, nearby ? 1 : 0,
      conditionFilter, listingType, debouncedQuery, sort, verifiedOnly, priceRange, customFilters,
    ]),
    [activeCategory, activeSubcategory, activeBrand, activeModel, activeDistrict, activeProvince?.code, activeWard?.code, nearby, conditionFilter, listingType, debouncedQuery, sort, verifiedOnly, priceRange, customFilters],
  )

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
    }
    const snap = pendingSnapRef.current
    if (snap && snap.sig === feedSig) {
      pendingSnapRef.current = null
      skipFirstPageResetRef.current = true
      restoredScrollRef.current = {
        y: snap.scrollY,
        anchorId: typeof snap.anchorId === 'string' ? snap.anchorId : null,
        anchorTop: typeof snap.anchorTop === 'number' ? snap.anchorTop : 0,
      }
      setListings(snap.listings)
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
    }
  }, [feedSig])

  // Put the buyer back where they were, once the restored rows are actually IN THE DOM.
  // A single scrollTo in the commit that restored them is not enough: the grid renders off
  // a useDeferredValue copy (so the urgent commit can still be painting the SHORT list, and
  // scrollTo would clamp against a document that is not tall enough yet), and on the landing
  // feed the rails above the grid mount lazily. So retry across a bounded number of FRAMES —
  // frames, not milliseconds, because a backgrounded WebView pauses rAF and a time budget
  // would burn down while the app is in the background. Aligning the tapped CARD (rather than
  // an absolute offset) is what makes this correct when the content above the feed has a
  // different height than it did when we left. Any real user scroll input aborts it: we never
  // fight a finger.
  useLayoutEffect(() => {
    const target = restoredScrollRef.current
    // Already aligning — do NOT restart (or tear down) the loop just because more rows
    // arrived; the page-1 refetch swaps `listings` mid-restore and used to kill it.
    if (!target || restoreStopRef.current) return
    let frames = 0
    const stop = () => {
      cancelAnimationFrame(restoreRafRef.current)
      restoreRafRef.current = 0
      restoreStopRef.current = null
      restoredScrollRef.current = null
      window.removeEventListener('touchmove', stop)
      window.removeEventListener('wheel', stop)
      window.removeEventListener('keydown', stop)
    }
    restoreStopRef.current = stop
    // Is the document tall enough for the saved offset to land where it did before?
    const fits = () => document.documentElement.scrollHeight >= target.y + window.innerHeight
    const step = () => {
      const el = target.anchorId
        ? document.querySelector(`[data-feed-card="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(target.anchorId) : target.anchorId}"]`)
        : null
      if (el) {
        window.scrollBy(0, el.getBoundingClientRect().top - target.anchorTop)
        stop()
        return
      }
      if (!target.anchorId && fits()) { window.scrollTo(0, target.y); stop(); return }
      // ~40 frames ≈ 2/3s at 60Hz. If the tapped card never reappears (sold, moderated,
      // or reshuffled out of the refreshed page), fall back to the raw offset — but only
      // if the page is long enough for it, else a clamp would dump them at the bottom.
      if (frames++ < 40) { restoreRafRef.current = requestAnimationFrame(step); return }
      if (fits()) window.scrollTo(0, target.y)
      stop()
    }
    // touchMOVE, not touchstart: a bare tap (or the tail of the edge-swipe that brought us
    // here) must not silently cancel the restore — only an actual drag counts as "the user
    // is scrolling now".
    window.addEventListener('touchmove', stop, { passive: true })
    window.addEventListener('wheel', stop, { passive: true })
    window.addEventListener('keydown', stop)
    // First attempt runs SYNCHRONOUSLY, in the layout phase, so that when the rows are
    // already in the DOM the jump happens before the browser paints (no visible flash of
    // the top of the feed). step() schedules its own rAF retries when they are not.
    step()
  }, [listings])

  // Unmount is the only thing that cancels an in-flight restore from outside (the loop above
  // deliberately survives re-renders, so it can't return its own cleanup). useLayoutEffect,
  // NOT useEffect: a passive cleanup is flushed AFTER paint, so on a fast back-then-forward
  // the loop would get one more frame and scroll the DESTINATION route. Layout cleanups run
  // synchronously in the commit that removes the tree.
  useLayoutEffect(() => () => restoreStopRef.current?.(), [])

  // Synchronize state and trigger history caching when data changes
  useEffect(() => {
    if (listingsData) {
      // Page 1 (or any filter change, which resets page→1) replaces; later pages append
      // for the infinite feed. Dedupe by id so the placeholderData transition between
      // pages can't double-insert. seenIdsRef (kept in step here) measures "new rows this
      // page" outside the updater; only a deeper page with nothing new stops pagination.
      if (page === 1) {
        setListings((prev) => {
          // Mid-restore the snapshot already holds more rows than a fresh page 1 — keep it
          // (seenIdsRef/maxOffsetRef were set by the restore effect; don't reset them).
          if (restoredScrollRef.current != null && prev.length > listingsData.listings.length) return prev
          seenIdsRef.current = new Set(listingsData.listings.map((l: SerializedListingCard) => l.id))
          maxOffsetRef.current = 0
          return listingsData.listings
        })
        setReachedEnd(false) // a fresh feed (filter change / reload) — paging is open again
      } else if (listingsData.offset === (page - 1) * (nearby ? 100 : 12)) {
        // Real data for THIS page (not a placeholderData replay, whose offset lags a page).
        const fresh = listingsData.listings.filter((l: SerializedListingCard) => !seenIdsRef.current.has(l.id))
        if (fresh.length > 0) {
          fresh.forEach((l: SerializedListingCard) => seenIdsRef.current.add(l.id))
          maxOffsetRef.current = Math.max(maxOffsetRef.current, listingsData.offset)
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
  }, [listingsData, page, debouncedQuery, saveSearchToHistory, activeCategory])

  // Loading is DERIVED from the query — it was mirrored into state via an effect,
  // which lagged a render behind and added a redundant state/effect pair.
  const isLoading = queryLoading || (queryFetching && listings.length === 0)

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

  const prefetchNextPage = useCallback(() => {
    const nextPage = page + 1
    const maxPage = Math.ceil(totalCount / 24)
    if (nextPage > maxPage) return

    queryClient.prefetchQuery({
      // Key + params must mirror the live query (incl. price) or the prefetch
      // never matches and pagination refetches anyway.
      queryKey: [
        'listings',
        {
          category: activeCategory,
          subcategory: activeSubcategory,
          brand: activeBrand,
          model: activeModel,
          district: activeDistrict,
          province: activeProvince?.code ?? null,
          ward: activeWard?.code ?? null,
          near: nearby ? 1 : 0,
          condition: conditionFilter,
          type: listingType,
          q: debouncedQuery,
          sort,
          verified: verifiedOnly ? 'true' : 'all',
          price: priceRange,
          page: nextPage,
          customFilters,
        },
      ],
      queryFn: async () => {
        const params = new URLSearchParams()
        // Mirror the live query EXACTLY (brand/model scoping + applyFilterParams) so the
        // prefetched page matches the filtered results and populates the right cache key.
        if (activeBrand !== 'all') {
          params.set('brand', activeBrand)
          if (activeModel !== 'all') {
            params.set('model', activeModel)
            if (activeCategory !== 'all') params.set('category', activeCategory)
          } else if (activeCategory !== 'all') {
            params.set('priorityCategory', activeCategory)
          }
        } else {
          if (activeCategory !== 'all') params.set('category', activeCategory)
          if (activeSubcategory !== 'all') params.set('subcategory', activeSubcategory)
        }
        // Language in the CACHE KEY (audit P2): the response body varies on language for
    // non-en/vi viewers, but the edge caches by URL — a ru/ko variant could poison the
    // shared entry for everyone. en/vi (the vast majority) send nothing and share one
    // deterministic cached variant.
    if (lang !== 'en' && lang !== 'vi') params.set('lang', lang)
    if (!nearby && activeDistrict !== 'all') params.set('district', activeDistrict)
        if (!nearby && activeProvince) params.set('province', activeProvince.nameEn)
        if (!nearby && activeWard) params.set('ward', activeWard.nameEn)
        if (conditionFilter !== 'all') params.set('condition', conditionFilter)
        if (listingType !== 'all') params.set('type', listingType)
        if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim())
        params.set('sort', sort)
        params.set('verified', verifiedOnly ? 'true' : 'all')
        if (priceRange !== 'all') {
          const [mn, mx] = priceRange.split('-')
          if (mn) params.set('priceMin', mn)
          if (mx) params.set('priceMax', mx)
        }

        applyFilterParams(params, customFilters, activeCategory, activeSubcategory)

        const limit = 12
        const offset = (nextPage - 1) * limit
        params.set('limit', String(limit))
        params.set('offset', String(offset))

        const res = await fetch(`/api/listings?${params.toString()}`)
        if (!res.ok) throw new Error('Failed to fetch listings')
        return res.json()
      },
      staleTime: 60 * 1000,
    })
  }, [
    page,
    totalCount,
    activeCategory,
    activeSubcategory,
    activeBrand,
    activeModel,
    activeDistrict,
    activeProvince,
    activeWard,
    nearby,
    conditionFilter,
    listingType,
    debouncedQuery,
    sort,
    verifiedOnly,
    priceRange,
    customFilters,
    queryClient,
  ])

  // Infinite feed (FB-style): an off-screen sentinel below the list bumps the page
  // as it nears the viewport. Disabled for "near you" (single broad client-filtered
  // fetch) — there's nothing more to page through.
  // Home feed: don't auto-infinite-scroll until the user opts in. They see the first
  // page + can reach the footer; a "Load more" button then unlocks infinite scroll.
  const [feedUnlocked, setFeedUnlocked] = useState(false)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  // Map view's result list scrolls inside its own column on desktop, so the
  // infinite-scroll sentinel must live INSIDE that column and observe it as the
  // root — otherwise a window-level sentinel sits permanently in view (appending
  // rows never moves it) and fires page after page (the "jerky, again and again").
  const mapListRef = useRef<HTMLDivElement | null>(null)
  // Map viewport centre (moveend) — anchors the nearest-first list sort.
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null)
  // Map-view list ranking (user decision 2026-07-14): nearest first with the
  // seller's trust score carrying HALF the weight — a close low-trust listing
  // shouldn't outrank a slightly-farther Trusted seller. Proximity is normalized
  // across the visible set; trust against the ladder's practical 160 ceiling.
  const mapSortedListings = useMemo(() => {
    const anchor = nearby ? { lat: nearby.lat, lng: nearby.lng } : mapCenter
    if (!anchor) return shownListings
    // (plain record — `Map` is shadowed by the lucide icon import in this file)
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
  const hasMore = !nearby && !reachedEnd && listings.length < totalCount
  useEffect(() => {
    if (!hasMore) return
    if (isLandingMode && !feedUnlocked) return // home feed: gated behind the "Load more" button
    const isMap = viewMode === 'map'
    // Desktop map view → the left column is the scroll container (Tailwind lg = 1024px).
    const columnScroll = isMap && typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
    const el = isMap ? mapSentinelRef.current : loadMoreRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !queryFetching) {
          prefetchNextPage() // warm page+1 so the swap is instant
          setPage((p) => p + 1)
        }
      },
      { root: columnScroll ? mapListRef.current : null, rootMargin: isMap ? '300px 0px' : '600px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, queryFetching, prefetchNextPage, viewMode, isLandingMode, feedUnlocked])

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
          // The home feed's infinite scroll is opt-in; restoring depth without the unlock
          // would strand the buyer behind a "Load more" they already pressed.
          unlocked: feedUnlocked,
          anchorId: l.id,
          anchorTop: card ? card.getBoundingClientRect().top : null,
        }))
      }
    } catch { /* ignore quota/serialization */ }
    router.push(`/listings/${l.id}`)
  }, [listings, page, totalCount, feedSig, feedUnlocked, router])
  // Warm the listing page before the click (hover on desktop, touchstart on mobile)
  // so it opens instantly instead of SSR-ing on click. De-duped by Next's prefetch cache.
  const prefetchListing = useCallback((id: string) => { router.prefetch(`/listings/${id}`) }, [router])

  // "Locate on map" from any card/row → switch to the map view focused on this
  // listing (the map flies to + opens its pin). Scrolls the feed into view so the
  // map is visible after the mode switch.
  const locateOnMap = useCallback((id: string) => {
    setViewMode('map')
    setShowExplorer(true)
    setHoveredId(id)
    setFocusId(id)
    // Land ON the map (under the sticky header) — NOT at the top of the rails. The
    // map mounts on this same render; wait two frames for the commit, then scroll the
    // map element itself (its scroll-mt clears the header).
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        (mapWrapRef.current ?? document.getElementById('listings'))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }),
    )
  }, [])
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
    document.getElementById('listings')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // Save the current filter set → the buyer gets alerted (in-app + push) on new matches. (extracted)
  const saveSearch = useSaveSearch({
    activeCategory, activeSubcategory, activeBrand, activeModel, listingType,
    debouncedQuery, activeDistrict, conditionFilter, priceRange, customFilters,
  })

  // Distinct from the empty state: a failed fetch (DB down, 500) must NOT read as
  // "no listings" — show an error + retry so the marketplace never looks empty.
  // Hoisted ABOVE the isLandingMode early return on purpose: both the landing feed and
  // the explorer feed call it, and a const arrow declared after that return would be in
  // its TDZ (ReferenceError) when the landing branch renders.
  const renderErrorState = (className?: string) => (
    <EmptyState
      icon={AlertTriangle}
      title={tr("Couldn't load listings.", 'Không tải được tin đăng.')}
      className={className}
      action={
        <Button variant="cta" size="none"
          onClick={() => refetchListings()}
          className="rounded-xl px-4 py-2 text-xs transition-colors cursor-pointer"
        >
          {tr('Try again', 'Thử lại')}
        </Button>
      }
    />
  )

  if (isLandingMode) {
    // Never open an empty dropdown: with a typed query it's the typeahead; when empty
    // it needs recents/locations or the Popular fallback (categories, already
    // client-side). With nothing to show the pill stays a plain pill.
    const heroPanelOpen = showSuggestions && (
      landingQuery.trim().length >= 2 || recentSearches.length > 0 || recentLocations.length > 0 || categories.length > 0 || trending.length > 0
    )
    // The subset of `heroPanelOpen` where the panel is actually the typeahead LISTBOX
    // (≥2 chars) rather than the recents/locations/Popular panel. This — not
    // heroPanelOpen — is what the input's aria-expanded/-controls may claim: the other
    // panel is a set of plain buttons and has no listbox to point at.
    // Mirrors the `landingQuery.trim().length >= 2` branch that renders <SearchSuggest/>.
    const heroListOpen = showSuggestions && landingQuery.trim().length >= 2
    // Virtual focus announcement for the input (shared derivation — see
    // activeSuggestOptionId in use-search-box.ts for the a11y contract).
    const heroActiveOptionId = activeSuggestOptionId(SUGGEST_ID, heroListOpen, heroActiveIdx, heroSuggestItems.length)
    // overflow-hidden guards against horizontal spill on narrow screens; lifted on desktop (pc:) so
    // the rails' / category-grid ← / → gutter arrows aren't clipped at the content edge.
    return (
      <section ref={listingsRef} id="listings" className="scroll-mt-20 relative overflow-hidden pc:overflow-visible pt-2 pb-5 sm:pt-3 sm:pb-8">
        {/* Width + edge gutter are owned by the parent page <main> (canonical
            max-w-7xl px-3 sm:px-6 lg:px-8) so the feed lines up with Header/Footer. */}
        <div className="relative w-full space-y-8 sm:space-y-12">

          {/* HERO SEARCH AREA */}
          <div className="relative pb-2 text-center">
            {/* ⚠️ THIS HEADING IS VISIBLE ON PURPOSE, AND IT MUST STAY THAT WAY.
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
            {/* The brand mark IS the heading — the plain-text "eno.vn" + paragraph that sat here
                read as boilerplate (owner: "remove these ugly ducklings and use eno.vn wordmark").
                The <h1> keeps its exact SEO string for crawlers and screen readers via sr-only;
                what a human sees is the wordmark. */}
            <h1 className="mb-3 flex justify-center">
              <span className="sr-only">{SITE_NAME}</span>
              {/* eslint-disable-next-line @next/next/no-img-element -- an SVG wordmark: next/image
                  would add a request and a layout wrapper for a file that is already ~2KB and is
                  preloaded on this route (see the preload note in src/app/layout.tsx). */}
              <img src="/logo.svg" alt={SITE_NAME} width={219} height={80} className="h-11 w-auto sm:h-14" />
            </h1>
            {/* ⚠️ ONE LINE, BUT IT MUST STAY. Google's OAuth brand review rejected this page with
                "Your home page does not explain the purpose of your app" until a purpose statement
                existed; that complaint cleared the moment one did. The long paragraph was the ugly
                part, not the fact of saying what the site is — so this is the short form, and
                deleting it entirely re-opens a rejection that took several rounds to close. */}
            <p className="mx-auto mb-6 max-w-xl text-sm leading-relaxed text-body sm:text-base">
              {/* ⚠️ A PLAIN STRING LITERAL, NOT A TEMPLATE LITERAL. scripts/gen-ui-strings.mjs
                  harvests `text="…"` and does not match a backtick expression, so the template
                  form compiles and renders but never reaches the catalogue — it would ship
                  English-only to every other language and drift silently. */}
              <Tr text="The trusted marketplace for internationals in Vietnam — housing, motorbikes, jobs and local services, from sellers with public trust scores." />
            </p>

            {/* Centered Search Bar (the header reveals its own search once this
                scrolls out of view — id is the IntersectionObserver target). Wider pill
                (max-w-3xl) — owner asked for a longer bar. */}
            <div id="eno-hero-search" className="relative max-w-3xl w-full mx-auto select-none">
              {/* One cohesive search pill that morphs into a seamless suggestions
                  panel on focus (Google-style): flat bottom + shared shadow/border. */}
              <div className={cn(
                // bg-popover (not bg-card): when open the pill floats (shadow-pop) and must lift
                // off the canvas in dark mode; the closed state overrides to bg-tint below.
                'flex items-center bg-popover transition-all duration-200',
                heroPanelOpen
                  ? 'rounded-t-2xl shadow-pop'
                  : 'rounded-2xl bg-tint focus-within:ring-2 focus-within:ring-ring/30',
              )}>
                {/* No leading filter icon here — ambiguous on the hero; the results
                    view keeps its Filter chip in the facet bar. */}
                <Button
                  variant="bare"
                  size="none"
                  onClick={() => handleLandingSearch(landingQuery)}
                  aria-label={tr('Search', 'Tìm kiếm')}
                  className="flex shrink-0 items-center justify-center rounded-l-2xl pl-4 pr-2.5 py-2.5 sm:pl-5 sm:py-3 text-ink-4 hover:text-accent-foreground hover:scale-110 active:scale-100 transition-[color,transform] duration-200 cursor-pointer"
                >
                  <Search className="h-6 w-6 sm:h-7 sm:w-7" strokeWidth={2.25} />
                </Button>
                <Input
                  variant="unstyled"
                  id="listings-search-input"
                  aria-label={tr('Search listings', 'Tìm kiếm tin đăng')}
                  // Combobox semantics for the arrow-key typeahead below. See
                  // `heroListOpen` above for why these track it and not heroPanelOpen.
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={heroListOpen}
                  aria-controls={heroListOpen ? SUGGEST_ID : undefined}
                  aria-activedescendant={heroActiveOptionId}
                  type="search"
                  inputMode="search"
                  enterKeyHint="search"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={landingQuery}
                  onChange={(e) => setLandingQuery(e.target.value)}
                  onFocus={() => setShowSuggestions(true)}
                  onPaste={(e) => visualSearchFromPaste(e, tr, (r) => { setLandingQuery(r.query); applyVisualSearch(r) })}
                  onKeyDown={(e) => {
                    if (showSuggestions && landingQuery.trim().length >= 2 && heroSuggestItems.length) {
                      if (e.key === 'ArrowDown') { e.preventDefault(); heroMoveDown(heroSuggestItems.length); return }
                      if (e.key === 'ArrowUp') { e.preventDefault(); heroMoveUp(); return }
                      if (e.key === 'Enter' && heroActiveIdx >= 0) {
                        e.preventDefault()
                        pickHeroSuggest(heroSuggestItems[heroActiveIdx])
                        return
                      }
                    }
                    // No arrow-key selection → the RAW free-text search (the 'Search
                    // for "{q}"' row), never an auto-picked suggestion.
                    if (e.key === 'Enter') handleLandingSearch(landingQuery)
                  }}
                  placeholder={tr('Search motorbikes, apartments, moving sales...', 'Tìm xe máy, căn hộ, đồ thanh lý...')}
                  className="min-w-0 flex-1 bg-transparent py-3 pr-3 text-base font-medium text-foreground outline-none placeholder:text-ink-4 placeholder:font-medium"
                />
                {/* Button, NOT IconButton: a baked 44px tap target would overrun the
                    adjacent AI button in this bar. */}
                {landingQuery && (
                  <Button
                    variant="bare"
                    size="none"
                    type="button"
                    onClick={() => setLandingQuery('')}
                    aria-label={tr('Clear', 'Xóa')}
                    className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-4 transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-5 w-5" />
                  </Button>
                )}
                {/* AI concierge — pressable, left of the camera (consistent with the navbar bar). */}
                <AISearchButton
                  active={false}
                  onClick={() => { router.push('/messages/ai'); setShowSuggestions(false) }}
                  className="px-2.5 py-3"
                  iconClassName="h-6 w-6 sm:h-7 sm:w-7"
                />
                {/* Photo search folded into the AI assistant (camera in the ✨ chat
                    composer); pasting an image here still visual-searches. */}
                <Separator orientation="vertical" className="h-6 shrink-0 sm:h-7" />
                {/* Search-bar icon standard (matches the magnifier + AI button):
                    quiet ink at rest, brand-blue on hover. */}
                <Button
                  variant="bare"
                  size="none"
                  onClick={() => { setViewMode('map'); setShowExplorer(true) }}
                  aria-label={tr('Map', 'Bản đồ')}
                  title={tr('Map', 'Bản đồ')}
                  className="flex shrink-0 items-center justify-center rounded-r-2xl pl-3.5 pr-4 py-3 text-ink-4 hover:text-accent-foreground hover:scale-110 active:scale-100 transition-[color,transform] duration-200 cursor-pointer"
                >
                  <Map className="h-6 w-6 sm:h-7 sm:w-7" strokeWidth={2.25} />
                </Button>
              </div>

              {/* Suggestions Overlay in Landing Page */}
              {heroPanelOpen && (
                <>
                  <div aria-hidden className="fixed inset-0 z-40 cursor-default" onClick={() => setShowSuggestions(false)} /> {/* design-lint-allow */}
                  <div className="absolute top-full left-0 right-0 -mt-px z-50 rounded-b-2xl bg-popover p-4 shadow-pop text-left max-h-[440px] overflow-y-auto scroll-thin space-y-4 animate-in fade-in slide-in-from-top-1 duration-100">
                    {landingQuery.trim().length >= 2 ? (
                      <SearchSuggest
                        items={heroSuggestItems}
                        loading={heroSuggest.loading}
                        query={landingQuery}
                        activeIndex={heroActiveIdx}
                        listboxId={SUGGEST_ID}
                        onPick={pickHeroSuggest}
                        onSubmitQuery={() => handleLandingSearch(landingQuery)}
                      />
                    ) : (
                      <>
                        {/* Recent searches */}
                        {recentSearches.length > 0 && (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="eyebrow flex items-center gap-1 text-body"><Clock className="h-3 w-3" />{tr('Recent', 'Tìm gần đây')}</span>
                              <Button
                                variant="bare"
                                size="none"
                                onClick={(e) => { e.stopPropagation(); localStorage.removeItem(RECENT_SEARCHES_KEY); setRecentSearches([]) }}
                                className="text-2xs font-semibold text-body hover:text-destructive cursor-pointer"
                              >
                                {tr('Clear', 'Xóa')}
                              </Button>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {recentSearches.map((term, i) => (
                                <Button
                                  key={i}
                                  variant="bare"
                                  size="none"
                                  onClick={() => { setLandingQuery(term); handleLandingSearch(term) }}
                                  className="whitespace-normal text-left rounded-xl px-3.5 py-2 text-sm font-semibold text-body hover:bg-muted hover:text-accent-foreground transition-colors cursor-pointer"
                                >
                                  {term}
                                </Button>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Recent locations — the user's previously-searched areas */}
                        {recentLocations.length > 0 && (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="eyebrow flex items-center gap-1 text-body"><MapPin className="h-3 w-3" />{tr('Recent locations', 'Khu vực gần đây')}</span>
                              <Button
                                variant="bare"
                                size="none"
                                onClick={(e) => { e.stopPropagation(); localStorage.removeItem(RECENT_LOCATIONS_KEY); setRecentLocations([]) }}
                                className="text-2xs font-semibold text-body hover:text-destructive cursor-pointer"
                              >
                                {tr('Clear', 'Xóa')}
                              </Button>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {recentLocations.map((loc, i) => (
                                <Button
                                  key={i}
                                  variant="bare"
                                  size="none"
                                  onClick={() => applyRecentLocation(loc)}
                                  className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold text-body hover:bg-muted hover:text-accent-foreground transition-colors cursor-pointer"
                                >
                                  <MapPin className="h-3.5 w-3.5" />
                                  {loc.ward ? (lang === 'vi' ? loc.ward.name : loc.ward.nameEn) : (lang === 'vi' ? loc.province.name : loc.province.nameEn)}
                                </Button>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Trending searches — hottest committed queries site-wide,
                            between the user's own history and the Popular category
                            fallback; hidden when unavailable. */}
                        <TrendingSearches
                          items={trending}
                          variant="hero"
                          onPick={(term) => { setLandingQuery(term); handleLandingSearch(term) }}
                        />
                        {/* Popular — seeds a first-visit dropdown (no recents yet) from
                            the demand-ordered categories already on the client; never
                            an empty white slab, never an extra fetch. */}
                        {recentSearches.length === 0 && categories.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="eyebrow flex items-center gap-1 text-body"><TrendingUp className="h-3 w-3" />{tr('Popular', 'Phổ biến')}</span>
                            <div className="flex flex-wrap gap-1.5">
                              {categories.slice(0, 8).map((c) => (
                                <Button
                                  key={c.slug}
                                  variant="bare"
                                  size="none"
                                  onClick={() => { setShowSuggestions(false); handleCategorySelect(c.slug) }}
                                  className="rounded-xl px-3.5 py-2 text-sm font-semibold text-body hover:bg-muted hover:text-accent-foreground transition-colors cursor-pointer"
                                >
                                  <Tr text={lang === 'vi' ? c.nameVi : c.name} />
                                </Button>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* FINN-STYLE CATEGORY GRID */}
          <div className="space-y-4">
            {/* Two fixed rows — big tiles. mx-auto + w-fit + max-w-full centers the row
                when it fits and scrolls it from the start (no cut-off) when it doesn't.
                Free & Wanted are intent tiles at the end. The relative wrapper hosts the
                desktop ← / → arrows (only appear once the row overflows). */}
            <div className="relative">
            <div ref={catScrollerRef} className="mx-auto grid w-fit max-w-full grid-rows-2 grid-flow-col auto-cols-[7rem] sm:auto-cols-[9rem] gap-x-4 gap-y-6 sm:gap-x-6 sm:gap-y-8 overflow-x-auto scrollbar-none snap-x px-3">
              {/* ⚠️ eno's OWN TWO PRODUCTS, PINNED AHEAD OF THE DEMAND ORDER. Measured 2026-07-28:
                  `/` took 570 page views in a week and `/vietnam-evisa` took ZERO. They were never
                  unreachable — this grid is demand-ordered and `services` already sat SECOND — they
                  were just unnamed, because nobody scanning tiles reads "Services" as "Vietnam
                  e-Visa", and the trip planner had no tile at all.

                  ⚠️ THIS IS A MERCHANDISING BET AND IT IS ONE ARRAY MOVE TO UNDO. Two of roughly six
                  above-the-fold tile slots now belong to eno rather than to third-party supply, which
                  pushes Electronics (the largest real category, 8 of 32 listings) to column 2. To
                  reverse: move this block AFTER {categories.map(...)} and the tiles fall to the end
                  of the scroller; delete it and the grid is exactly today's order.

                  Byte-identical to the INTENT_SHORTCUTS tile below on purpose — same Button, same
                  CategoryIcon sizing, same label span. Only the onClick differs. It is a <Button>
                  rather than <Button asChild><Link>, like every other tile here: asChild
                  CONCATENATES the child's className without tailwind-merge, so the Button base
                  `inline-flex` would beat a child `flex flex-col` and the base
                  `[&_svg:not([class*='size-'])]:size-4` would shrink the 44px icon. Crawlability for
                  these two destinations is bought in the footer instead, where they are real
                  anchors. */}
              {DESK_SHORTCUTS.map((s) => (
                <Button
                  variant="bare"
                  size="none"
                  key={s.key}
                  onClick={() => { if (s.kind === 'filter') applyUrl(s.href); else router.push(s.href) }}
                  // ⚠️ snap-start, unlike the INTENT_SHORTCUTS tile this is otherwise copied from.
                  // That one sits at the TAIL of the scroller where it is never the snap target;
                  // these are the FIRST two columns, so without it `snap-x` has nothing to catch at
                  // the very start of the scroll and the pinned tiles drift under a swipe. The
                  // category tiles below carry it for the same reason. Caught by a reviewer.
                  className="group flex snap-start flex-col items-center justify-center gap-2 whitespace-normal p-2 text-center cursor-pointer"
                >
                  <CategoryIcon
                    name={s.icon}
                    className="h-11 w-11 sm:h-12 sm:w-12 text-body transition-all duration-200 group-hover:scale-110 group-hover:text-brand"
                  />
                  <span className="text-sm sm:text-base font-bold text-foreground leading-tight transition-colors group-hover:text-brand">
                    <Tr text={lang === 'vi' ? s.nameVi : s.name} />
                  </span>
                </Button>
              ))}
              {categories.map((cat) => {
                const cc = CATEGORY_COLOR_CLASSES[cat.color] ?? CATEGORY_COLOR_CLASSES.brand
                const hex = cc.text.match(/#[0-9a-fA-F]{6}/)?.[0] ?? 'var(--brand)'
                return (
                  <Button
                    variant="bare"
                    size="none"
                    key={cat.id}
                    onClick={() => handleCategorySelect(cat.slug)}
                    style={{ '--cat': hex } as CSSProperties}
                    className="group flex snap-start flex-col items-center justify-center gap-2 whitespace-normal p-2 text-center cursor-pointer transition-transform duration-100 active:scale-95"
                  >
                    <CategoryIcon
                      name={cat.icon}
                      className="h-11 w-11 sm:h-12 sm:w-12 text-body transition-all duration-200 group-hover:scale-110 group-hover:text-[var(--cat)]"
                    />
                    <span className="text-sm sm:text-base font-bold text-foreground leading-tight transition-colors group-hover:text-[var(--cat)]">
                      <Tr text={lang === 'vi' ? cat.nameVi : cat.name} />
                    </span>
                    {/* Social proof cuts both ways: a small count reads as a dead
                        category, so show it only once it's actually impressive. */}
                    {(cat.verifiedCount || 0) >= 20 && (
                      <span className="text-2xs sm:text-xs text-body select-none font-semibold">
                        {cat.verifiedCount} {tr('listings', 'tin')}
                      </span>
                    )}
                  </Button>
                )
              })}
              {/* Free & Wanted — intent tiles (filter across all categories) */}
              {INTENT_SHORTCUTS.map((s) => (
                <Button
                  variant="bare"
                  size="none"
                  key={s.type}
                  onClick={() => browseIntent(s.type)}
                  className="group flex flex-col items-center justify-center gap-2 whitespace-normal p-2 text-center cursor-pointer"
                >
                  <CategoryIcon
                    name={s.icon}
                    className="h-11 w-11 sm:h-12 sm:w-12 text-body transition-all duration-200 group-hover:scale-110 group-hover:text-brand"
                  />
                  <span className="text-sm sm:text-base font-bold text-foreground leading-tight transition-colors group-hover:text-brand">
                    <Tr text={lang === 'vi' ? s.nameVi : s.name} />
                  </span>
                </Button>
              ))}
            </div>
            <ScrollArrows canLeft={catCanLeft} canRight={catCanRight} page={catPage} tight />
            </div>
          </div>

          {/* Recently viewed — the returning buyer's own trail, up top so they can
              jump straight back to an item. Self-hides for new visitors. */}
          <RecentlyViewedRail />

          {/* For You — horizontal rail between the category grid and the vertical feed
              (search → categories → horizontal For You → vertical). Self-hides once a
              filter/search is active. */}
          <ForYouRail initial={initialTrending} />

          {/* Outstanding businesses — second horizontal rail: the highest-trust business
              storefronts (only on the home landing view). */}
          <BusinessRail initial={initialBusinesses} />

          {/* Browse by category — one horizontal rail per category, most-used first.
              Tapping a heading / "See all" opens that category (same as the grid). */}
          <DeferredCategoryRails categories={categories} onCategory={handleCategorySelect} />

          {/* Section heading for the feed — keeps the document outline sequential
              (h1 → h2 → card h3s); visually hidden. */}
          <h2 className="sr-only">{tr('Latest listings', 'Tin đăng mới nhất')}</h2>

          {/* INFINITE FEED (Facebook-style) — all listings, loads more on scroll. */}
          {shownListings.length === 0 && !isLoading ? (
            queryError ? (
              renderErrorState('gap-3 bg-card/60 py-16')
            ) : (
              // Zero results is a fork, not a dead end: widen the area (only when an
              // area filter is narrowing — never true in landing mode by construction,
              // gated so the block stays correct if landing ever allows area filters),
              // turn the search into an alert, or flip the intent and post a Wanted.
              <EmptyState
                className="bg-card/60"
                title={
                  <>
                    <Mascot name="search" className="mx-auto mb-3 h-32 w-32" />
                    <span className="block">{tr('No listings found.', 'Không có tin đăng nào.')}</span>
                  </>
                }
                action={
                  <div className="flex w-full max-w-xs flex-col items-stretch gap-2">
                    {(nearby !== null || activeWard !== null || activeProvince !== null || activeDistrict !== 'all') && (
                      <Button
                        variant="cta"
                        size="none"
                        // Same clears as the area chip in getActiveChips — one tap
                        // instead of hunting for the chip's ✕.
                        onClick={() => { setNearby(null); setActiveWard(null); setActiveProvince(null); setActiveDistrict('all') }}
                        className="rounded-xl px-4 py-2.5 text-sm transition-colors cursor-pointer"
                      >
                        {tr('Widen the area', 'Mở rộng khu vực tìm kiếm')}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="none"
                      onClick={saveSearch}
                      className="rounded-xl px-4 py-2.5 text-sm font-semibold cursor-pointer"
                    >
                      {tr('Create an alert for this search', 'Tạo thông báo cho tìm kiếm này')}
                    </Button>
                    <Button asChild variant="outline" size="none" className="rounded-xl px-4 py-2.5 text-sm font-semibold">
                      <Link href="/post">
                        {tr('Post a Wanted — let sellers come to you', 'Đăng tin cần tìm — để người bán tìm đến bạn')}
                      </Link>
                    </Button>
                  </div>
                }
              />
            )
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {deferredListings.map((l, index) => (
                  <Fragment key={l.id}>
                    {/* Guest capture (5a #7): one signup card at the point of interest,
                        after the 8th listing. Renders null once signed in. */}
                    {index === 8 && <CaptureCard />}
                    {/* data-feed-card = the back-nav restore ANCHOR. The return-to-feed
                        effect realigns this exact element, which is what makes "put me
                        back where I was" survive a page whose height changed while we
                        were away (the landing rails above the grid mount lazily). */}
                    <div
                      data-feed-card={l.id}
                      className="flex flex-col h-full"
                      onMouseEnter={() => prefetchListing(l.id)}
                      onTouchStart={() => prefetchListing(l.id)}
                    >
                      <ListingCard listing={l} onOpen={handleOpen} priority={index === 0} lcp={index === 0} onLocate={locateListing} />
                    </div>
                  </Fragment>
                ))}
              </div>
              {/* Home feed: a "Load more" button instead of auto-infinite, so the footer
                  is reachable. Clicking it loads the next page AND unlocks infinite
                  scroll (the sentinel below takes over from there). */}
              {!nearby && (
                <div ref={loadMoreRef} className="mt-6 select-none">
                  {hasMore && !feedUnlocked && !queryFetching && (
                    <div className="flex justify-center border-t border-border pt-6">
                      <Button
                        variant="bare"
                        size="none"
                        onClick={() => { prefetchNextPage(); setPage((p) => p + 1); setFeedUnlocked(true) }}
                        className="rounded-xl border border-line-strong px-6 py-2.5 text-sm font-bold text-foreground transition-colors hover:bg-muted cursor-pointer"
                      >
                        {tr('Load more', 'Xem thêm')}
                      </Button>
                    </div>
                  )}
                  {queryFetching && hasMore && (
                    <div className="flex items-center justify-center gap-2 border-t border-border pt-5 text-xs font-semibold text-muted-foreground">
                      <Spinner size="sm" className="border-border border-t-brand" />
                      {tr('Loading more…', 'Đang tải thêm…')}
                    </div>
                  )}
                  {!hasMore && totalCount > 24 && (
                    <p className="border-t border-border pt-5 text-center text-xs font-semibold text-ink-4">{tr("You've reached the end", 'Bạn đã xem hết')}</p>
                  )}
                </div>
              )}
            </>
          )}

        </div>
      </section>
    )
  }

  // Active applied-filter chips — shared by the persistent results bar AND the
  // empty state so the two never drift. Brand+model collapse into one chip.
  const getActiveChips = (): { label: string; onClear: () => void }[] => {
    const chips: { label: string; onClear: () => void }[] = []
    if (debouncedQuery.trim()) chips.push({ label: `"${debouncedQuery.trim()}"`, onClear: () => setQuery('') })
    if (activeSubcategory !== 'all') {
      const sub = SUBCATEGORIES[activeCategory]?.find((s) => s.slug === activeSubcategory)
      chips.push({ label: sub ? (lang === 'vi' ? sub.nameVi : sub.name) : activeSubcategory, onClear: () => setActiveSubcategory('all') })
    }
    if (activeBrand !== 'all') {
      chips.push({ label: activeModel !== 'all' ? `${prettyBrand(activeBrand)} · ${activeModel}` : prettyBrand(activeBrand), onClear: () => { setActiveBrand('all'); setActiveModel('all') } })
    } else if (activeModel !== 'all') {
      chips.push({ label: activeModel, onClear: () => setActiveModel('all') })
    }
    if (activeDistrict !== 'all') {
      const d = DISTRICTS.find((x) => x.slug === activeDistrict)
      chips.push({ label: d ? (lang === 'vi' ? d.name : d.nameEn) : activeDistrict, onClear: () => setActiveDistrict('all') })
    }
    // Area / location (new province→ward model + "near you" radius) — so the saved
    // search + alert clearly include where the user is looking.
    if (nearby) {
      chips.push({ label: tr(`Within ${nearby.radiusKm} km`, `Trong ${nearby.radiusKm} km`), onClear: () => { setNearby(null); setActiveProvince(null); setActiveWard(null) } })
    } else if (activeWard) {
      chips.push({ label: lang === 'vi' ? activeWard.name : activeWard.nameEn, onClear: () => setActiveWard(null) })
    } else if (activeProvince) {
      chips.push({ label: lang === 'vi' ? activeProvince.name : activeProvince.nameEn, onClear: () => { setActiveProvince(null); setActiveWard(null) } })
    }
    if (priceRange !== 'all') chips.push({ label: tr('Price range', 'Khoảng giá'), onClear: () => setPriceRange('all') })
    if (conditionFilter !== 'all') chips.push({ label: conditionFilter === 'new' ? tr('New', 'Mới') : tr('Used', 'Đã dùng'), onClear: () => setConditionFilter('all') })
    if (listingType !== 'all') {
      const lt = LISTING_TYPES.find((t) => t.value === listingType)
      chips.push({ label: lt ? (lang === 'vi' ? lt.labelVi : lt.label) : listingType, onClear: () => setListingType('all') })
    }
    Object.entries(customFilters).forEach(([k, v]) =>
      chips.push({ label: `${k}: ${v}`, onClear: () => setCustomFilters((prev) => { const n = { ...prev }; delete n[k]; return n }) }),
    )
    return chips
  }

  const clearAllFilters = () => {
    setQuery('')
    setActiveSubcategory('all')
    setActiveBrand('all')
    setActiveModel('all')
    setActiveDistrict('all')
    setActiveProvince(null)
    setActiveWard(null)
    setNearby(null)
    setPriceRange('all')
    setConditionFilter('all')
    setListingType('all')
    setCustomFilters({})
    setVerifiedOnly(true)
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
        {chips.length > 1 && (
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
          <Button onClick={saveSearch} variant="cta" size="none" className="shrink-0 gap-1.5 px-3.5 py-1.5 text-xs shadow-sm active:scale-95 cursor-pointer">
            <Bookmark className="size-4" /> {tr('Save search', 'Lưu tìm kiếm')}
          </Button>
        </div>
      )
    }
    // Mobile: vertical — chips above a full-width save button.
    return (
      <div className={cn('space-y-2.5 rounded-2xl bg-brand-50 p-3', className)}>
        <div className="flex flex-wrap items-center gap-1.5">{chipBtns}</div>
        <Button variant="bare" size="none" onClick={saveSearch} className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-card py-2 text-sm font-bold text-accent-foreground shadow-sm transition-colors hover:bg-accent cursor-pointer">
          <Bookmark className="h-4 w-4" /> {tr('Save this search', 'Lưu tìm kiếm này')}
          <span className="text-2xs font-normal text-muted-foreground">{tr('— alerts on new matches', '— báo khi có tin mới')}</span>
        </Button>
      </div>
    )
  }

  // Empty state that diagnoses WHY there are no results and offers one-tap relaxation.
  const renderEmptyState = () => {
    const chips = getActiveChips()

    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-line-strong py-14 px-6 text-center">
        <Inbox className="h-10 w-10 text-muted-foreground" />
        <p className="text-sm font-semibold text-body">
          {tr('No listings match these filters.', 'Không có tin nào khớp với bộ lọc này.')}
        </p>

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="text-xs text-ink-4">{tr('Remove:', 'Bỏ bớt:')}</span>
            {chips.map((c, i) => (
              <Button
                key={i}
                variant="bare"
                size="none"
                onClick={c.onClear}
                className="inline-flex items-center gap-1 whitespace-normal rounded-xl px-3 py-1.5 text-xs font-semibold text-body hover:bg-muted transition-colors cursor-pointer"
              >
                {c.label}
                <X className="h-3 w-3" />
              </Button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          {chips.length > 0 && (
            <Button variant="cta" size="none"
              onClick={clearAllFilters}
              className="rounded-xl px-4 py-2 text-xs transition-colors cursor-pointer"
            >
              {tr('Clear all filters', 'Xóa tất cả bộ lọc')}
            </Button>
          )}
          {/* The other two exits of the recovery trio (widening = the chip row above):
              turn this search into an alert, or flip the intent and post a Wanted. */}
          <Button variant="outline" size="none"
            onClick={saveSearch}
            className="rounded-xl px-4 py-2 text-xs font-semibold cursor-pointer"
          >
            {tr('Create an alert for this search', 'Tạo thông báo cho tìm kiếm này')}
          </Button>
          <Button asChild variant="outline" size="none" className="rounded-xl px-4 py-2 text-xs font-semibold">
            <Link href="/post">
              {tr('Post a Wanted — let sellers come to you', 'Đăng tin cần tìm — để người bán tìm đến bạn')}
            </Link>
          </Button>
        </div>

        {/* A dead end orients nobody — offer a one-tap jump to popular categories. */}
        {categories.length > 0 && (
          <div className="flex flex-col items-center gap-2 pt-1">
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
                  <Tr text={lang === 'vi' ? c.nameVi : c.name} />
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // List / Grid / Map view toggles — one source for the desktop sort row AND the
  // mobile results-count row (where the collapsed sort/view row's controls live).
  // Sort tabs + view toggles are presentational (see ./explorer-toolbar). pickSort keeps the
  // filter transition here since it owns setSort + the useTransition.
  const pickSort = (val: SortKey) => startFilterTransition(() => setSort(val))

  return (
    // overflow-x-CLIP (not hidden): hidden would make this section the sort strip's
    // scroll box and position:sticky would never pin; clip contains the horizontal
    // bleed without creating a scroll container.
    <section ref={listingsRef} id="listings" className="scroll-mt-20 relative overflow-x-clip pc:overflow-visible py-5 sm:py-8">
      {/* Width + edge gutter owned by the parent page <main> (see landing branch). */}
      <div className="relative w-full">
        {/* Page heading for the search/results view — keeps a sequential outline
            (h1 → rail/section h2 → card h3s); visually hidden. */}
        <h1 className="sr-only">{tr('Marketplace listings', 'Tin đăng')}</h1>

        {/* Single-column faceted directory */}
        <div className="animate-in fade-in slide-in-from-bottom-3 duration-300">

          {/* Listings Main Workspace */}
          <div className="space-y-4">

            {/* Line 1 — category rail (square logo + name); tap to expand subcategories */}
            <CategoryRail
              categories={categories}
              activeCategory={activeCategory}
              activeSubcategory={activeSubcategory}
              subcategoryCounts={subcategoryCounts}
              onCategory={handleCategorySelect}
              onSubcategory={setActiveSubcategory}
              // Free / Wanted shortcuts — same tiles the home grid shows, so nothing's
              // missing when you switch to results. Toggle the listingType filter.
              intents={INTENT_SHORTCUTS}
              activeType={listingType}
              onIntent={(type) => setListingType(listingType === type ? 'all' : type)}
            />

            {/* Brand rail — brands present in this category + subcategory (logo +
                name), tap to filter + expand the brand's models. Brand categories — and
                ALL (owner 2026-07-23: "when all selected show all brands available"):
                /api/brands treats category=all as the most-listed-overall directory. */}
            {(activeCategory === 'all' || categoryHasBrand(activeCategory)) && (
              <BrandRail
                category={activeCategory}
                subcategory={activeSubcategory}
                activeBrand={activeBrand}
                activeModel={activeModel}
                onPickBrand={setActiveBrand}
                onPickModel={setActiveModel}
              />
            )}

            {/* Category-aware facet bar (replaces the old sidebar) */}
            <FacetBar
              activeCategory={activeCategory}
              activeSubcategory={activeSubcategory}
              setActiveSubcategory={setActiveSubcategory}
              province={activeProvince}
              setProvince={setActiveProvince}
              ward={activeWard}
              setWard={setActiveWard}
              nearby={nearby}
              setNearby={setNearby}
              priceRange={priceRange}
              setPriceRange={setPriceRange}
              conditionFilter={conditionFilter}
              setConditionFilter={setConditionFilter}
              listingType={listingType}
              setListingType={setListingType}
              customFilters={customFilters}
              setCustomFilters={setCustomFilters}
              verifiedOnly={verifiedOnly}
              setVerifiedOnly={setVerifiedOnly}
              histogramQuery={histogramQuery}
            />

            {/* Save-search & View row — DESKTOP ONLY (sorting moved to the strip
                below). On mobile this row collapses: the view toggles sit on the
                results-count row, so the results start a full row higher. */}
            <div className="hidden items-start gap-3 lg:flex">
              {renderSaveBox(true, 'hidden min-w-0 flex-1 lg:flex')}
              {/* View toggles — pinned top-right (ml-auto keeps them right even
                  when there are no chips / no save box on the left). */}
              <div className="flex items-center gap-2.5 lg:ml-auto lg:shrink-0">
                <ViewToggles viewMode={viewMode} onViewMode={changeView} showVideo={showVideoView} />
              </div>
            </div>

            {/* Mobile: the full save box stays below the facet bar (unchanged); desktop
                renders the compact 1/3 box on the filter line above. */}
            {renderSaveBox(false, 'lg:hidden')}

            {/* One-row sort strip — sticks under the header while the results scroll. */}
            <SortStrip sort={sort} onPickSort={pickSort} headerHidden={headerHidden} />

            {/* Results metadata count — also the feed's h2 (keeps headings sequential).
                On mobile the view toggles live here (the sort/view row is collapsed). */}
            <div className="flex items-center justify-between text-xs text-muted-foreground px-1 select-none">
              <h2 aria-live="polite" aria-atomic="true" className="text-xs font-normal text-muted-foreground">
                {tr('Found', 'Tìm thấy')}{' '}
                <strong className="text-foreground">{nearby ? shownListings.length : totalCount}</strong>{' '}
                {tr('listings', 'tin đăng')}
              </h2>
              <div className="flex items-center gap-1 lg:hidden"><ViewToggles viewMode={viewMode} onViewMode={changeView} showVideo={showVideoView} /></div>
            </div>

            {/* Video view (4th mode): its own vertical clip feed with a self-contained
                data fetch (hasVideo=1) + loading/empty states — replaces the grid/list/map
                results area entirely, so the blocks below are skipped in this mode. */}
            {viewMode === 'video' && (
              <VideoFeed baseParams={baseParamsString} onOpen={handleOpen} onPrefetch={prefetchListing} onClose={() => { setViewMode(prevViewRef.current); setVideoReturn(null) }} restoreTo={videoReturn} />
            )}

            {/* LISTINGS CONTAINER */}
            {viewMode !== 'video' && isLoading && listings.length === 0 && (
              viewMode === 'grid' ? (
                <div className="grid grid-cols-2 gap-2 sm:gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <ListingCardSkeleton key={i} />
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 p-2">
                      <Skeleton className="h-16 w-20 shrink-0" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-3.5 w-1/2" />
                        <Skeleton className="h-3 w-1/3" />
                      </div>
                      <Skeleton className="h-8 w-24 mr-2" />
                    </div>
                  ))}
                </div>
              )
            )}

            {viewMode !== 'video' && !isLoading && shownListings.length === 0 && (queryError ? renderErrorState() : renderEmptyState())}

            {viewMode !== 'video' && shownListings.length > 0 && (
              <div className={cn(isLoading && 'opacity-60 pointer-events-none transition-opacity')}>
                <div
                  key={`${viewMode}|${activeCategory}|${activeSubcategory}|${activeDistrict}|${sort}|${verifiedOnly}|${conditionFilter}`}
                  className="animate-in fade-in slide-in-from-bottom-1 duration-200"
                >
                {viewMode === 'grid' && (
                  /* Grid Mode (Standard Cards) */
                  <div className="grid grid-cols-2 gap-2 sm:gap-4 sm:grid-cols-3 lg:grid-cols-4">
                    {deferredListings.map((l, index) => (
                      <Fragment key={l.id}>
                        {/* Guest capture (5a #7): one signup card at the point of interest,
                            after the 8th listing. Renders null once signed in. */}
                        {index === 8 && <CaptureCard />}
                        {/* data-feed-card = the back-nav restore anchor (see the landing grid). */}
                        <div
                          data-feed-card={l.id}
                          className="flex flex-col h-full"
                          onMouseEnter={() => prefetchListing(l.id)}
                          onTouchStart={() => prefetchListing(l.id)}
                        >
                          <ListingCard listing={l} onOpen={handleOpen} priority={index === 0} lcp={index === 0} onLocate={locateListing} />
                        </div>
                      </Fragment>
                    ))}
                  </div>
                )}

                {viewMode === 'map' && (
                  /* Airbnb-style split: scrollable list (left) + sticky map (right) */
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                    {/* Left: narrow single-column result list (its own scroll container on desktop) */}
                    <div ref={mapListRef} className="min-w-0 lg:col-span-4 lg:h-[calc(100dvh-8rem)] lg:overflow-y-auto lg:pr-1 grid grid-cols-1 gap-4 scroll-thin order-2 lg:order-1">
                      {mapSortedListings.map((l) => (
                        <div
                          key={l.id}
                          data-lid={l.id}
                          onMouseEnter={() => setHoveredId(l.id)}
                          onMouseLeave={() => setHoveredId(null)}
                          className={cn(
                            'rounded-xl',
                            // Highlight the IMAGE only (user-picked 2026-07-14):
                            // ringing the whole card incl. the text block read badly.
                            hoveredId === l.id && '[&_[data-protected]]:ring-2 [&_[data-protected]]:ring-inset [&_[data-protected]]:ring-brand/40',
                          )}
                        >
                          <ListingCard listing={l} onOpen={handleOpen} onLocate={locateListing} />
                        </div>
                      ))}
                      {/* In-column infinite-scroll sentinel (observed against this column) */}
                      {!nearby && (
                        <div ref={mapSentinelRef} className="select-none py-2">
                          {queryFetching && hasMore && (
                            <div className="flex items-center justify-center gap-2 text-xs font-semibold text-muted-foreground">
                              <Spinner size="sm" className="border-border border-t-brand" />
                              {tr('Loading more…', 'Đang tải thêm…')}
                            </div>
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
                    <div
                      ref={mapWrapRef}
                      className="min-w-0 lg:col-span-8 h-[60dvh] lg:h-[calc(100dvh-8rem)] scroll-mt-[calc(4rem+env(safe-area-inset-top))] lg:scroll-mt-24 lg:sticky lg:top-24 rounded-2xl overflow-hidden order-1 lg:order-2">
                      <ListingsMap
                        listings={mapListings}
                        activeDistrict={activeDistrict}
                        onOpenListing={handleOpen}
                        selectedId={hoveredId ?? focusId}
                        onHover={setHoveredId}
                        onPinOpen={(id) => {
                          // Surface the listing's card in the list. WHEN this fires is the
                          // map's call: desktop = on pin open (the list is a side column, so
                          // scrolling it is free); touch = only on the first tap of the popup
                          // card (on mobile the list is BELOW the map, so scrolling on a pin
                          // tap would drag the page off the map — user decision 2026-07-14).
                          mapListRef.current?.querySelector(`[data-lid="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
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
                     with a big empty middle; single column on mobile. */
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-1.5">
                    {deferredListings.map((l, index) => (
                      /* data-feed-card = the back-nav restore anchor (see the landing grid). */
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
                  </div>
                )}
                </div>

                {/* Infinite feed — the sentinel triggers the next page as it nears
                    the viewport (FB-style). "Near you" pulls one broad set, so it's
                    excluded; once everything is loaded we show an end-cap. Map view
                    uses its own in-column sentinel above, so skip this one there. */}
                {!nearby && viewMode !== 'map' && (
                  <div ref={loadMoreRef} className="mt-6 select-none">
                    {queryFetching && hasMore && (
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
        </div>
      </div>

      {/* MOBILE BOTTOM SLIDE-UP DRAWER OVERLAY — mounted on first open (see filtersEverOpened),
          then kept mounted so its exit animation survives every subsequent close. */}
      {(isMobileFilterOpen || filtersEverOpened) && (
      <ExplorerFiltersDrawer
        open={isMobileFilterOpen}
        onOpenChange={setIsMobileFilterOpen}
        totalCount={totalCount}
        categories={categories}
        activeCategory={activeCategory}
        handleCategorySelect={handleCategorySelect}
        activeSubcategory={activeSubcategory}
        setActiveSubcategory={setActiveSubcategory}
        verifiedOnly={verifiedOnly}
        setVerifiedOnly={setVerifiedOnly}
        activeDistrict={activeDistrict}
        setActiveDistrict={setActiveDistrict}
        conditionFilter={conditionFilter}
        setConditionFilter={setConditionFilter}
        customFilters={customFilters}
        setCustomFilters={setCustomFilters}
      />
      )}

    </section>
  )
}
