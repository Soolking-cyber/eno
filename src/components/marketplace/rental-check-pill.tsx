'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ClipboardCheck } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'
import { RENTAL_CHECK_PATH } from '@/lib/rental-check/shared'
import { useRentalBasketCount } from '@/lib/rental-check/store'
import { rentalFreeCompact, rentalFreeShort } from './rental-check-toggle'
import { cn } from '@/lib/utils'

/** The free line's type and ink — shared by its two width variants so they cannot drift apart. */
const FREE_LINE = 'max-w-full truncate text-2xs font-medium text-white/85'

/**
 * The basket's way back: "Check n rentals / Free · the price you see is the price you get"
 * (rentalFreeShort, the owner's final copy — in English below 375px, "Free · you pay the listed price",
 * rentalFreeCompact; see `compact` below).
 *
 * ⛔ IT IS MOUNTED BY back-to-top.tsx, NOT IN A FIXED LAYER OF ITS OWN — that component already clears
 * the bottom nav, lifts over every `data-fab-clear` sticky bar (the PDP contact bar among them), hides
 * under a modal, stands down with the account panel and disappears on /messages: five rules a second
 * floating element would have to re-derive and would drift from. WHERE differs by width:
 *  · phones — its own bottom-left wrapper just above the nav (owner, 2026-09-25: "above the bottom
 *    navbar but not covering icons on the right"), width-capped short of the right-hand column, and it
 *    YIELDS at rest — fades and takes no pointer — while it sits on a card's heart, its "check
 *    availability" toggle or its price (PILL_OBSTACLES, rentals-04);
 *  · desktop (lg+) — the column's first child, above the chevron's reserved slot, so it can never land
 *    on the chevron, the support mark or the nav.
 * ⚠️ `pointer-events-auto` IS REQUIRED: both wrappers are `pointer-events-none` so their empty area
 * never swallows a tap meant for the page (see the comment there); every visible control opts back in.
 *
 * Hidden when the basket is empty, and on the list page itself, where it would point at the page
 * the visitor is already on.
 */
export function RentalCheckPill({ className }: { className?: string }) {
  const { lang, tr } = useLanguage()
  const count = useRentalBasketCount()
  const pathname = usePathname()
  if (count === 0 || pathname === RENTAL_CHECK_PATH) return null
  const label = count === 1
    ? tr('Check 1 rental', 'Kiểm tra 1 căn')
    : `${tr('Check', 'Kiểm tra')} ${count} ${tr('rentals', 'căn')}`
  const free = rentalFreeShort(tr)
  /**
   * ⛔ BELOW 375px THE ENGLISH LINE IS THE COMPACT ONE (rentalFreeCompact, measured there): the owner's
   * wording lost its last word in the 360px pill. Vietnamese fits and keeps its one line, and so do the
   * other languages (the owner's line, translated) — the switch is English-only.
   * ⚠️ CSS DOES THE SWITCH, NOT JS: two spans, one hidden per width, so the server render and hydration
   * agree at every width (no matchMedia, no resize listener) — the messages strip's `max-sm:sr-only`
   * pattern. ⚠️ AND THE LINK KEEPS ONE ACCESSIBLE NAME, the owner's full line: the compact span is
   * `aria-hidden`, and below 375 the full one is `sr-only`, never display:none — so a screen reader hears
   * the same pill at every width.
   */
  const compact = lang === 'en' ? rentalFreeCompact(tr) : null
  return (
    <Button
      asChild
      variant="cta"
      size="none"
      className={cn(
        'pointer-events-auto min-h-11 max-w-full gap-2 rounded-full py-1.5 pl-3 pr-4 shadow-pop',
        // Enter only — opacity + a 0.95 scale, never from nothing; 200ms ease-out. The global
        // reduced-motion switch in globals.css stills it.
        'animate-in fade-in zoom-in-95 duration-200 ease-out',
        className,
      )}
    >
      <Link href={RENTAL_CHECK_PATH} prefetch={false} data-rental-check-pill="">
        <ClipboardCheck className="h-5 w-5 shrink-0" aria-hidden />
        <span className="flex min-w-0 flex-col items-start text-left leading-tight">
          <span className="max-w-full truncate text-sm font-bold tabular-nums">{label}</span>
          {compact ? (
            <>
              <span aria-hidden data-free-line="compact" className={cn(FREE_LINE, 'min-[375px]:hidden')}>{compact}</span>
              <span data-free-line="full" className={cn(FREE_LINE, 'max-[375px]:sr-only')}>{free}</span>
            </>
          ) : (
            <span data-free-line="full" className={FREE_LINE}>{free}</span>
          )}
        </span>
      </Link>
    </Button>
  )
}
