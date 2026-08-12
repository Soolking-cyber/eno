'use client'

import { Fragment, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from 'react'
// Only the glyphs this file actually renders — the vestigial hero-search set
// (Search/MapPin/Phone/Sliders/Map/TrendingUp) died with the hero bar and was
// still being imported (icon-gauntlet cleanup, 2026-08-06).
import { Inbox, AlertTriangle, X, Clock, Bookmark } from '@/components/ui/icons'
import { toast } from 'sonner'
import type { SerializedListingCard, SerializedCategory } from '@/lib/types'
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
import { ForYouRail } from './for-you-rail'
import { RecentlyViewedRail } from './recently-viewed-rail'
import { useNearViewport } from '@/hooks/use-near-viewport'
import { BusinessRail } from './business-rail'
import { PromoBanner } from './promo-banner'
import { MIN_RAIL_ITEMS, SECTION_HEADER_ROW, SECTION_TITLE, railEdgeMask } from './shelf'
import { DISTRICTS } from './listings-explorer.constants'
import { type Nearby, type Geo } from './area-filter'
import { useSearchShortcuts, useSearchHistory, useSaveSearch } from './use-explorer'
import { ViewToggles, SortStrip } from './explorer-toolbar'
import { ResultLine, shouldOfferSaveSearch } from './result-line'
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
const FacetBar = dynamic(() => import('./facet-bar').then((m) => m.FacetBar), { ssr: false })

/** Rows in one page of results. ONE constant, because the results skeleton is a promise
 *  about this number: it drew six placeholders against a twelve-row answer, so the column
 *  grew by a whole grid row (~300px on a phone) the moment the query resolved. The
 *  "Near you" path deliberately pulls a broader set — it distance-filters client-side —
 *  and is the one caller that overrides it. */
const FIRST_PAGE_SIZE = 12

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

const ExplorerFiltersDrawer = dynamic(() => import('./explorer-filters').then((m) => m.ExplorerFiltersDrawer), {
  ssr: false,
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
type SortKey = 'newest' | 'recent' | 'price-low' | 'price-high' | 'popular'
type ViewMode = 'compact' | 'grid' | 'map' | 'video'

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
  // See DEFAULT_VIEW for why this is 'grid' and not 'compact'. The compact row is one tap away
  // on the view toggles, and ?view=compact still deep-links straight to it.
  const [viewMode, setViewMode] = useState<ViewMode>(DEFAULT_VIEW)
  // The full-screen Video view remembers the view to fall back to on close (so exiting the
  // takeover lands the user back where they were, not always on the grid).
  const prevViewRef = useRef<ViewMode>(DEFAULT_VIEW)
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
  // ⚠️ SEEDED FROM THE ISR HTML, NOT 0, AND THE MERGE IS WHY. The result count is now rendered
  // on the undirected home view as well (the results header serves both states), so whatever
  // this holds at first paint is baked into the 6h-ISR HTML and served to every anonymous
  // visitor and every crawler. At 0 that HTML said the marketplace had no listings while
  // showing twelve of them, and it also made `hasMore` false, so the "Browse everything"
  // ending popped in after hydration instead of being in the markup (app/(home)/loading.tsx
  // already reserves it). initialTotal is the count for exactly the rows baked beside it —
  // page.tsx runs the count() against the same predicate as the findMany().
  // Known, accepted imprecision: a FILTERED deep link (/?q=…) is served the same prerendered
  // HTML, so it shows the unfiltered total for one paint before the response corrects it. It
  // showed 0 before, which is equally wrong and worse for the common case.
  // ⚠️ A reviewer read this as "crawlers and no-JS visitors permanently get a count that
  // contradicts the filter". Measured, they do not: `listings` also initialises from
  // initialListings, so a no-JS visitor to /?q=x sees the unfiltered TWELVE CARDS and the
  // unfiltered COUNT — wrong about the query, but internally consistent, and identical to what
  // that visitor got before this line existed. The count never disagrees with the cards beside it.
  const [totalCount, setTotalCount] = useState(initialTotal ?? 0)
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

  // Is the undirected-browse chrome (promo banner, value strip, big category tiles, discovery
  // shelves) on screen? Everything isLandingMode asks, plus: the map and video views are
  // results surfaces in their own right — the map is a 60dvh/full-column takeover and the
  // video feed is a fixed-inset one — so an ad and three merchandising rails around them
  // would be decorating a view the visitor explicitly asked for.
  // ⚠️ THE viewMode HALF IS NOT COSMETIC — THE PAGINATION GATE READS THIS, NOT isLandingMode.
  // The merge put the view toggles on the home page, which created a state nobody had ever been
  // in: map view with showExplorer still false. Gate pagination on isLandingMode there and the
  // map dead-ends at twelve listings, because the map paginates through its own in-column
  // sentinel and renders no "Browse everything" button to unlock it — a feed that simply stops,
  // with nothing to click and no error. Reading showDiscovery instead means opening a takeover
  // view counts as directing the feed, which is what it is.
  const showDiscovery = isLandingMode && viewMode !== 'map' && viewMode !== 'video'

  // ⚠️ THE SORT STRIP IS THE ONE CONTROL THE PREDICATES ABOVE DO NOT SEE, AND ALL THREE
  // REVIEWERS FOUND IT. Measured: the showExplorer sync effect covers category, query, district,
  // subcategory, brand, model, listingType, condition, price and the custom facets — so every one
  // of those DOES leave undirected browse. `sort` is in neither that effect nor isLandingMode,
  // deliberately (it is not a filter: it reorders the same set), and until the merge that was
  // invisible because the strip only existed in the results branch. It is on the home page now,
  // so a visitor can reorder the home feed by price while a heading says "Latest listings".
  // The FEED is fine either way; the CLAIM is what breaks, so this fixes the claim rather than
  // flipping the whole page out of discovery for a reorder — a sort tap is not a search, and
  // tearing the banner, tiles and shelves off the page for one would be the "hop" this wave
  // exists to remove.
  // ⚠️ Also: 'newest' is the legacy param name for the DEFAULT RELEVANCE blend, not recency (see
  // SortKey) — so this reads "the feed is in the order the home page always showed it in", which
  // is exactly the claim the heading makes.
  const feedInDefaultOrder = showDiscovery && sort === 'newest'

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
      listingType !== 'all' ||
      conditionFilter !== 'all' ||
      priceRange !== 'all' ||
      Object.keys(customFilters).length > 0
    ) {
      setShowExplorer(true)
    }
  }, [activeCategory, query, activeDistrict, activeSubcategory, activeBrand, activeModel, customFilters, listingType, conditionFilter, priceRange])
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
  // "Clear", emptying the header search — and patching each one is how the next route gets
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
  // Not reachable today either way — measured 2026-08-11, the only two callers of setVerifiedOnly
  // in the app are FacetBar's "Clear" (which sets it TRUE) and explorer-filters.tsx, the drawer
  // this file documents as having no trigger anywhere in the repo.
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
      listingType !== 'all' ||
      conditionFilter !== 'all' ||
      priceRange !== 'all' ||
      activeProvince !== null || activeWard !== null || nearby !== null ||
      Object.keys(customFilters).length > 0
    ) return
    setShowExplorer(false)
    // Back to undirected browse → back behind the pagination gate, exactly as the logo reset
    // does. Without it the home feed keeps auto-paginating and the footer stays lost.
    setFeedUnlocked(false)
  }, [
    showExplorer, viewMode, activeCategory, query, debouncedQuery, activeDistrict, activeSubcategory, activeBrand,
    activeModel, listingType, conditionFilter, priceRange, activeProvince, activeWard,
    nearby, customFilters,
  ])

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
    // ⚠️ THE HEADER'S MAP BUTTON LANDS HERE. It was restored to the search bar on 2026-08-03, when
    // the hero search that owned the old map control was deleted. The header is a SIBLING of this
    // component, not its parent, so it cannot call setViewMode — it dispatches, exactly like
    // eno:search above. WITHOUT THIS LISTENER THE BUTTON RENDERS AND DOES NOTHING, which is a
    // failure both tsc and lint wave straight through.
    const onViewMap = () => {
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
        document.getElementById('listings')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
        setShowExplorer(true)
        document.getElementById('listings')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    } catch { /* malformed stash — ignore */ }
    return () => {
      window.removeEventListener('eno:visual-search', onVisual)
      window.removeEventListener('eno:view-map', onViewMap)
      window.removeEventListener('eno:search', onSearch)
      window.removeEventListener('eno:set-area', onArea)
    }
  }, [handleLandingSearch, applyVisualSearch])

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

  const { data: listingsData, isLoading: queryLoading, isFetching: queryFetching, isPlaceholderData: queryShowingStaleSet, isError: queryError, refetch: refetchListings } = useQuery({
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
      const limit = nearby ? 100 : FIRST_PAGE_SIZE
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

        const limit = FIRST_PAGE_SIZE
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
  const hasMore = !nearby && !reachedEnd && listings.length < totalCount
  useEffect(() => {
    if (!hasMore) return
    // ⚠️ THE GATE, AND IT IS THE REASON THE HOME PAGE HAS A FOOTER. Undirected browse never
    // arms this observer until the visitor presses "Browse everything" (see feedUnlocked).
    // showDiscovery, NOT isLandingMode — see the note where it is derived: the map view is
    // undirected browsing too, but it has no "Browse everything" button to unlock with, so
    // gating it produces a dead end rather than a reachable footer.
    if (showDiscovery && !feedUnlocked) return
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
  }, [hasMore, queryFetching, prefetchNextPage, viewMode, showDiscovery, feedUnlocked, query, debouncedQuery])

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
  // (It was hoisted here to clear the old isLandingMode early return's TDZ. That return is
  // gone as of 2026-08-11 — there is one tree now — so the position is no longer load-bearing;
  // it is left where it is because moving it would be churn for nothing.)
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
        label: cat ? (lang === 'vi' ? cat.nameVi : cat.name) : activeCategory,
        onSelect: () => { setActiveSubcategory('all'); setActiveBrand('all'); setActiveModel('all') },
      })
    }
    if (activeSubcategory !== 'all') {
      const sub = SUBCATEGORIES[activeCategory]?.find((s) => s.slug === activeSubcategory)
      crumbs.push({
        label: sub ? (lang === 'vi' ? sub.nameVi : sub.name) : activeSubcategory,
        onSelect: () => { setActiveBrand('all'); setActiveModel('all') },
      })
    }
    if (activeBrand !== 'all') {
      crumbs.push({ label: prettyBrand(activeBrand), onSelect: () => setActiveModel('all') })
    }
    // The deepest crumb is where you already are, so it gets no handler — a control that does
    // nothing is worse than plain text, and ResultLine renders a handler-less crumb as text.
    if (activeModel !== 'all') crumbs.push({ label: activeModel })
    return crumbs
  }, [activeCategory, activeSubcategory, activeBrand, activeModel, categories, lang])

  /**
   * The applied chips in the shape <ResultLine> takes. The ladder levels are dropped because the
   * BREADCRUMB above already names them — the subcategory and the brand+model chips would
   * otherwise print the same words twice on one line.
   * ⚠️ The id is the label rather than an index: ResultLine keys on it to know when a removal has
   * landed, and an index shifts under every neighbouring removal.
   */
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

  // The labels the breadcrumb already shows. A chip carrying one of these would print the same
  // word twice on one line, which is what made the old two-row layout read as noise.
  const ladderChipLabels = useMemo(
    () => new Set(ladderCrumbs.map((c) => c.label)),
    [ladderCrumbs],
  )

  const resultFilters = useMemo(
    () => getActiveChips()
      .filter((c) => !ladderChipLabels.has(c.label))
      .map((c) => ({ id: c.label, label: c.label, onRemove: c.onClear })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [debouncedQuery, activeSubcategory, activeBrand, activeModel, activeDistrict, activeProvince, activeWard, conditionFilter, listingType, priceRange, customFilters, verifiedOnly, nearby, lang],
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
          <Button onClick={saveSearch} variant="cta" size="none" className="shrink-0 gap-1.5 px-3.5 py-1.5 text-xs shadow-sm active:scale-[0.96] cursor-pointer">
            <Bookmark className="h-4 w-4" /> {tr('Save search', 'Lưu tìm kiếm')}
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
    if (chips.length === 0 && activeCategory === 'all') {
      return (
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
    }

    return (
      <EmptyState
        icon={Inbox}
        title={tr('No listings match these filters.', 'Không có tin nào khớp với bộ lọc này.')}
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
                    onClick={c.onClear}
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
                  onClick={() => { setNearby(null); setActiveWard(null); setActiveProvince(null); setActiveDistrict('all') }}
                  className="rounded-xl px-4 py-2 text-xs font-semibold cursor-pointer"
                >
                  {tr('Widen the area', 'Mở rộng khu vực tìm kiếm')}
                </Button>
              )}
              {(chips.length > 0 || activeCategory !== 'all') && (
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
                      <Tr text={lang === 'vi' ? c.nameVi : c.name} />
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
  // `showDiscovery` only decides whether the undirected-browse chrome (ad, value strip, big
  // category tiles, discovery shelves) is also on screen. Typing filters the grid in place.
  return (
    // overflow-x-CLIP (not hidden): hidden would make this section the sort strip's
    // scroll box and position:sticky would never pin; clip contains the horizontal
    // bleed without creating a scroll container.
    // ⚠️ THE OLD LANDING BRANCH USED `overflow-hidden` AND THAT IS NOW A TRAP: it could afford
    // to, because the sticky sort strip lived only in the other branch. The strip is on every
    // view now, so `overflow-hidden` here would silently un-stick it and nothing would fail.
    //
    // ⚠️ `pt-5 sm:pt-6` IS MEASURED, NOT CHOSEN — read it together with <PromoBanner/> below.
    // These paddings are the ONLY thing setting the gap above the promo banner, and they are
    // tuned so it MATCHES the gap below it (owner, 2026-08-05: "match the distance above banner
    // to next line"). Both were derived by measuring the built page, not by arithmetic on the
    // class names:
    //   desktop (1280px): 8.5px (header→<main>) + 16px (<main> pt-4) + 24px (pt-6) = 48.5px
    //                     against 48.0px measured from banner bottom to the hairline
    //   mobile   (390px): 8.5px + 16px + 20px (pt-5) = 44.5px, against 44.3px measured
    // ⚠️ The gap BELOW is NOT simply the space-y class — on mobile it measured 44.3px, not the
    // 32px space-y-8 suggests, because the banner's own section contributes the rest. If you
    // touch the spacing below, RE-MEASURE the real gap rather than recomputing from the classes.
    <section ref={listingsRef} id="listings" className="scroll-mt-20 relative overflow-x-clip pc:overflow-visible pt-5 pb-5 sm:pt-6 sm:pb-8">
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
              3 <path> elements with 0 <text>, so a text extractor finds no glyph anywhere.

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
              Outline stays sequential: h1 (site name) → h2 (results section) → h3 (cards). */}
          <h1 className="sr-only">{SITE_NAME}</h1>
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

        {/* ⚠️ ADVERTISING + VALUE STRIP — UNDIRECTED BROWSE ONLY, AND THE ORDER IS AN OWNER
            DECISION. banner-then-why-eno is owner, 2026-08-05 ("move this under banner"), taken
            against both external reviewers' advice and recorded as such: stacking an ad and a
            pitch above the feed pushes real listings down on a phone, and the reference's
            equivalent row is navigation rather than a pitch. Vertical COST is fair game; the
            SEQUENCE is not — do not swap these two, and do not put either between the ladder and
            the grid.
            ⚠️ `showDiscovery`, not `isLandingMode`: a visitor who searched, faceted, or opened the
            map/video view is being shown results they asked for, and an ad above those is the one
            placement the old two-branch layout was careful never to make. Keep it that way.
            ⚠️ THE BANNER'S HEIGHT DECIDES THIS PAGE'S LCP. It is the element the browser picks
            (measured at 390×844 / 4× CPU / 1.6 Mbps: /banners/promo-1.svg at 1816 ms), it
            preloads itself from promo-banner.tsx, and it is the single biggest thing standing
            between the fold and the first row of merchandise. */}
        {showDiscovery && (
          // ⛔ <WhyEno /> IS GONE (owner, 2026-08-12) — the five-item "Free to post / Trust scores
          // you can check / Your number stays private / Prices in Đ and $ / Real dispute
          // resolution" strip that sat between the banner and the ladder. It was value-prop copy
          // on a surface whose measured problem is that the first screen contains no merchandise
          // (y=983 at 1440×900), and it cost a full row to say what the trust badge, the price
          // and the dispute centre already say in context.
          // ⚠️ The padding below is NOT decoration: this block used to be a space-y column whose
          // step set the gap down to the ladder. With one child left the step never fires, so the
          // gap has to be stated here or the banner sits flush against the category rail.
          <div className="pb-8 sm:pb-12 lg:pb-8">
            <PromoBanner />
          </div>
        )}

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
        <div className="space-y-4">

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
          <CategoryRail
            categories={categories}
            activeCategory={activeCategory}
            activeSubcategory={activeSubcategory}
            subcategoryCounts={subcategoryCounts}
            facets={facetCounts}
            onCategory={handleCategorySelect}
            onSubcategory={setActiveSubcategory}
            shortcuts={DESK_SHORTCUTS}
            onShortcut={(sc) => { if (sc.kind === 'filter') applyUrl(sc.href); else router.push(sc.href) }}
            // Free / Wanted shortcuts — the intent tiles, at the tail.
            intents={INTENT_SHORTCUTS}
            activeType={listingType}
            onIntent={(type) => setListingType(listingType === type ? 'all' : type)}
          />

          {/* Brand rail — brands present in this category + subcategory (logo +
              name), tap to filter + expand the brand's models. Brand categories — and
              ALL (owner 2026-07-23: "when all selected show all brands available"):
              /api/brands treats category=all as the most-listed-overall directory.
              ⚠️ `!showDiscovery` GUARDS THE HOME COLD PATH. This rail fetches /api/brands on
              mount and it accepts category=all, so without the guard every anonymous home load
              — the most-served request on the site — would fire a brand-directory query before
              the visitor has expressed any interest in a brand. It appears the moment they do. */}
          {!showDiscovery && (activeCategory === 'all' || categoryHasBrand(activeCategory)) && (
            <BrandRail
              category={activeCategory}
              subcategory={activeSubcategory}
              activeBrand={activeBrand}
              activeModel={activeModel}
              facets={facetCounts}
              onPickBrand={setActiveBrand}
              onPickModel={setActiveModel}
            />
          )}

          {/* Category-aware facet bar (replaces the old sidebar). Now on the HOME view too —
              area, price, condition and intent are what "home is also a search page" means in
              practice, and they were previously unreachable without first leaving the landing.
              ⚠️ min-h-12 IS A RESERVATION, NOT DECORATION. <FacetBar> is a `ssr:false` dynamic
              (see the import), so it is absent from the ISR HTML and mounts after hydration —
              directly ABOVE the feed. Without a reserved row the whole grid would be pushed down
              on every cold load, which is precisely the CLS class this page paid 0.142 → 0.002 to
              get rid of. 48px is the bar's own single-row height, not a guess: every pill is a
              <CustomSelect> whose trigger carries `min-h-12` (custom-select.tsx), and the bar is
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
              every cold load, which is the CLS class this page paid 0.142 → 0.002 to remove. */}
          <SortStrip
            sort={sort}
            onPickSort={pickSort}
            headerHidden={headerHidden}
            leading={
              <div className="min-h-12">
                <FacetBar
                  facetCounts={facetCounts}
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
              </div>
            }
          />

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
          <div className={cn(SECTION_HEADER_ROW, 'select-none')}>
            <div className="flex min-w-0 items-center gap-2">
              {feedInDefaultOrder ? (
                <>
                  <Clock className="h-4 w-4 shrink-0 text-accent-foreground" aria-hidden />
                  <h2 className={SECTION_TITLE}>{tr('Latest listings', 'Tin đăng mới nhất')}</h2>
                </>
              ) : (
                /* ⚠️ THE HEADING GOES SR-ONLY RATHER THAN AWAY, and it carries the string the
                   deleted second <h1> used to. The results need A heading for the outline to stay
                   sequential (h1 site name → h2 here → h3 cards), but a big painted "Marketplace
                   listings" over a result set the visitor defined themselves is noise, and beside
                   "Found 32 listings" it says the same word twice. */
                <h2 className="sr-only">{tr('Marketplace listings', 'Tin đăng')}</h2>
              )}
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
                count={nearby ? shownListings.length : totalCount}
                crumbs={ladderCrumbs}
                filters={resultFilters}
                onClearAll={resultFilters.length > 1 ? clearAllFilters : undefined}
                className="min-w-0"
              />
            </div>
            {/* ⛔ SAVE SEARCH SITS LEFT OF THE VIEW MODES, ON THE SAME LINE — owner, 2026-08-12,
                and the order is the instruction, not a preference. Both are right-aligned by this
                row's justify-between, so the count and the path own the left and these two own the
                right regardless of how long the breadcrumb gets.
                ⚠️ Save search is OFFERED, NOT ALWAYS SHOWN: below two applied filters it is an
                offer to save nothing (see shouldOfferSaveSearch in result-line.tsx), so it renders
                null on the undirected home view and costs no width there. */}
            <div className="flex shrink-0 items-center gap-1">
              {/* ⚠️ THE LADDER COUNTS AS FILTERS HERE, AND LEAVING IT OUT HID THIS BUTTON ON THE
                  SEARCHES MOST WORTH SAVING. `resultFilters` deliberately EXCLUDES the ladder
                  levels because the breadcrumb beside it already names them — printing "Honda"
                  as a crumb and again as a chip is the duplication that list exists to avoid.
                  But "how many constraints are applied" is a different question from "what should
                  this line print", and using the display list for both meant Vehicles › Manual ›
                  Honda › Vision — four taps deep, and exactly the search in the owner's wireframe
                  — counted as ZERO and offered no save. Raised by two reviewers; confirmed on the
                  page by drilling category + brand and watching the button never appear. */}
              {shouldOfferSaveSearch(resultFilters.length + ladderCrumbs.length) && (
                <Button
                  onClick={saveSearch}
                  variant="bare"
                  size="none"
                  // ⚠️ NOT `hidden sm:inline-flex`. It was, and that put the one control for
                  // "tell me when something like this appears" out of reach on a phone — the
                  // device most of this marketplace is browsed on. The label hides under sm, the
                  // button does not.
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent"
                >
                  <Bookmark className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">{tr('Save search', 'Lưu tìm kiếm')}</span>
                  <span className="sr-only sm:hidden">{tr('Save search', 'Lưu tìm kiếm')}</span>
                </Button>
              )}
              <ViewToggles viewMode={viewMode} onViewMode={changeView} showVideo={showVideoView} />
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
              <div className="grid grid-cols-2 gap-2 sm:gap-4 sm:grid-cols-3 lg:grid-cols-4">
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

          {viewMode !== 'video' && !isLoading && shownListings.length === 0 && (
            queryError ? renderErrorState(showDiscovery ? 'gap-3 bg-card/60 py-16' : undefined) : renderEmptyState()
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
          {viewMode !== 'video' && shownListings.length > 0 && (
            <div className={cn('transition-opacity duration-200', queryShowingStaleSet && page === 1 && 'opacity-70')}>
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
                   everywhere (see the viewMode useState). */
                <div className="grid grid-cols-2 gap-2 sm:gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {deferredListings.map((l, index) => (
                    <Fragment key={l.id}>
                      {/* Guest capture (5a #7): one signup card at the point of interest,
                          after the 8th listing. Renders null once signed in. */}
                      {index === 8 && <CaptureCard />}
                      {/* data-feed-card = the back-nav restore ANCHOR. The return-to-feed
                          effect realigns this exact element, which is what makes "put me
                          back where I was" survive a page whose height changed while we
                          were away (the discovery shelves mount lazily). */}
                      <div
                        data-feed-card={l.id}
                        className="flex flex-col h-full"
                        onMouseEnter={() => prefetchListing(l.id)}
                        onTouchStart={() => prefetchListing(l.id)}
                      >
                        {/* ⚠️ `lcp` IS CONDITIONAL, AND THE CONDITION IS "IS THE PROMO BANNER ON
                            SCREEN". `lcp` turns on next/image `priority`, i.e. emits a
                            <link rel=preload>. Measured at 390×844 / 4× CPU / 1.6 Mbps on the
                            undirected home view, the browser picks `/banners/promo-1.svg` as LCP at
                            1816 ms — not a card photo — so spending the preload budget on the first
                            card there both misses AND competes with the element that wins. The
                            banner preloads itself from promo-banner.tsx. This used to be two
                            separate call sites in two separate branches that had to be kept
                            deliberately out of agreement; one tree means one call site and one
                            predicate.
                            ⚠️ ON THIS ROUTE THE TRUE BRANCH IS CURRENTLY UNREACHABLE IN THE SERVED
                            HTML, and pretending otherwise is how the comment above went stale once
                            already (external reviewer). `/` prerenders ONE variant — the undirected
                            one, because showExplorer starts false and searchParams are not read —
                            so even /?q=… ships showDiscovery=true markup and the hint can only ever
                            be added after hydration, by which point the LCP is long since recorded.
                            The condition is kept because it states the INVARIANT ("never preload a
                            card while the banner is on screen"), which is what protects this tree
                            the day it is server-rendered in a directed state — /c/[slug] is the
                            obvious candidate. It costs nothing today; it is not buying anything
                            today either.
                            ⚠️ `priority` STAYS UNCONDITIONAL. It is a different lever: without
                            `lcp` it resolves to `loading="eager"` (listing-card.tsx ~435), so the
                            first card still skips lazy-loading — it just stops claiming the preload. */}
                        <ListingCard listing={l} onOpen={handleOpen} priority={index === 0} lcp={index === 0 && !showDiscovery} onLocate={locateListing} />
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
                   with a big empty middle; single column on mobile.
                   ⚠️ SEAM FOR THE NEW RESULT LINE (stream C): this is the row it replaces.
                   <CompactListingRow> is a `ssr:false` dynamic with a geometry-matched
                   skeleton (compact-listing-row-skeleton.tsx) — a replacement needs the same
                   pair or the column collapses and rebounds while the chunk arrives. */
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-1.5">
                  {deferredListings.map((l, index) => (
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
