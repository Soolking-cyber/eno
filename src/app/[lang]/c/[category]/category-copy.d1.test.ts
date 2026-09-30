import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

/**
 * SEO wave B, D1: rentals district pages count HOMES in their title and description, name the free
 * availability check, and use D-f's neutral sentence (CS-2, approved 2026-09-30).
 * ⛔ THE CHECK'S LIMIT IS MOCKED TO 7 so a typed "5" cannot pass by coincidence (plan v4, fix 7).
 */
vi.mock('@/lib/rental-check/shared', () => ({ RENTAL_CHECK_MAX_ITEMS: 7 }))

import {
  RENTALS_LINKED_SENTENCE, RENTALS_PLACE_LABEL, districtMetadata, homeFacts, listsHomesOnly, rentalsPlaceLabel, type DistrictFacts,
} from './category-copy'

const D7 = { en: 'District 7 (Phu My Hung)', vi: 'Quận 7 (Phú Mỹ Hưng)' }
const facts = (bySub: Record<string, number>, over: Partial<DistrictFacts> = {}): DistrictFacts => {
  const homes = homeFacts(bySub)
  return {
    category: { slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê' },
    place: D7, inHcmc: true,
    total: Object.values(bySub).reduce((a, b) => a + b, 0),
    linked: 'all', homes, homesLinked: 'all',
    ...over,
  }
}
const D7_STOCK = { 'apartment-rental': 1877, 'house-rental': 277, 'room-rental': 196, 'office-rental': 212, 'homestay-serviced': 9 }
const OFFICE_WORD = /office|văn phòng|mặt bằng/i

describe('homeFacts', () => {
  it('sums the three home kinds, and counts offices as office-rental alone', () => {
    const h = homeFacts({ ...D7_STOCK, '': 40 })
    expect(h.total).toBe(1877 + 277 + 196)
    expect(h.kinds.map((k) => k.slug)).toEqual(['apartment-rental', 'house-rental', 'room-rental'])
    expect(h.offices).toBe(212)
  })
})

describe('listsHomesOnly — an indexable page always lists at least the floor', () => {
  const FLOOR = 10
  it('lists homes only while it has homes, unless they alone are under the floor on an indexable page', () => {
    expect(listsHomesOnly(homeFacts(D7_STOCK), 2562, FLOOR)).toBe(true)
    expect(listsHomesOnly(homeFacts({ 'house-rental': 2, 'office-rental': 9 }), 90, FLOOR)).toBe(false) // cu-chi, 2026-09-30
    expect(listsHomesOnly(homeFacts({ 'house-rental': 1 }), 1, FLOOR)).toBe(true) // can-gio: noindex either way
    expect(listsHomesOnly(homeFacts({ 'apartment-rental': 10 }), 400, FLOOR)).toBe(true)
    expect(listsHomesOnly(homeFacts({ 'office-rental': 40 }), 40, FLOOR)).toBe(false)
    expect(listsHomesOnly(null, 40, FLOOR)).toBe(false)
  })
})

describe('rentals district titles (D-a)', () => {
  it('"Apartments & Houses for Rent in District 7 (Phu My Hung), HCMC" while both are listed', () => {
    expect(districtMetadata(facts(D7_STOCK), 'en', 'eno.vn').title).toBe('Apartments & Houses for Rent in District 7 (Phu My Hung), HCMC | eno.vn')
    expect(districtMetadata(facts(D7_STOCK), 'vi', 'eno.vn').title).toBe('Cho thuê căn hộ và nhà tại Quận 7 (Phú Mỹ Hưng), TP.HCM | eno.vn')
  })
  it('"Apartments for Rent in …" with no house; today\'s title with no apartment', () => {
    expect(districtMetadata(facts({ 'apartment-rental': 20 }), 'en', 'eno.vn').title).toBe('Apartments for Rent in District 7 (Phu My Hung), HCMC | eno.vn')
    expect(districtMetadata(facts({ 'apartment-rental': 20 }), 'vi', 'eno.vn').title).toBe('Cho thuê căn hộ tại Quận 7 (Phú Mỹ Hưng), TP.HCM | eno.vn')
    expect(districtMetadata(facts({ 'room-rental': 20 }), 'en', 'eno.vn').title).toBe('Rentals in District 7 (Phu My Hung), Ho Chi Minh City | eno.vn')
  })
  it('names the city only for an HCMC district', () => {
    expect(districtMetadata(facts(D7_STOCK, { inHcmc: false, place: { en: 'Binh Trung', vi: 'Bình Trưng' } }), 'en', 'eno.vn').title).toBe('Apartments & Houses for Rent in Binh Trung | eno.vn')
  })
  it('leaves other categories untouched', () => {
    const f = { ...facts(D7_STOCK), category: { slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' } }
    expect(districtMetadata(f, 'en', 'eno.vn').title).toBe('Electronics in District 7 (Phu My Hung), Ho Chi Minh City | eno.vn')
  })
})

describe('the search labels (D-d)', () => {
  it('d2, d9 and thu-duc read as searchers write them; everything else keeps its DISTRICTS label', () => {
    expect(rentalsPlaceLabel('d2', { en: 'x', vi: 'x' })).toEqual({ en: 'District 2 (Thao Dien)', vi: 'Quận 2 (Thảo Điền)' })
    expect(rentalsPlaceLabel('d9', { en: 'x', vi: 'x' })).toEqual({ en: 'District 9', vi: 'Quận 9' })
    expect(rentalsPlaceLabel('thu-duc', { en: 'x', vi: 'x' })).toEqual({ en: 'Thu Duc City', vi: 'TP Thủ Đức' })
    expect(rentalsPlaceLabel('d7', D7)).toBe(D7)
    expect(rentalsPlaceLabel('constructor', D7)).toBe(D7)
    const t = (slug: string) => districtMetadata(facts(D7_STOCK, { place: RENTALS_PLACE_LABEL[slug] }), 'en', 'eno.vn').title
    expect(t('d2')).toBe('Apartments & Houses for Rent in District 2 (Thao Dien), HCMC | eno.vn')
    expect(t('d9')).toBe('Apartments & Houses for Rent in District 9, HCMC | eno.vn')
    expect(t('thu-duc')).toBe('Apartments & Houses for Rent in Thu Duc City, HCMC | eno.vn')
  })
})

describe('the homes description (CS-2 D1-7)', () => {
  it.each(['en', 'vi'] as const)('%s: opens with the homes count, names no office, states the check from the constant', (lang) => {
    const d = districtMetadata(facts(D7_STOCK), lang, 'eno.vn').description
    expect(d).not.toMatch(OFFICE_WORD)
    expect(d).toContain(lang === 'vi' ? 'tối đa 7 căn' : 'up to 7 ')
    expect(d).toMatch(lang === 'vi' ? /^2\.350 chỗ ở cho thuê tại Quận 7 \(Phú Mỹ Hưng\), TP\.HCM — / : /^2,350 homes for rent in District 7 \(Phu My Hung\), HCMC — /)
    expect(d.endsWith(RENTALS_LINKED_SENTENCE.all[lang])).toBe(true)
  })
  it('English, whole', () => {
    expect(districtMetadata(facts(D7_STOCK), 'en', 'eno.vn').description).toBe(
      '2,350 homes for rent in District 7 (Phu My Hung), HCMC — 1,877 apartments, 277 houses and 196 rooms. Pick up to 7 and eno checks availability for free. Every listing links to its original ad on another listing site.',
    )
    expect(districtMetadata(facts(D7_STOCK), 'vi', 'eno.vn').description).toBe(
      '2.350 chỗ ở cho thuê tại Quận 7 (Phú Mỹ Hưng), TP.HCM — 1.877 căn hộ, 277 nhà và 196 phòng trọ. Chọn tối đa 7 căn, eno kiểm tra phòng trống miễn phí. Mỗi tin đều dẫn tới tin gốc trên một trang đăng tin khác.',
    )
  })
  it('lists only kinds with stock, singular at one, and no linked sentence when nothing is linked', () => {
    const d = districtMetadata(facts({ 'apartment-rental': 1 }, { homesLinked: 'none' }), 'en', 'eno.vn').description
    expect(d).toBe('1 home for rent in District 7 (Phu My Hung), HCMC — 1 apartment. Pick up to 7 and eno checks availability for free.')
  })
  it('fits 160 characters before the linked sentence in the longest case (District 7, five-digit counts)', () => {
    const big = facts({ 'apartment-rental': 33333, 'house-rental': 33333, 'room-rental': 33333 }, { homesLinked: 'none' })
    for (const lang of ['en', 'vi'] as const) expect(districtMetadata(big, lang, 'eno.vn').description.length).toBeLessThanOrEqual(160)
  })
  it('keeps today\'s all-rentals wording, with D-f\'s sentence, when there is no home', () => {
    const d = districtMetadata(facts({ 'office-rental': 12 }), 'en', 'eno.vn').description
    expect(d).toBe('12 places for rent in District 7 (Phu My Hung), Ho Chi Minh City. Every listing links to its original ad on another listing site.')
  })
  it('never says "partner property portal" in either language', () => {
    for (const lang of ['en', 'vi'] as const) {
      for (const stock of [D7_STOCK, { 'office-rental': 3 }]) {
        expect(districtMetadata(facts(stock), lang, 'eno.vn').description).not.toMatch(/partner|đối tác/i)
      }
    }
  })
})

describe('no typed limit', () => {
  it('category-copy.ts writes the check limit from the constant only', () => {
    const src = readFileSync('src/app/[lang]/c/[category]/category-copy.ts', 'utf8')
    expect(src).not.toMatch(/up to \d/)
    expect(src).not.toMatch(/tối đa \d/)
  })
})
