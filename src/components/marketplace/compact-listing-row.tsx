'use client'

import { memo } from 'react'
import Image from 'next/image'
import { MapPin } from 'lucide-react'
import { TrustScore } from './trust-score'
import { Price } from './price'
import { CategoryIcon } from './category-icons'
import { FavoriteHeart } from './favorite-heart'
import { useLanguage, Tr } from '@/context/language-context'
import type { SerializedListingCard } from '@/lib/types'

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
  const cover = l.images[0]
  const displayTitle = lang === 'vi' ? (l.titleVi || l.title) : l.title

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
          <Tr text={displayTitle} />
        </h4>
        <div className="mt-0.5 flex items-center gap-x-2 text-xs text-muted-foreground">
          <Price price={l.price} currency={l.currency} priceUnit={l.priceUnit} compact className="shrink-0 font-bold text-foreground" />
          <span className="h-3 w-px shrink-0 bg-border" />
          <span className="truncate"><Tr text={l.district || l.city} /></span>
          <TrustScore score={l.seller.trustScore} variant="mini" size="sm" className="shrink-0" />
        </div>
      </div>

      {/* Actions paired together (not stranded): locate-on-map + favorite */}
      <div className="flex shrink-0 items-center">
        <button
          type="button"
          aria-label={tr('Show on map', 'Xem trên bản đồ')}
          onClick={(e) => { e.stopPropagation(); onLocate(l.id) }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground transition-colors cursor-pointer hover:bg-accent"
        >
          <MapPin className="h-[18px] w-[18px]" />
        </button>
        <FavoriteHeart id={l.id} className="-mr-0.5" />
      </div>
    </div>
  )
})
