'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SerializedListing } from '@/lib/types'
import { CardRow } from './card-row'
import { useLanguage } from '@/context/language-context'
import { personalizationAllowed } from '@/lib/consent'
import { getViewedListingIds } from '@/lib/reco-signals'

/** "Recently viewed" — the buyer's own trail of opened listings (device-local),
 *  so they can jump back to the exact item without re-searching. Consent-gated
 *  (same bar as the For-You rail); hidden until there are at least two to show. */
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
    <CardRow
      title={tr('Recently viewed', 'Đã xem gần đây')}
      listings={listings}
      onOpen={(l) => router.push(`/listings/${l.id}`)}
    />
  )
}
