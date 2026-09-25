'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SerializedListingCard } from '@/lib/types'
import { Tr, useLanguage, useTr } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Info, Map as MapIcon } from '@/components/ui/icons'
import { getListingCoordinates } from '@/lib/geo'
import { staticMapTiles, wantsRetinaTiles } from '@/lib/static-map'
import { OSM_CREDIT, CARTO_CREDIT } from '@/lib/map-credit'
import { handleExternalClick } from '@/lib/native-browser'

/**
 * THE PDP MAP ON A TOUCH SCREEN: a picture of the map, and a button that opens the real one.
 *
 * Owner, 2026-09-25: "product-page map on TOUCH devices becomes a static map image with the pin plus an
 * 'Open map' button that opens the interactive map full-screen … desktop keeps the live map".
 *
 * ⛔ WHY NOT THE LIVE MAP IN THE PAGE. Leaflet's container is `touch-action: none` — it has to be, to
 * pan — so a thumb that lands on it while scrolling the page moves the MAP instead: measured on eno.vn
 * (390x844, iPhone UA) a 200px drag started on the map scrolled the page 0px and panned the map 215px,
 * and the map is 366x260, a third of the usable screen, exactly where a thumb scrolling the PDP lands.
 * Mounting it mid-scroll also cost ~583 ms of main thread at 4x CPU. A picture has no gesture handling
 * at all, so the page scrolls through it like through a photo; the map a reader actually wants to pan
 * is one tap away and gets the whole screen, where panning cannot fight anything.
 *
 * ⚠️ THE PICTURE IS THE LIVE MAP'S OWN TILES (src/lib/static-map.ts): same CARTO source and key, same
 * zoom and centre as the live map lands on for one listing, same URLs — so there is no new API, and the
 * opened map starts from tiles that are already in the cache.
 *
 * ⚠️ THE WHOLE PICTURE IS THE BUTTON, AND THE CREDITS SIT BESIDE IT, NOT INSIDE IT. A tap anywhere on a
 * map preview means "open the map"; the visible "Open map" pill says so and is its accessible name. The
 * two OSM/CARTO credit links (a licence obligation — src/lib/map-credit.ts) cannot live inside a
 * <button> (nested interactive content is invalid and unreachable), so they are siblings painted above.
 */
export function ListingMapPreview({ listing, liveMap }: { listing: SerializedListingCard; liveMap: () => ReactNode }) {
  const { tr } = useLanguage()
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [retina, setRetina] = useState(false)

  useEffect(() => {
    setRetina(wantsRetinaTiles())
    const el = box.current
    if (!el) return
    const read = () => {
      const w = Math.round(el.clientWidth)
      const h = Math.round(el.clientHeight)
      setSize((p) => (p && p.w === w && p.h === h ? p : { w, h }))
    }
    read()
    // A rotation or a font-size change re-lays the column; the tiles have to follow the box. Where
    // there is no ResizeObserver, a viewport resize (which is what a rotation is) stands in for it.
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read, { passive: true })
      return () => window.removeEventListener('resize', read)
    }
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { lat, lng } = getListingCoordinates(listing)
  const { tiles, pin } = size ? staticMapTiles({ lat, lng, width: size.w, height: size.h, retina }) : { tiles: [], pin: { x: 0, y: 0 } }

  return (
    <div ref={box} className="relative h-full w-full overflow-hidden bg-tint select-none">
      <Sheet>
        <SheetTrigger
          render={
            <Button
              variant="bare"
              size="none"
              type="button"
              /* ⚠️ `active:scale-100` — THE DOCUMENTED OPT-OUT FOR A BUTTON WRAPPING MEDIA
                 (docs/design-language.md, the press-scale contract). A 366px map shrinking to 0.97 reads
                 as the page lurching; the pill below carries the press instead. */
              className="group absolute inset-0 block h-full w-full overflow-hidden p-0 active:scale-100"
            />
          }
        >
          {tiles.map((t) => (
            // Plain <img>, not next/image: these are third-party 256px tiles the optimizer would only
            // re-encode, and they must keep their exact URL to share the live map's cache entries.
            <img
              key={t.key}
              src={t.url}
              alt=""
              width={256}
              height={256}
              loading="lazy"
              decoding="async"
              fetchPriority="low"
              draggable={false}
              className="pointer-events-none absolute max-w-none"
              style={{ left: t.left, top: t.top, width: 256, height: 256 }}
            />
          ))}
          {tiles.length > 0 && (
            // Only over a drawn map: a pin on a blank tile (no size yet, or a point that could not be
            // projected) would assert a location that is not on screen.
            // The pin: Solar `map-point` (Bold) — the glyph the app's map icons are drawn from — with its
            // tip (y≈22 of 24) on the listing's point. Inline rather than the sprite so it can be SOLID
            // brand with a light edge over any tile; the sprite swaps weight only on a selected control.
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="pointer-events-none absolute size-9 text-brand [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.28))]"
              style={{ left: pin.x - 18, top: pin.y - 33 }}
            >
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M12 2C7.58 2 4 6 4 10.5C4 14.96 6.55 19.81 10.54 21.67C11.47 22.11 12.53 22.11 13.46 21.67C17.45 19.81 20 14.96 20 10.5C20 6 16.42 2 12 2ZM12 12C13.1 12 14 11.1 14 10C14 8.9 13.1 8 12 8C10.9 8 10 8.9 10 10C10 11.1 10.9 12 12 12Z"
                fill="currentColor"
                className="stroke-card [paint-order:stroke]"
                strokeWidth={1.5}
              />
            </svg>
          )}
          <span className="pointer-events-none absolute bottom-3 right-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-card px-3.5 text-sm font-semibold text-foreground shadow-pop transition-[scale] duration-150 group-active:scale-[0.97] motion-reduce:transition-none">
            <MapIcon className="size-4" aria-hidden />
            {tr('Open map', 'Mở bản đồ')}
          </span>
        </SheetTrigger>
        {/* ⛔ FULL SCREEN, AND NO SWIPE-TO-DISMISS. Every drag inside is a map pan; with the sheet's
            swipe gesture on, a pan to the right would close the map under the reader's finger. The X,
            Escape and the native back button still close it. The live map mounts only while this is
            open (Base UI unmounts a closed popup), so Leaflet never loads for a reader who never asks. */}
        <SheetContent
          side="right"
          swipeToDismiss={false}
          className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-none"
        >
          <SheetHeader className="pr-14">
            <SheetTitle><Tr text="Location" /></SheetTitle>
            <SheetDescription><PreviewPlace district={listing.district} location={listing.location} /></SheetDescription>
          </SheetHeader>
          <div className="relative min-h-0 flex-1 border-t border-border">{liveMap()}</div>
        </SheetContent>
      </Sheet>
      <PreviewCredit />
    </div>
  )
}

/** The place line: the district as stored (a proper noun — machine translation is how ward names become
 *  word salad) and the location through the catalogue, as the live map's popup prints it — except that
 *  a location which already names its district is shown alone. Measured on real listings: the popup's
 *  rule rendered "Quận 2, P. Thảo Điền, Quận 2". A component because `useTr` is a hook. */
function PreviewPlace({ district, location }: { district: string | null; location: string }) {
  const place = useTr(location)
  return <>{district && !location.includes(district) ? `${district}, ${place}` : place}</>
}

/**
 * The basemap credits, in the same collapsed ⓘ form the live map uses (listings-map.tsx `MapCredit`,
 * which is not exported from that landmine file — so the form is repeated here, and a restyle of one
 * must reach the other). Two providers, two reachable links, each named with the exact licence wording.
 */
function PreviewCredit() {
  return (
    <p className="pointer-events-none absolute bottom-1 left-2 z-10 flex items-center gap-1 rounded-lg bg-card/70 px-1 py-px text-3xs leading-none text-ink-4/80 material backdrop-blur-[2px]">
      <a
        className="pointer-events-auto flex size-5 items-center justify-center leading-none transition-colors hover:text-body"
        href="https://www.openstreetmap.org/copyright"
        onClick={handleExternalClick}
        target="_blank"
        rel="noreferrer"
        aria-label={OSM_CREDIT}
      >
        <Info className="size-5" />
      </a>
      <a
        className="pointer-events-auto flex size-5 items-center justify-center leading-none transition-colors hover:text-body"
        href="https://carto.com/attributions"
        onClick={handleExternalClick}
        target="_blank"
        rel="noreferrer"
        aria-label={CARTO_CREDIT}
      >
        <Info className="size-5" />
      </a>
    </p>
  )
}
