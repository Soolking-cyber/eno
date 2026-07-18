'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { useHideOnScroll } from '@/hooks/use-hide-on-scroll'
import { hapticTap } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { IconButton } from '@/components/ui/icon-button'

// Match the header/bottom-nav lucide weight (see header.tsx STROKE).
const STROKE = 2.25

// Client-side navigations THIS document has performed (module scope survives route
// changes, resets on a full load — exactly the lifetime history entries share).
// document.referrer can't tell us this: it stays pinned to the ORIGINAL referrer
// for the whole SPA session.
let inAppNavCount = 0

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
export function SectionHeader({ title, action }: {
  /** The section's established page title — callers pass their EXISTING tr() string. */
  title: React.ReactNode
  /** Optional right-side action (a compact Button/IconButton). */
  action?: React.ReactNode
}) {
  const { tr } = useLanguage()
  const router = useRouter()
  const pathname = usePathname()
  useEffect(() => { inAppNavCount += 1 }, [pathname])
  // Same hook (same thresholds) the Header runs, so this bar's `top` swap tracks the
  // header's own hide/reveal frame-for-frame — the explorer SortStrip pattern.
  const headerHidden = useHideOnScroll()

  const onBack = () => {
    hapticTap()
    // Deep link / fresh tab / cold native start: nothing to pop — land on the
    // dashboard home instead of a dead tap.
    // history.length counts ANY prior page — a dashboard deep link opened from another
    // site would Back OUT of eno.vn. document.referrer is pinned to the ORIGINAL
    // referrer for the whole SPA session, so it can't be the only signal (a Google
    // arrival would never satisfy it). An in-app client-navigation counter is the
    // truth: >1 means the previous history entry is ours.
    if (window.history.length > 1 && (inAppNavCount > 1 || document.referrer.startsWith(window.location.origin))) router.back()
    else router.push('/dashboard')
  }

  return (
    <div
      className={cn(
        // Mobile-only stack chrome (mobile-nav uses the same lg:hidden gate).
        'lg:hidden sticky z-30 flex h-12 items-center gap-1 border-b border-border bg-card',
        // Bleed to the dashboard layout's gutter (max-w-7xl px-3 sm:px-6) and pull up
        // flush under the site header through main's py-6, like a real pushed screen.
        '-mx-3 -mt-6 mb-4 px-3 sm:-mx-6 sm:px-6',
        // Swapping `top` (vs transform) is a no-op while in normal flow — it only
        // glides once stuck (explorer-toolbar idiom, incl. the safe-area term).
        'transition-[top] duration-[250ms] ease-out motion-reduce:transition-none',
        // Even with the site header hidden, the bar must stay below the notch on native.
        headerHidden ? 'top-[env(safe-area-inset-top)]' : 'top-[calc(env(safe-area-inset-top)+4rem)]',
      )}
    >
      <IconButton
        size="lg"
        onClick={onBack}
        aria-label={tr('Back', 'Quay lại')}
        // tap-48 is defined after tap-44 in globals.css, so it wins over the baked one.
        className="press tap-48 -ml-2 text-foreground"
      >
        <ChevronLeft className="h-6 w-6" strokeWidth={STROKE} aria-hidden />
      </IconButton>
      {/* Plain text, not a heading — each page keeps its real h1 (sr-only on mobile
          where it would double the bar), so the document outline never forks. */}
      <span className="min-w-0 flex-1 truncate text-base font-bold text-foreground">{title}</span>
      {action ? <div className="flex shrink-0 items-center">{action}</div> : null}
    </div>
  )
}
