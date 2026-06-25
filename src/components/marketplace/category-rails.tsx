'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import type { SerializedCategory, SerializedListing } from '@/lib/types'
import { ListingCard } from './listing-card'
import { CategoryIcon } from './category-icons'
import { useLanguage } from '@/context/language-context'

const FILTER_KEYS = ['category', 'q', 'brand', 'subcategory', 'type', 'district', 'province', 'ward', 'condition', 'priceMin', 'priceMax']

type Rail = { slug: string; listings: SerializedListing[] }

/** "Browse by category" — one horizontal rail per category, ordered by live demand so
 *  the most-used category leads (mirrors the category-icon hierarchy). Sits below the
 *  For You + Outstanding businesses rails on the home landing view; hides the moment a
 *  filter/search is active (the explorer is then showing focused results). */
export function CategoryRails({ categories, onCategory }: { categories: SerializedCategory[]; onCategory: (slug: string) => void }) {
  const { lang, tr } = useLanguage()
  const router = useRouter()
  const [rails, setRails] = useState<Rail[] | null>(null)
  const [active, setActive] = useState(true) // default (unfiltered) home view?

  const bySlug = useMemo(() => new Map(categories.map((c) => [c.slug, c])), [categories])

  useEffect(() => {
    let off = false
    fetch('/api/category-rails')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!off && d) setRails(d.rails || []) })
      .catch(() => { if (!off) setRails([]) })
    return () => { off = true }
  }, [])

  // Hide when the feed is filtered/searched (same signal the For You rail uses).
  useEffect(() => {
    const check = () => {
      const p = new URLSearchParams(window.location.search)
      const filtered = FILTER_KEYS.some((k) => p.has(k)) || Array.from(p.keys()).some((k) => k.startsWith('attr_') || k.startsWith('range_'))
      setActive(!filtered)
    }
    check()
    window.addEventListener('eno:query', check)
    window.addEventListener('popstate', check)
    return () => { window.removeEventListener('eno:query', check); window.removeEventListener('popstate', check) }
  }, [])

  if (!active) return null
  if (rails !== null && rails.length === 0) return null

  return (
    <div className="space-y-7">
      {rails === null
        ? // One placeholder rail while loading (matches the real rail shape).
          Array.from({ length: 2 }).map((_, r) => (
            <section key={r}>
              <div className="mb-2.5 h-5 w-40 rounded shimmer" />
              <div className="flex gap-2 overflow-hidden sm:gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="w-[calc((100%-0.5rem)/2)] shrink-0 space-y-3 sm:w-[calc((100%-2rem)/3)] lg:w-[calc((100%-3rem)/4)]">
                    <div className="aspect-[4/3] w-full rounded-xl shimmer" />
                    <div className="h-4 w-2/3 rounded shimmer" />
                    <div className="h-3 w-1/2 rounded shimmer" />
                  </div>
                ))}
              </div>
            </section>
          ))
        : rails.map((rail) => {
            const cat = bySlug.get(rail.slug)
            if (!cat || rail.listings.length === 0) return null
            return (
              <section key={rail.slug}>
                <div className="mb-2.5 flex items-center justify-between gap-2">
                  <button onClick={() => onCategory(rail.slug)} className="group flex items-center gap-2 cursor-pointer">
                    <CategoryIcon name={cat.icon} className="h-4 w-4 text-accent-foreground" />
                    <h2 className="text-base font-bold text-foreground transition-colors group-hover:text-accent-foreground">
                      {lang === 'vi' ? cat.nameVi : cat.name}
                    </h2>
                  </button>
                  <button onClick={() => onCategory(rail.slug)} className="flex shrink-0 items-center gap-0.5 text-sm font-semibold text-accent-foreground hover:underline cursor-pointer">
                    {tr('See all', 'Xem tất cả')}
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
                {/* Cards pixel-match the feed grid (gap-2 / sm:gap-4; one card == one grid
                    column) and snap, exactly like the For You rail. */}
                <div className="flex gap-2 overflow-x-auto scrollbar-none snap-x sm:gap-4">
                  {rail.listings.map((l) => (
                    <div key={l.id} className="w-[calc((100%-0.5rem)/2)] shrink-0 snap-start sm:w-[calc((100%-2rem)/3)] lg:w-[calc((100%-3rem)/4)]">
                      <ListingCard
                        listing={l}
                        onOpen={(x) => router.push(`/listings/${x.id}`)}
                        onLocate={() => window.dispatchEvent(new CustomEvent('eno:locate', { detail: { id: l.id, listing: l } }))}
                      />
                    </div>
                  ))}
                </div>
              </section>
            )
          })}
    </div>
  )
}
