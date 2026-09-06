'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Search, ArrowUp, ArrowDown, ArrowUpDown } from '@/components/ui/icons'
import type { SerializedListingCard } from '@/lib/types'
import { ListingCard } from './listing-card'
import { ListingCardSkeleton } from './listing-card-skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { fold } from '@/lib/fold'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/context/language-context'

/**
 * ⚠️ ENGLISH PLURALISES, VIETNAMESE DOES NOT — and the count line read "1 listings." until an
 * external reviewer caught it. `page.tsx` a few lines away already gets this right; this is the
 * same rule, stated once here rather than inlined at each call.
 */
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

// The four learned sorts, applied in-memory to the already-loaded page of listings.
// The server hands them over in the rankScore blend, which IS "relevance" — so that
// tab is a no-op passthrough and costs nothing. On the /c/* SEO landing pages this
// gives the same sort strip as the explorer without turning those ISR pages dynamic.
type SortKey = 'relevance' | 'recent' | 'popular' | 'price-low' | 'price-high'

export function SellerListings({
  listings,
  searchable = false,
  sortable = false,
  sortBase,
  scope,
  serverScope,
  initialSort = 'relevance',
}: {
  listings: SerializedListingCard[]
  searchable?: boolean
  sortable?: boolean
  /**
   * ⛔ WHEN THE PAGE HOLDS ONLY A PREVIEW, A SORT MUST LEAVE THE PAGE. The /c/* landing pages fetch
   * the top 48 of a category by relevance and used to sort THOSE 48 in memory while the heading
   * announced thousands — "Price ↑" reordered the same 48 ids and no cheaper item outside the
   * window could ever appear (2026-09-05 review, U01). With `sortBase` set (the explorer URL for
   * this scope, e.g. `/?category=xe-may`), the strip is a row of real LINKS — `${sortBase}&sort=…`
   * into the explorer's full, server-backed, paginated query — not ARIA tabs that navigate: a link
   * can be middle-clicked, prefetched and read by a screen reader as what it is. A string, not a
   * function, because this crosses the Server → Client Component boundary (a function prop there
   * is a render-time crash). A seller storefront, which holds ALL of its listings, leaves it
   * undefined and sorts in place.
   */
  sortBase?: string
  /** What the visible set is a preview OF — rendered as one localised sentence under the strip. */
  scope?: { shown: number; total: number }
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
    // Base UI never fires onValueChange for a tab that is ALREADY active, so this
    // only ever runs on the first activation of Price (pointer or Enter/Space) —
    // the asc↔desc cycle lives in the Price tab's own onClick, which always fires.
    if (next === 'price') {
      if (!priceSortActive) setSort('price-low')
      return
    }
    setSort(next as SortKey)
  }

  const sortTab = (selected: boolean) =>
    cn(
      // ui/tabs' TabsTrigger ships a shadcn pill/underline look we do NOT want, so this
      // className is half box, half neutraliser. It all goes through the primitive's OWN
      // cn(), so it tailwind-MERGES (a class on a `render` child would only concatenate):
      //   flex/h-auto/flex-none  ← kill flex-1 + h-[calc(100%-1px)] (they'd stretch the tabs)
      //   rounded-none           ← base is rounded-xl-ish; it would round the underline's ends
      //   border-0 border-b-2    ← base `border` is 1px on ALL sides (transparent, but it
      //                            still shifts the label); .border-b-2 is emitted after
      //                            .border-0 in the built CSS, so the 2px underline survives
      //   after:hidden           ← base paints a second underline via ::after
      //   data-active:bg-*, shadow-none ← base fills + shadows the ACTIVE tab
      //   focus-visible:outline-0 ← base adds a 1px outline on top of ui/button's ring
      //   active:scale-[0.97], duration-100, cursor-pointer ← what ui/button used to give us
      // dark:* is restated on both branches because the base hard-codes dark colours that
      // out-specify our theme tokens (dark:text-muted-foreground, dark:data-active:*).
      '-mb-px flex h-auto flex-none cursor-pointer items-center gap-1 rounded-none border-0 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors duration-100 after:hidden focus-visible:outline-0 active:scale-[0.97] data-active:bg-transparent dark:data-active:bg-transparent group-data-[variant=default]/tabs-list:data-active:shadow-none',
      selected
        ? 'border-brand text-accent-foreground hover:text-accent-foreground data-active:text-accent-foreground dark:border-brand dark:text-accent-foreground dark:hover:text-accent-foreground dark:data-active:border-brand dark:data-active:text-accent-foreground'
        : 'border-transparent text-body hover:text-foreground dark:text-body',
    )
  // Same tab visuals as the explorer's results strip (kept in sync deliberately),
  // minus the sticky/header-hide coupling — this landing page is short.
  const sortStrip = (
    <Tabs
      value={tabValue}
      onValueChange={(v) => onTabValueChange(String(v))}
      className="-mx-3 block border-b border-border px-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
    >
      {/* activateOnFocus=false = MANUAL activation: arrows move focus, Enter/Space commits.
          Auto-activation would double-fire Price — focus activates it (asc), then the same
          click's onClick sees it active and cycles straight on to desc. */}
      <TabsList
        activateOnFocus={false}
        className="scrollbar-none flex w-full flex-nowrap items-center justify-start gap-1 overflow-x-auto rounded-none bg-transparent p-0 group-data-horizontal/tabs:h-auto"
      >
        <TabsTrigger value="relevance" className={sortTab(sort === 'relevance')}>
          {tr('Relevance', 'Liên quan')}
        </TabsTrigger>
        <TabsTrigger value="recent" className={sortTab(sort === 'recent')}>
          {tr('Newest', 'Mới nhất')}
        </TabsTrigger>
        <TabsTrigger value="popular" className={sortTab(sort === 'popular')}>
          {tr('Most contacted', 'Được quan tâm')}
        </TabsTrigger>
        <TabsTrigger
          value="price"
          onClick={() => {
            if (priceSortActive) setSort(sort === 'price-low' ? 'price-high' : 'price-low')
          }}
          aria-label={tr('Sort by price', 'Sắp xếp theo giá')}
          className={sortTab(priceSortActive)}
        >
          {tr('Price', 'Giá')}
          {sort === 'price-low' ? (
            <ArrowUp className="size-3.5" />
          ) : sort === 'price-high' ? (
            <ArrowDown className="size-3.5" />
          ) : (
            <ArrowUpDown className="size-3.5 text-ink-4" />
          )}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )

  // The preview page's strip: the SAME visuals, but every entry is a link into the explorer, and the
  // current order (relevance — what this page IS) is a plain selected label, not a tab.
  // ⚠️ ONLY WHEN THE PAGE IS A PREVIEW. A category whose whole catalogue fits on the page
  // (`total <= shown`) has nothing beyond the window to reach, so sorting in place is right there —
  // sending that visitor to the explorer would be a navigation for nothing.
  // `prefetch={false}`: four distinct explorer URLs per category page would otherwise each render
  // the full explorer on hover/viewport — four DB-backed requests to show one category.
  // ⚠️ SERVER MODE OUTRANKS PREVIEW MODE. The link strip exists because sorting in place could not
  // reach past the page; when every sort IS a full query there is nothing to send the reader away
  // for, and doing so would drop them out of the scope they are standing in.
  const previewOnly = !serverMode && !!sortBase && !!scope && scope.total > scope.shown
  const sortLinks = previewOnly && (
    <nav
      aria-label={tr('Sort', 'Sắp xếp')}
      className="-mx-3 block border-b border-border px-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
    >
      <ul className="scrollbar-none flex w-full flex-nowrap items-center justify-start gap-1 overflow-x-auto">
        {/* Relevance is the order this page already IS — shown selected and announced as the current
            item of the set (`aria-current="true"`: any element of a set may carry it; "page" is for a
            link to the page you are on, which this is not). */}
        <li><span aria-current="true" className={sortTab(true)}>{tr('Relevance', 'Liên quan')}</span></li>
        {([
          ['recent', tr('Newest', 'Mới nhất'), null],
          ['popular', tr('Most contacted', 'Được quan tâm'), null],
          ['price-low', tr('Price', 'Giá'), <ArrowUp key="up" className="size-3.5" aria-hidden />],
          ['price-high', tr('Price', 'Giá'), <ArrowDown key="down" className="size-3.5" aria-hidden />],
        ] as const).map(([key, label, icon]) => (
          <li key={key}>
            <Link
              href={`${sortBase}${sortBase.includes('?') ? '&' : '?'}sort=${key}`}
              prefetch={false}
              className={sortTab(false)}
              aria-label={key === 'price-low' ? tr('Price, low to high', 'Giá, thấp đến cao') : key === 'price-high' ? tr('Price, high to low', 'Giá, cao đến thấp') : undefined}
            >
              {label}
              {icon}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
  const scopeNote = previewOnly && scope && (
    <p className="text-xs text-muted-foreground">
      {tr('Showing the top {shown} of {total} by relevance — choosing a sort searches all of them.', 'Đang hiển thị {shown} tin liên quan nhất trong {total} tin — chọn cách sắp xếp để tìm trong tất cả.')
        .replace('{shown}', scope.shown.toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US'))
        .replace('{total}', scope.total.toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US'))}
    </p>
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
  const serverNote = serverMode && (
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
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {shown.map((l, i) => (
        <div key={l.id} onMouseEnter={() => router.prefetch(`/listings/${l.id}`)} onTouchStart={() => router.prefetch(`/listings/${l.id}`)}>
          <ListingCard listing={l} onOpen={() => router.push(`/listings/${l.id}`)} onLocate={() => router.push(`/?focus=${l.id}`)} priority={i < 4} />
        </div>
      ))}
    </div>
  )

  if (!searchable && !sortable) return grid

  return (
    <div className="space-y-4" data-listings-ready={ready ? 'true' : undefined}>
      {sortable && (previewOnly ? sortLinks : sortStrip)}
      {sortable && scopeNote}
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
          as though they were the cheapest in the shop — a wrong answer that looks like a right one. */}
      {loadError ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
          <p className="text-sm text-muted-foreground">{tr("Couldn't load listings.", 'Không tải được tin đăng.')}</p>
          <Button
            variant="cta"
            size="none"
            onClick={() => { setLoadError(false); setRemote(null); setRefreshTick((t) => t + 1) }}
            className="ml-auto rounded-xl px-4 py-2 text-xs transition-colors cursor-pointer"
          >
            {tr('Try again', 'Thử lại')}
          </Button>
        </div>
      ) : null}

      {awaitingFirstRows ? (
        // Placeholders at the page size, so the grid keeps its height and nothing jumps when the
        // real cards land.
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" aria-hidden="true">
          {Array.from({ length: Math.min(pageSize, 8) }).map((_, i) => <ListingCardSkeleton key={i} />)}
        </div>
      ) : shown.length === 0 && !loading && !loadError ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{tr('No listings match.', 'Không có tin nào khớp.')}</p>
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
