'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { Mascot } from './mascot'
import { useLanguage } from '@/context/language-context'
import { PULL_THRESHOLD, pullDistance, pullProgress, pullState } from '@/lib/pull-to-refresh'
import { cn } from '@/lib/utils'

/**
 * PULL DOWN AT THE TOP OF THE FEED AND THE MASCOT COMES TO FETCH (owner, 2026-09-18, from the 58
 * app: "when screen pulled down cool small animation with character"). Their home answers the drag
 * with a small character and 松手刷新 — "let go to refresh"; this is that, with eno's own mascot.
 *
 * ⛔ TOUCH ONLY, AND THAT IS NOT A STYLE CHOICE. A mouse cannot rubber-band a page: there is no
 * gesture to hang this on, the wheel's overscroll is the browser's, and a desktop visitor already has
 * the browser's own reload. The listeners are only attached when the device says `pointer: coarse`.
 * ⛔ AND NOT IN THE NATIVE SHELL, where the WebView does its own pull-to-refresh — two of them on one
 * surface means one drag refreshing twice, and the outer one wins the gesture anyway.
 *
 * ⚠️ `touchmove` IS NON-PASSIVE ON PURPOSE, which React's `onTouchMove` cannot express: preventing
 * the default is the only way to stop iOS from rubber-banding the whole document under the
 * indicator, and a passive listener may not call `preventDefault()`. Hence the manual
 * `addEventListener` with `{ passive: false }` rather than JSX handlers.
 * ⚠️ ONLY WHILE THE GESTURE IS OURS. The listener returns immediately unless the page is at the very
 * top AND the finger is moving down — otherwise every ordinary scroll on the home page would run
 * through this code and, worse, could swallow a flick.
 */
export function PullToRefresh({ label }: { label?: string }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { tr } = useLanguage()
  const [distance, setDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  /** The gesture's own state lives in refs: a touchmove at 60fps must not re-render to decide. */
  const startY = useRef<number | null>(null)
  const live = useRef(false)
  /**
   * ⚠️ THE MOVE HANDLER WRITES THIS DIRECTLY, and `touchend` reads it. State is a render behind the
   * last move, so judging a release on `distance` would use the previous frame — and a ref assigned
   * during render (the first version) has the same problem one step later. Writing it in the handler
   * is the only version where the number the finger just produced is the number that decides.
   */
  const distanceRef = useRef(0)
  const refreshingRef = useRef(false)

  const refresh = useCallback(async () => {
    refreshingRef.current = true
    setRefreshing(true)
    try {
      /**
       * BOTH HALVES, because the home page is half server-rendered and half client-cached: the feed
       * and its counts come from React Query, the rails and the ISR'd shell come from the server.
       * Invalidating without `router.refresh()` leaves the server half stale; refreshing without the
       * invalidate leaves the query cache serving the rows the visitor just pulled to replace.
       */
      /* ⚠️ `refetchType: 'active'` — an unfiltered invalidate marks EVERY cached query stale, including
         the ones behind screens the visitor is not looking at, so a pull would quietly re-fetch the
         whole app (a reviewer's catch). Marking all and refetching only what is mounted is the
         behaviour a pull-to-refresh actually promises. */
      await Promise.allSettled([
        queryClient.invalidateQueries({ refetchType: 'active' }),
        Promise.resolve(router.refresh()),
      ])
    } finally {
      // A beat at the end so the mascot is READ rather than glimpsed; the data is already on its way.
      setTimeout(() => { refreshingRef.current = false; setRefreshing(false); setDistance(0); distanceRef.current = 0 }, 450)
    }
  }, [queryClient, router])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const coarse = window.matchMedia?.('(pointer: coarse)')?.matches
    const native = /EnoNative/.test(navigator.userAgent || '')
    if (!coarse || native) return

    const onStart = (e: TouchEvent) => {
      // `scrollY <= 0` rather than `=== 0`: iOS reports a small negative while the page is bouncing.
      if (window.scrollY > 0 || e.touches.length !== 1) { startY.current = null; return }
      startY.current = e.touches[0].clientY
      live.current = false
    }
    const reset = () => { startY.current = null; live.current = false; distanceRef.current = 0; setDistance(0) }
    const onMove = (e: TouchEvent) => {
      if (startY.current == null || refreshingRef.current) return
      /* ⛔ ONE FINGER ONLY, CHECKED ON EVERY MOVE. `touchstart` rejecting multi-touch is not enough:
         a second finger arriving mid-gesture is a PINCH, and this handler calls `preventDefault()`,
         so without this line pulling then pinching would eat zoom at the top of the home page (a
         reviewer's catch — and zoom is an accessibility affordance, not a nicety). */
      if (e.touches.length !== 1) { reset(); return }
      const travel = e.touches[0].clientY - startY.current
      /* ⛔ AND PULLING BACK UP UNWINDS THE PULL RATHER THAN FREEZING IT. The first version returned
         early on a non-positive travel, which left the ref holding the DEEPEST distance reached — so
         dragging past the threshold and back to where you started still refreshed on release. */
      if (travel <= 0) {
        if (!live.current) { startY.current = null; return }
        distanceRef.current = 0
        setDistance(0)
        return
      }
      if (window.scrollY > 0) { reset(); return }
      live.current = true
      // The gesture is ours now, so the document must not bounce under it.
      if (e.cancelable) e.preventDefault()
      const d = pullDistance(travel)
      distanceRef.current = d
      setDistance(d)
    }
    const onEnd = () => {
      const d = distanceRef.current
      const wasLive = live.current
      startY.current = null
      live.current = false
      /* ⚠️ `refreshingRef`, NOT THE STATE: a second finger landing during the 450ms hold would
         otherwise start another refresh (a reviewer's catch). */
      if (wasLive && d >= PULL_THRESHOLD && !refreshingRef.current) void refresh()
      else reset()
    }
    /* ⛔ CANCEL IS NOT RELEASE. `touchcancel` fires when the system takes the gesture — a call
       arrives, the WebView interrupts — and treating it as a release would refresh a page the
       visitor never let go of. */
    const onCancel = () => reset()
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onEnd, { passive: true })
    window.addEventListener('touchcancel', onCancel, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onCancel)
    }
  }, [refresh])

  const state = pullState(distance, refreshing)
  if (state === 'idle') return null

  const p = pullProgress(distance)
  const text =
    state === 'refreshing' ? tr('Refreshing…', 'Đang làm mới…')
      : state === 'ready' ? tr('Release to refresh', 'Thả ra để làm mới')
        : (label ?? tr('Pull to refresh', 'Kéo xuống để làm mới'))

  return (
    <>
      {/* ⚠️ THE VISUAL IS `aria-hidden`, SO THE STATE IS ANNOUNCED SEPARATELY. iOS is `pointer:
          coarse`, so a VoiceOver user can reach this gesture; without a live region the refresh
          would be silent to them (a reviewer's catch). Only the refreshing state is announced —
          narrating every pixel of a drag would be noise. */}
      <span aria-live="polite" className="sr-only">{state === 'refreshing' ? tr('Refreshing…', 'Đang làm mới…') : ''}</span>
    <div
      aria-hidden="true"
      /**
       * ⛔ A BAND THAT GROWS WITH THE PULL, NOT A BADGE FLOATING OVER THE GRID. The first version
       * translated a small indicator down the page and it landed ON the category tiles — the mascot
       * read as something dropped on the rail rather than as space being opened above it. This is
       * the band: it starts under the header, its HEIGHT is the pull, and it is painted in the
       * page's own surface colour at 95% with a blur behind it, so the tiles under it are frosted
       * rather than hidden and what the hand drags down reads as the page itself. 58 does the same thing by translating the whole page; that is not available
       * here, because a transformed ancestor becomes the containing block for `position: fixed` and
       * would break the sticky header and the facet bar under it (mobile-ladder.tsx says so).
       * ⚠️ `top-16` IS THE HEADER, which is 64px at every width it matters on.
       */
      className="material pointer-events-none fixed inset-x-0 top-16 z-30 flex flex-col items-center justify-end overflow-hidden bg-background/95 backdrop-blur-sm"
      style={{ height: `${distance + 44}px` }}
    >
      {/* ⚠️ THE STYLE RIDES A WRAPPER, NOT THE MASCOT: `<Mascot>` owns its own `style` (the mask url
          and sizing live there), so passing one would either be dropped or fight it. Scale and
          opacity track the pull so the first pixels of the drag already answer the hand. */}
      <span
        className="inline-flex transition-transform duration-200"
        style={{ opacity: 0.35 + p * 0.65, transform: `scale(${0.8 + p * 0.2})` }}
      >
        <Mascot
          name={state === 'refreshing' ? 'success' : 'wave'}
          className={cn(
            'h-10 w-10 text-cta',
            // Ready = the mascot sits up; refreshing = a gentle bob, unless motion is reduced.
            state === 'ready' && 'scale-110',
            state === 'refreshing' && 'motion-safe:animate-bounce',
          )}
        />
      </span>
      <span className="mb-1 mt-1 text-2xs font-semibold text-body">{text}</span>
    </div>
    </>
  )
}
