import { describe, expect, it } from 'vitest'
import { inferDistrictFromQuery, queryChips } from './district-query'
import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'

/**
 * ⛔ "still cant search by district" (owner, 2026-09-24). The feed read "Quận 7" as the lone token
 * `quan` and returned the whole city; these pin what the search box now reads as a district, and —
 * as much the point — what it must NOT (a price, a phone model, a car, a word that only looks like a
 * district once its accents are gone).
 */
const slug = (q: string) => inferDistrictFromQuery(q)?.slug ?? null

describe('inferDistrictFromQuery — numbered districts', () => {
  it.each(['Quận 7', 'quan 7', 'quận7', 'QUẬN 7', 'quân 7', 'District 7', 'district7', 'Dist 7', 'Dist. 7'])(
    'reads %j as Quận 7 — nothing else is called that',
    (q) => {
      expect(slug(q)).toBe('d7')
    },
  )

  it.each(['Q7', 'q7', 'Q.7', 'Q. 7', 'Q 7', 'D7', 'd.7'])('reads the shorthand %j as Quận 7 beside a place word', (q) => {
    expect(slug(`căn hộ ${q}`)).toBe('d7')
  })

  /**
   * ⛔ 129 live electronics listings carry a Q/D-number token — "Mainboard … D5", "Torras Q3",
   * "Huawei Watch D2", "Roborock Q7 Pro Max". A bare shorthand is a product search, not a district —
   * and it stays one everywhere, because the rule reads only the words (see the module comment).
   */
  it('reads a bare shorthand as text', () => {
    expect(slug('D5')).toBeNull()
    expect(slug('d4')).toBeNull()
    expect(slug('Q7')).toBeNull()
    expect(slug('roborock q7')).toBeNull()
  })

  it('a shorthand beside place words counts', () => {
    expect(slug('căn hộ Q7')).toBe('d7')
    expect(slug('2pn q7')).toBe('d7')
    expect(slug('phòng q7')).toBe('d7')
    expect(slug('phong q7')).toBe('d7')
    expect(slug('studio q7 view sông')).toBe('d7')
  })

  it('a word that only folds to a place word is not one — its accents say otherwise', () => {
    expect(slug('loa phóng thanh D5')).toBeNull() // a loudspeaker, not a room
    expect(slug('đặt q7')).toBeNull() // to order, not land
  })

  it('the verb "rent" is not a place — "thuê xe Q7" may be an Audi', () => {
    expect(slug('thuê xe Q7')).toBeNull()
    expect(slug('cho thuê q7')).toBeNull()
    expect(slug('cho thuê căn hộ q7')).toBe('d7')
    expect(slug('thuê xe quận 7')).toBe('d7') // the full word needs no evidence
  })

  it('a brand that names products with a letter-number vetoes the shorthand even beside a place word', () => {
    expect(slug('studio roborock q7')).toBeNull()
    expect(slug('phòng nikon d5')).toBeNull()
  })

  it('maps Quận 2 and Quận 9 to Thủ Đức, where DISTRICTS puts them', () => {
    expect(slug('Quận 2')).toBe('thu-duc')
    expect(slug('phòng trọ q9')).toBe('thu-duc')
  })

  it('keeps 1 and 10–12 apart', () => {
    expect(slug('Quận 1')).toBe('d1')
    expect(slug('Quận 10')).toBe('d10')
    expect(slug('Quận 12')).toBe('d12')
    expect(slug('Quận 13')).toBeNull()
  })

  it('"căn hộ quận 7" applies d7 AND keeps "căn hộ" as the text, in the typed spelling', () => {
    expect(inferDistrictFromQuery('căn hộ quận 7')).toEqual({ slug: 'd7', phrase: 'quận 7', rest: 'căn hộ' })
  })

  it('"2pn quận 2" → the Thủ Đức scope with "2pn" left as text', () => {
    expect(inferDistrictFromQuery('2pn quận 2')).toEqual({ slug: 'thu-duc', phrase: 'quận 2', rest: '2pn' })
  })

  it('drops a preposition that only belonged to the district, and the city it implies', () => {
    expect(inferDistrictFromQuery('căn hộ ở quận 7, TP.HCM')?.rest).toBe('căn hộ')
    expect(inferDistrictFromQuery('apartment in district 7')?.rest).toBe('apartment')
    expect(inferDistrictFromQuery('cho thuê nhà quận 7 hcm')?.rest).toBe('cho thuê nhà')
    expect(inferDistrictFromQuery('căn hộ (quận 7)')?.rest).toBe('căn hộ')
  })
})

describe('inferDistrictFromQuery — what is NOT a district', () => {
  it.each([
    ['iphone 7', 'a phone model has no district word'],
    ['7 triệu', 'a price'],
    ['căn hộ 7 triệu', 'a price beside a place word'],
    ['q 7tr', 'a unit glued to the number'],
    ['q7.5', 'a decimal'],
    ['quận 7 tuổi', 'an age'],
    ['quần 7', 'trousers: the accents conflict with Quận'],
    ['audi q7', 'a car'],
    ['thuê audi q7', 'a car, even beside a rental word'],
    ['nikon d5', 'a camera'],
    ['Đ7', 'đ is not d'],
    ['d 7', 'a spaced lone d'],
    ['q7 view sông', 'shorthand with no place word beside it'],
    ['quận 1 hoặc quận 3', 'two districts — one filter cannot say "or"'],
    ['Thảo Điền', 'a ward: as text it is precise, as Thủ Đức it would be 20× wider'],
  ])('%j → null (%s)', (q) => {
    expect(inferDistrictFromQuery(q)).toBeNull()
  })

  it('a spaced lone d, or a đ, is not the D shorthand even beside a place word', () => {
    expect(slug('căn hộ d 7')).toBeNull()
    expect(slug('căn hộ Đ7')).toBeNull()
    expect(slug('căn hộ D7')).toBe('d7')
  })

  it('a D-number inside a model name never matches', () => {
    expect(slug('Nikon D7500')).toBeNull()
    expect(slug('canon-d7')).toBeNull()
  })
})

describe('inferDistrictFromQuery — named districts', () => {
  it.each([
    ['Bình Thạnh', 'binh-thanh'], ['binh thanh', 'binh-thanh'], ['Quận Bình Thạnh', 'binh-thanh'],
    ['Q. Bình Thạnh', 'binh-thanh'], ['q.binh thanh', 'binh-thanh'], ['Binh Thanh District', 'binh-thanh'],
    ['Thủ Đức', 'thu-duc'], ['TP Thủ Đức', 'thu-duc'], ['Thu Duc City', 'thu-duc'],
    ['Gò Vấp', 'go-vap'], ['Phú Nhuận', 'phu-nhuan'], ['Tân Bình', 'tan-binh'], ['Bình Tân', 'binh-tan'],
    ['Tân Phú', 'tan-phu'], ['Bình Chánh', 'binh-chanh'], ['Hóc Môn', 'hoc-mon'], ['Củ Chi', 'cu-chi'],
    ['Cần Giờ', 'can-gio'], ['Nhà Bè', 'nha-be'], ['huyện nhà bè', 'nha-be'], ['H. Nhà Bè', 'nha-be'],
    ['Phú Mỹ Hưng', 'd7'],
  ])('reads %j as %s', (q, s) => {
    expect(slug(q)).toBe(s)
  })

  it('refuses a name whose accents conflict — the unaccented form is a different word', () => {
    expect(slug('cản gió')).toBeNull() // a windbreak, not Cần Giờ
    expect(slug('áo cản gió')).toBeNull()
    expect(slug('điều khiển cử chỉ')).toBeNull() // a gesture, not Củ Chi
    expect(slug('học môn toán')).toBeNull()
  })

  it('an ambiguous name typed without accents needs a place word', () => {
    expect(slug('dieu khien cu chi')).toBeNull()
    expect(slug('can gio')).toBeNull()
    expect(slug('nha can gio')).toBe('can-gio')
    expect(slug('nha be 2pn')).toBe('nha-be')
    expect(slug('huyện cần giờ')).toBe('can-gio') // a prefix or an accent is evidence on its own
  })

  it('an emoji before the phrase does not shift what is read or removed', () => {
    expect(inferDistrictFromQuery('🏠 căn hộ quận 7')).toEqual({ slug: 'd7', phrase: 'quận 7', rest: '🏠 căn hộ' })
    expect(inferDistrictFromQuery('🏢🛵 Bình Thạnh 2pn')).toEqual({ slug: 'binh-thanh', phrase: 'Bình Thạnh', rest: '🏢🛵 2pn' })
    expect(inferDistrictFromQuery('🏠 quần 7')).toBeNull() // the accent check still sees the right letters
  })

  it('two phrases for the same district are both removed', () => {
    expect(inferDistrictFromQuery('quận 2 thủ đức')).toEqual({ slug: 'thu-duc', phrase: 'quận 2', rest: '' })
  })
})

describe('queryChips — what the explorer shows for a typed query', () => {
  it('a plain query is one text chip that clears to nothing', () => {
    expect(queryChips('iphone 7', false)).toEqual([{ kind: 'text', text: 'iphone 7', clearTo: '' }])
  })

  it('"căn hộ quận 7" is two chips, each clearing only itself', () => {
    expect(queryChips('căn hộ quận 7', false)).toEqual([
      { kind: 'text', text: 'căn hộ', clearTo: 'quận 7' },
      { kind: 'district', slug: 'd7', clearTo: 'căn hộ' },
    ])
  })

  it('a bare district is one district chip that clears the box', () => {
    expect(queryChips('Quận 7', false)).toEqual([{ kind: 'district', slug: 'd7', clearTo: '' }])
  })

  it('a bare shorthand is a text chip, as the server reads it', () => {
    expect(queryChips('Q7', false)).toEqual([{ kind: 'text', text: 'Q7', clearTo: '' }])
  })

  it('with a district param already sent the server infers nothing, and neither does the chip', () => {
    expect(queryChips('quận 7', true)).toEqual([{ kind: 'text', text: 'quận 7', clearTo: '' }])
  })

  it('clearing the words keeps the district even when the district needed them (a shorthand)', () => {
    expect(queryChips('căn hộ Q7', false)).toEqual([
      { kind: 'text', text: 'căn hộ', clearTo: 'Quận 7 (Phú Mỹ Hưng)' },
      { kind: 'district', slug: 'd7', clearTo: 'căn hộ' },
    ])
    expect(queryChips('nha be 2pn', false)[0]).toEqual({ kind: 'text', text: '2pn', clearTo: 'Nhà Bè' })
    // Where the phrase stands on its own, the person's own words stay.
    expect(queryChips('căn hộ quận 7', false)[0]).toEqual({ kind: 'text', text: 'căn hộ', clearTo: 'quận 7' })
  })

  it('every district’s own name, in both languages, reads back as that district — the fallback above relies on it', () => {
    for (const d of DISTRICTS.filter((x) => x.slug !== 'all')) {
      expect([d.name, inferDistrictFromQuery(d.name)?.slug]).toEqual([d.name, d.slug])
      expect([d.nameEn, inferDistrictFromQuery(d.nameEn)?.slug]).toEqual([d.nameEn, d.slug])
    }
  })

  it('puts the district back in the visitor’s language', () => {
    expect(queryChips('căn hộ Q7', false, 'en')[0]).toEqual({ kind: 'text', text: 'căn hộ', clearTo: 'District 7 (Phu My Hung)' })
  })

  it('no query, no chip', () => {
    expect(queryChips('   ', false)).toEqual([])
  })
})
