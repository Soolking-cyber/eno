'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import { ChevronUp } from 'lucide-react'
import { HelpPopover } from './help-popover'
import { useAccountPanel } from './account-panel'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Floating bottom-right controls, portaled to <body> (no ancestor can offset them),
 *  above the mobile bottom-nav. A bare chevron "back to top" that fades in after
 *  scrolling, stacked over an always-present "?" Help button — both circle-less. */
export function BackToTop() {
  const [show, setShow] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  // Mounted inside AccountPanelShell (see layout.tsx) purely to read this.
  const { open: panelOpen } = useAccountPanel()
  // Extra clearance when a page renders a sticky bottom bar (listing contact bar,
  // post-wizard publish bar, availability bar — all marked data-fab-clear): the
  // controls must sit ABOVE the bar, never over its CTA.
  const [lift, setLift] = useState(0)
  const pathname = usePathname()

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    const measure = () => {
      let extra = 0
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-fab-clear]'))) {
        const r = el.getBoundingClientRect()
        if (r.height > 0 && r.top < window.innerHeight) extra = Math.max(extra, window.innerHeight - r.top)
      }
      setLift((p) => (Math.abs(p - extra) > 1 ? extra : p))
    }
    const onScroll = () => { setShow(window.scrollY > 700); measure() }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', measure, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', measure)
    }
  }, [])

  if (!mounted) return null
  // The messenger owns the bottom-right corner (its composer's Send button + the AI
  // "Ask" bar), and its panes don't page-scroll — so the floating "?" / back-to-top
  // would only overlay the composer. Suppress the whole cluster there.
  if (pathname?.startsWith('/messages')) return null

  return createPortal(
    <>
      <div
        className={cn(
          'fixed z-[60] flex flex-col items-center gap-2.5',
          'bottom-[calc(5rem+env(safe-area-inset-bottom))] lg:bottom-6', // clear the mobile bottom-nav
          // The account rail now lives on the LEFT (a 72px collapsed column, owner 2026-07-17), so
          // the bottom-RIGHT controls no longer overlap it and need no --account-w offset — they
          // stay pinned to the right edge. Below lg the panel owns the whole screen when open, so
          // they stand down (max-lg:hidden). Same spring for a calm settle.
          'right-4 transition-[right] duration-300 motion-reduce:transition-none lg:right-6',
          panelOpen && 'max-lg:hidden',
        )}
        // Inline bottom (beats the classes) only while a bottom bar is on screen.
        style={{ ...(lift ? { bottom: lift + 12 } : {}), transitionTimingFunction: 'var(--ease-spring)' }}
      >
        {/* Back to top — bare glyph, no circle: same treatment as the search-bar
            icons (quiet ink → brand blue on hover) with a subtle drop-shadow so it
            stays distinct over card imagery. Fades in once scrolled (slot reserved
            so the ? never shifts); transform/opacity only. */}
        <Button
          variant="bare"
          size="none"
          type="button"
          aria-label="Back to top"
          // opacity-0 + pointer-events-none hides this from the MOUSE only: none of the
          // three classes below removes the button from the TAB ORDER or the accessibility
          // tree, so a keyboard user used to tab into an invisible "Back to top". `inert`
          // is the one lever that removes all three (focus, pointer, a11y tree);
          // aria-hidden + tabIndex=-1 are the fallback for browsers without it.
          // NOT `hidden`/display:none — the slot must keep its size so the "?" below never
          // shifts as this fades in.
          inert={!show}
          aria-hidden={!show || undefined}
          tabIndex={show ? undefined : -1}
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className={cn(
            'relative flex h-11 w-11 items-center justify-center text-body transition-all duration-200 hover:text-accent-foreground hover:scale-110 active:scale-90 tap-44',
            show ? 'opacity-100 translate-y-0' : 'pointer-events-none opacity-0 translate-y-2',
          )}
        >
          <ChevronUp className="h-7 w-7 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.28))]" strokeWidth={2.5} />
        </Button>

        {/* Help — bare "?", DESKTOP ONLY (on mobile, Help lives in the profile page
            next to Post/Listings/Settings, so it's not a floating popup there). */}
        <Button
          variant="bare"
          size="none"
          type="button"
          aria-label="Help"
          aria-haspopup="dialog"
          onClick={() => setHelpOpen(true)}
          className="relative hidden h-9 w-9 items-center justify-center text-body transition-all duration-200 hover:text-accent-foreground hover:scale-110 active:scale-90 lg:flex tap-44"
        >
          <span className="text-2xl font-bold leading-none [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.28))]">?</span>
        </Button>
      </div>

      {/* Always mounted (not `{helpOpen && …}`) so Base UI Dialog can play its exit animation
          before it unmounts itself — a conditional unmount would remove the node mid-close. */}
      <HelpPopover open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>,
    document.body,
  )
}
