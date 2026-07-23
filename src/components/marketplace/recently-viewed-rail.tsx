'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { History } from 'lucide-react'
import type { SerializedListingCard } from '@/lib/types'
import { ListingCard } from './listing-card'
import { Shelf, RAIL_CARD_W } from './shelf'
import { useLanguage } from '@/context/language-context'
import { useNearViewport } from '@/hooks/use-near-viewport'
import { personalizationAllowed } from '@/lib/consent'
import { getViewedListingIds } from '@/lib/reco-signals'

/** "Recently viewed" — the buyer's own trail of opened listings (device-local),
 *  so they can jump back to the exact item without re-searching. Consent-gated
 *  (same bar as the For-You rail); hidden until there are at least two to show.
 *  IO-gated: the fetch waits until the shelf is ~a viewport away, so on the PDP
 *  (deep below the fold) it never competes with the gallery LCP image — and on
 *  surfaces where it sits near the top it still fires immediately.
 *  Card size/gaps match the other home rails + feed grid (cols-2 / -3 / -4). */
export function RecentlyViewedRail({ excludeId }: { excludeId?: string }) {
  const router = useRouter()
  const { tr, lang } = useLanguage()
  const [listings, setListings] = useState<SerializedListingCard[]>([])
  const { ref, near } = useNearViewport<HTMLDivElement>()

  useEffect(() => {
    if (!near || !personalizationAllowed()) return
    let ids = getViewedListingIds()
    if (excludeId) ids = ids.filter((id) => id !== excludeId)
    ids = ids.slice(0, 12)
    if (ids.length < 2) return
    let off = false
    fetch(`/api/listings?ids=${ids.join(',')}${lang !== 'en' && lang !== 'vi' ? `&lang=${lang}` : ''}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!off && d?.listings) setListings(d.listings) })
      .catch(() => { /* ignore */ })
    return () => { off = true }
  }, [near, excludeId, lang])

  // Sentinel: the observer needs a node in the layout before there is data. It must be
  // OUT OF FLOW (absolute, zero-size): the home landing mounts this rail inside a space-y
  // container, where even a zero-height in-flow div earns a full spacing unit — doubling
  // the section gap whenever the rail self-hides. Absolute keeps its static position (IO
  // still fires; zero-area targets intersect at threshold 0) with no layout contribution.
  // NOT `hidden`/display:none — those never intersect and would silently kill the rail.
  if (listings.length < 2) return <div ref={ref} aria-hidden="true" className="absolute h-0 w-0" />

  return (
    <Shelf icon={History} title={tr('Recently viewed', 'Đã xem gần đây')} sectionClassName="mb-7" watch={listings.length}>
      {listings.map((l) => (
        <div key={l.id} className={RAIL_CARD_W}>
          <ListingCard
            listing={l}
            onOpen={(x) => router.push(`/listings/${x.id}`)}
            // Locate→map only makes sense on the home explorer (it listens for the
            // event); the PDP usage passes excludeId, so skip it there.
            onLocate={excludeId ? undefined : () => window.dispatchEvent(new CustomEvent('eno:locate', { detail: { id: l.id, listing: l } }))}
          />
        </div>
      ))}
    </Shelf>
  )
}
