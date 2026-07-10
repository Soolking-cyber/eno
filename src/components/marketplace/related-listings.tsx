'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ListingCard } from './listing-card'
import { Shelf, RAIL_CARD_W } from './shelf'
import { useLanguage } from '@/context/language-context'
import { useNearViewport } from '@/hooks/use-near-viewport'
import type { SerializedListingCard } from '@/lib/types'

/** "More like this" rail on the listing page — same category, current listing
 *  excluded. Fetched CLIENT-side so the ISR-cached page HTML stays fresh + light,
 *  and only once the shelf is ~a viewport away (IO-gated) so this below-fold call
 *  never competes with the gallery LCP image for bandwidth.
 *  Uses the STANDARD grid-matched card size (2/3/4 per view, like the home rails +
 *  "Recently viewed") so all rails read as one family. */
export function RelatedListings({ listingId, categorySlug }: { listingId: string; categorySlug: string }) {
  const router = useRouter()
  const { tr } = useLanguage()
  const [items, setItems] = useState<SerializedListingCard[]>([])
  const { ref, near } = useNearViewport<HTMLDivElement>()

  useEffect(() => {
    if (!near) return
    let off = false
    fetch(`/api/listings?category=${encodeURIComponent(categorySlug)}&limit=12&sort=newest`)
      .then((r) => r.json())
      .then((d) => {
        if (off) return
        setItems((d.listings || []).filter((l: SerializedListingCard) => l.id !== listingId).slice(0, 10))
      })
      .catch(() => {})
    return () => { off = true }
  }, [near, categorySlug, listingId])

  // Sentinel: the observer needs a node in the layout before there is data. Out of flow
  // (absolute, zero-size) so it can never earn spacing from a space-y/gap parent; IO still
  // fires on zero-area targets at threshold 0. NOT `hidden` — that never intersects.
  if (items.length === 0) return <div ref={ref} aria-hidden="true" className="absolute h-0 w-0" />

  return (
    <Shelf title={tr('More like this', 'Tin tương tự')} sectionClassName="mt-12">
      {items.map((l) => (
        <div key={l.id} className={RAIL_CARD_W}>
          <ListingCard listing={l} onOpen={(x) => router.push(`/listings/${x.id}`)} />
        </div>
      ))}
    </Shelf>
  )
}
