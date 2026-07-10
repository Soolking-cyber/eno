'use client'

import { useState, useRef, useEffect } from 'react'
import Image from 'next/image'
import { X, ChevronLeft, ChevronRight, Images, Play, Volume2, VolumeX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tr, useLanguage } from '@/context/language-context'
import { isMockImageUrl } from '@/lib/listing-image'
import { autoplayAllowed } from '@/lib/autoplay'
import { useHlsVideo } from '@/hooks/use-hls-video'

type Props = {
  images: string[]
  title: string
  /** Optional listing video — becomes the FIRST gallery slide (poster = first photo,
   *  autoplays muted once loaded); the buyer swipes past it to the photos. */
  video?: string | null
  showAllLabel?: string
}

/** Autoplay is a cost + accessibility decision, not a given: skip it for reduced-motion
 *  users and metered/slow connections (Save-Data, 2g) — they get the poster + a play button.
 *  (Shared gate: src/lib/autoplay.ts — the card autoplay uses the same heuristics.) */

/** The video slide inside the gallery: the first photo is the poster (instant preview,
 *  optimizer-sized — the raw storage URL is ~20× the bytes and becomes the LCP). Autoplays
 *  muted + loops once it's the visible slide (IntersectionObserver → pauses when swiped
 *  away), EXCEPT under reduced-motion/Save-Data/2g where it waits for a tap. Tap toggles
 *  play/pause (TikTok-conditioned reflex); a mute toggle restores sound. `preload` starts
 *  "none" and flips on first visibility — the mobile carousel and desktop mosaic BOTH mount
 *  (CSS-hidden per breakpoint), and this keeps the hidden twin from fetching anything. */
function GalleryVideo({ src, poster, className }: { src: string; poster?: string; className?: string }) {
  const { tr } = useLanguage()
  const ref = useRef<HTMLVideoElement>(null)
  const [muted, setMuted] = useState(true)
  const [engaged, setEngaged] = useState(false) // visible at least once → allow preload
  const [paused, setPaused] = useState(false)
  const [needsTap, setNeedsTap] = useState(false)
  // Deliberate cover beat: the first photo holds the frame for ≥700ms after the slide
  // becomes visible, THEN the playing video crossfades in — instead of the poster being
  // snatched away the instant the first frame decodes. `revealed` is one-way (pausing
  // later keeps the frozen frame, not the cover).
  const [revealed, setRevealed] = useState(false)
  const [visible, setVisible] = useState(false) // this slide is on-screen (IO)
  const visibleAt = useRef<number | null>(null)
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    const canAuto = autoplayAllowed()
    if (!canAuto) setNeedsTap(true)
    const obs = new IntersectionObserver(
      (entries) => {
        const e = entries[entries.length - 1] // queued entries: only the last reflects reality
        const onScreen = e.isIntersecting && e.intersectionRatio >= 0.5
        setVisible(onScreen)
        if (onScreen) {
          visibleAt.current ??= Date.now()
          // `engaged` gates BUFFERING (source attach) — flip it only for autoplay-eligible
          // viewers; Save-Data/2g/reduced-motion users don't load video bytes until THEY tap.
          // Re-entering view also clears a prior manual pause (auto-resume on swipe-back —
          // matches the pre-Stream behavior where the IO branch force-played the visible slide).
          if (canAuto) { setEngaged(true); setPaused(false) }
        }
      },
      { threshold: [0.5] },
    )
    obs.observe(v)
    return () => { obs.disconnect(); if (revealTimer.current) clearTimeout(revealTimer.current) }
  }, [])
  useEffect(() => { if (ref.current) ref.current.muted = muted }, [muted])
  const onPlaying = () => {
    if (revealed || revealTimer.current) return
    const since = Date.now() - (visibleAt.current ?? Date.now())
    revealTimer.current = setTimeout(() => { revealTimer.current = null; setRevealed(true) }, Math.max(0, 700 - since))
  }
  // Declarative play intent (the hook attaches HLS async, so imperative play() would race the
  // source). Play when engaged (allowed to buffer) AND on-screen AND not user-paused.
  const playing = engaged && visible && !paused
  const togglePlay = () => {
    setNeedsTap(false)
    setEngaged(true) // an explicit tap is consent to buffer, even for gated viewers
    setVisible(true)
    setPaused(playing) // playing now → pause; paused/stopped → play
  }
  // Attach the source only once engaged (preserves the Save-Data buffer gate); hls.js for a
  // Stream .m3u8, plain src for a Supabase MP4, native HLS on Safari.
  useHlsVideo(ref, engaged ? src : null, playing)
  const showPlayGlyph = needsTap || paused
  return (
    <div className={cn('relative h-full w-full overflow-hidden bg-black', className)}>
      <video
        ref={ref}
        // No src / poster attrs: useHlsVideo attaches the source (a Stream clip needs hls.js),
        // and the cover overlay below owns the pre-reveal frame.
        muted
        loop
        playsInline
        onClick={togglePlay}
        onPlaying={onPlaying}
        className="h-full w-full cursor-pointer object-cover"
      />
      {/* Cover overlay — the crisp first photo, fading out when the video reveals. Above the
          video, below the chips/controls; pointer-events-none so taps still hit the video.
          EAGER, not lazy: on a mobile video PDP this overlay IS the visible hero (the LCP) —
          lazy would defer it until after hydration. Not `priority` either: both CSS-hidden
          breakpoint twins mount it, and eager on identical URLs dedupes to one fetch while
          priority would emit competing preloads (same reasoning as the mosaic slides). */}
      {poster && (
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-0 z-[5] transition-opacity duration-500',
            revealed ? 'opacity-0' : 'opacity-100',
          )}
        >
          <Image src={poster} alt="" fill sizes="(max-width:768px) 100vw, 60vw" quality={60} loading="eager" className="object-cover" unoptimized={isMockImageUrl(poster)} />
        </div>
      )}
      {/* z-10: the cover overlay is z-[5] and would otherwise paint over this z-auto chip
          (permanently, for needsTap viewers whose cover never reveals). */}
      <span className="pointer-events-none absolute left-2 top-2 z-10 flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] font-bold text-white backdrop-blur-[2px]">
        <Play className="h-3 w-3 fill-current" /> {tr('Video', 'Video')}
      </span>
      {showPlayGlyph && (
        <button type="button" onClick={togglePlay} aria-label={tr('Play video', 'Phát video')} className="absolute inset-0 z-10 flex items-center justify-center cursor-pointer">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-[2px]">
            <Play className="h-7 w-7 fill-current" />
          </span>
        </button>
      )}
      <button
        type="button"
        aria-label={muted ? tr('Unmute', 'Bật tiếng') : tr('Mute', 'Tắt tiếng')}
        onClick={(e) => { e.stopPropagation(); setMuted((m) => !m) }}
        className="absolute bottom-2 left-2 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-[2px] transition-transform active:scale-90 cursor-pointer tap-44"
      >
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>
    </div>
  )
}

// Lightbox double-tap zoom factor. Transform-only (compositor) — no library.
const ZOOM = 2.5

/** One hero slide that never crops: the full photo (object-contain) over a blurred,
 *  scaled copy of ITSELF so portrait/pano shots fill the frame with their own colors
 *  instead of dead bars, plus a faint repeating eno.vn brand mark in the letterbox
 *  gutters (hidden behind the sharp photo, so only the empty edges are branded — and
 *  when the photo already fits the frame, nothing shows). Only the sharp foreground
 *  carries priority/eager and gates the LCP; the backdrop requests a tiny 64px source
 *  (invisible once blurred) so it's a cheap raster + negligible fetch, never competing
 *  with the hero. */
function BlurFillImage({ img, alt, sizes, mock, priority, eager, hover }: {
  img: string; alt: string; sizes: string; mock?: boolean; priority?: boolean; eager?: boolean; hover?: boolean
}) {
  return (
    <>
      {/* quality MUST be one of next.config `qualities: [60, 70]` — any other value (e.g. the
          old 40) makes the optimizer 400 and the blur backdrop silently vanish in prod. */}
      <Image src={img} alt="" fill sizes="64px" quality={60} unoptimized={mock || undefined} aria-hidden className="scale-110 object-cover blur-2xl" />
      <span aria-hidden className="pointer-events-none absolute inset-0 bg-repeat opacity-70 [background-image:url('/watermark.svg')] [background-size:116px_80px] md:[background-size:248px_171px]" />
      <Image
        src={img}
        alt={alt}
        fill
        sizes={sizes}
        quality={70}
        unoptimized={mock || undefined}
        priority={priority}
        loading={eager && !priority ? 'eager' : undefined}
        className={cn('object-contain', hover && 'transition-transform duration-300 group-hover:scale-[1.02]')}
      />
      <span className="img-watermark" aria-hidden />
    </>
  )
}

/** Photo gallery: full-width swipe carousel on mobile (buyers judge condition
 *  from photos — 45%-wide mosaic tiles were too small on a phone), Airbnb-style
 *  mosaic ≥md, and a full-screen lightbox with swipe nav + double-tap zoom. */
export function ListingGallery({ images, title, video, showAllLabel = 'Show all photos' }: Props) {
  const hasVideo = !!video && images.length > 0
  const mediaCount = images.length + (hasVideo ? 1 : 0)
  const [open, setOpen] = useState(false)
  const [idx, setIdx] = useState(0)
  const [slide, setSlide] = useState(0) // mobile carousel position (for the n/N chip)
  const startX = useRef<number | null>(null)

  // Double-tap zoom state: null = fit; {tx,ty} = zoomed at ZOOM, panned by (tx,ty).
  const [zoom, setZoom] = useState<{ tx: number; ty: number } | null>(null)
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null)
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const frameRef = useRef<HTMLDivElement>(null)

  const last = images.length - 1
  const goTo = (n: number) => setIdx(Math.max(0, Math.min(last, n)))
  const openAt = (n: number) => { setIdx(n); setOpen(true) }

  // Leaving a photo (or the lightbox) always resets the zoom.
  useEffect(() => { setZoom(null) }, [idx, open])

  // While the lightbox is open, freeze the page behind it: lock body scroll + kill overscroll
  // so swipes (up/down/left/right) on the photo never move the background. Restore on close.
  // Escape closes; ←/→ navigate (the touch handlers below cover swipe nav on mobile). A synthetic
  // history entry makes the Android system back button (and browser Back) close the lightbox
  // rather than leaving the listing; the cleanup pops it back if the lightbox was closed some
  // other way (✕/backdrop/Escape), keeping the history stack balanced.
  useEffect(() => {
    if (!open) return
    const body = document.body
    const prevOverflow = body.style.overflow
    const prevOverscroll = body.style.overscrollBehavior
    body.style.overflow = 'hidden'
    body.style.overscrollBehavior = 'none'
    window.history.pushState({ lightbox: true }, '')
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
      else if (e.key === 'ArrowLeft') setIdx((n) => Math.max(0, n - 1))
      else if (e.key === 'ArrowRight') setIdx((n) => Math.min(last, n + 1))
    }
    const onPop = () => setOpen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('popstate', onPop)
    return () => {
      body.style.overflow = prevOverflow
      body.style.overscrollBehavior = prevOverscroll
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('popstate', onPop)
      if (window.history.state?.lightbox) window.history.back()
    }
  }, [open, last])

  if (images.length === 0) {
    return <div className="h-[300px] w-full rounded-2xl bg-tint" />
  }

  // Desktop mosaic: the hero is the video (if any), so the side grid shows the photos NOT in
  // the hero — all photos when the video is the hero, else photos[1..4] as before.
  const rest = (hasVideo ? images : images.slice(1)).slice(0, 4)
  const restGrid =
    rest.length >= 3 ? 'grid-cols-2 grid-rows-2' : rest.length === 2 ? 'grid-rows-2' : 'grid-rows-1'

  // Toggle zoom centered on the tapped/clicked point: with `translate(t) scale(S)`
  // (origin center) a point p from center maps to S·p + t, so keeping the tapped
  // point stationary needs t = p·(1−S). Pan is clamped so the photo edge never
  // crosses the frame center.
  const toggleZoom = (clientX: number, clientY: number) => {
    if (zoom) { setZoom(null); return }
    const rect = frameRef.current?.getBoundingClientRect()
    if (!rect) return
    const px = clientX - (rect.left + rect.width / 2)
    const py = clientY - (rect.top + rect.height / 2)
    setZoom({ tx: px * (1 - ZOOM), ty: py * (1 - ZOOM) })
  }
  const clampPan = (tx: number, ty: number) => {
    const rect = frameRef.current?.getBoundingClientRect()
    const maxX = rect ? ((ZOOM - 1) * rect.width) / 2 : 0
    const maxY = rect ? ((ZOOM - 1) * rect.height) / 2 : 0
    return { tx: Math.max(-maxX, Math.min(maxX, tx)), ty: Math.max(-maxY, Math.min(maxY, ty)) }
  }

  return (
    <>
      {images.length === 1 && !hasVideo ? (
        <button onClick={() => openAt(0)} className="group block w-full overflow-hidden rounded-2xl cursor-pointer">
          <div data-protected className="relative aspect-[4/3] w-full overflow-hidden bg-tint">
            <BlurFillImage img={images[0]} alt={title} sizes="(max-width:1024px) 100vw, 60vw" mock={isMockImageUrl(images[0])} priority hover />
          </div>
        </button>
      ) : (
        <>
          {/* MOBILE: full-width swipeable carousel — each photo gets the whole
              390px, with an n/N counter so buyers know more angles exist
              (truncated galleries hide the condition shots). Scroll-snap only,
              no JS animation; tap opens the lightbox at that photo. */}
          <div data-protected className="relative md:hidden">
            <div
              className="scrollbar-none flex snap-x snap-mandatory overflow-x-auto rounded-2xl"
              onScroll={(e) => {
                const el = e.currentTarget
                setSlide(Math.round(el.scrollLeft / el.clientWidth))
              }}
            >
              {/* Video is slide 0 — poster = the first photo, autoplays once it's on-screen. */}
              {hasVideo && (
                <div className="relative aspect-[4/3] w-full shrink-0 snap-center overflow-hidden rounded-2xl">
                  <GalleryVideo src={video!} poster={images[0]} />
                </div>
              )}
              {images.map((img, i) => (
                <button key={i} onClick={() => openAt(i)} className="relative aspect-[4/3] w-full shrink-0 snap-center overflow-hidden bg-tint cursor-pointer">
                  <BlurFillImage img={img} alt={`${title} — photo ${i + 1}`} sizes="100vw" mock={isMockImageUrl(img)} priority={i === 0 && !hasVideo} />
                </button>
              ))}
            </div>
            {/* black/60 not /50: white text on the translucent chip must hold 4.5:1
                even over a white photo (axe computes ~5.7:1 at 60%). */}
            <span className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white">
              {slide + 1} / {mediaCount}
            </span>
          </div>

          {/* ≥md: Airbnb-style mosaic (1 big + grid) — unchanged. */}
          <div data-protected className="relative hidden h-[300px] grid-cols-2 gap-2 overflow-hidden rounded-2xl sm:h-[440px] md:grid">
            {/* eager, NOT priority: both breakpoints mount (CSS-hidden), so priority
                here preloaded a second copy of the hero on phones, competing with the
                mobile carousel's real LCP image. A visible eager image still fetches
                at high priority on desktop. */}
            {/* Hero = the video (autoplaying) when present, else the first photo. */}
            {hasVideo ? (
              <GalleryVideo src={video!} poster={images[0]} className="rounded-none" />
            ) : (
              <button onClick={() => openAt(0)} className="group relative h-full w-full overflow-hidden cursor-pointer">
                <BlurFillImage img={images[0]} alt={title} sizes="(max-width:1024px) 50vw, 40vw" mock={isMockImageUrl(images[0])} eager hover />
              </button>
            )}
            <div className={cn('grid gap-2', restGrid)}>
              {rest.map((img, i) => {
                const imgIdx = hasVideo ? i : i + 1 // rest excludes the hero photo when there's no video
                return (
                  <button key={i} onClick={() => openAt(imgIdx)} className="group relative h-full w-full overflow-hidden cursor-pointer">
                    <Image src={img} alt={`${title} — photo ${imgIdx + 1}`} fill sizes="25vw" quality={70} unoptimized={isMockImageUrl(img) || undefined} className="object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                    <span className="img-watermark" aria-hidden />
                  </button>
                )
              })}
            </div>
            <button
              onClick={() => openAt(0)}
              className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white cursor-pointer [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.5))]"
            >
              <Images className="h-4 w-4" /> <Tr text={showAllLabel} /> · {images.length}
            </button>
          </div>
        </>
      )}

      {/* Lightbox */}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="fixed inset-0 z-[100] flex touch-none items-center justify-center overscroll-none bg-black/92 animate-in fade-in duration-150"
          onClick={() => setOpen(false)}
        >
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center text-white cursor-pointer [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.5))] tap-44"
          >
            <X className="h-5 w-5" />
          </button>

          <div
            ref={frameRef}
            data-protected
            className="relative h-[78vh] w-[92vw] max-w-5xl touch-none overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => toggleZoom(e.clientX, e.clientY)}
            onTouchStart={(e) => {
              const t = e.touches[0]
              startX.current = t.clientX
              if (zoom) panStart.current = { x: t.clientX, y: t.clientY, tx: zoom.tx, ty: zoom.ty }
            }}
            onTouchMove={(e) => {
              // Zoomed: single-finger drag pans the photo (transform-only).
              if (!zoom || !panStart.current) return
              const t = e.touches[0]
              setZoom(clampPan(panStart.current.tx + (t.clientX - panStart.current.x), panStart.current.ty + (t.clientY - panStart.current.y)))
            }}
            onTouchEnd={(e) => {
              const t = e.changedTouches[0]
              // Double-tap (two taps <300ms, <30px apart) toggles zoom.
              const prev = lastTap.current
              const now = Date.now()
              const moved = startX.current != null && Math.abs(t.clientX - startX.current) > 10
              if (!moved && prev && now - prev.t < 300 && Math.hypot(t.clientX - prev.x, t.clientY - prev.y) < 30) {
                lastTap.current = null
                toggleZoom(t.clientX, t.clientY)
                startX.current = null
                panStart.current = null
                return
              }
              lastTap.current = moved ? null : { t: now, x: t.clientX, y: t.clientY }
              // Swipe navigation — only while fit-to-screen (zoomed swipes pan instead).
              if (!zoom && startX.current != null) {
                const dx = t.clientX - startX.current
                if (Math.abs(dx) > 40) goTo(idx + (dx < 0 ? 1 : -1))
              }
              startX.current = null
              panStart.current = null
            }}
          >
            <div
              className={cn('relative h-full w-full transition-transform duration-200 motion-reduce:transition-none', zoom && 'cursor-grab')}
              style={zoom ? { transform: `translate(${zoom.tx}px, ${zoom.ty}px) scale(${ZOOM})` } : undefined}
            >
              <Image src={images[idx]} alt={`${title} — photo ${idx + 1} of ${images.length}`} fill sizes="92vw" quality={70} unoptimized={isMockImageUrl(images[idx]) || undefined} className="object-contain" />
              {/* Max-quality detail layer: on an explicit zoom (double-tap/-click) load the
                  ≤1600px stored master via `unoptimized` (the raw stored WebP, higher-res than
                  the ≤1080 fit variant that CSS-scale(2.5) would just upscale into blur). It
                  overlays the optimized image (which stays underneath, so there's never a blank
                  frame while the sharper bytes arrive). Only fetched when the buyer actually
                  zooms — the fit view stays lean. onError hides it so a failed fetch can't paint
                  a broken glyph over the good base. */}
              {zoom && (
                <Image
                  src={images[idx]}
                  alt=""
                  fill
                  unoptimized
                  aria-hidden
                  className="object-contain"
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                />
              )}
              <span className="img-watermark" aria-hidden />
            </div>
          </div>

          {idx > 0 && !zoom && (
            <button
              onClick={(e) => { e.stopPropagation(); goTo(idx - 1) }}
              aria-label="Previous"
              className="absolute left-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-white cursor-pointer [filter:drop-shadow(0_1px_3px_rgba(0,0,0,0.55))]"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}
          {idx < last && !zoom && (
            <button
              onClick={(e) => { e.stopPropagation(); goTo(idx + 1) }}
              aria-label="Next"
              className="absolute right-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-white cursor-pointer [filter:drop-shadow(0_1px_3px_rgba(0,0,0,0.55))]"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          )}

          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-white">
            {idx + 1} / {images.length}
          </div>
        </div>
      )}
    </>
  )
}
