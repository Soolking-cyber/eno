'use client'

import { useEffect, useState, useRef, memo } from 'react'
import { useRouter } from 'next/navigation'
import { Heart, ChevronLeft, ChevronRight, Building2, MapPin, MessageCircle, Tag } from 'lucide-react'
import { TrustScore } from './trust-score'
import { CardBadges } from './card-badges'
import Image from 'next/image'
import type { SerializedListingCard } from '@/lib/types'
import { Price } from './price'
import { formatMoneyFull, formatCount, moneyLocale, dropPercent } from '@/lib/vnd'
import { CategoryIcon } from './category-icons'
import { isMockImageUrl } from '@/lib/listing-image'
import { cn } from '@/lib/utils'
import { useLanguage, useTr } from '@/context/language-context'
import { useLocalized } from './listing-content'
import { useFavorites } from '@/context/favorites-context'
import { useAuth } from '@/context/auth-context'
import { stashQuickCompose } from '@/lib/quick-contact'

// Tiny neutral blur (matches the card's bg) so images fade in instead of popping
// from a grey box. Shared across all cards.
const BLUR =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjYiPjxyZWN0IHdpZHRoPSI4IiBoZWlnaHQ9IjYiIGZpbGw9IiNlZWYyZjYiLz48L3N2Zz4='

// Brand slug → label ("louis-vuitton" → "Louis Vuitton") for the card's brand line.
function prettyBrand(slug: string): string {
  return slug.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')
}

type Props = {
  listing: SerializedListingCard
  onOpen: (listing: SerializedListingCard) => void
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
  onLocate?: (listing: SerializedListingCard) => void
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
  const { isFavorite, toggle, savedDelta } = useFavorites()
  const favorited = isFavorite(listing.id)
  // One-shot heart-burst: set ONLY when the user saves (not on unsave, and not
  // when favorites hydrate from storage on load). Cleared when the CSS animation
  // ends so a later save replays it.
  const [burst, setBurst] = useState(false)
  // Desktop quick-offer (hover bar): slide a discount, hand off to the PDP composer
  // in offer mode via ?offer=N#contact. null = collapsed.
  const [quickOffer, setQuickOffer] = useState<number | null>(null)
  const router = useRouter()
  const { user, loading: authLoading, openSignIn } = useAuth()

  // Quick actions land IN the conversation: stash the structured compose payload
  // and let /messages/pending create the thread + post it (same flow as the PDP
  // composer). Guests get the sign-in dialog with listing context.
  const quickGo = (opts: { body?: string; offerAmount?: number | null }) => {
    if (!user) { if (!authLoading) openSignIn({ listingTitle: displayTitle, listingImage: images[0] ?? null }); return }
    if (stashQuickCompose(listing, opts)) router.push('/messages/pending')
    else router.push(`/listings/${listing.id}#contact`)
  }
  // "Locate on map" is a default on every card (see card/feed standards). When a
  // parent that owns the map is on-screen (the explorer, its home rails) it passes
  // onLocate for an in-page focus; everywhere else (PDP related/recently-viewed,
  // AI results) we deep-link to the home map focused on this listing via ?focus=.
  const locate = onLocate ?? ((l: SerializedListingCard) => router.push(`/?focus=${l.id}`))
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
      className="reveal-on-scroll group flex flex-col h-full w-full text-left rounded-xl cursor-pointer transition-transform duration-200 [transition-timing-function:var(--ease-spring-snappy)] active:scale-[0.985] [touch-action:manipulation] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {/* Image carousel / placeholder.
          transform-gpu/isolate force a compositing layer so the rounded
          overflow-hidden actually clips the translateX-transformed carousel row
          — otherwise the adjacent (next) image leaks through at the edge on hover. */}
      <div
        data-protected
        className="relative aspect-[10/11] w-full overflow-hidden rounded-xl bg-tint transform-gpu isolate transition-shadow duration-200 group-hover:shadow-[var(--shadow-card)]"
        onMouseEnter={() => { if (images.length > 1) setExpanded(true) }}
        onMouseLeave={() => setQuickOffer(null)}
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

        {/* Top-left signals: Urgent → price-drop % → New (the shared, app-wide badge
            system — see card-badges.tsx). "New" yields when a stronger, honest signal
            (urgent/drop) is present so a narrow card never crowds. */}
        {/* Discount / urgent / new badges — top-left. On desktop hover they fade out
            so the action icons unfurling from the save heart own the top edge cleanly;
            back on mouse-out. (Touch has no hover, so mobile/tablet always show them.) */}
        <CardBadges listing={listing} className="absolute left-2 top-2 z-10 transition-opacity duration-200 pc:group-hover:opacity-0" />

        {/* Social proof — "N saved" (5a #5): urgency without dark patterns. Only
            shows once the count is meaningful (≥3); bottom-left, clear of
            the dots (center) and locate pin (right). */}
        {Math.max(0, listing.savedCount + savedDelta(listing.id)) >= 3 && (
          <span
            title={tr('people saved this', 'người đã lưu tin này')}
            className="pointer-events-none absolute left-2 bottom-2 z-10 flex items-center gap-1 rounded-full bg-foreground/70 px-2 py-0.5 text-[10px] font-bold text-background backdrop-blur-[2px]"
          >
            {/* base savedCount now persists server-side (real saves), and savedDelta adds
                this session's own toggle so it moves the moment the heart is tapped —
                without double-counting once base reloads with the save. */}
            <Heart className="h-2.5 w-2.5 fill-current" /> {new Intl.NumberFormat(moneyLocale(lang) === 'vi' ? 'vi-VN' : 'en-US').format(Math.max(0, listing.savedCount + savedDelta(listing.id)))}
          </span>
        )}

        {/* Quick actions (5a #6) — desktop ONLY: Chat · Offer · Locate unfurl
            horizontally OUT of the save heart (top-right), sliding LEFT into place
            with a slight stagger — chat (nearest the heart) first, then offer, then
            locate — so the row reads as fanning out of the save icon. flex-row-reverse
            lays them out [locate · offer · chat] left→right with chat against the heart.
            Mobile/tablet keep the always-on right-edge column below. Pressing Offer
            opens the centered discount bar (shared with mobile). */}
        <span className="pointer-events-none absolute right-11 top-2 z-10 hidden flex-row-reverse items-center gap-1 pc:flex">
          {quickOffer === null && (
            /* Bare glyph — same face treatment as the heart/pin (white + drop-shadow). */
            <button
              type="button"
              aria-label={tr('Chat with seller', 'Nhắn tin với người bán')}
              title={tr('Chat with seller', 'Nhắn tin với người bán')}
              onClick={(e) => { e.stopPropagation(); quickGo({ body: tr('Hi! Is this still available?', 'Chào bạn! Món này còn không?') }) }}
              className="pointer-events-auto flex h-8 w-8 translate-x-3 items-center justify-center text-white opacity-0 transition-all duration-200 hover:scale-110 active:scale-90 cursor-pointer group-hover:translate-x-0 group-hover:opacity-100 focus-visible:translate-x-0 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.55))]"
            >
              <MessageCircle className="h-[20px] w-[20px]" />
            </button>
          )}
          {listing.price > 0 && listing.negotiable !== false && (
            <button
              type="button"
              aria-label={tr('Make an offer', 'Trả giá')}
              title={tr('Make an offer', 'Trả giá')}
              aria-pressed={quickOffer !== null}
              onClick={(e) => { e.stopPropagation(); setQuickOffer(quickOffer === null ? 10 : null) }}
              className={cn(
                'pointer-events-auto flex h-8 w-8 shrink-0 translate-x-3 items-center justify-center text-white opacity-0 transition-all duration-200 hover:scale-110 active:scale-90 cursor-pointer group-hover:translate-x-0 group-hover:opacity-100 focus-visible:translate-x-0 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.55))]',
                quickOffer === null && 'delay-75 group-hover:delay-75',
              )}
            >
              {/* Pressed = brand fill, mirroring the heart's saved state. The offer
                  controls open as ONE wide edge-to-edge bar (shared with mobile,
                  below) so the amount never gets cramped on a narrow card. */}
              <Tag className={cn('h-[20px] w-[20px]', quickOffer !== null && 'fill-brand')} />
            </button>
          )}
          {quickOffer === null && (
            <button
              type="button"
              aria-label={tr('Show on map', 'Xem trên bản đồ')}
              title={tr('Show on map', 'Xem trên bản đồ')}
              onClick={(e) => { e.stopPropagation(); locate(listing) }}
              className="pointer-events-auto flex h-8 w-8 translate-x-3 items-center justify-center text-white opacity-0 transition-all delay-150 duration-200 hover:scale-110 active:scale-90 cursor-pointer group-hover:translate-x-0 group-hover:opacity-100 group-hover:delay-150 focus-visible:translate-x-0 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.55))]"
            >
              <MapPin className="h-[20px] w-[20px]" />
            </button>
          )}
        </span>

        {/* Right-edge action column: heart + (mobile) chat/offer/pin, ONE column
            spanning the photo so the icons distribute equally top→bottom. On lg the
            chat/offer/pin hide (they live in the left hover stack) and
            justify-between leaves the heart pinned top-right exactly as before. */}
        <span className={cn(
          'absolute bottom-2 right-2 top-2 z-10 flex flex-col items-center justify-between transition-all duration-200',
          quickOffer !== null && 'mobile:pointer-events-none mobile:translate-x-8 mobile:opacity-0',
        )}>
          <button
            type="button"
            aria-label={favorited ? tr('Remove favorite', 'Bỏ lưu') : tr('Add favorite', 'Lưu tin')}
            aria-pressed={favorited}
            onClick={(e) => { e.stopPropagation(); if (!favorited) setBurst(true); toggle(listing.id) }}
            className="relative flex h-8 w-8 items-center justify-center transition-transform hover:scale-110 active:scale-90 cursor-pointer tap-44"
          >
            {/* Icon-only (no chip): white outline + subtle dark fill + drop-shadow —
                legible on ANY photo; blue fill when saved; heart-pop on save. */}
            <span onAnimationEnd={() => setBurst(false)} className={cn('inline-flex', burst && 'animate-heart-pop')}>
              <Heart className={cn('h-[22px] w-[22px] transition-colors [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.5))]', favorited ? 'fill-brand text-white' : 'fill-black/25 text-white')} />
            </span>
          </button>
          <button
            type="button"
            aria-label={tr('Chat with seller', 'Nhắn tin với người bán')}
            onClick={(e) => { e.stopPropagation(); quickGo({ body: tr('Hi! Is this still available?', 'Chào bạn! Món này còn không?') }) }}
            className="relative flex h-8 w-8 items-center justify-center text-white transition-transform active:scale-90 cursor-pointer [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.55))] tap-44 pc:hidden"
          >
            <MessageCircle className="h-[20px] w-[20px]" />
          </button>
          {listing.price > 0 && listing.negotiable !== false && (
            <button
              type="button"
              aria-label={tr('Make an offer', 'Trả giá')}
              aria-pressed={quickOffer !== null}
              onClick={(e) => { e.stopPropagation(); setQuickOffer(quickOffer === null ? 10 : null) }}
              className="relative flex h-8 w-8 items-center justify-center text-white transition-transform active:scale-90 cursor-pointer [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.55))] tap-44 pc:hidden"
            >
              <Tag className={cn('h-[20px] w-[20px]', quickOffer !== null && 'fill-brand')} />
            </button>
          )}
          <button
            type="button"
            aria-label={tr('Show on map', 'Xem trên bản đồ')}
            onClick={(e) => { e.stopPropagation(); locate(listing) }}
            className="relative flex h-8 w-8 items-center justify-center text-white transition-transform active:scale-90 cursor-pointer [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.55))] tap-44 pc:hidden"
          >
            <MapPin className="h-[20px] w-[20px]" />
          </button>
        </span>

        {/* Offer slide — ONE edge-to-edge bar for BOTH mobile + desktop (was a
            cramped inline panel on desktop that squeezed the amount on narrow cards).
            Tapping/clicking anywhere outside it closes the slider. */}
        {quickOffer !== null && (
          <span
            aria-hidden
            onClick={(e) => { e.stopPropagation(); setQuickOffer(null) }}
            className="absolute inset-0 z-10"
          />
        )}
        {quickOffer !== null && (
          <span
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-1 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-1.5 rounded-xl bg-card/95 p-2 shadow-pop backdrop-blur-[2px] animate-in slide-in-from-right-2 fade-in duration-150"
          >
            <span className="flex items-center gap-2">
              <span className="shrink-0 text-[11px] font-bold tabular-nums text-foreground">−{quickOffer}%</span>
              <input
                type="range"
                min={5} max={50} step={5}
                value={quickOffer}
                onChange={(e) => setQuickOffer(Number(e.target.value))}
                aria-label={tr('Discount', 'Mức giảm')}
                className="min-w-0 flex-1 accent-[var(--brand)] cursor-pointer"
              />
            </span>
            <button
              type="button"
              onClick={() => quickGo({ offerAmount: Math.round(listing.price * (1 - quickOffer / 100)) })}
              className="w-full whitespace-nowrap rounded-lg bg-primary px-2 py-1.5 text-[11px] font-bold tabular-nums text-white transition-colors hover:bg-brand-dark cursor-pointer"
            >
              {formatMoneyFull(Math.round(listing.price * (1 - quickOffer / 100)), listing.currency, moneyLocale(lang))} →
            </button>
          </span>
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

        {/* Brand · model — shown when the listing carries them (product categories).
            Neutral on purpose: the price owns the card's single blue accent. */}
        {(listing.brandSlug || listing.model) && (
          <span className="truncate text-[11px] font-semibold text-muted-foreground">
            {[listing.brandSlug ? prettyBrand(listing.brandSlug) : null, listing.model].filter(Boolean).join(' · ')}
          </span>
        )}

        <span className="flex items-baseline gap-1.5">
          {/* The card's single color anchor — brand blue, one step up from the title. */}
          <Price price={listing.price} currency={listing.currency} priceUnit={listing.priceUnit} compact className="text-base font-bold text-accent-foreground" />
          {/* Struck-through "was" anchor — server-computed 30-day-min reference, only
              present while the drop badge is live. */}
          {listing.prevPrice != null && dropPercent(listing.prevPrice, listing.price) && (
            <Price price={listing.prevPrice} currency={listing.currency} priceUnit="VND" compact className="truncate text-[11px] text-ink-4 line-through" />
          )}
        </span>

        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="truncate">{displayLocation}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            {/* Demand proof — distinct contact reveals. Only once meaningful (≥3);
                shares this row, so presence never changes the card height. */}
            {listing.contactCount >= 3 && (
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {tr(`${formatCount(listing.contactCount, moneyLocale(lang))} contacted`, `Đã liên hệ ${formatCount(listing.contactCount, moneyLocale(lang))}`)}
              </span>
            )}
            {/* Mini chip (glyph + number), not a bare number guests can't decode. Display
                only — the card itself is the button (no nested interactive). */}
            <TrustScore score={listing.seller.trustScore} variant="mini" className="shrink-0" />
          </span>
        </div>

        {listing.seller.isBusiness && (
          <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-bold text-muted-foreground">
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
