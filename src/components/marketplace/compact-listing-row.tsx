'use client'

import { memo, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { MapPin, MessageCircle, Tag, Zap } from 'lucide-react'
import { TrustScore } from './trust-score'
import { Badge } from './card-badges'
import { Price } from './price'
import { CategoryIcon } from './category-icons'
import { FavoriteHeart } from './favorite-heart'
import { useLanguage, Tr } from '@/context/language-context'
import { useLocalized } from './listing-content'
import type { SerializedListingCard } from '@/lib/types'
import { formatMoneyFull, formatCount, moneyLocale, dropPercent } from '@/lib/vnd'
import { cn } from '@/lib/utils'
import { useAuth } from '@/context/auth-context'
import { stashQuickCompose } from '@/lib/quick-contact'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'

type Props = {
  listing: SerializedListingCard
  index: number
  onOpen: (l: SerializedListingCard) => void
  onPrefetch: (id: string) => void
  onLocate: (id: string) => void
}

// Compact list row (bonbanh-style): thumbnail + title + price/location/trust meta
// + locate/favorite actions. Memoized — compact is the default view mode, so every
// row would otherwise re-render on any explorer state change (hover, page, filters).
// All callbacks passed in are stable useCallback handlers in the explorer.
export const CompactListingRow = memo(function CompactListingRow({ listing: l, index, onOpen, onPrefetch, onLocate }: Props) {
  const { lang, tr } = useLanguage()
  const router = useRouter()
  const cover = l.images[0]
  // Embedded per-language title (titleI18n, warmed at post time) → instant, no
  // API call; falls back to lazy MT for langs without an embedded value.
  const displayTitle = useLocalized(l.title, l.titleVi, l.titleI18n)
  // Quick-offer: pressing the Tag rolls a discount slider open to the LEFT of the
  // action icons; confirm hands off to the composer's offer mode (?offer=N#contact).
  const [offer, setOffer] = useState<number | null>(null)
  const { user, loading: authLoading, openSignIn } = useAuth()
  const quickGo = (opts: { body?: string; offerAmount?: number | null }) => {
    if (!user) { if (!authLoading) openSignIn({ listingTitle: displayTitle, listingImage: cover ?? null }); return }
    if (stashQuickCompose(l, opts)) router.push('/messages/pending')
    else router.push(`/listings/${l.id}#contact`)
  }

  return (
    <div
      onClick={() => onOpen(l)}
      onMouseEnter={() => onPrefetch(l.id)}
      onTouchStart={() => onPrefetch(l.id)}
      className="group flex items-center gap-3 rounded-xl p-1.5 pr-1 text-left transition-[background-color,transform] duration-100 hover:bg-muted active:scale-[0.99] cursor-pointer"
    >
      {/* Thumbnail — small, square-ish so the row reads as one line */}
      <div className="relative h-14 w-16 shrink-0 overflow-hidden rounded-lg bg-tint">
        {cover ? (
          <Image
            src={cover}
            alt={displayTitle}
            fill
            sizes="64px"
            className="object-cover transition-transform duration-200 group-hover:scale-105"
            loading={index < 6 ? 'eager' : 'lazy'}

          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-tint">
            <CategoryIcon name={l.category.icon} className="h-5 w-5 text-ink-4" />
          </div>
        )}
      </div>

      {/* One-liner: title on top, price · location · trust score on a tight meta line */}
      <div className="min-w-0 flex-1">
        <h4 className="truncate text-sm font-medium leading-snug text-foreground group-hover:underline">
          {displayTitle}
        </h4>
        <div className="mt-0.5 flex items-center gap-x-2 text-xs text-muted-foreground">
          {/* Same app-wide badges as the grid card (card-badges.tsx), inline form:
              urgent before the price, drop % after — the row is one line, so signals
              stay glyph-sized. */}
          {/* The row's single color anchor — brand blue, matching the grid card. */}
          <Price price={l.price} currency={l.currency} priceUnit={l.priceUnit} compact dual="sm" className="shrink-0 text-base font-bold text-accent-foreground" />
          {/* Urgent — RIGHT of the price (user-picked 2026-07-14): the bare black
              bolt on EVERY breakpoint. The desktop chip (outline + "Urgent" word)
              is gone — one glyph reads the same everywhere and keeps the one-line
              meta row quiet. */}
          {l.urgent && (
            <Zap
              className={cn('h-3.5 w-3.5 shrink-0 fill-current text-foreground', offer !== null && 'hidden')}
              aria-label={tr('Urgent', 'Bán gấp')}
            />
          )}
          {l.prevPrice != null && dropPercent(l.prevPrice, l.price) && (
            <Badge kind="drop" variant="inline" className="shrink-0">{dropPercent(l.prevPrice, l.price)}</Badge>
          )}
          {/* Address text is desktop-only (user-picked: it truncated uselessly on
              phones — the map-pin action is the mobile location affordance). */}
          <span className="hidden h-3 w-px shrink-0 bg-border sm:block" />
          <span className="hidden truncate sm:inline"><Tr text={l.district || l.city} /></span>
          {/* Demand proof (≥3 contact reveals) — desktop only: the one-line meta row
              can't spare the width on mobile. */}
          {l.contactCount >= 3 && (
            <span className="hidden shrink-0 text-2xs text-muted-foreground tabular-nums sm:inline">
              {tr(`${formatCount(l.contactCount, moneyLocale(lang))} contacted`, `Đã liên hệ ${formatCount(l.contactCount, moneyLocale(lang))}`)}
            </span>
          )}
          <TrustScore score={l.seller.trustScore} variant="mini" size="sm" className={cn('ml-auto shrink-0', offer !== null && 'hidden')} />
        </div>
      </div>

      {/* Actions paired together (not stranded): offer + quick-chat + locate + favorite.
          The offer slider rolls open leftwards, replacing nothing — icons stay put. */}
      <div className="relative flex shrink-0 items-center" onMouseLeave={() => setOffer(null)}>
        {offer !== null && (
          <span
            onClick={(e) => e.stopPropagation()}
            className="flex min-w-0 items-center gap-2 py-1 pr-1 animate-in slide-in-from-right-2 fade-in duration-150"
          >
            <span className="shrink-0 text-2xs font-bold tabular-nums text-foreground">−{offer}%</span>
            <input
              type="range"
              min={5} max={50} step={5}
              value={offer}
              onChange={(e) => setOffer(Number(e.target.value))}
              aria-label={tr('Discount', 'Mức giảm')}
              className="w-28 accent-[var(--brand)] cursor-pointer"
            />
            <Button
              type="button"
              variant="cta"
              size="none"
              onClick={() => quickGo({ offerAmount: Math.round(l.price * (1 - offer / 100)) })}
              className="shrink-0 rounded-full px-3 py-1 text-2xs cursor-pointer"
            >
              {formatMoneyFull(Math.round(l.price * (1 - offer / 100)), l.currency, moneyLocale(lang))} →
            </Button>
          </span>
        )}
        {l.price > 0 && l.negotiable !== false ? (
          // tapTarget={false} on all three: this cluster is 36px-pitch with ZERO gap, so a
          // baked 44px ::before would overflow into its neighbours and a boundary tap would
          // fire the WRONG action (chat → offer, map → chat). Under-44px is a real a11y cost;
          // a mis-fired money-path action is worse. See ui/icon-button's header.
          <IconButton
            size="md"
            tapTarget={false}
            aria-label={tr('Make an offer', 'Trả giá')}
            title={tr('Make an offer', 'Trả giá')}
            aria-pressed={offer !== null}
            onClick={(e) => { e.stopPropagation(); setOffer(offer === null ? 10 : null) }}
            className="hidden text-foreground transition-colors hover:bg-accent sm:flex"
          >
            <Tag className="h-[17px] w-[17px]" />
          </IconButton>
        ) : (
          // Fixed-price / free listings have no offer button — hold its 36px anyway.
          // Without this the actions cluster shrinks, the flex-1 text column grows by
          // the same amount, and the trust badge (ml-auto, so it hangs off that
          // column's right edge) jumps right on exactly those rows — the badges stop
          // forming one vertical column (user-picked 2026-07-14).
          <span aria-hidden className="hidden h-9 w-9 shrink-0 sm:block" />
        )}
        <IconButton
          size="md"
          tapTarget={false}
          aria-label={tr('Chat with seller', 'Nhắn tin với người bán')}
          title={tr('Chat with seller', 'Nhắn tin với người bán')}
          onClick={(e) => { e.stopPropagation(); quickGo({ body: tr('Hi! Is this still available?', 'Chào bạn! Món này còn không?') }) }}
          className={cn('text-foreground transition-colors hover:bg-accent', offer === null ? 'flex' : 'hidden')}
        >
          <MessageCircle className="h-[18px] w-[18px]" />
        </IconButton>
        <IconButton
          size="md"
          tapTarget={false}
          aria-label={tr('Show on map', 'Xem trên bản đồ')}
          onClick={(e) => { e.stopPropagation(); onLocate(l.id) }}
          className={cn('text-foreground transition-colors hover:bg-accent', offer === null ? 'flex' : 'hidden')}
        >
          <MapPin className="h-[18px] w-[18px]" />
        </IconButton>
        {offer === null && <FavoriteHeart id={l.id} className="-mr-0.5" />}
      </div>
    </div>
  )
})
