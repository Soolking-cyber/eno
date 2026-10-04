'use client'

import { useRouter } from 'next/navigation'
import { ListingCard } from './listing-card'
import { Shelf, RAIL_CARD_W } from './shelf'
import { useLanguage } from '@/context/language-context'
import type { SerializedListingCard } from '@/lib/types'

/**
 * "More from this seller" rail on the PDP. Same grid-matched card sizing + snap
 * behaviour as the other rails (RelatedListings / RecentlyViewed) so every rail
 * reads as one family. onLocate falls back to the card's default (`/?focus=`).
 * Renders NOTHING when the seller has fewer than two other listings.
 */
export function SameSellerShelf({
  listings,
  sellerHref,
  sellerName,
}: {
  listings: SerializedListingCard[]
  sellerHref: string
  sellerName: string
}) {
  const router = useRouter()
  const { tr } = useLanguage()
  if (listings.length < 2) return null
  /**
   * A job board is not a "seller" (rentals-14): when every card on the rail is a job, English names what
   * they are and whose they are — "More jobs from CareerLink.vn". Vietnamese already read "Tin khác từ
   * {name}" for every rail, which fits a board as well as a shop, so it is unchanged. Read off the cards,
   * so the PDP and the sold page need not pass anything.
   * ⚠️ ONE TEMPLATE WITH A `{name}` SLOT, filled AFTER translation: a quoted literal scripts/gen-ui-strings.mjs
   * can harvest, and a machine-translated language keeps its own word order around the name (glued
   * fragments forced English order on all of them). Filled with a REPLACER FUNCTION, so a `$&` or `$1` in a
   * shop's name prints as typed. ⚠️ AND A TRANSLATION THAT LOST THE SLOT FALLS BACK TO THE ENGLISH
   * TEMPLATE — the machine-translation layer does not protect `{…}` tokens (the rule Bilingual's `values`
   * already follows), and a title without the board's name, or with a raw token, says nothing.
   */
  const allJobs = listings.every((l) => l.category?.slug === 'jobs')
  // The literal stays INSIDE tr(): the harvester reads quoted arguments only.
  const jobsTemplate = tr('More jobs from {name}', 'Tin khác từ {name}')
  const jobsTitle = (jobsTemplate.includes('{name}') ? jobsTemplate : 'More jobs from {name}').replace('{name}', () => sellerName)

  return (
    // Shelf's SECTION_TITLE already carries the app-wide text-lg font-semibold header tier,
    // matching the page's section headers and the "More like this" shelf below it.
    <Shelf
      title={allJobs ? jobsTitle : tr('More from this seller', `Tin khác từ ${sellerName}`)}
      seeAllHref={sellerHref}
      sectionClassName="mt-12"
      watch={listings.length}
    >
      {listings.map((l) => (
        <div key={l.id} className={RAIL_CARD_W}>
          <ListingCard listing={l} onOpen={(x) => router.push(`/listings/${x.id}`)} />
        </div>
      ))}
    </Shelf>
  )
}
