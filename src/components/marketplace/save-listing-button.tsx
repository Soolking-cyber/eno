'use client'

import { Heart } from 'lucide-react'
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
    return (
      <button
        type="button"
        onClick={() => toggle(id)}
        aria-pressed={saved}
        aria-label={label}
        className={cn(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors active:scale-90',
          saved ? 'border-brand text-accent-foreground' : 'border-border text-body',
          className,
        )}
      >
        <Heart className={cn('h-5 w-5', saved && 'fill-brand')} />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => toggle(id)}
      aria-pressed={saved}
      aria-label={label}
      className={cn(
        'flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-semibold transition-colors cursor-pointer active:scale-95',
        saved ? 'border-brand text-accent-foreground' : 'border-border text-body hover:border-brand hover:text-accent-foreground',
        className,
      )}
    >
      <Heart className={cn('h-4 w-4', saved && 'fill-brand')} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}
