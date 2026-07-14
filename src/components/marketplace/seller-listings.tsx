'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import type { SerializedListingCard } from '@/lib/types'
import { ListingCard } from './listing-card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { fold } from '@/lib/fold'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/context/language-context'

// The four learned sorts, applied in-memory to the already-loaded page of listings.
// The server hands them over in the rankScore blend, which IS "relevance" — so that
// tab is a no-op passthrough and costs nothing. On the /c/* SEO landing pages this
// gives the same sort strip as the explorer without turning those ISR pages dynamic.
type SortKey = 'relevance' | 'recent' | 'popular' | 'price-low' | 'price-high'

export function SellerListings({
  listings,
  searchable = false,
  sortable = false,
}: {
  listings: SerializedListingCard[]
  searchable?: boolean
  sortable?: boolean
}) {
  const router = useRouter()
  const { tr } = useLanguage()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortKey>('relevance')

  const shown = useMemo(() => {
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
  }, [listings, searchable, q, sortable, sort])

  if (listings.length === 0) return null

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
    <div className="space-y-4">
      {sortable && sortStrip}
      {searchable && (
        /* Just a search within this seller's catalog — no category/type filters. */
        <div className="flex items-center gap-2 rounded-xl bg-tint px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-ink-4" />
          <Input
            variant="unstyled"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tr('Search this seller', 'Tìm trong tin của người bán')}
            className="min-w-0 flex-1 text-sm"
          />
        </div>
      )}

      {shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{tr('No listings match.', 'Không có tin nào khớp.')}</p>
      ) : (
        grid
      )}
    </div>
  )
}
