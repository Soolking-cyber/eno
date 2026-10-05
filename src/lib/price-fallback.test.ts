import { describe, expect, it } from 'vitest'

import { attrNeedles } from './attr-match'
import {
  FALLBACK_FACET,
  FALLBACK_NEVER_CATEGORIES,
  FALLBACK_SHELF_MODEL,
  fallbackBandKey,
  fallbackFacetFor,
  fallbackFacetValues,
  fallbackMapRows,
  facetValuePattern,
  readFacetValue,
} from './price-fallback'
import { CATEGORY_BY_SLUG, facetsFor, subcategoriesFor } from './taxonomy'

/**
 * THE FALLBACK BAND'S KEY — which shelves get one, what completes the key, and what never gets one.
 * The cron's SQL is built from fallbackMapRows() and price-stat.sql.test.ts executes it; this file
 * holds the table itself to the taxonomy, so a renamed facet or subcategory fails here instead of
 * silently emptying a band.
 */

const entries = Object.entries(FALLBACK_FACET).map(([key, facet]) => {
  const [category, subcategory] = key.split('/')
  return { key, category, subcategory, facet }
})

describe('FACET_CHOICES (FALLBACK_FACET) — held to the taxonomy', () => {
  it('names only real shelves, as category/subcategory', () => {
    for (const e of entries) {
      expect(e.key.split('/'), e.key).toHaveLength(2)
      expect(CATEGORY_BY_SLUG[e.category], e.key).toBeDefined()
      expect(subcategoriesFor(e.category).map((s) => s.slug), e.key).toContain(e.subcategory)
    }
  })

  it('picks a facet that IS one of that shelf\'s own single-valued taxonomy facets', () => {
    for (const e of entries) {
      if (e.facet === null) continue
      const facet = facetsFor(e.category, e.subcategory).find((f) => f.key === e.facet)
      expect(facet, `${e.key} → ${e.facet}`).toBeDefined()
      // A range facet has no value to group by; a derived or filter-only one is not a property the
      // poster states; an open-ended "6+" bucket is not one value.
      expect(facet!.kind, e.key).not.toBe('range')
      expect(facet!.derived, e.key).toBeFalsy()
      expect(facet!.filterOnly, e.key).toBeFalsy()
      expect(facet!.options.some((o) => o.orMore), e.key).toBe(false)
      expect(facet!.options.length, e.key).toBeGreaterThan(1)
    }
  })

  it('uses facet keys that are plain identifiers, so the value pattern has no metacharacter', () => {
    for (const e of entries) if (e.facet !== null) expect(e.facet, e.key).toMatch(/^[A-Za-z0-9_]+$/)
  })

  it('⛔ never lists a rentals / jobs / services / teachers / property / tickets shelf', () => {
    expect([...FALLBACK_NEVER_CATEGORIES].sort()).toEqual(['jobs', 'property', 'rentals', 'services', 'teachers', 'tickets-travel'])
    for (const e of entries) expect(FALLBACK_NEVER_CATEGORIES.has(e.category), e.key).toBe(false)
  })

  it('⛔ and refuses every one of their shelves at the reader, whatever the map says', () => {
    for (const category of FALLBACK_NEVER_CATEGORIES) {
      for (const s of subcategoriesFor(category)) {
        expect(fallbackFacetFor(category, s.slug), `${category}/${s.slug}`).toBeUndefined()
        expect(fallbackBandKey({ categorySlug: category, subcategorySlug: s.slug, attributes: null })).toBeNull()
      }
    }
  })

  // The two shelves measured on 2026-10-05 that pass the 3x spread guard while mixing unlike things.
  it('leaves out the catch-all and model-driven shelves the spread guard cannot catch', () => {
    expect(fallbackFacetFor('furniture-appliances', 'white-goods')).toBeUndefined()
    expect(fallbackFacetFor('electronics', 'phones-tablets')).toBeUndefined()
    expect(fallbackFacetFor('vehicles', 'motorbike')).toBeUndefined()
    expect(fallbackFacetFor('electronics', 'laptops-pcs')).toBeUndefined()
  })

  it('records the furniture choice the brief named: material', () => {
    for (const sub of ['sofa-seating', 'tables-desks', 'beds-mattresses', 'storage']) {
      expect(fallbackFacetFor('furniture-appliances', sub)).toBe('material')
    }
  })
})

describe('fallbackFacetFor', () => {
  it('trims the shelf like listingSegment() does', () => {
    expect(fallbackFacetFor(' furniture-appliances ', '\tbeds-mattresses\n')).toBe('material')
    expect(fallbackFacetFor('fashion-beauty', ' womens ')).toBeNull()
  })

  it('has no fallback without a category or a subcategory', () => {
    expect(fallbackFacetFor('furniture-appliances', null)).toBeUndefined()
    expect(fallbackFacetFor('', 'womens')).toBeUndefined()
    expect(fallbackFacetFor(null, '  ')).toBeUndefined()
  })

  it('is not fooled by an inherited property name', () => {
    expect(fallbackFacetFor('constructor', 'prototype')).toBeUndefined()
    expect(fallbackFacetFor('toString', 'x')).toBeUndefined()
  })
})

describe('readFacetValue — the stored attributes TEXT, read by the cron\'s own pattern', () => {
  it('reads a value out of the JSON text sanitizeAttributes() writes', () => {
    expect(readFacetValue('{"condition":"used","material":"wood"}', 'material')).toBe('wood')
    expect(readFacetValue(JSON.stringify({ material: 'rattan-bamboo', x: 'y' }), 'material')).toBe('rattan-bamboo')
  })

  it('is closed on the left by the key — "rawmaterial" is not "material"', () => {
    expect(readFacetValue('{"rawmaterial":"glass"}', 'material')).toBeNull()
  })

  it('reads an object of form values too (the post wizard\'s attr_<key>)', () => {
    expect(readFacetValue({ material: 'metal' }, 'material')).toBe('metal')
    expect(readFacetValue({ material: 3 }, 'material')).toBeNull()
  })

  it('returns null for nothing', () => {
    expect(readFacetValue(null, 'material')).toBeNull()
    expect(readFacetValue(undefined, 'material')).toBeNull()
    expect(readFacetValue('', 'material')).toBeNull()
    expect(readFacetValue('{}', 'material')).toBeNull()
  })

  it('takes the FIRST occurrence — the same answer Postgres substring(… from pattern) gives', () => {
    expect(readFacetValue('{"material":"wood","material":"glass"}', 'material')).toBe('wood')
  })

  /**
   * ⚠️ THE SAME NEEDLE AS THE BROWSE FILTER. The material chip matches `"material":"wood"` in the text
   * (attrNeedles, attr-match.ts); the band must read exactly the rows the chip returns, no more and no
   * fewer, or "Based on N similar listings" counts listings the reader could not find by filtering.
   * A spaced `"material": "wood"` is therefore NOT read — the chip does not match it either (and on
   * 2026-10-05 none of the 44,805 stored rows was spaced).
   */
  it('reads exactly what the browse filter\'s needle matches', () => {
    for (const e of entries) {
      if (e.facet === null) continue
      for (const value of fallbackFacetValues(e.category, e.subcategory, e.facet)) {
        const stored = JSON.stringify({ condition: 'used', [e.facet]: value })
        const needle = attrNeedles(e.facet, value).attributes[0]
        expect(stored.includes(needle), `${e.facet}=${value}`).toBe(true)
        expect(readFacetValue(stored, e.facet)).toBe(value)
      }
    }
    expect(readFacetValue('{"material": "wood"}', 'material')).toBeNull()
    expect('{"material": "wood"}'.includes(attrNeedles('material', 'wood').attributes[0])).toBe(false)
  })
})

describe('fallbackBandKey', () => {
  const beds = { categorySlug: 'furniture-appliances', subcategorySlug: 'beds-mattresses' }

  it('a shelf-alone shelf keys on the shelf', () => {
    expect(fallbackBandKey({ categorySlug: 'fashion-beauty', subcategorySlug: 'womens', attributes: null })).toBe(FALLBACK_SHELF_MODEL)
    // …whatever attributes it carries.
    expect(fallbackBandKey({ categorySlug: 'fashion-beauty', subcategorySlug: 'womens', attributes: '{"size":"m"}' })).toBe(FALLBACK_SHELF_MODEL)
  })

  it('a facet shelf keys on facet=value, from the stored text or from form values', () => {
    expect(fallbackBandKey({ ...beds, attributes: '{"condition":"used","material":"wood"}' })).toBe('material=wood')
    expect(fallbackBandKey({ ...beds, attributes: { material: 'metal' } })).toBe('material=metal')
  })

  it('⛔ a facet shelf WITHOUT the value gets no band — never the shelf alone', () => {
    expect(fallbackBandKey({ ...beds, attributes: null })).toBeNull()
    expect(fallbackBandKey({ ...beds, attributes: '{"condition":"used"}' })).toBeNull()
    expect(fallbackBandKey({ ...beds })).toBeNull()
  })

  it('only a taxonomy value completes the key — an importer\'s free text never mints a band', () => {
    expect(fallbackBandKey({ ...beds, attributes: '{"material":"Gỗ sồi"}' })).toBeNull()
    expect(fallbackBandKey({ ...beds, attributes: '{"material":"Wood"}' })).toBeNull()
    expect(fallbackBandKey({ ...beds, attributes: '{"material":" wood"}' })).toBeNull()
  })

  it('reads the facet of THAT shelf — electronics has two `storage` facets, tv-monitors its own screenSize', () => {
    expect(fallbackBandKey({ categorySlug: 'electronics', subcategorySlug: 'tv-monitors', attributes: '{"screenSize":"55"}' })).toBe('screenSize=55')
    expect(fallbackBandKey({ categorySlug: 'electronics', subcategorySlug: 'tv-monitors', attributes: '{"screenSize":"56"}' })).toBeNull()
  })

  it('has no band for a shelf that is not in the map', () => {
    expect(fallbackBandKey({ categorySlug: 'furniture-appliances', subcategorySlug: 'white-goods', attributes: null })).toBeNull()
    expect(fallbackBandKey({ categorySlug: 'electronics', subcategorySlug: 'phones-tablets', attributes: '{"storage":"128"}' })).toBeNull()
  })
})

describe('fallbackMapRows — the table the nightly SQL joins against', () => {
  const rows = fallbackMapRows()

  it('has one row per shelf-alone shelf and one per facet value, each exactly once', () => {
    const keys = rows.map((r) => `${r.cat}/${r.sub}|${r.facet}|${r.val}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const e of entries) {
      const mine = rows.filter((r) => r.cat === e.category && r.sub === e.subcategory)
      if (e.facet === null) {
        expect(mine, e.key).toEqual([{ cat: e.category, sub: e.subcategory, facet: null, val: null, pattern: null }])
      } else {
        expect(mine.map((r) => r.val).sort(), e.key).toEqual([...fallbackFacetValues(e.category, e.subcategory, e.facet)].sort())
        for (const r of mine) expect(r.pattern).toBe(facetValuePattern(e.facet))
      }
    }
  })

  it('⛔ carries no never-category row', () => {
    for (const r of rows) expect(FALLBACK_NEVER_CATEGORIES.has(r.cat), r.cat).toBe(false)
  })
})
