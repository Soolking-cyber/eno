import { describe, expect, it } from 'vitest'
import {
  boundaryCacheKey,
  countPoints,
  pickBoundary,
  simplifyGeometry,
  simplifyRing,
  type OsmResult,
} from './geo-boundary'

const poly = (coords: unknown) => ({ type: 'Polygon', coordinates: coords })

describe('pickBoundary', () => {
  /**
   * ⛔ THESE ARE THE ACTUAL COLLISIONS, measured against the live Nominatim API before this code
   * existed: "Phường Thảo Điền" returns a landuse point, "Phường Bến Nghé" a customs office, and
   * "Thành phố Thủ Đức" a university. `results[0]` would have outlined a car park and called it a
   * ward, and nothing on screen would have said otherwise.
   */
  it('ignores a landuse, an office and a campus in favour of the admin boundary', () => {
    const results: OsmResult[] = [
      { category: 'landuse', type: 'residential', geojson: { type: 'Point', coordinates: [0, 0] } },
      { category: 'office', type: 'government', geojson: { type: 'Polygon', coordinates: [] } },
      { category: 'amenity', type: 'university', geojson: { type: 'Polygon', coordinates: [] } },
      { category: 'boundary', type: 'administrative', display_name: 'Phường An Khánh', geojson: poly([]) },
    ]
    expect(pickBoundary(results, 'ward')?.display_name).toBe('Phường An Khánh')
  })

  it('refuses a boundary that has no polygon to draw', () => {
    expect(pickBoundary([{ category: 'boundary', type: 'administrative', geojson: { type: 'Point', coordinates: [0, 0] } }], 'ward')).toBeNull()
    expect(pickBoundary([{ category: 'boundary', type: 'administrative', geojson: null }], 'ward')).toBeNull()
  })

  /**
   * ⚠️ `historic` IS ACCEPTED FOR DISTRICTS AND REFUSED FOR WARDS. The 2025 reform abolished
   * districts, so OSM carries "Quận 1" and "Bình Thạnh" as `boundary=historic` — which is still the
   * vocabulary this marketplace's listings use. Both plan reviewers predicted districts would be
   * unmatchable; refusing historic would have thrown away 10 of the 19 that actually work.
   */
  it('accepts a historic boundary for a district', () => {
    const r: OsmResult[] = [{ category: 'boundary', type: 'historic', display_name: 'Quận 1', geojson: poly([]) }]
    expect(pickBoundary(r, 'district')?.display_name).toBe('Quận 1')
    expect(pickBoundary(r, 'ward')).toBeNull()
  })

  it('prefers a current administrative area over a historic one', () => {
    const r: OsmResult[] = [
      { category: 'boundary', type: 'historic', display_name: 'old', geojson: poly([]) },
      { category: 'boundary', type: 'administrative', display_name: 'current', geojson: poly([]) },
    ]
    expect(pickBoundary(r, 'district')?.display_name).toBe('current')
  })

  /**
   * ⛔ A CORRECTLY-TYPED OUTLINE OF THE WRONG PLACE IS STILL A GUESS, which is what the name check
   * is for. Both reviewers noted the type and geometry tests say "this is an administrative area",
   * not "this is THE area you asked for" — the enclosing province would pass the first and fail the
   * second.
   */
  it('refuses an administrative area that is not the one asked for', () => {
    const r: OsmResult[] = [
      { category: 'boundary', type: 'administrative', display_name: 'Thành phố Hồ Chí Minh, Việt Nam', geojson: poly([]) },
    ]
    expect(pickBoundary(r, 'district', 'Quận 1')).toBeNull()
    expect(pickBoundary(r, 'district')).not.toBeNull() // without an expectation, unchanged
  })

  it('matches the right area despite diacritics and a long display name', () => {
    const r: OsmResult[] = [
      { category: 'boundary', type: 'historic', display_name: 'Quận 1, Thành phố Hồ Chí Minh, Việt Nam', geojson: poly([]) },
    ]
    expect(pickBoundary(r, 'district', 'Quan 1')?.type).toBe('historic')
    expect(pickBoundary(r, 'district', 'Quận 1')?.type).toBe('historic')
  })

  /** No match is a real answer: the map must draw nothing rather than draw a guess. */
  it('returns null when nothing is an administrative area', () => {
    expect(pickBoundary([], 'ward')).toBeNull()
    expect(pickBoundary([{ category: 'place', type: 'suburb', geojson: poly([]) }], 'ward')).toBeNull()
    expect(pickBoundary([{ category: 'boundary', type: 'postal_code', geojson: poly([]) }], 'district')).toBeNull()
  })
})

describe('simplifyRing', () => {
  it('drops points that sit on the line between their neighbours', () => {
    const straight: [number, number][] = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]
    expect(simplifyRing(straight, 0.0002)).toEqual([[0, 0], [4, 4]])
  })

  it('keeps a corner that carries the shape', () => {
    const corner: [number, number][] = [[0, 0], [1, 0], [1, 1]]
    expect(simplifyRing(corner, 0.0002)).toEqual(corner)
  })

  it('never drops the endpoints', () => {
    const r: [number, number][] = [[0, 0], [0.5, 0.00001], [1, 0]]
    const s = simplifyRing(r, 0.0002)
    expect(s[0]).toEqual([0, 0])
    expect(s[s.length - 1]).toEqual([1, 0])
  })
})

describe('simplifyGeometry', () => {
  /** A square with 200 collinear points per side is the shape OSM actually sends. */
  const denseSquare = (): [number, number][] => {
    const pts: [number, number][] = []
    for (let i = 0; i <= 200; i++) pts.push([i / 200, 0])
    for (let i = 0; i <= 200; i++) pts.push([1, i / 200])
    for (let i = 0; i <= 200; i++) pts.push([1 - i / 200, 1])
    for (let i = 0; i <= 200; i++) pts.push([0, 1 - i / 200])
    return pts
  }

  it('collapses a dense outline to its corners', () => {
    const before = poly([denseSquare()])
    const after = simplifyGeometry(before, 0.0002)!
    expect(countPoints(after)).toBeLessThan(20)
    expect(countPoints(before)).toBeGreaterThan(700)
  })

  it('keeps every ring closed', () => {
    const after = simplifyGeometry(poly([denseSquare()]), 0.0002)!
    const ring = (after.coordinates as [number, number][][])[0]
    expect(ring[0]).toEqual(ring[ring.length - 1])
  })

  /**
   * ⛔ A RING THAT WOULD COLLAPSE TO A LINE IS KEPT WHOLE. Simplifying a small island down to two
   * points renders as a hairline scratched across the map, which looks like a rendering bug rather
   * than a small island.
   */
  it('does not reduce a small island to a line', () => {
    const island: [number, number][] = [[0, 0], [0.00001, 0], [0.00001, 0.00001], [0, 0.00001], [0, 0]]
    const after = simplifyGeometry(poly([island]), 0.01)!
    expect((after.coordinates as unknown[][])[0].length).toBeGreaterThanOrEqual(4)
  })

  it('handles a MultiPolygon, which is what an area with islands returns', () => {
    const after = simplifyGeometry({ type: 'MultiPolygon', coordinates: [[denseSquare()], [denseSquare()]] }, 0.0002)!
    expect(after.type).toBe('MultiPolygon')
    expect((after.coordinates as unknown[]).length).toBe(2)
  })

  it('refuses a geometry that is not an area', () => {
    expect(simplifyGeometry({ type: 'Point', coordinates: [0, 0] })).toBeNull()
    expect(simplifyGeometry({})).toBeNull()
  })
})

describe('boundaryCacheKey', () => {
  it('is stable across case, padding and inner whitespace', () => {
    const a = boundaryCacheKey('ward', 'Phường An Khánh', 'Hồ Chí Minh')
    expect(boundaryCacheKey('ward', '  phường   an khánh ', 'hồ chí minh')).toBe(a)
  })
  it('separates the two kinds and the two provinces', () => {
    expect(boundaryCacheKey('ward', 'X', 'P')).not.toBe(boundaryCacheKey('district', 'X', 'P'))
    expect(boundaryCacheKey('ward', 'X', 'P')).not.toBe(boundaryCacheKey('ward', 'X', 'Q'))
  })
})
