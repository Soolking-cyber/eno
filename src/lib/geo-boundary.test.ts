import { describe, expect, it } from 'vitest'
import {
  boundaryCacheKey,
  countPoints,
  districtQueryAliases,
  districtQueryCandidates,
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

describe('districtQueryAliases', () => {
  /**
   * ⛔ THE TWO DISTRICTS THIS FUNCTION EXISTS FOR, both measured against the live API on
   * 2026-09-24 before it was written: asking OSM for our display name "Quận 7 (Phú Mỹ Hưng)"
   * returns nothing usable, while "Quận 7" returns a `boundary/historic` polygon; and "Nhà Bè"
   * returns nothing while "Huyện Nhà Bè" returns one.
   */
  it('drops our own parenthetical gloss', () => {
    expect(districtQueryAliases('Quận 7 (Phú Mỹ Hưng)')).toContain('Quận 7')
  })

  it('prefixes a bare rural district the way OSM files it', () => {
    expect(districtQueryAliases('Nhà Bè')).toContain('Huyện Nhà Bè')
  })

  it('spells out our TP abbreviation', () => {
    expect(districtQueryAliases('TP Thủ Đức')).toContain('Thành phố Thủ Đức')
  })

  /** The exact name must be asked FIRST — an alias is a fallback, never a replacement. */
  it('always asks for the given name first', () => {
    for (const n of ['Quận 1', 'Nhà Bè', 'Quận 7 (Phú Mỹ Hưng)', 'TP Thủ Đức']) {
      expect(districtQueryAliases(n)[0]).toBe(n)
    }
  })

  /**
   * ⚠️ A NAME THAT ALREADY CARRIES A PREFIX MUST NOT GAIN A SECOND ONE. "Huyện Quận 1" would be
   * a nonsense query, and the sixteen districts that already resolve must keep costing exactly
   * one request — the alias path is only for the ones that do not.
   */
  it('does not double-prefix, and leaves a working name alone', () => {
    expect(districtQueryAliases('Quận 1')).toEqual(['Quận 1'])
    expect(districtQueryAliases('Bình Thạnh').some((a) => /^Huyện Huyện/i.test(a))).toBe(false)
    expect(districtQueryAliases('Quận 12').some((a) => /Huyện/i.test(a))).toBe(false)
  })

  it('never repeats a candidate', () => {
    for (const n of ['Quận 1', 'Nhà Bè', 'TP Thủ Đức', 'Quận 7 (Phú Mỹ Hưng)']) {
      const a = districtQueryAliases(n)
      expect(new Set(a.map((x) => x.toLowerCase())).size).toBe(a.length)
    }
  })
})

describe('districtQueryCandidates', () => {
  const qs = (n: string) => districtQueryCandidates(n, 'Hồ Chí Minh').map((c) => c.q)

  /** The province form is right for the eighteen that work, so it must be tried first. */
  it('asks the province before the country', () => {
    const q = qs('Quận 1')
    expect(q[0]).toBe('Quận 1, Hồ Chí Minh')
    expect(q).toContain('Quận 1, Việt Nam')
    expect(q.indexOf('Quận 1, Hồ Chí Minh')).toBeLessThan(q.indexOf('Quận 1, Việt Nam'))
  })

  /**
   * ⛔ THE TWO THE COUNTRY FALLBACK EXISTS FOR, measured 2026-09-24. "Thành phố Thủ Đức" is filed
   * with NO province component ("…, Việt Nam"), and Cần Giờ was moved under Đồng Nai by the 2025
   * reform — so for both, the province-scoped query cannot return the right relation at all.
   */
  it('reaches Thủ Đức and Cần Giờ through the country scope', () => {
    expect(qs('TP Thủ Đức')).toContain('Thành phố Thủ Đức, Việt Nam')
    expect(qs('Cần Giờ')).toContain('Huyện Cần Giờ, Việt Nam')
  })

  /** ⚠️ The wider query must NOT come with a looser name check — `expect` travels with each query. */
  it('carries the expected name on every candidate', () => {
    for (const c of districtQueryCandidates('TP Thủ Đức', 'Hồ Chí Minh')) {
      expect(c.expect).toBeTruthy()
      expect(c.q.startsWith(c.expect)).toBe(true)
    }
  })

  it('never repeats a query and stays bounded', () => {
    for (const n of ['Quận 1', 'TP Thủ Đức', 'Cần Giờ', 'Quận 7 (Phú Mỹ Hưng)']) {
      const q = qs(n)
      expect(new Set(q).size).toBe(q.length)
      expect(q.length).toBeLessThanOrEqual(4)
    }
  })

  /**
   * ⛔ THE COUNTRY SCOPE MUST SURVIVE A NAME WITH MANY ALIASES. A flat "first four" budget let
   * province-scoped queries crowd it out entirely for a three-alias name — deleting the fallback
   * the reform-era districts depend on, then caching the miss for 30 days. Asserted on a synthetic
   * worst case rather than on today's list, because the bug was that nothing enforced the shape.
   */
  it('always reaches the country scope, however many aliases a name generates', () => {
    const many = 'TP Cần Giờ (Rừng Sác)' // parenthetical + TP + bare → the most aliases a name can make
    expect(districtQueryAliases(many).length).toBeGreaterThan(2)
    const q = districtQueryCandidates(many, 'Hồ Chí Minh').map((c) => c.q)
    expect(q.some((x) => x.endsWith(', Hồ Chí Minh'))).toBe(true)
    expect(q.some((x) => x.endsWith(', Việt Nam'))).toBe(true)
  })

  /**
   * ⛔ THE ASSERTION THE PREVIOUS TEST WAS MISSING, AND ALL THREE REVIEWERS FOUND THE GAP. Checking
   * only that both SCOPES appear let a budget that kept [exact, gloss-stripped] pass while silently
   * dropping the administrative-prefix expansion — the one variant OSM actually recognises for the
   * reform-era districts. Assert the useful alias SURVIVES, not merely that four queries exist.
   */
  it('keeps the prefix-expanded alias even when a name generates more than two', () => {
    const q = districtQueryCandidates('TP Cần Giờ (Rừng Sác)', 'Hồ Chí Minh').map((c) => c.q)
    expect(q.some((x) => x.startsWith('Thành phố Cần Giờ'))).toBe(true)
    // …and it must be tried in BOTH scopes, since that is the pair the reform districts need.
    // (The expansion strips the gloss first, so the alias is the clean "Thành phố Cần Giờ".)
    expect(q).toContain('Thành phố Cần Giờ, Hồ Chí Minh')
    expect(q).toContain('Thành phố Cần Giờ, Việt Nam')
  })

  /** A province equal to the country must not produce the same query twice. */
  it('collapses a duplicate scope', () => {
    const q = districtQueryCandidates('Quận 1', 'Việt Nam').map((c) => c.q)
    expect(q).toEqual(['Quận 1, Việt Nam'])
  })
})
