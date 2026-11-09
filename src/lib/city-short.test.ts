import { describe, expect, it } from 'vitest'
import { adminPlaceEn, bracketNamedIn, cardArea, cardAreaEn, isHcmc, placeNamedIn } from './city-short'

describe('isHcmc', () => {
  /** The value 9,726 of 9,773 live listings carry, in the exact form the database stores. */
  it('matches the stored form', () => {
    expect(isHcmc('Hồ Chí Minh')).toBe(true)
  })

  /**
   * ⚠️ DECOMPOSED VIETNAMESE MUST MATCH. "ồ" written as o + combining circumflex + combining grave
   * is three code points and is NOT equal to the composed character — a comparison that looks
   * correct and silently never fires. This test is the reason `fold()` normalises.
   */
  it('matches the decomposed spelling of the same name', () => {
    const decomposed = 'Hồ Chí Minh'.normalize('NFD')
    expect(decomposed).not.toBe('Hồ Chí Minh')       // the input really is different bytes
    expect(isHcmc(decomposed)).toBe(true)
  })

  it.each([
    'Ho Chi Minh',
    'Ho Chi Minh City',
    'ho chi minh city',
    'Thành phố Hồ Chí Minh',
    'Thanh pho Ho Chi Minh',
    '  Hồ Chí Minh  ',
    'TP. Hồ Chí Minh',
    'TP.Hồ Chí Minh',
    'TP Ho Chi Minh',
  ])('matches %s', (v) => expect(isHcmc(v)).toBe(true))

  /**
   * ⛔ A DISTRICT INSIDE THE CITY IS NOT THE CITY. "Thu Duc, Ho Chi Minh City" is a real value in
   * the catalogue, and its useful half is the district — shortening the whole label to "HCM" would
   * delete the more specific fact. This is why the pattern is anchored rather than a substring test.
   */
  it('does not match a district-qualified label', () => {
    expect(isHcmc('Thu Duc, Ho Chi Minh City')).toBe(false)
    expect(isHcmc('Bình Thạnh')).toBe(false)
  })

  it.each(['Hà Nội', 'Ha Tinh', 'Nha Trang, Khanh Hoa', 'Đà Nẵng', 'Phu Quoc, Kien Giang'])(
    'leaves %s alone', (v) => expect(isHcmc(v)).toBe(false))

  it('handles absent values without throwing', () => {
    expect(isHcmc(null)).toBe(false)
    expect(isHcmc(undefined)).toBe(false)
    expect(isHcmc('')).toBe(false)
  })
})

describe('cardArea', () => {
  it('drops the bracketed ward and the trailing city, in the shapes the database and the translator produce', () => {
    expect(cardArea('Quận 12 (Phường An Phú Đông)')).toBe('Quận 12')
    expect(cardArea('Huyện Bình Chánh (Xã Bình Chánh)')).toBe('Huyện Bình Chánh')
    expect(cardArea('District 12 (An Phu Dong Ward)')).toBe('District 12')
    expect(cardArea('District 1, Ho Chi Minh City')).toBe('District 1')
  })
  it('keeps every other city: only HCMC is implied', () => {
    expect(cardArea('Hoàn Kiếm, Hà Nội')).toBe('Hoàn Kiếm, Hà Nội')
    expect(cardArea('Lê Chân')).toBe('Lê Chân')
  })
  it('keeps a bracket that is not a ward: it may be the only place naming the district', () => {
    expect(cardArea('Hoàn Kiếm (near the station), Hà Nội')).toBe('Hoàn Kiếm (near the station), Hà Nội')
    expect(cardArea('Phường 22 (Bình Thạnh), Hồ Chí Minh')).toBe('Phường 22 (Bình Thạnh)')
    expect(cardArea('Phường 22 (Ward 22, Bình Thạnh), Hồ Chí Minh')).toBe('Phường 22 (Ward 22, Bình Thạnh)')
  })
  it('never empties a location that is only the city or only a ward', () => {
    expect(cardArea('Hồ Chí Minh')).toBe('Hồ Chí Minh')
    expect(cardArea('(Phường 22)')).toBe('(Phường 22)')
  })
  it('parses on Safari before 16.4: no lookbehind in the module that every card imports', async () => {
    const { readFileSync } = await import('node:fs')
    expect(readFileSync(new URL('./city-short.ts', import.meta.url), 'utf8')).not.toMatch(/\(\?<[!=]/)
  })
})

describe('cardAreaEn', () => {
  it('prints the spelling the English chips use', () => {
    expect(cardAreaEn('Quận 12')).toBe('District 12')
    expect(cardAreaEn('Quận Bình Thạnh')).toBe('Binh Thanh District')
    expect(cardAreaEn('Huyện Bình Chánh')).toBe('Binh Chanh District')
    expect(cardAreaEn('TP. Thủ Đức')).toBe('Thu Duc City')
    expect(cardAreaEn('Tân Hưng')).toBe('Tan Hung')
    expect(cardAreaEn('Hoàn Kiếm, Hà Nội')).toBe('Hoan Kiem, Ha Noi')
  })
  it('labels each administrative level on its own', () => {
    expect(cardAreaEn('Quận Hoàn Kiếm, Hà Nội')).toBe('Hoan Kiem District, Ha Noi')
    expect(cardAreaEn('Phường Bến Nghé, Quận 1')).toBe('Ben Nghe Ward, District 1')
    expect(cardAreaEn('Phường 5')).toBe('Ward 5')
    expect(cardAreaEn('TP.Thủ Đức')).toBe('Thu Duc City')
  })
})

describe('adminPlaceEn — a place name is never machine-translated (best-practice gap 2026-11-10)', () => {
  it.each([
    ['Huyện Nhà Bè (Xã Nhà Bè)', 'Nha Be District (Nha Be Commune)'], // was "The House of Bee" on every English Nha Be rental
    ['Quận 7 (Phường Tân Phong)', 'District 7 (Tan Phong Ward)'],
    ['Quận Bình Thạnh', 'Binh Thanh District'],
    ['Thành phố Thủ Đức', 'Thu Duc City'],
    ['TP. Hồ Chí Minh', 'Ho Chi Minh City'],
    ['Tỉnh Đồng Nai', 'Dong Nai Province'],
    ['Thị xã Bến Cát', 'Ben Cat Town'],
    ['TP.HCM', 'HCM City'],
    ['TP. Thủ Đức (Phường An Khánh)', 'Thu Duc City (An Khanh Ward)'], // as the live sample stores it
    ['Quận Bình Thạnh, TP. Hồ Chí Minh', 'Binh Thanh District, Ho Chi Minh City'],
  ])('%s → %s', (vi, en) => {
    expect(adminPlaceEn(vi)).toBe(en)
  })
  it.each([
    ['Vinhomes Central Park'], ['Thảo Điền'], ['Quận 7, Sunrise City'], ['Sunrise City (Quận 7)'], ['Quận'], [''], [null], [undefined],
    // A seller's words that merely START with a level (review, 2026-11-10): never spelled as a place.
    ['Quận 7 Phú Mỹ Hưng'], ['Quận 1 gần chợ Bến Thành'], ['Quận 7 - Sunrise City'], ['TPBank Tower'], ['Tỉnh lộ 10'], ['quận bình thạnh gần sông'],
    ['Quận Bình Thạnh Gần Sông'], ['Tỉnh lộ 10, Bình Chánh'],
    // A lone ward-level name may be a street ("Xã Đàn", Hanoi); "TP" without its dot may be a building (review).
    ['Xã Đàn'], ['Phường Thảo Điền'], ['TP Tower'], ['TP Hồ Chí Minh'],
    // …nor as a top-level part of a list (review): only in the importers' brackets.
    ['Xã Đàn, Quận Đống Đa'], ['Phường Bến Nghé, Quận 1'],
  ])('%s is not wholly administrative → null (keeps its translation)', (text) => {
    expect(adminPlaceEn(text as string | null | undefined)).toBeNull()
  })
  it('bracketNamedIn: the ward bracket comes off the listing page only where the title already names it', () => {
    expect(bracketNamedIn('Huyện Nhà Bè (Xã Nhà Bè)', ['Studio · Nha Be Commune, Nha Be District'])).toBe(true)
    expect(bracketNamedIn('Quận 7 (Phường Tân Phong)', ['Phòng trọ Phường Tân Phong, Quận 7'])).toBe(true)
    expect(bracketNamedIn('Quận 7 (Phường Tân Phong)', ['Studio for rent', null])).toBe(false)
    expect(bracketNamedIn('Quận 7', ['District 7'])).toBe(false) // no bracket, nothing to drop
    expect(bracketNamedIn('Quận 3 (Phường 1)', ['Studio in Phường 12'])).toBe(false) // whole words only (review)
    expect(bracketNamedIn('Quận 3 (Phường 1)', ['Studio in Phường 1, Quận 3'])).toBe(true)
  })
  it('placeNamedIn: whole words, accent- and case-blind', () => {
    expect(placeNamedIn('123 Nguyễn Thị Thập, Quận 7 TP.HCM', 'Quận 7')).toBe(true)
    expect(placeNamedIn('quan 7 phu my hung', 'Quận 7')).toBe(true)
    expect(placeNamedIn('Quận 12', 'Quận 1')).toBe(false)
    expect(placeNamedIn('Studio in Phường 12', 'Phường 1')).toBe(false)
  })
  it('English cards keep their own spelling: a road named "Tỉnh lộ" is not a province (review)', () => {
    expect(cardAreaEn('Tỉnh lộ 10, Bình Chánh')).toBe('Tinh lo 10, Binh Chanh')
  })
})
