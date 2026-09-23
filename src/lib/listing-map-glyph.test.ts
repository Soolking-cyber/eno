import { describe, expect, it } from 'vitest'
import { MAP_GLYPH_LABEL, MAP_GLYPH_PATH, glyphCountLabel, mapGlyphFor, type MapGlyph } from './listing-map-glyph'
import { SUBCATEGORIES } from './subcategories'

/**
 * ⛔ THE POINT OF THIS FILE IS THE DRIFT TEST BELOW, not the spot checks. A hand-written slug map
 * beside a 1,367-line taxonomy is exactly the pair that separates silently: someone adds
 * `penthouse-rental`, every one of its pins quietly falls back to the generic place mark, and
 * nothing fails. The taxonomy is the source of truth, so the test reads it rather than repeating it.
 */
describe('mapGlyphFor', () => {
  it('reads the property kinds it is meant to tell apart', () => {
    expect(mapGlyphFor('apartment-rental')).toBe('apartment')
    expect(mapGlyphFor('house-rental')).toBe('house')
    expect(mapGlyphFor('office-rental')).toBe('office')
    expect(mapGlyphFor('room-rental')).toBe('room')
    expect(mapGlyphFor('land')).toBe('land')
  })

  /** Hotels and homestays are rooms, not homes — one night is not a tenancy. */
  it('files short stays as rooms', () => {
    expect(mapGlyphFor('hotel-short-stay')).toBe('room')
    expect(mapGlyphFor('homestay-serviced')).toBe('room')
  })

  /**
   * ⚠️ THE BUCKET THAT MUST NOT MERGE. ~446 imported rows carry `subcategorySlug: null`, and
   * `rentals` also holds scooters and cars. If vehicles fell back to the same mark as those nulls, a
   * motorbike would pin identically to a house.
   */
  it('keeps vehicles apart from the unknown fallback', () => {
    for (const slug of ['motorbike-rental', 'car-rental', 'bicycle-rental', 'ebike-rental']) {
      expect(mapGlyphFor(slug)).toBe('vehicle')
    }
    expect(mapGlyphFor(null)).toBe('other')
    expect(mapGlyphFor(undefined)).toBe('other')
    expect(mapGlyphFor('')).toBe('other')
  })

  /** An allow-list, so an unrecognised or adversarial slug is a generic mark, never a guess. */
  it('does not prefix-match its way to a wrong mark', () => {
    expect(mapGlyphFor('office-supplies')).toBe('other')
    expect(mapGlyphFor('apartment-cleaning')).toBe('other')
    expect(mapGlyphFor('moving-sale')).toBe('other')
    expect(mapGlyphFor('__proto__')).toBe('other')
    expect(mapGlyphFor('constructor')).toBe('other')
  })

  /**
   * ⛔ THE DRIFT GUARD. Every subcategory of the two categories whose listings are PLACES must
   * resolve to a real mark. Vehicle-rental slugs live under `rentals` too and are covered by their
   * own bucket, so the only way to fail here is to add a new place kind and forget the glyph.
   */
  it('covers every rentals and property subcategory the taxonomy defines', () => {
    const unmapped: string[] = []
    for (const category of ['rentals', 'property'] as const) {
      for (const sub of SUBCATEGORIES[category] ?? []) {
        if (sub.slug === 'moving-sale') continue // a box of furniture, not a place
        if (mapGlyphFor(sub.slug) === 'other') unmapped.push(`${category}/${sub.slug}`)
      }
    }
    expect(unmapped, `add these to BY_SLUG in listing-map-glyph.ts: ${unmapped.join(', ')}`).toEqual([])
  })
})

describe('the glyph table', () => {
  const buckets: MapGlyph[] = ['apartment', 'house', 'office', 'room', 'land', 'vehicle', 'other']

  it('draws and names every bucket', () => {
    for (const b of buckets) {
      expect(MAP_GLYPH_PATH[b], b).toBeTruthy()
      expect(MAP_GLYPH_LABEL[b].en, b).toBeTruthy()
      expect(MAP_GLYPH_LABEL[b].vi, b).toBeTruthy()
    }
  })

  /**
   * ⚠️ PATH DATA IS INTERPOLATED INTO RAW MARKER HTML, so it must stay path data. A quote or an
   * angle bracket here would break out of the attribute — the same escaping boundary `pinHtml`
   * documents, enforced at the source instead of trusted.
   */
  it('holds nothing that could escape an HTML attribute', () => {
    for (const b of buckets) {
      expect(MAP_GLYPH_PATH[b], b).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9 .,-]+$/)
    }
  })

  /** Drawn for 13px: a mark that needs a dozen strokes will not read, and costs bytes per marker. */
  it('stays simple enough to read at pin size', () => {
    for (const b of buckets) {
      expect(MAP_GLYPH_PATH[b].length, `${b} is too detailed for a 13px pin`).toBeLessThan(150)
    }
  })
})

describe('glyphCountLabel', () => {
  /** ⛔ THE REASON THE PLURAL IS SPELT OUT: `+ 's'` would have shipped "lands". */
  it('pluralises EVERY bucket without inventing a word', () => {
    // ⚠️ Named in full because the spec says "every bucket" — a reviewer noticed it had been
    // claiming that while skipping `room` and `vehicle`.
    expect(glyphCountLabel('apartment', 157, 'en')).toBe('157 apartments')
    expect(glyphCountLabel('house', 2, 'en')).toBe('2 houses')
    expect(glyphCountLabel('office', 3, 'en')).toBe('3 offices')
    expect(glyphCountLabel('room', 5, 'en')).toBe('5 rooms')
    expect(glyphCountLabel('land', 4, 'en')).toBe('4 plots')
    expect(glyphCountLabel('vehicle', 6, 'en')).toBe('6 vehicles')
    expect(glyphCountLabel('other', 9, 'en')).toBe('9 listings')
  })
  it('uses the singular for exactly one', () => {
    expect(glyphCountLabel('apartment', 1, 'en')).toBe('1 apartment')
    expect(glyphCountLabel('land', 1, 'en')).toBe('1 plot')
  })
  /** Vietnamese does not inflect for number — the same word either way is the language, not a gap. */
  it('does not inflect Vietnamese', () => {
    expect(glyphCountLabel('apartment', 1, 'vi')).toBe('1 căn hộ')
    expect(glyphCountLabel('apartment', 157, 'vi')).toBe('157 căn hộ')
  })
  /** A counted noun reads lowercase ("157 căn hộ"); the pin tooltip capitalises it at its own site. */
  it('keeps the Vietnamese nouns lowercase for counting', () => {
    for (const b of Object.values(MAP_GLYPH_LABEL)) {
      expect(b.vi[0]).toBe(b.vi[0].toLowerCase())
      expect(b.enPlural[0]).toBe(b.enPlural[0].toLowerCase())
      expect(b.enOne[0]).toBe(b.enOne[0].toLowerCase())
    }
  })
})
