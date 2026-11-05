'use client'

import { useEffect, useRef, type Ref } from 'react'
import { Zap } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { dropPercent } from '@/lib/vnd'
import { cn } from '@/lib/utils'
import { NEW_LISTING_MS, type SerializedListingCard } from '@/lib/types'

// THE one card-badge system, reused on every card surface so the top-left signals
// read identically app-wide (no more copy-pasted colours drifting per surface).
// Palette is deliberately restrained (eno keeps NO bazaar noise): DROP is the single
// coloured chip — red, the universal discount cue — while Urgent + New are quiet slate
// so brand blue stays reserved for price + trust and nothing off-brand competes with
// the card's anchor. Urgent reads as the stronger signal via a SOLID slate + the ⚡:
//   Urgent → solid slate (act now)  ·  Drop → red (discount)  ·  New → quiet slate (fresh)

type BadgeKind = 'urgent' | 'drop' | 'new'
type BadgeVariant = 'overlay' | 'inline'

const TONE: Record<BadgeKind, string> = {
  urgent: 'bg-foreground text-background', // solid slate — quietly stronger than the /85 "New"
  drop: 'bg-destructive text-destructive-foreground tabular-nums',
  new: 'bg-foreground/85 text-background material backdrop-blur-[2px]',
}

/** One badge chip. `overlay` = sits on a photo (shadow so it reads over any image);
 *  `inline` = in a text meta row (tighter, no shadow). */
export function Badge({
  ref,
  hidden,
  kind,
  variant = 'overlay',
  className,
  children,
}: {
  ref?: Ref<HTMLSpanElement>
  hidden?: boolean
  kind: BadgeKind
  variant?: BadgeVariant
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      ref={ref}
      hidden={hidden}
      className={cn(
        variant === 'overlay' ? 'rounded-full px-2 py-0.5 text-3xs font-bold shadow-sm' : 'rounded-full px-1.5 py-px text-3xs font-bold',
        TONE[kind],
        kind === 'urgent' && 'inline-flex items-center gap-0.5',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** The card's top-left overlay signal — EXACTLY ONE badge, never a row of them. The
 *  winner is the first of Urgent → price Drop → New that applies; no signal renders nothing.
 *
 *  ⚠️ ONE BADGE IS THE WHOLE POINT — DO NOT RE-ADD A SECOND CHIP. This used to render urgent
 *  AND drop side by side (only `new` carried the exclusions), which cost the card twice: two
 *  competing claims read as noise exactly where the eye lands first, and the pair ate the
 *  top-left corner of a 179px phone card. The winner is resolved here, as returns, rather
 *  than as three siblings each carrying a longer list of `&& !other` conditions — that shape
 *  is precisely how "urgent AND drop" survived for so long, because nothing in it says out
 *  loud that only one may render.
 *
 *  ⚠️ WHY SUPPRESSING A LIVE DROP IS NOT AN OMISSION. A price drop is a real, server-anchored
 *  fact (prevPrice = the 30-day minimum), so hiding it under "urgent" would normally lose the
 *  buyer something. It does not here, because the card states the drop a SECOND time, in the
 *  price row: listing-card.tsx renders the struck-through "was" price from its own `hasDrop`,
 *  which never consults this component. An urgent listing that also dropped therefore still
 *  shows BOTH prices — strictly more information than the "-24%" chip suppressed here, which
 *  is a rounding of the same two numbers. What is lost is the red chip's loudness, not the
 *  fact. ⛔ That struck price IS this decision's safety net, and the safety net lives in the
 *  CALLER: if it is ever removed from the price row, or a NEW surface adopts this component
 *  without carrying a "was" price of its own, an urgent+dropped listing states its drop
 *  nowhere. Today there is exactly one call site (listing-card.tsx), which does carry it —
 *  the compact row builds its own chips from the `Badge` export above, not from this.
 *  ⚠️ KNOWN GAP, RAISED BY A REVIEWER AND LEFT OPEN DELIBERATELY: that fallback is VISUAL. The
 *  struck price is styled `line-through` with no accessible label — on the card and on the PDP
 *  alike — so a screen-reader user on an urgent+dropped listing now hears two prices and no
 *  relationship, where the "-24%" chip used to be read out. The honest fix is one "was"-price
 *  label chosen ONCE for both surfaces, which is a change to listings/[id]/page.tsx too, so it
 *  is not made here rather than made inconsistently. */
export function CardBadges({
  listing,
  showNew = true,
  chipInHtml = true,
  className,
}: {
  listing: Pick<SerializedListingCard, 'urgent' | 'prevPrice' | 'price' | 'postedAt' | 'listingType' | 'isNew'>
  showNew?: boolean
  chipInHtml?: boolean
  className?: string
}) {
  const { tr } = useLanguage()
  const drop = listing.prevPrice != null && dropPercent(listing.prevPrice, listing.price)
  /**
   * ⛔ "NEW" COMES WITH THE ROW, DECIDED WHERE THE ROW WAS SERIALIZED (lib/serialize.ts), so the server and the first client render read one answer and the
   * chip is in the first paint. It used to appear a frame after mount, on every card, in the longest task of the load (speed audit, 2026-11-03).
   * The effect squares the chip with the clock, with no state and no re-render: a hidden element is still the element the server sent, so there is no mismatch.
   * `chipInHtml={false}` (cards in HTML that lives for weeks: a listing page is ISR for 30 days) leaves it hidden and EMPTY until that effect says it is still true, so the HTML
   * makes no false claim to a crawler or to a phone waiting to hydrate. ⚠️ Empty: e2e/ci/crawler-html.spec.ts allows no word under [hidden]. Urgent and price-drop are untouched: not this clock.
   */
  const chip = useRef<HTMLSpanElement>(null)
  const isNew = showNew && listing.isNew === true
  // Not 'New': the card's own meta line says New for the condition, and this means the listing is fresh.
  const newLabel = tr('Just in', 'Mới đăng')
  useEffect(() => {
    if (!isNew || !chip.current) return
    const lapsed = Date.now() - new Date(listing.postedAt).getTime() >= NEW_LISTING_MS
    chip.current.hidden = lapsed
    if (!chipInHtml && !lapsed) chip.current.textContent = newLabel
  }, [isNew, listing.postedAt, chipInHtml, newLabel])

  // One badge → no wrapper. `className` therefore styles THE CHIP, not a row around it: the
  // caller's positioning classes ride on the chip (an absolutely-positioned inline/inline-flex
  // box is blockified and still shrink-to-fits, so it sits and sizes exactly where the old flex
  // row put it — measured on the live feed: the Urgent chip is 60×17 at left-2/top-2, unchanged)
  // and every card in the feed sheds a DOM node. ⚠️ The corollary is that row-level utilities
  // are no longer meaningful here — a caller passing `gap-*`/`space-x-*` would retune the gap
  // between the bolt and its label instead of spacing chips.
  if (listing.urgent) {
    return (
      <Badge kind="urgent" className={className}>
        {/* Filled mark inside a small filled chip — a stroked bolt disappears at the
            micro step; h-3 is the icon ladder's 12px size for 3xs labels (§4). */}
        {/* ⛔ A JOB IS HIRING, NOT SELLING (owner, 2026-10-01): the same urgent flag reads "Tuyển gấp"
            on a job. "Bán gấp" (urgent SALE) on a job ad told candidates the employer was selling it. */}
        <Zap className="h-3 w-3 fill-current" /> {listing.listingType === 'job' ? tr('Urgent hiring', 'Tuyển gấp') : tr('Urgent', 'Bán gấp')}
      </Badge>
    )
  }
  if (drop) return <Badge kind="drop" className={className}>{drop}</Badge>
  if (isNew) return <Badge ref={chip} hidden={!chipInHtml} kind="new" className={className}>{chipInHtml ? newLabel : null}</Badge>
  return null
}
