'use client'

import dynamic from 'next/dynamic'
import type { SerializedListingCard } from '@/lib/types'
import { Tr } from '@/context/language-context'
import { Spinner } from '@/components/ui/spinner'
import { useNearViewport } from '@/hooks/use-near-viewport'

// The one placeholder, shared by BOTH deferral stages below (pre-viewport, and
// next/dynamic's own chunk-loading window) so the tile never changes appearance as it
// hands off from one to the other — the user sees a single steady state until the map
// paints. It fills its parent, which fixes the height (h-[260px] on the PDP), so no
// stage of this can move the page.
function MapPlaceholder() {
  return (
    <div className="w-full h-full bg-tint flex flex-col items-center justify-center gap-2 select-none animate-pulse">
      <Spinner size="md" />
      <span className="text-3xs font-bold text-muted-foreground uppercase tracking-wider">
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
 *  is missing (old WebViews, jsdom) — there the map simply mounts as it does today. */
export function ListingDetailMap({ listings, activeDistrict }: Props) {
  const { ref, near } = useNearViewport<HTMLDivElement>()

  return (
    <div ref={ref} className="w-full h-full">
      {near ? (
        <ListingsMap
          listings={listings}
          activeDistrict={activeDistrict}
          onOpenListing={() => {}}
        />
      ) : (
        <MapPlaceholder />
      )}
    </div>
  )
}
