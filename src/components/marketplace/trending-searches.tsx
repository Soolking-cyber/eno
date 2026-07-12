'use client'

import { TrendingUp } from 'lucide-react'
import { useLanguage } from '@/context/language-context'

// Shared "Xu hướng tìm kiếm" chip row for the empty-focus search dropdowns. One
// component used by BOTH the header panel (variant="header") and the landing hero
// panel (variant="hero") so mobile + desktop render identically. Items come from
// the useTrendingSearches hook (already fetched/cancelled/fail-open); this is a pure
// presentational leaf that renders nothing when there's nothing trending.
export function TrendingSearches({
  items,
  onPick,
  variant = 'header',
}: {
  items: string[]
  onPick: (term: string) => void
  variant?: 'header' | 'hero'
}) {
  const { tr } = useLanguage()
  if (items.length === 0) return null

  const labelCls =
    variant === 'hero'
      ? 'eyebrow flex items-center gap-1 text-body'
      : 'flex items-center gap-1 text-2xs font-bold uppercase tracking-wider text-muted-foreground'

  return (
    <div className="space-y-1.5">
      <span className={labelCls}>
        <TrendingUp className="h-3 w-3" />
        {tr('Trending', 'Xu hướng tìm kiếm')}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {items.map((term, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onPick(term)}
            className="rounded-xl px-3.5 py-2 text-sm font-semibold text-body hover:bg-muted hover:text-accent-foreground transition-colors cursor-pointer"
          >
            {term}
          </button>
        ))}
      </div>
    </div>
  )
}
