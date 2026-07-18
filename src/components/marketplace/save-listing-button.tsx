'use client'

import { Heart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useFavorites } from '@/context/favorites-context'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

/**
 * Save (favorite) toggle for the listing detail page. Device-local via the
 * favorites context (same store as the bottom-nav Saved tab + /saved page).
 * `compact` renders an icon-only circular button for the mobile sticky bar.
 */
export function SaveListingButton({ id, compact = false, className }: { id: string; compact?: boolean; className?: string }) {
  const { isFavorite, toggle } = useFavorites()
  const { tr } = useLanguage()
  const saved = isFavorite(id)
  const label = saved ? tr('Saved', 'Đã lưu') : tr('Save', 'Lưu')

  if (compact) {
    // Over-media treatment (our icon aesthetic, matching ListingCard's overlay controls): NO circle
    // background — a white glyph + baked drop-shadow reads on any photo (light OR dark), and the
    // unsaved heart carries a translucent-black fill so it stays visible on bright images too.
    return (
      <Button
        variant="bare"
        size="none"
        type="button"
        onClick={() => toggle(id)}
        aria-pressed={saved}
        aria-label={label}
        className={cn(
          'flex h-9 w-9 items-center justify-center text-white transition-transform active:scale-90 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.55))]',
          className,
        )}
      >
        <Heart className={cn('h-5 w-5', saved ? 'fill-brand' : 'fill-black/25')} />
      </Button>
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
        'flex gap-1.5 rounded-xl border px-3.5 py-2 font-semibold transition-colors active:scale-95',
        saved ? 'border-brand text-accent-foreground' : 'border-border text-body hover:border-brand hover:text-accent-foreground',
        className,
      )}
    >
      <Heart className={cn('h-4 w-4', saved && 'fill-brand')} />
      <span className="hidden sm:inline">{label}</span>
    </Button>
  )
}
