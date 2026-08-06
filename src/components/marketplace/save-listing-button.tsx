'use client'

import { Heart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { useFavorites } from '@/context/favorites-context'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

/**
 * Save (favorite) toggle for the listing detail page. Device-local via the
 * favorites context (same store as the bottom-nav Saved tab + /saved page).
 * `compact` renders an icon-only circular button for the gallery overlay.
 */
export function SaveListingButton({ id, compact = false, className }: { id: string; compact?: boolean; className?: string }) {
  const { isFavorite, toggle } = useFavorites()
  const { tr } = useLanguage()
  const saved = isFavorite(id)
  const label = saved ? tr('Saved', 'Đã lưu') : tr('Save', 'Lưu')

  if (compact) {
    // Over-media treatment via the shared shell: <IconButton variant="overlay"> IS the
    // white-ink + baked-drop-shadow language (no circle chip — a hover chip over a photo
    // looks like a bug), and it pairs 1:1 with ShareButton's compact trigger beside it.
    // Heart states are the sanctioned overlay pair from the icon-button header comment:
    // saved = solid fill-brand (§5 user-state, the loudest mark in the system) on white
    // line; unsaved = translucent-black interior so the outline reads on bright photos.
    return (
      <IconButton
        size="md"
        variant="overlay"
        onClick={() => toggle(id)}
        aria-pressed={saved}
        aria-label={label}
        className={cn('transition-transform active:scale-[0.96]', className)}
      >
        <Heart className={cn('h-5 w-5', saved ? 'fill-brand text-white' : 'fill-black/25')} />
      </IconButton>
    )
  }

  return (
    <Button
      variant="bare"
      size="none"
      type="button"
      onClick={() => toggle(id)}
      aria-pressed={saved}
      aria-label={label}
      className={cn(
        'flex gap-1.5 rounded-xl border px-3.5 py-2 font-semibold transition-colors active:scale-[0.96]',
        saved ? 'border-brand text-accent-foreground' : 'border-border text-body hover:border-brand hover:text-accent-foreground',
        className,
      )}
    >
      {/* Saved = fill-brand + text-brand line — the exact §5 user-state pair FavoriteHeart uses. */}
      <Heart className={cn('h-4 w-4', saved && 'fill-brand text-brand')} />
      <span className="hidden sm:inline">{label}</span>
    </Button>
  )
}
