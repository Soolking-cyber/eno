'use client'

import { basemapTileUrl } from '@/lib/basemap'
import Image from 'next/image'
import { isMockImageUrl } from '@/lib/listing-image'
import { useEffect, useRef, useState } from 'react'
import { Heart, Info } from '@/components/ui/icons'
import { TrustScore } from './trust-score'
import { MapTravel, MapsDirectionsButton } from './map-travel'
import type { LatLng } from '@/lib/travel'
import type { SerializedListingCard } from '@/lib/types'
import { formatMoneyFull, compactPrice, moneyLocale, type MoneyLocale } from '@/lib/vnd'
import { useCurrency } from '@/context/currency-context'
import { useLanguage } from '@/context/language-context'
import { useFavorites } from '@/context/favorites-context'
import { LocalizedText } from './listing-content'
import { getListingCoordinates } from '@/lib/geo'
import type { Nearby } from './area-filter'
import { OSM_CREDIT, CARTO_CREDIT } from '@/lib/map-credit'
import { cn } from '@/lib/utils'
import { handleExternalClick } from '@/lib/native-browser'
import { Spinner } from '@/components/ui/spinner'
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
  // other surface, including the popup this very pin opens, honoured the viewer's display currency.
  // A USD reader saw "51M" on the pin and "$1,950" one tap later, on the same listing.
  // Mirrors price-range-filter.tsx's compactAmt: convert first, keep the vi shorthand only when the
  // viewer is actually reading đồng, and never emit a magnitude without its unit.
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

function pinHtml(label: string, active: boolean): string {
  // INVARIANT: label is interpolated into raw HTML — escape it (audit P2). Today every
  // caller feeds formatter output (digits + currency), but the safety must not depend
  // on that staying true.
  const esc = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const bg = active ? '#0a66c2' : '#ffffff'
  const color = active ? '#ffffff' : '#1a202c'
  const border = active ? '#0a66c2' : '#d8dee6'
  const scale = active ? 1.08 : 1
  return `<div style="transform:translate(-50%,-50%) scale(${scale});display:inline-block;background:${bg};color:${color};border:1px solid ${border};border-radius:9999px;padding:4px 9px;font-size:12px;font-weight:700;line-height:1;white-space:nowrap;box-shadow:0 1px 5px rgba(0,0,0,.22);transition:transform .12s ease, background .12s ease;">${esc}</div>`
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

export function ListingsMap({ listings, activeDistrict, onOpenListing, selectedId, onHover, focusId, nearby, areaKey, onPinOpen, onMove }: Props) {
  const { lang: uiLang, tr } = useLanguage()
  const { isFavorite, toggle } = useFavorites()
  const { format: formatPrice, currency: displayCurrency, rates: fxRates } = useCurrency()
  // /api/fx publishes 'currency per 1 VND', so this multiplies. Undefined until the rates land.
  const displayRate = displayCurrency && displayCurrency !== 'VND' && displayCurrency !== '₫' ? fxRates[displayCurrency] : undefined
  // Pin + card amounts follow the viewer's UI language from CONTEXT — a former
  // `lang` prop was a content-localization hint some hosts hardcoded (listing-
  // detail-map passed 'vi'), so it could never drive money formatting; it was
  // unused and has been removed.
  const locale = moneyLocale(uiLang)
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const markersRef = useRef<Map<string, any>>(new Map())
  const radiusCircleRef = useRef<any>(null) // the "search near you" radius overlay
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
  // Card pops ABOVE the tapped pin (anchored to its screen position) — `above`
  // flips it below the pin when there isn't room near the top edge.
  const [cardPos, setCardPos] = useState<{ x: number; y: number; above: boolean } | null>(null)
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
  const cardDims = () => {
    const el = mapRef.current
    const mapW = el?.clientWidth ?? 360
    const mapH = el?.clientHeight ?? 500
    const compact = mapH < 360
    // Compact is a horizontal card (thumb + title/price/travel + trust + Maps FAB) — it needs
    // real width so the "~19 min · 7.1 km from you" line sits on ONE row instead of wrapping.
    const w = Math.round(Math.min(compact ? 320 : 300, mapW - 24))
    const h = compact ? 96 : Math.round(w + 118) // square image (= w tall) + content block (~92) + travel row (~26); keep in sync with the card render so the flip + recenter math is right
    return { w, h, compact }
  }
  const placeCardFor = (l: SerializedListingCard) => {
    const map = mapInstanceRef.current, el = mapRef.current
    if (!map || !el) return
    const { w: cw, h: ch } = cardDims()
    const { lat, lng } = getListingCoordinates(l)
    const pt = map.latLngToContainerPoint([lat, lng])
    const W = el.clientWidth
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
    const shift = Math.min(cardDims().h / 2 + 10, el.clientHeight * 0.4)
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

  const openCard = (l: SerializedListingCard, center = false, scroll = listIsBeside()) => {
    if (cardIdRef.current !== l.id) peekedRef.current = null
    cardIdRef.current = l.id; setCard(l)
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
  const closeCard = () => { cardIdRef.current = null; peekedRef.current = null; setCard(null); setCardPos(null); onHover?.(null) }
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
    map.on('click', () => closeCard()) // tap the map background → close the card
    // Keep the card glued to its pin while the map pans/zooms.
    map.on('move zoom', () => {
      const id = cardIdRef.current
      if (!id) return
      const l = listingsRef.current.find((x) => x.id === id)
      if (l) placeCardFor(l)
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
      radiusCircleRef.current = null // removed with the map; drop the stale ref
    }
  }, [ready])

  // Draw / refresh markers when listings change.
  useEffect(() => {
    if (!ready || !mapInstanceRef.current) return
    const L = (window as any).L
    const map = mapInstanceRef.current

    markersRef.current.forEach((m) => map.removeLayer(m))
    markersRef.current.clear()
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
    listings.forEach((l) => {
      const { lat, lng } = getListingCoordinates(l)
      bounds.push([lat, lng])
      const icon = L.divIcon({ html: pinHtml(pinLabel(l, locale, displayCurrency, displayRate), selectedId === l.id), className: 'eno-pin', iconSize: [0, 0] })
      // `alt` gives the pin an accessible name (the visible label is just a price
      // string); keyboard users close the popup card via Escape on the wrapper.
      const marker = L.marker([lat, lng], { icon, riseOnHover: true, alt: l.title }).addTo(map)
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
      const center: [number, number] = [nearby.lat, nearby.lng]
      const radiusM = nearby.radiusKm * 1000
      if (radiusCircleRef.current) {
        radiusCircleRef.current.setLatLng(center).setRadius(radiusM)
      } else {
        radiusCircleRef.current = L.circle(center, { radius: radiusM, color: '#0A66C2', weight: 1.5, fillColor: '#0A66C2', fillOpacity: 0.06 }).addTo(map)
      }
    } else if (radiusCircleRef.current) {
      map.removeLayer(radiusCircleRef.current)
      radiusCircleRef.current = null
    }

    // Auto-fit when the FILTER context changes — district, AREA (province/ward via
    // areaKey), or the near-you centre/radius, or the result set being replaced (first
    // item changes) — NOT on infinite-scroll append (which keeps the same first item).
    const nearKey = nearby ? `${nearby.lat.toFixed(3)},${nearby.lng.toFixed(3)},${nearby.radiusKm}` : ''
    const fitKey = `${activeDistrict}|${areaKey ?? ''}|${nearKey}|${listings[0]?.id ?? ''}`
    if (fitKeyRef.current !== fitKey) {
      fitKeyRef.current = fitKey
      if (nearby && radiusCircleRef.current) {
        // Fly to the selected radius — show exactly the area the buyer chose.
        map.fitBounds(radiusCircleRef.current.getBounds(), { padding: [30, 30] })
      } else if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 })
      }
    }
    // Guard + CLEAR this deferred resize: it re-runs on every filter change and fires on
    // unmount otherwise — invalidateSize() on a removed map reads the deleted _mapPane's
    // position → the '_leaflet_pos' crash. The ref check skips a map that's been torn down.
    const sizeT = setTimeout(() => { if (mapInstanceRef.current === map) map.invalidateSize() }, 80)
    return () => clearTimeout(sizeT)
  }, [listings, ready, activeDistrict, areaKey, nearby, locale])

  // Update marker styling on selection / hover (no full rebuild).
  useEffect(() => {
    if (!ready) return
    const L = (window as any).L
    markersRef.current.forEach((marker, id) => {
      const l = listings.find((x) => x.id === id)
      if (!l) return
      marker.setIcon(L.divIcon({ html: pinHtml(pinLabel(l, locale, displayCurrency, displayRate), selectedId === id), className: 'eno-pin', iconSize: [0, 0] }))
      if (selectedId === id) marker.setZIndexOffset(1000)
      else marker.setZIndexOffset(0)
    })
    // ⚠️ currency/rate belong on THIS effect, not the marker-BUILD effect above. Rates arrive from
    // /api/fx a moment after first paint, and adding them to the build deps would tear down and
    // recreate every marker — and re-fit the bounds — the instant they land. This effect only
    // calls setIcon on markers that already exist, which is exactly what a re-label needs.
  }, [selectedId, ready, listings, locale, displayCurrency, displayRate])

  // Fly to a specific listing when requested ("locate on map").
  useEffect(() => {
    if (!ready || !focusId || !mapInstanceRef.current) return
    const l = listings.find((x) => x.id === focusId)
    if (!l) return
    const { lat, lng } = getListingCoordinates(l)
    mapInstanceRef.current.flyTo([lat, lng], 15, { duration: 0.6 })
  }, [focusId, ready])

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
            <>
              <Spinner size="md" />
              <span className="text-3xs font-bold text-slate-700 uppercase tracking-wider">
                {tr('Loading map…', 'Đang tải bản đồ...')}
              </span>
            </>
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
      {card && cardPos && (
        <div
          className="absolute z-[1100] pointer-events-none"
          style={{
            left: cardPos.x,
            top: cardPos.above ? cardPos.y - 14 : cardPos.y + 14,
            transform: cardPos.above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
          }}
        >
          <div
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            className={cn(
              'pointer-events-auto relative overflow-hidden rounded-2xl bg-popover shadow-pop duration-150 ease-out animate-in fade-in zoom-in-95',
              cardPos.above ? 'origin-bottom' : 'origin-top',
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
                    <span className="block truncate text-xs font-bold text-foreground"><LocalizedText text={card.title} vi={card.titleVi} i18n={card.titleI18n} /></span>
                    <span className="block text-xs font-bold text-accent-foreground">{card.currency === '₫' ? formatPrice(card.price, locale) : formatMoneyFull(card.price, card.currency, locale)}</span>
                    <span className="mt-0.5 block"><MapTravel to={getListingCoordinates(card)} userLoc={userLoc} state={locState} onRequest={requestLoc} compact /></span>
                  </span>
                </Button>
                <TrustScore score={card.seller.trustScore} variant="mini" className="shrink-0" />
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
                  </div>
                  <div className="p-3 pb-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-bold text-foreground"><LocalizedText text={card.title} vi={card.titleVi} i18n={card.titleI18n} /></p>
                      <TrustScore score={card.seller.trustScore} variant="mini" className="shrink-0" />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{card.district || card.location}</p>
                    <p className="mt-1 text-sm font-bold text-accent-foreground">{card.currency === '₫' ? formatPrice(card.price, locale) : formatMoneyFull(card.price, card.currency, locale)}</p>
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
