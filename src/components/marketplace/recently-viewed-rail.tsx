'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { History } from 'lucide-react'
import type { SerializedListingCard } from '@/lib/types'
import { ListingCard } from './listing-card'
import { Shelf, RAIL_CARD_W } from './shelf'
import { useLanguage } from '@/context/language-context'
import { personalizationAllowed } from '@/lib/consent'
import { getViewedListingIds } from '@/lib/reco-signals'

/** "Recently viewed" — the buyer's own trail of opened listings (device-local),
 *  so they can jump back to the exact item without re-searching. Consent-gated
 *  (same bar as the For-You rail); hidden until there are at least two to show.
 *  Card size/gaps match the other home rails + feed grid (cols-2 / -3 / -4). */
export function RecentlyViewedRail({ excludeId }: { excludeId?: string }) {
  const router = useRouter()
  const { tr } = useLanguage()
  const [listings, setListings] = useState<SerializedListingCard[]>([])

  useEffect(() => {
    if (!personalizationAllowed()) return
    let ids = getViewedListingIds()
    if (excludeId) ids = ids.filter((id) => id !== excludeId)
    ids = ids.slice(0, 12)
    if (ids.length < 2) return
    let off = false
    fetch(`/api/listings?ids=${ids.join(',')}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!off && d?.listings) setListings(d.listings) })
      .catch(() => { /* ignore */ })
    return () => { off = true }
  }, [excludeId])

  if (listings.length < 2) return null

  return (
    <Shelf icon={History} title={tr('Recently viewed', 'Đã xem gần đây')} sectionClassName="mb-7">
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
