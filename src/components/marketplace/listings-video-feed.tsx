'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Heart, MessageCircle, Share2, Volume2, VolumeX, Play, Film, X, ChevronUp, ChevronDown } from 'lucide-react'
import type { SerializedListingCard } from '@/lib/types'
import { useLanguage, useTr } from '@/context/language-context'
import { useFavorites } from '@/context/favorites-context'
import { useAuth } from '@/context/auth-context'
import { useLocalized } from './listing-content'
import { Price } from './price'
import { Spinner } from '@/components/ui/spinner'
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
}: {
  baseParams: string
  onOpen: (l: SerializedListingCard) => void
  onPrefetch?: (id: string) => void
  onClose: () => void
}) {
  const { tr } = useLanguage()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeIdx, setActiveIdx] = useState(0)
  // Muted by default (browsers block unmuted autoplay); a session toggle the user controls.
  const [muted, setMuted] = useState(true)

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

  // Lock the page behind the takeover; Escape closes it.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [onClose])

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

  // Desktop up/down arrows → snap to the neighbouring clip.
  const go = (dir: -1 | 1) => {
    const els = scrollRef.current?.querySelectorAll<HTMLElement>('[data-idx]')
    els?.[activeIdx + dir]?.scrollIntoView({ behavior: 'smooth' })
  }

  const shell = (children: React.ReactNode) =>
    createPortal(
      <div className="fixed inset-0 z-[60] bg-black">
        <button
          type="button"
          onClick={onClose}
          aria-label={tr('Close', 'Đóng')}
          className="fixed left-4 top-4 z-[70] flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition-transform hover:scale-105 active:scale-90 cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>
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
        <Film className="h-10 w-10 text-white/50" />
        <p className="text-sm font-semibold">{tr('No videos here yet', 'Chưa có video nào')}</p>
        <p className="max-w-xs text-xs text-white/60">
          {tr('Listings with a short clip stand out — add one to yours.', 'Tin có video ngắn nổi bật hơn hẳn — hãy thêm video vào tin của bạn.')}
        </p>
        <Link href="/post" className="mt-3 inline-flex items-center rounded-full bg-white px-5 py-2 text-sm font-bold text-black transition-transform active:scale-95">
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
              onOpen={onOpen}
              onPrefetch={onPrefetch}
            />
          ) : (
            <div key={l.id} data-idx={i} className="h-full w-full snap-start snap-always" />
          ),
        )}
      </div>

      {/* Desktop prev/next arrows (far right, like TikTok web). */}
      <div className="fixed right-6 top-1/2 z-[65] hidden -translate-y-1/2 flex-col gap-3 sm:flex">
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={activeIdx === 0}
          aria-label={tr('Previous', 'Trước')}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-30 cursor-pointer"
        >
          <ChevronUp className="h-6 w-6" />
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={activeIdx >= items.length - 1}
          aria-label={tr('Next', 'Sau')}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-30 cursor-pointer"
        >
          <ChevronDown className="h-6 w-6" />
        </button>
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
          <button type="button" onClick={togglePlay} aria-label={tr('Play', 'Phát')} className="absolute inset-0 z-10 flex items-center justify-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-[2px]">
              <Play className="h-8 w-8 fill-current" />
            </span>
          </button>
        )}

        {/* Legibility gradient. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

        {/* Info overlay — bottom-left, minimal. Tapping title / View opens the listing. */}
        <div className="absolute inset-x-0 bottom-0 z-10 p-5 pr-16 text-white sm:pr-6">
          <button type="button" onClick={() => onOpen(listing)} onMouseEnter={() => onPrefetch?.(listing.id)} className="block max-w-md text-left">
            <h3 className="line-clamp-2 text-base font-semibold leading-snug drop-shadow sm:text-lg">{title}</h3>
          </button>
          <div className="mt-1">
            <Price price={listing.price} currency={listing.currency} priceUnit={listing.priceUnit} compact className="text-xl font-bold text-white drop-shadow" />
          </div>
          {(location || listing.model) && (
            <p className="mt-0.5 truncate text-sm text-white/80 drop-shadow">{[location, listing.model].filter(Boolean).join(' · ')}</p>
          )}
          <button
            type="button"
            onClick={() => onOpen(listing)}
            onMouseEnter={() => onPrefetch?.(listing.id)}
            className="mt-3 inline-flex items-center rounded-full bg-white px-5 py-2 text-sm font-bold text-black transition-transform active:scale-95"
          >
            {tr('View listing', 'Xem tin')}
          </button>
        </div>

        {/* Action rail — overlays the clip's bottom-right on mobile; sits BESIDE the clip (on the
            black) on desktop. */}
        <div className="absolute bottom-6 right-2.5 z-10 flex flex-col items-center gap-5 text-white sm:bottom-10 sm:left-full sm:right-auto sm:ml-5">
          <RailButton label={favorited ? tr('Saved', 'Đã lưu') : tr('Save', 'Lưu')} onClick={() => toggle(listing.id)}>
            <Heart className={cn('h-8 w-8 transition-colors [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.6))]', favorited ? 'fill-brand text-brand' : 'text-white')} />
          </RailButton>
          <RailButton label={tr('Chat with seller', 'Nhắn tin')} onClick={chat}>
            <MessageCircle className="h-8 w-8 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.6))]" />
          </RailButton>
          <RailButton label={tr('Share', 'Chia sẻ')} onClick={share}>
            <Share2 className="h-8 w-8 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.6))]" />
          </RailButton>
          <RailButton label={muted ? tr('Unmute', 'Bật tiếng') : tr('Mute', 'Tắt tiếng')} onClick={onToggleMute}>
            {muted ? <VolumeX className="h-8 w-8 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.6))]" /> : <Volume2 className="h-8 w-8 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.6))]" />}
          </RailButton>
        </div>
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
      // `relative` is REQUIRED with tap-44: its absolute ::before hit-area anchors to the
      // nearest positioned ancestor — without this it anchored to the rail container, all four
      // buttons' hit-areas stacked over each other, and every tap landed on the last one (Mute).
      className="relative flex flex-col items-center gap-1 transition-transform hover:scale-110 active:scale-90 cursor-pointer tap-44"
    >
      {children}
    </button>
  )
}
