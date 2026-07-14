'use client'

import { Heart } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
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
    <IconButton
      size="md"
      onClick={(e) => { e.stopPropagation(); toggle(id) }}
      aria-pressed={fav}
      aria-label={fav ? tr('Remove favorite', 'Bỏ lưu') : tr('Add favorite', 'Lưu tin')}
      className={cn('transition-colors hover:bg-accent', className)}
    >
      {/* key remounts on toggle → re-runs the CSS pop (same as the grid card) */}
      <span key={fav ? 'on' : 'off'} className={cn('inline-flex', fav && 'animate-heart-pop')}>
        <Heart className={cn('h-[18px] w-[18px] transition-colors', fav ? 'fill-brand text-accent-foreground' : 'text-foreground')} />
      </span>
    </IconButton>
  )
}
