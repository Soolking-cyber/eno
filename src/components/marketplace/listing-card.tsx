'use client'

import { useEffect, useState, useRef, memo } from 'react'
import { Heart, ChevronLeft, ChevronRight, Building2, MapPin } from 'lucide-react'
import { TrustScore } from './trust-score'
import Image from 'next/image'
import type { SerializedListing } from '@/lib/types'
import { Price } from './price'
import { CategoryIcon } from './category-icons'
import { isMockImageUrl } from '@/lib/listing-image'
import { cn } from '@/lib/utils'
import { useLanguage, useTr } from '@/context/language-context'
import { useLocalized } from './listing-content'
import { useFavorites } from '@/context/favorites-context'

// Tiny neutral blur (matches the card's bg) so images fade in instead of popping
// from a grey box. Shared across all cards.
const BLUR =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjYiPjxyZWN0IHdpZHRoPSI4IiBoZWlnaHQ9IjYiIGZpbGw9IiNlZWYyZjYiLz48L3N2Zz4='

// Brand slug → label ("louis-vuitton" → "Louis Vuitton") for the card's brand line.
function prettyBrand(slug: string): string {
  return slug.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')
}

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
  // When set, a "locate on map" pin shows at the image bottom-right (mirrors the
  // heart) → jump to the map focused on this listing. Receives the listing so the
  // parent can pass ONE stable callback (keeps React.memo effective); `() => void`
  // callers stay compatible (they just ignore the arg).
  onLocate?: (listing: SerializedListing) => void
}

function ListingCardImpl({
  listing,
  onOpen,
  priority = false,
  lcp = false,
  sizes = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw',
  onLocate,
}: Props) {
  const { lang, t, tr } = useLanguage()
  const images = listing.images
  const displayTitle = useLocalized(listing.title, listing.titleVi, listing.titleI18n)
  const displayLocation = useTr(listing.location)
  const { isFavorite, toggle } = useFavorites()
  const favorited = isFavorite(listing.id)
  // One-shot heart-burst: set ONLY when the user saves (not on unsave, and not
  // when favorites hydrate from storage on load). Cleared when the CSS animation
  // ends so a later save replays it.
  const [burst, setBurst] = useState(false)
  const [idx, setIdx] = useState(0)
  // Only the first image is in the DOM until the user engages the carousel
  // (hover/touch) — cuts initial DOM nodes + image bytes on the homepage grid.
  const [expanded, setExpanded] = useState(false)
  // Image-failure recovery. All FIRST slides on a feed fetch simultaneously on page
  // load (later slides lazy-load), and the mock host (picsum) rate-limits under that
  // burst — a single onError used to placeholder the slide for the whole session even
  // though a retry succeeds. Now: first failure → placeholder + ONE delayed retry
  // (key bump remounts the <Image> → fresh fetch); a second failure → placeholder for
  // good (genuinely dead URL). Timers cleared on unmount.
  const [slideDown, setSlideDown] = useState<Record<number, boolean>>({})
  const [slideTry, setSlideTry] = useState<Record<number, number>>({})
  const imgAttempts = useRef<Record<number, number>>({})
  const retryTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => { retryTimers.current.forEach(clearTimeout) }, [])
  const onImgError = (i: number) => {
    const n = (imgAttempts.current[i] ?? 0) + 1
    imgAttempts.current[i] = n
    setSlideDown((prev) => ({ ...prev, [i]: true }))
    if (n < 2) {
      // Jittered backoff so a whole grid of blipped cards doesn't re-stampede the host.
      retryTimers.current.push(setTimeout(() => {
        setSlideDown((prev) => ({ ...prev, [i]: false }))
        setSlideTry((prev) => ({ ...prev, [i]: n }))
      }, 1200 + Math.random() * 1500))
    }
  }
  const touchStartX = useRef<number | null>(null)
  const suppressClick = useRef(false)

  const last = images.length - 1
  const goTo = (n: number) => setIdx(Math.max(0, Math.min(last, n)))

  // Freshness cue: a quiet "New" chip for the first ~48h only. Absence is neutral —
  // we never stamp a date on every card (that would just visibly age stale stock).
  const isNew = !!listing.postedAt && Date.now() - new Date(listing.postedAt).getTime() < 48 * 60 * 60 * 1000

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
      className="group flex flex-col h-full w-full text-left rounded-xl cursor-pointer transition-transform duration-100 active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {/* Image carousel / placeholder.
          transform-gpu/isolate force a compositing layer so the rounded
          overflow-hidden actually clips the translateX-transformed carousel row
          — otherwise the adjacent (next) image leaks through at the edge on hover. */}
      <div
        data-protected
        className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-tint transform-gpu isolate transition-shadow duration-200 group-hover:shadow-[var(--shadow-card)]"
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
                {slideDown[i] ? (
                  <div className="flex h-full w-full items-center justify-center bg-tint">
                    <CategoryIcon name={listing.category.icon} className="h-10 w-10 text-muted-foreground" />
                  </div>
                ) : (
                  <Image
                    key={`${i}:${slideTry[i] ?? 0}`}
                    src={src}
                    alt={images.length > 1 ? `${displayTitle} — ${i + 1}/${images.length}` : displayTitle}
                    fill
                    sizes={sizes}
                    className="object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                    placeholder="blur"
                    blurDataURL={BLUR}
                    quality={60}
                    // Mock/seed images (picsum) are already CDN-sized — bypass the Vercel
                    // optimizer (saves transformations AND removes a failure hop). No-op
                    // for real Supabase images; goes away with the mock data at launch.
                    unoptimized={isMockImageUrl(src)}
                    onError={() => onImgError(i)}
                    // The true LCP image (first card of the first row, first photo) uses
                    // next/image `priority` so Next emits a <link rel=preload> — the preload
                    // scanner fetches it before render. Other above-the-fold images just load
                    // eagerly (no preload flood across every row).
                    {...(lcp && i === 0
                      ? { priority: true }
                      : { loading: priority && i === 0 ? 'eager' : 'lazy' })}
                  />
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-tint">
            <CategoryIcon name={listing.category.icon} className="h-10 w-10 text-muted-foreground" />
          </div>
        )}

        {/* Legibility scrims — faint top+bottom gradients so the white heart / locate
            pin / dots survive pale photos (sky, sand). Theme-neutral by design: they
            sit ON the photo, so black works in both light and dark. */}
        {images.length > 0 && (
          <>
            <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-black/20 to-transparent" />
            <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/20 to-transparent" />
          </>
        )}

        {/* eno.vn watermark — hidden until a save/copy/drag attempt (ImageShield) */}
        {images.length > 0 && <span className="img-watermark" aria-hidden />}

        {/* Freshness chip — top-left, only for recently posted listings. */}
        {isNew && (
          <span className="absolute left-2 top-2 z-10 rounded-full bg-foreground/85 px-2 py-0.5 text-[10px] font-bold text-background shadow-sm backdrop-blur-[2px]">
            {tr('New', 'Mới')}
          </span>
        )}

        {/* favorite heart */}
        <button
          type="button"
          aria-label={favorited ? tr('Remove favorite', 'Bỏ lưu') : tr('Add favorite', 'Lưu tin')}
          aria-pressed={favorited}
          onClick={(e) => { e.stopPropagation(); if (!favorited) setBurst(true); toggle(listing.id) }}
          className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center transition-transform hover:scale-110 active:scale-90 cursor-pointer tap-44"
        >
          {/* Icon-only (no chip): white outline + subtle dark fill + drop-shadow so
              it stays legible on ANY photo, in light & dark. Blue fill when saved.
              animate-heart-pop = one-shot pop + radial ring (globals.css). */}
          <span onAnimationEnd={() => setBurst(false)} className={cn('inline-flex', burst && 'animate-heart-pop')}>
            <Heart className={cn('h-[22px] w-[22px] transition-colors [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.5))]', favorited ? 'fill-brand text-white' : 'fill-black/25 text-white')} />
          </span>
        </button>

        {/* Locate on map — bottom-right, mirrors the heart (icon-only, white + shadow) */}
        {onLocate && (
          <button
            type="button"
            aria-label={tr('Show on map', 'Xem trên bản đồ')}
            onClick={(e) => { e.stopPropagation(); onLocate(listing) }}
            className="absolute right-2 bottom-2 z-10 flex h-8 w-8 items-center justify-center text-white transition-transform hover:scale-110 active:scale-90 cursor-pointer [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.55))] tap-44"
          >
            <MapPin className="h-[20px] w-[20px]" />
          </button>
        )}

        {/* carousel arrows (desktop hover, only when multiple images) */}
        {images.length > 1 && (
          <>
            {idx > 0 && (
              <button
                type="button"
                aria-label={tr('Previous photo')}
                onClick={(e) => { e.stopPropagation(); goTo(idx - 1) }}
                className="absolute left-1 top-1/2 -translate-y-1/2 z-10 hidden h-8 w-8 items-center justify-center text-white opacity-0 transition-opacity group-hover:flex group-hover:opacity-100 hover:scale-110 cursor-pointer [filter:drop-shadow(0_1px_3px_rgba(0,0,0,0.55))] tap-44"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
            )}
            {idx < last && (
              <button
                type="button"
                aria-label={tr('Next photo')}
                onClick={(e) => { e.stopPropagation(); goTo(idx + 1) }}
                className="absolute right-1 top-1/2 -translate-y-1/2 z-10 hidden h-8 w-8 items-center justify-center text-white opacity-0 transition-opacity group-hover:flex group-hover:opacity-100 hover:scale-110 cursor-pointer [filter:drop-shadow(0_1px_3px_rgba(0,0,0,0.55))] tap-44"
              >
                <ChevronRight className="h-6 w-6" />
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
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-foreground group-hover:underline decoration-1 underline-offset-2">
          {displayTitle}
        </h3>

        {/* Brand · model — shown when the listing carries them (product categories). */}
        {(listing.brandSlug || listing.model) && (
          <span className="truncate text-[11px] font-semibold text-accent-foreground">
            {[listing.brandSlug ? prettyBrand(listing.brandSlug) : null, listing.model].filter(Boolean).join(' · ')}
          </span>
        )}

        <Price price={listing.price} currency={listing.currency} priceUnit={listing.priceUnit} compact className="text-sm font-bold text-foreground" />

        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="truncate">{displayLocation}</span>
          {/* Mini chip (glyph + number), not a bare number guests can't decode. Display
              only — the card itself is the button (no nested interactive). */}
          <TrustScore score={listing.seller.trustScore} variant="mini" className="shrink-0" />
        </div>

        {listing.seller.isBusiness && (
          <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-bold text-accent-foreground">
            <Building2 className="h-3 w-3" /> {tr('Business', 'Doanh nghiệp')}
          </span>
        )}
      </div>
    </div>
  )
}

// Memoized: the homepage/explorer feed re-renders on every map hover/focus state
// change. With stable `onOpen`/`onLocate` callbacks from the parent (useCallback),
// memo lets unaffected cards skip re-render — kills the map-hover re-render storm
// across a long grid. Favorite/language changes still flow via context.
export const ListingCard = memo(ListingCardImpl)
