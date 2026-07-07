'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ListingCard } from './listing-card'
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
    <section className="mt-12">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h2 className="text-base font-bold text-foreground">
          {tr('More from this seller', `Tin khác từ ${sellerName}`)}
        </h2>
        <Link
          href={sellerHref}
          className="shrink-0 text-sm font-semibold text-accent-foreground hover:underline"
        >
          {tr('See all', 'Xem tất cả')} →
        </Link>
      </div>
      <div className="flex gap-2 overflow-x-auto scrollbar-none snap-x sm:gap-4">
        {listings.map((l) => (
          <div
            key={l.id}
            className="w-[calc((100%-0.5rem)/2)] shrink-0 snap-start sm:w-[calc((100%-2rem)/3)] lg:w-[calc((100%-3rem)/4)]"
          >
            <ListingCard listing={l} onOpen={(x) => router.push(`/listings/${x.id}`)} />
          </div>
        ))}
      </div>
    </section>
  )
}
