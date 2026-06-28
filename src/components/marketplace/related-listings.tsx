'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ListingCard } from './listing-card'
import { useLanguage } from '@/context/language-context'
import type { SerializedListing } from '@/lib/types'

/** "More like this" rail on the listing page — same category, current listing
 *  excluded. Fetched CLIENT-side so the ISR-cached page HTML stays fresh + light.
 *  Uses the STANDARD grid-matched card size (2/3/4 per view, like the home rails +
 *  "Recently viewed") so all rails read as one family. */
export function RelatedListings({ listingId, categorySlug }: { listingId: string; categorySlug: string }) {
  const router = useRouter()
  const { tr } = useLanguage()
  const [items, setItems] = useState<SerializedListing[]>([])

  useEffect(() => {
    let off = false
    fetch(`/api/listings?category=${encodeURIComponent(categorySlug)}&limit=12&sort=newest`)
      .then((r) => r.json())
      .then((d) => {
        if (off) return
        setItems((d.listings || []).filter((l: SerializedListing) => l.id !== listingId).slice(0, 10))
      })
      .catch(() => {})
    return () => { off = true }
  }, [categorySlug, listingId])

  if (items.length === 0) return null

  return (
    <section className="mt-12">
      <h2 className="mb-2.5 text-base font-bold text-foreground">{tr('More like this', 'Tin tương tự')}</h2>
      {/* Same card size/gaps as the feed grid (cols-2 / -3 / -4) so it matches the
          other rails. */}
      <div className="flex gap-2 overflow-x-auto scrollbar-none snap-x sm:gap-4">
        {items.map((l) => (
          <div key={l.id} className="w-[calc((100%-0.5rem)/2)] shrink-0 snap-start sm:w-[calc((100%-2rem)/3)] lg:w-[calc((100%-3rem)/4)]">
            <ListingCard listing={l} onOpen={(x) => router.push(`/listings/${x.id}`)} />
          </div>
        ))}
      </div>
    </section>
  )
}
