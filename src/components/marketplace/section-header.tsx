'use client'

import { ChevronLeft } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { useHideOnScroll } from '@/hooks/use-hide-on-scroll'
import { useSafeBack } from '@/lib/safe-back'
import { cn } from '@/lib/utils'
import { IconButton } from '@/components/ui/icon-button'
// Nav-chrome tier (icon-language §2) — the same platform weight the header and
// bottom nav render, imported so the tiers can never drift apart.
import { STROKE_NAV } from '@/lib/icon-tokens'

/** Mobile-only (lg:hidden) pushed-screen TITLE BAR for /dashboard/* section pages —
 *  the native stack-navigation affordance: back chevron · section title · optional
 *  right-side action. Sticks just under the site header inside the content pane,
 *  gliding to top-0 when the header auto-hides (the explorer-toolbar idiom: swap
 *  `top`, never transform, so it only moves once actually stuck).
 *
 *  ⚠️ This bar COMPLEMENTS iOS swipe-back and the Android hardware/gesture back
 *  (both already handled globally — native-bootstrap routes the Android button,
 *  the WebView owns edge-swipe). It must never try to replace them: it's the
 *  visible affordance for users who reach for a button, nothing more.
 *
 *  Desktop is untouched by design — at lg+ the section renders beside the account
 *  nav rail with its own h1, so this whole bar is display:none there. */
export function SectionHeader({ title, action, fallbackHref = '/dashboard/listings' }: {
  /** The section's established page title — callers pass their EXISTING tr() string. */
  title: React.ReactNode
  /** Optional right-side action (a compact Button/IconButton). */
  action?: React.ReactNode
  /** Where Back lands when there is no in-app history to pop (deep link / fresh
   *  tab / cold native start). Section SUB-pages pass their parent section
   *  (e.g. /dashboard/trips/plan → /dashboard/trips); top-level sections keep
   *  the dashboard-home default. */
  fallbackHref?: string
}) {
  const { tr } = useLanguage()
  // Same hook (same thresholds) the Header runs, so this bar's `top` swap tracks the
  // header's own hide/reveal frame-for-frame — the explorer SortStrip pattern.
  const headerHidden = useHideOnScroll()

  // POP when there's one of our own entries behind us, PUSH `fallbackHref` only on a deep
  // link / fresh tab / cold native start. Pushing unconditionally would grow the stack and
  // let the next hardware-back walk straight back into the screen just left. The whole
  // "is there history to pop?" question lives in src/lib/safe-back.ts — shared with the
  // chat threads' back chevron; don't re-derive it here.
  const onBack = useSafeBack(fallbackHref)

  return (
    <div
      className={cn(
        // Mobile-only stack chrome (mobile-nav uses the same lg:hidden gate).
        // min-h-12, not h-12: with OS text scaling live (src/lib/native-text-zoom.ts) the title's
        // line box and any `action` control grow, and a 48px box pinned by `height` would clip them
        // (Tailwind v4's line-heights are unitless ratios, so they scale with the glyphs). At the
        // default size the tallest child is the 40px back button, so the bar still renders at
        // exactly 48px — identical to before.
        'lg:hidden sticky z-30 flex min-h-12 items-center gap-1 border-b border-border bg-card',
        // Bleed to the dashboard layout's gutter (max-w-7xl px-3 sm:px-6) and pull up
        // flush under the site header through main's py-6, like a real pushed screen.
        '-mx-3 -mt-6 mb-4 px-3 sm:-mx-6 sm:px-6',
        // Swapping `top` (vs transform) is a no-op while in normal flow — it only
        // glides once stuck (explorer-toolbar idiom, incl. the safe-area term).
        'transition-[top] duration-[250ms] ease-out motion-reduce:transition-none',
        // Even with the site header hidden, the bar must stay below the notch on native. Use the
        // dual-path inset like #app-header (globals.css): env(safe-area-inset-top) on iOS, and the
        // native-set var(--safe-area-inset-top) on Android where env() is 0 — env()-only would drop
        // the bar under the Android status bar the moment the site header hides.
        headerHidden
          ? 'top-[max(env(safe-area-inset-top),var(--safe-area-inset-top,0px))]'
          : 'top-[calc(max(env(safe-area-inset-top),var(--safe-area-inset-top,0px))+4rem)]',
      )}
    >
      <IconButton
        size="lg"
        onClick={onBack}
        aria-label={tr('Back', 'Quay lại')}
        // tap-48 is defined after tap-44 in globals.css, so it wins over the baked one.
        className="press tap-48 -ml-2 text-foreground"
      >
        <ChevronLeft className="h-6 w-6" strokeWidth={STROKE_NAV} aria-hidden />
      </IconButton>
      {/* Plain text, not a heading — each page keeps its real h1 (sr-only on mobile
          where it would double the bar), so the document outline never forks. */}
      <span className="min-w-0 flex-1 truncate text-base font-bold text-foreground">{title}</span>
      {action ? <div className="flex shrink-0 items-center">{action}</div> : null}
    </div>
  )
}
