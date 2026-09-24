'use client'

import { basemapTileUrl } from '@/lib/basemap'
import Image from 'next/image'
import { isMockImageUrl } from '@/lib/listing-image'
import { useEffect, useRef, useState } from 'react'
import { Heart, Info } from '@/components/ui/icons'
import { TrustScore } from './trust-score'
import { PartnerBadge } from './partner-badge'
import { ImageMark } from './image-mark'
import { MapTravel, MapsDirectionsButton } from './map-travel'
import type { LatLng } from '@/lib/travel'
import type { SerializedListingCard, BuildingPin } from '@/lib/types'
import { formatMoneyFull, compactPrice, moneyLocale, type MoneyLocale } from '@/lib/vnd'
import { useCurrency, vndPerUsd } from '@/context/currency-context'
import { Price } from './price'
import { useLanguage, useTr } from '@/context/language-context'
import { useFavorites } from '@/context/favorites-context'
import { LocalizedText } from './listing-content'
import { getListingCoordinates } from '@/lib/geo'
import { radiusBoundingBox } from '@/lib/geo-radius'
import { MAP_GLYPH_LABEL, MAP_GLYPH_PATH, mapGlyphFor, type MapGlyph } from '@/lib/listing-map-glyph'
import { MapBuildingCard } from './map-building-card'
import type { Nearby } from './area-filter'
import { OSM_CREDIT, CARTO_CREDIT } from '@/lib/map-credit'
import { cn } from '@/lib/utils'
import { handleExternalClick } from '@/lib/native-browser'
import { EnoLoader } from '@/components/ui/eno-loader'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'

// Compact price for map labels (Airbnb-style price pins). VND uses the shared
// compactPrice, which follows the viewer's language — "850K" / "51M" / "1.2B"
// for everyone else (the Vietnamese shorthand is opaque to the expat audience),
// native "500k" / "51tr" / "1,2 tỷ" for vi; the rare non-₫ listing keeps its
// symbol-prefixed format.
function pinLabel(l: SerializedListingCard, locale: MoneyLocale, currency?: string, rate?: number): string {
  // ⚠️ A PIN MUST NOT SHOW A BARE ĐỒNG MAGNITUDE TO SOMEONE READING IN DOLLARS. This returned
  // `compactPrice(l.price, locale)` unconditionally for ₫ listings — a unit-less "51M" — while every
  // other surface honoured the viewer's display currency. A USD reader saw "51M" on the pin and
  // "$1,950" one tap later, on the same listing.
  // Mirrors price-range-filter.tsx's compactAmt: convert first, keep the vi shorthand only when the
  // viewer is actually reading đồng, and never emit a magnitude without its unit.
  // ⚠️ SINCE THE 2026-09-13 CARD REWORK THE "FOREIGN" FIGURE IS ALWAYS DOLLARS. The popup (and every
  // card) now reads "51,000,000 đ ≈ $1,950" — đồng first, USD as the estimate — for every viewer. So a
  // viewer who picked ANY foreign currency gets a dollar pin ("$1.9k") that matches the popup's "≈";
  // converting to their EUR/KRW pick would put "€1.7k" on the pin and "$1,950" one tap later, which all
  // four reviewers flagged. The currency picker still drives the PDP. A first pass switched pins to
  // đồng-only instead, and reviewers flagged the unit-less "51M" that handed a dollar reader.
  if (l.currency === '₫') {
    const foreign = currency && currency !== 'VND' && currency !== '₫' && rate
    if (!foreign) return compactPrice(l.price, locale)
    const d = l.price * (rate as number)
    const sym = currency === 'USD' ? '$' : `${currency} `
    if (d >= 1_000_000) return `${sym}${(d / 1_000_000).toFixed(d % 1_000_000 === 0 ? 0 : 1)}M`
    if (d >= 1_000) return `${sym}${(d / 1_000).toFixed(d % 1_000 === 0 ? 0 : 1)}k`
    return `${sym}${Math.round(d)}`
  }
  // Rare non-₫ listing: same canonical vnd.ts formatter the popup one tap away uses
  // (the old local formatPrice hardcoded Intl en-US — audit P1 #9; it's deleted).
  return formatMoneyFull(l.price, l.currency, locale)
}

/** The popup's place line — the city goes through the same `useTr` the card uses (identity in
 *  English and Vietnamese; machine-translated for the other UI languages). The district is printed as
 *  stored, exactly as on the card: it is a proper noun, and machine translation of ward names is how
 *  "Bình Thạnh" becomes a word salad. The full city name stays (the popup is 300px; the card's "HCM"
 *  is a width fix). A component because the popup's listing changes while the map stays mounted, and
 *  a hook cannot be called conditionally inside it. */
function PopupPlace({ district, location }: { district: string | null; location: string }) {
  const city = useTr(location)
  return <>{district && district !== location ? `${district}, ${city}` : city}</>
}

type Props = {
  listings: SerializedListingCard[]
  activeDistrict: string
  onOpenListing: (l: SerializedListingCard) => void
  selectedId?: string | null
  onHover?: (id: string | null) => void
  focusId?: string | null
  // "Search near you" centre + radius — when set, the map flies to it and draws the
  // radius circle (the listings are already narrowed to this radius upstream).
  nearby?: Nearby | null
  // A pin was tapped and its popup card opened — lets the result list scroll
  // that card into view (hover sync alone must not scroll under the cursor).
  onPinOpen?: (id: string) => void
  // Map centre after each pan/zoom — feeds the nearest-first sort of the list.
  onMove?: (c: { lat: number; lng: number }) => void
  // Province/ward signature — when it changes, the map re-fits to the (now area-
  // filtered) listings even if the top result happens to be unchanged.
  areaKey?: string
  /**
   * BUILDING PINS — one per partner project, counted server-side across the whole filtered set.
   * ⛔ THESE REPLACE ONLY THE PINS OF LISTINGS THAT HAVE A `buildingKey`. Every other listing keeps
   * its own pin and its existing behaviour (popup height-sync, the touch two-step, hover-to-open).
   * A reviewer specifically warned against turning every pin into an aggregate: the ordinary pin
   * path is load-bearing and has nothing to do with this feature.
   * ⚠️ While a building is selected the map goes back to individual pins for that tower's units, so
   * the user can actually see and pick between them.
   */
  buildings?: BuildingPin[]
  selectedBuilding?: string | null
  onSelectBuilding?: (key: string | null) => void
  /**
   * The explorer's own feed query string, so the building card asks for units with the SAME filters
   * the pin's count and price range were computed under. Without it the card's header and its strip
   * answer different questions — see map-building-card.tsx.
   */
  feedParams?: string
  /**
   * The GeoJSON outline of the ward or district being browsed, or null when there is none to draw.
   * Fetched by the explorer (see /api/geo/boundary) rather than here, so the map stays a renderer
   * and the request is shared with react-query's cache.
   */
  boundary?: unknown
}

// SELF-HOSTED (public/vendor/leaflet, byte-verified against the npm 1.9.4 tarball) — was
// unpkg.com, which meant any unpkg compromise = arbitrary JS on eno.vn with full session
// access (script-src had to allowlist the whole CDN; no SRI on a dynamic <script>). First-
// party also removes a DNS+TLS round-trip before the map can render.
const LEAFLET_JS = '/vendor/leaflet/leaflet.js'
const LEAFLET_CSS = '/vendor/leaflet/leaflet.css'

function loadLeaflet(cb: () => void, onError?: () => void) {
  if (typeof window === 'undefined') return
  const w = window as unknown as { L?: unknown }
  if (w.L) { cb(); return }
  if (!document.getElementById('leaflet-css')) {
    // Warm the tile origin now that the map is actually loading (used to be a global
    // preconnect but wasted an early-connection slot on the homepage).
    for (const href of ['https://basemaps.cartocdn.com']) {
      const pc = document.createElement('link')
      pc.rel = 'preconnect'; pc.href = href; pc.crossOrigin = ''
      document.head.appendChild(pc)
    }
    const link = document.createElement('link')
    link.id = 'leaflet-css'; link.rel = 'stylesheet'; link.href = LEAFLET_CSS
    document.head.appendChild(link)
  }
  const existing = document.getElementById('leaflet-js') as HTMLScriptElement | null
  if (existing) {
    if (w.L) cb()
    else {
      existing.addEventListener('load', cb, { once: true })
      // The tag may already have failed (a 'load' listener would never fire) —
      // surface that; removing the dead tag lets a retry inject a fresh one.
      existing.addEventListener('error', () => { existing.remove(); onError?.() }, { once: true })
    }
    return
  }
  const s = document.createElement('script')
  s.id = 'leaflet-js'; s.src = LEAFLET_JS; s.async = true
  s.onload = () => cb()
  s.onerror = () => { s.remove(); onError?.() }
  document.head.appendChild(s)
}

/**
 * ⛔ THE ZOOM AT WHICH A BUILDING PIN EARNS ITS NAME. Below this the pin is a fixed-width
 * glyph+count chip; at or above it the project name is appended.
 *
 * This number IS the fix for the overlap. 30 buildings share ~31 coordinates, and at city zoom each
 * was drawing a variable-width `name + count` pill — "The Metropole Thủ Thiêm 67" next to "Masteri
 * Thảo Điền 106" — which cannot tile, so they piled into an unreadable stack. A glyph and a count
 * are fixed width, so they can.
 *
 * ⚠️ AND THE NAME COMES BACK RATHER THAN GOING AWAY, which is the correction both reviewers pushed
 * for and they were right: in Vietnamese property search the project name (Vinhomes, Masteri) IS the
 * spatial anchor people scan for, so a permanently anonymous chip would force blind clicking. 14 is
 * where a reader has committed to a neighbourhood and the pins are sparse enough to carry text.
 */
const LABEL_ZOOM = 14

/** The stroked pictogram inside a pin. `currentColor` so one colour flips the whole mark. */
function glyphMark(glyph: MapGlyph, px: number): string {
  return `<svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none;"><path d="${MAP_GLYPH_PATH[glyph]}"/></svg>`
}

const escapeHtml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * A BUILDING pin: one marker standing in for the units grouped at a project's coordinate — Rever
 * geocodes the PROJECT, so 157 units land on one point and would otherwise render as one unreachable
 * pile. The glyph says what kind of place it is, the count says how many are available, and the name
 * appears once the map is zoomed in far enough for it to fit.
 *
 * ⛔ SAME ESCAPING RULE AS pinHtml, AND HERE IT IS NOT THEORETICAL. `pinHtml` only ever receives
 * formatter output (digits and a currency symbol); this receives a building NAME that came from a
 * third party's web page, so the escape is the actual boundary, not a precaution.
 */
function buildingPinHtml(name: string, count: number, active: boolean, glyph: MapGlyph, withName: boolean): string {
  const bg = active ? '#0a66c2' : '#111827'
  const scale = active ? 1.06 : 1
  const label = withName
    ? `<span style="max-width:13ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(name)}</span>`
    : ''
  return `<div style="transform:translate(-50%,-50%) scale(${scale});display:inline-flex;align-items:center;gap:4px;background:${bg};color:#fff;border:1px solid rgba(255,255,255,.28);border-radius:9999px;padding:3px 7px;font-size:11px;font-weight:700;line-height:1;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.3);transition:transform .12s ease, background .12s ease;">${glyphMark(glyph, 13)}${label}<span style="background:rgba(255,255,255,.22);border-radius:9999px;padding:1px 5px;font-size:10px;">${count}</span></div>`
}

/**
 * A single listing's pin: the type glyph and its compact price.
 *
 * ⚠️ THE PRICE STAYS AT EVERY ZOOM, and that is deliberate rather than an oversight of "make the
 * pins small". A price is already short and near-fixed width ("6.8M", "$258"), so it is not what
 * piled up — the variable-width building NAMES were. Dropping it would also throw away the currency
 * correctness `pinLabel` exists to guarantee, and leave a map of identical marks with nothing to
 * choose between. Smaller type and tighter padding is what "small" buys here.
 */
function pinHtml(label: string, active: boolean, glyph: MapGlyph): string {
  // INVARIANT: label is interpolated into raw HTML — escape it (audit P2). Today every
  // caller feeds formatter output (digits + currency), but the safety must not depend
  // on that staying true.
  const esc = escapeHtml(label)
  const bg = active ? '#0a66c2' : '#ffffff'
  const color = active ? '#ffffff' : '#1a202c'
  const border = active ? '#0a66c2' : '#d8dee6'
  const scale = active ? 1.08 : 1
  return `<div style="transform:translate(-50%,-50%) scale(${scale});display:inline-flex;align-items:center;gap:3px;background:${bg};color:${color};border:1px solid ${border};border-radius:9999px;padding:3px 7px;font-size:11px;font-weight:700;line-height:1;white-space:nowrap;box-shadow:0 1px 5px rgba(0,0,0,.22);transition:transform .12s ease, background .12s ease;">${glyphMark(glyph, 12)}<span>${esc}</span></div>`
}

/**
 * The basemap credit. A LICENCE OBLIGATION, not a design flourish.
 *
 * The tiles come from `basemaps.cartocdn.com` — CARTO's free basemaps, rendered from
 * OpenStreetMap data under the ODbL. We pay nothing for them and crediting both parties is the
 * condition of that. Both of this app's maps had `attributionControl: false` and passed no
 * `attribution` string, so a commercial marketplace was serving those tiles with no credit at all.
 *
 * ⚠️ HAND-ROLLED RATHER THAN LEAFLET'S CONTROL, deliberately. `L.control.attribution` renders an
 * unstyled `.leaflet-control-attribution` box (white, 11px, its own font stack) that conforms to
 * nothing in docs/design-language.md, and the only way to restyle it is a global selector —
 * globals.css is not this task's file, and a global override for two components is the wrong shape
 * anyway. The task sanctions a custom line for exactly this reason.
 *
 * ⚠️ `pointer-events-none` on the wrapper with `pointer-events-auto` on the links: the credit must
 * be clickable (a credit nobody can follow is decoration) while the ~2px of padding around it must
 * not swallow a map drag that happens to start there.
 *
 * ⚠️ The basemap is ALWAYS LIGHT — CARTO `light_all` does not follow the app theme — so this needs
 * a backdrop rather than a theme-coloured text token alone, or it becomes unreadable wherever the
 * tiles are pale. Same treatment as the trip map's legend and coverage notice.
 */
function MapCredit({ className }: { className?: string }) {
  const { tr } = useLanguage()
  return (
    <p
      className={cn(
        // `gap-1` separates the two credits instead of a whitespace text node: `jsx-no-literals`
        // rejects bare strings in JSX — including `{\' \'}` — and the rule is right to, because it
        // is what stops untranslated copy shipping. So the words go through `tr` and the spacing
        // is layout.
        // ⚠️ OPAQUE `bg-card`, not `bg-card/85`. The basemap is always light, so a translucent chip
        // composites toward WHITE — in dark mode that lightened the chip under light-grey `ink-4`
        // text and measured 4.19:1, under the 4.5:1 floor. Present-but-illegible does not discharge
        // a licence obligation. Opaque, the chip is the theme's own surface and the ratio is 5.9:1
        // (light) / 6.6:1 (dark) regardless of what the tiles are doing underneath. Both measured on a
        // production build, not derived — an earlier version of this comment claimed 12.6:1 for dark,
        // which was a guess written before the measurement and wrong.
        // z-800: below `.leaflet-bottom` (1000) so the zoom control stays on top, and below the
        // floating listing card (1100). It does NOT need to beat the popup pane's 700 — see the note
        // on OVERLAY_Z in trip-map.tsx: `.leaflet-map-pane`'s transform contains that whole ladder at
        // z-400. 800 is insurance for Leaflet's non-transform fallback, where it would not.
        // ⚠️ QUIETER, NOT GONE — see src/lib/map-credit.ts for why the second option does not
        // exist. The credit was a solid `bg-card` chip with underlined links, which on a pale
        // basemap read as a UI control the visitor was meant to use. It is a legal footnote, so
        // it should look like one: a translucent backdrop that only resolves against the tiles,
        // ink at the quietest step, and the underline held back until hover. It stays legible
        // (the blur keeps it readable over any tile) and stays clickable, which is what the
        // licence actually asks for.
        // ⚠️ THE CREDIT IS ALWAYS A SINGLE ⓘ, ON EVERY VIEWPORT. Owner, 2026-08-16: "on map remove
        // these on mobile so annoying", then "do collapse on desktop too". Removing it is not
        // available — src/lib/map-credit.ts says why, and it is a licence condition, not a style
        // choice — but collapsing it is: OSM's attribution guidance accepts a compact form provided
        // the credit stays reachable, which is exactly what Google Maps, Mapbox and Apple ship. The
        // ⓘ opens the same copyright page the sentence linked to, so the obligation is discharged
        // and ~250px of legal footnote stops competing with the map.
        // ⚠️ THE REQUIRED WORDING IS THE LINK'S ACCESSIBLE NAME — `aria-label={OSM_CREDIT}` — and
        // there is exactly ONE link per provider. Two earlier attempts were both reviewer-refuted:
        // `hidden` on the text removed it from the accessibility tree entirely (display:none is not
        // "still in the DOM for readers", whatever the comment claimed), and `sr-only` alongside the
        // icon left FOUR focusable links, so a keyboard or screen-reader user met each credit twice.
        // One control, carrying the exact ODbL wording as its name, is both.
        // ⚠️ NO `tap-44` HERE, AND THE NUMBERS BELOW ARE THE REAL ONES. Each control is `size-5`
        // (20px) and `gap-1` puts 4px between them. That spacing is exactly why tap-44 is refused:
        // docs/design-language.md records that an UNPOSITIONED tap-44 expands over its positioned
        // ancestor, and two 44px hit areas 4px apart would also swallow each other. A footnote link
        // is not a primary control — the sentence it replaces was not 44px either, so nothing
        // regressed — but if these ever need proper targets, position them first.
        'pointer-events-none absolute z-[800] flex items-center gap-1 rounded-lg bg-card/70 px-1 py-px text-3xs leading-none text-ink-4/80 material backdrop-blur-[2px]',
        className,
      )}
    >
      {/* ⚠️ `handleExternalClick`, like every other third-party link in the app. Inside the
          Capacitor shell a bare target=_blank hands the URL to Safari/Chrome and LEAVES eno —
          src/lib/native-browser.ts calls that hard exit "the most jarring thing a wrapped app
          does". These are pure go-and-look destinations, so they belong in the in-app browser, one
          Done tap from the map. (The single documented exception is evisa.gov.vn, for reasons that
          do not apply here.) A credit the native app cannot follow is decoration. */}
      {/* ⛔ THE GLYPH'S OWN CIRCLE IS THE CIRCLE — there is no bordered ring around it any more
          (owner, 2026-08-18: "any icon with circle around either make them big so outline circle
          matches the button cirlce or find simple version without circle of icon itslef in solar
          pack"). These read as TWO concentric rings: a 20px `rounded-full border` box with a 10px
          ⓘ floating inside it, the glyph's own ring a third of the width of the one around it.
          ⚠️ THE SECOND OPTION IS NOT AVAILABLE AND I CHECKED BEFORE CHOOSING: Solar v2 Outline ships
          `info-circle` and `info-square` and no bare "i", so there is no circle-free info glyph to
          swap to. Growing the glyph to fill the box is the other half of the owner's instruction and
          it costs nothing — the control is the same 20px, the ring is the same ring, there is just
          one of it now and it is twice the size.
          ⚠️ THE CREDITS THEMSELVES ARE UNTOUCHABLE — OSM and CARTO attribution is a licence
          obligation, never translated, never removed. This is the ring around the link, not the
          link. */}
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
      {/* ⛔ CARTO GETS ITS OWN CONTROL. The first version of this collapse hid the CARTO link and
          pointed a single ⓘ at OpenStreetMap only — all three reviewers caught that it left CARTO's
          attribution unreachable, which is a worse licence position than the verbose credit it
          replaced. Two providers, two reachable credits; they are 16px each, so the clutter the
          owner objected to is still gone. */}
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

export function ListingsMap({ listings, activeDistrict, onOpenListing, selectedId, onHover, focusId, nearby, areaKey, onPinOpen, onMove, buildings, selectedBuilding, onSelectBuilding, feedParams, boundary }: Props) {
  const { lang: uiLang, tr } = useLanguage()
  const { isFavorite, toggle } = useFavorites()
  const { currency: pickedCurrency, rates: fxRates } = useCurrency()
  // Any foreign pick → a DOLLAR pin, matching the popup's "≈ $" (see pinLabel). /api/fx publishes
  // 'currency per 1 VND', so this multiplies; `vndPerUsd` is the same plausibility band <Price> uses,
  // so a pin never shows a dollar figure the popup would refuse to. Undefined until the rates land.
  const displayCurrency = pickedCurrency && pickedCurrency !== 'VND' && pickedCurrency !== '₫' ? 'USD' : pickedCurrency
  const displayRate = displayCurrency === 'USD' && vndPerUsd(fxRates) ? fxRates.USD : undefined
  // Pin + card amounts follow the viewer's UI language from CONTEXT — a former
  // `lang` prop was a content-localization hint some hosts hardcoded (listing-
  // detail-map passed 'vi'), so it could never drive money formatting; it was
  // unused and has been removed.
  const locale = moneyLocale(uiLang)
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  /** True once the map is zoomed in far enough for building pins to carry their names. */
  const [labelled, setLabelled] = useState(false)
  const markersRef = useRef<Map<string, any>>(new Map())
  /**
   * ⛔ THE HTML EACH MARKER IS CURRENTLY SHOWING, so the restyle effect can skip the ones that did
   * not change. `setIcon` REPLACES the marker's DOM element, taking hover state, the `riseOnHover`
   * z-index and the element the touch two-step is mid-tap on with it. That effect now also runs on
   * `buildings` and `selectedBuilding`, so without this a building refetch — or selecting any
   * tower — would tear down and rebuild every unrelated pin on the map, which a reviewer flagged as
   * exactly the destruction the setIcon approach was chosen to avoid.
   */
  const markerHtmlRef = useRef<Map<string, string>>(new Map())
  /**
   * ⚠️ THE SELECT CALLBACK LIVES IN A REF, like `listings` below and for the same reason. Marker
   * click handlers are captured when the marker is built; putting the prop in this effect's deps
   * instead would rebuild every marker whenever the parent re-rendered with a fresh inline arrow —
   * which is what made clicking a building appear to do nothing and the map snap back.
   */
  const onSelectBuildingRef = useRef(onSelectBuilding)
  onSelectBuildingRef.current = onSelectBuilding
  const boundaryLayerRef = useRef<any>(null) // the ward/district outline layer
  const areaShapeRef = useRef<any>(null) // the area-search overlay — a RECTANGLE, see below
  const fitKeyRef = useRef<string>('') // last filter signature we auto-fit bounds for
  const [ready, setReady] = useState(false)
  // Leaflet script failed to load (offline / blocked) — without this the overlay
  // spinner spins forever. `loadTry` re-runs the loader effect on Retry.
  const [loadError, setLoadError] = useState(false)
  const [loadTry, setLoadTry] = useState(0)
  // Airbnb-style: a pin tap opens a small info card (not a direct navigation). The
  // ref mirrors the open card id so marker/map click handlers (captured in effects)
  // always see the current value without stale closures.
  const [card, setCard] = useState<SerializedListingCard | null>(null)
  /**
   * The building pin's own card. Separate state from `card` because the two are different objects
   * with different lifetimes — a listing card follows hover on desktop and the touch two-step on
   * mobile, while this one is opened by an explicit tap and dismissed explicitly.
   */
  const [buildingCard, setBuildingCard] = useState<BuildingPin | null>(null)
  const [buildingCardPos, setBuildingCardPos] = useState<{ x: number; y: number; above: boolean; centered?: boolean } | null>(null)
  // Card pops ABOVE the tapped pin (anchored to its screen position) — `above`
  // flips it below the pin when there isn't room near the top edge.
  const [cardPos, setCardPos] = useState<{ x: number; y: number; above: boolean; centered?: boolean } | null>(null)
  const cardIdRef = useRef<string | null>(null)

  // Viewer location for the popup's travel estimate. Reuse the "search near you"
  // location when it's already set (no re-prompt); otherwise the popup's button asks.
  const [geoLoc, setGeoLoc] = useState<LatLng | null>(null)
  const [locState, setLocState] = useState<'idle' | 'loading' | 'denied'>('idle')
  const userLoc: LatLng | null = geoLoc ?? (nearby ? { lat: nearby.lat, lng: nearby.lng } : null)
  const requestLoc = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setLocState('denied'); return }
    setLocState('loading')
    navigator.geolocation.getCurrentPosition(
      (pos) => { setGeoLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocState('idle') },
      () => setLocState('denied'),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 },
    )
  }
  // Mirror `listings` into a ref so the map/marker event handlers (captured once in
  // effects) read the current set without stale closures. Synced in an effect, not
  // during render (the handlers only fire on user interaction, well after commit).
  const listingsRef = useRef(listings)
  useEffect(() => { listingsRef.current = listings }, [listings])

  // Card sizes ADAPT to the map viewport: on a short map (e.g. the listing-detail
  // location map ~260px tall) we use a slim, image-less horizontal card so the popup
  // never dwarfs the map; on a full-screen map it's the tall Airbnb-style card.
  /** Breathing room above and below a centred card, and the gap that keeps the pin out from under it. */
  const CARD_MARGIN = 12
  // 40, not 26: the pin is a PILL CENTRED ON ITS ANCHOR (see pinHtml), so ~half its height sits above
  // the point we pan to, and a selected pin is scaled up on top of that. Measured at 26 the pin's top
  // edge still overlapped the card by ~5px on a tall map.
  const PIN_CLEARANCE = 40
  const cardDims = () => {
    const el = mapRef.current
    const mapW = el?.clientWidth ?? 360
    const mapH = el?.clientHeight ?? 500
    /**
     * ⛔ THE TALL CARD IS USED ONLY WHERE IT FITS, WHICH IS NOT THE SAME AS "the map is over 360px".
     * The tall card is `w + 118` ≈ 418px. A phone's map view is 60dvh — about 400px on a common
     * handset — so the old `mapH < 360` test happily chose the TALL card for a map that cannot hold
     * it: centred, it clipped at both edges and swallowed the pin underneath (astra, opus, measured
     * on exactly those numbers). The rule is now the honest one — take the tall card when the map has
     * room for it AND the margins around it; otherwise take the compact horizontal card, which is
     * 96px and fits anywhere.
     * ⚠️ `PIN_CLEARANCE` is what keeps the tapped pin OUT from under its own card: the pan puts the pin
     * half a card below centre plus this much, so the map must be able to give back that space too.
     */
    const tallW = Math.round(Math.min(300, mapW - 24))
    const tallH = Math.round(tallW + 118) // square image (= w tall) + content block (~92) + travel row (~26); keep in sync with the card render so the flip + recenter math is right
    /**
     * ⚠️ THE SPACE A CENTRED CARD NEEDS IS TWO-SIDED, and the first cut counted it once. A card centred
     * at H/2 only has H/2 below it, and the pin has to fit in what is left: ch/2 + PIN_CLEARANCE + a
     * margin. So the map must be at least ch + 2·(PIN_CLEARANCE + CARD_MARGIN) — 522px, not 482px. At
     * 482 the clamp squeezed the gap to 20px and the card swallowed the top of the pin, which is the
     * very bug this rule exists to prevent (astra and opus, with the same arithmetic).
     * ⚠️ AND THE RULE IS TOUCH-ONLY. Desktop ANCHORS the card above the pin instead of centring it, so
     * it needs none of this clearance; applying it there dropped every 360–521px desktop map to the
     * compact card for no reason (opus).
     */
    const compact = mapH < 360 || (!isHoverable() && mapH < tallH + (PIN_CLEARANCE + CARD_MARGIN) * 2)
    // Compact is a horizontal card (thumb + title/price/travel + trust + Maps FAB) — it needs
    // real width so the "~19 min · 7.1 km from you" line sits on ONE row instead of wrapping.
    const w = compact ? Math.round(Math.min(320, mapW - 24)) : tallW
    const h = compact ? 96 : tallH
    return { w, h, compact }
  }
  const placeCardFor = (l: SerializedListingCard) => {
    const map = mapInstanceRef.current, el = mapRef.current
    if (!map || !el) return
    const { w: cw, h: ch } = cardDims()
    const { lat, lng } = getListingCoordinates(l)
    const pt = map.latLngToContainerPoint([lat, lng])
    const W = el.clientWidth
    /**
     * ⛔ ON TOUCH THE CARD SITS AT THE MAP'S CENTRE, FULL STOP (owner, 2026-09-16: "when in map mode
     * click on product on map it doest center the card instead shows under annoying make it center the
     * product card to the map center").
     * WHY IT DRIFTED: the anchored placement below flips the card BELOW the pin whenever it will not fit
     * above (`pt.y > ch + 24`). On a phone the map is 60dvh — roughly 400px — while the tall card is
     * w + 118 ≈ 418px, so it never fits above, always flipped under the pin, and then ran off the bottom
     * edge. Recentring could not save it: the pan shift is clamped to 40% of the map height, which on a
     * short map is less than half the card.
     * So on touch the card is centred on the map and the MAP moves under it (see recenterOnPin), which is
     * also the Airbnb/Grab pattern. Desktop keeps the anchored popup: with a cursor the tie between pin
     * and card is the whole affordance, and there the map is tall enough for it to fit.
     */
    if (!isHoverable()) { setCardPos({ x: W / 2, y: el.clientHeight / 2, above: false, centered: true }); return }
    const x = Math.max(cw / 2 + 8, Math.min(W - cw / 2 - 8, pt.x))
    setCardPos({ x, y: pt.y, above: pt.y > ch + 24 })
  }
  // Pan the map so the tapped pin sits a bit BELOW centre — leaving room for the card
  // that pops above it, so the whole card lands centred on screen instead of clipped at
  // an edge (the mobile annoyance). The `move` listener re-runs placeCardFor mid-pan so
  // the card glides to its final spot.
  const recenterOnPin = (l: SerializedListingCard) => {
    const map = mapInstanceRef.current, el = mapRef.current
    if (!map || !el) return
    const L = (window as any).L
    const { lat, lng } = getListingCoordinates(l)
    const z = map.getZoom()
    const pt = map.project([lat, lng], z)
    // Push the pin BELOW centre by ~half the card height so the card — which pops ABOVE the
    // pin — lands vertically CENTRED on the map instead of clipped at the top edge. Clamp so
    // the pin never pans off the bottom on a short map.
    const { h: ch } = cardDims()
    const H = el.clientHeight
    /**
     * TOUCH: the card is pinned to the map's centre, so the PIN is panned to sit just below it — the
     * listing you tapped stays visible, under its own card, instead of being covered by it. Clamped to
     * the map's bottom edge so a short map still shows the pin.
     * DESKTOP: unchanged — push the pin below centre by half the card, so the card that pops ABOVE it
     * lands centred.
     */
    // Panning to `pt.y - shift` puts that point at the map's centre, so the PIN lands `shift` px BELOW
    // centre. Touch wants it clear of the centred card (half a card + a margin); desktop wants just
    // enough room for the card that opens above it.
    const shift = isHoverable()
      ? Math.min(ch / 2 + 10, H * 0.4)
      // cardDims() guarantees the room on touch (it drops to the compact card when the tall one would
      // not fit), so this clamp is a floor against a freak viewport rather than the usual path.
      : Math.min(ch / 2 + PIN_CLEARANCE, H / 2 - CARD_MARGIN)
    map.panTo(map.unproject(L.point(pt.x, pt.y - shift), z), { animate: true, duration: 0.25 })
  }
  const onMoveRef = useRef(onMove)
  useEffect(() => { onMoveRef.current = onMove }, [onMove])

  // Both gates are FUNCTIONS, read live at event time — never snapshotted into the
  // marker closures. The markers effect only re-runs on a listings/filter redraw, so a
  // captured value would survive a window resize or a mouse being plugged in, leaving
  // the handlers on the wrong branch until something unrelated forced a rebuild.
  const isHoverable = () =>
    typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches
  // ⚠️ The two-step is gated on LAYOUT, not on pointer type. What makes scrolling the
  // feed destructive is *where the feed is*: listings-explorer stacks it BELOW the map
  // under lg and puts it BESIDE the map at lg+. Below → a scroll drags the page off the
  // map the user is reading; beside → it costs nothing. Gating on `hover:hover` instead
  // got this wrong in both directions: a touchscreen laptop took the desktop branch on a
  // finger tap, and a narrow desktop window took it while the list sat below the map —
  // i.e. exactly the bug the two-step exists to prevent. (Caught by cross-family review.)
  const listIsBeside = () =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches

  // Touch two-step (user decision 2026-07-14): where the feed is stacked below, a pin
  // tap only opens the card; the FIRST tap on that card scrolls the feed to it, the
  // second opens the listing.
  const peekedRef = useRef<string | null>(null)
  /** The open listing card's object, which may have come from outside the current feed page. */
  const openCardObjRef = useRef<SerializedListingCard | null>(null)

  const openCard = (l: SerializedListingCard, center = false, scroll = listIsBeside()) => {
    if (cardIdRef.current !== l.id) peekedRef.current = null
    cardIdRef.current = l.id; setCard(l)
    /**
     * ⛔ THE OPEN CARD'S OWN OBJECT, because it is not always in `listings` (reviewer). A unit
     * opened from the building strip was fetched by that card, so `listingsRef.current.find(...)`
     * in the move handler misses it entirely and silently skips re-placing — the card then froze at
     * one pixel while the map moved under it, which is precisely the bug just fixed for the
     * building card.
     */
    openCardObjRef.current = l
    if (center) recenterOnPin(l)
    placeCardFor(l); onHover?.(l.id)
    if (scroll) onPinOpen?.(l.id)
  }
  // Tap/click on the popup card itself.
  const activateCard = (l: SerializedListingCard) => {
    // No feed to scroll to (the listing-detail location map passes no onPinOpen), or the
    // feed is a side column that's already visible → never swallow the first tap.
    if (!onPinOpen || listIsBeside() || peekedRef.current === l.id) { onOpenListing(l); return }
    peekedRef.current = l.id
    onPinOpen(l.id) // first tap: bring its card into view in the feed below
  }
  /**
   * ⚠️ POSITIONED FROM THE MARKER'S OWN LATLNG, not from the click event. A click on a Leaflet
   * marker reports the pointer, so the card would hang off wherever inside the pin the finger
   * landed and drift between taps; projecting the pin's coordinate pins the card to the pin.
   */
  /**
   * ⛔ CLAMPED ON BOTH AXES, AND THE COMMENT USED TO CLAIM THAT WITHOUT DOING IT (reviewers). Only
   * `x` was bounded; `y` was the raw pin position, so on a short map — a phone's 60dvh view, or the
   * listing-detail map — the card simply ran off the bottom and the carousel and its button were
   * unreachable. Worse, `above` was decided against a fixed 400px, which on a container SHORTER
   * than that is never satisfiable, so the card could only ever be placed downward, i.e. always off
   * the edge. Below that height it is centred instead, the same escape the listing card uses.
   */
  const buildingCardPlacement = (pt: { x: number; y: number }, el: HTMLElement) => {
    const w = Math.min(360, el.clientWidth - 24)
    const CARD_H = 400
    const x = Math.min(Math.max(pt.x, w / 2 + 8), Math.max(w / 2 + 8, el.clientWidth - w / 2 - 8))
    if (el.clientHeight < CARD_H + 28) {
      return { x: el.clientWidth / 2, y: el.clientHeight / 2, above: false, centered: true }
    }
    /**
     * ⚠️ WHICHEVER SIDE HAS MORE ROOM, not "above if the pin is low enough". On a mid-height map a
     * pin can have too little room BOTH ways, and picking by a fixed threshold then clamped the
     * card back over the pin it belongs to (reviewer). Comparing the two gaps at least puts it on
     * the roomier side; the clamp still keeps it inside.
     */
    const above = pt.y > el.clientHeight - pt.y
    const y = above
      ? Math.max(pt.y, CARD_H + 24)
      : Math.min(pt.y, el.clientHeight - CARD_H - 14)
    return { x, y, above, centered: false }
  }

  const openBuildingCard = (b: BuildingPin) => {
    const map = mapInstanceRef.current, el = mapRef.current
    setBuildingCard(b)
    if (!map || !el) return
    const pt = map.latLngToContainerPoint([b.lat, b.lng])
    /**
     * ⛔ CLAMPED INSIDE THE MAP, BOTH AXES. The first version placed the card above the pin whenever
     * `y > 260` and left x alone, which put its top edge off the top of the map for any pin in the
     * upper half — the header and hero were simply cut off. The card is ~360 wide and ~400 tall, so
     * it goes ABOVE only when that much room genuinely exists above the pin, and its centre is
     * pulled back inside the container so a pin near either edge cannot push it out of view.
     */
    setBuildingCardPos(buildingCardPlacement(pt, el))
  }
  /** The building whose card is open, for the map handlers captured once at init. */
  const buildingCardRef = useRef<BuildingPin | null>(null)
  buildingCardRef.current = buildingCard
  const openBuildingCardRef = useRef(openBuildingCard)
  openBuildingCardRef.current = openBuildingCard
  const closeBuildingCardRef = useRef<() => void>(() => {})
  const closeBuildingCard = () => { setBuildingCard(null); setBuildingCardPos(null) }
  closeBuildingCardRef.current = closeBuildingCard

  const closeCard = () => { cardIdRef.current = null; peekedRef.current = null; openCardObjRef.current = null; setCard(null); setCardPos(null); onHover?.(null) }
  // Desktop hover UX: keep the card open while the cursor is over the marker OR the
  // card, and close it gracefully a beat after the cursor leaves both — so it never
  // persists over the cards behind it (and the small grace period lets the cursor
  // travel from the pin onto the card without it vanishing).
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null } }
  const scheduleClose = () => { cancelClose(); closeTimer.current = setTimeout(() => closeCard(), 220) }
  useEffect(() => () => cancelClose(), [])

  useEffect(() => {
    let cancelled = false
    loadLeaflet(
      () => { if (!cancelled) setReady(true) },
      () => { if (!cancelled) setLoadError(true) },
    )
    return () => { cancelled = true } // don't setReady after unmount (stale script 'load')
  }, [loadTry])

  // Init map once Leaflet is ready.
  useEffect(() => {
    if (!ready || !mapRef.current || mapInstanceRef.current) return
    const L = (window as any).L
    // Leaflet's own attribution control stays OFF — the credit is rendered by <MapCredit> below
    // so it can conform to the design language. Turning this on would double the credit.
    const map = L.map(mapRef.current, { zoomControl: true, attributionControl: false, scrollWheelZoom: true })
      .setView([10.7769, 106.7009], 12)
    // Keep +/- in the bottom-right — the info card pops centred ABOVE a tapped pin (upper
    // half of the map), so a top-left control would sit under it. Bottom corner stays clear.
    map.zoomControl.setPosition('bottomright')
    map.on('moveend', () => { const c = map.getCenter(); onMoveRef.current?.({ lat: c.lat, lng: c.lng }) })
    /**
     * ⚠️ ZOOM IS STATE SO THE PINS CAN RE-LABEL, and it is deliberately COARSE — only whether we
     * are at or above LABEL_ZOOM, never the number itself. Storing the raw zoom would re-run the
     * restyle effect on every one of the ~18 zoom levels; storing the boolean means it runs twice,
     * at the crossing, which is the only place the label actually changes.
     */
    map.on('zoomend', () => setLabelled(map.getZoom() >= LABEL_ZOOM))
    setLabelled(map.getZoom() >= LABEL_ZOOM)
    queueMicrotask(() => { const c = map.getCenter(); onMoveRef.current?.({ lat: c.lat, lng: c.lng }) })
    // Tile weight: retina (@2x) tiles are ~4× the bytes and TIME OUT on slow mobile networks
    // (the cartocdn ERR_TIMED_OUT spam). Drop to 1× when the connection is slow or Save-Data
    // is on; keep crisp @2x on fast / unknown connections.
    const conn = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }).connection
    const lightTiles = !!conn && (conn.saveData === true || (!!conn.effectiveType && conn.effectiveType !== '4g'))
    const retina = !lightTiles && L.Browser.retina ? '@2x' : ''
    L.tileLayer(basemapTileUrl(retina as '@2x' | ''), {
      maxZoom: 19,
      keepBuffer: 1,        // hold fewer off-screen tiles → fewer requests on slow links
      updateWhenIdle: true, // defer tile fetches until a pan/zoom settles
    }).addTo(map)
    map.on('click', () => { closeCard(); closeBuildingCardRef.current() }) // tap the map background → close both cards
    // Keep the card glued to its pin while the map pans/zooms.
    map.on('move zoom', () => {
      const id = cardIdRef.current
      if (id) {
        const l = listingsRef.current.find((x) => x.id === id) ?? (openCardObjRef.current?.id === id ? openCardObjRef.current : undefined)
        if (l) placeCardFor(l)
      }
      /**
       * ⛔ THE BUILDING CARD FOLLOWS THE MAP TOO — both reviewers caught that it did not. Its
       * position was projected once at tap time and never again, so panning one screen left the
       * card floating over empty tiles, anchored to a pixel coordinate that no longer meant
       * anything. This is the very handler the listing card has for that reason; the building card
       * simply was not in it.
       */
      const b = buildingCardRef.current
      const el2 = mapRef.current
      if (b && el2) {
        const p2 = map.latLngToContainerPoint([b.lat, b.lng])
        /**
         * ⛔ OFF THE MAP MEANS CLOSED, NOT CLAMPED TO THE EDGE (reviewers). The placement function
         * pulls the card inside the container on both axes, which is right while the pin is
         * visible and wrong the moment it is not: panning two screens away left the card pasted to
         * the edge, still describing a tower nobody could see. A bounds check on the PIN is the
         * thing; the clamp only ever keeps a visible pin's card from overhanging.
         */
        if (p2.x < -40 || p2.y < -40 || p2.x > el2.clientWidth + 40 || p2.y > el2.clientHeight + 40) {
          closeBuildingCardRef.current()
        } else {
          setBuildingCardPos(buildingCardPlacement(p2, el2))
        }
      }
    })
    mapInstanceRef.current = map
    const sizer = setTimeout(() => map.invalidateSize(), 80)
    // Destroy the map + its global listeners on unmount (e.g. toggling away from
    // map view) — otherwise each toggle leaks a Leaflet instance + DOM listeners.
    return () => {
      clearTimeout(sizer)
      // Halt any in-flight pan/zoom/fly animation BEFORE removing the map: an animation
      // frame that runs after remove() reads getPosition(_mapPane) on a deleted pane →
      // "Cannot read properties of undefined (reading '_leaflet_pos')". stop() cancels it.
      map.stop()
      map.off()
      map.remove()
      mapInstanceRef.current = null
      markersRef.current.clear()
      // The html cache is keyed by marker id and those ids are reused across redraws, so it must
      // be dropped with the markers — otherwise a rebuilt pin matches a stale entry and skips its
      // first paint, leaving the previous listing's price on a marker that is now someone else's.
      markerHtmlRef.current.clear()
      areaShapeRef.current = null // removed with the map; drop the stale ref
    }
  }, [ready])

  // Draw / refresh markers when listings change.
  useEffect(() => {
    if (!ready || !mapInstanceRef.current) return
    const L = (window as any).L
    const map = mapInstanceRef.current

    markersRef.current.forEach((m) => map.removeLayer(m))
    markersRef.current.clear()
    markerHtmlRef.current.clear()
    // Keep the open card UNLESS its listing is gone (e.g. filtered out). A redraw
    // alone must NOT close it — otherwise it flickers shut right after opening.
    setCard((c) => {
      // Re-resolve to the FRESH row from the new set (price/status may have
      // changed on the redraw) — returning the stale `c` object would pin the
      // open card to outdated data.
      const fresh = c ? listings.find((l) => l.id === c.id) : null
      if (!fresh) cardIdRef.current = null
      return fresh ?? null
    })

    // On hover-capable devices (desktop), HOVER reveals the card so the user can
    // browse pins fast; CLICK centres the pin and opens its card (same as touch) —
    // navigation happens by clicking the card, never straight off the pin.
    // isHoverable()/listIsBeside() are called INSIDE each handler, never hoisted here:
    // this effect re-runs only on a listings/filter redraw, so a hoisted value would
    // outlive a resize or an input-mode change.

    const bounds: [number, number][] = []

    /**
     * ⛔ BUILDING PINS STAND IN FOR GROUPED UNITS, AND ONLY FOR THOSE. Rever geocodes the project,
     * so 157 units land on one point and render as one unreachable pile — the whole reason this
     * exists. Drawing one pin per project fixes that, but every OTHER listing must keep its own
     * pin and its existing behaviour, which a reviewer flagged explicitly: the ordinary pin path
     * carries the popup height-sync and the touch two-step and has nothing to do with buildings.
     * ⚠️ WHILE A TOWER IS SELECTED WE GO BACK TO INDIVIDUAL PINS for its units — otherwise drilling
     * in would show one pin and no way to tell its units apart.
     */
    /**
     * ⛔ GROUPING STAYS ON WHILE A TOWER IS SELECTED, AND TURNING IT OFF WAS THE BUG. The first
     * version drew individual pins on drill-in — but every unit in a project shares ONE geocode, so
     * those 157 pins land on the same pixel and the map snaps back to the unreadable pile this
     * feature exists to remove. There is nothing to see per unit on a map; the units are read in
     * the list beside it. So the pins stay per-building and the selected one is highlighted.
     */
    const groupingOn = (buildings?.length ?? 0) > 0
    if (groupingOn) {
      buildings!.forEach((b) => {
        bounds.push([b.lat, b.lng])
        const active = selectedBuilding === b.key
        /**
         * ⚠️ `'other'`, NOT `'apartment'` (reviewer). `glyph` is optional on the wire, so a payload
         * without it is a real possibility — an in-flight response from the previous revision during
         * a deploy swap, or the edge-cached /api/listings/buildings JSON, which can outlive a deploy
         * by hours unless purged. Defaulting to the commonest kind would draw a residential tower on
         * an office-only project and look authoritative doing it; the neutral mark is what the
         * server itself returns when it cannot classify.
         */
        const bGlyph = b.glyph ?? 'other'
        const icon = L.divIcon({
          html: buildingPinHtml(b.name, b.count, active, bGlyph, map.getZoom() >= LABEL_ZOOM),
          className: 'eno-pin eno-pin-building',
          iconSize: [0, 0],
        })
        /**
         * ⚠️ `title` AS WELL AS `alt`. Below LABEL_ZOOM the chip carries no name, so a desktop
         * reader needs the identity BEFORE committing to a click — a reviewer's point, and the
         * native tooltip is the cheapest thing that cannot overlap or need its own layer.
         */
        const marker = L.marker([b.lat, b.lng], { icon, riseOnHover: true, title: `${b.name} — ${b.count} ${tr('available', 'căn còn trống')}` }).addTo(map)
        if (active) marker.setZIndexOffset(1000)
        /**
         * A building pin has no card of its own: it narrows the feed beside it, which is where the
         * units are readable. One tap on every input — there is nothing to two-step.
         * ⚠️ Tapping the SELECTED tower again clears it, so the pin is its own way back out and the
         * user is never stranded inside one building with only the list header to escape by.
         * ⚠️ Called through a ref: an inline callback prop changes identity every render, and this
         * effect's deps would then rebuild every marker constantly — which reads as "clicking does
         * nothing". Same reason `listings` is mirrored into a ref above.
         */
        marker.on('click', () => {
          /**
           * One tap does both halves of what a building pin is for: the card shows the project and
           * its units on the map, and the rail beside the map narrows to the same tower. Re-tapping
           * the ACTIVE pin clears both, so the pin stays its own way back out — the invariant the
           * original handler documented, now covering the card too.
           */
          /**
           * ⛔ DECIDED ON WHETHER THIS TOWER'S CARD IS OPEN, NOT ON `active` ALONE (reviewer). A tap
           * on the map background closes the card but deliberately leaves the rail narrowed — so
           * with `active` as the only test, the pin was still "active" and the next tap took the
           * clear branch instead of reopening. The card could never be got back without first
           * clearing and tapping twice: a one-shot pin. Reopening is the obvious meaning of tapping
           * a pin whose card is not showing, and the rail's own "All buildings" button remains the
           * way out of the filter.
           */
          if (buildingCardRef.current?.key === b.key) { onSelectBuildingRef.current?.(null); closeBuildingCardRef.current() }
          else { onSelectBuildingRef.current?.(b.key); openBuildingCardRef.current(b) }
        })
        markersRef.current.set(`building:${b.key}`, marker)
      })
    }

    // ⚠️ `groupingOn` HIDES ONLY THE UNITS A BUILDING PIN ALREADY REPRESENTS. A listing with no
    // buildingKey is not part of any group and must still get its own pin, or it vanishes from the
    // map entirely while remaining in the list beside it.
    /**
     * ⛔ ONLY HIDE A UNIT THAT A DRAWN PIN ACTUALLY REPRESENTS. This used to drop every listing with
     * ANY `buildingKey` as soon as one building pin existed — but the route drops keys missing from
     * the generated module, and the generator skips slugs with no coordinates. A unit in one of
     * those buildings then got no building pin AND no pin of its own: present in the list, absent
     * from the map, with nothing to indicate it. Checking against the keys actually drawn keeps the
     * two in step by construction. Found in review.
     */
    const drawnKeys = new Set((buildings ?? []).map((b) => b.key))
    const pinnedIndividually = groupingOn
      ? listings.filter((l) => !l.buildingKey || !drawnKeys.has(l.buildingKey))
      : listings
    // ⚠️ With grouping on, a drilled-in tower contributes NO individual pins — its units are all at
    // the building's own coordinate and are read in the list, not on the map.
    pinnedIndividually.forEach((l) => {
      const { lat, lng } = getListingCoordinates(l)
      bounds.push([lat, lng])
      const lGlyph = mapGlyphFor(l.subcategorySlug)
      const icon = L.divIcon({ html: pinHtml(pinLabel(l, locale, displayCurrency, displayRate), selectedId === l.id, lGlyph), className: 'eno-pin', iconSize: [0, 0] })
      // `alt` gives the pin an accessible name (the visible label is just a price
      // string); keyboard users close the popup card via Escape on the wrapper.
      /**
       * ⛔ `title`, NOT `alt` — AND THAT IS A LEAFLET FACT, NOT A PREFERENCE (reviewer). Leaflet
       * writes `alt` only when the icon element is an `<img>`; every pin here is an `L.divIcon`,
       * i.e. a `<div>`, so an `alt` option is silently dropped and never reaches the DOM. Since the
       * glyph `<svg>` is `aria-hidden` and the visible text is a bare price, an `alt` that never
       * lands would have left the pin's entire accessible name as "6.8M". `title` IS written (it is
       * also what gives the desktop hover tooltip), so it carries both jobs.
       * ⚠️ AND IT IS TRANSLATED. `.en` was hardcoded here at first, which on a Vietnamese-first
       * marketplace announced "Apartment — …" to a vi reader; MAP_GLYPH_LABEL carries both.
       */
      // The vi nouns are stored lowercase because they are counted ("157 căn hộ"); a tooltip is a
      // label, so it opens with a capital.
      const viName = MAP_GLYPH_LABEL[lGlyph].vi
      const glyphName = tr(MAP_GLYPH_LABEL[lGlyph].en, viName.charAt(0).toUpperCase() + viName.slice(1))
      const marker = L.marker([lat, lng], { icon, riseOnHover: true, title: `${glyphName} — ${l.title}` }).addTo(map)
      // A rebuild mid-selection must keep the selected pin on top — the styling
      // effect only runs on [selectedId, ready], not on a redraw.
      if (selectedId === l.id) marker.setZIndexOffset(1000)
      marker.on('click', () => {
        // Click = centre the pin + show the card on EVERY input (mobile pattern
        // everywhere, user decision 2026-07-06); the card itself opens the page.
        // The pin scrolls the feed ONLY when the feed is a side column — stacked
        // below, that would drag the page off the map (see the two-step note above)
        // and the card's first tap does it instead.
        if (!isHoverable() && cardIdRef.current === l.id) onOpenListing(l) // touch: 2nd tap on the pin still opens
        else openCard(l, true, listIsBeside())
      })
      marker.on('mouseover', () => { if (isHoverable()) { cancelClose(); openCard(l) } else { onHover?.(l.id) } })
      marker.on('mouseout', () => { if (isHoverable()) { scheduleClose() } else { onHover?.(null) } })
      markersRef.current.set(l.id, marker)
    })

    // "Search near you" → draw / update the radius circle centred on the picked point
    // (listings are already narrowed to this radius upstream). Remove it when cleared.
    if (nearby) {
      /**
       * ⛔ A RECTANGLE, NOT A CIRCLE, BECAUSE A RECTANGLE IS WHAT THE DATABASE FILTERS. The area
       * search is a lat/lng range pair (src/lib/geo-radius.ts) — an exact circle would have meant
       * handing the feed an `id IN (…)` set of 28,224 ids at a 10 km radius, which is not a query
       * to hand Postgres. A box is ~27% larger than the circle it contains and reaches √2·r into
       * the corners, so a drawn circle over a box filter would put visible results OUTSIDE the ring
       * the reader was promised. Drawing the true shape is the honest option, and it is what
       * "search this area" means on every other map.
       */
      const b = radiusBoundingBox(nearby)
      const bounds: [[number, number], [number, number]] = [[b.minLat, b.minLng], [b.maxLat, b.maxLng]]
      if (areaShapeRef.current) {
        areaShapeRef.current.setBounds(bounds)
      } else {
        /**
         * ⛔ `interactive: false`, OR THE SEARCH AREA EATS EVERY PIN INSIDE IT. A filled Leaflet
         * vector is a click target across its whole fill, so this overlay sat on top of exactly the
         * pins the reader drew it around — the same trap the boundary outline below already guards
         * against, missed here because the shape predates that rule (the original L.circle had it
         * too). Confirmed from a live DOM: the path rendered with `class="leaflet-interactive"`.
         */
        areaShapeRef.current = L.rectangle(bounds, { interactive: false, color: '#0A66C2', weight: 1.5, fillColor: '#0A66C2', fillOpacity: 0.06 }).addTo(map)
      }
    } else if (areaShapeRef.current) {
      map.removeLayer(areaShapeRef.current)
      areaShapeRef.current = null
    }

    // Auto-fit when the FILTER context changes — district, AREA (province/ward via
    // areaKey), or the near-you centre/radius, or the result set being replaced (first
    // item changes) — NOT on infinite-scroll append (which keeps the same first item).
    const nearKey = nearby ? `${nearby.lat.toFixed(3)},${nearby.lng.toFixed(3)},${nearby.radiusKm}` : ''
    const fitKey = `${activeDistrict}|${areaKey ?? ''}|${nearKey}|${listings[0]?.id ?? ''}`
    /**
     * ⛔ DO NOT AUTO-FIT WHILE A BUILDING IS SELECTED. `fitKey` includes `listings[0].id`, so
     * drilling into a tower changes it and would fit to `bounds` — which holds EVERY building pin,
     * zooming the map out at the exact moment the reader asked to look at one tower. The dedicated
     * flyTo effect owns the viewport here. Both are effects and this one is declared first, so it
     * previously only "worked" by ordering; relying on that is how a refactor reintroduces it.
     * ⚠️ The key is still RECORDED, so clearing the selection does not then re-fit on stale state.
     */
    if (fitKeyRef.current !== fitKey && selectedBuilding) {
      fitKeyRef.current = fitKey
    } else if (fitKeyRef.current !== fitKey) {
      fitKeyRef.current = fitKey
      if (nearby && areaShapeRef.current) {
        // Fly to the selected radius — show exactly the area the buyer chose.
        map.fitBounds(areaShapeRef.current.getBounds(), { padding: [30, 30] })
      } else if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 })
      }
    }
    // Guard + CLEAR this deferred resize: it re-runs on every filter change and fires on
    // unmount otherwise — invalidateSize() on a removed map reads the deleted _mapPane's
    // position → the '_leaflet_pos' crash. The ref check skips a map that's been torn down.
    const sizeT = setTimeout(() => { if (mapInstanceRef.current === map) map.invalidateSize() }, 80)
    return () => clearTimeout(sizeT)
  }, [listings, ready, activeDistrict, areaKey, nearby, locale, buildings, selectedBuilding])

  /**
   * ⛔ A CARD MUST NOT OUTLIVE ITS PIN (reviewer). Change a filter so the tower falls out of the
   * result set and the marker layer is rebuilt without it — but the card kept its own copy of the
   * building and stayed open, re-anchored on every pan to a coordinate with no pin under it. The
   * explorer already clears a SELECTION that is no longer in the refetched list ("a building filter
   * the user cannot see must not survive"); this is the same rule for the card.
   * ⚠️ `buildings === undefined` means not loaded yet, which is not the same as "gone" — only an
   * actual list that omits the key closes it.
   */
  useEffect(() => {
    if (!buildingCard || !buildings) return
    if (!buildings.some((b) => b.key === buildingCard.key)) closeBuildingCard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildings, buildingCard])

  /**
   * THE AREA OUTLINE. A separate layer from the markers on purpose: it changes when the reader picks
   * a different ward or district, which is far rarer than a listings redraw, and rebuilding a
   * 500-point polygon on every feed refetch would be visible.
   *
   * ⚠️ NON-INTERACTIVE, AND THAT IS LOAD-BEARING. A filled Leaflet polygon swallows clicks, so an
   * outline over the map would eat every pin tap inside the area it describes — i.e. exactly the
   * pins the reader came to press. `interactive: false` lets the taps through.
   */
  useEffect(() => {
    if (!ready) return
    const L = (window as any).L
    const map = mapInstanceRef.current
    if (!map) return
    if (boundaryLayerRef.current) { map.removeLayer(boundaryLayerRef.current); boundaryLayerRef.current = null }
    if (!boundary) return
    try {
      boundaryLayerRef.current = L.geoJSON(boundary, {
        interactive: false,
        style: { color: '#0A66C2', weight: 2, opacity: 0.85, fillColor: '#0A66C2', fillOpacity: 0.05, dashArray: '4 3' },
      }).addTo(map)
      // Under the markers: the outline is context, the pins are the content.
      boundaryLayerRef.current.bringToBack?.()
    } catch {
      // A malformed geometry must not take the map down — no outline is a fine outcome.
      boundaryLayerRef.current = null
    }
  }, [boundary, ready])

  // Update marker styling on selection / hover (no full rebuild).
  useEffect(() => {
    if (!ready) return
    const L = (window as any).L
    /**
     * ⛔ THE LIVE ZOOM, NOT THE `labelled` STATE — a reviewer caught the race. The marker-BUILD
     * effect asks the map directly (`map.getZoom() >= LABEL_ZOOM`), so on a deep link that opens at
     * zoom 15 it correctly draws names; but `labelled` starts `false` and only becomes true after
     * the init effect's `setLabelled` commits. In that gap this effect ran with `false` and stripped
     * every name straight back off. Reading the map here means the two paths cannot disagree by
     * construction; `labelled` stays in the deps purely as the signal that a crossing happened.
     */
    const showNames = (mapInstanceRef.current?.getZoom() ?? 0) >= LABEL_ZOOM
    markersRef.current.forEach((marker, id) => {
      /**
       * ⛔ BUILDING MARKERS RE-LABEL THROUGH setIcon TOO, NEVER THROUGH A REBUILD. Crossing
       * LABEL_ZOOM changes what every building pin renders, and the obvious implementation — add
       * the zoom to the marker-BUILD effect's deps — would tear down and recreate every marker on
       * the crossing. That destroys the marker the reader is interacting with: the open card, the
       * touch two-step's `peeked` state and the captured click handlers all go with it, so a pin
       * tapped just before a pinch-zoom would silently stop responding. setIcon swaps only the
       * element. (This branch used to `return` on building keys, because `listings.find` cannot
       * match `building:<key>` — which is why they never restyled at all.)
       */
      if (id.startsWith('building:')) {
        const b = buildings?.find((x) => `building:${x.key}` === id)
        if (!b) return
        const active = selectedBuilding === b.key
        const html = buildingPinHtml(b.name, b.count, active, b.glyph ?? 'other', showNames)
        if (markerHtmlRef.current.get(id) !== html) {
          marker.setIcon(L.divIcon({ html, className: 'eno-pin eno-pin-building', iconSize: [0, 0] }))
          markerHtmlRef.current.set(id, html)
        }
        marker.setZIndexOffset(active ? 1000 : 0)
        return
      }
      const l = listings.find((x) => x.id === id)
      if (!l) return
      const html = pinHtml(pinLabel(l, locale, displayCurrency, displayRate), selectedId === id, mapGlyphFor(l.subcategorySlug))
      if (markerHtmlRef.current.get(id) !== html) {
        marker.setIcon(L.divIcon({ html, className: 'eno-pin', iconSize: [0, 0] }))
        markerHtmlRef.current.set(id, html)
      }
      if (selectedId === id) marker.setZIndexOffset(1000)
      else marker.setZIndexOffset(0)
    })
    // ⚠️ currency/rate belong on THIS effect, not the marker-BUILD effect above. Rates arrive from
    // /api/fx a moment after first paint, and adding them to the build deps would tear down and
    // recreate every marker — and re-fit the bounds — the instant they land. This effect only
    // calls setIcon on markers that already exist, which is exactly what a re-label needs.
  }, [selectedId, ready, listings, locale, displayCurrency, displayRate, labelled, buildings, selectedBuilding])

  // Fly to a specific listing when requested ("locate on map").
  useEffect(() => {
    if (!ready || !focusId || !mapInstanceRef.current) return
    const l = listings.find((x) => x.id === focusId)
    if (!l) return
    const { lat, lng } = getListingCoordinates(l)
    mapInstanceRef.current.flyTo([lat, lng], 15, { duration: 0.6 })
  }, [focusId, ready])

  /**
   * Centre on the tower the user just drilled into.
   * ⛔ WITHOUT THIS, SELECTING DID NOTHING VISIBLE. The pins are rebuilt with the selected one
   * highlighted, but the viewport does not move — and if the reader picked a pin near the edge, or
   * the list scrolled the map out of view, the only feedback was a list quietly changing behind
   * them. Flying makes the selection legible as a selection.
   * ⚠️ Deliberately NOT re-fitting bounds to the single building: the other towers stay on screen
   * so the reader can move between them, which is the whole point of keeping them drawn.
   */
  const flownToRef = useRef<string | null>(null)
  useEffect(() => {
    if (!ready || !selectedBuilding || !mapInstanceRef.current) {
      if (!selectedBuilding) flownToRef.current = null
      return
    }
    /**
     * ⛔ FLY ONCE PER SELECTION, NOT ONCE PER REFETCH. This used to depend on `buildings`, and
     * react-query hands back a new array on every refetch — on window refocus past the 60s
     * staleTime, and on any filter change. A reader who drilled in and then panned across the city
     * got yanked back to zoom 15 on the tower, repeatedly, for as long as it stayed selected.
     * The guard is the SELECTION, so panning is never overridden until the user picks another one.
     */
    if (flownToRef.current === selectedBuilding) return
    const b = buildings?.find((x) => x.key === selectedBuilding)
    if (!b) return
    flownToRef.current = selectedBuilding
    mapInstanceRef.current.flyTo([b.lat, b.lng], 15, { duration: 0.6 })
  }, [selectedBuilding, ready, buildings])

  return (
    // `isolate` keeps Leaflet's internal z-index (panes/controls up to ~1000)
    // contained so it can never render above modals/dialogs (which sit at z-50).
    // Escape closes the popup card (keyboard parity with the map-background tap);
    // the handler sits on the wrapper so it catches keys from both the Leaflet
    // container (focusable via its keyboard handler) and the card's controls.
    <div
      className="w-full h-full relative isolate bg-tint"
      onKeyDown={(e) => { if (e.key === 'Escape' && cardIdRef.current) { e.stopPropagation(); closeCard() } }}
    >
      {!ready && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted z-20 select-none">
          {loadError ? (
            <>
              <span className="text-3xs font-bold text-slate-700 uppercase tracking-wider">
                {tr('Map failed to load', 'Không tải được bản đồ')}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  // The dead tag would swallow the retry (its load/error already fired) —
                  // drop it so loadLeaflet injects a fresh script.
                  document.getElementById('leaflet-js')?.remove()
                  setLoadError(false); setLoadTry((t) => t + 1)
                }}
              >
                {tr('Retry', 'Thử lại')}
              </Button>
            </>
          ) : (
            /**
             * ⛔ A SKELETON OF THE MAP, NOT A SPINNER. This shipped a spinner and the words "Loading
             * map…" INSIDE THE FIRST HTML of every listing page — measured at byte 100,103 of the
             * PDP response — so the one placeholder a reader met on arrival was a rotating circle
             * that says nothing about what is coming. A spinner is the right control for work of
             * unknown shape; a map is a known shape, so the honest placeholder looks like a map.
             *
             * ⚠️ THE MOTION IS CONFINED TO THE PIN'S PILL, and it uses the house `.shimmer` sweep
             * rather than `animate-pulse` — which this codebase bans in four separate files because
             * it fades the whole SUBTREE to 50% opacity and drops small text below contrast. A
             * shimmering 260px slab would also be more distracting than the spinner it replaces;
             * one moving pill says "still working" without flashing the panel.
             *
             * `aria-busy` + a visually-hidden label keeps the announcement a screen reader used to
             * get from the visible "Loading map…" text.
             */
            <div className="absolute inset-0 select-none" aria-busy="true">
              {/* The faint grid a street map resolves into. */}
              <div
                aria-hidden="true"
                className="absolute inset-0 opacity-[0.35]"
                style={{
                  backgroundImage:
                    'linear-gradient(to right, var(--color-border) 1px, transparent 1px), linear-gradient(to bottom, var(--color-border) 1px, transparent 1px)',
                  backgroundSize: '48px 48px',
                }}
              />
              {/* ⚠️ THE BRANDED LOADER SITS WHERE THE PIN WILL BE (owner, 2026-09-24). The skeleton
                  carries the SHAPE of what is coming — grid, attribution strip — and the flip tile
                  says it is still being fetched; a skeleton alone reads as an empty map on a slow
                  link. The two are complementary, not alternatives. */}
              <EnoLoader className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" label={tr('Loading map…', 'Đang tải bản đồ...')} />
              {/* The attribution strip's own footprint, so nothing shifts when it arrives. */}
              <div aria-hidden="true" className="absolute bottom-1.5 left-1.5 h-4 w-14 rounded-lg bg-muted" />
            </div>
          )}
        </div>
      )}
      <div ref={mapRef} className="w-full h-full" />

      {/* Gated on `ready` for the same reason as the trip map: no tiles, nothing to credit, and the
          loading/retry panel should not have a credit sitting over it.

          ⚠️ ONE BOUNDED CASE IS ACCEPTED, not overlooked: the floating listing card is z-[1100], so a
          card opened over a pin low and to the left CAN cover this chip. Hovering all 12 pins on the
          live explorer never reproduced it, but the geometry allows it. It is deliberately NOT fixed
          by out-ranking the card — the card is what the reader just asked for, and a credit painted
          over it would be worse. This is also exactly how stock Leaflet behaves: its own attribution
          control sits under an open popup. The map displays the credit; a transient overlay the user
          opened themselves does not undo that. */}
      {ready && <MapCredit className="bottom-1 left-2" />}

      {/* Airbnb-style info card — pops ON TOP of the tapped pin, magnifying out of it */}
      {/**
        * ⚠️ RENDERED BEFORE THE LISTING CARD so the listing card wins on z-order if both are ever
        * open at once — tapping a unit inside this card opens that unit's own card, and the one the
        * reader just asked for must be the one on top.
        */}
      {buildingCard && buildingCardPos && (
        <div
          className="absolute z-[1100] pointer-events-none"
          style={{
            left: buildingCardPos.x,
            top: buildingCardPos.centered
              ? buildingCardPos.y
              : buildingCardPos.above ? buildingCardPos.y - 14 : buildingCardPos.y + 14,
            transform: buildingCardPos.centered
              ? 'translate(-50%, -50%)'
              : buildingCardPos.above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
          }}
        >
          <div className="pointer-events-auto duration-150 ease-out animate-in fade-in zoom-in-95">
            <MapBuildingCard
              /**
               * ⛔ THE LIVE PIN, NOT THE SNAPSHOT TAKEN AT TAP TIME (reviewer). `buildingCard` holds
               * the BuildingPin as it was when tapped; change the price ceiling with the card open
               * and the strip refetches under the new filters while the header kept saying
               * "12 apartments · 3–8 tỷ" over three ≤5 tỷ units. The count and range belong to the
               * refreshed pin, so read them from `buildings` every render and fall back to the
               * snapshot only while that list is still in flight.
               */
              building={buildings?.find((b) => b.key === buildingCard.key) ?? buildingCard}
              width={Math.min(360, (mapRef.current?.clientWidth ?? 360) - 24)}
              feedParams={feedParams}
              onOpenListing={(l) => { closeBuildingCard(); activateCard(l) }}
              onSeeAll={(id) => { closeBuildingCard(); if (id) onPinOpen?.(id) }}
            />
          </div>
        </div>
      )}
      {card && cardPos && (
        <div
          className="absolute z-[1100] pointer-events-none"
          style={{
            left: cardPos.x,
            top: cardPos.centered ? cardPos.y : cardPos.above ? cardPos.y - 14 : cardPos.y + 14,
            transform: cardPos.centered
              ? 'translate(-50%, -50%)'
              : cardPos.above
                ? 'translate(-50%, -100%)'
                : 'translate(-50%, 0)',
          }}
        >
          <div
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            className={cn(
              'pointer-events-auto relative overflow-hidden rounded-2xl bg-popover shadow-pop duration-150 ease-out animate-in fade-in zoom-in-95',
              cardPos.centered ? 'origin-center' : cardPos.above ? 'origin-bottom' : 'origin-top',
            )}
            style={{ width: cardDims().w }}
          >
            {cardDims().compact ? (
              // Short map (listing detail) → slim horizontal card: thumb + title + price
              // + a close ✕. Fits within a ~260px-tall map without dwarfing it.
              <div className="flex items-center gap-2.5 p-2">
                <Button variant="bare" size="none" onClick={() => activateCard(card)} className="flex min-w-0 flex-1 items-center justify-start gap-2.5 whitespace-normal text-left font-normal cursor-pointer active:scale-100">
                  <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-tint">
                    {card.images[0] && (
                      <Image src={card.images[0]} alt="" fill sizes="44px" quality={60} unoptimized={isMockImageUrl(card.images[0]) || undefined} className="object-cover" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    {/* Same order as <ListingCard>: price → one-line title (owner, 2026-09-13). */}
                    <Price native price={card.price} currency={card.currency} priceUnit={card.priceUnit} className="block text-sm leading-tight" />
                    <span className="block truncate text-xs text-foreground"><LocalizedText text={card.title} vi={card.titleVi} i18n={card.titleI18n} /></span>
                    <span className="mt-0.5 block"><MapTravel to={getListingCoordinates(card)} userLoc={userLoc} state={locState} onRequest={requestLoc} compact /></span>
                  </span>
                </Button>
                {card.seller.officialPartner
                  ? <PartnerBadge asLink={false} className="shrink-0" />
                  : <TrustScore score={card.seller.trustScore} variant="mini" className="shrink-0" />}
                <MapsDirectionsButton to={getListingCoordinates(card)} className="h-8 w-8 shrink-0" />
              </div>
            ) : (
              <>
                {/* Favorite only — no ✕. Desktop closes on hover-out; mobile closes on
                    a tap outside the card (map background → closeCard). */}
                <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
                  <IconButton
                    size="sm"
                    variant="overlay"
                    tapTarget={false}
                    onClick={(e) => { e.stopPropagation(); toggle(card.id) }}
                    // Constant name + `aria-pressed` = the ARIA toggle pattern; see the note on
                    // listing-card.tsx's heart for why the label used to flip and no longer does.
                    aria-label={tr('Save listing', 'Lưu tin')}
                    aria-pressed={isFavorite(card.id)}
                    className="transition-transform hover:scale-110 active:scale-[0.96]"
                  >
                    {/* h-5 + the same overlay fill pair as the grid card's heart — one
                        save affordance, byte-identical across grid / map (icon ladder §4).
                        ⚠️ `aria-pressed` IS LOAD-BEARING, NOT JUST A11Y. The saved heart here used
                        to paint RED OUTLINE while every other card painted RED BOLD, on a
                        byte-identical className — because the Outline→Bold swap is a CSS rule in
                        globals.css keyed on the ANCESTOR control's selection state, and this button
                        declared none. So `.i-on` (the Bold layer) stayed at opacity 0 and
                        `text-destructive` merely recoloured the Outline layer underneath. The label
                        moved from state wording ("Saved") to action wording to match the other
                        hearts: with aria-pressed set, a state label reads as "Saved, pressed". */}
                    {/* ⚠️ `variant="overlay"` SUPPLIES THE PLATE AND THE INK — owner, 2026-08-29:
                        "images on the map too icons need plate". This heart sits on a listing photo
                        exactly as the grid card's does, and it previously relied on `text-white`
                        plus a shadow, which is invisible on a white product shot (measured on the
                        PDP: contrast 0). Setting a colour here would break dark mode, where the
                        variant paints a light plate and dark ink. Only the SAVED state keeps its
                        own red. */}
                    <Heart className={cn('icon-own-ink h-5 w-5 transition-colors', isFavorite(card.id)
              ? 'fill-current text-destructive'
              : 'fill-none')} />
                  </IconButton>
                </div>
                <Button variant="bare" size="none" onClick={() => activateCard(card)} className="block w-full whitespace-normal text-left font-normal cursor-pointer active:scale-100">
                  <div className="relative aspect-square w-full bg-tint">
                    {card.images[0] && (
                      <Image src={card.images[0]} alt="" fill sizes="280px" quality={60} unoptimized={isMockImageUrl(card.images[0]) || undefined} className="object-cover" />
                    )}
                    <ImageMark src={card.images[0]} />
                  </div>
                  {/* Same shape as <ListingCard>: price → one-line title → location, with the trust
                      chip closing the location line (owner, 2026-09-13). The price is the STORED đồng
                      amount, as on the cards and the pin — see pinLabel. */}
                  <div className="flex flex-col gap-0.5 p-3 pb-1.5">
                    <Price native price={card.price} currency={card.currency} priceUnit={card.priceUnit} className="text-lg leading-tight" />
                    <p className="truncate text-sm leading-snug text-foreground"><LocalizedText text={card.title} vi={card.titleVi} i18n={card.titleI18n} /></p>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="min-w-0 flex-1 truncate"><PopupPlace district={card.district} location={card.location} /></span>
                      {/* PARTNER REPLACES TRUST, as on the card — a partner must read the same one tap later. */}
                      {card.seller.officialPartner
                        ? <PartnerBadge asLink={false} className="shrink-0" />
                        : <TrustScore score={card.seller.trustScore} variant="mini" className="shrink-0" />}
                    </div>
                  </div>
                </Button>
                {/* Travel estimate — separate tap target, below the open-listing button.
                    The Google Maps directions FAB floats in the card's bottom-right corner
                    (opposite the favorite heart), clear of the short estimate text. */}
                <div className="px-3 pb-3 pr-12">
                  <MapTravel to={getListingCoordinates(card)} userLoc={userLoc} state={locState} onRequest={requestLoc} />
                </div>
                <MapsDirectionsButton to={getListingCoordinates(card)} className="absolute bottom-2.5 right-2.5 z-10 h-9 w-9" />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
