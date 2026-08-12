'use client'

import { Heart } from '@/components/ui/icons'
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
      {/* key remounts on toggle → re-runs the CSS pop (same as the grid card).
          Saved = fill-brand + text-brand line — the exact user-state pair the icon
          language reserves its loudest treatment for (§5); h-5 keeps the heart on
          the same 20px step as the row's Tag/Chat/Pin neighbours. */}
      <span key={fav ? 'on' : 'off'} className={cn('inline-flex', fav && 'animate-heart-pop')}>
        <Heart className={cn('h-5 w-5 transition-colors', fav ? 'fill-brand text-brand' : 'text-foreground')} />
      </span>
    </IconButton>
  )
}
