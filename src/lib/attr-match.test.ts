import { describe, expect, it } from 'vitest'
import { attrFiltersFrom, attrMatcher, attrNeedles, attrRowMatches, attrWhere, OR_MORE_CEILING, viewScope } from './attr-match'
import { COMPAT_DISPLAY_PREFIXES, extractSpecs, specsFor } from './electronics-specs'
import { facetsFor, roomAttributes, roomCountValue, ROOM_COUNT_TOP } from './taxonomy'

const row = (attrs: Record<string, string> | null, facetTokens: string | null = null) => ({
  attributes: attrs ? JSON.stringify(attrs) : null,
  facetTokens,
})

describe('attrNeedles — the default shape', () => {
  it('is the exact JSON pair, plus the facet token for a slug-shaped value', () => {
    expect(attrNeedles('size', 'm')).toEqual({ attributes: ['"size":"m"'], tokens: ['|size:m|'] })
    expect(attrWhere('size', 'm')).toEqual({ OR: [{ attributes: { contains: '"size":"m"' } }, { facetTokens: { contains: '|size:m|' } }] })
  })

  it('builds no token needle from a value that is not a taxonomy slug', () => {
    expect(attrNeedles('size', 'm|sport:running').tokens).toEqual([])
  })

  it('cannot match a longer value — the closing quote and the token bars are the boundary', () => {
    expect(attrRowMatches(row({ ram: '80' }), 'ram', '8')).toBe(false)
    expect(attrRowMatches(row(null, '|size:m-l|'), 'size', 'm')).toBe(false)
    expect(attrRowMatches(row(null, '|size:m|size:l|'), 'size', 'l')).toBe(true)
  })
})

describe('room counts — 1…5 exact, 6+ open-ended', () => {
  it('offers Studio, 1-5 and 6+ bedrooms in rentals and property, 1-5 and 6+ bathrooms and floors', () => {
    const labels = (cat: string, sub: string, key: string) => facetsFor(cat, sub).find((f) => f.key === key)!.options.map((o) => o.label)
    expect(labels('rentals', 'apartment-rental', 'bedrooms')).toEqual(['Studio', '1 BR', '2 BR', '3 BR', '4 BR', '5 BR', '6+ BR'])
    expect(labels('rentals', 'house-rental', 'bathrooms')).toEqual(['1', '2', '3', '4', '5', '6+'])
    expect(labels('property', 'house', 'bedrooms')).toEqual(['Studio', '1 BR', '2 BR', '3 BR', '4 BR', '5 BR', '6+ BR'])
    expect(labels('property', 'house', 'floors')).toEqual(['1', '2', '3', '4', '5', '6+'])
    expect(ROOM_COUNT_TOP).toBe(6)
  })

  it('matches each exact bucket exactly', () => {
    expect(attrRowMatches(row({ bedrooms: '3' }), 'bedrooms', '3')).toBe(true)
    expect(attrRowMatches(row({ bedrooms: '4' }), 'bedrooms', '3')).toBe(false)
    expect(attrRowMatches(row({ bedrooms: '30' }), 'bedrooms', '3')).toBe(false)
  })

  it('matches 6+ as ≥6 — the clamped value, and any larger count an older writer stored', () => {
    for (const n of [6, 7, 10, OR_MORE_CEILING]) expect(attrRowMatches(row({ bedrooms: String(n) }), 'bedrooms', '6')).toBe(true)
    expect(attrRowMatches(row({ bedrooms: '5' }), 'bedrooms', '6')).toBe(false)
    expect(attrRowMatches(row({ bathrooms: '8' }), 'bathrooms', '6')).toBe(true)
  })

  it('reads a hand-written N+ (and the "N " a literal + decodes to) as ≥N', () => {
    for (const v of ['3+', '3plus', '3 ']) {
      expect(attrRowMatches(row({ bedrooms: '3' }), 'bedrooms', v)).toBe(true)
      expect(attrRowMatches(row({ bedrooms: '5' }), 'bedrooms', v)).toBe(true)
      expect(attrRowMatches(row({ bedrooms: '2' }), 'bedrooms', v)).toBe(false)
    }
  })

  it('leaves a facet with no open-ended option alone — seats "9plus" is its own stored value', () => {
    expect(attrNeedles('seats', '9plus')).toEqual({ attributes: ['"seats":"9plus"'], tokens: ['|seats:9plus|'] })
  })

  it('stores counts clamped at the top bucket, and a missing or zero count as nothing (never a Studio)', () => {
    expect(roomCountValue(1)).toBe('1')
    expect(roomCountValue(4)).toBe('4')
    expect(roomCountValue(9)).toBe('6')
    expect(roomCountValue('5')).toBe('5')
    for (const v of [0, null, undefined, '', 'x', -1, Number.NaN]) expect(roomCountValue(v)).toBeNull()
    expect(roomAttributes({ bedrooms: 4, bathrooms: 7 })).toBe('{"bedrooms":"4","bathrooms":"6"}')
    expect(roomAttributes({ bedrooms: 2, bathrooms: null })).toBe('{"bedrooms":"2"}')
    expect(roomAttributes({ bedrooms: 0, bathrooms: 0 })).toBeNull()
  })
})

describe('"Fits" (compatibleWith) — the chip slug AND the stored device names', () => {
  // Spellings as stored on production, 2026-09-25 (a sample of every family in the table).
  const STORED = [
    'iPhone 17 Pro Max', 'iPhone 17e', 'iPhone 16 Plus', 'iPhone 15ProMax', 'iPhone 14 Promax', 'iPhone 14Pro',
    'iPhone 13 Mini', 'iPhone12 Pro Max', 'iPhone 12Mini', 'iPhone 11 Pro', 'iPhone 18 Pro Max', 'iPhone 8', 'iPhone 1',
    'iPhone 78 Plus', 'iPad', 'iPad Pro M5', 'iPad Air', 'MacBook Pro', 'MacBook Air', 'Apple Watch Ultra',
    'Apple Watch Series 6', 'AirPods Pro', 'Galaxy S26 Ultra', 'Galaxy S26 FE', 'Galaxy S25 Plus', 'Galaxy S24',
    'Galaxy S23 Ultra', 'Galaxy S22 Ultra', 'Galaxy A57', 'Galaxy A8 Plus', 'Galaxy Z Fold8', 'Galaxy Z Flip 6',
    'Galaxy Fold 4', 'Galaxy Tab S9 Ultra', 'Galaxy Tab A11', 'Galaxy Note 20 Ultra', 'Galaxy M55', 'Galaxy Watch 5',
    'Redmi Note 15', 'Xiaomi 15T', 'Redmi 10C',
  ]
  const slugs = specsFor('phone-cases').find((s) => s.key === 'compatibleWith')!.values.map((v) => v.value)

  it('every alias family is a real chip', () => {
    for (const slug of Object.keys(COMPAT_DISPLAY_PREFIXES)) expect(slugs).toContain(slug)
  })

  it('assigns each stored name to exactly the chip the title extractor would — or to none', () => {
    for (const name of STORED) {
      const matched = slugs.filter((slug) => attrRowMatches(row({ compatibleWith: name }), 'compatibleWith', slug))
      const expected = extractSpecs('phone-cases', name).compatibleWith
      expect(matched, name).toEqual(expected ? [expected] : [])
    }
  })

  it('still matches rows that stored the slug itself', () => {
    expect(attrRowMatches(row({ compatibleWith: 'iphone14' }), 'compatibleWith', 'iphone14')).toBe(true)
  })

  it('anchors the prefix on the value, so no other key or position can match', () => {
    expect(attrRowMatches(row({ title: 'iPhone 14', compatibleWith: 'Galaxy S24' }), 'compatibleWith', 'iphone14')).toBe(false)
  })
})

describe('attrFiltersFrom', () => {
  it('reads attr_* the way the feed does — sanitised key, `all` ignored', () => {
    expect(attrFiltersFrom(new URLSearchParams('attr_bed-rooms=2&attr_size=all&attr_color=red&category=x'))).toEqual([
      { key: 'bedrooms', value: '2' },
      { key: 'color', value: 'red' },
    ])
  })
})

describe('viewScope', () => {
  it('names the view the Filter-panel counts are about', () => {
    expect(viewScope('rentals', 'office-rental')).toBe('rentals/office-rental')
    expect(viewScope('rentals', 'all')).toBe('rentals/all')
    expect(viewScope('rentals', null)).toBe('rentals/all')
  })
})

describe('rentalPeriod=weekly — "Theo tuần" means rentable for a week (owner, 2026-10-05)', () => {
  it('matches rows with a weekly rate AND daily-priced rows; monthly-only rows stay out', () => {
    const m = attrMatcher('rentalPeriod', 'weekly')
    expect(m({ attributes: '{"rentalPeriod":"daily"}', facetTokens: null })).toBe(true)
    expect(m({ attributes: '{"rentalPeriod":"monthly"}', facetTokens: '|rentalPeriod:daily|rentalPeriod:weekly|rentalPeriod:monthly|' })).toBe(true)
    expect(m({ attributes: '{"rentalPeriod":"monthly"}', facetTokens: '|rentalPeriod:monthly|' })).toBe(false)
    expect(m({ attributes: null, facetTokens: null })).toBe(false)
  })
  it('a row tagged weekly only in its attributes, with no tokens, still matches', () => {
    expect(attrMatcher('rentalPeriod', 'weekly')({ attributes: '{"rentalPeriod":"weekly"}', facetTokens: null })).toBe(true)
  })
  it('⛔ the DATABASE predicate is the same OR — weekly or daily, in attributes or tokens (the grid and the counts agree)', () => {
    expect(attrWhere('rentalPeriod', 'weekly')).toEqual({
      OR: [
        { attributes: { contains: '"rentalPeriod":"weekly"' } },
        { attributes: { contains: '"rentalPeriod":"daily"' } },
        { facetTokens: { contains: '|rentalPeriod:weekly|' } },
        { facetTokens: { contains: '|rentalPeriod:daily|' } },
      ],
    })
  })
  it('the other periods are unchanged — daily is daily, monthly is monthly', () => {
    expect(attrMatcher('rentalPeriod', 'daily')({ attributes: '{"rentalPeriod":"weekly"}', facetTokens: null })).toBe(false)
    expect(attrMatcher('rentalPeriod', 'monthly')({ attributes: '{"rentalPeriod":"daily"}', facetTokens: null })).toBe(false)
  })
})

// ── "Can teach in" (teacher onboarding redesign, 2026-10-08) — one expansion for the feed and the counts ────────────
describe('workIn — "Can teach in" reads the way a school means it', () => {
  const tokens = (...keys: string[]) => row(null, `|${keys.map((k) => `workIn:${k}`).join('|')}|`)
  /** The feed's predicate (Prisma `contains` over facetTokens) evaluated in JS — what attrWhere asks the database. */
  const feed = (key: string, value: string, r: { attributes: string | null; facetTokens: string | null }) => {
    const where = attrWhere(key, value) as { OR: { attributes?: { contains: string }; facetTokens?: { contains: string } }[] }
    return where.OR.some((c) => (c.facetTokens && (r.facetTokens ?? '').includes(c.facetTokens.contains)) || (c.attributes && (r.attributes ?? '').includes(c.attributes.contains)))
  }
  const cases: [string, string[], boolean][] = [
    ['ho-chi-minh-city', ['d7'], true], // a district teacher is found by their city
    ['ho-chi-minh-city', ['anywhere'], true], // "will move anywhere" is found by every place
    ['ho-chi-minh-city', ['binh-duong'], false], // the same province, but another city
    ['d1', ['ho-chi-minh-city'], true], // "anywhere in HCMC" covers District 1
    ['d1', ['d7'], false], // ⛔ a District 7 teacher never answers a District 1 search
    ['d2', ['thu-duc'], true], // Thủ Đức covers its old District 2
    ['d9', ['d2'], false],
    ['khanh-hoa', ['p-56'], true], // Nha Trang ↔ Khánh Hoà (B5)
    ['p-56', ['khanh-hoa'], true],
    ['p-52', ['p-52'], true],
    ['p-52', ['khanh-hoa'], false],
    ['online', ['online'], true],
    ['online', ['anywhere'], false], // Online is exact
    ['anywhere', ['ha-noi'], false], // "anywhere" is exact
  ]
  it.each(cases)('attr_workIn=%s vs %j → %s, identically in the feed and the Filter count', (value, keys, expected) => {
    const r = tokens(...keys)
    expect(attrMatcher('workIn', value)(r)).toBe(expected)
    expect(feed('workIn', value, r)).toBe(expected)
  })
  it('⛔ keeps all 14 old values working (B10): every old link still finds the rows the old facet stored', () => {
    const OLD = ['ho-chi-minh-city', 'ha-noi', 'da-nang', 'hai-phong', 'can-tho', 'hue', 'khanh-hoa', 'lam-dong', 'dong-nai', 'binh-duong', 'vung-tau', 'phu-quoc', 'anywhere', 'online']
    for (const v of OLD) {
      expect(attrRowMatches(tokens(v), 'workIn', v), v).toBe(true)
      expect(feed('workIn', v, tokens(v)), v).toBe(true)
    }
  })
  it('is tokens only — a teacher row stores no workIn attribute', () => {
    expect(attrNeedles('workIn', 'ha-noi').attributes).toEqual([])
  })
  it('keeps the old derived-token links: attr_jobType=online and attr_ageGroup=business', () => {
    const r = row(null, '|jobType:fulltime|jobType:online|ageGroup:business|')
    expect(attrRowMatches(r, 'jobType', 'online')).toBe(true)
    expect(attrRowMatches(r, 'ageGroup', 'business')).toBe(true)
  })
})
