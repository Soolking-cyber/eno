'use client'

import { useSyncExternalStore } from 'react'
import dynamic from 'next/dynamic'
import type { SerializedListingCard } from '@/lib/types'
import { Tr } from '@/context/language-context'
import { Spinner } from '@/components/ui/spinner'
import { useNearViewport } from '@/hooks/use-near-viewport'
import { ListingMapPreview } from './listing-map-preview'

// The one placeholder, shared by BOTH deferral stages below (pre-viewport, and
// next/dynamic's own chunk-loading window) so the tile never changes appearance as it
// hands off from one to the other — the user sees a single steady state until the map
// paints. It fills its parent, which fixes the height (h-[260px] on the PDP), so no
// stage of this can move the page.
function MapPlaceholder() {
  return (
    // ⚠️ No `animate-pulse` here, and ink-4 rather than muted-foreground. Both are contrast
    // fixes, and they only became visible once this placeholder started PERSISTING until the
    // map scrolls into view — before that it flashed for one chunk-load and axe never sampled
    // it. `animate-pulse` fades the whole subtree to 50% opacity, which lightened this 10px
    // bold label to #868686 on #f6f6f6 = 3.36:1, a serious axe failure (AA wants 4.5). The
    // Spinner already says "loading", so the pulse was redundant with it anyway; ink-4 is the
    // token documented as AA on both white and bg-tint for exactly this kind of small meta text.
    <div className="w-full h-full bg-tint flex flex-col items-center justify-center gap-2 select-none">
      <Spinner size="md" />
      <span className="text-3xs font-bold text-ink-4 uppercase tracking-wider">
        <Tr text="Loading map…" />
      </span>
    </div>
  )
}

const ListingsMap = dynamic(() => import('./listings-map').then((m) => m.ListingsMap), {
  ssr: false,
  loading: () => <MapPlaceholder />,
})

type Props = {
  listings: SerializedListingCard[]
  activeDistrict: string
}

/**
 * ⛔ TOUCH → A PICTURE AND AN "OPEN MAP" BUTTON; NO TOUCH → THE LIVE MAP (owner, 2026-09-25).
 * `(any-pointer: coarse)` asks whether ANY input is a finger. A phone or a tablet answers yes and gets
 * ListingMapPreview (listing-map-preview.tsx says why: the live map's `touch-action: none` swallowed
 * one-finger scrolls). So does a touchscreen laptop, deliberately: its primary pointer is the trackpad,
 * but a finger scrolling the page on its screen meets exactly the same trap (codex, twice). A desktop
 * with only a mouse or trackpad keeps the live map exactly as before.
 * ⚠️ SUBSCRIBED, not read once: a tablet that gains or loses a keyboard cover flips at runtime. The
 * SERVER snapshot is `null` ("not known yet"), so the server HTML and the hydration pass both render
 * the placeholder, and neither branch is committed until the client can actually answer.
 */
const COARSE = '(any-pointer: coarse)'
const subscribeCoarse = (cb: () => void) => {
  const mq = window.matchMedia?.(COARSE)
  if (!mq) return () => {}
  // Safari 13 and older expose only the legacy addListener; the modern call would be a silent no-op.
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', cb)
    return () => mq.removeEventListener('change', cb)
  }
  mq.addListener(cb)
  return () => mq.removeListener(cb)
}
const coarseNow = () => window.matchMedia?.(COARSE).matches ?? false

/** The PDP's location map. Mounted only once it is ~a viewport away.
 *
 *  `ssr: false` alone was NOT enough: it defers to HYDRATION, not to the viewport, so
 *  every listing view pulled the Leaflet vendor chunk and started fetching CARTO tiles
 *  the moment the page became interactive — for a tile that sits far below the fold and
 *  that most visitors never scroll to. That competes with the gallery LCP image for
 *  bandwidth on exactly the mobile connections least able to spare it.
 *
 *  Gated with the same `useNearViewport` the explorer and the related-listings shelf
 *  already use. The sentinel is the wrapper itself (not a zero-height element): the hook
 *  requires something present from FIRST render to observe, and the wrapper is already
 *  full-size, so it is the natural target. The hook fails open where IntersectionObserver
 *  is missing (old WebViews, jsdom) — there the map simply mounts as it does today.
 *  The touch preview rides the same gate, so its tiles are not fetched before the reader is near. */
export function ListingDetailMap({ listings, activeDistrict }: Props) {
  const { ref, near } = useNearViewport<HTMLDivElement>()
  const touch = useSyncExternalStore<boolean | null>(subscribeCoarse, coarseNow, () => null)
  const liveMap = () => (
    <ListingsMap
      listings={listings}
      activeDistrict={activeDistrict}
      onOpenListing={() => {}}
    />
  )

  return (
    <div ref={ref} className="w-full h-full">
      {!near || touch === null ? (
        <MapPlaceholder />
      ) : touch ? (
        // A PDP always passes its one listing; with none there is nothing to picture — and a
        // placeholder here would be a loading tile that never resolves.
        listings[0] ? <ListingMapPreview listing={listings[0]} liveMap={liveMap} /> : null
      ) : (
        liveMap()
      )}
    </div>
  )
}
