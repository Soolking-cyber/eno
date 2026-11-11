'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'

/** A phone shows this many lines of a long About before "See more". */
export const TEACHER_BIO_LINES = 5

/**
 * Whether the text runs past TEACHER_BIO_LINES + 1 lines, ASKED OF THE LAYOUT ITSELF (codex, 2026-11-11, round 4): the five-line
 * clamp is applied inline for one synchronous read — before any paint — and its box compared with the full text's, then the
 * element's own inline style is put back. No line-height arithmetic, so `line-height: normal`, fallback fonts and odd
 * metrics cannot produce a button that hides nothing. Inline style is no React prop here and no MutationObserver target
 * (it watches text and children), so the read cannot loop.
 */
export function overflowsClamp(el: HTMLElement): boolean {
  const before = el.style.cssText
  el.style.cssText = `${before};display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${TEACHER_BIO_LINES};overflow:hidden`
  const shown = el.clientHeight
  // MORE THAN ONE LINE HIDDEN, or it is not worth a button (browser check, 2026-11-11): a six-line bio clamped to five
  // plus a one-line "See more" saves nothing and hides a line. The line's height comes from the same clamped box.
  const over = el.scrollHeight > shown + shown / TEACHER_BIO_LINES + 1
  el.style.cssText = before
  return over
}

/**
 * A teacher's About, CLAMPED TO 5 LINES ON A PHONE with "See more" (UI climb batch 69, 2026-11-11: blind A/B +0.39 GPT /
 * +0.18 Opus with the Teaching facts moved up). The long story ran two to three phone screens and pushed subjects and
 * availability out of reach.
 *
 * ⛔ THE SERVER SENDS IT WHOLE, AND ONLY A MOUNTED PAGE CLAMPS (codex, 2026-11-11, review round 3). A clamp in the server HTML
 * cuts a phone reader off at line five until the script that opens it has loaded — or for good if it never does. So the HTML
 * carries the full text with no clamp and no button, and after mount the RENDERED text decides (opus, round 1: the stored
 * text's length is not the height of the translation the reader sees at their width): more than five lines clamps and shows
 * the button; five or fewer stays whole with none, so no button ever "expands" nothing. Re-measured when the width, the text
 * (a translation arriving), the md line or the web font changes (codex + opus, round 2). It clamps only a bio that starts
 * below the visible screen, so the change after mount never moves text the reader can see.
 * Find-in-page does not open the clamp (a match past line five stays hidden until "See more"); crawlers and screen readers
 * get the whole text. md and up never clamp and have no button.
 * ⚠️ HAND-ROLLED, NOT Base UI Collapsible, as in ListingDescription: its Panel HIDES the closed content, and a clamp has to
 * SHOW the first lines. The trigger is a ui/button with aria-expanded + aria-controls.
 */
export function TeacherBio({ children }: { children: ReactNode }) {
  const { tr } = useLanguage()
  const [expanded, setExpanded] = useState(false)
  const [long, setLong] = useState(false)
  const ref = useRef<HTMLParagraphElement>(null)
  const id = useId()
  // A LAYOUT effect: measured and clamped before the browser paints, so a client navigation back to a profile (its scroll
  // restored) never shows the whole bio and then jumps (opus, round 6). Only the server HTML's first paint shows it whole.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // The SAME query as Tailwind's `max-md:` — `width < 48rem` (globals.css sets no other `md`): rem, so a larger default font
    // size moves both (codex, round 6), and the same range, so no fractional width falls between them (codex, round 7). A
    // browser too old for range syntax reads it as never matching: no clamp, the whole bio — the safe side.
    const phone = window.matchMedia('(width < 48rem)')
    let alive = true
    const measure = () => {
      if (!alive) return
      if (!phone.matches || !overflowsClamp(el)) { setLong(false); return }
      // ⛔ NEVER SHRINK WHAT THE READER CAN SEE (opus, round 7): a sparse profile (no video, no cover week) can have About on
      // the first screen, and a reader can come back scrolled into it or past it. A clamp then would move text in view. So a
      // long bio clamps only while it starts BELOW the visible screen; once clamped it stays clamped until it is no longer long.
      setLong((was) => was || el.getBoundingClientRect().top >= window.innerHeight)
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    const mo = new MutationObserver(measure)
    mo.observe(el, { subtree: true, childList: true, characterData: true })
    // Safari before 14 has only the old addListener on a MediaQueryList.
    if (phone.addEventListener) phone.addEventListener('change', measure); else phone.addListener(measure)
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined
    fonts?.ready.then(measure).catch(() => {})
    fonts?.addEventListener?.('loadingdone', measure)
    return () => {
      alive = false
      ro?.disconnect(); mo.disconnect()
      if (phone.removeEventListener) phone.removeEventListener('change', measure); else phone.removeListener(measure)
      fonts?.removeEventListener?.('loadingdone', measure)
    }
  }, [])
  // A text that is no longer long closes again (opus, round 3): coming back long later, it starts clamped, never open with "See less".
  useEffect(() => { if (!long) setExpanded(false) }, [long])
  return (
    <>
      <p ref={ref} id={id} className={`max-w-prose whitespace-pre-line text-body${long && !expanded ? ' max-md:line-clamp-5' : ''}`}>{children}</p>
      {long && (
        <Button variant="link" size="none" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded((e) => !e)} className="relative tap-44 mt-1 w-fit text-sm font-semibold text-accent-foreground md:hidden">
          {expanded ? tr('See less', 'Thu gọn') : tr('See more', 'Xem thêm')}
        </Button>
      )}
    </>
  )
}
