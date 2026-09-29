'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

/**
 * The category lede, clamped to TWO LINES ON A PHONE with a "Show more" under it; whole from sm.
 *
 * ⛔ THE FOLD WAS THE BUDGET NOBODY HELD (C1-FOLD, 2026-09-29). At 390px /c/rentals stacked a 5-line
 * lede, the free-check hint, the Rent Index line and every district as a wrapping chip, and the first
 * card sat at 1018px — below two full screens of preamble. The lede is the tallest of those blocks
 * and the only one a reader can do without on arrival.
 *
 * ⚠️ CLAMPED WITH CSS, NEVER TRUNCATED: the whole sentence stays in the DOM, so a crawler, a screen
 * reader and every viewport from sm read all of it. `aria-expanded`/`aria-controls` tie the button to
 * the paragraph it opens.
 * ⚠️ HAND-ROLLED, AND THE PRIMITIVE WAS CHECKED FIRST: Base UI's Collapsible hides its panel outright
 * (a closed panel is not a two-line preview of itself), and no library ships a line-clamp disclosure.
 * ⚠️ A LEDE THAT FITS IN TWO LINES KEEPS THE BUTTON'S BOX BUT NOT THE BUTTON. Measured at 390px on
 * 2026-09-29, 5 of 34 page×language ledes fit (/c/pets and /c/tickets-travel in both, /c/vehicles in
 * vi), and each offered a "Show more" that opened nothing. The server cannot know the line count, so
 * the button is rendered and, once a layout read after hydration says nothing is clipped, made
 * `invisible` — out of the tab order and the accessibility tree, and still holding its line, so the
 * page below does not jump up after first paint. Re-read on resize (rotation, font load) while closed.
 * `data-category-lede` stays on the paragraph — H2's crawler spec finds the lede by it.
 */
export function ClampedLede({ children, className }: { children: React.ReactNode; className?: string }) {
  const { tr } = useLanguage()
  const [open, setOpen] = useState(false)
  const [fits, setFits] = useState(false)
  const ref = useRef<HTMLParagraphElement>(null)
  const id = useId()
  useEffect(() => {
    const el = ref.current
    if (!el || open) return // an open lede is never clipped, so it says nothing about the closed one
    const measure = () => setFits(el.scrollHeight <= el.clientHeight + 1)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [open])
  return (
    <>
      <p ref={ref} id={id} data-category-lede="" className={cn(className, !open && 'max-sm:line-clamp-2')}>
        {children}
      </p>
      {/* `bare` + `size="none"`: a text link's look, the primitive's focus ring and press. */}
      <Button
        type="button"
        variant="bare"
        size="none"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={cn('relative tap-44 mt-1 text-sm font-semibold text-accent-foreground hover:underline sm:hidden', fits && !open && 'invisible')}
      >
        {open ? tr('Show less', 'Thu gọn') : tr('Show more', 'Xem thêm')}
      </Button>
    </>
  )
}
