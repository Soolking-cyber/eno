'use client'

import { TrendingUp } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { chipVariants } from '@/components/ui/chip'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

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
      {/* The browse chip — ui/chip `md` with its 44px hit area (owner, 2026-10-18: one chip style), the same as
          the header panel's recent-location and category chips beside it. `gap-2` so wrapped rows' hit areas meet. */}
      <div className="flex flex-wrap gap-2">
        {items.map((term, i) => (
          <Button
            key={i}
            type="button"
            variant="bare"
            size="none"
            onClick={() => onPick(term)}
            className={cn(chipVariants({ size: 'md', tone: 'neutral' }), 'relative tap-44 whitespace-normal')}
          >
            {term}
          </Button>
        ))}
      </div>
    </div>
  )
}
