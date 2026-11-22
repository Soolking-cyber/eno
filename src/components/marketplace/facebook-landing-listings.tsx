'use client'

import { useRouter } from 'next/navigation'
import { ListingCard } from './listing-card'
import { LISTING_GRID } from './listing-grid'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/context/language-context'
import type { SerializedListingCard } from '@/lib/types'

/**
 * The Facebook-import ad landing's live listings (owner 2026-11-22 "go": listings first, sign-in on the tap): what is for sale on
 * eno.vn right now, so a Marketplace seller sees a real, busy marketplace before anything is asked. The server passes the home
 * page's own trending rail (src/app/[lang]/post/facebook/page.tsx), so these are the cards the home page shows, in the goods
 * sheet's calm two-column grid (ListingCard `look="tile"`, as the PDP's phone grid). Nothing when fewer than two came back.
 */
export function FacebookLandingListings({ listings }: { listings: SerializedListingCard[] }) {
  const router = useRouter()
  const { tr } = useLanguage()
  if (listings.length < 2) return null
  return (
    <section className="mt-10" aria-labelledby="fb-landing-listings">
      <h2 id="fb-landing-listings" className="h-section text-foreground">{tr('For sale on eno.vn', 'Đang bán trên eno.vn')}</h2>
      {/* The site's listing grid (2 / 3 / 4 across), which the card's photo `sizes` are derived from. Eight come in: six below lg
          (three rows of two, two of three), two full rows of four from lg. */}
      <div className={cn(LISTING_GRID, 'mt-3 max-lg:[&>:nth-child(n+7)]:hidden')}>
        {listings.map((l) => (
          <ListingCard key={l.id} listing={l} clockInHtml={false} look="tile" onOpen={(x) => router.push(`/listings/${x.id}`)} />
        ))}
      </div>
    </section>
  )
}
