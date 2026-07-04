'use client'

import { useState, useRef, useEffect } from 'react'
import Image from 'next/image'
import { X, ChevronLeft, ChevronRight, Images } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tr } from '@/context/language-context'

type Props = {
  images: string[]
  title: string
  showAllLabel?: string
}

// Lightbox double-tap zoom factor. Transform-only (compositor) — no library.
const ZOOM = 2.5

/** Photo gallery: full-width swipe carousel on mobile (buyers judge condition
 *  from photos — 45%-wide mosaic tiles were too small on a phone), Airbnb-style
 *  mosaic ≥md, and a full-screen lightbox with swipe nav + double-tap zoom. */
export function ListingGallery({ images, title, showAllLabel = 'Show all photos' }: Props) {
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
  // Escape closes; ←/→ navigate (the touch handlers below cover swipe nav on mobile).
  useEffect(() => {
    if (!open) return
    const body = document.body
    const prevOverflow = body.style.overflow
    const prevOverscroll = body.style.overscrollBehavior
    body.style.overflow = 'hidden'
    body.style.overscrollBehavior = 'none'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
      else if (e.key === 'ArrowLeft') setIdx((n) => Math.max(0, n - 1))
      else if (e.key === 'ArrowRight') setIdx((n) => Math.min(last, n + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => {
      body.style.overflow = prevOverflow
      body.style.overscrollBehavior = prevOverscroll
      window.removeEventListener('keydown', onKey)
    }
  }, [open, last])

  if (images.length === 0) {
    return <div className="h-[300px] w-full rounded-2xl bg-tint" />
  }

  const rest = images.slice(1, 5)
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
      {images.length === 1 ? (
        <button onClick={() => openAt(0)} className="group block w-full overflow-hidden rounded-2xl cursor-pointer">
          <div data-protected className="relative aspect-[16/10] w-full bg-tint">
            <Image src={images[0]} alt={title} fill sizes="(max-width:1024px) 100vw, 60vw" quality={70} className="object-cover transition-transform duration-300 group-hover:scale-[1.02]" priority />
            <span className="img-watermark" aria-hidden />
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
              {images.map((img, i) => (
                <button key={i} onClick={() => openAt(i)} className="relative aspect-[4/3] w-full shrink-0 snap-center overflow-hidden bg-tint cursor-pointer">
                  <Image src={img} alt={`${title} — photo ${i + 1}`} fill sizes="100vw" quality={70} className="object-cover" priority={i === 0} />
                  <span className="img-watermark" aria-hidden />
                </button>
              ))}
            </div>
            {/* black/60 not /50: white text on the translucent chip must hold 4.5:1
                even over a white photo (axe computes ~5.7:1 at 60%). */}
            <span className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white">
              {slide + 1} / {images.length}
            </span>
          </div>

          {/* ≥md: Airbnb-style mosaic (1 big + grid) — unchanged. */}
          <div data-protected className="relative hidden h-[300px] grid-cols-2 gap-2 overflow-hidden rounded-2xl sm:h-[440px] md:grid">
            <button onClick={() => openAt(0)} className="group relative h-full w-full overflow-hidden cursor-pointer">
              <Image src={images[0]} alt={title} fill sizes="(max-width:1024px) 50vw, 40vw" quality={70} className="object-cover transition-transform duration-300 group-hover:scale-[1.02]" priority />
              <span className="img-watermark" aria-hidden />
            </button>
            <div className={cn('grid gap-2', restGrid)}>
              {rest.map((img, i) => (
                <button key={i} onClick={() => openAt(i + 1)} className="group relative h-full w-full overflow-hidden cursor-pointer">
                  <Image src={img} alt={`${title} — photo ${i + 2}`} fill sizes="25vw" quality={70} className="object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                  <span className="img-watermark" aria-hidden />
                </button>
              ))}
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
              <Image src={images[idx]} alt={`${title} — photo ${idx + 1} of ${images.length}`} fill sizes="92vw" quality={70} className="object-contain" />
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
