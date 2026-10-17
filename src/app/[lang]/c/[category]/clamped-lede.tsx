'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

/**
 * The category lede, clamped to ONE LINE ON A PHONE with "Show more" at the end of that line; whole from sm.
 *
 * ⛔ ONE LINE SINCE 2026-10-18 (owner: products first on a phone's first screen). It was two lines with the button on
 * a third; the closed lede is now one line and the button sits beside it on the same line (a flex row while closed
 * — the paragraph takes the room the button leaves), so the whole block costs one line of the fold. Opened, the
 * row lets go: the full paragraph, and "Show less" under it.
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
 * ⚠️ A LEDE THAT FITS KEEPS THE BUTTON'S BOX BUT NOT THE BUTTON. Measured at 390px on 2026-09-29 (then at
 * two lines), 5 of 34 page×language ledes fit and each offered a "Show more" that opened nothing. The server
 * cannot know the line count, so the button is rendered and, once a layout read after hydration says nothing
 * is clipped, made `invisible` — out of the tab order and the accessibility tree, and still holding its place,
 * so nothing moves after first paint. Re-read on resize (rotation, font load) while closed.
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
    // Closed on a phone: one baseline row — the clamped paragraph takes what the button leaves (`min-w-0 flex-1`),
    // keeps the caller's top margin, and the baseline alignment sets the button on its one line. From sm, and once
    // opened, the row is a plain block: the paragraph, then the (phone-only) button under it, as before.
    <div className={cn(!open && 'max-sm:flex max-sm:items-baseline max-sm:gap-2')}>
      <p ref={ref} id={id} data-category-lede="" className={cn(className, !open && 'max-sm:line-clamp-1 max-sm:min-w-0 max-sm:flex-1')}>
        {children}
      </p>
      {/* `bare` + `size="none"`: a text link's look, the primitive's focus ring and press.
          ⛔ NO `tap-44` (gate, 2026-10-18): on /c/rentals the "Check availability" row sits 10px below this one, and two
          44px extenders on 20px text overlapped by 14px — the LATER one won, so a tap on the bottom of "Show more" left
          the page (measured with elementFromPoint at 390 and 360, EN and VI). The visible box carries the size instead
          (touch-targets.test.tsx's rule): `py-1` makes it 28px, the negative margins give the 4px back so nothing
          moves, and the two boxes stop 2px apart. 28, not 44: a 44px box needs a 44px row pitch here, +14px on every
          /c phone screen; a link that ends a line of text is WCAG 2.5.8's inline exception, and 28 clears its 24px
          floor regardless. */}
      <Button
        type="button"
        variant="bare"
        size="none"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={cn('-mb-1 py-1 text-sm font-semibold text-accent-foreground hover:underline sm:hidden', !open && 'max-sm:-mt-1 max-sm:shrink-0', fits && !open && 'invisible')}
      >
        {open ? tr('Show less', 'Thu gọn') : tr('Show more', 'Xem thêm')}
      </Button>
    </div>
  )
}
