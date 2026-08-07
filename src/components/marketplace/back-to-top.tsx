'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import { ChevronUp } from 'lucide-react'
import { STROKE_FLOAT } from '@/lib/icon-tokens'
import { useAccountPanel } from './account-panel'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Floating bottom-right controls, portaled to <body> (no ancestor can offset them),
 *  above the mobile bottom-nav. A bare chevron "back to top" that fades in after
 *  scrolling,circle-less. The floating Help "?" was removed (duplicate of the rail's Help row). */
export function BackToTop() {
  const [show, setShow] = useState(false)
  const [mounted, setMounted] = useState(false)
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
    // ⚠️ rAF-THROTTLED, because `measure()` is expensive and this used to run on EVERY scroll
    // event. It does a `querySelectorAll` plus a `getBoundingClientRect()` per match, which forces
    // a synchronous layout, and it then feeds `setLift` → React render → style write → another read
    // on the next tick. Unthrottled that is a layout thrash on the one interaction that must stay
    // smooth. This is the same pattern use-hide-on-scroll.ts already uses; the coalescing is what
    // makes it correct, not the passive flag (passive only promises not to preventDefault).
    let ticking = false
    const update = () => { ticking = false; setShow(window.scrollY > 700); measure() }
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
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
          // ⚠️ NEVER OVER A MODAL. At z-[60] this cluster floated ON TOP of the report
          // dialog's "Gửi báo cáo" submit and over the protections sheet's copy — a tap on
          // the CTA's right edge scrolled the page instead of filing a fraud report (blind
          // critic, 2026-08-07; same family as the fixed-overlay traps in globals.css).
          // A modal owns the screen while open, so the affordance goes away — no state to
          // wire, nothing to keep in sync.
          // ⚠️ MATCH THE POPUP SLOTS, NOT role=dialog. The cookie-consent banner is a
          // permanently-mounted role=dialog, so `body:has([role=dialog])` hides this button
          // on every page forever (measured — it is a worse bug than the one being fixed).
          // These three data-slots exist ONLY while a real popup is mounted (verified open →
          // Escape → gone), and they cover every modal primitive in ui/*.
          '[body:has([data-slot=dialog-content])_&]:hidden',
          '[body:has([data-slot=sheet-content])_&]:hidden',
          '[body:has([data-slot=alert-dialog-content])_&]:hidden',
          // Clear the mobile bottom-nav. The max(env, var) pairing covers Android
          // WebView < 140, where Capacitor injects --safe-area-inset-* vars instead
          // of env() passthrough (see the Android safe-area note in globals.css);
          // everywhere else the var is undefined → 0px, so this equals plain env().
          'bottom-[calc(5rem+max(env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px)))] lg:bottom-6',
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
          // back-to-top-chevron is a stable hook for globals.css: native iOS hides
          // ONLY this button (status-bar tap already scrolls to top there); Android keeps the chevron.
          // (The floating Help "?" was removed 2026-07-18 — the rail's Help row owns it.)
          className={cn(
            // Hover = colour only (icon-language §8 — scale-on-hover is a tile-glyph move,
            // not chrome); press keeps the standard settle.
            'back-to-top-chevron relative flex h-11 w-11 items-center justify-center text-body transition-all duration-200 hover:text-accent-foreground active:scale-[0.96] tap-44',
            show ? 'opacity-100 translate-y-0' : 'pointer-events-none opacity-0 translate-y-2',
          )}
        >
          {/* STROKE_FLOAT (§2): a bare chevron floating over card imagery — heavier than
              chrome so it survives busy photos; the drop-shadow is its only backing. */}
          <ChevronUp className="h-7 w-7 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.28))]" strokeWidth={STROKE_FLOAT} />
        </Button>

      </div>

    </>,
    document.body,
  )
}
