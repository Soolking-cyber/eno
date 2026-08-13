'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Heart, MessageCircle, Share2, Volume2, VolumeX, Play, Film, X, ChevronUp, ChevronDown } from '@/components/ui/icons'
import { STROKE_NAV, STROKE_FLOAT, STROKE_DISPLAY } from '@/lib/icon-tokens'
import type { SerializedListingCard } from '@/lib/types'
import { useLanguage, useTr } from '@/context/language-context'
import { useFavorites } from '@/context/favorites-context'
import { useAuth } from '@/context/auth-context'
import { useLocalized } from './listing-content'
import { Price } from './price'
import { Spinner } from '@/components/ui/spinner'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { pushBlackStatusBar } from '@/components/native/native-bootstrap'
import { stashQuickCompose } from '@/lib/quick-contact'
import { optimizedImageUrl } from '@/lib/listing-image'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// Full-screen TikTok-style vertical feed of the listings (in the current search/filters) that
// carry a video. It TAKES OVER the viewport (portal → <body>, black canvas) rather than sitting
// in the page: full-bleed on mobile; a centred portrait clip with the action rail beside it +
// up/down arrows on desktop. Minimal overlay — title · price · location · View listing.
export function VideoFeed({
  baseParams,
  onOpen,
  onPrefetch,
  onClose,
  restoreTo = null,
}: {
  baseParams: string
  onOpen: (l: SerializedListingCard) => void
  onPrefetch?: (id: string) => void
  onClose: () => void
  // When re-opened after a back-nav from a listing (eno:video-return), restore to the clip the
  // buyer left off on instead of snapping back to the top. By ID, not index: the feed's ordering
  // can drift between leave and return (new listings, rank changes) — an index would silently
  // land on the wrong clip. `params` is the baseParams the stash was written under: filters
  // hydrate from the URL asynchronously (150ms query debounce), so the first fetch here can be
  // the UNFILTERED list — the restore waits until baseParams matches before acting.
  restoreTo?: { id: string; params: string } | null
}) {
  const { tr } = useLanguage()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeIdx, setActiveIdx] = useState(0)
  // Muted by default (browsers block unmuted autoplay); a session toggle the user controls.
  const [muted, setMuted] = useState(true)
  // onClose is an inline arrow in the parent (fresh identity every render); hold it in a ref so
  // the history/keyboard effect below can run once on mount without re-pushing history entries.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const { data, isLoading, isError } = useQuery({
    queryKey: ['video-feed', baseParams],
    queryFn: async () => {
      const params = new URLSearchParams(baseParams)
      params.set('hasVideo', '1')
      params.set('limit', '30')
      const res = await fetch(`/api/listings?${params.toString()}`)
      if (!res.ok) throw new Error('failed')
      return res.json() as Promise<{ listings: SerializedListingCard[]; total: number }>
    },
    staleTime: 30_000,
  })
  const items = data?.listings ?? []

  // Lock the page behind the takeover; Escape closes it. Push a synthetic history entry so the
  // Android system back button (and browser Back) CLOSES the feed instead of leaving the results
  // page — mirrored symmetrically on close (history.back() consumes the entry we pushed). Runs
  // once on mount (deps []) via the onCloseRef above so parent re-renders don't churn history.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Native status bar → light glyphs for as long as this black canvas is up (a no-op on web).
    // Released in the cleanup below, which React runs on EVERY exit — ✕, Escape, the Android
    // hardware back button, the iOS edge-swipe, or navigating out to a listing — so the bar can't
    // be stranded with invisible dark glyphs.
    const releaseStatusBar = pushBlackStatusBar()
    // Reuse an existing takeover entry instead of stacking a new one: after a back-nav from a
    // listing opened inside the feed, the restored history entry ALREADY carries the flag —
    // pushing again would accumulate one dead Back-press per open-listing round trip.
    if (window.history.state?.takeover !== 'video') window.history.pushState({ takeover: 'video' }, '')
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current() }
    const onPop = () => { onCloseRef.current() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('popstate', onPop)
    return () => {
      document.body.style.overflow = prev
      releaseStatusBar()
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('popstate', onPop)
      // Closed via ✕/Escape (not Back): our entry is still current, so pop it to keep the back
      // stack balanced. If Back closed it, the entry is already gone and history.state won't match.
      if (window.history.state?.takeover === 'video') window.history.back()
    }
  }, [])

  // The most-visible clip becomes active (plays); the rest pause. Re-observe when items load
  // AND whenever the window moves — windowing swaps placeholder↔real DOM nodes around
  // activeIdx, and the observer must track the CURRENT elements, not the replaced ones.
  useEffect(() => {
    const root = scrollRef.current
    if (!root || items.length === 0) return
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio >= 0.6) setActiveIdx(Number((e.target as HTMLElement).dataset.idx))
        }
      },
      { root, threshold: [0.6] },
    )
    root.querySelectorAll('[data-idx]').forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [items.length, activeIdx])

  // Restore to the clip the buyer left off on (back-nav from a listing). Waits until the loaded
  // items are the RIGHT dataset (baseParams matches the stash) and the clip still exists; the
  // placeholder div at its index always exists (windowing renders one per item), so scroll to it
  // and the observer promotes it to the active real <video>. Not consumed until it succeeds — if
  // the listing is gone (sold/deleted) the feed just opens at the top.
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current || !restoreTo || restoreTo.params !== baseParams) return
    const idx = items.findIndex((l) => l.id === restoreTo.id)
    if (idx < 0) return
    restoredRef.current = true
    if (idx > 0) scrollRef.current?.querySelector<HTMLElement>(`[data-idx="${idx}"]`)?.scrollIntoView()
  }, [items, restoreTo, baseParams])

  // Opening a listing from the feed: stash where we are so a Back returns to this exact clip
  // (mirrors the eno:feed-snap grid restore). Path-scoped + timestamped; consumed once by the
  // explorer on remount.
  const openListing = useCallback((l: SerializedListingCard) => {
    try {
      sessionStorage.setItem('eno:video-return', JSON.stringify({ path: window.location.pathname, id: l.id, params: baseParams, ts: Date.now() }))
    } catch { /* ignore quota */ }
    onOpen(l)
  }, [onOpen, baseParams])

  // Desktop up/down arrows → snap to the neighbouring clip.
  const go = (dir: -1 | 1) => {
    const els = scrollRef.current?.querySelectorAll<HTMLElement>('[data-idx]')
    els?.[activeIdx + dir]?.scrollIntoView({ behavior: 'smooth' })
  }

  const shell = (children: React.ReactNode) =>
    createPortal(
      <div className="fixed inset-0 z-[60] bg-black">
        <IconButton
          size="lg"
          onClick={onClose}
          aria-label={tr('Close', 'Đóng')}
          // Safe-area top: under viewport-fit:cover the notch/status bar would otherwise clip it.
          // The baked tap-44 lifts the 40×40 glyph to a 44px hit target; `fixed` MUST stay here in
          // className — it's what beats the primitive's baked `relative` (twMerge, last wins) and
          // positions the ::before hit area correctly.
          className="fixed left-4 top-[calc(env(safe-area-inset-top)+1rem)] z-[70] bg-black/40 text-white backdrop-blur transition-transform hover:scale-105 active:scale-[0.96]"
        >
          {/* Takeover chrome = the platform weight at the header's h-6 step (§2/§4) —
              this ✕ is the same control as the header/lightbox close, so same tier. */}
          <X className="h-6 w-6" strokeWidth={STROKE_NAV} />
        </IconButton>
        {children}
      </div>,
      document.body,
    )

  if (isLoading) return shell(<div className="flex h-full items-center justify-center"><Spinner size="md" className="border-white/30 border-t-white" /></div>)

  if (isError || items.length === 0) {
    // Supply-side empty state: "try another filter" was a lie on a catalog with zero videos —
    // convert the visitor into the first video poster instead.
    return shell(
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-white/90">
        {/* Echo of the foundation EmptyState: glyph on a quiet coin at the display
            stroke (a 40px glyph at stroke 2 looks rubber-stamped — §2). The coin is
            neutral white/10, not brand-50: this canvas is always black, no theme. */}
        <span className="mb-1 flex h-16 w-16 items-center justify-center rounded-full bg-white/10">
          <Film className="h-10 w-10 text-white/70" strokeWidth={STROKE_DISPLAY} />
        </span>
        <p className="text-sm font-semibold">{tr('No videos here yet', 'Chưa có video nào')}</p>
        <p className="max-w-xs text-xs text-white/60">
          {tr('Listings with a short clip stand out — add one to yours.', 'Tin có video ngắn nổi bật hơn hẳn — hãy thêm video vào tin của bạn.')}
        </p>
        <Link href="/post" className="mt-3 inline-flex items-center rounded-full bg-white px-5 py-2 text-sm font-bold text-black transition-transform active:scale-[0.96]">
          {tr('Post a listing with video', 'Đăng tin kèm video')}
        </Link>
      </div>,
    )
  }

  return shell(
    <>
      <div ref={scrollRef} className="h-full w-full snap-y snap-mandatory overflow-y-auto overscroll-contain scrollbar-none">
        {items.map((l, i) =>
          // WINDOWING: materialize only the active clip ± 1 neighbor. Mounting all 30 items
          // spun up 30 <video> pipelines and eagerly fetched 30 posters (~10MB on Slow-4G)
          // the moment the feed opened. Placeholders keep identical snap geometry and carry
          // data-idx so the IntersectionObserver still advances activeIdx while scrolling.
          Math.abs(i - activeIdx) <= 1 ? (
            <VideoFeedItem
              key={l.id}
              listing={l}
              index={i}
              active={i === activeIdx}
              muted={muted}
              onToggleMute={() => setMuted((m) => !m)}
              onOpen={openListing}
              onPrefetch={onPrefetch}
            />
          ) : (
            <div key={l.id} data-idx={i} className="h-full w-full snap-start snap-always" />
          ),
        )}
      </div>

      {/* Desktop prev/next arrows (far right, like TikTok web). */}
      <div className="fixed right-6 top-1/2 z-[65] hidden -translate-y-1/2 flex-col gap-3 sm:flex">
        <Button
          variant="bare"
          size="none"
          type="button"
          onClick={() => go(-1)}
          disabled={activeIdx === 0}
          aria-label={tr('Previous', 'Trước')}
          // disabled:opacity-30 must stay: it merges OVER the base disabled:opacity-50 (same
          // twMerge group), keeping the dimmer end-of-list arrows. `flex` + `transition` likewise
          // override the base inline-flex / transition-all — the h-6 icons beat the base's
          // :where() size-4 rule on their own.
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-30"
        >
          {/* Floating chevrons over content → the floating tier (§2), same as the
              card carousel's arrows and back-to-top. */}
          <ChevronUp className="h-6 w-6" strokeWidth={STROKE_FLOAT} />
        </Button>
        <Button
          variant="bare"
          size="none"
          type="button"
          onClick={() => go(1)}
          disabled={activeIdx >= items.length - 1}
          aria-label={tr('Next', 'Sau')}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-30"
        >
          <ChevronDown className="h-6 w-6" strokeWidth={STROKE_FLOAT} />
        </Button>
      </div>
    </>,
  )
}

function VideoFeedItem({
  listing,
  index,
  active,
  muted,
  onToggleMute,
  onOpen,
  onPrefetch,
}: {
  listing: SerializedListingCard
  index: number
  active: boolean
  muted: boolean
  onToggleMute: () => void
  onOpen: (l: SerializedListingCard) => void
  onPrefetch?: (id: string) => void
}) {
  const { tr } = useLanguage()
  const router = useRouter()
  const { user, loading: authLoading, openSignIn } = useAuth()
  const { isFavorite, toggle } = useFavorites()
  const favorited = isFavorite(listing.id)
  const title = useLocalized(listing.title, listing.titleVi, listing.titleI18n)
  const location = useTr(listing.location)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [paused, setPaused] = useState(false)

  // Play only the active clip; pause + rewind the rest (one streams at a time).
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (active) { setPaused(false); v.play().catch(() => {}) }
    else { v.pause(); try { v.currentTime = 0 } catch { /* not seekable yet */ } }
  }, [active])

  // Set muted imperatively — React's `muted` prop doesn't reliably reflect to the DOM.
  useEffect(() => { if (videoRef.current) videoRef.current.muted = muted }, [muted, active])

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) { v.play().catch(() => {}); setPaused(false) }
    else { v.pause(); setPaused(true) }
  }

  const chat = () => {
    if (!user) { if (!authLoading) openSignIn({ listingTitle: title, listingImage: listing.images[0] ?? null }); return }
    if (stashQuickCompose(listing, { body: tr('Hi! Is this still available?', 'Chào bạn! Món này còn không?') })) router.push('/messages/pending')
    else router.push(`/listings/${listing.id}#contact`)
  }
  const share = useCallback(async () => {
    const url = `${window.location.origin}/listings/${listing.id}`
    // Capacitor shell first: Android's WebView has neither navigator.share nor a reliable
    // navigator.clipboard, but @capacitor/share IS synced on both platforms (mirrors
    // native-bootstrap's long-press sheet).
    if ((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()) {
      try { const { Share } = await import('@capacitor/share'); await Share.share({ title, url }) } catch { /* dismissed */ }
      return
    }
    try {
      if (navigator.share) await navigator.share({ title, url })
      else { await navigator.clipboard.writeText(url); toast.success(tr('Link copied', 'Đã sao chép liên kết')) }
    } catch { /* dismissed */ }
  }, [listing.id, title, tr])

  return (
    <div data-idx={index} className="relative flex h-full w-full snap-start snap-always items-center justify-center">
      {/* Stage: full-bleed on mobile; a centred portrait frame on desktop (black on the sides). */}
      <div className="relative h-full w-full sm:aspect-[9/16] sm:w-auto">
        {listing.video && (
          <video
            ref={videoRef}
            src={listing.video}
            poster={listing.images[0] ? optimizedImageUrl(listing.images[0]) : undefined}
            loop
            playsInline
            muted
            preload={active ? 'auto' : 'none'}
            onClick={togglePlay}
            className="h-full w-full object-cover"
          />
        )}

        {paused && (
          <Button
            variant="bare"
            size="none"
            onClick={togglePlay}
            aria-label={tr('Play', 'Phát')}
            // active:scale-100 kills the base press-scale: this button IS the video surface
            // (absolute inset-0), so the base active:scale-[0.97] would visibly shrink the whole
            // frame on every tap-to-play.
            className="absolute inset-0 z-10 flex items-center justify-center active:scale-100"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-[2px]">
              {/* Filled play mark, h-7 (the ladder's 28px step — h-8 is off-grid). */}
              <Play className="h-7 w-7 fill-current" />
            </span>
          </Button>
        )}

        {/* Legibility gradient. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

        {/* Info overlay — bottom-left, minimal. Tapping title / View opens the listing. pb tracks
            the safe-area inset so the CTA clears the home indicator under viewport-fit:cover. */}
        <div className="absolute inset-x-0 bottom-0 z-10 p-5 pr-16 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] text-white sm:pr-6">
          {/* whitespace-normal: the base is whitespace-nowrap and white-space INHERITS — without
              it the line-clamp-2 <h3> below collapses to one unwrappable line. `block` keeps the
              original box (the base is inline-flex). */}
          <Button
            variant="bare"
            size="none"
            onClick={() => onOpen(listing)}
            onMouseEnter={() => onPrefetch?.(listing.id)}
            className="block max-w-md whitespace-normal text-left"
          >
            <h3 className="line-clamp-2 text-base font-semibold leading-snug drop-shadow sm:text-lg">{title}</h3>
          </Button>
          <div className="mt-1">
            <Price price={listing.price} currency={listing.currency} priceUnit={listing.priceUnit} compact className="text-xl text-white drop-shadow" />
          </div>
          {(location || listing.model) && (
            <p className="mt-0.5 truncate text-sm text-white/80 drop-shadow">{[location, listing.model].filter(Boolean).join(' · ')}</p>
          )}
          <Button
            variant="bare"
            size="none"
            type="button"
            onClick={() => onOpen(listing)}
            onMouseEnter={() => onPrefetch?.(listing.id)}
            // font-bold / active:scale-[0.96] / transition-transform sit on the PRIMITIVE (not a
            // child), so cn() merges them over the base font-medium / active:scale-[0.97] /
            // transition-all instead of concatenating and losing on stylesheet order.
            className="mt-3 inline-flex items-center rounded-full bg-white px-5 py-2 text-sm font-bold text-black transition-transform active:scale-[0.96]"
          >
            {tr('View listing', 'Xem tin')}
          </Button>
        </div>

        {/* Action rail — overlays the clip's bottom-right on mobile; sits BESIDE the clip (on the
            black) on desktop. */}
        <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+1.5rem)] right-2.5 z-10 flex flex-col items-center gap-5 text-white sm:bottom-10 sm:left-full sm:right-auto sm:ml-5">
          {/* h-7 @ STROKE_NAV — the bottom-nav tier (§2/§4): this rail IS the takeover's
              nav chrome, and h-8 sat off the ladder. Saved keeps the §5 user-state pair
              (fill-brand + brand line). */}
          <RailButton label={favorited ? tr('Saved', 'Đã lưu') : tr('Save', 'Lưu')} onClick={() => toggle(listing.id)}>
            <Heart strokeWidth={STROKE_NAV} className={cn('icon-own-ink h-7 w-7 transition-colors [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.6))]', favorited ? 'fill-current text-destructive' : 'text-white')} />
          </RailButton>
          <RailButton label={tr('Chat with seller', 'Nhắn tin')} onClick={chat}>
            <MessageCircle strokeWidth={STROKE_NAV} className="h-7 w-7 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.6))]" />
          </RailButton>
          <RailButton label={tr('Share', 'Chia sẻ')} onClick={share}>
            <Share2 strokeWidth={STROKE_NAV} className="h-7 w-7 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.6))]" />
          </RailButton>
          <RailButton label={muted ? tr('Unmute', 'Bật tiếng') : tr('Mute', 'Tắt tiếng')} onClick={onToggleMute}>
            {muted ? <VolumeX strokeWidth={STROKE_NAV} className="h-7 w-7 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.6))]" /> : <Volume2 strokeWidth={STROKE_NAV} className="h-7 w-7 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.6))]" />}
          </RailButton>
        </div>
      </div>
    </div>
  )
}

function RailButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <IconButton
      size="sm"
      aria-label={label}
      title={label}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      // `relative` is REQUIRED with tap-44: its absolute ::before hit-area anchors to the
      // nearest positioned ancestor — without it the hit-area anchored to the rail container, all
      // four buttons' hit-areas stacked over each other, and every tap landed on the last one
      // (Mute). IconButton BAKES `relative` (and tap-44), so that fix survives this swap — do not
      // pass a positioning class here that would override it.
      className="flex-col gap-1 transition-transform hover:scale-110 active:scale-[0.96]"
    >
      {children}
    </IconButton>
  )
}
