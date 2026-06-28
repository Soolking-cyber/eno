'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { History } from 'lucide-react'
import type { SerializedListing } from '@/lib/types'
import { ListingCard } from './listing-card'
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
  const [listings, setListings] = useState<SerializedListing[]>([])

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
    <section className="mb-7">
      <div className="mb-2.5 flex items-center gap-2">
        <History className="h-4 w-4 text-accent-foreground" />
        <h2 className="text-base font-bold text-foreground">{tr('Recently viewed', 'Đã xem gần đây')}</h2>
      </div>
      {/* Same card size/gaps as the feed grid (cols-2 / -3 / -4) so it reads as one family. */}
      <div className="flex gap-2 overflow-x-auto scrollbar-none snap-x sm:gap-4">
        {listings.map((l) => (
          <div key={l.id} className="w-[calc((100%-0.5rem)/2)] shrink-0 snap-start sm:w-[calc((100%-2rem)/3)] lg:w-[calc((100%-3rem)/4)]">
            <ListingCard
              listing={l}
              onOpen={(x) => router.push(`/listings/${x.id}`)}
              // Locate→map only makes sense on the home explorer (it listens for the
              // event); the PDP usage passes excludeId, so skip it there.
              onLocate={excludeId ? undefined : () => window.dispatchEvent(new CustomEvent('eno:locate', { detail: { id: l.id, listing: l } }))}
            />
          </div>
        ))}
      </div>
    </section>
  )
}
