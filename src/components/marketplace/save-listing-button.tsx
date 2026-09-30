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
    // outlined-white-ink language (no chip — owner, 2026-08-18), and it pairs 1:1 with
    // ShareButton's compact trigger beside it.
    // saved = solid fill on the destructive red (§5 user-state, the loudest mark in the system).
    // ⛔ UNSAVED IS `fill-none`, NOT THE OLD `fill-black/25`. That translucent black interior existed
    // "so the outline reads on bright photos" — a job the overlay variant's own dark STROKE now does
    // on the glyph itself, and does better. ⚠️ The reason survived a same-day design reversal: it was
    // first removed because the dark chip made it a muddy blob, and the chip is gone now — but a
    // filled interior would still fight the outline, which is the thing carrying legibility. Empty
    // is right in both designs, for two different reasons.
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
          <Heart className={cn('icon-own-ink h-5 w-5', saved ? 'fill-current text-destructive' : 'fill-none')} />
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
      // ⚠️ A CONSTANT NAME, LIKE EVERY OTHER HEART — AND SO A CONSTANT VISIBLE WORD. This branch
      // had no call sites until the compact linked-job header (O-28, 2026-09-30), and it used to
      // flip its name Save/Saved. Once it shipped, the PDP's save control stopped answering to
      // "Save listing" on job pages and the guest e2e (listing.spec "the save heart is a real ARIA
      // toggle") went red. The name is now "Save listing" in both states, `aria-pressed` carries the
      // state, and the red solid heart + brand border are the visible state.
      // ⚠️ WHY THE VISIBLE TEXT NO LONGER SAYS "Saved": WCAG 2.5.3 Label in Name wants the
      // accessible name to CONTAIN the visible label. "Save listing" contains "Save"; it does not
      // contain "Saved", so a flipping word would break speech control ("click Saved" matching
      // nothing). Vietnamese holds the same way: "Lưu tin" contains "Lưu".
      // ⚠️ The text is `hidden sm:inline`, so below `sm` this is icon-only and aria-label is the
      // whole name — which is why it cannot simply be dropped in favour of the visible text.
      aria-label={tr('Save listing', 'Lưu tin')}
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
      <span className="hidden sm:inline">{tr('Save', 'Lưu')}</span>
    </Button>
  )
}
