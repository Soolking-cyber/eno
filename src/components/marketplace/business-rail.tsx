'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Award } from 'lucide-react'
import type { SerializedListingCard } from '@/lib/types'
import { ListingCard } from './listing-card'
import { useLanguage } from '@/context/language-context'

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
    <section className="mb-7">
      <div className="mb-2.5 flex items-center gap-2">
        <Award className="h-4 w-4 text-accent-foreground" />
        <h2 className="text-base font-bold text-foreground">{tr('Outstanding businesses', 'Doanh nghiệp nổi bật')}</h2>
      </div>
      {/* Same card size/gaps as the feed grid (cols-2 / -3 / -4) so it reads as one family. */}
      <div className="flex gap-2 overflow-x-auto scrollbar-none snap-x sm:gap-4">
        {listings === null
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="w-[calc((100%-0.5rem)/2)] shrink-0 snap-start space-y-3 sm:w-[calc((100%-2rem)/3)] lg:w-[calc((100%-3rem)/4)]">
                <div className="aspect-[4/3] w-full rounded-xl shimmer" />
                <div className="h-4 w-2/3 rounded shimmer" />
                <div className="h-3 w-1/2 rounded shimmer" />
                <div className="h-3 w-1/3 rounded shimmer" />
              </div>
            ))
          : listings.map((l) => (
              <div key={l.id} className="w-[calc((100%-0.5rem)/2)] shrink-0 snap-start sm:w-[calc((100%-2rem)/3)] lg:w-[calc((100%-3rem)/4)]">
                <ListingCard
                  listing={l}
                  onOpen={(x) => router.push(`/listings/${x.id}`)}
                  onLocate={() => window.dispatchEvent(new CustomEvent('eno:locate', { detail: { id: l.id, listing: l } }))}
                />
              </div>
            ))}
      </div>
    </section>
  )
}
