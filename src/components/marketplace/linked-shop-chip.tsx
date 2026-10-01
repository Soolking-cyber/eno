'use client'

import { Badge } from '@/components/ui/badge'
import { Tooltip } from '@/components/ui/tooltip'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

/**
 * "Linked shop / Cửa hàng liên kết" — the neutral chip a LINKED storefront shows where the partner badge
 * used to be (owner decision, 2026-10-01). Since that day the partner badge is kept only for the
 * companies the owner named; every other storefront that carries an imported or affiliate catalogue
 * (src/lib/linked-seller.ts isLinkedShop) gets this instead, on the storefront header and the PDP shop
 * row.
 *
 * ⚠️ NEUTRAL ON PURPOSE (`variant="neutral"`, no glyph): it states what the shop IS — its listings link
 * out to the source site — and makes no claim of trust, partnership or verification. The partner
 * green and the trust shield are both claims; this chip must never borrow either.
 * ⚠️ The tooltip says only what is true of every linked shop by construction: each of its listings
 * carries an outbound link (the PDP's "Buy on / Rent on / Apply on …" button), and the reader continues
 * there. ⚠️ NO VERB: it said "you contact or buy there", and the same chip sits on a job board's and a
 * rental portal's rows, where nobody buys (2026-10-01). Seller information's caption carries the
 * per-type verb (seller-info.tsx). A tooltip does not open on touch, so the chip's own words carry the
 * meaning alone.
 */
export function LinkedShopChip({ className }: { className?: string }) {
  const { tr } = useLanguage()
  return (
    <Tooltip
      content={tr(
        'Its listings link to the source website — you continue there.',
        'Tin đăng dẫn link về website gốc — bạn tiếp tục tại đó.',
      )}
      side="top"
    >
      <Badge variant="neutral" size="sm" data-linked-shop-chip="" className={cn('shrink-0 font-semibold', className)}>
        {tr('Linked shop', 'Cửa hàng liên kết')}
      </Badge>
    </Tooltip>
  )
}
