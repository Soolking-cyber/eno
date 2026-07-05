'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronUp } from 'lucide-react'
import { HelpPopover } from './help-popover'
import { cn } from '@/lib/utils'

/** Floating bottom-right controls, portaled to <body> (no ancestor can offset them),
 *  above the mobile bottom-nav. A bare chevron "back to top" that fades in after
 *  scrolling, stacked over an always-present "?" Help button — both circle-less. */
export function BackToTop() {
  const [show, setShow] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  // Extra clearance when a page renders a sticky bottom bar (listing contact bar,
  // post-wizard publish bar, availability bar — all marked data-fab-clear): the
  // controls must sit ABOVE the bar, never over its CTA.
  const [lift, setLift] = useState(0)

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

  return createPortal(
    <>
      <div
        className={cn(
          'fixed z-[60] flex flex-col items-center gap-2.5',
          'right-4 lg:right-6',
          'bottom-[calc(5rem+env(safe-area-inset-bottom))] lg:bottom-6', // clear the mobile bottom-nav
        )}
        // Inline bottom (beats the classes) only while a bottom bar is on screen.
        style={lift ? { bottom: lift + 12 } : undefined}
      >
        {/* Back to top — bare glyph, no circle: same treatment as the search-bar
            icons (quiet ink → brand blue on hover) with a subtle drop-shadow so it
            stays distinct over card imagery. Fades in once scrolled (slot reserved
            so the ? never shifts); transform/opacity only. */}
        <button
          type="button"
          aria-label="Back to top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className={cn(
            'relative flex h-11 w-11 items-center justify-center text-body transition-all duration-200 hover:text-accent-foreground active:scale-90 tap-44',
            show ? 'opacity-100 translate-y-0' : 'pointer-events-none opacity-0 translate-y-2',
          )}
        >
          <ChevronUp className="h-7 w-7 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.28))]" strokeWidth={2.5} />
        </button>

        {/* Help — bare "?", DESKTOP ONLY (on mobile, Help lives in the profile page
            next to Post/Listings/Settings, so it's not a floating popup there). */}
        <button
          type="button"
          aria-label="Help"
          aria-haspopup="dialog"
          onClick={() => setHelpOpen(true)}
          className="relative hidden h-9 w-9 items-center justify-center text-body transition-all duration-200 hover:text-accent-foreground active:scale-90 lg:flex tap-44"
        >
          <span className="text-[26px] font-bold leading-none [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.28))]">?</span>
        </button>
      </div>

      {helpOpen && <HelpPopover onClose={() => setHelpOpen(false)} />}
    </>,
    document.body,
  )
}
