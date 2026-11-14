'use client'

import { Zap } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { dropPercent } from '@/lib/vnd'
import { cn } from '@/lib/utils'
import type { SerializedListingCard } from '@/lib/types'

// THE one card-badge system, reused on every card surface so the top-left signals
// read identically app-wide (no more copy-pasted colours drifting per surface).
// ⛔ ON A PHOTO EVERY BADGE IS THE ONE WHITE PILL, `.photo-badge` (owner-approved 2026-11-14, cook r05 shell: "over a
// photo: only white plates (95% white, ink glyph, soft shadow, 26 tall badges 700 13)"): Urgent and the price drop are
// INK on the white plate, told apart by their words and the ⚡ — no colour (the drop was the one red chip, Urgent solid
// slate). IN A TEXT ROW (`variant="inline"`, compact-listing-row.tsx) the chips keep their tones, unchanged.
// ⛔ "JUST IN" IS GONE (owner-approved 2026-11-14, cook r05: '"Just in" → hidden'). The redesign hid it with CSS; here it
// is simply never rendered, on the server or the client, so nothing about it can mismatch on hydration. With it went the
// clock effect that squared it with the visitor's time and the card's `chipInHtml` / `showNew` props. `isNew` on the
// serialized row is left as it is (lib/serialize.ts) for now: nothing reads it on a card any more.

type BadgeKind = 'urgent' | 'drop'
type BadgeVariant = 'overlay' | 'inline'

/** The INLINE tones (a chip in a text row). On a photo the plate is the tone (`.photo-badge`). */
const TONE: Record<BadgeKind, string> = {
  urgent: 'bg-foreground text-background', // solid slate
  drop: 'bg-destructive text-destructive-foreground tabular-nums',
}

/** One badge chip. `overlay` = sits on a photo: the white `.photo-badge` pill (globals.css), ink, 26px, 700 13;
 *  `inline` = in a text meta row (tighter, toned, no shadow). */
export function Badge({
  kind,
  variant = 'overlay',
  className,
  children,
}: {
  kind: BadgeKind
  variant?: BadgeVariant
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        variant === 'overlay' ? 'photo-badge' : cn('rounded-full px-1.5 py-px text-3xs font-bold', TONE[kind], kind === 'urgent' && 'inline-flex items-center gap-0.5'),
        className,
      )}
    >
      {children}
    </span>
  )
}

/** The card's top-left overlay signal — EXACTLY ONE badge, never a row of them. The
 *  winner is the first of Urgent → price Drop that applies; no signal renders nothing ("Just in" is gone, 2026-11-14).
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
  className,
}: {
  listing: Pick<SerializedListingCard, 'urgent' | 'prevPrice' | 'price' | 'listingType'>
  className?: string
}) {
  const { tr } = useLanguage()
  const drop = listing.prevPrice != null && dropPercent(listing.prevPrice, listing.price)

  // One badge → no wrapper. `className` therefore styles THE CHIP, not a row around it: the
  // caller's positioning classes ride on the chip (an absolutely-positioned inline/inline-flex
  // box is blockified and still shrink-to-fits, so it sits and sizes exactly where the old flex
  // row put it) and every card in the feed sheds a DOM node. ⚠️ The corollary is that row-level
  // utilities are no longer meaningful here — a caller passing `gap-*`/`space-x-*` would retune
  // the gap between the bolt and its label instead of spacing chips.
  if (listing.urgent) {
    return (
      <Badge kind="urgent" className={className}>
        {/* Filled mark inside the pill — a stroked bolt disappears at this size; h-3 is the icon ladder's 12px step. */}
        {/* ⛔ A JOB IS HIRING, NOT SELLING (owner, 2026-10-01): the same urgent flag reads "Tuyển gấp"
            on a job. "Bán gấp" (urgent SALE) on a job ad told candidates the employer was selling it. */}
        <Zap className="h-3 w-3 shrink-0 fill-current" /> <span className="-my-0.5 min-w-0 truncate py-0.5">{listing.listingType === 'job' ? tr('Urgent hiring', 'Tuyển gấp') : tr('Urgent', 'Bán gấp')}</span>
      </Badge>
    )
  }
  // ⛔ THE DROP CHIP IS KEPT, AS A WHITE PILL (2026-11-14 build plan; listed for the owner on the hub): the cook mock hid it
  // only as a side effect of its "Just in" selector, and the chip is the one place a drop is announced (the struck price
  // is visual only).
  if (drop) return <Badge kind="drop" className={className}>{drop}</Badge>
  return null
}
