'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SerializedListingCard } from '@/lib/types'
import { Tr, useLanguage } from '@/context/language-context'
import { PopupPlace } from './place-name'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Info, Map as MapIcon } from '@/components/ui/icons'
import { getListingCoordinates } from '@/lib/geo'
import { basemapStyle, PREVIEW_STYLE } from '@/lib/basemap'
import { useResolvedTheme } from '@/context/theme-context'
import { metresPerPixel, staticMapTiles, STATIC_MAP_ZOOM, wantsRetinaTiles, zoomToFitRadius } from '@/lib/static-map'
import { OSM_CREDIT, CARTO_CREDIT } from '@/lib/map-credit'
import { handleExternalClick } from '@/lib/native-browser'
import { cn } from '@/lib/utils'

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
export function ListingMapPreview({ listing, liveMap, approximate = null, look = 'default' }: {
  listing: SerializedListingCard
  liveMap: () => ReactNode
  /** Only the district or city is known: draw that AREA as a circle, and no pin — see approximateArea (geo.ts). */
  approximate?: { lat: number; lng: number; radiusM: number } | null
  /**
   * ⛔ 'sheet' — THE RENTAL LISTING PAGE ON A PHONE (owner-approved 2026-11-14, cook r05 "rental-c": "after this cook round build
   * all best options and deploy"; src/lib/rental-sheet.ts). Below md only (every class is `max-md:`, so a touch tablet at md+
   * keeps today's look): ONE INK PIN (40, positioned by its tip, so its size cannot move the point) or an ink area — it
   * reverses the brand-blue pin and area there; "Open map" top-right in the label voice; and the two credits as ONE quiet
   * text plate bottom-left, each link showing its own licence wording (OSM_CREDIT, CARTO_CREDIT — the same string as its
   * accessible name) in place of the ⓘ. The live map (desktop, and the full-screen sheet this opens) keeps the ⓘ form.
   * The tiles are never filtered.
   * ⛔ …AND SINCE BUILD 7 (owner-approved 2026-11-15 (build 7), cook r07 "rental"; it reverses there the top-right pill and the
   * live map's own tiles in the picture): below md the box is a CARD (SHEET_MAP_BOX, src/lib/rental-sheet.ts) whose bottom
   * 48px is "Open map" as a full-width footer row (a hairline over it, 700 16 ink, the map glyph at 20) — still inside the one
   * button, still its name; the picture above it is CARTO Voyager one zoom step out (basemap.ts PREVIEW_STYLE; dark mode keeps
   * `dark_all`), centred on the point in the space the row leaves (PHONE_FOOTER); the credits plate sits 8px over the row,
   * without its blur. From md (a touch tablet) the r05 sheet look above is unchanged. The full-screen map it opens is the
   * live map, as before.
   */
  // ⚠️ No page passes 'sheet' since 2026-11-24 (owner: "make it consistent all across the app our style" — the rental page
  // draws this default map). The look is kept, unused, until it is deleted with its tests.
  look?: 'default' | 'sheet'
}) {
  const sheet = look === 'sheet'
  const { tr } = useLanguage()
  const dark = useResolvedTheme() === 'dark'
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [retina, setRetina] = useState(false)
  // Below md on the sheet (the CSS's own breakpoint, globals.css): read after mount like the box's size, so the server HTML and
  // the first client render are the same (no tiles yet in either).
  const [phone, setPhone] = useState(false)
  useEffect(() => {
    if (!sheet || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(max-width: 767.98px)')
    const read = () => setPhone(mq.matches)
    read()
    mq.addEventListener?.('change', read)
    return () => mq.removeEventListener?.('change', read)
  }, [sheet])

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

  const { lat, lng } = approximate ?? getListingCoordinates(listing)
  // The sheet's phone card (build 7): the picture is the box less its "Open map" row, Voyager one step out in light mode.
  const sheetPhone = sheet && phone
  const voyager = sheetPhone && !dark
  const picH = size ? size.h - (sheetPhone ? PHONE_FOOTER : 0) : 0
  // An area is framed to fit its circle (the live map's fitBounds on the same shape); a pin keeps zoom 15 (14 on Voyager).
  const zoom = approximate && size ? zoomToFitRadius(lat, approximate.radiusM, size.w, picH) : voyager ? STATIC_MAP_ZOOM - 1 : STATIC_MAP_ZOOM
  const { tiles, pin } = size && picH > 0 ? staticMapTiles({ lat, lng, width: size.w, height: picH, retina, zoom, style: voyager ? PREVIEW_STYLE : basemapStyle(dark) }) : { tiles: [], pin: { x: 0, y: 0 } }
  const areaR = approximate ? approximate.radiusM / metresPerPixel(lat, zoom) : 0

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
              className="rounded-[inherit] group absolute inset-0 block h-full w-full overflow-hidden p-0 active:scale-100"
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
          {tiles.length > 0 && approximate && (
            // THE AREA, NOT A POINT: a brand-tinted disc with a hairline edge, centred on the district or
            // city centroid. No pin anywhere on it — a pin would claim a place we do not know.
            <span
              aria-hidden
              data-map-area
              className={cn('pointer-events-none absolute rounded-full border-2 border-brand bg-brand/15', sheet && 'max-md:border-foreground max-md:bg-foreground/8')}
              style={{ left: pin.x - areaR, top: pin.y - areaR, width: areaR * 2, height: areaR * 2 }}
            />
          )}
          {tiles.length > 0 && !approximate && (
            // Only over a drawn map: a pin on a blank tile (no size yet, or a point that could not be
            // projected) would assert a location that is not on screen.
            // The pin: Solar `map-point` (Bold) — the glyph the app's map icons are drawn from — with its
            // tip (y≈22 of 24) on the listing's point. Inline rather than the sprite so it can be SOLID
            // brand with a light edge over any tile; the sprite swaps weight only on a selected control. ⛔ INK on the rental sheet
            // below md (`look="sheet"`, owner-approved 2026-11-14, cook r05 "rental-c"), as is the area disc above.
            // 'sheet': placed at the point and pulled back by its own tip (x 12/24, y 22/24 of the box), so the 40px ink pin
            // below md and the 36px one from md both stand on the same spot.
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className={sheet
                ? 'pointer-events-none absolute size-9 -translate-x-1/2 -translate-y-[91.667%] text-brand [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.28))] max-md:size-10 max-md:text-foreground'
                : 'pointer-events-none absolute size-9 text-brand [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.28))]'}
              style={sheet ? { left: pin.x, top: pin.y } : { left: pin.x - 18, top: pin.y - 33 }}
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
          {/* 'sheet' below md (build 7): the card's 48px footer row — the full width, a hairline over it, 700 16 ink, a 20px glyph;
              a press fills it the field grey. From md the r05 pill, bottom-right with the pop. `.shadow-pop` is an UNLAYERED class
              and would beat any utility, so that look carries the pop as a utility from md instead. */}
          <span className={sheet
            ? 'pointer-events-none absolute bottom-0 left-0 right-0 flex h-12 items-center justify-center gap-2 border-t border-line-strong bg-background text-base font-bold text-foreground transition-[scale] duration-150 group-active:bg-muted motion-reduce:transition-none md:bottom-3 md:left-auto md:right-3 md:inline-flex md:h-9 md:gap-1.5 md:rounded-full md:border-t-0 md:bg-card md:px-3.5 md:text-sm md:font-semibold md:shadow-[var(--shadow-pop)] md:group-active:scale-[0.97] md:group-active:bg-card'
            : 'pointer-events-none absolute bottom-3 right-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-card px-3.5 text-sm font-semibold text-foreground shadow-pop transition-[scale] duration-150 group-active:scale-[0.97] motion-reduce:transition-none'}>
            <MapIcon className={cn('size-4', sheet && 'max-md:size-5')} aria-hidden />
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
            <SheetDescription><PopupPlace district={listing.district} location={listing.location} /></SheetDescription>
          </SheetHeader>
          <div className="relative min-h-0 flex-1 border-t border-border">{liveMap()}</div>
        </SheetContent>
      </Sheet>
      <PreviewCredit sheet={sheet} />
    </div>
  )
}

/** The sheet's "Open map" row below md (`h-12`): the picture is centred in the box less this. */
const PHONE_FOOTER = 48

// The place line is the live map popup's own (place-name.tsx PopupPlace, 2026-11-10): one rule for both, which already drops
// a district the location names ("Quận 2, P. Thảo Điền, Quận 2", measured here once) — by exact level, so "Quận 1" survives
// beside "Quận 12" — and never mixes a stored "Quận 7" with a spelled "Tan Phong Ward".

/**
 * The basemap credits, in the same collapsed ⓘ form the live map uses (listings-map.tsx `MapCredit`,
 * which is not exported from that landmine file — so the form is repeated here, and a restyle of one
 * must reach the other). Two providers, two reachable links, each named with the exact licence wording.
 * ⛔ EXCEPT `sheet` BELOW md (owner-approved 2026-11-14, cook r05 "rental-c"): there each link SHOWS its licence wording, on one
 * quiet plate (24 tall, the meta role, muted — 5.9:1 on the light tiles through the plate). The plate keeps its own material
 * tint and blur (`bg-card/70`, bare: the reduced-transparency block in globals.css can only reach a bare tint, design-lint),
 * so only its shape and type change. The words are the constants (never tr(), never shortened — map-credit.ts),
 * so the visible text and the accessible name are one string. Since build 7 (owner-approved 2026-11-15 (build 7)) the plate sits
 * 8px over the card's "Open map" row (56 up) and draws without its 2px blur, which smeared a cyan map feature through the
 * words; the tint stays. The live map's `MapCredit` keeps the ⓘ form: this is no
 * longer its twin on a rental phone, and listings-map.tsx says so.
 * ⛔ …AND THE ⓘ PLATE ON EVERY OTHER LISTING PAGE, BELOW md (owner-approved 2026-11-15 (build 7), cook r07 "item": "the map's two
 * attribution links on one plate; a cyan map feature had smeared through them"): the same two ⓘ links on one round plate,
 * without the 2px blur — the tint stays. From md, and in the live map, the plate is as it was.
 */
function PreviewCredit({ sheet = false }: { sheet?: boolean }) {
  const link = cn('pointer-events-auto flex size-5 items-center justify-center leading-none transition-colors hover:text-body', sheet && 'max-md:h-6 max-md:w-auto max-md:whitespace-nowrap')
  return (
    <p className={cn('pointer-events-none absolute bottom-1 left-2 z-10 flex items-center gap-1 rounded-lg bg-card/70 px-1 py-px text-3xs leading-none text-ink-4/80 material backdrop-blur-[2px] max-md:rounded-full max-md:backdrop-blur-none', sheet && 'max-md:bottom-14 max-md:h-6 max-md:gap-2 max-md:px-2.5 max-md:py-0 max-md:text-t-meta max-md:text-muted-foreground')}>
      <a
        className={link}
        href="https://www.openstreetmap.org/copyright"
        onClick={handleExternalClick}
        target="_blank"
        rel="noreferrer"
        aria-label={OSM_CREDIT}
      >
        <Info className={cn('size-5', sheet && 'max-md:hidden')} />
        {sheet && <span className="md:hidden">{OSM_CREDIT}</span>}
      </a>
      <a
        className={link}
        href="https://carto.com/attributions"
        onClick={handleExternalClick}
        target="_blank"
        rel="noreferrer"
        aria-label={CARTO_CREDIT}
      >
        <Info className={cn('size-5', sheet && 'max-md:hidden')} />
        {sheet && <span className="md:hidden">{CARTO_CREDIT}</span>}
      </a>
    </p>
  )
}
