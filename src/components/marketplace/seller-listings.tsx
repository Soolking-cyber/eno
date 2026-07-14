'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import type { SerializedListingCard } from '@/lib/types'
import { ListingCard } from './listing-card'
import { Button } from '@/components/ui/button'
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
  const sortTab = (selected: boolean) =>
    cn(
      // rounded-none: ui/button's base is rounded-xl, which would round the ends of
      // this tab's border-b-2 underline. Everything else (gap-1, font-semibold, the
      // box) is a className override on the <Button> itself, so cn() merges it.
      '-mb-px flex shrink-0 items-center gap-1 rounded-none border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors cursor-pointer',
      selected ? 'border-brand text-accent-foreground' : 'border-transparent text-body hover:text-foreground',
    )
  // Same tab visuals as the explorer's results strip (kept in sync deliberately),
  // minus the sticky/header-hide coupling — this landing page is short.
  const sortStrip = (
    <div className="-mx-3 border-b border-border px-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="scrollbar-none flex flex-nowrap items-center gap-1 overflow-x-auto">
        <Button variant="bare" size="none" type="button" onClick={() => setSort('relevance')} aria-pressed={sort === 'relevance'} className={sortTab(sort === 'relevance')}>
          {tr('Relevance', 'Liên quan')}
        </Button>
        <Button variant="bare" size="none" type="button" onClick={() => setSort('recent')} aria-pressed={sort === 'recent'} className={sortTab(sort === 'recent')}>
          {tr('Newest', 'Mới nhất')}
        </Button>
        <Button variant="bare" size="none" type="button" onClick={() => setSort('popular')} aria-pressed={sort === 'popular'} className={sortTab(sort === 'popular')}>
          {tr('Most contacted', 'Được quan tâm')}
        </Button>
        <Button
          variant="bare"
          size="none"
          type="button"
          onClick={() => setSort(sort === 'price-low' ? 'price-high' : 'price-low')}
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
        </Button>
      </div>
    </div>
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
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tr('Search this seller', 'Tìm trong tin của người bán')}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-ink-4"
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
