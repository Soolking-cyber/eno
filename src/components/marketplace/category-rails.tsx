'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import type { SerializedCategory, SerializedListing } from '@/lib/types'
import { ListingCard } from './listing-card'
import { CategoryIcon } from './category-icons'
import { useLanguage } from '@/context/language-context'

const FILTER_KEYS = ['category', 'q', 'brand', 'subcategory', 'type', 'district', 'province', 'ward', 'condition', 'priceMin', 'priceMax']

type Rail = { slug: string; listings: SerializedListing[] }

const CARD_W = 'w-[calc((100%-0.5rem)/2)] shrink-0 snap-start sm:w-[calc((100%-2rem)/3)] lg:w-[calc((100%-3rem)/4)]'

/** One category rail. The cards (and therefore their images) only mount once the rail
 *  scrolls near the viewport — with up to ~10 rails on the home page, mounting every
 *  card up front flooded the page with images. A same-height skeleton holds the space
 *  so there's no layout shift. */
function CategoryRail({ cat, listings, onCategory }: { cat: SerializedCategory; listings: SerializedListing[]; onCategory: (slug: string) => void }) {
  const { lang, tr } = useLanguage()
  const router = useRouter()
  const rowRef = useRef<HTMLDivElement>(null)
  const [show, setShow] = useState(false)

  useEffect(() => {
    const el = rowRef.current
    if (!el || show) return
    const io = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) { setShow(true); io.disconnect() } },
      { rootMargin: '400px 0px' }, // mount just before it scrolls in
    )
    io.observe(el)
    return () => io.disconnect()
  }, [show])

  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <button onClick={() => onCategory(cat.slug)} className="group flex items-center gap-2 cursor-pointer">
          <CategoryIcon name={cat.icon} className="h-4 w-4 text-body group-hover:text-accent-foreground" />
          <h2 className="text-base font-bold text-foreground transition-colors group-hover:text-accent-foreground">
            {lang === 'vi' ? cat.nameVi : cat.name}
          </h2>
        </button>
        <button onClick={() => onCategory(cat.slug)} className="flex shrink-0 items-center gap-0.5 text-sm font-semibold text-accent-foreground hover:underline cursor-pointer">
          {tr('See all', 'Xem tất cả')}
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      {/* Cards pixel-match the feed grid (gap-2 / sm:gap-4; one card == one grid column) + snap. */}
      <div ref={rowRef} className="flex gap-2 overflow-x-auto scrollbar-none snap-x sm:gap-4">
        {show
          ? listings.map((l) => (
              <div key={l.id} className={CARD_W}>
                <ListingCard
                  listing={l}
                  onOpen={(x) => router.push(`/listings/${x.id}`)}
                  onLocate={() => window.dispatchEvent(new CustomEvent('eno:locate', { detail: { id: l.id, listing: l } }))}
                />
              </div>
            ))
          : // Same-size skeletons hold the row height until it mounts (no images, no shift).
            Array.from({ length: Math.min(listings.length, 4) }).map((_, i) => (
              <div key={i} className={`${CARD_W} space-y-3`}>
                <div className="aspect-[4/3] w-full rounded-xl shimmer" />
                <div className="h-4 w-2/3 rounded shimmer" />
                <div className="h-3 w-1/2 rounded shimmer" />
              </div>
            ))}
      </div>
    </section>
  )
}

/** "Browse by category" — one horizontal rail per category, ordered by live demand so
 *  the most-used category leads (mirrors the category-icon hierarchy). Sits below the
 *  For You + Outstanding businesses rails on the home landing view; hides the moment a
 *  filter/search is active. */
export function CategoryRails({ categories, onCategory }: { categories: SerializedCategory[]; onCategory: (slug: string) => void }) {
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
  if (rails === null) return null // wait for data; the feed below already fills the page

  return (
    <div className="space-y-7">
      {rails.map((rail) => {
        const cat = bySlug.get(rail.slug)
        if (!cat || rail.listings.length === 0) return null
        return <CategoryRail key={rail.slug} cat={cat} listings={rail.listings} onCategory={onCategory} />
      })}
    </div>
  )
}
