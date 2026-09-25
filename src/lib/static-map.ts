import { basemapTileUrl } from '@/lib/basemap'

/**
 * A STATIC MAP FROM THE TILES THE LIVE MAP ALREADY USES — the PDP's touch preview (owner, 2026-09-25:
 * "product-page map on TOUCH devices becomes a static map image with the pin plus an 'Open map' button").
 *
 * ⛔ NO STATIC-MAP API. Every provider that renders a picture of a map for you is a new paid account and
 * a new key; the live map already pulls CARTO basemap tiles through `basemapTileUrl()` (keyed, public by
 * design — see basemap.ts), so the preview lays out the same handful of 256px tiles itself. Measured
 * weight is the tiles and nothing else: no Leaflet (43 KB JS + CSS, ~583 ms of main thread when it
 * mounted mid-scroll at 4x CPU on the PDP), no map instance, no gesture handling at all — which is the
 * point, because the live map's `touch-action: none` is what trapped one-finger page scrolling.
 *
 * ⚠️ SAME PROJECTION, SAME TILES, SAME URLS AS LEAFLET, so opening the full map re-uses them:
 *   · Web Mercator (EPSG:3857) at 256px per tile, latitude clamped to ±85.0511° like Leaflet's
 *     SphericalMercator; tile x wrapped around the antimeridian like GridLayer._wrapCoords.
 *   · zoom 15 — what the live map lands on for a single listing (`fitBounds(…, { maxZoom: 15 })`).
 *   · the `{s}` subdomain Leaflet picks, `'abc'[|x + y| % 3]` (TileLayer._getSubdomain with the default
 *     subdomains), so a tile shown here and the same tile in the opened map share one cache entry.
 *   · `@2x` under the same rule the live map uses: retina screen, and not Save-Data / a slow link.
 */

export const STATIC_MAP_ZOOM = 15
const TILE = 256
const MAX_LAT = 85.0511287798

export type StaticTile = { key: string; url: string; left: number; top: number }

/** World pixel of a lat/lng at `zoom` (Web Mercator, 256px tiles). */
export function worldPixel(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const scale = TILE * 2 ** zoom
  const la = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat))
  const s = Math.sin((la * Math.PI) / 180)
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale,
  }
}

/** Fill `{s}`/`{z}`/`{x}`/`{y}` the way Leaflet's TileLayer does for the same template. */
export function tileUrl(template: string, x: number, y: number, z: number): string {
  const s = 'abc'[Math.abs(x + y) % 3]
  return template.replace('{s}', s).replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
}

/**
 * The tiles that cover a `width` × `height` box centred on the point, each with its offset inside the
 * box, and where the point itself lands (`pin`). The box's origin is rounded to a whole pixel the way
 * Leaflet rounds its pixel origin, so every tile sits on the pixel grid and the pin is within half a
 * pixel of the centre. Rows above the top or below the bottom of the world are skipped (there are no
 * such tiles); a box edge that falls exactly on a tile edge does not fetch the tile beyond it.
 */
export function staticMapTiles(
  { lat, lng, width, height, zoom = STATIC_MAP_ZOOM, retina = false }:
  { lat: number; lng: number; width: number; height: number; zoom?: number; retina?: boolean },
): { tiles: StaticTile[]; pin: { x: number; y: number } } {
  const pin = { x: width / 2, y: height / 2 }
  if (!(width > 0 && height > 0) || !Number.isFinite(lat) || !Number.isFinite(lng)) return { tiles: [], pin }
  const template = basemapTileUrl(retina ? '@2x' : '')
  const n = 2 ** zoom
  const c = worldPixel(lat, lng, zoom)
  const left = Math.round(c.x - width / 2)
  const top = Math.round(c.y - height / 2)
  const tiles: StaticTile[] = []
  for (let ty = Math.floor(top / TILE); ty <= Math.ceil((top + height) / TILE) - 1; ty++) {
    if (ty < 0 || ty >= n) continue
    for (let tx = Math.floor(left / TILE); tx <= Math.ceil((left + width) / TILE) - 1; tx++) {
      const x = ((tx % n) + n) % n
      tiles.push({ key: `${tx}/${ty}`, url: tileUrl(template, x, ty, zoom), left: tx * TILE - left, top: ty * TILE - top })
    }
  }
  return { tiles, pin: { x: c.x - left, y: c.y - top } }
}

/** The live map's tile-weight rule (listings-map.tsx), for a component that has no Leaflet to ask. */
export function wantsRetinaTiles(): boolean {
  if (typeof window === 'undefined') return false
  const conn = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }).connection
  const lightTiles = !!conn && (conn.saveData === true || (!!conn.effectiveType && conn.effectiveType !== '4g'))
  return !lightTiles && (window.devicePixelRatio || 1) > 1
}
