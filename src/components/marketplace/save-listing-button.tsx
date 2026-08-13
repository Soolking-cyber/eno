'use client'

import { Heart } from '@/components/ui/icons'
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
        className={cn('press', className)}
      >
        {/* §5 user-state + §8 motion: the same key-remount pop the grid card and the row heart
            use (`key` flips → the span remounts → the CSS one-shot re-runs). The PDP was the
            one save surface with no confirmation at all, which made the loudest state change in
            the system the quietest moment. Only ever on SAVE — an unsave is not a celebration. */}
        <span key={saved ? 'on' : 'off'} className={cn('inline-flex', saved && 'animate-heart-pop')}>
          <Heart className={cn('h-5 w-5', saved ? 'fill-current text-destructive' : 'fill-black/25')} />
        </span>
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
        'press flex gap-1.5 rounded-xl border px-3.5 py-2 font-semibold transition-colors',
        saved ? 'border-brand text-accent-foreground' : 'border-border text-body hover:border-brand hover:text-accent-foreground',
        className,
      )}
    >
      {/* Saved = solid RED (--destructive), the same pair FavoriteHeart uses. ⚠️ The colour rides on
          text-*, never fill-*: these glyphs paint every path with fill="currentColor", so a `fill:`
          set on the <svg> never reaches the ink (that bug made both states render white). */}
      <span key={saved ? 'on' : 'off'} className={cn('inline-flex', saved && 'animate-heart-pop')}>
        <Heart className={cn('h-4 w-4', saved && 'fill-current text-destructive')} />
      </span>
      <span className="hidden sm:inline">{label}</span>
    </Button>
  )
}
