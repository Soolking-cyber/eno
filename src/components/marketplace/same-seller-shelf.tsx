'use client'

import { useRouter } from 'next/navigation'
import { ListingCard } from './listing-card'
import { Shelf, RAIL_CARD_W } from './shelf'
import { JobRailRows } from './job-rail-rows'
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
   * {name}" for every rail, which fits a board as well as a shop, so it is unchanged (but for an employer's own board since
   * batch 95, below). Read off the cards, so the PDP and the sold page need not pass anything.
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
  /**
   * ⛔ "More from this employer" / "Tin khác từ nhà tuyển dụng này" WHEN THE STOREFRONT IS THE EMPLOYER (UI climb batch 95,
   * owner-approved 2026-11-14, decision 3, "the job page says it once"): on Nord Anglia's own board every card is a Nord Anglia
   * job, and the page's employer link already names it. Decided from the cards' DATA, never from the page — every card's
   * `jobEmployer` (linked jobs only, serialize.ts) is the storefront's name, Unicode form, spacing and case aside — so the sold
   * page agrees without a prop. An aggregator's rail (LinkedIn, CareerLink…) mixes employers and keeps "More jobs from
   * <board>"; an employer's own posts carry no jobEmployer and keep today's title.
   */
  const key = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
  const ownEmployer = allJobs && key(sellerName) !== '' && listings.every((l) => typeof l.jobEmployer === 'string' && key(l.jobEmployer) === key(sellerName))

  return (
    // Shelf's SECTION_TITLE already carries the app-wide text-lg font-semibold header tier,
    // matching the page's section headers and the "More like this" shelf below it.
    <Shelf
      title={ownEmployer ? tr('More from this employer', 'Tin khác từ nhà tuyển dụng này') : allJobs ? jobsTitle : tr('More from this seller', `Tin khác từ ${sellerName}`)}
      seeAllHref={sellerHref}
      sectionClassName="mt-12"
      watch={listings.length}
      // A job page's rail is rows on a phone (batch 67), like the Jobs list. Server data: the rows are in the HTML.
      phoneRows={allJobs ? <JobRailRows listings={listings} /> : undefined}
    >
      {listings.map((l) => (
        <div key={l.id} data-sid={l.sellerId} className={RAIL_CARD_W}>
          <ListingCard listing={l} clockInHtml={false} onOpen={(x) => router.push(`/listings/${x.id}`)} />
        </div>
      ))}
    </Shelf>
  )
}
