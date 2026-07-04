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

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 700)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
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
      >
        {/* Back to top — a proper circular surface (it floats over card imagery, so a
            bare chevron got lost / read as part of a card). Fades in once scrolled
            (slot reserved so the ? never shifts); transform/opacity only. */}
        <button
          type="button"
          aria-label="Back to top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className={cn(
            'relative flex h-11 w-11 items-center justify-center rounded-full bg-card text-body shadow-pop transition-all duration-200 hover:text-foreground active:scale-90 tap-44',
            show ? 'opacity-100 translate-y-0' : 'pointer-events-none opacity-0 translate-y-2',
          )}
        >
          <ChevronUp className="h-6 w-6" strokeWidth={2.5} />
        </button>

        {/* Help — bare "?", DESKTOP ONLY (on mobile, Help lives in the profile page
            next to Post/Listings/Settings, so it's not a floating popup there). */}
        <button
          type="button"
          aria-label="Help"
          aria-haspopup="dialog"
          onClick={() => setHelpOpen(true)}
          className="relative hidden h-9 w-9 items-center justify-center text-body transition-all duration-200 hover:text-foreground active:scale-90 lg:flex tap-44"
        >
          <span className="text-[26px] font-bold leading-none">?</span>
        </button>
      </div>

      {helpOpen && <HelpPopover onClose={() => setHelpOpen(false)} />}
    </>,
    document.body,
  )
}
