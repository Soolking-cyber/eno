import { describe, expect, it } from 'vitest'
import { hasPlainTextFallback, inferDistrictFromQuery, narrows, queryChips } from './district-query'
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

  /**
   * Since abfca169 Quận 2 and Quận 9 have their own entries, narrowers inside the Thủ Đức umbrella
   * (which still matches their old names). The person asked for Quận 2, so the narrowest entry answers.
   */
  it('maps Quận 2 and Quận 9 to their own entries, not the Thủ Đức umbrella that also spells them', () => {
    expect(slug('Quận 2')).toBe('d2')
    expect(slug('phòng trọ q9')).toBe('d9')
    expect(slug('TP Thủ Đức')).toBe('thu-duc')
  })

  it('reads a narrower named beside its umbrella — d2’s own name, "Quận 2 (Thủ Đức)" — as the narrower', () => {
    expect(inferDistrictFromQuery('Quận 2 (Thủ Đức)')).toEqual({ slug: 'd2', phrase: 'Quận 2', rest: '' })
    expect(inferDistrictFromQuery('thủ đức quận 9')).toEqual({ slug: 'd9', phrase: 'quận 9', rest: '' })
    expect(slug('quận 1 thủ đức')).toBeNull() // not nested: two places
  })

  it('an address naming a narrower and its umbrella is the narrower', () => {
    expect(inferDistrictFromQuery('căn hộ Quận 2, Thủ Đức')).toEqual({ slug: 'd2', phrase: 'Quận 2', rest: 'căn hộ' })
  })

  /**
   * ⛔ THE INVARIANT "NARROWER" RESTS ON (opus, codex): two entries that share a spelling must be
   * nested — one's spellings a subset of the other's. Add a spelling to d2 that thu-duc lacks and
   * "Quận 2 (Thủ Đức)" silently stops resolving; this fails first.
   */
  it('every pair of DISTRICTS entries that share a spelling — compared FOLDED, as queries are read — is nested', () => {
    const fold = (m: string) => m.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase()
    for (const a of DISTRICTS) for (const b of DISTRICTS) {
      if (a.slug >= b.slug || !a.match || !b.match) continue
      if (!a.match.some((m) => b.match!.some((n) => fold(n) === fold(m)))) continue
      expect([a.slug, b.slug, narrows(a.slug, b.slug) || narrows(b.slug, a.slug)]).toEqual([a.slug, b.slug, true])
    }
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

  it('"2pn quận 2" → the Quận 2 scope with "2pn" left as text', () => {
    expect(inferDistrictFromQuery('2pn quận 2')).toEqual({ slug: 'd2', phrase: 'quận 2', rest: '2pn' })
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

  it('two phrases for one place are both removed', () => {
    expect(inferDistrictFromQuery('quận 2 thủ đức')).toEqual({ slug: 'd2', phrase: 'quận 2', rest: '' })
    expect(inferDistrictFromQuery('thủ đức tp thủ đức')).toEqual({ slug: 'thu-duc', phrase: 'thủ đức', rest: '' })
  })
})

describe('queryChips — what the explorer shows for a typed query', () => {
  /** What the server answered (`inferredDistrict`) — the chips follow it, never a local re-parse. */
  const server = (q: string) => inferDistrictFromQuery(q)?.slug ?? null

  it('a plain query is one text chip that clears to nothing', () => {
    expect(queryChips('iphone 7', null)).toEqual([{ kind: 'text', text: 'iphone 7', clearTo: '' }])
  })

  it('"căn hộ quận 7" is two chips, each clearing only itself', () => {
    expect(queryChips('căn hộ quận 7', 'd7')).toEqual([
      { kind: 'text', text: 'căn hộ', clearTo: 'quận 7' },
      { kind: 'district', slug: 'd7', clearTo: 'căn hộ' },
    ])
  })

  it('a bare district is one district chip that clears the box', () => {
    expect(queryChips('Quận 7', 'd7')).toEqual([{ kind: 'district', slug: 'd7', clearTo: '' }])
  })

  it('a bare shorthand is a text chip, as the server reads it', () => {
    expect(queryChips('Q7', server('Q7'))).toEqual([{ kind: 'text', text: 'Q7', clearTo: '' }])
  })

  /**
   * ⛔ THE CHIP FOLLOWS THE SERVER (verifier, 2026-09-24). The feed drops a district reading that
   * finds nothing while the plain words find something ("Hồi ức Phú Nhuận", a book: 46 → 0 as Phú
   * Nhuận), and an explicit district param wins over a typed one. In both cases the server answers
   * `inferredDistrict: null`, and a chip re-derived in the browser would name a district the grid is
   * not in. So a null answer is ONE text chip, whatever the parser would have read.
   */
  it('names no district when the server applied none — the words parse as one, the answer is what counts', () => {
    expect(inferDistrictFromQuery('Hồi ức Phú Nhuận')?.slug).toBe('phu-nhuan')
    expect(queryChips('Hồi ức Phú Nhuận', null)).toEqual([{ kind: 'text', text: 'Hồi ức Phú Nhuận', clearTo: '' }])
    expect(queryChips('quận 7', null)).toEqual([{ kind: 'text', text: 'quận 7', clearTo: '' }])
  })

  it('a district the server read but this parser does not still gets its chip, clearing the words that produced it', () => {
    expect(queryChips('something new', 'd3')).toEqual([
      { kind: 'text', text: 'something new', clearTo: '' },
      { kind: 'district', slug: 'd3', clearTo: '' },
    ])
  })

  it('clearing the words keeps the district even when the district needed them (a shorthand)', () => {
    expect(queryChips('căn hộ Q7', 'd7')).toEqual([
      { kind: 'text', text: 'căn hộ', clearTo: 'Quận 7 (Phú Mỹ Hưng)' },
      { kind: 'district', slug: 'd7', clearTo: 'căn hộ' },
    ])
    expect(queryChips('nha be 2pn', 'nha-be')[0]).toEqual({ kind: 'text', text: '2pn', clearTo: 'Nhà Bè' })
    // Where the phrase stands on its own, the person's own words stay.
    expect(queryChips('căn hộ quận 7', 'd7')[0]).toEqual({ kind: 'text', text: 'căn hộ', clearTo: 'quận 7' })
  })

  it('every district’s own name, in both languages, reads back as that district — the fallback above relies on it', () => {
    for (const d of DISTRICTS.filter((x) => x.slug !== 'all')) {
      expect([d.name, inferDistrictFromQuery(d.name)?.slug]).toEqual([d.name, d.slug])
      expect([d.nameEn, inferDistrictFromQuery(d.nameEn)?.slug]).toEqual([d.nameEn, d.slug])
    }
  })

  it('puts the district back in the visitor’s language', () => {
    expect(queryChips('căn hộ Q7', 'd7', 'en')[0]).toEqual({ kind: 'text', text: 'căn hộ', clearTo: 'District 7 (Phu My Hung)' })
  })

  it('no query, no chip', () => {
    expect(queryChips('   ', 'd7')).toEqual([])
  })
})

/**
 * ⛔ "Q." IS HOW AN ADDRESS WRITES QUẬN (verifier, 2026-09-24). In Rentals "Q.7" and "q.2" returned 0,
 * and "Q. 7" returned 5,611 rentals in Bình Thạnh, Tân Bình and Phú Nhuận and none in Quận 7 — the
 * text filter matched the token `q.` against "Q. Bình Thạnh". No live product is named Q-dot-number,
 * so the dot is evidence on its own; the bare "Q7"/"D7" still needs a place word.
 */
describe('inferDistrictFromQuery — the "Q." address form', () => {
  it.each([['Q.7', 'd7'], ['Q. 7', 'd7'], ['q.2', 'd2'], ['Q.10', 'd10'], ['q . 1', 'd1']])('reads %j alone as %s', (q, s) => {
    expect(slug(q)).toBe(s)
  })

  it('reads "Q.Bình Thạnh" and "Q. Gò Vấp" as the named district', () => {
    expect(slug('Q.Bình Thạnh')).toBe('binh-thanh')
    expect(slug('Q. Gò Vấp')).toBe('go-vap')
  })

  it('removes the whole address form from the words', () => {
    expect(inferDistrictFromQuery('Q.7')).toEqual({ slug: 'd7', phrase: 'Q.7', rest: '' })
    expect(inferDistrictFromQuery('nhà nguyên căn Q. 7')?.rest).toBe('nhà nguyên căn')
  })

  it('keeps the bare shorthand a product search — 129 live electronics listings carry one', () => {
    for (const q of ['Q7', 'D7', 'q2', 'Q 7', 'D.7']) expect(slug(q)).toBeNull()
  })

  it('still refuses a quantity after the dot form', () => {
    expect(slug('q.7.5')).toBeNull()
    expect(slug('Q.7 tuổi')).toBeNull()
  })
})

/**
 * ⛔ PRODUCT WORDS BUILT FROM A PLACE SYLLABLE ARE NOT HOUSING CONTEXT (verifier, 2026-09-24). Each of
 * these read the shorthand as a district and returned 0 where the plain words found the product:
 * "pin sạc dự phòng Q3" 1 → 0, "lau nhà Q2" 2 → 0, "dây đồng hồ nâu đất D1" 1 → 0,
 * "tivi samsung Q7 phòng khách" 1 → 0.
 */
describe('inferDistrictFromQuery — compounds that are not a place', () => {
  it.each([
    'pin sạc dự phòng Q3', 'lau nhà Q2', 'dây đồng hồ nâu đất D1', 'tivi samsung Q7 phòng khách',
    'pin sac du phong q3', 'cay lau nha q2', 'đèn phòng ngủ Q7', 'ghế văn phòng D7', 'văn phòng phẩm Q1',
  ])('%j stays a product search', (q) => {
    expect(inferDistrictFromQuery(q)).toBeNull()
  })

  it('a compound is masked only when the typed accents are its own — "nhà sạch" (a clean house) is a place', () => {
    expect(slug('nhà sách Q7')).toBeNull() // a bookshop
    expect(slug('nhà sạch Q7')).toBe('d7')
  })

  it('the same words beside a real place word still read the district', () => {
    expect(slug('căn hộ Q7 phòng khách rộng')).toBe('d7')
    expect(slug('2 phòng ngủ Q7')).toBe('d7') // a room COUNT is a place
    expect(slug('văn phòng Q1')).toBe('d1')
    expect(slug('nhà Q2')).toBe('d2')
    expect(slug('phòng q7')).toBe('d7')
  })
})

describe('inferDistrictFromQuery — a person’s name is not a district', () => {
  it('a surname before a bare district name makes it a name ("Nguyễn Tân Bình", an author)', () => {
    expect(slug('Nguyễn Tân Bình')).toBeNull()
    expect(slug('sách Nguyễn Tân Bình')).toBeNull()
    expect(slug('nguyen tan binh')).toBeNull()
  })

  it('an ordinary word that folds to a surname does not', () => {
    expect(slug('căn hộ Bình Thạnh')).toBe('binh-thanh') // "hộ" is not "Hồ"
    expect(slug('can ho binh thanh')).toBe('binh-thanh')
    expect(slug('đường Phú Nhuận')).toBe('phu-nhuan') // "đường" is not "Dương"
    expect(slug('duong phu nhuan')).toBe('phu-nhuan') // a surname that is also a word needs its accents
  })

  it('a prefix still says it is the place', () => {
    expect(slug('Nguyễn quận Tân Bình')).toBe('tan-binh')
  })
})

describe('inferDistrictFromQuery — the preposition before a district is checked for its accents', () => {
  it('"ô" is not "ở" — "Cờ ô quan 6" keeps its words', () => {
    expect(inferDistrictFromQuery('Cờ ô quan 6')).toEqual({ slug: 'd6', phrase: 'quan 6', rest: 'Cờ ô' })
  })

  it('"ở" and a bare "o" still go with the district', () => {
    expect(inferDistrictFromQuery('căn hộ ở quận 7')?.rest).toBe('căn hộ')
    expect(inferDistrictFromQuery('can ho o quan 7')?.rest).toBe('can ho')
    expect(inferDistrictFromQuery('phòng tại quận 3')?.rest).toBe('phòng')
  })
})

describe('hasPlainTextFallback — when the feed may serve the plain words instead', () => {
  it('yes when words that are not about a place are left beside the district', () => {
    expect(hasPlainTextFallback(inferDistrictFromQuery('Hồi ức Phú Nhuận')!)).toBe(true)
    expect(hasPlainTextFallback(inferDistrictFromQuery('iphone quận 7')!)).toBe(true)
  })

  /** "penthouse quận 7" with no penthouse in Quận 7 is an honest zero; its plain words are every district's penthouses. */
  it('no when the other words are about somewhere to live — the district reading is the right one', () => {
    expect(hasPlainTextFallback(inferDistrictFromQuery('căn hộ quận 7')!)).toBe(false)
    expect(hasPlainTextFallback(inferDistrictFromQuery('phòng trọ Phú Nhuận')!)).toBe(false)
    expect(hasPlainTextFallback(inferDistrictFromQuery('penthouse quận 7')!)).toBe(false)
  })

  it('yes for a district NAME alone — "Phú Nhuận" as plain words is still a search', () => {
    expect(hasPlainTextFallback(inferDistrictFromQuery('Phú Nhuận')!)).toBe(true)
  })

  it('no for a numbered district alone — its plain words are the `quan` token that matched everything', () => {
    expect(hasPlainTextFallback(inferDistrictFromQuery('Quận 7')!)).toBe(false)
    expect(hasPlainTextFallback(inferDistrictFromQuery('District 1')!)).toBe(false)
    expect(hasPlainTextFallback(inferDistrictFromQuery('Q.7')!)).toBe(false)
  })
})
