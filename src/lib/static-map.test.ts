import { describe, expect, it } from 'vitest'
import { staticMapTiles, tileUrl, worldPixel, STATIC_MAP_ZOOM } from './static-map'

/**
 * The PDP's touch preview draws the SAME CARTO tiles the live Leaflet map fetches (owner, 2026-09-25:
 * a static map with the pin on touch, the live map on desktop, no new paid API). These pin the three
 * things that have to agree with Leaflet for that to be true: the projection, the tile set that covers
 * the box, and the URL (subdomain included) that makes the full map a cache hit.
 */
const SAIGON = { lat: 10.7769, lng: 106.7009 } // the live map's default centre

describe('worldPixel — Web Mercator at 256px tiles, as Leaflet projects it', () => {
  it('matches known values', () => {
    expect(worldPixel(0, 0, 0)).toEqual({ x: 128, y: 128 })
    const p = worldPixel(SAIGON.lat, SAIGON.lng, 15)
    // Tile containing central Saigon at z15 by the OSM slippy-map formula
    // (x = (lng+180)/360·2^z, y = (1 − asinh(tan φ)/π)/2·2^z → 26096.15, 15397.23), computed independently.
    expect(Math.floor(p.x / 256)).toBe(26096)
    expect(Math.floor(p.y / 256)).toBe(15397)
  })
  it('clamps the poles like SphericalMercator instead of returning Infinity', () => {
    expect(Number.isFinite(worldPixel(90, 0, 3).y)).toBe(true)
  })
})

describe('tileUrl — the subdomain Leaflet would pick, so the opened map re-uses the cache', () => {
  it("'abc'[|x + y| % 3]", () => {
    const t = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png'
    expect(tileUrl(t, 26096, 15397, 15)).toBe('https://a.basemaps.cartocdn.com/light_all/15/26096/15397@2x.png') // 41493 % 3 = 0
    expect(tileUrl(t, 26097, 15397, 15)).toBe('https://b.basemaps.cartocdn.com/light_all/15/26097/15397@2x.png') // 41494 % 3 = 1
    expect(tileUrl(t, 0, 0, 0)).toBe('https://a.basemaps.cartocdn.com/light_all/0/0/0@2x.png')
  })
})

describe('staticMapTiles — only the tiles that cover the box, with the point at its centre', () => {
  it('a phone-width preview (366x260) needs at most 3x3 tiles, and they cover the box edge to edge', () => {
    const { tiles, pin } = staticMapTiles({ ...SAIGON, width: 366, height: 260, retina: true })
    expect(tiles.length).toBeGreaterThanOrEqual(4)
    expect(tiles.length).toBeLessThanOrEqual(9)
    expect(Math.min(...tiles.map((t) => t.left))).toBeLessThanOrEqual(0)
    expect(Math.min(...tiles.map((t) => t.top))).toBeLessThanOrEqual(0)
    expect(Math.max(...tiles.map((t) => t.left + 256))).toBeGreaterThanOrEqual(366)
    expect(Math.max(...tiles.map((t) => t.top + 256))).toBeGreaterThanOrEqual(260)
    // Nothing fetched that lies wholly outside the box.
    for (const t of tiles) {
      expect(t.left).toBeLessThan(366)
      expect(t.top).toBeLessThan(260)
      expect(t.left + 256).toBeGreaterThan(0)
      expect(t.top + 256).toBeGreaterThan(0)
    }
    expect(Math.abs(pin.x - 183)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(pin.y - 130)).toBeLessThanOrEqual(0.5)
    expect(tiles.every((t) => t.url.includes(`/light_all/${STATIC_MAP_ZOOM}/`) && t.url.includes('@2x.png'))).toBe(true)
  })

  it('the pin lands on the listing: the tile under the pin is the tile that contains the point', () => {
    const { tiles, pin } = staticMapTiles({ ...SAIGON, width: 366, height: 260 })
    const under = tiles.find((t) => pin.x >= t.left && pin.x < t.left + 256 && pin.y >= t.top && pin.y < t.top + 256)!
    expect(under.url).toMatch(/\/15\/26096\/15397\.png/)
  })

  it('no size (not measured yet) or a bad point → no tiles, not a thrown error', () => {
    expect(staticMapTiles({ ...SAIGON, width: 0, height: 260 }).tiles).toEqual([])
    expect(staticMapTiles({ lat: Number.NaN, lng: 1, width: 300, height: 200 }).tiles).toEqual([])
  })
})
