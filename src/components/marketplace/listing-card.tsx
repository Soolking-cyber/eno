'use client'

import { useState, useRef } from 'react'
import { Heart, BadgeCheck, ChevronLeft, ChevronRight, Star } from 'lucide-react'
import Image from 'next/image'
import type { SerializedListing } from '@/lib/types'
import { Price } from './price'
import { CategoryIcon } from './category-icons'
import { cn } from '@/lib/utils'
import { useLanguage, useTr } from '@/context/language-context'
import { useFavorites } from '@/context/favorites-context'

// Tiny neutral blur (matches the card's bg) so images fade in instead of popping
// from a grey box. Shared across all cards.
const BLUR =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjYiPjxyZWN0IHdpZHRoPSI4IiBoZWlnaHQ9IjYiIGZpbGw9IiNlZWYyZjYiLz48L3N2Zz4='

type Props = {
  listing: SerializedListing
  onOpen: (listing: SerializedListing) => void
  priority?: boolean
  // The single LCP card (first card of the first landing row): use next/image's
  // real `priority` so Next emits a <link rel=preload> for its image.
  lcp?: boolean
  // Accurate per-context sizing so the browser downloads card-sized images, not
  // full-width. Default = the result grid (2/3/4 cols); CardRow passes fixed px.
  sizes?: string
}

export function ListingCard({
  listing,
  onOpen,
  priority = false,
  lcp = false,
  sizes = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw',
}: Props) {
  const { lang, t, tr } = useLanguage()
  const images = listing.images
  const displayTitle = useTr(lang === 'vi' ? (listing.titleVi || listing.title) : listing.title)
  const displayLocation = useTr(listing.location)
  const { isFavorite, toggle } = useFavorites()
  const favorited = isFavorite(listing.id)
  const [idx, setIdx] = useState(0)
  // Only the first image is in the DOM until the user engages the carousel
  // (hover/touch) — cuts initial DOM nodes + image bytes on the homepage grid.
  const [expanded, setExpanded] = useState(false)
  const touchStartX = useRef<number | null>(null)
  const suppressClick = useRef(false)

  const last = images.length - 1
  const goTo = (n: number) => setIdx(Math.max(0, Math.min(last, n)))

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        if (suppressClick.current) { suppressClick.current = false; return }
        onOpen(listing)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(listing) }
      }}
      className="group flex flex-col h-full w-full text-left rounded-xl cursor-pointer transition-transform duration-150 active:scale-[0.985] active:duration-75 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0a66c2] focus-visible:ring-offset-2"
    >
      {/* Image carousel / placeholder.
          transform-gpu/isolate force a compositing layer so the rounded
          overflow-hidden actually clips the translateX-transformed carousel row
          — otherwise the adjacent (next) image leaks through at the edge on hover. */}
      <div
        className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-[#f1f5f9] transform-gpu isolate transition-shadow duration-200 group-hover:shadow-[var(--shadow-card)]"
        onMouseEnter={() => { if (images.length > 1) setExpanded(true) }}
        onTouchStart={(e) => { if (images.length > 1) setExpanded(true); touchStartX.current = e.touches[0].clientX }}
        onTouchEnd={(e) => {
          if (touchStartX.current == null || images.length < 2) return
          const dx = e.changedTouches[0].clientX - touchStartX.current
          if (Math.abs(dx) > 40) { suppressClick.current = true; goTo(idx + (dx < 0 ? 1 : -1)) }
          touchStartX.current = null
        }}
      >
        {images.length > 0 ? (
          <div
            className="flex h-full w-full transition-transform duration-300 ease-out"
            style={{ transform: `translateX(-${idx * 100}%)` }}
          >
            {images.slice(0, expanded ? images.length : 1).map((src, i) => (
              <div key={i} className="relative h-full w-full shrink-0 overflow-hidden">
                <Image
                  src={src}
                  alt={images.length > 1 ? `${displayTitle} — ${i + 1}/${images.length}` : displayTitle}
                  fill
                  sizes={sizes}
                  className="object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                  placeholder="blur"
                  blurDataURL={BLUR}
                  quality={60}
                  // The true LCP image (first card of the first row, first photo) uses
                  // next/image `priority` so Next emits a <link rel=preload> — the preload
                  // scanner fetches it before render. Other above-the-fold images just load
                  // eagerly (no preload flood across every row).
                  {...(lcp && i === 0
                    ? { priority: true }
                    : { loading: priority && i === 0 ? 'eager' : 'lazy' })}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[#f1f5f9]">
            <CategoryIcon name={listing.category.icon} className="h-10 w-10 text-slate-300" />
          </div>
        )}

        {/* favorite heart */}
        <button
          type="button"
          aria-label={favorited ? tr('Remove favorite', 'Bỏ lưu') : tr('Add favorite', 'Lưu tin')}
          aria-pressed={favorited}
          onClick={(e) => { e.stopPropagation(); toggle(listing.id) }}
          className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/95 shadow-sm transition-transform hover:scale-110 active:scale-90 cursor-pointer"
        >
          {/* key remounts on favorite → re-runs the CSS pop (replaces framer scale) */}
          <span key={favorited ? 'on' : 'off'} className={cn('inline-flex', favorited && 'animate-heart-pop')}>
            <Heart className={cn('h-[18px] w-[18px] transition-colors', favorited ? 'fill-[#0a66c2] text-[#0a66c2]' : 'text-[#1a202c]')} />
          </span>
        </button>

        {/* carousel arrows (desktop hover, only when multiple images) */}
        {images.length > 1 && (
          <>
            {idx > 0 && (
              <button
                type="button"
                aria-label={tr('Previous photo')}
                onClick={(e) => { e.stopPropagation(); goTo(idx - 1) }}
                className="absolute left-2 top-1/2 -translate-y-1/2 z-10 hidden h-7 w-7 items-center justify-center rounded-full bg-white/95 text-[#1a202c] shadow-sm opacity-0 transition-opacity group-hover:flex group-hover:opacity-100 hover:scale-110 cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {idx < last && (
              <button
                type="button"
                aria-label={tr('Next photo')}
                onClick={(e) => { e.stopPropagation(); goTo(idx + 1) }}
                className="absolute right-2 top-1/2 -translate-y-1/2 z-10 hidden h-7 w-7 items-center justify-center rounded-full bg-white/95 text-[#1a202c] shadow-sm opacity-0 transition-opacity group-hover:flex group-hover:opacity-100 hover:scale-110 cursor-pointer"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
            {/* dots */}
            <div className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1">
              {images.map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    'h-1.5 rounded-full bg-white transition-all',
                    i === idx ? 'w-3 opacity-100' : 'w-1.5 opacity-60',
                  )}
                  style={{ boxShadow: '0 0 2px rgba(0,0,0,0.4)' }}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Body — title · price · location · verified */}
      <div className="flex flex-1 flex-col gap-1 px-0.5 pt-2.5">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-[#1a202c] group-hover:underline decoration-1 underline-offset-2">
          {displayTitle}
        </h3>

        <Price price={listing.price} currency={listing.currency} priceUnit={listing.priceUnit} compact className="text-sm font-bold text-[#1a202c]" />

        <div className="flex items-center justify-between gap-2 text-xs text-[#64748b]">
          <span className="truncate">{displayLocation}</span>
          <span className="flex shrink-0 items-center gap-0.5 text-[#1a202c]">
            <Star className="h-3 w-3 fill-[#1a202c] text-[#1a202c]" />
            {listing.seller.rating.toFixed(1)}
          </span>
        </div>

        {listing.verified && (
          <span className="mt-0.5 inline-flex w-fit items-center gap-1 rounded-md bg-[#e8f1fb] px-1.5 py-0.5 text-[10px] font-semibold text-[#0a66c2]">
            <BadgeCheck className="h-3 w-3" />
            {t('card.verified')}
          </span>
        )}
      </div>
    </div>
  )
}
