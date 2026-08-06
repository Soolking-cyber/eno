'use client'

import { useRouter } from 'next/navigation'
import { ListingCard } from './listing-card'
import { Shelf, RAIL_CARD_W } from './shelf'
import { useLanguage } from '@/context/language-context'
import type { SerializedListingCard } from '@/lib/types'

/**
 * "More from this seller" rail on the PDP. Same grid-matched card sizing + snap
 * behaviour as the other rails (RelatedListings / RecentlyViewed) so every rail
 * reads as one family. onLocate falls back to the card's default (`/?focus=`).
 * Renders NOTHING when the seller has fewer than two other listings.
 */
export function SameSellerShelf({
  listings,
  sellerHref,
  sellerName,
}: {
  listings: SerializedListingCard[]
  sellerHref: string
  sellerName: string
}) {
  const router = useRouter()
  const { tr } = useLanguage()
  if (listings.length < 2) return null

  return (
    // Shelf's SECTION_TITLE already carries the app-wide text-lg font-semibold header tier,
    // matching the page's section headers and the "More like this" shelf below it.
    <Shelf
      title={tr('More from this seller', `Tin khác từ ${sellerName}`)}
      seeAllHref={sellerHref}
      sectionClassName="mt-12"
      watch={listings.length}
    >
      {listings.map((l) => (
        <div key={l.id} className={RAIL_CARD_W}>
          <ListingCard listing={l} onOpen={(x) => router.push(`/listings/${x.id}`)} />
        </div>
      ))}
    </Shelf>
  )
}
