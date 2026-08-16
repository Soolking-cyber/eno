'use client'

import { useEffect, useRef, useState } from 'react'
import { Map as MapIcon, X, Info } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Spinner } from '@/components/ui/spinner'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { OSM_CREDIT, CARTO_CREDIT } from '@/lib/map-credit'
import { cn } from '@/lib/utils'
import { handleExternalClick } from '@/lib/native-browser'

// The saved-trip map. A day is a colour, a stop is a numbered pin in that colour, and each
// day's stops are joined by a polyline in visiting order.
//
// ⚠️ EVERY lifecycle guard below is copied from listings-map.tsx on purpose. Each one fixed a
// real crash there, and a fresh map that "doesn't need all that" crashes the same four ways:
//   1. a `cancelled` flag around the script load — a stale script `load` firing after unmount
//      called setState on a dead component;
//   2. `map.stop()` BEFORE `map.remove()` — an in-flight pan/zoom animation frame running after
//      remove() reads getPosition(_mapPane) on a deleted pane → "_leaflet_pos" undefined;
//   3. the deferred `invalidateSize` guarded on map IDENTITY and cleared on cleanup — it
//      otherwise fires on a removed map, same crash;
//   4. props mirrored into refs — handlers are captured once in effects and would read stale
//      props forever.
// Leaflet is 1.9.4 SELF-HOSTED at /vendor/leaflet via this hand-rolled loader. There is no
// react-leaflet in this repo; do not add one to "simplify" this file.

export type TripStop = {
  id: string
  position: number
  place: string
  name: string
  time?: string | null
  details?: string | null
  lat: number | null
  lng: number | null
  travelMinutes?: number | null
  estimatedCostVnd?: number | null
  bookingAdvice?: string | null
}

export type TripDay = {
  /** The ItineraryDay row id. Needed because every stop edit is scoped to a day server-side
   *  (@@unique([dayId, position])), so the client cannot ask for a reorder without it. */
  id: string
  dayNumber: number
  area: string
  title: string
  stops: TripStop[]
}

/** A stop we can actually draw. Narrowed so downstream code never re-checks for null. */
export type MappableStop = TripStop & { lat: number; lng: number }

/**
 * Day colours. Deliberately a fixed, ordered list rather than generated hues: the same index
 * must give the same colour in the map pin AND in the list glyph beside it, and a generated
 * palette drifts the moment either side changes. Chosen to stay legible against the light CARTO
 * basemap and to remain distinguishable from each other for the common colour-vision
 * deficiencies — the NUMBER is what identifies a stop, though; colour only groups by day.
 */
// design-lint-allow: raw hex — Leaflet pin colours on a theme-INDEPENDENT map surface, same
// exemption listings-map.tsx carries in HEX_ALLOW. A theme token would be actively wrong here:
// the CARTO basemap stays light in dark mode, so a dark-mode token would hide the pins.
export const DAY_COLORS = ['#0a66c2', '#b8482f', '#2f7d4f', '#7a4fbd', '#b8860b', '#0f766e', '#a3336b'] as const // design-lint-allow: raw hex — see above

export const dayColor = (dayNumber: number) => DAY_COLORS[(Math.max(1, dayNumber) - 1) % DAY_COLORS.length]

// ── Pin geometry ────────────────────────────────────────────────────────────────────────────
// ⚠️ Shared with trip-day-list.tsx's <StopGlyph>, which draws the SAME teardrop so a pin on the
// map and the glyph beside its list row are recognisably one thing. If you change the path or
// the viewBox here, change it there in the same commit.
export const PIN_VIEWBOX = '0 0 26 34'
export const PIN_PATH = 'M13 0C5.82 0 0 5.82 0 13c0 9.1 13 21 13 21s13-11.9 13-21C26 5.82 20.18 0 13 0z'
const PIN_W = 26
const PIN_H = 34

/** The map pin, as an HTML string for Leaflet's divIcon. */
function pinHtml(index: number, color: string, active: boolean): string {
  // The label is a NUMBER by construction, but this is raw HTML — keep it unspoofable rather
  // than trusting the caller, exactly as listings-map's pinHtml does.
  const label = String(Math.trunc(index)).replace(/[^0-9]/g, '')
  const scale = active ? 1.14 : 1
  const stroke = active ? '#ffffff' : 'rgba(255,255,255,.9)' // design-lint-allow: raw hex — pin outline on the light basemap
  return (
    `<div style="transform:scale(${scale});transform-origin:bottom center;` +
    `filter:drop-shadow(0 2px 4px rgba(0,0,0,.35));transition:transform .12s ease;">` +
    `<svg width="${PIN_W}" height="${PIN_H}" viewBox="${PIN_VIEWBOX}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
    `<path d="${PIN_PATH}" fill="${color}" stroke="${stroke}" stroke-width="2"/>` +
    `<text x="13" y="17.5" text-anchor="middle" font-size="12" font-weight="700" fill="#ffffff" ` + // design-lint-allow: raw hex — pin numeral on the light basemap
    `font-family="ui-sans-serif,system-ui,sans-serif">${label}</text>` +
    `</svg></div>`
  )
}

/**
 * The pin's icon, declared with a REAL size and anchor.
 *
 * ⚠️ IT USED TO BE `iconSize: [0, 0]` with the pin shifted into place by
 * `transform: translate(-50%, -100%)`. That draws correctly and is broken underneath: Leaflet
 * gives the marker element a 0×0 box, so the pin has no measurable hit area of its own, and only
 * the overflowing child happens to catch a click. Anything that reasons about geometry rather than
 * pixels — a hit test, an assistive technology, `elementsFromPoint`, Playwright's visibility check,
 * which is how this surfaced — sees nothing there at all. Declaring the size and putting
 * `iconAnchor` at the pin's TIP lets Leaflet do the positioning it exists to do, and makes the
 * clickable area exactly the shape the reader can see.
 *
 * The tap target is therefore 26×34, not the 44px the design language asks of buttons. That is
 * deliberate: a padded box would overlap its neighbours on a dense day, and a pin that swallows
 * the click meant for the pin next to it is worse than a small one. The LIST row beside the map is
 * the large, accessible way to select the same stop.
 */
function pinIcon(L: any, index: number, color: string, active: boolean) {
  return L.divIcon({
    html: pinHtml(index, color, active),
    className: 'eno-trip-pin',
    iconSize: [PIN_W, PIN_H],
    iconAnchor: [PIN_W / 2, PIN_H],
    popupAnchor: [0, -PIN_H + 4],
    tooltipAnchor: [0, -PIN_H + 4],
  })
}

/**
 * What a pin IS: number · time · place · activity, as a DOM NODE.
 *
 * ⚠️ BUILT WITH createElement + textContent, NEVER an HTML string. Every field here is
 * MODEL-GENERATED text that was stored in Postgres and is being handed to Leaflet, which inserts
 * popup and tooltip content as innerHTML. A template literal would make `stop.name` an injection
 * point reachable by anyone who can influence a generated itinerary. Escaping by hand would also
 * work and is one forgotten interpolation away from not working; a DOM node cannot be got wrong.
 * (pinHtml above is a string because its only variable is a number it re-derives digit by digit.)
 */
function stopCard(stop: MappableStop, index: number, color: string, compact: boolean): HTMLElement {
  const root = document.createElement('div')
  root.className = compact ? 'max-w-[13rem]' : 'max-w-[15rem]'

  const head = document.createElement('div')
  head.className = 'flex items-start gap-1.5'

  const badge = document.createElement('span')
  badge.className = 'mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-3xs font-bold leading-none text-white'
  badge.style.background = color
  badge.textContent = String(index)
  head.appendChild(badge)

  const name = document.createElement('span')
  name.className = 'text-xs font-bold leading-snug text-neutral-900'
  name.textContent = stop.name
  head.appendChild(name)
  root.appendChild(head)

  const place = document.createElement('p')
  place.className = 'mt-0.5 pl-[1.375rem] text-2xs leading-snug text-neutral-600'
  place.textContent = stop.place
  root.appendChild(place)

  if (stop.time) {
    const time = document.createElement('p')
    time.className = 'mt-0.5 pl-[1.375rem] text-2xs font-semibold leading-snug text-neutral-500'
    time.textContent = stop.time
    root.appendChild(time)
  }

  // The long description is popup-only. In a hover tooltip it would cover the pins around it,
  // which is the opposite of what a tooltip is for.
  if (!compact && stop.details) {
    const details = document.createElement('p')
    details.className = 'mt-1.5 pl-[1.375rem] text-2xs leading-relaxed text-neutral-600'
    details.textContent = stop.details
    root.appendChild(details)
  }
  return root
}

const LEAFLET_JS = '/vendor/leaflet/leaflet.js'
const LEAFLET_CSS = '/vendor/leaflet/leaflet.css'

/** Ported from listings-map.tsx — same self-hosted paths, same retry semantics. */
function loadLeaflet(cb: () => void, onError?: () => void) {
  if (typeof window === 'undefined') return
  const w = window as unknown as { L?: unknown }
  if (w.L) { cb(); return }
  if (!document.getElementById('leaflet-css')) {
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

export const mappableStops = (day: TripDay): MappableStop[] =>
  day.stops
    .filter((s): s is MappableStop => typeof s.lat === 'number' && typeof s.lng === 'number')
    .sort((a, b) => a.position - b.position)

type Props = {
  days: TripDay[]
  /** Which day to frame and emphasise. `null` frames every day at once. */
  activeDay?: number | null
  selectedStopId?: string | null
  onSelectStop?: (stopId: string) => void
  className?: string
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
/**
 * Where the map's own overlays sit in the stack.
 *
 * ⚠️ THE OBVIOUS READING OF LEAFLET'S Z-LADDER IS WRONG, and it is worth writing down because it
 * looks alarming. leaflet.css:107-114 gives panes tiles 200, overlay 400, shadow 500, MARKERS 600,
 * tooltips 650, POPUPS 700 — so a reviewer (agy did) reasonably concludes that an overlay at z-500
 * is buried by every pin and popup. Measured, it is not: `.leaflet-map-pane` carries a
 * `transform: matrix(…)`, which opens a STACKING CONTEXT, so all of 600/700 are resolved *inside*
 * it and the whole map pane competes with these siblings as a single z-400 box. A probe injected
 * into the marker and popup panes loses to the credit even when the credit is forced back to 500.
 *
 * So why 800? Insurance for the one case where that containment disappears: where Leaflet cannot
 * use 3D transforms it positions the map pane with left/top instead, no transform, no stacking
 * context — and then the panes' 600/700 really do float up here. 800 clears them, and stays below
 * `.leaflet-top`/`.leaflet-bottom` (1000) so the zoom control keeps its place on top.
 */
const OVERLAY_Z = 'z-[800]'

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
        // Same footnote treatment as the marketplace map's credit — kept in step deliberately:
        // these two MapCredit components are duplicated, and a restyle that lands in only one
        // leaves the same legal notice looking like two different things on two maps.
        `pointer-events-none absolute ${OVERLAY_Z} flex items-center gap-1 rounded-lg bg-card/70 px-1 py-px text-3xs leading-none text-ink-4/80 backdrop-blur-[2px]`,
        className,
      )}
    >
      {/* ⚠️ `handleExternalClick`, like every other third-party link in the app. Inside the
          Capacitor shell a bare target=_blank hands the URL to Safari/Chrome and LEAVES eno —
          src/lib/native-browser.ts calls that hard exit "the most jarring thing a wrapped app
          does". These are pure go-and-look destinations, so they belong in the in-app browser, one
          Done tap from the map. (The single documented exception is evisa.gov.vn, for reasons that
          do not apply here.) A credit the native app cannot follow is decoration. */}
      {/* ⚠️ COLLAPSED TO A SINGLE ⓘ, mirroring listings-map.tsx — see the long note there for why
          collapsing is available and removing is not. The two maps must stay identical here: a
          licence obligation that is discharged on one surface and not the other is the worst of
          both, and this pair has already drifted once (both shipped with attributionControl:false
          and no credit at all). The word forms stay in the DOM, hidden, not deleted. */}
      <a
        className="pointer-events-auto flex size-5 items-center justify-center rounded-full border border-ink-4/30 leading-none transition-colors hover:border-ink-4/60 hover:text-body"
        href="https://www.openstreetmap.org/copyright"
        onClick={handleExternalClick}
        target="_blank"
        rel="noreferrer"
        aria-label={OSM_CREDIT}
      >
        <Info className="size-2.5" />
      </a>
      {/* ⛔ CARTO GETS ITS OWN CONTROL. The first version of this collapse hid the CARTO link and
          pointed a single ⓘ at OpenStreetMap only — all three reviewers caught that it left CARTO's
          attribution unreachable, which is a worse licence position than the verbose credit it
          replaced. Two providers, two reachable credits; they are 16px each, so the clutter the
          owner objected to is still gone. */}
      <a
        className="pointer-events-auto flex size-5 items-center justify-center rounded-full border border-ink-4/30 leading-none transition-colors hover:border-ink-4/60 hover:text-body"
        href="https://carto.com/attributions"
        onClick={handleExternalClick}
        target="_blank"
        rel="noreferrer"
        aria-label={CARTO_CREDIT}
      >
        <Info className="size-2.5" />
      </a>
    </p>
  )
}

export function TripMap({ days, activeDay = null, selectedStopId = null, onSelectStop, className }: Props) {
  const { tr } = useLanguage()
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const markersRef = useRef<Map<string, any>>(new Map())
  const layersRef = useRef<any[]>([])
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [loadTry, setLoadTry] = useState(0)

  // (4) Props mirrored into refs. The marker click handlers are captured ONCE per redraw and
  // would otherwise close over the callback and selection from that render forever.
  const onSelectRef = useRef(onSelectStop)
  useEffect(() => { onSelectRef.current = onSelectStop }, [onSelectStop])
  const selectedRef = useRef(selectedStopId)
  useEffect(() => { selectedRef.current = selectedStopId }, [selectedStopId])
  /**
   * The id of a selection this map just made itself.
   *
   * ⚠️ WITHOUT THIS, SYNC FIGHTS THE USER. Selection is shared state, so a pin click comes back
   * down as a changed `selectedStopId` and is indistinguishable from a click on the list — and
   * "recentre on the selected stop" would then yank the map on every pin tap, undoing the pan the
   * user just made to reach that pin. Panning is for selections that arrived from ELSEWHERE.
   */
  const selfSelectRef = useRef<string | null>(null)
  // Same reason as the others: the marker handlers are bound once per redraw and would otherwise
  // hold the translator from that render.
  const trRef = useRef(tr)
  useEffect(() => { trRef.current = tr }, [tr])

  // (1) `cancelled` — a stale script 'load' must not setState after unmount.
  useEffect(() => {
    let cancelled = false
    loadLeaflet(
      () => { if (!cancelled) setReady(true) },
      () => { if (!cancelled) setLoadError(true) },
    )
    return () => { cancelled = true }
  }, [loadTry])

  // Init once. Vietnam-ish default view so an all-null-coordinate trip still shows a map
  // rather than the ocean at zoom 0.
  useEffect(() => {
    if (!ready || !mapRef.current || mapInstanceRef.current) return
    const L = (window as any).L
    // attributionControl stays OFF — <MapCredit> renders the OSM/CARTO credit in a form that
    // conforms to the design language. Enabling this would show the credit twice.
    const map = L.map(mapRef.current, { zoomControl: true, attributionControl: false, scrollWheelZoom: true })
      .setView([16.0, 107.5], 5)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map)
    mapInstanceRef.current = map
    const sizer = setTimeout(() => map.invalidateSize(), 80)
    return () => {
      clearTimeout(sizer)
      // (2) stop() BEFORE remove(): cancels any in-flight animation whose next frame would
      // read a deleted _mapPane.
      map.stop()
      map.off()
      map.remove()
      mapInstanceRef.current = null
      markersRef.current.clear()
      layersRef.current = []
    }
  }, [ready])

  // Redraw pins + per-day polylines, then frame the active day.
  useEffect(() => {
    if (!ready || !mapInstanceRef.current) return
    const L = (window as any).L
    const map = mapInstanceRef.current

    // `off()` before `removeLayer()`: removeLayer detaches a layer from the map, but the click
    // handler bound below still references this render's closure. Dropping it explicitly is the
    // same discipline the init cleanup applies to the map itself, and it means a day switch
    // cannot leave a live handler on a detached marker.
    //
    // ⚠️ BUT THE OVERLAYS MUST COME OFF FIRST, and this is a trap this loop only acquired when
    // tooltips and popups were added to it. `bindPopup`/`bindTooltip` register Leaflet's OWN
    // `remove` handler on the marker — that is what closes an open card when the marker leaves the
    // map. `off()` strips those handlers too, so the subsequent `removeLayer` fires `remove` with
    // nothing listening and an open popup is orphaned: still in the map pane, no longer owned by
    // any layer, and it survives the day switch. Unbinding explicitly (which closes first) means
    // the teardown does not depend on handlers we are about to delete. (Found by codex.)
    for (const layer of layersRef.current) {
      layer.closeTooltip?.(); layer.unbindTooltip?.()
      layer.closePopup?.(); layer.unbindPopup?.()
      layer.off?.()
      map.removeLayer(layer)
    }
    layersRef.current = []
    markersRef.current.clear()

    const shown = activeDay === null ? days : days.filter((d) => d.dayNumber === activeDay)
    const bounds: [number, number][] = []

    for (const day of shown) {
      const stops = mappableStops(day)
      const color = dayColor(day.dayNumber)
      if (stops.length > 1) {
        // One polyline per day, in visiting order. Straight legs on purpose: there is no
        // routing host, and the CSP forbids adding one.
        const line = L.polyline(stops.map((s) => [s.lat, s.lng]), {
          color, weight: 3, opacity: 0.75, dashArray: '6 6', interactive: false,
        }).addTo(map)
        layersRef.current.push(line)
      }
      stops.forEach((stop, i) => {
        const icon = pinIcon(L, i + 1, color, selectedRef.current === stop.id)
        const marker = L.marker([stop.lat, stop.lng], { icon, riseOnHover: true, alt: stop.place }).addTo(map)

        // Hover/focus: the compact card. Tap/click: the full one, with the description.
        // ⚠️ Tooltips are given as a FUNCTION so Leaflet rebuilds the node per open — one shared
        // element cannot be attached to two places at once, and Leaflet moves it into its own
        // container on open.
        // Offsets come from the icon's tooltipAnchor/popupAnchor, not from here — specifying both
        // double-counts and floats the card off the pin.
        marker.bindTooltip(() => stopCard(stop, i + 1, color, true), { direction: 'top', opacity: 1 })
        marker.bindPopup(() => stopCard(stop, i + 1, color, false), { closeButton: true, autoPan: true, maxWidth: 260 })
        // ⚠️ Both bindings answer a click, and opening a popup does NOT close a tooltip — so on a
        // pointer device the hover card stayed up behind the popup, showing the same stop twice.
        // Keyed on `popupopen` rather than on the click, so a popup opened by a LIST selection
        // clears the tooltip too. (Found by codex.)
        // ⚠️ TWO handlers, because one is not enough: closing the tooltip when the popup opens is
        // undone the moment Leaflet re-opens it (a click over a marker still produces mouseover),
        // and a count of `.leaflet-tooltip` after clicking proved it was still there. This second
        // handler makes "popup open" mean "no tooltip", however the tooltip got opened.
        marker.on('tooltipopen', () => { if (marker.isPopupOpen()) marker.closeTooltip() })
        marker.on('popupopen', () => {
          marker.closeTooltip()
          // Leaflet's own close button ships an English `aria-label`, in an app that renders in 11
          // languages. It is created per open, so relabel it here rather than once at bind time.
          const close = marker.getPopup()?.getElement()?.querySelector('.leaflet-popup-close-button')
          if (close) close.setAttribute('aria-label', trRef.current('Close', 'Đóng'))
        })
        // ⚠️ The SELECTION is what the click reports; the popup opens on its own. Reporting it
        // lets the list highlight and scroll to the matching row, which is the half of "sync"
        // that a popup alone does not give you.
        marker.on('click', () => {
          // ⚠️ ARM THE SENTINEL ONLY IF THE SELECTION WILL ACTUALLY CHANGE. Re-tapping the
          // already-selected pin sets state to the value it already holds, React bails out, and the
          // effect that would have consumed the sentinel never runs — leaving it armed for whatever
          // came next. Not arming it in that case makes going stale impossible. (Found by agy.)
          if (selectedRef.current !== stop.id) selfSelectRef.current = stop.id
          onSelectRef.current?.(stop.id)
        })
        markersRef.current.set(stop.id, marker)
        layersRef.current.push(marker)
        bounds.push([stop.lat, stop.lng])
      })
    }

    if (bounds.length === 1) map.setView(bounds[0], 14)
    else if (bounds.length > 1) map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 })

    // (3) Deferred resize, guarded on map identity and cleared on cleanup — this effect
    // re-runs on every day change, and an invalidateSize() on a removed map is the crash.
    const sizeT = setTimeout(() => { if (mapInstanceRef.current === map) map.invalidateSize() }, 80)
    return () => clearTimeout(sizeT)
  }, [ready, days, activeDay])

  // Restyle on selection only — a full rebuild would drop the user's pan/zoom.
  useEffect(() => {
    if (!ready || !mapInstanceRef.current) return
    const L = (window as any).L
    const map = mapInstanceRef.current
    const shown = activeDay === null ? days : days.filter((d) => d.dayNumber === activeDay)
    for (const day of shown) {
      mappableStops(day).forEach((stop, i) => {
        const marker = markersRef.current.get(stop.id)
        if (!marker) return
        marker.setIcon(pinIcon(L, i + 1, dayColor(day.dayNumber), selectedStopId === stop.id))
      })
    }

    // The other half of two-way sync: a stop chosen in the LIST reveals itself here.
    const cameFromThisMap = selfSelectRef.current === selectedStopId
    selfSelectRef.current = null
    if (!selectedStopId || cameFromThisMap) return
    const marker = markersRef.current.get(selectedStopId)
    if (!marker) return

    const reveal = () => {
      // ⚠️ Only pan when the pin is actually off screen. Recentring a pin the reader can already
      // see is motion for its own sake, and it throws away a pan they may have made deliberately.
      //
      // ⚠️ `animate: false` because the popup's own `autoPan` will pan too, and two pans racing
      // land the viewport somewhere neither intended — Leaflet's auto-pan can stop or replace an
      // in-flight animation. Jumping and then opening is predictable; a fight is not. (codex.)
      if (!map.getBounds().contains(marker.getLatLng())) {
        map.panTo(marker.getLatLng(), { animate: false })
      }
      marker.openPopup()
    }
    const measurable = () => map.getSize().x > 0 && map.getSize().y > 0
    if (measurable()) { reveal(); return }

    // ⚠️ A ZERO-SIZE MAP IS A REAL CASE, NOT A DEFENSIVE FLOURISH — and it is TWO cases that must
    // not be collapsed:
    //
    //   · PERMANENTLY hidden. The trip page renders the desktop map inside
    //     `<aside className="hidden lg:block">`, and `display:none` hides it WITHOUT unmounting
    //     it, so every phone carries a second invisible TripMap holding the same `selectedStopId`.
    //     Tapping a pin in the drawer made that map pan and open a popup too — two
    //     `.leaflet-popup` nodes in the DOM, which is how this was found. Revealing something on a
    //     map with no pixels is waste, and animating one is how the crashes at the top of this
    //     file began.
    //   · NOT MEASURED YET. A container whose layout settles after mount reports 0 for a frame or
    //     two, and returning outright would drop that reveal permanently — the effect is keyed on
    //     `selectedStopId`, which will not change again just because the map finally has a size.
    //     A reviewer raised exactly this, and it is the difference between a guard and a bug.
    //
    // One deferred retry separates them: the hidden instance is still 0 and no-ops, the late one
    // succeeds. Guarded on map IDENTITY and on the marker still being the live one, like guard (3).
    const retry = setTimeout(() => {
      if (mapInstanceRef.current !== map || !measurable()) return
      if (markersRef.current.get(selectedStopId) !== marker) return
      reveal()
    }, 140)
    return () => clearTimeout(retry)
  }, [ready, selectedStopId, days, activeDay])

  const shownDays = activeDay === null ? days : days.filter((d) => d.dayNumber === activeDay)
  const total = shownDays.reduce((n, d) => n + mappableStops(d).length, 0)
  // ⚠️ COUNTED OVER THE SHOWN DAYS, and that was a deliberate change of mind. Counting the whole
  // trip felt more honest — coverage should not appear to improve because a filter is on — but it
  // made the sentence FALSE: with Day 1 selected and all of Day 1 mapped, the map still announced
  // "2 stops are not on the map yet — they are still in the day list", while the day list beside it
  // showed only Day 1 and none were missing. A true statement about what the reader can see beats a
  // true statement about something they cannot. (Found by codex.)
  const unmapped = shownDays.reduce((n, d) => n + d.stops.length, 0) - total
  const legendDays = shownDays.filter((d) => mappableStops(d).length > 0)

  return (
    // ⚠️ `isolate` is applied UNCONDITIONALLY, outside the `??`. Every real caller passes its own
    // className (trip-detail-client and the drawer both do), so putting it in the default would have
    // left the stacking context open on exactly the surfaces that ship — and an z-[800] overlay in an
    // un-isolated container competes with the whole page, which is how a map corner ends up painted
    // over a dialog. listings-map's wrapper has carried `isolate` for this reason all along.
    <div className={cn('isolate', className ?? 'relative h-full w-full overflow-hidden rounded-2xl')}>
      <div ref={mapRef} className="h-full w-full" role="application" aria-label={tr('Trip map', 'Bản đồ chuyến đi')} />

      {/* ⚠️ NO `animate-pulse` on any overlay here. It fades the subtree to 50% opacity, which
          drops small text under the 4.5:1 contrast floor and fails axe — the same defect that
          had to be fixed in listing-detail-map.tsx once its placeholder started persisting. */}
      {!ready && !loadError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-tint">
          <Spinner size="md" />
          <span className="text-3xs font-bold uppercase tracking-wider text-ink-4">
            {tr('Loading map…', 'Đang tải bản đồ…')}
          </span>
        </div>
      )}

      {loadError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-tint px-6 text-center">
          <p className="text-sm text-ink-4">{tr("The map didn't load.", 'Không tải được bản đồ.')}</p>
          <Button variant="secondary" size="sm" onClick={() => { setLoadError(false); setLoadTry((n) => n + 1) }}>
            {tr('Try again', 'Thử lại')}
          </Button>
        </div>
      )}

      {/* ⚠️ Gated on Leaflet being up and the tile layer added. The credit sits at OVERLAY_Z and the
          loading/error panel is a plain absolute overlay, so an ungated credit floated on top of the
          spinner — crediting a basemap that had not loaded, over a panel saying it failed to. */}
      {ready && !loadError && <MapCredit className="bottom-1 left-2" />}

      {/* The day-colour key. Top-RIGHT: Leaflet puts its zoom control top-left, the coverage
          notice sits along the bottom, and the popup opens upward from a pin. */}
      {ready && !loadError && legendDays.length > 0 && (
        <ul
          aria-label={tr('Day colours', 'Màu theo ngày')}
          // ⚠️ NOT `pointer-events-none`. A 30-day trip overflows the cap, and a scroll container
          // that ignores the pointer cannot be scrolled — the days past the fold would be
          // unreachable. It therefore takes a small bite out of the draggable surface, exactly as
          // Leaflet's own zoom control does in the opposite corner. (Found by codex.)
          className="absolute right-2 top-2 z-[800] max-h-[min(50%,12rem)] space-y-1 overflow-y-auto overscroll-contain rounded-xl bg-card/95 px-2.5 py-2 shadow-overlay"
        >
          {legendDays.map((day) => (
            <li key={day.dayNumber} className="flex items-center gap-1.5 text-3xs font-bold text-ink-3">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dayColor(day.dayNumber) }} aria-hidden="true" />
              {tr(`Day ${day.dayNumber}`, `Ngày ${day.dayNumber}`)}
            </li>
          ))}
        </ul>
      )}

      {/* Honest about coverage rather than silently showing fewer pins than the list has rows:
          a stop with no resolved coordinate is still a real stop in the itinerary. Saying HOW MANY
          is the difference between "the map is broken" and "these three could not be located" —
          the first is what a silently shorter map reads as. */}
      {ready && !loadError && (total === 0 || unmapped > 0) && (
        // ⚠️ `bottom-7`, not `bottom-3`: this notice spans the full width, so at the old offset it
        // sat directly on top of the basemap credit — and a credit covered by our own UI does not
        // discharge the licence. It rides one row higher now.
        <div className="absolute inset-x-3 bottom-7 z-[800] rounded-xl bg-card/95 px-3 py-2 text-center text-xs text-ink-4 shadow-overlay">
          {total === 0
            ? tr('No stops on this trip could be placed on the map yet.', 'Chưa có điểm dừng nào của chuyến đi được định vị trên bản đồ.')
            : tr(
              // Both halves have to agree: "1 stop is … they are still" read as a typo, because it
              // was one. Vietnamese needs no number agreement, so only the English branch forks.
              unmapped === 1
                ? '1 stop is not on the map yet — it is still in the day list.'
                : `${unmapped} stops are not on the map yet — they are still in the day list.`,
              `${unmapped} điểm dừng chưa có trên bản đồ — vẫn hiển thị trong danh sách ngày.`,
            )}
        </div>
      )}
    </div>
  )
}

/**
 * Mobile presentation: a "Map view" MODE, not a split — at phone width a 45% map beside a list
 * is too small to read either. `modal={false}` is load-bearing: a modal drawer traps the pointer
 * for dismissal, so dragging to pan the map would close it instead of panning.
 */
export function TripMapDrawer(props: Props & { triggerClassName?: string }) {
  const { tr } = useLanguage()
  const [open, setOpen] = useState(false)
  const { triggerClassName, ...mapProps } = props

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => setOpen(true)}
        className={triggerClassName ?? 'w-full gap-2'}
      >
        <MapIcon className="h-4 w-4" />
        {tr('Map view', 'Xem bản đồ')}
      </Button>
      <Drawer
        open={open}
        onOpenChange={setOpen}
        modal={false}
        showSwipeHandle
        // Panning the map is a drag that starts inside the popup; without this the drawer
        // treats a pan that leaves its bounds as an outside-press and closes mid-gesture.
        disablePointerDismissal
      >
        <DrawerContent>
          <DrawerHeader className="flex-row items-center justify-between border-b border-border/80 pb-2.5">
            <DrawerTitle>{tr('Trip map', 'Bản đồ chuyến đi')}</DrawerTitle>
            <IconButton size="xs" onClick={() => setOpen(false)} aria-label={tr('Close', 'Đóng')} className="bg-tint text-ink-3">
              <X className="h-4 w-4" />
            </IconButton>
          </DrawerHeader>
          {/* A definite height: Leaflet cannot size itself inside a flex child with no basis,
              and a 0px map is the other classic way this component "silently breaks". */}
          <div className="h-[70vh] p-3">
            <TripMap {...mapProps} className="relative h-full w-full overflow-hidden rounded-xl" />
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}
