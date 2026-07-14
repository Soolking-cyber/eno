'use client'

import Image from 'next/image'
import { isMockImageUrl } from '@/lib/listing-image'
import { useEffect, useRef, useState } from 'react'
import { Heart } from 'lucide-react'
import { TrustScore } from './trust-score'
import { MapTravel, MapsDirectionsButton } from './map-travel'
import type { LatLng } from '@/lib/travel'
import type { SerializedListingCard } from '@/lib/types'
import { formatPrice } from '@/lib/types'
import { formatMoneyFull, compactPrice, moneyLocale, type MoneyLocale } from '@/lib/vnd'
import { useCurrency } from '@/context/currency-context'
import type { Language } from '@/context/language-context'
import { useLanguage } from '@/context/language-context'
import { useFavorites } from '@/context/favorites-context'
import { LocalizedText } from './listing-content'
import { getListingCoordinates } from '@/lib/geo'
import type { Nearby } from './area-filter'
import { cn } from '@/lib/utils'
import { Spinner } from '@/components/ui/spinner'

// Compact price for map labels (Airbnb-style price pins). VND uses the shared
// compactPrice, which follows the viewer's language — "850K" / "51M" / "1.2B"
// for everyone else (the Vietnamese shorthand is opaque to the expat audience),
// native "500k" / "51tr" / "1,2 tỷ" for vi; the rare non-₫ listing keeps its
// symbol-prefixed format.
function pinLabel(l: SerializedListingCard, locale: MoneyLocale): string {
  if (l.currency === '₫') return compactPrice(l.price, locale)
  return formatPrice(l.price, l.currency, l.priceUnit)
}

type Props = {
  listings: SerializedListingCard[]
  activeDistrict: string
  onOpenListing: (l: SerializedListingCard) => void
  lang: Language
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

function loadLeaflet(cb: () => void) {
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
    else existing.addEventListener('load', cb, { once: true })
    return
  }
  const s = document.createElement('script')
  s.id = 'leaflet-js'; s.src = LEAFLET_JS; s.async = true
  s.onload = () => cb()
  document.head.appendChild(s)
}

function pinHtml(label: string, active: boolean): string {
  const bg = active ? '#0a66c2' : '#ffffff'
  const color = active ? '#ffffff' : '#1a202c'
  const border = active ? '#0a66c2' : '#d8dee6'
  const scale = active ? 1.08 : 1
  return `<div style="transform:translate(-50%,-50%) scale(${scale});display:inline-block;background:${bg};color:${color};border:1px solid ${border};border-radius:9999px;padding:4px 9px;font-size:12px;font-weight:700;line-height:1;white-space:nowrap;box-shadow:0 1px 5px rgba(0,0,0,.22);transition:transform .12s ease, background .12s ease;">${label}</div>`
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function ListingsMap({ listings, activeDistrict, onOpenListing, lang, selectedId, onHover, focusId, nearby, areaKey, onPinOpen, onMove }: Props) {
  const { lang: uiLang, tr } = useLanguage()
  const { isFavorite, toggle } = useFavorites()
  const { format: formatPrice } = useCurrency()
  // Pin + card amounts follow the viewer's UI language from CONTEXT — the `lang`
  // prop is a content-localization hint some hosts hardcode (listing-detail-map
  // passes 'vi'), so it can't drive money formatting.
  const locale = moneyLocale(uiLang)
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const markersRef = useRef<Map<string, any>>(new Map())
  const radiusCircleRef = useRef<any>(null) // the "search near you" radius overlay
  const fitKeyRef = useRef<string>('') // last filter signature we auto-fit bounds for
  const [ready, setReady] = useState(false)
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
  onMoveRef.current = onMove

  // Hover-capable = desktop. Read live (not memoized) so a hybrid device that
  // switches input mid-session still gets the right branch.
  const isHoverable = () =>
    typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches

  // Touch two-step (user decision 2026-07-14). On mobile the feed sits BELOW the
  // map, so scrolling it on a pin tap yanks the page off the map the user is
  // reading. Instead: pin tap only opens the card; the FIRST tap on that card
  // scrolls the feed to it; the second opens the listing. Desktop is unchanged
  // (the feed is a side column — scrolling it costs the user nothing).
  const peekedRef = useRef<string | null>(null)

  const openCard = (l: SerializedListingCard, center = false, scroll = true) => {
    if (cardIdRef.current !== l.id) peekedRef.current = null
    cardIdRef.current = l.id; setCard(l)
    if (center) recenterOnPin(l)
    placeCardFor(l); onHover?.(l.id)
    if (scroll) onPinOpen?.(l.id)
  }
  // Tap/click on the popup card itself.
  const activateCard = (l: SerializedListingCard) => {
    // No feed to scroll to (e.g. the listing-detail location map passes no
    // onPinOpen) → never swallow the first tap.
    if (!onPinOpen || isHoverable() || peekedRef.current === l.id) { onOpenListing(l); return }
    peekedRef.current = l.id
    onPinOpen?.(l.id) // first tap: bring its card into view in the feed below
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
    loadLeaflet(() => { if (!cancelled) setReady(true) })
    return () => { cancelled = true } // don't setReady after unmount (stale script 'load')
  }, [])

  // Init map once Leaflet is ready.
  useEffect(() => {
    if (!ready || !mapRef.current || mapInstanceRef.current) return
    const L = (window as any).L
    // No attribution control — neutral map, no flags/branding badge.
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
    L.tileLayer(`https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}${retina}.png`, {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const keep = c && listings.some((l) => l.id === c.id)
      if (!keep) cardIdRef.current = null
      return keep ? c : null
    })

    // On hover-capable devices (desktop), HOVER reveals the card so the user can
    // browse pins fast; CLICK centres the pin and opens its card (same as touch) —
    // navigation happens by clicking the card, never straight off the pin.
    const hoverable = isHoverable()

    const bounds: [number, number][] = []
    listings.forEach((l) => {
      const { lat, lng } = getListingCoordinates(l)
      bounds.push([lat, lng])
      const icon = L.divIcon({ html: pinHtml(pinLabel(l, locale), selectedId === l.id), className: 'eno-pin', iconSize: [0, 0] })
      const marker = L.marker([lat, lng], { icon, riseOnHover: true }).addTo(map)
      marker.on('click', () => {
        // Click = centre the pin + show the card on EVERY input (mobile pattern
        // everywhere, user decision 2026-07-06); the card itself opens the page.
        // On touch the pin NEVER scrolls the feed — that would drag the page off
        // the map (see the two-step note above); the card tap does it instead.
        if (!hoverable && cardIdRef.current === l.id) onOpenListing(l) // touch: 2nd tap on the pin still opens
        else openCard(l, true, hoverable)
      })
      marker.on('mouseover', () => { if (hoverable) { cancelClose(); openCard(l) } else { onHover?.(l.id) } })
      marker.on('mouseout', () => { if (hoverable) { scheduleClose() } else { onHover?.(null) } })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listings, ready, activeDistrict, areaKey, nearby, locale])

  // Update marker styling on selection / hover (no full rebuild).
  useEffect(() => {
    if (!ready) return
    const L = (window as any).L
    markersRef.current.forEach((marker, id) => {
      const l = listings.find((x) => x.id === id)
      if (!l) return
      marker.setIcon(L.divIcon({ html: pinHtml(pinLabel(l, locale), selectedId === id), className: 'eno-pin', iconSize: [0, 0] }))
      if (selectedId === id) marker.setZIndexOffset(1000)
      else marker.setZIndexOffset(0)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, ready])

  // Fly to a specific listing when requested ("locate on map").
  useEffect(() => {
    if (!ready || !focusId || !mapInstanceRef.current) return
    const l = listings.find((x) => x.id === focusId)
    if (!l) return
    const { lat, lng } = getListingCoordinates(l)
    mapInstanceRef.current.flyTo([lat, lng], 15, { duration: 0.6 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, ready])

  return (
    // `isolate` keeps Leaflet's internal z-index (panes/controls up to ~1000)
    // contained so it can never render above modals/dialogs (which sit at z-50).
    <div className="w-full h-full relative isolate bg-tint">
      {!ready && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted z-20 select-none">
          <Spinner size="md" />
          <span className="text-3xs font-bold text-slate-700 uppercase tracking-wider">
            {tr('Loading map…', 'Đang tải bản đồ...')}
          </span>
        </div>
      )}
      <div ref={mapRef} className="w-full h-full" />

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
                <button onClick={() => activateCard(card)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left cursor-pointer">
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
                </button>
                <TrustScore score={card.seller.trustScore} variant="mini" className="shrink-0" />
                <MapsDirectionsButton to={getListingCoordinates(card)} className="h-8 w-8 shrink-0" />
              </div>
            ) : (
              <>
                {/* Favorite only — no ✕. Desktop closes on hover-out; mobile closes on
                    a tap outside the card (map background → closeCard). */}
                <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); toggle(card.id) }}
                    aria-label={isFavorite(card.id) ? tr('Saved', 'Đã lưu') : tr('Save', 'Lưu')}
                    className="flex h-8 w-8 items-center justify-center transition-transform hover:scale-110 active:scale-90"
                  >
                    <Heart className={cn('h-[22px] w-[22px] transition-colors [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.5))]', isFavorite(card.id) ? 'fill-brand text-white' : 'fill-black/25 text-white')} />
                  </button>
                </div>
                <button onClick={() => activateCard(card)} className="block w-full text-left cursor-pointer">
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
                </button>
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
