'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, ArrowUp, ArrowDown, ArrowUpDown, AlertTriangle } from '@/components/ui/icons'
import type { SerializedListingCard } from '@/lib/types'
import { ListingCard } from './listing-card'
import { ListingCardSkeleton } from './listing-card-skeleton'
import { LISTING_GRID } from './listing-grid'
import { sortTabClass } from './sort-tab-class'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { fold } from '@/lib/fold'
import { hapticSelection } from '@/lib/haptics'
import { useLanguage } from '@/context/language-context'
import { hereVariant, localizedHref } from '@/lib/lang-pinned'
import { variantOfLanguage } from '@/lib/lang-variant'

/**
 * ⚠️ ENGLISH PLURALISES, VIETNAMESE DOES NOT — and the count line read "1 listings." until an
 * external reviewer caught it. `page.tsx` a few lines away already gets this right; this is the
 * same rule, stated once here rather than inlined at each call.
 */
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

// The four learned sorts. Without `serverScope` they are applied in memory to the rows handed in
// (a seller who owns every row); with it, each is a scoped /api/listings query. The server hands
// the first page over in the rankScore blend, which IS "relevance" — so that tab costs nothing, and
// the ISR pages that render this (/c/*, storefronts) stay static: sorting is a client fetch.
type SortKey = 'relevance' | 'recent' | 'popular' | 'price-low' | 'price-high'

export function SellerListings({
  listings,
  searchable = false,
  sortable = false,
  serverScope,
  initialSort = 'relevance',
  stripEnd,
  priceLabel = 'price',
  homeVariant,
}: {
  listings: SerializedListingCard[]
  searchable?: boolean
  sortable?: boolean
  /**
   * ⛔ MAKES SEARCH, SORT AND LOAD-MORE REAL DATABASE QUERIES OVER THE WHOLE SCOPE. Without it this
   * component searches and sorts the array it was handed — which is correct only when that array IS
   * the catalogue. A seller storefront rendered its 60 NEWEST listings under a heading announcing
   * 9,726, then filtered and re-sorted those 60: "Price ↑" could not reach the cheapest item and
   * typing "iphone" searched 0.6% of the shop. `params` are the /api/listings filters that DEFINE
   * the scope (`{ seller: id }`, `{ category, district }`); they are re-sent on every request, so
   * the scope cannot be lost by a sort, a page or a query the way a hand-built URL can.
   *
   * ⚠️ `total` IS THE SCOPE'S TRUE SIZE, and the first page still arrives server-rendered in
   * `listings` — so a crawler and a cold visitor see real cards, and nothing is fetched until
   * someone actually searches, sorts or asks for more.
   */
  serverScope?: { params: Record<string, string>; total: number; pageSize?: number }
  /** The order `listings` is already in, so the strip opens on the truth. */
  initialSort?: SortKey
  /**
   * A control that rides the END of the sort strip, outside the tablist (a tablist may hold only
   * tabs) — /c/[category]'s "Filters" link into the explorer. The strip is its row, so the two share
   * one hairline instead of stacking a second bar above the grid.
   */
  stripEnd?: React.ReactNode
  /**
   * What the price sort is called. Jobs sort by the SALARY in their price column (price.tsx renders
   * it as pay), and a "Price" tab over job cards reads as a fee (K-ORANGE, 2026-09-29).
   */
  priceLabel?: 'price' | 'salary'
  /**
   * The page's language, for the card's "show on map" link into the home explorer: `vi` sends it to the
   * `/vi` twin instead of the English-pinned `/` (A1-LANG). DEFAULTS TO THE PAGE'S OWN LANGUAGE (the
   * language context, which starts at the variant the server rendered), so every grid — /c pages, district
   * hubs, the vehicle hubs, storefronts — gets it without passing anything; pass it only to override.
   * Safe on a storefront: the tap re-checks the HOST (hereVariant), and on a shop's own host — no pilot
   * there — it opens the plain `/?focus=`.
   */
  homeVariant?: string
}) {
  const router = useRouter()
  const { tr, lang } = useLanguage()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortKey>(initialSort)

  /**
   * SERVER MODE — every search, sort and page is a scoped query, and the scope is in `params`.
   *
   * ⚠️ NOTHING IS FETCHED FOR THE VIEW THE PAGE ALREADY RENDERED. `remote` stays null while the
   * reader is looking at the server-rendered first page in its original order; the moment they
   * type or pick a sort it holds the answer to THAT question, from offset 0, over the whole scope.
   */
  const serverMode = !!serverScope
  const pageSize = serverScope?.pageSize ?? 48
  const [debouncedQ, setDebouncedQ] = useState('')
  useEffect(() => {
    if (!serverMode) return
    const t = setTimeout(() => setDebouncedQ(q.trim()), 350)
    return () => clearTimeout(t)
  }, [q, serverMode])

  const [remote, setRemote] = useState<{ key: string; rows: SerializedListingCard[]; total: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  /** Bumped by "Try again" — the query is unchanged, so only this can re-run the effect. */
  const [refreshTick, setRefreshTick] = useState(0)
  /**
   * ⚠️ A READINESS FLAG, NOT DECORATION. This strip and its buttons are server-rendered, so they
   * are on screen and inert until React hydrates — a click in that window is swallowed silently.
   * The browser gate waits on `data-listings-ready` rather than on a timeout or on networkidle,
   * which is what made "Show more" flaky exactly once in five runs.
   */
  const [ready, setReady] = useState(false)
  useEffect(() => { setReady(true) }, [])
  const queryKey = `${debouncedQ}|${sort}`
  const isInitialView = serverMode && debouncedQ === '' && sort === initialSort

  const requestUrl = useCallback((offset: number) => {
    const p = new URLSearchParams(serverScope?.params ?? {})
    if (debouncedQ) p.set('q', debouncedQ)
    // 'relevance' is this component's word for the API's default blend; the other four are shared.
    p.set('sort', sort === 'relevance' ? 'newest' : sort)
    p.set('limit', String(pageSize))
    p.set('offset', String(offset))
    // No facet rails on a scoped surface — they are the explorer's furniture and cost a groupBy.
    p.set('facets', '0')
    if (lang !== 'en' && lang !== 'vi') p.set('lang', lang)
    return `/api/listings?${p.toString()}`
  }, [serverScope, debouncedQ, sort, pageSize, lang])

  // The in-flight request's key, so a slow answer to an abandoned query can never land.
  const inFlight = useRef('')

  useEffect(() => {
    if (!serverMode) return
    // ⚠️ RETURNING TO THE UNTOUCHED VIEW CANCELS WHATEVER WAS IN FLIGHT. Without clearing the
    // marker and the flag, picking a sort and then going back to it left the grid dimmed and
    // "Show more" disabled until a request nobody wants settles — and its failure would print
    // "Couldn't load listings." over a grid that is correct (external review).
    if (isInitialView) { inFlight.current = ''; setRemote(null); setLoadError(false); setLoading(false); return }
    const key = queryKey
    inFlight.current = key
    setLoading(true)
    setLoadError(false)
    fetch(requestUrl(0))
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((d) => {
        if (inFlight.current !== key) return
        setRemote({ key, rows: d.listings || [], total: typeof d.total === 'number' ? d.total : (d.listings || []).length })
      })
      // ⛔ AN ERROR MUST NOT FALL BACK TO THE PAGE'S OWN 60 ROWS. That would answer "cheapest first"
      // with the newest 60 re-sorted — the exact wrong answer this mode exists to stop — and look
      // like a successful sort.
      .catch(() => { if (inFlight.current === key) { setRemote(null); setLoadError(true) } })
      .finally(() => { if (inFlight.current === key) setLoading(false) })
  }, [serverMode, isInitialView, queryKey, requestUrl, refreshTick])

  const loadMore = useCallback(() => {
    if (!serverMode || loading) return
    const key = queryKey
    const current = remote?.key === key ? remote.rows : listings
    inFlight.current = key
    setLoading(true)
    setLoadError(false)
    fetch(requestUrl(current.length))
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((d) => {
        if (inFlight.current !== key) return
        const more: SerializedListingCard[] = d.listings || []
        // Dedupe on id: a listing posted between two pages shifts the offset window, and the same
        // row arriving twice would render two identical cards with the same React key.
        const seen = new Set(current.map((l) => l.id))
        setRemote({
          key,
          rows: [...current, ...more.filter((l) => !seen.has(l.id))],
          total: typeof d.total === 'number' ? d.total : current.length + more.length,
        })
      })
      .catch(() => { if (inFlight.current === key) setLoadError(true) })
      .finally(() => { if (inFlight.current === key) setLoading(false) })
  }, [serverMode, loading, queryKey, remote, listings, requestUrl])

  const shown = useMemo(() => {
    if (serverMode) {
      if (remote?.key === queryKey) return remote.rows
      // ⛔ ONLY THE UNTOUCHED VIEW MAY FALL BACK TO THE SERVER-RENDERED PAGE. Once a sort or a
      // search is asked for, showing those rows again would present the newest 60 as "cheapest
      // first" — a wrong answer wearing a right answer's clothes, and indistinguishable from a
      // working sort. While the query is in flight or has failed, the surface shows its own state.
      return isInitialView ? listings : []
    }
    let out = listings
    if (searchable && q.trim()) {
      const fq = fold(q.trim())
      out = out.filter((l) => fold(`${l.title} ${l.titleVi || ''} ${l.location} ${l.district || ''}`).includes(fq))
    }
    if (sortable && sort !== 'relevance') {
      // Copy before sorting — never mutate the prop array (relevance must stay the
      // server order to return to). ISO postedAt sorts lexically = chronologically.
      out = [...out].sort((a, b) => {
        switch (sort) {
          case 'recent': return b.postedAt.localeCompare(a.postedAt)
          case 'popular': return b.contactCount - a.contactCount // "Được quan tâm" = most contacted
          case 'price-low': return a.price - b.price
          case 'price-high': return b.price - a.price
          default: return 0
        }
      })
    }
    return out
  }, [serverMode, remote, queryKey, isInitialView, listings, searchable, q, sortable, sort])

  // ⚠️ IN SERVER MODE AN EMPTY `listings` IS NOT AN EMPTY SHOP. The seller may simply have nothing
  // matching the first page's filters; the scope's own total decides whether this surface exists.
  if (listings.length === 0 && !(serverMode && serverScope!.total > 0)) return null

  const priceSortActive = sort === 'price-low' || sort === 'price-high'

  // The strip is a real ARIA tablist (ui/tabs → Base UI), but the SORT state is ours:
  // five sort keys collapse onto four tabs, because Price is one tab that CYCLES
  // asc → desc. So Tabs runs CONTROLLED: value is derived from `sort`, never stored.
  const tabValue = priceSortActive ? 'price' : sort
  const onTabValueChange = (next: string) => {
    // A sort strip is a selection, not a commit — the same rule ui/segmented follows.
    hapticSelection()
    // Base UI never fires onValueChange for a tab that is ALREADY active, so this
    // only ever runs on the first activation of Price (pointer or Enter/Space) —
    // the asc↔desc cycle lives in the Price tab's own onClick, which always fires.
    if (next === 'price') {
      if (!priceSortActive) setSort('price-low')
      return
    }
    setSort(next as SortKey)
  }

  const salary = priceLabel === 'salary'
  // Same tab visuals as the explorer's results strip (kept in sync deliberately),
  // minus the sticky/header-hide coupling — this landing page is short.
  // ⚠️ THE HAIRLINE SITS ON THE CONTENT BOX, like the home toolbar's and the canon's (§4: no doubled
  // frame). It used to bleed to the page frame with `-mx-3 px-3 sm:-mx-6 …`, 32px wider than the grid
  // under it at 1440 (C1-HAIRLINE). Tab label x positions are unchanged: the bleed's padding undid it.
  // `data-horizontal:flex-row` restates the base's `data-horizontal:flex-col` with its own modifier so
  // tailwind-merge drops it; the base's gap-2 is what separates `stripEnd` from the last tab.
  const sortStrip = (
    <Tabs
      value={tabValue}
      onValueChange={(v) => onTabValueChange(String(v))}
      className="flex items-center border-b border-border data-horizontal:flex-row"
    >
      {/* activateOnFocus=false = MANUAL activation: arrows move focus, Enter/Space commits.
          Auto-activation would double-fire Price — focus activates it (asc), then the same
          click's onClick sees it active and cycles straight on to desc.
          `min-w-0 flex-1`, not `w-full`: the list is the scroller and must leave `stripEnd` its
          width, or a phone pushes the Filters link off the row.
          ⚠️ `variant="line"` + `-mb-px overflow-y-hidden` ON THE LIST, the explorer strip's own shape
          (sortTabClass is shared, E-SORT): the -1px that lays the underline over the root's hairline
          used to sit on every TAB, which made this scroller 1px taller inside than out — a live
          vertical scroller under the thumb (explorer-toolbar.tsx measured that trap). */}
      <TabsList
        variant="line"
        activateOnFocus={false}
        className="scrollbar-none -mb-px flex min-w-0 flex-1 flex-nowrap items-center justify-start gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-none bg-transparent p-0 group-data-horizontal/tabs:h-auto"
      >
        <TabsTrigger value="relevance" className={sortTabClass(sort === 'relevance')}>
          {tr('Relevance', 'Liên quan')}
        </TabsTrigger>
        <TabsTrigger value="recent" className={sortTabClass(sort === 'recent')}>
          {tr('Newest', 'Mới nhất')}
        </TabsTrigger>
        <TabsTrigger value="popular" className={sortTabClass(sort === 'popular')}>
          {tr('Most contacted', 'Được quan tâm')}
        </TabsTrigger>
        <TabsTrigger
          value="price"
          onClick={() => {
            // The asc/desc cycle never reaches onValueChange (Base UI skips an already-active
            // tab), so the tick has to be fired here or the second Price press feels dead.
            if (priceSortActive) { hapticSelection(); setSort(sort === 'price-low' ? 'price-high' : 'price-low') }
          }}
          aria-label={salary ? tr('Sort by salary', 'Sắp xếp theo lương') : tr('Sort by price', 'Sắp xếp theo giá')}
          className={sortTabClass(priceSortActive)}
        >
          {salary ? tr('Salary', 'Lương') : tr('Price', 'Giá')}
          {sort === 'price-low' ? (
            <ArrowUp className="size-3.5" />
          ) : sort === 'price-high' ? (
            <ArrowDown className="size-3.5" />
          ) : (
            <ArrowUpDown className="size-3.5 text-ink-4" />
          )}
        </TabsTrigger>
      </TabsList>
      {/* A short rule between the reel and `stripEnd`, on a phone only: at 390px the tabs overflow
          and scroll under it, and without an edge "Most contacted" read as cut off by the link
          rather than passing behind a separate control. From sm the row fits and the link sits at
          the far end on its own. */}
      {stripEnd && (
        <div className="flex shrink-0 items-center gap-3">
          <span aria-hidden className="h-5 w-px bg-border sm:hidden" />
          {stripEnd}
        </div>
      )}
    </Tabs>
  )

  /** Server mode's own note: what is on screen, out of the scope's true size. */
  const resultTotal = serverMode ? (remote?.key === queryKey ? remote.total : serverScope!.total) : 0
  /**
   * ⛔ THE GRID IS EMPTY WHILE A NEW QUERY IS IN FLIGHT, AND THE NOTE MUST NOT REPORT THAT AS AN
   * ANSWER. `shown` is deliberately `[]` between asking for a sort and receiving it — showing the
   * previous rows would present the newest 60 as "cheapest first". But the count line then read
   * "Showing 0 of 9,726" over a blank grid, which on a slow connection is several seconds of a shop
   * that looks empty. Announcing a zero through `aria-live` is worse still. So while it is loading
   * the surface says it is loading, and skeletons stand in for the cards (external review).
   */
  const awaitingFirstRows = serverMode && loading && shown.length === 0
  // Not over a failed query either: "Showing 0 of 63,652" above "Couldn't load listings." reported
  // the failure as an empty answer.
  const serverNote = serverMode && !loadError && (
    <p className="text-xs text-muted-foreground" aria-live="polite">
      {awaitingFirstRows
        ? tr('Searching all listings…', 'Đang tìm trong tất cả tin đăng…')
        : (shown.length >= resultTotal
            ? plural(resultTotal, tr('{total} listing.', '{total} tin đăng.'), tr('{total} listings.', '{total} tin đăng.'))
            : tr('Showing {shown} of {total} listings.', 'Đang hiển thị {shown} trong {total} tin đăng.'))
            .replace('{shown}', shown.length.toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US'))
            .replace('{total}', resultTotal.toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US'))}
    </p>
  )

  const grid = (
    <div className={LISTING_GRID}>
      {shown.map((l, i) => (
        <div key={l.id} onMouseEnter={() => router.prefetch(`/listings/${l.id}`)} onTouchStart={() => router.prefetch(`/listings/${l.id}`)} onFocus={() => router.prefetch(`/listings/${l.id}`)}>
          <ListingCard listing={l} onOpen={() => router.push(`/listings/${l.id}`)} onLocate={() => router.push(localizedHref(`/?focus=${l.id}`, hereVariant(homeVariant ?? variantOfLanguage(lang))))} priority={i < 4} lcp={i === 0 && !remote} />
        </div>
      ))}
    </div>
  )

  /**
   * ⚠️ A BARE GRID ONLY WHEN THERE IS NOTHING MORE TO FETCH. This shortcut used to fire on "no search, no
   * sort" alone, which also dropped the count line and Show-more — so a server-paged grid that opts out of
   * the controls (the "More on eno.vn" continuation under a storefront) was silently capped at its first
   * page: measured 24 cards of 76,000 and no way to reach the rest. District pages pass serverScope with
   * sorting off when they hold ≤1 listing; they have nothing further to load and keep the bare grid.
   */
  if (!searchable && !sortable && !(serverMode && serverScope!.total > listings.length)) return grid

  return (
    <div className="space-y-4" data-listings-ready={ready ? 'true' : undefined}>
      {sortable && sortStrip}
      {serverNote}
      {searchable && (
        /* Just a search within this seller's catalog — no category/type filters. */
        <div className="flex items-center gap-2 rounded-xl bg-tint px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-ink-4" aria-hidden />
          <Input
            variant="unstyled"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={tr('Search this seller', 'Tìm trong tin của người bán')}
            placeholder={tr('Search this seller', 'Tìm trong tin của người bán')}
            className="min-w-0 flex-1 text-sm"
          />
        </div>
      )}

      {/* ⛔ A FAILED QUERY SAYS SO. Falling back to the page's own rows would present the newest 60
          as though they were the cheapest in the shop — a wrong answer that looks like a right one.
          ⚠️ THE FAULT COIN, NOT A HAND-ROLLED ROW (D-STATES): the row it replaces painted `bg-surface`,
          a colour no token defines, so it drew nothing, and it was the one failure in the app not on
          EmptyState's 'fault' variant. A whole block is right here: on error `shown` is [] (see
          `shown`), so it hides no cards. `tone="bare"` is explicit — the flat canon (§3b), not the
          primitive's dashed default. The alert role rides the title so the message is announced. */}
      {loadError ? (
        <EmptyState
          tone="bare"
          variant="fault"
          icon={AlertTriangle}
          title={<span role="alert">{tr("Couldn't load listings.", 'Không tải được tin đăng.')}</span>}
          action={
            <Button variant="cta" onClick={() => { setLoadError(false); setRemote(null); setRefreshTick((t) => t + 1) }}>
              {tr('Try again', 'Thử lại')}
            </Button>
          }
        />
      ) : null}

      {awaitingFirstRows ? (
        // Placeholders at the page size, so the grid keeps its height and nothing jumps when the
        // real cards land.
        <div className={LISTING_GRID} aria-hidden="true">
          {Array.from({ length: Math.min(pageSize, 8) }).map((_, i) => <ListingCardSkeleton key={i} />)}
        </div>
      ) : shown.length === 0 && !loading && !loadError ? (
        // A search that matched nothing names the way out: the one control that caused it.
        <EmptyState
          tone="bare"
          title={tr('No listings match', 'Không có tin nào khớp')}
          action={q ? <Button variant="outline" onClick={() => setQ('')}>{tr('Clear search', 'Xóa tìm kiếm')}</Button> : undefined}
        />
      ) : (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'} aria-busy={loading || undefined}>
          {grid}
        </div>
      )}

      {/* Load more, only when the scope genuinely holds more than is on screen. */}
      {serverMode && !loadError && shown.length > 0 && shown.length < resultTotal && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" size="none" onClick={loadMore} disabled={loading} className="rounded-xl border-line-strong px-5 py-2.5 text-sm font-bold hover:bg-muted hover:text-foreground">
            {loading ? tr('Loading…', 'Đang tải…') : tr('Show more', 'Xem thêm')}
          </Button>
        </div>
      )}
    </div>
  )
}
