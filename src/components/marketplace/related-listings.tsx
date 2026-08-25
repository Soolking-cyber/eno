'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ListingCard } from './listing-card'
import { Shelf, RAIL_CARD_W } from './shelf'
import { useLanguage } from '@/context/language-context'
import { useNearViewport } from '@/hooks/use-near-viewport'
import type { SerializedListingCard } from '@/lib/types'

/** "More like this" rail on the listing page — current listing excluded. Fetched CLIENT-side so
 *  the ISR-cached page HTML stays fresh + light, and only once the shelf is ~a viewport away
 *  (IO-gated) so this below-fold call never competes with the gallery LCP image for bandwidth.
 *  Uses the STANDARD grid-matched card size (2/3/4 per view, like the home rails +
 *  "Recently viewed") so all rails read as one family. */
export function RelatedListings({ listingId, categorySlug, subcategorySlug, brandSlug }: {
  listingId: string; categorySlug: string; subcategorySlug?: string | null; brandSlug?: string | null
}) {
  const router = useRouter()
  const { tr } = useLanguage()
  const [items, setItems] = useState<SerializedListingCard[]>([])
  const { ref, near } = useNearViewport<HTMLDivElement>()

  /**
   * ⛔ NARROW TO WIDE, NOT CATEGORY-ONLY. This asked for `category=electronics` and nothing else,
   * so a SMARTWATCH page filled its "More like this" rail with the newest televisions — owner,
   * 2026-08-25: "i selected a watch and more like this shows unrelated things at least same
   * subcat if no exact produt or same brand model". A category is far too coarse on a catalogue
   * where "electronics" spans 7,856 listings from a screen protector to an 85-inch TV.
   *
   * Three passes, stopping as soon as there are enough: same subcategory AND brand (a Galaxy Watch
   * next to other Galaxy Watches), then same subcategory (any watch), then the old category-wide
   * behaviour so a thin subcategory still fills the rail rather than showing an empty shelf.
   * ⚠️ Results ACCUMULATE and dedupe, so a wider pass only ever tops up what a narrower one found
   * — the closest matches keep their place at the front of the rail.
   */
  useEffect(() => {
    if (!near) return
    let off = false
    const ENOUGH = 8
    // ⚠️ EVERY SCOPE CARRIES THE CATEGORY. Subcategory slugs are not globally unique — "accessories"
    // exists under more than one category — so a subcategory-only query can pull in another
    // category's listings, which is the same class of bug this rail is being fixed for.
    const cat = `category=${encodeURIComponent(categorySlug)}`
    const scopes = [
      subcategorySlug && brandSlug ? `${cat}&subcategory=${encodeURIComponent(subcategorySlug)}&brand=${encodeURIComponent(brandSlug)}` : null,
      subcategorySlug ? `${cat}&subcategory=${encodeURIComponent(subcategorySlug)}` : null,
      cat,
    ].filter(Boolean) as string[]

    ;(async () => {
      const seen = new Map<string, SerializedListingCard>()
      for (const scope of scopes) {
        if (off || seen.size >= ENOUGH) break
        try {
          const r = await fetch(`/api/listings?${scope}&limit=12&sort=newest`)
          const d = await r.json()
          for (const l of (d.listings || []) as SerializedListingCard[]) {
            if (l.id !== listingId && !seen.has(l.id)) seen.set(l.id, l)
          }
        } catch { /* a failed pass just means the next, wider one fills the rail */ }
      }
      if (!off) setItems([...seen.values()].slice(0, 10))
    })()
    return () => { off = true }
  }, [near, categorySlug, subcategorySlug, brandSlug, listingId])

  // Sentinel: the observer needs a node in the layout before there is data. Out of flow
  // (absolute, zero-size) so it can never earn spacing from a space-y/gap parent; IO still
  // fires on zero-area targets at threshold 0. NOT `hidden` — that never intersects.
  if (items.length === 0) return <div ref={ref} aria-hidden="true" className="absolute h-0 w-0" />

  return (
    // Shelf's SECTION_TITLE already carries the app-wide text-lg font-semibold header tier;
    // the See-all into the category page gives every PDP shelf the same header + See-all shape.
    <Shelf
      title={tr('More like this', 'Tin tương tự')}
      seeAllHref={`/c/${categorySlug}`}
      sectionClassName="mt-12"
      watch={items.length}
    >
      {items.map((l) => (
        <div key={l.id} className={RAIL_CARD_W}>
          <ListingCard listing={l} onOpen={(x) => router.push(`/listings/${x.id}`)} />
        </div>
      ))}
    </Shelf>
  )
}
