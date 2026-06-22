'use client'

import { useRouter } from 'next/navigation'
import type { SerializedListing } from '@/lib/types'
import { ListingCard } from './listing-card'

export function SellerListings({ listings }: { listings: SerializedListing[] }) {
  const router = useRouter()
  if (listings.length === 0) return null
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {listings.map((l, i) => (
        <div key={l.id} onMouseEnter={() => router.prefetch(`/listings/${l.id}`)} onTouchStart={() => router.prefetch(`/listings/${l.id}`)}>
          <ListingCard listing={l} onOpen={() => router.push(`/listings/${l.id}`)} priority={i < 4} />
        </div>
      ))}
    </div>
  )
}
