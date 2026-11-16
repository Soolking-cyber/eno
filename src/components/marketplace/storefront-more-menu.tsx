'use client'

import { useRef, useState } from 'react'
import { Ban, Flag, MoreHorizontal } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { ReportButton } from './report-button'
import { BlockUserButton, useCanBlock } from './block-user-button'
import { STORE_QUIET } from './store-pair'

/**
 * ⛔ THE STOREFRONT'S ⋯ — REPORT AND BLOCK, BEHIND ONE TAP (owner, 2026-11-16 — hub Q21; UI climb r12, cook store-r12c S2, the
 * storefront batch +0.90 / +0.50 over live, blind). It reverses, on a storefront only, the 10-06 right-hand column (Share,
 * Report, Block beside the card) and the 07-08 visible red Report: Chat and Share are the row's equal pair (store-pair.ts),
 * and this 44px ⋯ ends it.
 * ⛔ APP STORE 1.2 / PLAY UGC: REPORT AND BLOCK ARE NEVER REMOVED FROM A SHOP PAGE. The ⋯ is in the server HTML of every
 * storefront where they were (never on the shop's own host, where both writes are refused — s/[handle]/page.tsx), one tap
 * opens it, and its rows open the SAME dialogs as the old pills — ReportButton and BlockUserButton in their controlled,
 * triggerless mode — with the same words ("Report" / "Báo cáo", "Block" / "Chặn"), the same guest sign-in, the same
 * requests. Report is always a row; Block is a row exactly where the pill rendered (`useCanBlock`: the `ugc-safety` gate,
 * not the viewer's own shop). Pinned by storefront-more-menu.test.tsx and both storefronts' report-block tests.
 * A Base UI Menu through ui/dropdown-menu: the anchored popup from sm, the action sheet on a phone (that primitive's rule).
 * The dialogs live OUTSIDE the menu, so closing the menu on a row's tap never unmounts the dialog it opens.
 * ⛔ FOCUS (WCAG 2.4.3; measured on live 2026-11-17, Playwright iPhone 13): the rows are `opensLayer`, so the closing menu
 * leaves focus in the dialog — it used to put it back on the ⋯ BEHIND the open dialog — and each dialog (and the guest's
 * sign-in card) returns it to the ⋯ on close (`finalFocus`), which a tap on iOS never focused.
 * The trigger's name reuses the menu sheet's own "More actions" / "Thêm thao tác" (ui/dropdown-menu): no new copy.
 */
export function StorefrontMoreMenu({ sellerId, shopOnly = false, name, className }: {
  sellerId: string
  /** Nobody blockable runs this shop — only the Block dialog's words depend on it (BlockUserButton `shopOnly`). */
  shopOnly?: boolean
  /** The shop's name, for the Block confirmation's title. */
  name?: string | null
  className?: string
}) {
  const { tr } = useLanguage()
  const canBlock = useCanBlock({ sellerId })
  const [reportOpen, setReportOpen] = useState(false)
  const [blockOpen, setBlockOpen] = useState(false)
  const moreRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              ref={moreRef}
              type="button"
              variant="bare"
              size="none"
              aria-label={tr('More actions', 'Thêm thao tác')}
              data-store-more=""
              className={cn('icon-own-ink relative size-11 shrink-0 rounded-xl', STORE_QUIET, className)}
            >
              <MoreHorizontal className="size-5" aria-hidden />
            </Button>
          }
        />
        <DropdownMenuContent align="end" sideOffset={6} className="min-w-44">
          <DropdownMenuItem variant="destructive" opensLayer onClick={() => setReportOpen(true)} className="rounded-lg">
            <Flag aria-hidden /> {tr('Report', 'Báo cáo')}
          </DropdownMenuItem>
          {canBlock && (
            <DropdownMenuItem opensLayer onClick={() => setBlockOpen(true)} className="rounded-lg">
              <Ban aria-hidden /> {tr('Block', 'Chặn')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ReportButton sellerId={sellerId} open={reportOpen} onOpenChange={setReportOpen} finalFocus={moreRef} />
      {canBlock && <BlockUserButton sellerId={sellerId} shopOnly={shopOnly} name={name} open={blockOpen} onOpenChange={setBlockOpen} finalFocus={moreRef} />}
    </>
  )
}
