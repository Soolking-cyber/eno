'use client'

import { Heart } from 'lucide-react'
import { useFavorites } from '@/context/favorites-context'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

/**
 * Heart/favorite toggle for listing rows (list + map views), matching the grid
 * ListingCard's heart. stopPropagation so tapping it never opens the listing.
 */
export function FavoriteHeart({ id, className }: { id: string; className?: string }) {
  const { isFavorite, toggle } = useFavorites()
  const { tr } = useLanguage()
  const fav = isFavorite(id)
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); toggle(id) }}
      aria-pressed={fav}
      aria-label={fav ? tr('Remove favorite', 'Bỏ lưu') : tr('Add favorite', 'Lưu tin')}
      className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors cursor-pointer hover:bg-accent', className)}
    >
      {/* key remounts on toggle → re-runs the CSS pop (same as the grid card) */}
      <span key={fav ? 'on' : 'off'} className={cn('inline-flex', fav && 'animate-heart-pop')}>
        <Heart className={cn('h-[18px] w-[18px] transition-colors', fav ? 'fill-[#0a66c2] text-accent-foreground' : 'text-foreground')} />
      </span>
    </button>
  )
}
