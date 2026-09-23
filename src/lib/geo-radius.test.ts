import { describe, expect, it } from 'vitest'
import { parseRadiusParams, radiusBoundingBox, radiusWhere } from './geo-radius'
import { haversineKm } from './geo'

const HCMC = { lat: 10.7769, lng: 106.7009 }

describe('radiusBoundingBox', () => {
  /**
   * ⛔ THE REGRESSION THIS FILE EXISTS FOR. Both plan reviewers predicted the longitude span would
   * be computed with the LATITUDE kilometres-per-degree figure, which makes the box too narrow and
   * clips real listings on the east and west edges before the exact check ever runs. At HCMC's
   * latitude the two differ by ~1.8%, so it is the kind of wrong that looks merely imprecise.
   */
  it('scales the longitude span by cos(latitude)', () => {
    const b = radiusBoundingBox({ ...HCMC, radiusKm: 5 })
    const latSpan = b.maxLat - b.minLat
    const lngSpan = b.maxLng - b.minLng
    expect(lngSpan).toBeGreaterThan(latSpan) // a degree of longitude is SHORTER here, so it takes more of them
    const ratio = lngSpan / latSpan
    expect(ratio).toBeCloseTo(110.574 / (111.32 * Math.cos((HCMC.lat * Math.PI) / 180)), 3)
  })

  /** The box must CONTAIN the circle: a point due east at exactly the radius has to be inside it. */
  it('contains the circle it bounds, on every axis', () => {
    const radiusKm = 8
    const b = radiusBoundingBox({ ...HCMC, radiusKm })
    for (const bearing of [0, 90, 180, 270]) {
      const rad = (bearing * Math.PI) / 180
      // destination point, small-distance approximation — good to metres at 8 km
      const dLat = (radiusKm * Math.cos(rad)) / 110.574
      const dLng = (radiusKm * Math.sin(rad)) / (111.32 * Math.cos((HCMC.lat * Math.PI) / 180))
      const p = { lat: HCMC.lat + dLat, lng: HCMC.lng + dLng }
      expect(p.lat, `bearing ${bearing}`).toBeGreaterThanOrEqual(b.minLat - 1e-9)
      expect(p.lat, `bearing ${bearing}`).toBeLessThanOrEqual(b.maxLat + 1e-9)
      expect(p.lng, `bearing ${bearing}`).toBeGreaterThanOrEqual(b.minLng - 1e-9)
      expect(p.lng, `bearing ${bearing}`).toBeLessThanOrEqual(b.maxLng + 1e-9)
    }
  })

  /** Near a pole the cosine collapses; the span must stay finite rather than becoming Infinity. */
  it('clamps longitude to the world, like latitude', () => {
    const b = radiusBoundingBox({ lat: 10, lng: 179.99, radiusKm: 25 })
    expect(b.maxLng).toBeLessThanOrEqual(180)
    expect(b.minLng).toBeGreaterThanOrEqual(-180)
  })

  it('does not explode at the poles', () => {
    const b = radiusBoundingBox({ lat: 89.999, lng: 0, radiusKm: 50 })
    expect(Number.isFinite(b.minLng)).toBe(true)
    expect(Number.isFinite(b.maxLng)).toBe(true)
    expect(b.maxLat).toBeLessThanOrEqual(90)
  })
})

/** Not this module's function — `geo.ts` already owned it. Pinned here because the SQL circle
 *  and this one must agree, so a change to either shows up as a failure. */
describe('haversineKm (geo.ts, shared with the SQL circle)', () => {
  it('is zero for a point against itself', () => {
    expect(haversineKm(HCMC, HCMC)).toBeCloseTo(0, 6)
  })
  /** HCMC → Hanoi is ~1,140 km; a formula that is wrong by a factor is caught here, not in review. */
  it('measures a known long distance', () => {
    expect(haversineKm(HCMC, { lat: 21.0278, lng: 105.8342 })).toBeGreaterThan(1100)
    expect(haversineKm(HCMC, { lat: 21.0278, lng: 105.8342 })).toBeLessThan(1180)
  })
  it('is symmetric', () => {
    const a = { lat: 10.8, lng: 106.6 }
    expect(haversineKm(HCMC, a)).toBeCloseTo(haversineKm(a, HCMC), 9)
  })
})

describe('parseRadiusParams', () => {
  const p = (s: string) => parseRadiusParams(new URLSearchParams(s))

  it('reads a well-formed radius', () => {
    expect(p('lat=10.77&lng=106.70&radiusKm=5')).toEqual({ lat: 10.77, lng: 106.7, radiusKm: 5 })
  })

  /**
   * ⛔ REFUSED, NOT CLAMPED. These values are bound as SQL parameters so this is not the injection
   * boundary — but a NaN or a 40,000 km radius yields a query that scans the table and returns
   * everything, which is a denial of service wearing a search's clothes. Refusing narrows nothing;
   * clamping would quietly search somewhere the reader never asked about.
   */
  it('refuses anything that is not a real coordinate and a sane radius', () => {
    expect(p('')).toBeNull()
    expect(p('lat=abc&lng=106.7&radiusKm=5')).toBeNull()
    expect(p('lat=10.77&lng=106.7')).toBeNull()
    expect(p('lat=91&lng=106.7&radiusKm=5')).toBeNull()
    expect(p('lat=10.77&lng=181&radiusKm=5')).toBeNull()
    expect(p('lat=10.77&lng=106.7&radiusKm=0')).toBeNull()
    expect(p('lat=10.77&lng=106.7&radiusKm=-3')).toBeNull()
    expect(p('lat=10.77&lng=106.7&radiusKm=40000')).toBeNull()
    // The control offers 1–20 km; 25 is headroom, and anything past it is refused rather than
    // clamped, so an unauthenticated caller cannot ask for a box covering the whole country.
    expect(p('lat=10.77&lng=106.7&radiusKm=26')).toBeNull()
    expect(p('lat=10.77&lng=106.7&radiusKm=20')).not.toBeNull()
    expect(p('lat=Infinity&lng=106.7&radiusKm=5')).toBeNull()
  })

  /** `Number('')` is 0, which is a valid latitude — an empty param must not read as the equator. */
  it('does not let an empty parameter become zero', () => {
    expect(p('lat=&lng=&radiusKm=5')).toBeNull()
  })
})

describe('radiusWhere', () => {
  it('is four bounds and two explicit null guards, and nothing else', () => {
    const w = radiusWhere({ ...HCMC, radiusKm: 5 })
    expect(Object.keys(w).sort()).toEqual(['lat', 'lng'])
    expect(w.lat.not).toBeNull()
    expect(w.lng.not).toBeNull()
    expect(w.lat.gte).toBeLessThan(HCMC.lat)
    expect(w.lat.lte).toBeGreaterThan(HCMC.lat)
    expect(w.lng.gte).toBeLessThan(HCMC.lng)
    expect(w.lng.lte).toBeGreaterThan(HCMC.lng)
  })
  /**
   * ⚠️ THE BOX IS A SUPERSET OF THE CIRCLE AND THE MAP DRAWS THE BOX. Pinned so nobody "tightens"
   * it to the inscribed square later: that would silently drop listings the reader can see inside
   * the shape on screen.
   */
  it('contains the circle rather than being contained by it', () => {
    const w = radiusWhere({ ...HCMC, radiusKm: 5 })
    const north = { lat: HCMC.lat + 5 / 110.574, lng: HCMC.lng }
    expect(north.lat).toBeLessThanOrEqual(w.lat.lte)
  })
})
