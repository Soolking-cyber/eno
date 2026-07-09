'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Heart, MessageCircle, Share2, Volume2, VolumeX, Play, Film } from 'lucide-react'
import type { SerializedListingCard } from '@/lib/types'
import { useLanguage, useTr } from '@/context/language-context'
import { useFavorites } from '@/context/favorites-context'
import { useAuth } from '@/context/auth-context'
import { useLocalized } from './listing-content'
import { Price } from './price'
import { Spinner } from '@/components/ui/spinner'
import { stashQuickCompose } from '@/lib/quick-contact'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// TikTok-style vertical feed of listings that carry a video, for the CURRENT search/filters.
// One clip per screen; the in-view clip autoplays (muted, looping), the rest pause. It fetches
// its own video-only subset (hasVideo=1) rather than filtering the grid's paginated set.
export function VideoFeed({
  baseParams,
  onOpen,
  onPrefetch,
}: {
  baseParams: string
  onOpen: (l: SerializedListingCard) => void
  onPrefetch?: (id: string) => void
}) {
  const { tr } = useLanguage()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeIdx, setActiveIdx] = useState(0)
  // Muted-by-default (browsers block unmuted autoplay); a per-session toggle the user controls.
  const [muted, setMuted] = useState(true)

  // Size each screen to the ACTUAL space below the page chrome (header/rails/sort strip) and
  // above the mobile bottom-nav, so the bottom info overlay is always on-screen — a fixed
  // 100dvh item would push the overlay under the fold. The feed captures its own scroll
  // (overscroll-contain), so its top stays put; re-measure only on resize + after chrome loads.
  const [feedH, setFeedH] = useState<number>()
  useEffect(() => {
    const measure = () => {
      const el = scrollRef.current
      if (!el) return
      // Clamp a negative top (feed scrolled above the viewport) to 0 so we never over-size.
      const top = Math.max(0, el.getBoundingClientRect().top)
      const bottomInset = window.matchMedia('(min-width: 640px)').matches ? 16 : 76 // desktop pad vs mobile nav
      setFeedH(Math.max(360, window.innerHeight - top - bottomInset))
    }
    const raf = requestAnimationFrame(measure)
    const t = setTimeout(measure, 300) // catch late-mounting rails/facet bar
    window.addEventListener('resize', measure)
    return () => { cancelAnimationFrame(raf); clearTimeout(t); window.removeEventListener('resize', measure) }
  }, [])

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

  // Track the most-visible item → it becomes active (plays); the rest pause. Re-observe when
  // the item count changes (data arrives).
  useEffect(() => {
    const root = scrollRef.current
    if (!root || items.length === 0) return
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio >= 0.6) {
            setActiveIdx(Number((e.target as HTMLElement).dataset.idx))
          }
        }
      },
      { root, threshold: [0.6] },
    )
    root.querySelectorAll('[data-idx]').forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [items.length])

  if (isLoading) {
    return (
      <div className="flex h-[60dvh] items-center justify-center">
        <Spinner size="md" className="border-border border-t-brand" />
      </div>
    )
  }
  if (isError || items.length === 0) {
    return (
      <div className="flex h-[50dvh] flex-col items-center justify-center gap-2 text-center">
        <Film className="h-10 w-10 text-ink-4" />
        <p className="text-sm font-semibold text-foreground">{tr('No videos here yet', 'Chưa có video nào')}</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          {tr('No listings in this search have a video yet. Try another category or filter.', 'Chưa có tin nào trong tìm kiếm này có video. Thử danh mục hoặc bộ lọc khác.')}
        </p>
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      style={feedH ? { height: feedH } : undefined}
      className="scroll-thin -mx-3 h-[70dvh] snap-y snap-mandatory overflow-y-auto overscroll-contain bg-black sm:mx-0 sm:rounded-2xl"
    >
      {items.map((l, i) => (
        <VideoFeedItem
          key={l.id}
          listing={l}
          index={i}
          active={i === activeIdx}
          muted={muted}
          onToggleMute={() => setMuted((m) => !m)}
          onOpen={onOpen}
          onPrefetch={onPrefetch}
        />
      ))}
    </div>
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
  const { tr, lang } = useLanguage()
  const router = useRouter()
  const { user, loading: authLoading, openSignIn } = useAuth()
  const { isFavorite, toggle } = useFavorites()
  const favorited = isFavorite(listing.id)
  const title = useLocalized(listing.title, listing.titleVi, listing.titleI18n)
  const location = useTr(listing.location)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [paused, setPaused] = useState(false)

  // Play only while this item is the active (in-view) one; pause + rewind the rest so scrolling
  // back replays from the top and only one clip ever streams at a time.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (active) {
      setPaused(false)
      v.play().catch(() => {})
    } else {
      v.pause()
      try { v.currentTime = 0 } catch { /* not seekable yet */ }
    }
  }, [active])

  // Muted state is set imperatively — React's `muted` prop doesn't reliably reflect to the DOM.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted
  }, [muted, active])

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) { v.play().catch(() => {}); setPaused(false) }
    else { v.pause(); setPaused(true) }
  }

  // Quick chat — same stash-and-hand-off as the card (guests get the sign-in dialog first).
  const chat = () => {
    if (!user) { if (!authLoading) openSignIn({ listingTitle: title, listingImage: listing.images[0] ?? null }); return }
    if (stashQuickCompose(listing, { body: tr('Hi! Is this still available?', 'Chào bạn! Món này còn không?') })) router.push('/messages/pending')
    else router.push(`/listings/${listing.id}#contact`)
  }
  const share = useCallback(async () => {
    const url = `${window.location.origin}/listings/${listing.id}`
    try {
      if (navigator.share) await navigator.share({ title, url })
      else { await navigator.clipboard.writeText(url); toast.success(tr('Link copied', 'Đã sao chép liên kết')) }
    } catch { /* user dismissed the share sheet */ }
  }, [listing.id, title, tr])

  return (
    <div data-idx={index} className="relative flex h-full w-full snap-start snap-always items-center justify-center overflow-hidden">
      {listing.video && (
        <video
          ref={videoRef}
          src={listing.video}
          poster={listing.images[0]}
          loop
          playsInline
          muted
          preload={active ? 'auto' : 'none'}
          onClick={togglePlay}
          // Fill the vertical frame, cropping to fit (a true portrait clip fills with no loss;
          // a wider clip crops its edges, keeping the centre) instead of letterboxing with bars.
          className="h-full w-full object-cover"
        />
      )}

      {/* Paused affordance — a big play glyph when the user taps to pause. */}
      {paused && (
        <button type="button" onClick={togglePlay} aria-label={tr('Play', 'Phát')} className="absolute inset-0 z-10 flex items-center justify-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-[2px]">
            <Play className="h-8 w-8 fill-current" />
          </span>
        </button>
      )}

      {/* Bottom gradient for text legibility over any clip. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />

      {/* Info overlay (bottom-left). Tapping title / "View" opens the listing. */}
      <div className="absolute inset-x-0 bottom-0 z-10 p-4 pr-16 text-white">
        <button type="button" onClick={() => onOpen(listing)} onMouseEnter={() => onPrefetch?.(listing.id)} className="block text-left">
          <h3 className="line-clamp-2 text-base font-semibold leading-snug drop-shadow">{title}</h3>
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Price price={listing.price} currency={listing.currency} priceUnit={listing.priceUnit} compact className="text-lg font-bold text-white drop-shadow" />
          {listing.goodPrice && (
            <span className="rounded-full bg-success px-2 py-0.5 text-[11px] font-bold text-white">{tr('Good price', 'Giá tốt')}</span>
          )}
        </div>
        {(location || listing.brandSlug || listing.model) && (
          <p className="mt-0.5 truncate text-sm text-white/80 drop-shadow">
            {[location, listing.model].filter(Boolean).join(' · ')}
          </p>
        )}
        <button
          type="button"
          onClick={() => onOpen(listing)}
          onMouseEnter={() => onPrefetch?.(listing.id)}
          className="mt-2.5 inline-flex items-center rounded-full bg-white px-4 py-1.5 text-sm font-bold text-black transition-transform active:scale-95"
        >
          {tr('View listing', 'Xem tin')}
        </button>
      </div>

      {/* Right action rail (TikTok-style). */}
      <div className="absolute bottom-6 right-2.5 z-10 flex flex-col items-center gap-4 text-white">
        <RailButton
          label={favorited ? tr('Remove favorite', 'Bỏ lưu') : tr('Save', 'Lưu')}
          onClick={() => toggle(listing.id)}
        >
          <Heart className={cn('h-7 w-7 transition-colors [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.6))]', favorited ? 'fill-brand text-brand' : 'text-white')} />
        </RailButton>
        <RailButton label={tr('Chat with seller', 'Nhắn tin')} onClick={chat}>
          <MessageCircle className="h-7 w-7 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.6))]" />
        </RailButton>
        <RailButton label={tr('Share', 'Chia sẻ')} onClick={share}>
          <Share2 className="h-7 w-7 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.6))]" />
        </RailButton>
        <RailButton label={muted ? tr('Unmute', 'Bật tiếng') : tr('Mute', 'Tắt tiếng')} onClick={onToggleMute}>
          {muted ? <VolumeX className="h-7 w-7 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.6))]" /> : <Volume2 className="h-7 w-7 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.6))]" />}
        </RailButton>
      </div>
    </div>
  )
}

function RailButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className="flex h-11 w-11 items-center justify-center transition-transform hover:scale-110 active:scale-90 cursor-pointer tap-44"
    >
      {children}
    </button>
  )
}
