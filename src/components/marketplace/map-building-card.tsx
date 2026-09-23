'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useLanguage } from '@/context/language-context'
import { isMockImageUrl } from '@/lib/listing-image'
import { glyphCountLabel } from '@/lib/listing-map-glyph'
import type { BuildingPin, SerializedListingCard } from '@/lib/types'
import { compactPrice, moneyLocale } from '@/lib/vnd'
import { LocalizedText } from './listing-content'
import { Price } from './price'

/**
 * THE CARD A BUILDING PIN OPENS: the project's own photograph, how many units are available in it,
 * what they cost, and a swipeable strip of the units themselves.
 *
 * ⛔ IT FETCHES ITS OWN UNITS, AND BOTH PLAN REVIEWERS INSISTED ON THAT INDEPENDENTLY. The obvious
 * shortcut is to read them out of the feed the left rail already holds — but this card opens on a
 * PIN CLICK, which is precisely the state where the reader has not drilled in: the feed then holds
 * one paginated page of the whole 19,359-row result set, of which this tower's units are an
 * arbitrary and usually empty subset. Even after drilling in it would be wrong, because the feed is
 * paginated and this card would show page 1 of N rather than the building. So it asks for exactly
 * what it draws.
 *
 * ⚠️ AND IT ASKS THROUGH THE ORDINARY FEED ENDPOINT — `/api/listings?building=<slug>` — rather than
 * a new one. `buildFeedFilters` already understands `building`, which is what the drill-in uses, so
 * reusing it means the card and the rail can never disagree about what belongs to a tower. A
 * dedicated route would be a second definition of the same question, which is the drift
 * /api/listings/buildings exists to warn about.
 */
export function MapBuildingCard({
  building,
  onOpenListing,
  onSeeAll,
  width,
  feedParams,
}: {
  building: BuildingPin
  onOpenListing: (l: SerializedListingCard) => void
  onSeeAll: (firstUnitId?: string) => void
  width: number
  /** The explorer's own feed query string — see the fetch below. */
  feedParams?: string
}) {
  const { tr, lang } = useLanguage()
  const [units, setUnits] = useState<SerializedListingCard[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    /**
     * ⚠️ ABORTED ON KEY CHANGE, not merely ignored. Tapping along a row of towers starts a request
     * per tower, and without this the slowest one wins whenever it lands last — the card would show
     * Masteri's units under Lumiere's name. The controller ties the response to the pin that asked.
     */
    const ac = new AbortController()
    setUnits(null)
    setFailed(false)
    /**
     * ⛔ THE VIEWER'S ACTIVE FILTERS GO WITH IT, AND BOTH REVIEWERS CAUGHT THAT THEY DID NOT. The
     * header's count and price range come from the PIN, which /api/listings/buildings computes over
     * the FILTERED result set. Asking for the units with a bare `building=` asked a different
     * question: filter to ≤5 tỷ, tap a tower, and the header read "3 apartments · 3–4 tỷ" above a
     * strip of twelve units at any price. Worse, the empty branch's copy — "No units match your
     * filters" — could only ever fire when the tower was empty outright, because the filtered-empty
     * case it names was showing the unfiltered twelve instead. Same params as the pin, so the two
     * halves of the card answer the same question.
     */
    const qs = new URLSearchParams(feedParams ?? '')
    qs.set('building', building.key)
    qs.set('limit', '12')
    fetch(`/api/listings?${qs.toString()}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { listings?: SerializedListingCard[] }) => setUnits(d.listings ?? []))
      .catch((e) => { if (e?.name !== 'AbortError') setFailed(true) })
    return () => ac.abort()
  }, [building.key, feedParams])

  const locale = moneyLocale(lang)
  const glyph = building.glyph ?? 'other'
  /**
   * ⚠️ `minPrice`/`maxPrice` ARRIVE FROM THE PIN AND WERE RENDERED NOWHERE UNTIL NOW, so treat them
   * as unproven: both are nullable (a project whose units are all POA), and a single-price tower
   * makes min === max, where a range would read as a mistake.
   */
  const range =
    building.minPrice === null || building.maxPrice === null
      ? null
      : building.minPrice === building.maxPrice
        ? compactPrice(building.minPrice, locale)
        : `${compactPrice(building.minPrice, locale)} – ${compactPrice(building.maxPrice, locale)}`

  return (
    <div className="overflow-hidden rounded-2xl bg-popover shadow-pop" style={{ width }}>
      {/* The project's own photograph — a developer render, not a unit photo, which is why it sits
          above the strip rather than inside it. */}
      <div className="relative aspect-[16/7] w-full bg-tint">
        {building.hero && (
          <Image
            src={building.hero}
            alt=""
            fill
            sizes="360px"
            quality={60}
            unoptimized={isMockImageUrl(building.hero) || undefined}
            className="object-cover"
          />
        )}
      </div>

      <div className="p-3">
        <p className="truncate text-sm font-semibold text-foreground">{building.name}</p>
        <p className="mt-0.5 text-xs text-body">
          {/* "12 apartments available" — the count is the building pin's own, i.e. the whole
              filtered result set, never the length of the strip below (which is capped at 12). */}
          {glyphCountLabel(glyph, building.count, lang)}
          {tr(' available', ' còn trống')}
          {building.district ? ` · ${building.district}` : ''}
        </p>
        {range && <p className="mt-0.5 text-xs font-semibold text-foreground">{range}</p>}

        <div className="mt-2.5">
          {units === null && !failed && (
            <div className="flex h-20 items-center justify-center"><Spinner /></div>
          )}
          {failed && (
            <p className="py-4 text-center text-xs text-ink-4">
              {tr('Could not load these units', 'Không tải được danh sách căn')}
            </p>
          )}
          {units && units.length > 0 && (
            /**
             * ⚠️ EMBLA VIA ui/carousel, NOT A HAND-ROLLED STRIP. The working agreement's order of
             * preference puts a purpose-built library second only to Base UI, and Base UI ships no
             * carousel — which is exactly why this primitive exists. It brings the drag/swipe and
             * the arrow controls the owner asked for, and the same keyboard behaviour the gallery
             * already has, instead of a second scroll-snap implementation to keep in step.
             */
            <Carousel opts={{ align: 'start', dragFree: true }} className="relative">
              <CarouselContent className="-ml-2">
                {units.map((u) => (
                  <CarouselItem key={u.id} className="basis-[132px] pl-2">
                    <Button
                      variant="bare"
                      size="none"
                      onClick={() => onOpenListing(u)}
                      className="block w-full cursor-pointer whitespace-normal text-left font-normal active:scale-100"
                    >
                      <span className="relative block aspect-[4/3] w-full overflow-hidden rounded-lg bg-tint">
                        {u.images[0] && (
                          <Image
                            src={u.images[0]}
                            alt=""
                            fill
                            sizes="132px"
                            quality={60}
                            unoptimized={isMockImageUrl(u.images[0]) || undefined}
                            className="object-cover"
                          />
                        )}
                      </span>
                      {/* Same order as <ListingCard>: price, then one line of title. */}
                      <Price native price={u.price} currency={u.currency} priceUnit={u.priceUnit} className="mt-1 block text-xs leading-tight" />
                      <span className="block truncate text-2xs text-body">
                        <LocalizedText text={u.title} vi={u.titleVi} i18n={u.titleI18n} />
                      </span>
                    </Button>
                  </CarouselItem>
                ))}
              </CarouselContent>
              {/* ⚠️ Inside the map's own stacking context, so they must clear the Leaflet panes. */}
              <CarouselPrevious className="left-0 z-[1200]" />
              <CarouselNext className="right-0 z-[1200]" />
            </Carousel>
          )}
          {units && units.length === 0 && (
            <p className="py-4 text-center text-xs text-ink-4">
              {tr('No units match your filters', 'Không có căn nào khớp bộ lọc')}
            </p>
          )}
        </div>

        {/* The way into the rail beside the map, where the full list is readable. */}
        {/* ⚠️ It must actually TAKE you there (reviewer): closing the card alone leaves a phone
            reader looking at the map with the list below the fold. Handing back the first unit lets
            the map reuse `onPinOpen`, the same machinery a pin tap uses to bring the feed to a
            card. */}
        {/* ⚠️ DISABLED UNTIL THE UNITS LAND (reviewer). Tapped while the spinner was up, `units` was
            null, so the id was undefined, the card closed and nothing scrolled — stranding the
            reader on the map with the list below the fold, the exact outcome this button exists to
            avoid. A button that cannot yet keep its promise should not be pressable. */}
        <Button variant="outline" size="sm" disabled={units === null || units.length === 0} onClick={() => onSeeAll(units?.[0]?.id)} className="mt-2.5 w-full">
          {tr('See all in this building', 'Xem tất cả trong toà này')}
        </Button>
      </div>
    </div>
  )
}
