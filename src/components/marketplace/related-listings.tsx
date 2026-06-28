'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CardRow } from './card-row'
import { useLanguage } from '@/context/language-context'
import type { SerializedListing } from '@/lib/types'

/** "More like this" rail on the listing page — same category, current listing
 *  excluded. Fetched CLIENT-side so the ISR-cached page HTML stays fresh + light. */
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
    <div className="mt-12">
      <CardRow
        title={tr('More like this', 'Tin tương tự')}
        listings={items}
        onOpen={(l) => router.push(`/listings/${l.id}`)}
      />
    </div>
  )
}
