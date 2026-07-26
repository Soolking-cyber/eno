'use client'

import { useEffect, useRef, useState } from 'react'
import { autoplayAllowed } from '@/lib/autoplay'
import { cn } from '@/lib/utils'

// ── Inline card autoplay ─────────────────────────────────────────────────────────
// A listing's clip plays ON the card (muted, looping) once the card has settled in
// the viewport — the cover photo shows for a brief beat, then the video fades in
// over it. This is what makes video listings visibly alive on MOBILE, where the old
// hover-only trigger never fired. Desktop hover still starts it instantly.
//
// Cost discipline:
//  • Nothing mounts until the card is ≥60% visible AND ≥150px wide (map popups /
//    odd narrow contexts stay video-free) — fast scrolling never even arms it
//    (450ms settle beat before the <video> exists).
//  • A page-wide budget caps concurrent playing clips (decode pipelines + network):
//    at most MAX_CONCURRENT cards play at once; the rest keep their cover until a
//    slot frees and the observer re-fires on the next scroll. Hover bypasses the
//    cap — an explicit pointer is intent.
//  • Scrolled away → the element unmounts entirely (decoder + buffer released);
//    re-entering restarts it from the top out of HTTP cache (clips are immutable,
//    cache-control 1y).
//  • Save-Data / 2g / prefers-reduced-motion viewers never autoplay (hover still
//    works — an explicit gesture outranks the heuristic).

const playing = new Set<string>()
const MAX_CONCURRENT = 2
function acquire(id: string, force = false): boolean {
  if (playing.has(id)) return true
  if (force || playing.size < MAX_CONCURRENT) { playing.add(id); return true }
  return false
}
function release(id: string) { playing.delete(id) }

const SETTLE_MS = 450 // the card must sit in view this long before the video mounts
const COVER_BEAT_MS = 600 // minimum time the cover stays visible before the fade-in

export function CardVideo({ src, hover, suspend = false }: {
  src: string
  hover: boolean
  // The clip belongs to the COVER slide: when the buyer swipes the card's photo carousel
  // (an explicit "show me the photos" gesture), the parent suspends the video until they
  // return to slide 0.
  suspend?: boolean
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const idRef = useRef<string>('')
  if (!idRef.current) idRef.current = `${src}#${Math.random().toString(36).slice(2, 8)}`
  const inViewRef = useRef(false)
  const suspendRef = useRef(suspend)
  suspendRef.current = suspend
  const hoverRef = useRef(false) // real (capability-checked) hover — see the hover effect
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activatedAt = useRef(0)
  const [active, setActive] = useState(false) // <video> mounted + loading
  const [shown, setShown] = useState(false) // actually painting frames → fade it in

  const stop = () => {
    if (armTimer.current) { clearTimeout(armTimer.current); armTimer.current = null }
    if (revealTimer.current) { clearTimeout(revealTimer.current); revealTimer.current = null }
    release(idRef.current)
    activatedAt.current = 0 // re-entry gets a fresh cover beat
    setActive(false)
    setShown(false)
  }
  const start = (force: boolean) => {
    if (!acquire(idRef.current, force)) return
    activatedAt.current ||= Date.now()
    setActive(true)
  }

  // Unconditional unmount cleanup: the IO effect below early-returns for gated viewers
  // (Save-Data/2g/reduced-motion) WITHOUT registering a cleanup, so a card unmounted while
  // holding a slot (hover-started, then tap-through to the PDP) would leak its entry in the
  // module-level `playing` Set forever — two leaks and the cap permanently kills autoplay
  // for the session. release() is idempotent, so double-stop with the IO cleanup is safe.
  useEffect(() => () => stop(), [])

  // Viewport-driven autoplay (the mobile path). One observer per card-with-video —
  // cheap, and only cards that HAVE a clip render this component at all.
  useEffect(() => {
    const el = boxRef.current
    if (!el || !autoplayAllowed()) return
    const obs = new IntersectionObserver(
      (entries) => {
        // Entries queue between dispatches (fast fling / busy main thread can cross the
        // threshold twice before we run) — only the LAST one reflects current reality;
        // acting on the first would strand an invisible playing clip holding a slot.
        const e = entries[entries.length - 1]
        const engaged = e.isIntersecting && e.intersectionRatio >= 0.6 && e.boundingClientRect.width >= 150
        inViewRef.current = engaged
        if (engaged) {
          if (armTimer.current) return
          armTimer.current = setTimeout(() => {
            armTimer.current = null
            if (inViewRef.current && !suspendRef.current) start(false)
          }, SETTLE_MS)
        } else if (!hoverRef.current) {
          // Don't yank the clip out from under a still-hovering pointer just because the
          // card dipped below the visibility threshold mid-scroll.
          stop()
        }
      },
      { threshold: [0.6] },
    )
    obs.observe(el)
    return () => { obs.disconnect(); stop() }
  }, [])

  // Desktop hover: instant start (no settle beat, bypasses the concurrency cap).
  // Capability-gated: touch browsers fire a compatibility mouseenter on TAP, which would
  // force-start full clips for the very Save-Data/2g users the autoplay gate protects
  // (and with no mouseleave ever coming). Only a real hover pointer counts.
  // Leaving only stops it when the viewport path wouldn't keep it playing anyway — a
  // hover-summoned clip on a still-visible card keeps playing past the cap ON PURPOSE:
  // there is one pointer, so the grace is at most one extra clip, and yanking a clip the
  // user just summoned reads as a glitch. It rejoins normal accounting when it leaves view.
  useEffect(() => {
    const realHover = hover && window.matchMedia('(hover: hover)').matches
    hoverRef.current = realHover
    if (suspend) return
    if (realHover) { activatedAt.current ||= Date.now(); start(true) }
    else if (!inViewRef.current) stop()
  }, [hover, suspend])

  // Carousel-swipe suspension: stop immediately; when the buyer returns to the cover
  // slide the IO/hover paths restart it naturally on their next trigger.
  useEffect(() => {
    if (suspend) stop()
    else if (inViewRef.current || hoverRef.current) start(hoverRef.current)
  }, [suspend])

  const onPlaying = () => {
    if (shown || revealTimer.current) return
    const wait = Math.max(0, COVER_BEAT_MS - (Date.now() - activatedAt.current))
    revealTimer.current = setTimeout(() => { revealTimer.current = null; setShown(true) }, wait)
  }

  return (
    <div ref={boxRef} className="pointer-events-none absolute inset-0" aria-hidden="true">
      {active && (
        <video
          // React can omit the `muted` attribute on freshly created elements — set it
          // imperatively too, or mobile browsers refuse the autoplay.
          ref={(v) => { if (v) v.muted = true }}
          src={src}
          muted
          loop
          autoPlay
          playsInline
          preload="auto"
          onPlaying={onPlaying}
          className={cn(
            'absolute inset-0 h-full w-full object-cover transition-opacity duration-500',
            shown ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
    </div>
  )
}
