'use client'

import { List, Grid, Map, Play, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

// Presentational toolbar pieces extracted from ListingsExplorer. Pure: they read a value +
// call a passed handler, own no state.
export type SortKey = 'newest' | 'recent' | 'price-low' | 'price-high' | 'popular'
export type ViewMode = 'compact' | 'grid' | 'map' | 'video'

/** List / Grid / Map / Video view-mode toggle icons. */
export function ViewToggles({ viewMode, onViewMode }: { viewMode: ViewMode; onViewMode: (m: ViewMode) => void }) {
  const { tr } = useLanguage()
  const tab = (mode: ViewMode) =>
    cn('rounded-lg p-2 transition-colors cursor-pointer', viewMode === mode ? 'text-accent-foreground' : 'text-body hover:bg-muted')
  return (
    <>
      <button onClick={() => onViewMode('compact')} aria-label={tr('List view', 'Danh sách')} aria-pressed={viewMode === 'compact'} title={tr('List view', 'Danh sách')} className={tab('compact')}>
        <List className="h-3.5 w-3.5" />
      </button>
      <button onClick={() => onViewMode('grid')} aria-label={tr('Grid view', 'Lưới')} aria-pressed={viewMode === 'grid'} title={tr('Grid view', 'Lưới')} className={tab('grid')}>
        <Grid className="h-3.5 w-3.5" />
      </button>
      <button onClick={() => onViewMode('map')} aria-label={tr('Map view', 'Bản đồ')} aria-pressed={viewMode === 'map'} title={tr('Map view', 'Xem Bản đồ')} className={tab('map')}>
        <Map className="h-3.5 w-3.5" />
      </button>
      <button onClick={() => onViewMode('video')} aria-label={tr('Video view', 'Video')} aria-pressed={viewMode === 'video'} title={tr('Video view', 'Xem Video')} className={tab('video')}>
        <Play className="h-3.5 w-3.5" />
      </button>
    </>
  )
}

/** One-row sort strip (Shopee's learned pattern: Liên quan | Mới nhất | Được quan tâm | Giá) —
 *  one-tap tabs on all sizes. Sticky below the header's slot; the offset follows the header
 *  when it auto-hides on scroll-down. The price tab carries its direction arrow (asc → re-tap
 *  flips). onPickSort wraps the parent's startFilterTransition(setSort). */
export function SortStrip({
  sort,
  onPickSort,
  headerHidden,
}: {
  sort: SortKey
  onPickSort: (s: SortKey) => void
  headerHidden: boolean
}) {
  const { tr } = useLanguage()
  const priceSortActive = sort === 'price-low' || sort === 'price-high'
  const sortTab = (selected: boolean) =>
    cn(
      '-mb-px flex shrink-0 items-center gap-1 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors cursor-pointer',
      selected ? 'border-brand text-accent-foreground' : 'border-transparent text-body hover:text-foreground',
    )
  return (
    <div
      className={cn(
        // Swapping `top` (vs transform) is a no-op while still in normal flow, so it never
        // jolts the layout above — it only glides once actually stuck.
        'sticky z-30 border-b border-border bg-background/95 backdrop-blur transition-[top] duration-[250ms] ease-out motion-reduce:transition-none',
        headerHidden ? 'top-0' : 'top-[calc(env(safe-area-inset-top)+4rem)]',
        // Edge bleed coupled to the page gutter (max-w-7xl px-3 sm:px-6 lg:px-8).
        '-mx-3 px-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8',
      )}
    >
      <div className="scrollbar-none flex flex-nowrap items-center gap-1 overflow-x-auto">
        <button type="button" onClick={() => onPickSort('newest')} aria-pressed={sort === 'newest'} className={sortTab(sort === 'newest')}>
          {tr('Relevance', 'Liên quan')}
        </button>
        <button type="button" onClick={() => onPickSort('recent')} aria-pressed={sort === 'recent'} className={sortTab(sort === 'recent')}>
          {tr('Newest', 'Mới nhất')}
        </button>
        <button type="button" onClick={() => onPickSort('popular')} aria-pressed={sort === 'popular'} className={sortTab(sort === 'popular')}>
          {tr('Most contacted', 'Được quan tâm')}
        </button>
        <button
          type="button"
          onClick={() => onPickSort(sort === 'price-low' ? 'price-high' : 'price-low')}
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
}
