import { describe, expect, it } from 'vitest'
import { parseSearchQuery, REL, scoreRow, wordStart, type RelevanceRow } from './text-relevance'
import { searchScore } from './ranking-formula'

/**
 * GOLDEN ROWS, shaped like the production rows measured 2026-09-29 (S-RANK). q=iphone opened on a
 * Viettel eSIM and an Under Armour tote bag — each mentions an iPhone only in its description — and
 * q=honda on a pressure washer; q=sofa had a mattress vacuum at #3. Relevance reads the title, the
 * Vietnamese title, the model, the brand and the category, never the description, so those rows are
 * WEAK and every row that names the thing is STRONG.
 */
const row = (r: Partial<RelevanceRow> & { title: string; category: RelevanceRow['category'] }): RelevanceRow =>
  ({ titleVi: null, model: null, brandSlug: null, subcategorySlug: null, ...r })

const SERVICES = { slug: 'services', name: 'Services', nameVi: 'Dịch vụ' }
const ELECTRONICS = { slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' }
const SPORTS = { slug: 'sports', name: 'Sports', nameVi: 'Thể thao' }
const HOME = { slug: 'home-living', name: 'Home & Living', nameVi: 'Nhà cửa' }

const esim = row({ title: 'Viettel eSIM 5GB/day — 30 days', subcategorySlug: 'esim', category: SERVICES })
const tote = row({ title: 'Under Armour Tote Bag', brandSlug: 'under-armour', category: SPORTS })
const iphone = row({ title: 'iPhone 18 Pro 256GB', brandSlug: 'apple', model: 'iPhone 18 Pro', subcategorySlug: 'phones-tablets', category: ELECTRONICS })
const lens = row({ title: 'Mipow Camera Lens Protector for iPhone 15', brandSlug: 'mipow', subcategorySlug: 'screen-protectors', category: ELECTRONICS })
const sofa = row({ title: 'Used Sofa Bench', subcategorySlug: 'sofa-seating', category: HOME })
const vacuum = row({ title: 'AQUA mattress vacuum cleaner', brandSlug: 'aqua', category: HOME })
const washerHonda = row({ title: 'HD350A Pressure Washer HONDA engine', brandSlug: 'honda', category: HOME })
const washerOther = row({ title: 'SK9070 Car Washer', category: HOME })
const fridgeVi = row({ title: 'Samsung refrigerator 300L', titleVi: 'Tủ lạnh Samsung 300L', brandSlug: 'samsung', category: HOME })

const score = (r: RelevanceRow, q: string) => scoreRow(r, parseSearchQuery(q))
/** searchScore at equal trust and recency — the order the keyword path serves. */
const at = (r: RelevanceRow, q: string) => searchScore({ relevance: score(r, q).relevance, sellerTrustScore: 100, postedAt: new Date(0) }, 0)

describe('scoreRow — strong means the row itself names the thing', () => {
  it('iphone: the phone and the iPhone accessory are strong; the eSIM and the tote are weak', () => {
    expect(score(iphone, 'iphone').strong).toBe(true)
    expect(score(lens, 'iphone').strong).toBe(true)
    expect(score(esim, 'iphone').strong).toBe(false)
    expect(score(tote, 'iphone').strong).toBe(false)
  })

  it('iphone: the phone outranks the accessory that merely fits it, at equal trust and recency', () => {
    expect(at(iphone, 'iphone')).toBeGreaterThan(at(lens, 'iphone'))
    expect(score(iphone, 'iphone').relevance).toBeLessThanOrEqual(1)
  })

  it('sofa: the sofa is strong, the vacuum is not', () => {
    expect(score(sofa, 'sofa').strong).toBe(true)
    expect(score(vacuum, 'sofa').strong).toBe(false)
  })

  it('honda: the row that says Honda (title or brand) is strong, the washer that only mentions it is not', () => {
    expect(score(washerHonda, 'honda').strong).toBe(true)
    expect(score(washerOther, 'honda').strong).toBe(false)
  })

  it('an accent-free query finds the Vietnamese title ("tu lanh" → "Tủ lạnh Samsung")', () => {
    expect(score(fridgeVi, 'tu lanh').strong).toBe(true)
    // …and its English synonym in the title counts too, a little less than the typed words.
    expect(score(row({ title: 'Fridge Toshiba 180L', category: HOME }), 'tu lanh').strong).toBe(true)
  })

  it('a synonym counts SYNONYM_FACTOR of the typed word, so "condo" prefers a row that says "condo"', () => {
    const rentals = { slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê' }
    const says = row({ title: 'Condo 2BR Thao Dien', category: rentals })
    const synonym = row({ title: 'Apartment 2BR Thao Dien', category: rentals })
    expect(score(synonym, 'condo').strong).toBe(true)
    expect(score(says, 'condo').relevance).toBeGreaterThan(score(synonym, 'condo').relevance)
  })

  it('every unit must find evidence: "honda red" is weak on a Honda that is not red', () => {
    expect(score(washerHonda, 'honda red').strong).toBe(false)
    expect(score(row({ title: 'Honda Vision red 2022', category: HOME }), 'honda red').strong).toBe(true)
  })

  it('a weak unit adds DESC_ONLY, a phrase in order adds PHRASE_BONUS, and relevance stays in [0, 1]', () => {
    expect(score(esim, 'iphone').relevance).toBeCloseTo(REL.DESC_ONLY / REL.MAX_PER_UNIT)
    const inOrder = score(row({ title: 'Honda Vision 2022', category: HOME }), 'honda vision').relevance
    const reversed = score(row({ title: 'Vision by Honda 2022', category: HOME }), 'honda vision').relevance
    expect(inOrder - reversed).toBeGreaterThanOrEqual(REL.PHRASE_BONUS - 1e-9)
    for (const r of [iphone, lens, sofa, fridgeVi]) expect(score(r, 'iphone sofa tu lanh').relevance).toBeLessThanOrEqual(1)
  })

  it('an empty query is never strong', () => {
    expect(score(iphone, '')).toEqual({ relevance: 0, strong: false })
  })
})

describe('wordStart — the regex the search predicate reproduces', () => {
  it('matches at the start of a word, after any non-alphanumeric', () => {
    expect(wordStart('e-scooter 50cc', 'scooter')).toBe(true)
    expect(wordStart('(scooter)', 'scooter')).toBe(true)
    expect(wordStart('dependable', 'pen')).toBe(false)
    expect(wordStart('maybe later', 'may')).toBe(true)
    expect(wordStart('ultimaybe', 'may')).toBe(false)
  })
})

describe('parseSearchQuery', () => {
  it('keeps each unit\'s words as typed, for the title recall ILIKE cannot fold', () => {
    const q = parseSearchQuery('Tủ lạnh Samsung')
    expect(q.units.map((u) => u.terms[0])).toEqual(['tu lanh', 'samsung'])
    expect(q.typed).toEqual(['tủ lạnh', 'samsung'])
    expect(q.phrase).toBe('tu lanh samsung')
  })
})
