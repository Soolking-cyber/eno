'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Award } from 'lucide-react'
import type { SerializedListingCard } from '@/lib/types'
import { ListingCard } from './listing-card'
import { Shelf, RAIL_CARD_W } from './shelf'
import { useLanguage } from '@/context/language-context'
import { ListingCardSkeleton } from './listing-card-skeleton'

/** "Outstanding businesses" — a horizontal rail of ONE flagship listing (most-viewed)
 *  from each of the highest-trust business storefronts. A reward for good standing.
 *  Reuses the standard ListingCard (heart, locate→map, trust). Hides when empty. */
export function BusinessRail() {
  const { tr } = useLanguage()
  const router = useRouter()
  const [listings, setListings] = useState<SerializedListingCard[] | null>(null)

  useEffect(() => {
    fetch('/api/businesses/top')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setListings(d.listings || []) })
      .catch(() => {})
  }, [])

  if (listings !== null && listings.length === 0) return null

  return (
    <Shelf icon={Award} title={tr('Outstanding businesses', 'Doanh nghiệp nổi bật')} sectionClassName="mb-7">
      {listings === null
        ? Array.from({ length: 6 }).map((_, i) => (
            <ListingCardSkeleton key={i} className={RAIL_CARD_W} />
          ))
        : listings.map((l) => (
            <div key={l.id} className={RAIL_CARD_W}>
              <ListingCard
                listing={l}
                onOpen={(x) => router.push(`/listings/${x.id}`)}
                onLocate={() => window.dispatchEvent(new CustomEvent('eno:locate', { detail: { id: l.id, listing: l } }))}
              />
            </div>
          ))}
    </Shelf>
  )
}
