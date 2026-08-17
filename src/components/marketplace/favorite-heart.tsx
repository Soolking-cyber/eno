'use client'

import { useState } from 'react'
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
  // ⚠️ ONE-SHOT, AND ONLY ON A SAVE THE USER JUST MADE — the same `burst` flag listing-card.tsx
  // already uses (see its heart), adopted here because this copy was still keyed off `fav`.
  // `key={fav ? 'on' : 'off'}` remounted the span on ANY change to that boolean, and the favourites
  // Set is filled from localStorage AFTER hydration — so every load of a row whose listing was
  // already saved replayed the 0.42s pop and its expanding ring, unprompted, for a state the
  // visitor set on a previous visit. Celebration belongs to the act, not to the fact.
  const [burst, setBurst] = useState(false)
  return (
    <IconButton
      size="md"
      onClick={(e) => { e.stopPropagation(); if (!fav) setBurst(true); toggle(id) }}
      aria-pressed={fav}
      // A toggle's NAME stays put while `aria-pressed` carries the state — see the note on
      // listing-card.tsx's heart for why the flipping label was worse than redundant.
      aria-label={tr('Save listing', 'Lưu tin')}
      className={cn('transition-colors hover:bg-accent', className)}
    >
      {/* The pop is driven by `burst` — no `key`, so nothing remounts (see the note on the flag).
          ⚠️ THE `animationName` CHECK IS NOT DEFENSIVE, IT IS THE DIFFERENCE BETWEEN A 0.42s POP AND
          A 0.35s ONE. `.animate-heart-pop` runs TWO animations: `heart-pop` 0.42s on this span and
          `heart-ring` 0.35s on its ::after. animationend fires for each, and a pseudo-element's
          event surfaces on its originating element — so a bare handler was cleared by whichever
          finished FIRST, which is the ring, stripping the class and cutting the heart's own scale
          off 70ms early. Caught by opus reviewing the diff; the same bug was in listing-card.tsx,
          which this pattern was copied from, and is fixed there in the same commit.
          Saved = solid RED (--destructive), the app-wide saved colour since 2026-08-13 — the pair the icon
          language reserves its loudest treatment for (§5); h-5 keeps the heart on
          the same 20px step as the row's Tag/Chat/Pin neighbours. */}
      <span onAnimationEnd={(e) => { if (e.animationName === 'heart-pop') setBurst(false) }} className={cn('inline-flex', burst && 'animate-heart-pop')}>
        <Heart className={cn('icon-own-ink h-5 w-5 transition-colors', fav ? 'fill-current text-destructive' : 'text-foreground')} />
      </span>
    </IconButton>
  )
}
