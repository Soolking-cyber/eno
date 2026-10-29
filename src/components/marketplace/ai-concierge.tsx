'use client'

import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * The AI guide's mark: Solar `user-speak-rounded` (linear) — a person with two sound waves — whose waves pulse as if it
 * were speaking (owner, 2026-10-29: "replace the ai icon with human with sound animation there is one on solar pack").
 * ⚠️ INLINE, NOT A SPRITE GLYPH: the icon sprite draws through `<use>`, whose shadow tree no class can reach, so its
 * waves could not be animated one by one. Same 24px box, `currentColor` and Solar's own 1.5 stroke as the sprite's
 * linear glyphs (the magnifier and Map beside it). The pulse is `guide-wave` in globals.css; reduced motion stills it.
 */
export function GuideMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden className={className}>
      <circle cx="10" cy="6" r="4" />
      <ellipse cx="10" cy="17" rx="7" ry="4" />
      <path className="guide-wave guide-wave-near" d="M17 4C17 4 18 4.6 18 6C18 7.4 17 8 17 8" />
      <path className="guide-wave guide-wave-far" d="M19 2C19 2 21 3.2 21 6C21 8.8 19 10 19 10" />
    </svg>
  )
}

/** The AI guide's button inside every search bar — left of the map from sm up, and on a phone the field's right end
 *  (owner, 2026-10-29: "on mobile visible inside search bar right side"). Pressing it asks for help (client.ts
 *  askForHelp): the voice guide for the accounts its switch admits, the "eno AI" chat for everyone else. `active` is
 *  driven by the route so the mark lights up while you're on that chat. */
export function AISearchButton({
  active, onClick, className, iconClassName = 'h-6 w-6',
}: { active: boolean; onClick: () => void; className?: string; iconClassName?: string }) {
  const { tr } = useLanguage()
  return (
    <Button
      type="button"
      variant="bare"
      size="none"
      onClick={onClick}
      // NAVIGATION, not a toggle: `active` is derived from the route (header.tsx: pathname ===
      // '/messages/ai') and clicking only pushes to that chat — it never "un-presses". aria-pressed
      // would mis-announce this as a pressed toggle button, so mark the current view with aria-current
      // instead ("page", since it navigates to a distinct page).
      aria-current={active ? 'page' : undefined}
      aria-label={tr('AI shopping assistant', 'Trợ lý mua sắm AI')}
      title={tr('Ask eno AI', 'Hỏi eno AI')}
      className={cn(
        // Inactive = the search-bar icon standard (same as the magnifier + Map):
        // quiet ink, turns brand-blue on hover — a colour move only (icon-language §8;
        // scale-on-hover belongs to tile glyphs, not chrome).
        // Active = LOCATION state (§5, "you are here" on /messages/ai): brand ink. The ✨ took a
        // brand-100 wash in its body (WASH_ACTIVE); the guide mark is outlines only, with no
        // body to wash. The old solid bg-primary chip + shadow was the user-state treatment
        // shouting about mere location, and the one shadow in the bar.
        // ⛔ `active:duration-[60ms]` IS THE POINT OF THE WHOLE LINE, AND LEAVING IT OFF MADE THIS
        // BUTTON WORSE. Naming `scale` gives the press an easing it never had — but it also puts
        // it in the 200ms bucket, and `active:scale-[0.96]` was INSTANT before, because
        // `transition-colors` never covered scale. A reviewer caught the inversion: the sibling
        // hunk in the header added the active override in the same diff, this one did not, so the
        // change advertised as press polish delayed the acknowledgement on the search bar's most
        // tapped control. Press goes down fast and comes back on the slow curve.
        'rounded-full transition-[color,background-color,scale] duration-200 active:duration-[60ms] tap-44 relative active:scale-[0.96]',
        active ? 'text-accent-foreground' : 'text-ink-4 hover:text-accent-foreground',
        className,
      )}
    >
      <GuideMark className={iconClassName} />
    </Button>
  )
}
