'use client'

import { useRouter } from 'next/navigation'
import { ListingCard } from './listing-card'
import { Shelf, RAIL_CARD_W } from './shelf'
import { useLanguage } from '@/context/language-context'
import type { SerializedListingCard } from '@/lib/types'

/**
 * Auto-curated storefront showcase rails (Shopee-style). Even a low-effort seller
 * gets a merchandised page: two horizontal ListingCard rails derived purely from
 * the already-loaded active-listings set — zero seller configuration. Because they
 * sort the SAME set in memory, sold/removed items drop out automatically (self-
 * healing). Rendered ONLY when the seller has MORE THAN 8 active listings; below
 * that the full sortable grid alone is enough, so this returns null.
 *
 * Card sizing + snap behaviour are IDENTICAL to SameSellerShelf so every rail on
 * the site reads as one family. onLocate falls back to the card default (`/?focus=`).
 */
export function StorefrontRails({ listings }: { listings: SerializedListingCard[] }) {
  const router = useRouter()
  const { tr } = useLanguage()

  // Curated preview only when the grid alone would under-merchandise the shop.
  if (listings.length <= 8) return null

  // Both rails derive from the same loaded set (no new query). "Just listed" keeps
  // the server's postedAt-desc order; "Most contacted" re-sorts a copy by demand.
  const justListed = listings.slice(0, 8)
  const mostContacted = [...listings].sort((a, b) => b.contactCount - a.contactCount).slice(0, 8)

  return (
    <div className="mt-8 space-y-8">
      <Rail title={tr('Just listed', 'Mới đăng')} listings={justListed} onOpen={(id) => router.push(`/listings/${id}`)} />
      <Rail title={tr('Most contacted', 'Được quan tâm nhất')} listings={mostContacted} onOpen={(id) => router.push(`/listings/${id}`)} />
    </div>
  )
}

function Rail({
  title,
  listings,
  onOpen,
}: {
  title: string
  listings: SerializedListingCard[]
  onOpen: (id: string) => void
}) {
  return (
    <Shelf title={title}>
      {listings.map((l) => (
        <div key={l.id} className={RAIL_CARD_W}>
          <ListingCard listing={l} onOpen={(x) => onOpen(x.id)} />
        </div>
      ))}
    </Shelf>
  )
}
