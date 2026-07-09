'use client'

import { Fragment, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from 'react'
import {
  Search,
  Inbox,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Grid,
  List,
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
import { CategoryIcon } from './category-icons'
import { ListingCard } from './listing-card'
import { CaptureCard } from './capture-card'
import { LogoWordmark } from './logo-wordmark'
import { useHideOnScroll } from '@/hooks/use-hide-on-scroll'
import { BrandRail } from './brand-rail'
import { CategoryRail } from './category-rail'
import { ForYouRail } from './for-you-rail'
import { RecentlyViewedRail } from './recently-viewed-rail'
import { BusinessRail } from './business-rail'
import { DISTRICTS } from './listings-explorer.constants'
import { type Nearby, type Geo } from './area-filter'
import { getListingCoordinates, haversineKm } from '@/lib/geo'
import { trackSearch } from '@/lib/analytics'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useLanguage, Tr } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { SUBCATEGORIES } from '@/lib/subcategories'
import { LISTING_TYPES, INTENT_SHORTCUTS, categoryHasBrand, rangeFacetsFor, facetsFor } from '@/lib/taxonomy'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useSearchSuggest } from '@/hooks/use-search-suggest'
import { SearchSuggest, buildSuggestItems, type SuggestItem } from './search-suggest'
import { TrendingSearches } from './trending-searches'
import { useTrendingSearches } from '@/hooks/use-trending-searches'
import { AISearchButton } from './ai-concierge'
import { runVisualSearch, imageFromPaste } from '@/lib/visual-search'
import { ListingCardSkeleton } from './listing-card-skeleton'
import { ExplorerFilters } from './explorer-filters'
import { CompactListingRow } from './compact-listing-row'

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
const FacetBar = dynamic(() => import('./facet-bar').then((m) => m.FacetBar), { ssr: false })

const ListingsMap = dynamic(() => import('./listings-map').then((m) => m.ListingsMap), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-tint flex flex-col items-center justify-center gap-2 select-none animate-pulse">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      <span className="text-[10px] font-bold text-body uppercase tracking-wider">
        <Tr text="Loading map…" />
      </span>
    </div>
  )
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
type ViewMode = 'compact' | 'grid' | 'map'

type Props = {
  categories: SerializedCategory[]
  initialListings: SerializedListingCard[]
  initialTotal?: number
  listingsRef?: React.RefObject<HTMLDivElement | null>
}



export function ListingsExplorer({
  categories,
  initialListings,
  initialTotal,
  listingsRef,
}: Props) {
  const { lang, t, tr } = useLanguage()
  const { openSignIn } = useAuth()
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
  const [openMobileDistrictDropdown, setOpenMobileDistrictDropdown] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('compact')
  // Honor ?view=map|grid|compact (e.g. the footer "Map" link opens the map view).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const v = new URLSearchParams(window.location.search).get('view')
    // Also open the results view — landing + viewMode alone left the footer's
    // "Map" link on the landing hero, which read as a dead link.
    if (v === 'map' || v === 'grid' || v === 'compact') { setViewMode(v); setShowExplorer(true) }
  }, [])
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  // A listing to show on the map that isn't necessarily in the loaded feed (set when a
  // card outside the feed — e.g. the For You rail — asks to be located).
  const [focusListing, setFocusListing] = useState<SerializedListingCard | null>(null)
  const router = useRouter()
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false)
  const [showExplorer, setShowExplorer] = useState(false)
  // The sticky sort strip tracks the auto-hiding header (same hook): header shown →
  // pinned just below it; header rolled away → pinned at the viewport top.
  const headerHidden = useHideOnScroll()

  const [listings, setListings] = useState<SerializedListingCard[]>(initialListings)
  // Freshness anchor for the SSR seed, captured at CLIENT mount (not baked on the
  // server). The homepage is ISR (6h), so a server `Date.now()` would be stale by up
  // to 6h → React Query would treat the seed as stale and refetch /api/listings on
  // every load, defeating the seed. The user just received this HTML, so it's "fresh
  // as of now" for the 30s staleTime window.
  const [seedFetchedAt] = useState(() => Date.now())
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
  const [isLoading, setIsLoading] = useState(false)
  // Return-to-feed restoration: when set, a back-nav snapshot is being rehydrated —
  // hold the scroll target until the taller list paints, and don't let the page-1
  // query shrink the restored list.
  const restoredScrollRef = useRef<number | null>(null)
  const skipFirstPageResetRef = useRef(false)
  // The back-nav snapshot, read once on mount and applied when the feed's filters
  // settle to the same signature (filters hydrate from the URL in an effect, so the
  // match can't be made synchronously at mount).
  const pendingSnapRef = useRef<{ sig: string; listings: SerializedListingCard[]; page: number; totalCount: number; scrollY: number; ts: number } | null>(null)
  const snapReadRef = useRef(false)
  const [subcategoryCounts, setSubcategoryCounts] = useState<Record<string, number>>({})
  const [categoryTotal, setCategoryTotal] = useState(0)
  const [debouncedQuery, setDebouncedQuery] = useState(query)

  const [showSuggestions, setShowSuggestions] = useState(false)
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const [recentLocations, setRecentLocations] = useState<{ province: Geo; ward: Geo | null }[]>([])
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

  // Load search + location history from localStorage on mount
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProvince?.code, activeWard?.code])

  // Listen to open-mobile-filters event from Header
  useEffect(() => {
    const handleOpenFilters = () => setIsMobileFilterOpen(true)
    window.addEventListener('open-mobile-filters', handleOpenFilters)
    return () => window.removeEventListener('open-mobile-filters', handleOpenFilters)
  }, [])

  // The last search term sent to analytics — so 'search' fires once per distinct
  // committed query, not again on every pagination/sort/filter refetch of the same term.
  const lastTrackedSearch = useRef<string | null>(null)

  // Helper to persist search terms
  const saveSearchToHistory = useCallback((searchTerm: string) => {
    const trimmed = searchTerm.trim()
    if (!trimmed || trimmed.length < 2) return
    // Corrupt/legacy storage must never throw inside the data-sync effect.
    let list: string[] = []
    try {
      const parsed = JSON.parse(localStorage.getItem('eno:recent_searches') || '[]')
      if (Array.isArray(parsed)) list = parsed.filter((x): x is string => typeof x === 'string')
    } catch { /* reset on corrupt */ }
    list = [trimmed, ...list.filter((item) => item !== trimmed)].slice(0, 5)
    try { localStorage.setItem('eno:recent_searches', JSON.stringify(list)) } catch {}
    setRecentSearches(list)
  }, [])


  // Match active categories for quick suggestion links in Landing Page
  // Instant matches for the hero search — server-backed (full catalog), shared
  // with the header search via the same hook + panel so both bars behave
  // identically (was a client-side filter over only the SSR-seeded listings).
  const heroSuggest = useSearchSuggest(landingQuery, showSuggestions)
  const heroSuggestItems = buildSuggestItems(landingQuery, heroSuggest.brands, heroSuggest.categories, heroSuggest.listings)
  const [heroActiveIdx, setHeroActiveIdx] = useState(-1)
  useEffect(() => { setHeroActiveIdx(-1) }, [landingQuery])

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
    return () => {
      window.removeEventListener('eno:visual-search', onVisual)
      window.removeEventListener('eno:search', onSearch)
      window.removeEventListener('eno:set-area', onArea)
    }
  }, [handleLandingSearch, applyVisualSearch])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('eno:hero', { detail: { present: isLandingMode } }))
  }, [isLandingMode])

  // Global keyboard listener to focus search bar on '/'
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleCategorySelect = (slug: string) => {
    setLooseMatch(false)
    setActiveCategory(slug)
    setActiveSubcategory('all')
    setActiveBrand('all')
    setActiveModel('all')
    setCustomFilters({})
    setPriceRange('all') // price brackets are category-specific
  }

  const handleCategoryClick = (slug: string) => {
    setOpenMobileDistrictDropdown(false)
    setLooseMatch(false)
    setActiveCategory(slug)
    setActiveSubcategory('all')
    setActiveBrand('all')
    setActiveModel('all')
    setCustomFilters({})
    setPriceRange('all')
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
  useEffect(() => {
    const onApply = (e: Event) => {
      const url = (e as CustomEvent<{ url?: string }>).detail?.url
      if (!url) return
      const qs = url.includes('?') ? url.slice(url.indexOf('?') + 1) : ''
      applyParams(new URLSearchParams(qs))
      setShowExplorer(true)
      requestAnimationFrame(() => document.getElementById('listings')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
    window.addEventListener('eno:apply-url', onApply)
    return () => window.removeEventListener('eno:apply-url', onApply)
  }, [applyParams])

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

    window.history.replaceState(null, '', newUrl)
    // replaceState bypasses Next's router, so the persistent header search bar won't
    // see the query change — broadcast it so the top bar stays in sync. When a search
    // resolved to a brand/model (no text query), show the brand label so the bar still
    // reflects what was searched (e.g. "Huawei MatePad 11").
    const brandLabel = activeBrand !== 'all'
      ? [prettyBrand(activeBrand), activeModel !== 'all' ? activeModel : null].filter(Boolean).join(' ')
      : ''
    window.dispatchEvent(new CustomEvent('eno:query', { detail: { query: query.trim() || brandLabel } }))
  }, [activeCategory, query, activeDistrict, activeSubcategory, activeBrand, activeModel, customFilters, listingType, conditionFilter, priceRange, sort])

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
      const params = new URLSearchParams()
      if (activeBrand !== 'all') {
        params.set('brand', activeBrand)
        if (activeModel !== 'all') {
          // A MODEL is specific → keep it scoped to the browsed category, not global.
          params.set('model', activeModel)
          if (activeCategory !== 'all') params.set('category', activeCategory)
        } else if (activeCategory !== 'all') {
          // A BRAND alone spans ALL categories; the browsed category just ranks first.
          params.set('priorityCategory', activeCategory)
        }
      } else {
        if (activeCategory !== 'all') params.set('category', activeCategory)
        if (activeSubcategory !== 'all') params.set('subcategory', activeSubcategory)
      }
      // "Near you" ignores area filters and pulls a broad set to distance-filter client-side.
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

      // Serialize custom attribute + range filters.
      applyFilterParams(params, customFilters, activeCategory, activeSubcategory)

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
          // Recent, and with more rows than a fresh page-1 load would give.
          if (s && Array.isArray(s.listings) && Date.now() - s.ts <= 30 * 60 * 1000 && s.listings.length > initialListings.length) {
            pendingSnapRef.current = s
          }
        }
      } catch { /* ignore */ }
    }
    const snap = pendingSnapRef.current
    if (snap && snap.sig === feedSig) {
      pendingSnapRef.current = null
      skipFirstPageResetRef.current = true
      restoredScrollRef.current = snap.scrollY
      setListings(snap.listings)
      seenIdsRef.current = new Set(snap.listings.map((l: SerializedListingCard) => l.id))
      maxOffsetRef.current = (snap.page - 1) * 12 // deepest offset already loaded (feed page size)
      setReachedEnd(false)
      setTotalCount(snap.totalCount)
      setPage(snap.page)
    }
  }, [feedSig])

  // Once the restored (taller) list has painted, jump to the saved scroll position.
  useLayoutEffect(() => {
    if (restoredScrollRef.current != null && listings.length > initialListings.length) {
      window.scrollTo(0, restoredScrollRef.current)
      restoredScrollRef.current = null
    }
  }, [listings])

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

  // Update loading state
  useEffect(() => {
    setIsLoading(queryLoading || (queryFetching && listings.length === 0))
  }, [queryLoading, queryFetching, listings.length])

  // Count helper for category items to display in the sidebar/pills
  const getCategoryCount = useCallback(
    (slug: string) => {
      if (slug === 'all') {
        return categories.reduce((sum, c) => sum + (c.verifiedCount || 0), 0)
      }
      return categories.find((c) => c.slug === slug)?.verifiedCount ?? 0
    },
    [categories],
  )

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
      // Only the paginated results feed (not the landing rails) restores on back-nav.
      if (!isLandingMode && listings.length <= 120) {
        sessionStorage.setItem('eno:feed-snap', JSON.stringify({
          sig: feedSig, listings, page, totalCount, scrollY: window.scrollY, ts: Date.now(),
        }))
      }
    } catch { /* ignore quota/serialization */ }
    router.push(`/listings/${l.id}`)
  }, [isLandingMode, listings, page, totalCount, feedSig, router])
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
    fetch(`/api/listings?ids=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const l = d?.listings?.[0] as SerializedListingCard | undefined
        if (l) { setFocusListing(l); locateOnMap(l.id) }
      })
      .catch(() => {})
    // Strip the param so a later filter change / refresh doesn't re-trigger.
    const u = new URLSearchParams(window.location.search); u.delete('focus')
    window.history.replaceState(null, '', u.toString() ? `?${u}` : window.location.pathname)
  }, [locateOnMap])

  // Intent shortcuts (Free / Wanted) from the landing grid → open the explorer
  // filtered by listingType across all categories.
  const browseIntent = useCallback((type: string) => {
    setListingType(type)
    setShowExplorer(true)
    document.getElementById('listings')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // Save the current filter set → the buyer gets alerted (in-app + push) on new matches.
  const savingSearch = useRef(false)
  const saveSearch = useCallback(async () => {
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        document.getElementById('listings-search-input')?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  if (isLandingMode) {
    // Never open an empty dropdown: with a typed query it's the typeahead; when empty
    // it needs recents/locations or the Popular fallback (categories, already
    // client-side). With nothing to show the pill stays a plain pill.
    const heroPanelOpen = showSuggestions && (
      landingQuery.trim().length >= 2 || recentSearches.length > 0 || recentLocations.length > 0 || categories.length > 0 || trending.length > 0
    )
    return (
      <section ref={listingsRef} id="listings" className="scroll-mt-20 relative overflow-hidden pt-2 pb-5 sm:pt-3 sm:pb-8">
        {/* Width + edge gutter are owned by the parent page <main> (canonical
            max-w-7xl px-3 sm:px-6 lg:px-8) so the feed lines up with Header/Footer. */}
        <div className="relative w-full space-y-8 sm:space-y-12">

          {/* HERO SEARCH AREA */}
          <div className="pb-2 text-center">
            <div className="flex flex-col items-center justify-center mb-4 sm:mb-6">
              {/* SEO: a real <h1> with the exact brand phrase (the logo is an image). */}
              {/* eslint-disable-next-line react/jsx-no-literals -- SEO brand phrase, intentionally EN */}
              <h1 className="sr-only">eno.vn — Trusted Expat Marketplace in Vietnam</h1>
              <LogoWordmark className="h-14 w-auto mb-2 select-none sm:h-20 sm:mb-4" />
              <p className="eyebrow text-body">
                {tr('e-commerce with no drama', 'Mua bán không drama.')}
              </p>
            </div>

            {/* Centered Search Bar (the header reveals its own search once this
                scrolls out of view — id is the IntersectionObserver target). */}
            <div id="eno-hero-search" className="relative max-w-4xl w-full mx-auto select-none">
              {/* One cohesive search pill that morphs into a seamless suggestions
                  panel on focus (Google-style): flat bottom + shared shadow/border. */}
              <div className={cn(
                'flex items-center bg-card transition-all duration-200',
                heroPanelOpen
                  ? 'rounded-t-2xl shadow-pop'
                  : 'rounded-2xl bg-tint focus-within:ring-2 focus-within:ring-ring/30',
              )}>
                {/* No leading filter icon here — ambiguous on the hero; the results
                    view keeps its Filter chip in the facet bar. */}
                <button
                  onClick={() => handleLandingSearch(landingQuery)}
                  aria-label={tr('Search', 'Tìm kiếm')}
                  className="flex shrink-0 items-center justify-center rounded-l-2xl pl-4 pr-2.5 py-2.5 sm:pl-5 sm:py-3 text-ink-4 hover:text-accent-foreground hover:scale-110 transition-[color,transform] duration-200 cursor-pointer"
                >
                  <Search className="h-6 w-6 sm:h-7 sm:w-7" strokeWidth={2.25} />
                </button>
                <input
                  id="listings-search-input"
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
                  onPaste={async (e) => {
                    const f = imageFromPaste(e); if (!f) return; e.preventDefault()
                    toast.loading(tr('Reading your photo…', 'Đang đọc ảnh…'), { id: 'vis' })
                    const r = await runVisualSearch(f)
                    if (r?.query) { toast.dismiss('vis'); setLandingQuery(r.query); applyVisualSearch(r) }
                    else toast.error(tr("Couldn't recognize the item — try a clearer photo.", 'Không nhận ra món đồ — thử ảnh rõ hơn.'), { id: 'vis' })
                  }}
                  onKeyDown={(e) => {
                    if (showSuggestions && landingQuery.trim().length >= 2 && heroSuggestItems.length) {
                      if (e.key === 'ArrowDown') { e.preventDefault(); setHeroActiveIdx((i) => Math.min(heroSuggestItems.length - 1, i + 1)); return }
                      if (e.key === 'ArrowUp') { e.preventDefault(); setHeroActiveIdx((i) => Math.max(-1, i - 1)); return }
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
                {landingQuery && (
                  <button
                    type="button"
                    onClick={() => setLandingQuery('')}
                    aria-label={tr('Clear', 'Xóa')}
                    className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-4 transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-5 w-5" />
                  </button>
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
                <span className="h-6 w-px shrink-0 bg-border sm:h-7" />
                {/* Search-bar icon standard (matches the magnifier + AI button):
                    quiet ink at rest, brand-blue on hover. */}
                <button
                  onClick={() => { setViewMode('map'); setShowExplorer(true) }}
                  aria-label={tr('Map', 'Bản đồ')}
                  title={tr('Map', 'Bản đồ')}
                  className="flex shrink-0 items-center justify-center rounded-r-2xl pl-3.5 pr-4 py-3 text-ink-4 hover:text-accent-foreground hover:scale-110 transition-[color,transform] duration-200 cursor-pointer"
                >
                  <Map className="h-6 w-6 sm:h-7 sm:w-7" strokeWidth={2.25} />
                </button>
              </div>

              {/* Suggestions Overlay in Landing Page */}
              {heroPanelOpen && (
                <>
                  <div className="fixed inset-0 z-40 cursor-default" onClick={() => setShowSuggestions(false)} />
                  <div className="absolute top-full left-0 right-0 -mt-px z-50 rounded-b-2xl bg-card p-4 shadow-pop text-left max-h-[440px] overflow-y-auto scroll-thin space-y-4 animate-in fade-in slide-in-from-top-1 duration-100">
                    {landingQuery.trim().length >= 2 ? (
                      <SearchSuggest
                        items={heroSuggestItems}
                        loading={heroSuggest.loading}
                        query={landingQuery}
                        activeIndex={heroActiveIdx}
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
                              <button
                                onClick={(e) => { e.stopPropagation(); localStorage.removeItem('eno:recent_searches'); setRecentSearches([]) }}
                                className="text-[11px] font-semibold text-body hover:text-red-500 cursor-pointer"
                              >
                                {tr('Clear', 'Xóa')}
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {recentSearches.map((term, i) => (
                                <button
                                  key={i}
                                  onClick={() => { setLandingQuery(term); handleLandingSearch(term) }}
                                  className="rounded-xl px-3.5 py-2 text-sm font-semibold text-body hover:bg-muted hover:text-accent-foreground transition-colors cursor-pointer"
                                >
                                  {term}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Recent locations — the user's previously-searched areas */}
                        {recentLocations.length > 0 && (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="eyebrow flex items-center gap-1 text-body"><MapPin className="h-3 w-3" />{tr('Recent locations', 'Khu vực gần đây')}</span>
                              <button
                                onClick={(e) => { e.stopPropagation(); localStorage.removeItem('eno:recent_locations'); setRecentLocations([]) }}
                                className="text-[11px] font-semibold text-body hover:text-red-500 cursor-pointer"
                              >
                                {tr('Clear', 'Xóa')}
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {recentLocations.map((loc, i) => (
                                <button
                                  key={i}
                                  onClick={() => applyRecentLocation(loc)}
                                  className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold text-body hover:bg-muted hover:text-accent-foreground transition-colors cursor-pointer"
                                >
                                  <MapPin className="h-3.5 w-3.5" />
                                  {loc.ward ? (lang === 'vi' ? loc.ward.name : loc.ward.nameEn) : (lang === 'vi' ? loc.province.name : loc.province.nameEn)}
                                </button>
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
                                <button
                                  key={c.slug}
                                  onClick={() => { setShowSuggestions(false); handleCategorySelect(c.slug) }}
                                  className="rounded-xl px-3.5 py-2 text-sm font-semibold text-body hover:bg-muted hover:text-accent-foreground transition-colors cursor-pointer"
                                >
                                  <Tr text={lang === 'vi' ? c.nameVi : c.name} />
                                </button>
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
                Free & Wanted are intent tiles at the end. */}
            <div className="mx-auto grid w-fit max-w-full grid-rows-2 grid-flow-col auto-cols-[7rem] sm:auto-cols-[9rem] gap-x-4 gap-y-6 sm:gap-x-6 sm:gap-y-8 overflow-x-auto scrollbar-none snap-x px-3">
              {categories.map((cat) => {
                const cc = CATEGORY_COLOR_CLASSES[cat.color] ?? CATEGORY_COLOR_CLASSES.brand
                const hex = cc.text.match(/#[0-9a-fA-F]{6}/)?.[0] ?? '#0a66c2'
                return (
                  <button
                    key={cat.id}
                    onClick={() => handleCategorySelect(cat.slug)}
                    style={{ '--cat': hex } as CSSProperties}
                    className="group flex snap-start flex-col items-center justify-center gap-2 p-2 text-center cursor-pointer transition-transform duration-100 active:scale-95"
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
                      <span className="text-[11px] sm:text-xs text-body select-none font-semibold">
                        {cat.verifiedCount} {tr('listings', 'tin')}
                      </span>
                    )}
                  </button>
                )
              })}
              {/* Free & Wanted — intent tiles (filter across all categories) */}
              {INTENT_SHORTCUTS.map((s) => (
                <button
                  key={s.type}
                  onClick={() => browseIntent(s.type)}
                  className="group flex flex-col items-center justify-center gap-2 p-2 text-center cursor-pointer"
                >
                  <CategoryIcon
                    name={s.icon}
                    className="h-11 w-11 sm:h-12 sm:w-12 text-body transition-all duration-200 group-hover:scale-110 group-hover:text-brand"
                  />
                  <span className="text-sm sm:text-base font-bold text-foreground leading-tight transition-colors group-hover:text-brand">
                    <Tr text={lang === 'vi' ? s.nameVi : s.name} />
                  </span>
                  <span className="text-[11px] sm:text-xs text-body select-none font-semibold">
                    {s.type === 'free' ? tr('Giveaways', 'Miễn phí') : tr('In search of', 'Cần tìm')}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Recently viewed — the returning buyer's own trail, up top so they can
              jump straight back to an item. Self-hides for new visitors. */}
          <RecentlyViewedRail />

          {/* For You — horizontal rail between the category grid and the vertical feed
              (search → categories → horizontal For You → vertical). Self-hides once a
              filter/search is active. */}
          <ForYouRail />

          {/* Outstanding businesses — second horizontal rail: the highest-trust business
              storefronts (only on the home landing view). */}
          <BusinessRail />

          {/* Browse by category — one horizontal rail per category, most-used first.
              Tapping a heading / "See all" opens that category (same as the grid). */}
          <CategoryRails categories={categories} onCategory={handleCategorySelect} />

          {/* Section heading for the feed — keeps the document outline sequential
              (h1 → h2 → card h3s); visually hidden. */}
          <h2 className="sr-only">{tr('Latest listings', 'Tin đăng mới nhất')}</h2>

          {/* INFINITE FEED (Facebook-style) — all listings, loads more on scroll. */}
          {shownListings.length === 0 && !isLoading ? (
            queryError ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line-strong bg-card/60 py-16 text-center">
                <AlertTriangle className="h-10 w-10 text-muted-foreground" />
                <p className="text-sm font-semibold text-body">{tr("Couldn't load listings.", 'Không tải được tin đăng.')}</p>
                <Button variant="cta" size="none" onClick={() => refetchListings()} className="rounded-xl px-4 py-2 text-xs transition-colors cursor-pointer">{tr('Try again', 'Thử lại')}</Button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line-strong bg-card/60 py-16 text-center">
                <Inbox className="h-10 w-10 text-muted-foreground" />
                <p className="text-sm font-semibold text-body">
                  {tr('No listings found.', 'Không có tin đăng nào.')}
                </p>
              </div>
            )
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {deferredListings.map((l, index) => (
                  <Fragment key={l.id}>
                    {/* Guest capture (5a #7): one signup card at the point of interest,
                        after the 8th listing. Renders null once signed in. */}
                    {index === 8 && <CaptureCard />}
                    <div
                      className="flex flex-col h-full"
                      onMouseEnter={() => prefetchListing(l.id)}
                      onTouchStart={() => prefetchListing(l.id)}
                    >
                      <ListingCard listing={l} onOpen={handleOpen} priority={index < 4} lcp={index === 0} onLocate={locateListing} />
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
                      <button
                        onClick={() => { prefetchNextPage(); setPage((p) => p + 1); setFeedUnlocked(true) }}
                        className="rounded-xl border border-line-strong px-6 py-2.5 text-sm font-bold text-foreground transition-colors hover:bg-muted cursor-pointer"
                      >
                        {tr('Load more', 'Xem thêm')}
                      </button>
                    </div>
                  )}
                  {queryFetching && hasMore && (
                    <div className="flex items-center justify-center gap-2 border-t border-border pt-5 text-xs font-semibold text-muted-foreground">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-brand" aria-hidden="true" />
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
          <button
            key={i}
            onClick={c.onClear}
            aria-label={tr('Remove filter', 'Bỏ bộ lọc') + `: ${c.label}`}
            className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 text-xs font-semibold text-foreground shadow-sm transition-colors hover:bg-muted cursor-pointer"
          >
            {c.label}
            <X className="h-3 w-3 text-ink-4" />
          </button>
        ))}
        {chips.length > 1 && (
          <button onClick={clearAllFilters} className="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold text-accent-foreground hover:bg-accent transition-colors cursor-pointer">
            {tr('Clear all', 'Xóa tất cả')}
          </button>
        )}
      </>
    )
    if (compact) {
      // Desktop: one horizontal row — chips fill the left up to the sort dropdown, Save on the right.
      return (
        <div className={cn('flex items-center gap-2 rounded-2xl bg-brand-50 px-2.5 py-2', className)}>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{chipBtns}</div>
          <Button onClick={saveSearch} variant="cta" size="none" className="shrink-0 gap-1.5 px-3.5 py-1.5 text-xs shadow-sm active:scale-95 cursor-pointer">
            <Bookmark className="h-3.5 w-3.5" /> {tr('Save search', 'Lưu tìm kiếm')}
          </Button>
        </div>
      )
    }
    // Mobile: vertical — chips above a full-width save button.
    return (
      <div className={cn('space-y-2.5 rounded-2xl bg-brand-50 p-3', className)}>
        <div className="flex flex-wrap items-center gap-1.5">{chipBtns}</div>
        <button onClick={saveSearch} className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-card py-2 text-sm font-bold text-accent-foreground shadow-sm transition-colors hover:bg-accent cursor-pointer">
          <Bookmark className="h-4 w-4" /> {tr('Save this search', 'Lưu tìm kiếm này')}
          <span className="text-[11px] font-normal text-muted-foreground">{tr('— alerts on new matches', '— báo khi có tin mới')}</span>
        </button>
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
              <button
                key={i}
                onClick={c.onClear}
                className="inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-semibold text-body hover:bg-muted transition-colors cursor-pointer"
              >
                {c.label}
                <X className="h-3 w-3" />
              </button>
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
        </div>

        {/* A dead end orients nobody — offer a one-tap jump to popular categories. */}
        {categories.length > 0 && (
          <div className="flex flex-col items-center gap-2 pt-1">
            <span className="text-xs text-ink-4">{tr('Or browse', 'Hoặc xem')}</span>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {categories.slice(0, 4).map((c) => (
                <button
                  key={c.slug}
                  onClick={() => handleCategorySelect(c.slug)}
                  className="inline-flex items-center rounded-full bg-tint px-3.5 py-1.5 text-xs font-semibold text-body transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer"
                >
                  <Tr text={lang === 'vi' ? c.nameVi : c.name} />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // List / Grid / Map view toggles — one source for the desktop sort row AND the
  // mobile results-count row (where the collapsed sort/view row's controls live).
  const renderViewToggles = () => (
    <>
      <button
        onClick={() => setViewMode('compact')}
        aria-label={tr('List view', 'Danh sách')}
        aria-pressed={viewMode === 'compact'}
        title={tr('List view', 'Danh sách')}
        className={cn(
          'rounded-lg p-2 transition-colors cursor-pointer',
          viewMode === 'compact' ? 'text-accent-foreground' : 'text-body hover:bg-muted',
        )}
      >
        <List className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => setViewMode('grid')}
        aria-label={tr('Grid view', 'Lưới')}
        aria-pressed={viewMode === 'grid'}
        title={tr('Grid view', 'Lưới')}
        className={cn(
          'rounded-lg p-2 transition-colors cursor-pointer',
          viewMode === 'grid' ? 'text-accent-foreground' : 'text-body hover:bg-muted',
        )}
      >
        <Grid className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => setViewMode('map')}
        aria-label={tr('Map view', 'Bản đồ')}
        aria-pressed={viewMode === 'map'}
        title={tr('Map view', 'Xem Bản đồ')}
        className={cn(
          'rounded-lg p-2 transition-colors cursor-pointer',
          viewMode === 'map' ? 'text-accent-foreground' : 'text-body hover:bg-muted',
        )}
      >
        <Map className="h-3.5 w-3.5" />
      </button>
    </>
  )

  // One-row sort strip (Shopee's learned pattern: Liên quan | Mới nhất | Được quan
  // tâm | Giá) — one-tap tabs replacing the results-mode sort dropdown on ALL sizes.
  // Same underline-tab system as the dashboard/admin tabs. The price tab carries its
  // direction arrow: first tap = ascending, re-tap flips.
  const priceSortActive = sort === 'price-low' || sort === 'price-high'
  const pickSort = (val: SortKey) => startFilterTransition(() => setSort(val))
  const sortTab = (selected: boolean) =>
    cn(
      '-mb-px flex shrink-0 items-center gap-1 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors cursor-pointer',
      selected ? 'border-brand text-accent-foreground' : 'border-transparent text-body hover:text-foreground',
    )
  const renderSortStrip = () => (
    <div
      className={cn(
        // Sticky below the header's slot; when the header auto-hides on scroll-down
        // the offset follows it to the viewport edge. Swapping `top` (vs transform)
        // is a no-op while the strip is still in normal flow, so it never jolts the
        // layout above — it only glides once actually stuck.
        'sticky z-30 border-b border-border bg-background/95 backdrop-blur transition-[top] duration-[250ms] ease-out motion-reduce:transition-none',
        headerHidden ? 'top-0' : 'top-[calc(env(safe-area-inset-top)+4rem)]',
        // Edge bleed coupled to the page gutter (max-w-7xl px-3 sm:px-6 lg:px-8) so
        // the strip meets the Header's content edges at every size.
        '-mx-3 px-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8',
      )}
    >
      <div className="scrollbar-none flex flex-nowrap items-center gap-1 overflow-x-auto">
        <button type="button" onClick={() => pickSort('newest')} aria-pressed={sort === 'newest'} className={sortTab(sort === 'newest')}>
          {tr('Relevance', 'Liên quan')}
        </button>
        <button type="button" onClick={() => pickSort('recent')} aria-pressed={sort === 'recent'} className={sortTab(sort === 'recent')}>
          {tr('Newest', 'Mới nhất')}
        </button>
        <button type="button" onClick={() => pickSort('popular')} aria-pressed={sort === 'popular'} className={sortTab(sort === 'popular')}>
          {tr('Most contacted', 'Được quan tâm')}
        </button>
        <button
          type="button"
          onClick={() => pickSort(sort === 'price-low' ? 'price-high' : 'price-low')}
          aria-pressed={priceSortActive}
          aria-label={tr('Sort by price', 'Sắp xếp theo giá')}
          className={sortTab(priceSortActive)}
        >
          {tr('Price', 'Giá')}
          {sort === 'price-low' ? (
            <ArrowUp className="h-3.5 w-3.5" />
          ) : sort === 'price-high' ? (
            <ArrowDown className="h-3.5 w-3.5" />
          ) : (
            <ArrowUpDown className="h-3.5 w-3.5 text-ink-4" />
          )}
        </button>
      </div>
    </div>
  )

  // Distinct from the empty state: a failed fetch (DB down, 500) must NOT read as
  // "no listings" — show an error + retry so the marketplace never looks empty.
  const renderErrorState = () => (
    <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-line-strong py-14 px-6 text-center">
      <AlertTriangle className="h-10 w-10 text-muted-foreground" />
      <p className="text-sm font-semibold text-body">{tr("Couldn't load listings.", 'Không tải được tin đăng.')}</p>
      <Button variant="cta" size="none"
        onClick={() => refetchListings()}
        className="rounded-xl px-4 py-2 text-xs transition-colors cursor-pointer"
      >
        {tr('Try again', 'Thử lại')}
      </Button>
    </div>
  )

  return (
    // overflow-x-CLIP (not hidden): hidden would make this section the sort strip's
    // scroll box and position:sticky would never pin; clip contains the horizontal
    // bleed without creating a scroll container.
    <section ref={listingsRef} id="listings" className="scroll-mt-20 relative overflow-x-clip py-5 sm:py-8">
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
                name), tap to filter + expand the brand's models. Brand categories only. */}
            {categoryHasBrand(activeCategory) && (
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
                {renderViewToggles()}
              </div>
            </div>

            {/* Mobile: the full save box stays below the facet bar (unchanged); desktop
                renders the compact 1/3 box on the filter line above. */}
            {renderSaveBox(false, 'lg:hidden')}

            {/* One-row sort strip — sticks under the header while the results scroll. */}
            {renderSortStrip()}

            {/* Results metadata count — also the feed's h2 (keeps headings sequential).
                On mobile the view toggles live here (the sort/view row is collapsed). */}
            <div className="flex items-center justify-between text-xs text-muted-foreground px-1 select-none">
              <h2 className="text-xs font-normal text-muted-foreground">
                {tr('Found', 'Tìm thấy')}{' '}
                <strong className="text-foreground">{nearby ? shownListings.length : totalCount}</strong>{' '}
                {tr('listings', 'tin đăng')}
              </h2>
              <div className="flex items-center gap-1 lg:hidden">{renderViewToggles()}</div>
            </div>

            {/* LISTINGS CONTAINER */}
            {isLoading && listings.length === 0 && (
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
                      <div className="h-16 w-20 shrink-0 rounded-lg shimmer" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3.5 w-1/2 rounded shimmer" />
                        <div className="h-3 w-1/3 rounded shimmer" />
                      </div>
                      <div className="h-8 w-24 rounded shimmer mr-2" />
                    </div>
                  ))}
                </div>
              )
            )}

            {!isLoading && shownListings.length === 0 && (queryError ? renderErrorState() : renderEmptyState())}

            {shownListings.length > 0 && (
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
                        <div
                          className="flex flex-col h-full"
                          onMouseEnter={() => prefetchListing(l.id)}
                          onTouchStart={() => prefetchListing(l.id)}
                        >
                          <ListingCard listing={l} onOpen={handleOpen} priority={index < 4} lcp={index === 0} onLocate={locateListing} />
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
                      {shownListings.map((l) => (
                        <div
                          key={l.id}
                          onMouseEnter={() => setHoveredId(l.id)}
                          onMouseLeave={() => setHoveredId(null)}
                          className={cn(
                            'rounded-xl transition-shadow',
                            hoveredId === l.id && 'ring-2 ring-inset ring-brand/40',
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
                              <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-brand" aria-hidden="true" />
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
                        listings={focusListing && !shownListings.some((l) => l.id === focusListing.id) ? [focusListing, ...shownListings] : shownListings}
                        activeDistrict={activeDistrict}
                        onOpenListing={handleOpen}
                        lang={lang}
                        selectedId={hoveredId ?? focusId}
                        onHover={setHoveredId}
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
                      <div key={l.id}>
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
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-brand" aria-hidden="true" />
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

      {/* MOBILE BOTTOM SLIDE-UP DRAWER OVERLAY */}
      {isMobileFilterOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-card rounded-2xl w-full max-w-md p-5 shadow-overlay space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between border-b pb-2.5">
              <h4 className="text-sm font-extrabold text-foreground">
                {tr('Search Filters', 'Bộ lọc tìm kiếm')}
              </h4>
              <button
                onClick={() => setIsMobileFilterOpen(false)}
                className="rounded-full bg-tint p-1.5 text-ink-3 hover:bg-line-strong active:scale-95"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            
            {/* Scrollable Filters */}
            <div className="max-h-[50vh] overflow-y-auto pr-1">
              <ExplorerFilters
                isMobile
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
            </div>

            {/* Apply Action Button */}
            <button
              onClick={() => setIsMobileFilterOpen(false)}
              className="w-full rounded-xl bg-primary py-2.5 text-xs font-bold text-white shadow-md active:scale-98 cursor-pointer"
            >
              {tr('Apply Filters', 'Áp dụng lọc')} ({totalCount} {tr('listings', 'tin')})
            </button>
          </div>
        </div>
      )}

    </section>
  )
}
