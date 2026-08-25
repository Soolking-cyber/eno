'use client'

import { useState, useRef, useEffect } from 'react'
import Image from 'next/image'
import { X, ChevronLeft, ChevronRight, Images, Play, Volume2, VolumeX } from '@/components/ui/icons'
import { STROKE_FLOAT } from '@/lib/icon-tokens'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel'
import { IconButton } from '@/components/ui/icon-button'
import { Tr, useLanguage } from '@/context/language-context'
import { pushBlackStatusBar } from '@/components/native/native-bootstrap'
import { isMockImageUrl } from '@/lib/listing-image'
import { autoplayAllowed } from '@/lib/autoplay'

type Props = {
  /** 'mobile'/'desktop' render just that branch (dual-mount pages); 'auto' = both, CSS-split. */
  variant?: 'auto' | 'mobile' | 'desktop'

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
        if (e.isIntersecting && e.intersectionRatio >= 0.5) {
          visibleAt.current ??= Date.now()
          // preload flips only for autoplay-eligible viewers — Save-Data/2g/reduced-motion
          // users must not buffer video bytes until THEY tap play (togglePlay sets engaged).
          if (canAuto) { setEngaged(true); v.play().catch(() => {}); setPaused(false) }
        } else {
          v.pause()
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
  const togglePlay = () => {
    const v = ref.current
    if (!v) return
    setNeedsTap(false)
    setEngaged(true) // an explicit tap is consent to buffer, even for gated viewers
    if (v.paused) { v.play().catch(() => {}); setPaused(false) }
    else { v.pause(); setPaused(true) }
  }
  const showPlayGlyph = needsTap || paused
  return (
    <div className={cn('relative h-full w-full overflow-hidden bg-black', className)}>
      <video
        ref={ref}
        src={src}
        // No poster attr: the cover overlay below owns the pre-reveal frame — a poster
        // would be a second fetch of the same photo at a different optimizer URL.
        muted
        loop
        playsInline
        preload={engaged ? 'auto' : 'none'}
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
      <span className="pointer-events-none absolute left-2 top-2 z-10 flex items-center gap-1 rounded-lg bg-black/55 px-1.5 py-0.5 text-2xs font-bold text-white backdrop-blur-[2px]">
        <Play className="h-3 w-3 fill-current" /> {tr('Video', 'Video')}
      </span>
      {showPlayGlyph && (
        <Button
          variant="bare"
          size="none"
          type="button"
          onClick={togglePlay}
          aria-label={tr('Play video', 'Phát video')}
          className="absolute inset-0 z-10 flex items-center justify-center cursor-pointer active:scale-100"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-[2px]">
            <Play className="h-7 w-7 fill-current" />
          </span>
        </Button>
      )}
      <IconButton
        size="sm"
        aria-label={muted ? tr('Unmute', 'Bật tiếng') : tr('Mute', 'Tắt tiếng')}
        onClick={(e) => { e.stopPropagation(); setMuted((m) => !m) }}
        className="absolute bottom-2 left-2 z-20 bg-black/50 text-white backdrop-blur-[2px] transition-transform active:scale-[0.96]"
      >
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </IconButton>
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
/**
 * ⚠️ THE PHOTO DOES NOT SCALE ON HOVER, AND THERE IS NO `hover` PROP ANY MORE.
 * This carried `hover && 'transition-transform duration-300 group-hover:scale-[1.02]'` on the <Image>
 * below. It is the same treatment deleted from <ListingCard> on 2026-08-05 (the reason is written out
 * on that file's <Image>): scaling product imagery on hover is a recognisable generated-UI signature,
 * and on a marketplace where the buyer is judging condition from the photograph it works against the
 * one job the picture has. That decision was made for the feed and never reached the PDP, so the same
 * JPEG behaved differently in two frames of the same flow. The prop went with the class rather than
 * being left behind as a dead API.
 */
function BlurFillImage({ img, alt, sizes, mock, priority, eager }: {
  img: string; alt: string; sizes: string; mock?: boolean; priority?: boolean; eager?: boolean
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
        className="object-contain"
      />
      <span className="img-watermark" aria-hidden />
    </>
  )
}

/** Photo gallery: full-width swipe carousel on mobile (buyers judge condition
 *  from photos — 45%-wide mosaic tiles were too small on a phone), Airbnb-style
 *  mosaic ≥md, and a full-screen lightbox with swipe nav + double-tap zoom. */
export function ListingGallery({ images, title, video, showAllLabel = 'Show all photos', variant = 'auto' }: Props) {
  // The lightbox chrome (Close/Previous/Next) and the video thumb are icon-only, so their
  // aria-label IS their whole accessible name — it has to follow the viewer's language.
  // eslint's i18n rule is configured with ignoreProps:true / noAttributeStrings:false and
  // sees none of it, which is how these four sat in English for every locale.
  const { tr } = useLanguage()
  const hasVideo = !!video && images.length > 0
  const mediaCount = images.length + (hasVideo ? 1 : 0)
  const [open, setOpen] = useState(false)
  const [idx, setIdx] = useState(0)
  const [slide, setSlide] = useState(0) // mobile carousel position (for the n/N chip)
  const [sel, setSel] = useState(0) // desktop viewport selection (video = slot 0 when present)
  const startX = useRef<number | null>(null)

  // Double-tap zoom state: null = fit; {tx,ty} = zoomed at ZOOM, panned by (tx,ty).
  const [zoom, setZoom] = useState<{ tx: number; ty: number } | null>(null)
  /**
   * ⛔ A DIRECTLY MANIPULATED ELEMENT MUST NOT CARRY A TRANSITION. The zoomed photo had
   * `transition-transform duration-200` permanently, while `onTouchMove` rewrote its transform on
   * every frame — so the browser restarted a 200ms ease on each one and the picture trailed the
   * finger by a fifth of a second. Apple's rule is that touch and content move together; a
   * transition on the thing you are holding is the most direct way to break that.
   * The transition still runs for the zoom TOGGLE, which is a state change and should animate.
   */
  const [panning, setPanning] = useState(false)
  /** Timestamp of touchstart, so a flick can be told from a slow drag. */
  const startT = useRef<number>(0)
  /** Start Y, so a flick can be told from a vertical gesture that happens to drift sideways. */
  const startY = useRef<number | null>(null)
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
    // Native status bar → light glyphs while this near-black overlay is up (a no-op on web).
    // Released in the cleanup below, which React runs on EVERY exit — ✕, backdrop, Escape, the
    // Android hardware back button, the iOS edge-swipe — so the bar can never be left with dark
    // glyphs sitting invisibly on black.
    const releaseStatusBar = pushBlackStatusBar()
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
      releaseStatusBar()
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('popstate', onPop)
      if (window.history.state?.lightbox) window.history.back()
    }
  }, [open, last])

  if (images.length === 0) {
    // Radius tracks the real gallery (square on mobile) so the empty state doesn't flash a
    // different shape than what replaces it.
    return <div className="h-[300px] w-full rounded-none md:rounded-2xl bg-tint" />
  }


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
        <Button
          variant="bare"
          size="none"
          onClick={() => openAt(0)}
          // Corners: SQUARE on mobile (owner 2026-07-24, screenshot of the mobile PDP: "no
          // corner roundings, make it straight square"), rounded from md up where the media
          // sits inside a card. This single-photo branch renders on BOTH breakpoints, so the
          // radius has to be the responsive pair, not a removal.
          className="group block w-full overflow-hidden rounded-none md:rounded-2xl cursor-pointer active:scale-100"
        >
          {/* SQUARE on every breakpoint (owner 2026-07-23: desktop first, then "in mobile
              web ios and android … square viewport for images and videos"). This file is
              also the Capacitor WebView the native apps load, so mobile-web square IS the
              iOS/Android square. */}
          <div data-protected className="relative aspect-square w-full overflow-hidden bg-tint">
            <BlurFillImage img={images[0]} alt={title} sizes="(max-width:1024px) 100vw, 60vw" mock={isMockImageUrl(images[0])} priority />
          </div>
        </Button>
      ) : (
        <>
          {variant !== 'desktop' && (<>
          {/* MOBILE: full-width swipeable carousel — each slide is a SQUARE viewport
              (owner 2026-07-23: "square viewport for images and videos" on mobile web =
              the iOS/Android Capacitor apps). n/N counter so buyers know more angles
              exist. Scroll-snap only, no JS animation; tap opens the lightbox at that photo. */}
          <div data-protected className="relative md:hidden">
            <div
              // Square corners (owner 2026-07-24). The radius lived on the SCROLLER, so it
              // clipped the whole strip rather than each slide — dropping it here is what
              // actually squares the mobile viewport.
              className="scrollbar-none flex snap-x snap-mandatory overflow-x-auto"
              onScroll={(e) => {
                const el = e.currentTarget
                setSlide(Math.round(el.scrollLeft / el.clientWidth))
              }}
            >
              {/* Video is slide 0 — poster = the first photo, autoplays once it's on-screen. */}
              {hasVideo && (
                <div className="relative aspect-square w-full shrink-0 snap-center overflow-hidden rounded-none">
                  <GalleryVideo src={video!} poster={images[0]} />
                </div>
              )}
              {images.map((img, i) => (
                <Button key={i} variant="bare" size="none" onClick={() => openAt(i)} className="relative block aspect-square w-full shrink-0 snap-center overflow-hidden rounded-none bg-tint cursor-pointer active:scale-100">
                  <BlurFillImage img={img} alt={`${title} — photo ${i + 1}`} sizes="100vw" mock={isMockImageUrl(img)} priority={i === 0 && !hasVideo} />
                </Button>
              ))}
            </div>
            {/* black/60 not /50: white text on the translucent chip must hold 4.5:1
                even over a white photo (axe computes ~5.7:1 at 60%). */}
            <span className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-2xs font-semibold text-white">
              {slide + 1} / {mediaCount}
            </span>
          </div>
          </>)}

          {variant !== 'mobile' && (<>
          {/* ≥md: Shopee-style — ONE large viewport + a synced thumbnail rail with
              paging arrows (user decision 2026-07-14; replaces the Airbnb mosaic).
              `sel` walks the media entries (video first when present); clicking a
              photo opens the lightbox at that photo. eager (NOT priority): both
              breakpoints mount CSS-hidden, priority would double-fetch on phones. */}
          {/* SQUARE viewport at FULL column width (owner 2026-07-23, second pass:
              "make sure image uses full available width" — overrides the 560px cap from
              the same morning; the tall square is the owner's accepted trade). Full width
              also re-seats the page's Share/Save overlay (absolute right-3 top-3 on the
              WRAPPER) onto the image's own corner — the centered cap left them floating
              beside the hero. */}
          <div data-protected className="hidden w-full md:block">
            <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-tint">
              {hasVideo && sel === 0 ? (
                <GalleryVideo src={video!} poster={images[0]} className="rounded-none" />
              ) : (
                (() => {
                  const photoIdx = hasVideo ? sel - 1 : sel
                  return (
                    <Button variant="bare" size="none" onClick={() => openAt(photoIdx)} className="group relative block h-full w-full overflow-hidden rounded-none cursor-pointer active:scale-100">
                      <BlurFillImage img={images[photoIdx]} alt={`${title} — photo ${photoIdx + 1}`} sizes="(max-width:1024px) 100vw, 60vw" mock={isMockImageUrl(images[photoIdx])} eager={photoIdx === 0} />
                    </Button>
                  )
                })()
              )}
              <Button
                variant="bare"
                size="none"
                onClick={() => openAt(hasVideo ? Math.max(0, sel - 1) : sel)}
                className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white cursor-pointer active:scale-100 icon-shadow-brand"
              >
                <Images className="h-4 w-4" /> <Tr text={showAllLabel} /> · {images.length}
              </Button>
            </div>

            {/* Thumbnail rail — embla carousel pages the strip when it overflows;
                the selected thumb carries the brand border. */}
            <Carousel opts={{ align: 'start', dragFree: true }} className="relative mt-2 px-0.5">
              <CarouselContent className="-ml-2">
                {hasVideo && (
                  <CarouselItem className="basis-auto pl-2">
                    <Button
                      variant="bare"
                      size="none"
                      onClick={() => setSel(0)}
                      aria-label={tr('Video', 'Video')}
                      className={cn('relative h-20 w-20 overflow-hidden rounded-lg border-2 transition-colors cursor-pointer active:scale-100', sel === 0 ? 'border-brand' : 'border-transparent hover:border-line-strong')}
                    >
                      <Image src={images[0]} alt="" fill sizes="80px" quality={60} unoptimized={isMockImageUrl(images[0]) || undefined} className="object-cover" />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/25">
                        <Play className="h-6 w-6 fill-white text-white" />
                      </span>
                    </Button>
                  </CarouselItem>
                )}
                {images.map((img, i) => {
                  const s2 = hasVideo ? i + 1 : i
                  return (
                    <CarouselItem key={i} className="basis-auto pl-2">
                      <Button
                        variant="bare"
                        size="none"
                        onClick={() => setSel(s2)}
                        aria-label={`${title} — photo ${i + 1}`}
                        className={cn('relative h-20 w-20 overflow-hidden rounded-lg border-2 transition-colors cursor-pointer active:scale-100', sel === s2 ? 'border-brand' : 'border-transparent hover:border-line-strong')}
                      >
                        <Image src={img} alt="" fill sizes="80px" quality={60} unoptimized={isMockImageUrl(img) || undefined} className="object-cover" />
                      </Button>
                    </CarouselItem>
                  )
                })}
              </CarouselContent>
              {mediaCount > 6 && (
                <>
                  <CarouselPrevious className="-left-2 h-8 w-8" />
                  <CarouselNext className="-right-2 h-8 w-8" />
                </>
              )}
            </Carousel>
          </div>
          </>)}
        </>
      )}

      {/* Lightbox */}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="fixed inset-0 z-[100] flex touch-none items-center justify-center overscroll-none bg-black/92 animate-in fade-in duration-150 ease-out"
          onClick={() => setOpen(false)}
        >
          <IconButton
            size="lg"
            variant="overlay"
            onClick={() => setOpen(false)}
            aria-label={tr('Close', 'Đóng')}
            // Safe-area term: the lightbox is a fullscreen overlay and the native WebView is
            // edge-to-edge, so a bare top-4 puts Close under the Dynamic Island. 0 on web.
            className="absolute right-4 top-[calc(env(safe-area-inset-top)+1rem)] icon-shadow-brand"
          >
            <X className="h-5 w-5" />
          </IconButton>

          <div
            ref={frameRef}
            data-protected
            className="relative h-[78vh] w-[92vw] max-w-5xl touch-none overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => toggleZoom(e.clientX, e.clientY)}
            onTouchStart={(e) => {
              const t = e.touches[0]
              startX.current = t.clientX
              startY.current = t.clientY
              startT.current = Date.now()
              if (zoom) { panStart.current = { x: t.clientX, y: t.clientY, tx: zoom.tx, ty: zoom.ty }; setPanning(true) }
            }}
            onTouchMove={(e) => {
              // Zoomed: single-finger drag pans the photo (transform-only).
              if (!zoom || !panStart.current) return
              const t = e.touches[0]
              setZoom(clampPan(panStart.current.tx + (t.clientX - panStart.current.x), panStart.current.ty + (t.clientY - panStart.current.y)))
            }}
            /**
             * ⛔ `touchcancel` MUST RESET THE GESTURE, and only `touchend` did. The OS takes a touch
             * away routinely — an incoming call, an edge swipe, the scroller claiming the gesture —
             * and when it did, `panning` stayed true forever: the zoom transition was permanently
             * disabled for the rest of the session and `panStart` held a stale origin, so the next
             * pan jumped. Both reviewers found it; the fix is the same handler.
             */
            onTouchCancel={() => {
              startX.current = null
              startY.current = null
              panStart.current = null
              setPanning(false)
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
                /**
                 * ⚠️ DISTANCE **OR** VELOCITY. Judging on distance alone made a fast flick behave
                 * exactly like a slow 41px drag: both had to cross 40px or nothing happened, so a
                 * quick decisive gesture — the one people actually make on a photo — did nothing.
                 * Apple's rule is that motion inherits the velocity of the gesture that caused it.
                 * 0.4 px/ms is a deliberate flick and nothing else; a scroll-adjacent graze is
                 * slower than that.
                 */
                const dy = startY.current == null ? 0 : t.clientY - startY.current
                const ms = Math.max(1, Date.now() - startT.current)
                /**
                 * ⚠️ AXIS-LOCKED, AND A REAL FLOOR. Velocity alone let a TAP whose finger rolls a
                 * few pixels in ~30ms page the photo — and on the second tap of a double-tap that
                 * zoomed into the wrong image. A fast vertical gesture with sideways drift did it
                 * too. So a flick must be predominantly horizontal and travel far enough to be a
                 * deliberate swipe rather than a wobble.
                 */
                const flick = Math.abs(dx) > 20 && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) / ms > 0.4
                if (Math.abs(dx) > 40 || flick) goTo(idx + (dx < 0 ? 1 : -1))
              }
              startX.current = null
              startY.current = null
              panStart.current = null
              setPanning(false)
            }}
          >
            <div
              className={cn('relative h-full w-full motion-reduce:transition-none', !panning && 'transition-transform duration-200', zoom && 'cursor-grab')}
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
            <IconButton
              size="lg"
              variant="overlay"
              onClick={(e) => { e.stopPropagation(); goTo(idx - 1) }}
              aria-label={tr('Previous', 'Trước')}
              className="absolute left-4 top-1/2 h-11 w-11 -translate-y-1/2 [filter:drop-shadow(0_1px_3px_rgba(0,0,0,0.55))]"
            >
              {/* Floating-chevron tier (§2): bare chevrons over content, same as back-to-top. */}
              <ChevronLeft className="h-6 w-6" strokeWidth={STROKE_FLOAT} />
            </IconButton>
          )}
          {idx < last && !zoom && (
            <IconButton
              size="lg"
              variant="overlay"
              onClick={(e) => { e.stopPropagation(); goTo(idx + 1) }}
              aria-label={tr('Next', 'Sau')}
              className="absolute right-4 top-1/2 h-11 w-11 -translate-y-1/2 [filter:drop-shadow(0_1px_3px_rgba(0,0,0,0.55))]"
            >
              <ChevronRight className="h-6 w-6" strokeWidth={STROKE_FLOAT} />
            </IconButton>
          )}

          {/* Thumbnail strip — "look through" the whole set without leaving the lightbox (Shopee
              desktop quick-view pattern). Replaces the bare n/N counter: the highlighted thumb IS
              the position. Hidden while zoomed so it never fights the pan gesture; stops click
              propagation so tapping a thumb navigates instead of closing. Scrolls + centers when the
              set overflows. */}
          {images.length > 1 && !zoom && (
            <div
              // Safe-area term mirrors the Close button's top inset above: the lightbox is a
              // fullscreen edge-to-edge overlay on the native WebView, so a bare bottom-4 drops
              // the 48px thumb rail into the ~34px home-indicator band (crowding the pill + fighting
              // the OS home-swipe). Reserve env(safe-area-inset-bottom); 0 on web.
              className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+1rem)] flex justify-center px-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="scrollbar-none flex max-w-full gap-2 overflow-x-auto rounded-2xl bg-black/40 p-2 backdrop-blur-sm">
                {images.map((img, i) => (
                  <Button
                    key={i}
                    variant="bare"
                    size="none"
                    onClick={(e) => { e.stopPropagation(); goTo(i) }}
                    aria-label={`${title} — photo ${i + 1}`}
                    aria-current={i === idx ? 'true' : undefined}
                    className={cn(
                      'relative h-12 w-12 shrink-0 overflow-hidden rounded-lg transition-opacity duration-150 cursor-pointer active:scale-100',
                      i === idx ? 'ring-2 ring-white' : 'opacity-60 hover:opacity-100',
                    )}
                  >
                    <Image src={img} alt="" fill sizes="48px" quality={60} unoptimized={isMockImageUrl(img) || undefined} className="object-cover" />
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
