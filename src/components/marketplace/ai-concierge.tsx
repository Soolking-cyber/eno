'use client'

import { Sparkles } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { UiArt } from '@/components/marketplace/ui-art'
import { Button } from '@/components/ui/button'
import { STROKE_NAV, WASH_ACTIVE } from '@/lib/icon-tokens'
import { cn } from '@/lib/utils'

/** The AI icon that sits left of the map in every search bar. Pressing it opens the
 *  "eno AI" conversation in the messages tab (a native chat, not a popup). `active` is
 *  driven by the route so the icon lights up while you're on that chat. */
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
        // Active = LOCATION state (§5, "you are here" on /messages/ai), so it takes the
        // same soft duotone as the bottom nav's active tab: brand ink + the brand-100
        // wash inside the big sparkle (WASH_ACTIVE fills the first path only — the body
        // a child would colour in). The old solid bg-primary chip + shadow was the
        // user-state treatment shouting about mere location, and the one shadow in the bar.
        'rounded-full transition-colors duration-200 tap-44 relative active:scale-[0.96]',
        active ? cn('text-accent-foreground', WASH_ACTIVE) : 'text-ink-4 hover:text-accent-foreground',
        className,
      )}
    >
      {/* ⚠️ THE PACK'S GLYPH, LIKE ITS NEIGHBOURS. This was the last lucide icon in the search bar
          after the magnifier and the map moved to the outline set, and it read as a different
          family sitting between them. `lit` follows the button's own active state — this control
          CAN be pressed, unlike the decorative magnifier beside it. */}
      <UiArt name="ai" lit={active} className={iconClassName} />
    </Button>
  )
}
