'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import type { SerializedListing } from '@/lib/types'
import { ListingCard } from './listing-card'
import { CustomSelect } from './custom-select'
import { fold } from '@/lib/fold'
import { LISTING_TYPES } from '@/lib/taxonomy'
import { useLanguage } from '@/context/language-context'

export function SellerListings({ listings, searchable = false }: { listings: SerializedListing[]; searchable?: boolean }) {
  const router = useRouter()
  const { lang, tr } = useLanguage()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [type, setType] = useState('all')

  // Distinct categories + intents present in this seller's catalog (filter chips
  // only show options that actually exist here).
  const cats = useMemo(() => {
    const m = new Map<string, { slug: string; label: string }>()
    for (const l of listings) m.set(l.category.slug, { slug: l.category.slug, label: lang === 'vi' ? l.category.nameVi : l.category.name })
    return [...m.values()]
  }, [listings, lang])
  const types = useMemo(() => {
    const set = new Set(listings.map((l) => l.listingType))
    return LISTING_TYPES.filter((t) => set.has(t.value))
  }, [listings])

  const shown = useMemo(() => {
    if (!searchable) return listings
    const fq = fold(q.trim())
    return listings.filter((l) => {
      if (cat !== 'all' && l.category.slug !== cat) return false
      if (type !== 'all' && l.listingType !== type) return false
      if (fq) {
        const hay = fold(`${l.title} ${l.titleVi || ''} ${l.location} ${l.district || ''}`)
        if (!hay.includes(fq)) return false
      }
      return true
    })
  }, [listings, searchable, q, cat, type])

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
      {/* Search + filter within this seller's catalog */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-xl bg-tint px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-ink-4" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tr('Search this seller', 'Tìm trong tin của người bán')}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-ink-4"
          />
        </div>
        {cats.length > 1 && (
          <CustomSelect
            value={cat}
            onChange={setCat}
            options={[{ value: 'all', label: tr('All categories', 'Tất cả danh mục') }, ...cats.map((c) => ({ value: c.slug, label: c.label }))]}
            placeholder={tr('Category', 'Danh mục')}
            activeClassName="text-accent-foreground"
            wrapperClassName="w-auto shrink-0 min-w-[9rem]"
          />
        )}
        {types.length > 1 && (
          <CustomSelect
            value={type}
            onChange={setType}
            options={[{ value: 'all', label: tr('Any type', 'Mọi loại') }, ...types.map((t) => ({ value: t.value, label: lang === 'vi' ? t.labelVi : t.label }))]}
            placeholder={tr('Type', 'Loại')}
            activeClassName="text-accent-foreground"
            wrapperClassName="w-auto shrink-0 min-w-[8rem]"
          />
        )}
      </div>

      {shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{tr('No listings match.', 'Không có tin nào khớp.')}</p>
      ) : (
        grid
      )}
    </div>
  )
}
