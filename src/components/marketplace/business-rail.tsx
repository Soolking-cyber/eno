'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BadgeCheck } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { TrustScore } from './trust-score'

type Business = {
  id: string
  name: string
  avatarUrl: string | null
  avatarColor: string
  trustScore: number
  trustTier: string
  location: string | null
  reviewCount: number
  listingCount: number
}

/** "Outstanding businesses" — a horizontal rail of the highest-trust business
 *  storefronts, below the For You rail on the home view. Each card links to the
 *  storefront. Hides itself when there are none. */
export function BusinessRail() {
  const { tr } = useLanguage()
  const [items, setItems] = useState<Business[] | null>(null)

  useEffect(() => {
    fetch('/api/businesses/top')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setItems(d.businesses || []) })
      .catch(() => {})
  }, [])

  if (items !== null && items.length === 0) return null

  return (
    <section className="mb-7">
      <div className="mb-2.5 flex items-center gap-2">
        <BadgeCheck className="h-4 w-4 text-accent-foreground" />
        <h2 className="text-base font-bold text-foreground">{tr('Outstanding businesses', 'Doanh nghiệp nổi bật')}</h2>
      </div>
      <div className="flex gap-3 overflow-x-auto scrollbar-none snap-x">
        {items === null
          ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[168px] w-[150px] shrink-0 snap-start rounded-2xl shimmer" />)
          : items.map((b) => (
              <Link
                key={b.id}
                href={`/sellers/${b.id}`}
                className="group flex w-[150px] shrink-0 snap-start flex-col items-center gap-2 rounded-2xl bg-card p-4 text-center shadow-sm transition-colors hover:bg-muted"
              >
                {b.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" loading="lazy" />
                ) : (
                  <span className="flex h-16 w-16 items-center justify-center rounded-full text-lg font-bold text-white" style={{ backgroundColor: b.avatarColor }}>
                    {b.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 w-full">
                  <p className="truncate text-sm font-bold text-foreground">{b.name}</p>
                  {b.location && <p className="truncate text-[11px] text-muted-foreground">{b.location}</p>}
                </div>
                <TrustScore score={b.trustScore} size="sm" showLabel />
              </Link>
            ))}
      </div>
    </section>
  )
}
