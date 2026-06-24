'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import type { SerializedListing } from '@/lib/types'
import { ListingCard } from './listing-card'
import { fold } from '@/lib/fold'
import { useLanguage } from '@/context/language-context'

export function SellerListings({ listings, searchable = false }: { listings: SerializedListing[]; searchable?: boolean }) {
  const router = useRouter()
  const { tr } = useLanguage()
  const [q, setQ] = useState('')

  const shown = useMemo(() => {
    if (!searchable) return listings
    const fq = fold(q.trim())
    if (!fq) return listings
    return listings.filter((l) => fold(`${l.title} ${l.titleVi || ''} ${l.location} ${l.district || ''}`).includes(fq))
  }, [listings, searchable, q])

  if (listings.length === 0) return null

  const grid = (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {shown.map((l, i) => (
        <div key={l.id} onMouseEnter={() => router.prefetch(`/listings/${l.id}`)} onTouchStart={() => router.prefetch(`/listings/${l.id}`)}>
          <ListingCard listing={l} onOpen={() => router.push(`/listings/${l.id}`)} priority={i < 4} />
        </div>
      ))}
    </div>
  )

  if (!searchable) return grid

  return (
    <div className="space-y-4">
      {/* Just a search within this seller's catalog — no category/type filters. */}
      <div className="flex items-center gap-2 rounded-xl bg-tint px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-ink-4" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tr('Search this seller', 'Tìm trong tin của người bán')}
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-ink-4"
        />
      </div>

      {shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{tr('No listings match.', 'Không có tin nào khớp.')}</p>
      ) : (
        grid
      )}
    </div>
  )
}
