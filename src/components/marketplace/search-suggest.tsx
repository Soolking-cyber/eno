'use client'

import { Search } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Price } from './price'
import { cn } from '@/lib/utils'
import type { SuggestListing, SuggestCategory } from '@/hooks/use-search-suggest'

// A flat, keyboard-navigable item list: categories first, then listings. The
// search bars own the active index and call onPick(items[activeIndex]) on Enter;
// the panel renders the same order so highlight + selection stay in sync.
export type SuggestItem = { type: 'category'; slug: string } | { type: 'listing'; id: string }

export function buildSuggestItems(categories: SuggestCategory[], listings: SuggestListing[]): SuggestItem[] {
  return [
    ...categories.map((c) => ({ type: 'category' as const, slug: c.slug })),
    ...listings.map((l) => ({ type: 'listing' as const, id: l.id })),
  ]
}

/** Instant-match results rendered inside a search bar's dropdown surface. Shared
 *  by the header + hero search so they're identical on mobile and desktop. */
export function SearchSuggest({
  listings, categories, loading, query, activeIndex, onPick, onSubmitQuery,
}: {
  listings: SuggestListing[]
  categories: SuggestCategory[]
  loading: boolean
  query: string
  activeIndex: number
  onPick: (it: SuggestItem) => void
  onSubmitQuery: () => void
}) {
  const { lang, tr } = useLanguage()
  const q = query.trim()
  const none = listings.length === 0 && categories.length === 0
  // onMouseDown + preventDefault so the pick fires BEFORE the input blurs and the
  // outside-click handler closes the panel.
  const pickDown = (fn: () => void) => (e: React.MouseEvent) => { e.preventDefault(); fn() }

  return (
    <div className="space-y-2">
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c, i) => (
            <button
              key={c.slug}
              type="button"
              onMouseDown={pickDown(() => onPick({ type: 'category', slug: c.slug }))}
              className={cn(
                'rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer',
                activeIndex === i ? 'bg-accent text-accent-foreground' : 'bg-tint text-body hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {lang === 'vi' ? c.nameVi : c.name}
            </button>
          ))}
        </div>
      )}

      {listings.map((l, i) => {
        const idx = categories.length + i
        const title = lang === 'vi' ? (l.titleVi || l.title) : l.title
        return (
          <button
            key={l.id}
            type="button"
            onMouseDown={pickDown(() => onPick({ type: 'listing', id: l.id }))}
            className={cn(
              'flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors cursor-pointer',
              activeIndex === idx ? 'bg-muted' : 'hover:bg-muted',
            )}
          >
            <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-tint">
              {l.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={l.image} alt="" className="h-full w-full object-cover" loading="lazy" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{title}</span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Price price={l.price} currency={l.currency} priceUnit={l.priceUnit} compact className="font-semibold text-accent-foreground" />
                <span className="truncate">· {l.location}</span>
              </span>
            </span>
          </button>
        )
      })}

      {!loading && none && (
        <p className="px-2 py-3 text-center text-xs text-muted-foreground">{tr('No matches yet', 'Chưa có kết quả')}</p>
      )}

      {q.length >= 2 && (
        <button
          type="button"
          onMouseDown={pickDown(onSubmitQuery)}
          className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm font-semibold text-accent-foreground hover:bg-muted transition-colors cursor-pointer"
        >
          <Search className="h-4 w-4 shrink-0" /> {tr('Search for', 'Tìm')} “{q}”
        </button>
      )}
    </div>
  )
}
