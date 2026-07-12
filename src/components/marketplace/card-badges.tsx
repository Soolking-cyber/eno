'use client'

import { Zap } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { dropPercent } from '@/lib/vnd'
import { cn } from '@/lib/utils'
import type { SerializedListingCard } from '@/lib/types'

// THE one card-badge system, reused on every card surface so the top-left signals
// read identically app-wide (no more copy-pasted colours drifting per surface).
// Palette is deliberately restrained (eno keeps NO bazaar noise): DROP is the single
// coloured chip — red, the universal discount cue — while Urgent + New are quiet slate
// so brand blue stays reserved for price + trust and nothing off-brand competes with
// the card's anchor. Urgent reads as the stronger signal via a SOLID slate + the ⚡:
//   Urgent → solid slate (act now)  ·  Drop → red (discount)  ·  New → quiet slate (fresh)
const NEW_MS = 48 * 60 * 60 * 1000

type BadgeKind = 'urgent' | 'drop' | 'new'
type BadgeVariant = 'overlay' | 'inline'

const TONE: Record<BadgeKind, string> = {
  urgent: 'bg-foreground text-background', // solid slate — quietly stronger than the /85 "New"
  drop: 'bg-red-600 text-white tabular-nums',
  new: 'bg-foreground/85 text-background backdrop-blur-[2px]',
}

/** One badge chip. `overlay` = sits on a photo (shadow so it reads over any image);
 *  `inline` = in a text meta row (tighter, no shadow). */
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

/** The standard top-left overlay stack (Urgent → Drop → New) for a card. Renders
 *  nothing when the listing carries no signal. New is shown ONLY when neither
 *  urgent nor a drop applies (they're the stronger, honest claims). */
export function CardBadges({
  listing,
  showNew = true,
  className,
}: {
  listing: Pick<SerializedListingCard, 'urgent' | 'prevPrice' | 'price' | 'postedAt'>
  showNew?: boolean
  className?: string
}) {
  const { tr } = useLanguage()
  const drop = listing.prevPrice != null && dropPercent(listing.prevPrice, listing.price)
  const isNew = showNew && !!listing.postedAt && Date.now() - new Date(listing.postedAt).getTime() < NEW_MS
  if (!listing.urgent && !drop && !isNew) return null

  return (
    <span className={cn('flex items-center gap-1', className)}>
      {listing.urgent && (
        <Badge kind="urgent">
          <Zap className="h-2.5 w-2.5 fill-current" /> {tr('Urgent', 'Bán gấp')}
        </Badge>
      )}
      {drop && <Badge kind="drop">{drop}</Badge>}
      {isNew && !listing.urgent && !drop && <Badge kind="new">{tr('New', 'Mới')}</Badge>}
    </span>
  )
}
