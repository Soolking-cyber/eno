'use client'

import { useState } from 'react'
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
  // ⚠️ THE POP IS DRIVEN BY THE CLICK, NOT BY `saved`. Both spans below used
  // `key={saved ? 'on' : 'off'}`, which remounts on ANY change to that boolean — and the favourites
  // Set is hydrated from localStorage AFTER first paint. So opening the PDP of a listing you had
  // ALREADY saved played the 0.42s pop and its expanding red ring every single time, celebrating a
  // decision made on some earlier visit. Same one-shot flag listing-card.tsx uses; the `if (!saved)`
  // guard below preserves the rule this file already states — an unsave is not a celebration.
  const [burst, setBurst] = useState(false)
  const onToggle = () => { if (!saved) setBurst(true); toggle(id) }

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
        onClick={onToggle}
        aria-pressed={saved}
        // Icon-only, so nothing visible pins the name: it stays CONSTANT and `aria-pressed`
        // reports the state, which is the ARIA toggle pattern the other four hearts now use.
        // ⚠️ The TEXT variant below deliberately does NOT do this — see the note there.
        aria-label={tr('Save listing', 'Lưu tin')}
        className={cn('press', className)}
      >
        {/* §5 user-state + §8 motion: the same one-shot pop the grid card and the row heart use.
            ⚠️ IT IS NO LONGER A KEY REMOUNT — this comment used to describe `key` flipping so the
            span remounts and the CSS animation re-runs, which is exactly the mechanism that made it
            fire unprompted on load (see the note on `burst`). The pop now rides on a flag set in the
            click handler. The PDP was the one save surface with no confirmation at all, which made
            the loudest state change in the system the quietest moment; that is still the point.
            Only ever on SAVE — an unsave is not a celebration. */}
        <span onAnimationEnd={(e) => { if (e.animationName === 'heart-pop') setBurst(false) }} className={cn('inline-flex', burst && 'animate-heart-pop')}>
          <Heart className={cn('icon-own-ink h-5 w-5', saved ? 'fill-current text-destructive' : 'fill-black/25')} />
        </span>
      </IconButton>
    )
  }

  return (
    <Button
      variant="bare"
      size="none"
      type="button"
      onClick={onToggle}
      aria-pressed={saved}
      // ⚠️ THE ONE HEART WHOSE NAME STILL CHANGES, AND IT IS NOT AN OVERSIGHT — but note first
      // that THIS BRANCH HAS NO CALL SITES TODAY (grepped 2026-08-17: both `<SaveListingButton>`
      // usages on the PDP pass `compact`). So it is the rule for whoever renders it next, not a
      // pattern the app currently ships.
      // Every heart that DOES render is icon-only and takes a constant name (the ARIA toggle
      // pattern). This one renders `label` as visible text, and WCAG 2.5.3 Label in Name wants
      // the accessible name to contain what is on screen — pinning it to "Save listing" while
      // the button reads "Saved" would break speech control ("click Saved" matching nothing).
      // The pairing that is actually harmful is a name describing the next ACTION ("Remove
      // favorite") next to aria-pressed; "Saved" + pressed is merely redundant, never wrong.
      // ⚠️ The text is `hidden sm:inline`, so below `sm` this is icon-only and aria-label is the
      // whole name — which is why it cannot simply be dropped in favour of the visible text.
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
      <span onAnimationEnd={(e) => { if (e.animationName === 'heart-pop') setBurst(false) }} className={cn('inline-flex', burst && 'animate-heart-pop')}>
        <Heart className={cn('icon-own-ink h-4 w-4', saved && 'fill-current text-destructive')} />
      </span>
      <span className="hidden sm:inline">{label}</span>
    </Button>
  )
}
