'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ClipboardCheck } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'
import { RENTAL_CHECK_PATH } from '@/lib/rental-check/shared'
import { useRentalBasketCount } from '@/lib/rental-check/store'
import { rentalFreeShort } from './rental-check-toggle'
import { cn } from '@/lib/utils'

/**
 * The basket's way back: "Check n rentals / Free · same price as listed", floating above the chevron.
 *
 * ⛔ IT LIVES INSIDE back-to-top.tsx's CLUSTER, NOT IN A FIXED LAYER OF ITS OWN. That column already
 * clears the bottom nav, lifts over every `data-fab-clear` sticky bar (the PDP contact bar among
 * them), hides under a modal, stands down with the account panel and disappears on /messages — five
 * rules a second floating element would have to re-derive and would drift from. As the column's
 * first child it sits above the chevron's reserved slot, so it can never land on the chevron, the
 * support mark or the nav.
 * ⚠️ `pointer-events-auto` IS REQUIRED: the column is `pointer-events-none` so its empty area never
 * swallows a tap meant for the page (see the comment there); every visible control opts back in.
 *
 * Hidden when the basket is empty, and on the list page itself, where it would point at the page
 * the visitor is already on.
 */
export function RentalCheckPill({ className }: { className?: string }) {
  const { tr } = useLanguage()
  const count = useRentalBasketCount()
  const pathname = usePathname()
  if (count === 0 || pathname === RENTAL_CHECK_PATH) return null
  const label = count === 1
    ? tr('Check 1 rental', 'Kiểm tra 1 căn')
    : `${tr('Check', 'Kiểm tra')} ${count} ${tr('rentals', 'căn')}`
  return (
    <Button
      asChild
      variant="cta"
      size="none"
      className={cn(
        'pointer-events-auto min-h-11 gap-2 rounded-full py-1.5 pl-3 pr-4 shadow-pop',
        // Enter only — opacity + a 0.95 scale, never from nothing; 200ms ease-out. The global
        // reduced-motion switch in globals.css stills it.
        'animate-in fade-in zoom-in-95 duration-200 ease-out',
        className,
      )}
    >
      <Link href={RENTAL_CHECK_PATH} prefetch={false} data-rental-check-pill="">
        <ClipboardCheck className="h-5 w-5 shrink-0" aria-hidden />
        <span className="flex flex-col items-start text-left leading-tight">
          <span className="text-sm font-bold tabular-nums">{label}</span>
          <span className="text-2xs font-medium text-white/85">{rentalFreeShort(tr)}</span>
        </span>
      </Link>
    </Button>
  )
}
