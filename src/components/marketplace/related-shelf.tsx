'use client'

import { memo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { LayoutGrid } from '@/components/ui/icons'
import type { SerializedListingCard } from '@/lib/types'
import type { RelatedRail } from '@/lib/core/related-rail'
import { useLanguage } from '@/context/language-context'
import { ListingCard } from './listing-card'
import { Shelf, RAIL_CARD_W, MIN_RAIL_ITEMS } from './shelf'
import { locateFromRail } from './for-you-rail'

/**
 * "MORE IN <CATEGORY> · <SUBCATEGORY>" UNDER A SPARSE SEARCH (UI climb 2026-11-09, hunt #9) — more of the answer's kind, which
 * /api/listings sent WITH the answer (src/lib/core/related-rail.ts). Static: it renders the cards it is given and fetches
 * nothing, so it never changes after it paints (the explorer decides it once per answer, use-recovery-rail.ts). Cards
 * exactly as ForYouRail draws them (RAIL_CARD_W, the same open and "show on map"), so the two read as one family. No
 * "See all": Trending has none either, and the category is one tap away in the explorer's own chips.
 */
export const RelatedShelf = memo(function RelatedShelf({ related }: { related: RelatedRail }) {
  const { tr } = useLanguage()
  const router = useRouter()
  const openListing = useCallback((x: SerializedListingCard) => router.push(`/listings/${x.id}`), [router])
  if (related.listings.length < MIN_RAIL_ITEMS) return null
  // ⚠️ ONE TEMPLATE WITH A `{category}` SLOT, filled AFTER translation (same-seller-shelf.tsx's rule): a machine-translated
  // language can lose the slot, and a title with no category name says nothing — so it falls back to the English template.
  // The replacer is a function, so a `$` in a name is never read as a replacement pattern.
  const template = tr('More in {category}', 'Tin khác trong mục {category}')
  // The subcategory beside its category: the taxonomy's subcategory names are short labels ("Motorbike", "Gear").
  const name = `${tr(related.name, related.nameVi)} · ${tr(related.subName, related.subNameVi)}`
  const title = (template.includes('{category}') ? template : 'More in {category}').replace('{category}', () => name)
  return (
    <Shelf icon={LayoutGrid} title={title}>
      {related.listings.map((l) => (
        <div key={l.id} data-sid={l.sellerId} className={RAIL_CARD_W}>
          <ListingCard listing={l} onOpen={openListing} onLocate={locateFromRail} />
        </div>
      ))}
    </Shelf>
  )
})
