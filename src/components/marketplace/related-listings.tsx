'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ListingCard } from './listing-card'
import { ListingCardSkeleton } from './listing-card-skeleton'
import { categoryBrowsePath } from '@/lib/retired-categories'
import { Shelf, RAIL_CARD_W, RAIL_SKELETON_COUNT } from './shelf'
import { JobRailRows, JobRailRowsSkeleton, allJobs } from './job-rail-rows'
import { useLanguage } from '@/context/language-context'
import { localizedHref } from '@/lib/lang-pinned'
import { variantOfLanguage } from '@/lib/lang-variant'
import { useNearViewport } from '@/hooks/use-near-viewport'
import { PLACES_KIND_PARAM, VEHICLE_RENTAL_SUBCATS } from '@/lib/rental-places'
import type { SerializedListingCard } from '@/lib/types'

/** "More like this" rail on the listing page — current listing excluded. Fetched CLIENT-side so
 *  the ISR-cached page HTML stays fresh + light, and only once the shelf is ~a viewport away
 *  (IO-gated) so this below-fold call never competes with the gallery LCP image for bandwidth.
 *  Uses the STANDARD grid-matched card size (2/3/4 per view, like the home rails +
 *  "Recently viewed") so all rails read as one family. */
export function RelatedListings({ listingId, categorySlug, subcategorySlug, brandSlug, model, excludeSellerId, variant = 'pdp' }: {
  listingId: string; categorySlug: string; subcategorySlug?: string | null; brandSlug?: string | null
  /** The catalogue model ("A6c"). Read by the 'gone' variant only, whose first pass is brand + model. */
  model?: string | null
  /**
   * ⚠️ SET ONLY WHEN THE "More from this seller" RAIL IS ACTUALLY ON THE PAGE (it renders nothing under
   * two listings). A single-seller shelf — every tickets-travel row is VinWonders — otherwise drew the
   * same twelve cards twice, one rail under the other. Leaving the seller's rows out of THIS rail keeps
   * the two disjoint; if that empties it, it renders nothing, which is the point.
   */
  excludeSellerId?: string | null
  /** 'sold': the shelf on the sold page, where the item itself is gone — hence its own title.
   *  'gone': the shelf on the gone page (gone-listing.tsx) — SECOND-HAND rows only; see the scopes below. */
  variant?: 'pdp' | 'sold' | 'gone'
}) {
  const router = useRouter()
  const { tr, lang } = useLanguage()
  // null = not answered yet (the sold page holds the rail's place until then — see below).
  const [items, setItems] = useState<SerializedListingCard[] | null>(null)
  // Which question the cards on screen answer (everything the requests depend on except the language): see the merge below.
  const shownFor = useRef<string | null>(null)
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
   * ⚠️ ALL PASSES ARE ASKED AT ONCE, AND MERGED IN PASS ORDER, NOT ARRIVAL ORDER. Awaited one after another, two or
   * three edge misses (~0.5 s each, 0 HITs in 46 measured) held the skeleton for a second or more. The merge below
   * stops at the same point the old loop did, so the cards and their order are the same; the cost is a wider
   * request started for nothing when a narrow one already filled the rail (2 more requests in 40, on 19 live
   * listings). It is cancelled as soon as the merge stops, and every request still out is cancelled when the effect
   * is cleaned up (unmount, another listing, a language switch).
   */
  useEffect(() => {
    if (!near) return
    let off = false
    // One controller for this run's requests: aborted when the merge stops (passes it no longer needs) and on cleanup.
    const ac = new AbortController()
    const ENOUGH = 8
    // ⚠️ EVERY SCOPE CARRIES THE CATEGORY. Subcategory slugs are not globally unique — "accessories"
    // exists under more than one category — so a subcategory-only query can pull in another
    // category's listings, which is the same class of bug this rail is being fixed for.
    const cat = `category=${encodeURIComponent(categorySlug)}`
    // ⛔ RENTALS HOLD HOMES AND VEHICLE HIRE IN ONE CATEGORY (rental-places.ts). The plain-category pass filled a GoPlus
    // flat's rail with Toyota and Yamaha hire, 6 of 7 cards (sweep 2026-10-22): a place widens to places only
    // (`kind=places`, which keeps a place with no subcategory too), and vehicle hire does not widen at all — its own
    // subcategory fills the rail.
    const isRentals = categorySlug === 'rentals'
    const vehicleHire = isRentals && !!subcategorySlug && VEHICLE_RENTAL_SUBCATS.includes(subcategorySlug)
    const wide = vehicleHire ? null : isRentals ? `${cat}&${PLACES_KIND_PARAM.key}=${PLACES_KIND_PARAM.value}` : cat
    const scopes = (variant === 'gone'
      /**
       * ⛔ THE GONE PAGE OFFERS SECOND-HAND ONLY: `condition=used` on EVERY pass (the feed's one definition
       * of used, src/lib/listing-condition.ts — which also keeps out anything with no condition, services
       * and jobs included). The feed itself is verified + active + edition-scoped (buildFeedFilters), so
       * nothing here can surface a desk listing on eno.vn. Narrowest first, as below: the same model
       * (brand + model), then the same shelf with its brand first, then the shelf, then the category.
       * ⛔ THE CATEGORY-WIDE PASS ONLY WHEN THE ROW HAS A SHELF OR A BRAND. 48,005 of the 74,132 gone rows (mostly
       * Tiki) carry neither and are often mis-filed — books, shoes and detergent under 'electronics' — so a
       * category-only pass would title the newest used electronics "similar". With nothing to match on, the rail
       * stays empty and the page offers the search link alone (gone-listing.tsx).
       */
      ? [
          brandSlug && model ? `${cat}&brand=${encodeURIComponent(brandSlug)}&model=${encodeURIComponent(model)}` : null,
          subcategorySlug && brandSlug ? `${cat}&subcategory=${encodeURIComponent(subcategorySlug)}&brand=${encodeURIComponent(brandSlug)}` : null,
          subcategorySlug ? `${cat}&subcategory=${encodeURIComponent(subcategorySlug)}` : null,
          // A brand but no shelf: the brand within its category — never the plain category (gate, 2026-10-05).
          !subcategorySlug && brandSlug ? `${cat}&brand=${encodeURIComponent(brandSlug)}` : null,
          subcategorySlug ? cat : null,
        ].filter(Boolean).map((s) => `${s}&condition=used`)
      : [
          subcategorySlug && brandSlug ? `${cat}&subcategory=${encodeURIComponent(subcategorySlug)}&brand=${encodeURIComponent(brandSlug)}` : null,
          subcategorySlug ? `${cat}&subcategory=${encodeURIComponent(subcategorySlug)}` : null,
          wide,
        ].filter(Boolean)) as string[]

    /**
     * `facets=0`: the rail reads rows only, so an edge miss skips the chip-count aggregates — which matters more now
     * that two or three misses reach the 20-connection pool together. `lang`: only the reader's own title
     * translation instead of all nine (none for en/vi, whose rows carry both titles), so the URL varies with it and
     * the effect re-asks when the reader switches language in place.
     * A failed pass answers null, which just means the next, wider one fills the rail. The `.catch` is on each request
     * as it is made: a wider pass failing (or cancelled: an aborted fetch rejects too) while a narrower one is still
     * awaited would otherwise surface as an unhandled rejection.
     */
    const passes = scopes.map((scope) =>
      fetch(`/api/listings?${scope}&limit=12&sort=newest&facets=0&lang=${lang}`, { signal: ac.signal })
        .then((r) => r.json())
        .catch(() => null))
    ;(async () => {
      const seen = new Map<string, SerializedListingCard>()
      // Whether any pass came back with rows to read (an empty list counts): a failed or cancelled one did not.
      let answered = false
      try {
        for (const pass of passes) {
          if (seen.size >= ENOUGH) break
          const d = await pass
          if (off) return
          if (Array.isArray(d?.listings)) answered = true
          try {
            for (const l of (d?.listings || []) as SerializedListingCard[]) {
              if (l.id !== listingId && (!excludeSellerId || l.sellerId !== excludeSellerId) && !seen.has(l.id)) seen.set(l.id, l)
            }
          } catch { /* a malformed pass is skipped like a failed one */ }
        }
      } finally {
        ac.abort()
      }
      if (off) return
      const next = [...seen.values()].slice(0, 10)
      /**
       * ⚠️ NOTHING ANSWERED, KEEP WHAT IS SHOWN — FOR THE SAME QUESTION ONLY. A language switch re-runs this with cards
       * already up; offline or on a 5xx every pass fails, and replacing them with [] would empty a rail that was fine.
       * A different listing, category, brand, model, seller or variant is a different question: when its requests fail,
       * the previous answer must not stay (another listing's rail, or cards this one excludes), so it settles as the
       * empty rail, as a first load with no answer does (the skeleton must not wait forever).
       */
      const question = JSON.stringify([listingId, categorySlug, subcategorySlug, brandSlug, model, variant, excludeSellerId])
      const sameQuestion = shownFor.current === question
      if (answered) shownFor.current = question
      setItems((shown) => (answered || shown === null || !sameQuestion ? next : shown))
    })()
    return () => {
      off = true
      ac.abort()
    }
  }, [near, categorySlug, subcategorySlug, brandSlug, model, variant, listingId, excludeSellerId, lang])

  const title = variant === 'gone'
    ? tr('Similar second-hand listings', 'Tin tương tự đã qua sử dụng')
    : variant === 'sold' ? tr('Similar items still available', 'Tin tương tự vẫn còn bán') : tr('More like this', 'Tin tương tự')
  /* The sold and gone pages' rail sits right under the item's name on a phone (sold-listing.tsx,
     gone-listing.tsx): mt-12 there kept the first card under the tab bar. */
  const sectionClassName = variant === 'pdp' ? 'mt-12' : 'mt-4 sm:mt-12'
  // "See all" keeps a Vietnamese reader in Vietnamese, like the sold page's own "Browse this category" and
  // the PDP's brand chip: a bare '/c/…' or '/?category=…' can be an English-pinned pilot path (lang-pinned.ts).
  // The gone rail is second-hand only, so its "See all" is too (gate, 2026-10-05).
  // (The explorer itself, where `condition` is a filter — a /c hub is a landing page.)
  const seeAllHref = localizedHref(variant === 'gone' ? `/?category=${encodeURIComponent(categorySlug)}&condition=used` : categoryBrowsePath(categorySlug), variantOfLanguage(lang))

  /**
   * ⛔ ON THE SOLD PAGE THE RAIL'S PLACE IS HELD WHILE IT LOADS. Below sm it is the first thing under the
   * sold item, ABOVE the seller · category · Home buttons (sold-listing.tsx), so a rail arriving from
   * nothing pushed those buttons a whole card height down, under a thumb already on its way to one.
   * The placeholder is the loaded shelf's own shape (title, ListingCardSkeleton at RAIL_CARD_W) and it
   * is in the SSR HTML. An empty answer still collapses to nothing — rare, the last pass is the whole
   * category.
   * ⛔ THE PDP'S RAIL TOO (2026-11-03). It is the last thing above the footer, and by "below the fold" its
   * zero-size sentinel let a reader reach the footer first: measured on production, 0.22 of CLS on a phone,
   * the footer thrown 350px down with nobody touching the page.
   */
  // The gone page's rail is the same case: the first thing under the item's name, with the search link below it.
  // The gone rail with nothing to match on (no shelf, no brand — see the passes above) asks for nothing, so it
  // renders nothing from the first frame instead of flashing its "similar" heading over a placeholder.
  if (variant === 'gone' && !subcategorySlug && !brandSlug) return <div ref={ref} aria-hidden="true" className="absolute h-0 w-0" />
  if (items === null) {
    return (
      <div ref={ref} data-related-loading="">
        {/* A job's rail loads as rows on a phone (batch 67), so its placeholder is rows there too: the category is known before the answer. */}
        <Shelf title={title} seeAllHref={seeAllHref} sectionClassName={sectionClassName} phoneRows={categorySlug === 'jobs' ? <JobRailRowsSkeleton /> : undefined}>
          {Array.from({ length: RAIL_SKELETON_COUNT }).map((_, i) => <ListingCardSkeleton key={i} className={RAIL_CARD_W} />)}
        </Shelf>
      </div>
    )
  }

  // Sentinel: the observer needs a node in the layout before there is data. Out of flow
  // (absolute, zero-size) so it can never earn spacing from a space-y/gap parent; IO still
  // fires on zero-area targets at threshold 0. NOT `hidden` — that never intersects.
  if (!items || items.length === 0) return <div ref={ref} aria-hidden="true" className="absolute h-0 w-0" />

  return (
    // Shelf's SECTION_TITLE already carries the app-wide text-lg font-semibold header tier;
    // the See-all into the category page gives every PDP shelf the same header + See-all shape.
    <Shelf
      title={title}
      seeAllHref={seeAllHref}
      sectionClassName={sectionClassName}
      watch={items.length}
      phoneRows={allJobs(items) ? <JobRailRows listings={items} /> : undefined}
    >
      {items.map((l) => (
        <div key={l.id} data-sid={l.sellerId} className={RAIL_CARD_W}>
          <ListingCard listing={l} onOpen={(x) => router.push(`/listings/${x.id}`)} />
        </div>
      ))}
    </Shelf>
  )
}
