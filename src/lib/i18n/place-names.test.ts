import { describe, expect, it } from 'vitest'
import { PLACE_TERMS, hasPlaceName, placeOnlyTranslation } from './place-names'

describe('place-names — what counts as a place', () => {
  it('knows the HCMC districts, Hanoi districts, provinces and well-known areas, in both spellings', () => {
    for (const s of ['Thủ Đức', 'Thu Duc', 'Bình Thạnh', 'Gò Vấp', 'Go Vap', 'Phú Nhuận', 'Tây Hồ', 'Tay Ho', 'Đà Nẵng', 'Hà Nội', 'Hanoi', 'Thảo Điền', 'Phú Mỹ Hưng', 'Hội An', 'Quận 7', 'District 12', 'Phường 3'])
      expect(hasPlaceName(s), s).toBe(true)
    expect(PLACE_TERMS.length).toBeGreaterThan(100)
  })

  it('⛔ an everyday phrase is not a place unless every syllable is capitalised', () => {
    for (const s of ['tôi yêu hòa bình', 'hòa bình', 'long an toàn', 'cao bằng nhau', 'Hòa bình là', 'a long an hour', 'the hue of the wall', 'Hue of the wall'])
      expect(hasPlaceName(s), s).toBe(false)
    expect(hasPlaceName('Hòa Bình')).toBe(true) // the province
    expect(hasPlaceName('Huế')).toBe(true) // the Vietnamese spelling is unambiguous
  })

  it('unambiguous names match in any case and without marks; ambiguous ones only capitalised', () => {
    for (const s of ['thủ đức', 'THỦ ĐỨC', 'thu duc', 'THU DUC', 'go vap', 'gò vấp', 'binh thanh']) expect(hasPlaceName(s), s).toBe(true)
    for (const s of ['nhà bè nổi', 'cần giờ giấc', 'thanh xuân tươi đẹp']) expect(hasPlaceName(s), s).toBe(false)
    // ⛔ A marked phrase never matches a place by folding: two rooms, multi-purpose, a subject, a white house, a recruit,
    // paving stone, a pile of ice. Nor does the unmarked spelling of a name an everyday phrase shares.
    for (const s of ['hai phòng ngủ', 'bếp đa năng', 'học môn toán', 'nhà trắng', 'tân binh', 'đá lát', 'đống đá', 'hai phong ngu', 'da nang', 'nha trang dep'])
      expect(hasPlaceName(s), s).toBe(false)
    for (const s of ['Dalat', 'Danang']) expect(hasPlaceName(s), s).toBe(true)
    expect(placeOnlyTranslation('thu duc', 'vi')).toBe('Thủ Đức')
  })

  it('⛔ in a Title-Case run, a name that is also an everyday phrase needs an administrative word beside it', () => {
    expect(hasPlaceName('Tôi Yêu Hòa Bình')).toBe(false)
    expect(hasPlaceName('Khóa Long An Toàn')).toBe(false)
    expect(hasPlaceName('Can Ho Hai Phong Ngu')).toBe(false)
    expect(hasPlaceName('Bep Da Nang Inox')).toBe(false)
    expect(hasPlaceName('Đất Tỉnh Long An Giá Rẻ')).toBe(true)
    expect(hasPlaceName('Căn Hộ Hải Phòng')).toBe(true) // the marked spelling is unambiguous
    expect(hasPlaceName('Căn Hộ Thủ Đức Giá Tốt')).toBe(true)
    expect(hasPlaceName('Nhà đẹp ở Hòa Bình')).toBe(true) // after a locative
  })

  it('⛔ "hội an" inside "xã hội an toàn" / "hiệp hội an ninh" is not Hội An; unmarked "bien hoa" is "biến hóa"', () => {
    for (const s of ['Khu dân cư xã hội an toàn', 'hiệp hội an ninh', 'Xã Hội An Toàn', 'bien hoa linh hoat']) expect(hasPlaceName(s), s).toBe(false)
    expect(hasPlaceName('Du lịch Hội An')).toBe(true)
  })

  it('English destination titles and comma-separated addresses are places ("Da Nang Beach", "Hai Phong, Da Nang")', () => {
    expect(hasPlaceName('Da Nang Beach')).toBe(true)
    expect(hasPlaceName('Nha Trang Beach Resort')).toBe(true)
    expect(placeOnlyTranslation('Hai Phong, Da Nang', 'vi')).toBe('Hải Phòng, Đà Nẵng')
  })

  it('numbered districts in any case and as "Q.7"; an admin word settles a mixed-language line', () => {
    expect(placeOnlyTranslation('quận 7', 'en')).toBe('District 7')
    expect(placeOnlyTranslation('phường 3', 'en')).toBe('Ward 3')
    expect(placeOnlyTranslation('Q.7', 'en')).toBe('District 7')
    expect(hasPlaceName('Audi Q7 đẹp')).toBe(false)
    expect(hasPlaceName('Da Nang City, gần biển')).toBe(true)
  })

  it('an English "Ward 3" is not a place (hospital wards); the Vietnamese "Phường 3" is', () => {
    expect(hasPlaceName('Room near Ward 3 of the hospital')).toBe(false)
    expect(placeOnlyTranslation('Phường 3', 'en')).toBe('Ward 3')
  })

  it('numbered districts are left to the engine for languages other than English and Vietnamese', () => {
    expect(placeOnlyTranslation('Quận 7', 'ja')).toBeNull()
    expect(placeOnlyTranslation('Thủ Đức', 'ko')).toBeNull() // the engine writes it in Korean script
    // An unmarked name with two readings ("Thanh Hoa" may be a woman) is not given marks; one-reading names are.
    expect(placeOnlyTranslation('Thanh Hoa', 'vi')).toBeNull()
    expect(placeOnlyTranslation('Thanh Hoa', 'en')).toBe('Thanh Hoa')
    expect(placeOnlyTranslation('District 7, Thu Duc', 'vi')).toBe('Quận 7, Thủ Đức')
  })

  it('⛔ in marked Vietnamese text an unmarked spelling is a person, not the province ("anh Quang Nam")', () => {
    expect(hasPlaceName('Liên hệ anh Quang Nam nhé')).toBe(false)
    expect(hasPlaceName('Liên hệ chị Thanh Hoa')).toBe(false)
    expect(hasPlaceName('Đất ở Quảng Nam')).toBe(true)
    expect(hasPlaceName('Căn hộ đẹp Thu Duc')).toBe(true) // FOLD_SAFE names are taken unmarked even there
    expect(hasPlaceName('Apartment in Quang Nam')).toBe(true) // English text
    expect(hasPlaceName('Apartment in Da Nang, café nearby')).toBe(true) // "café" is not Vietnamese
  })

  it('reads context from a short window only (no quadratic scan of a long prefix)', () => {
    const long = 'a'.repeat(200_000) + '! Hòa Bình'
    const t0 = Date.now()
    hasPlaceName(long)
    expect(Date.now() - t0).toBeLessThan(2000)
  })

  it('⛔ "Hòa Bình" (peace) at a sentence start is a word; after a locative or an admin word it is the province', () => {
    expect(hasPlaceName('Hòa Bình cho mọi người')).toBe(false)
    expect(hasPlaceName('Nhà đẹp ở Hòa Bình')).toBe(true)
    expect(hasPlaceName('Tỉnh Hòa Bình')).toBe(true)
  })

  it('a template placeholder is never a place ("{Hanoi}" stays an identifier)', () => {
    expect(placeOnlyTranslation('{Hanoi}', 'vi')).toBeNull()
  })

  it('many exclusions stay cheap', () => {
    const t = 'Thái Bình Dương '.repeat(5000) + 'Thủ Đức '.repeat(5000)
    const t0 = Date.now()
    hasPlaceName(t)
    expect(Date.now() - t0).toBeLessThan(3000)
  })

  it('a person is not a place ("chị Thanh Xuân", "anh Bình Dương"); a locative settles a mixed line ("ở Da Nang"); "Hanoi Beer" stays', () => {
    expect(hasPlaceName('Liên hệ chị Thanh Xuân')).toBe(false)
    expect(hasPlaceName('Gặp anh Bình Dương nhé')).toBe(false)
    expect(hasPlaceName('Căn hộ ở Da Nang')).toBe(true)
  })

  it('a hyphenated province ("Bà Rịa - Vũng Tàu") is a place too', () => {
    expect(placeOnlyTranslation('Bà Rịa - Vũng Tàu', 'en')).toBe('Ba Ria - Vung Tau')
  })

  it('⛔ "Thái Bình Dương" is the Pacific Ocean, not the province; brand "Saigon" is never turned into Vietnamese', () => {
    expect(hasPlaceName('Bảo hiểm Thái Bình Dương')).toBe(false)
    expect(placeOnlyTranslation('Sài Gòn', 'en')).toBe('Saigon')
  })

  it('a name inside a longer word is not a place ("Quận 1" is not in "Quận 12")', () => {
    expect(placeOnlyTranslation('Quận 12', 'en')).toBe('District 12')
    expect(hasPlaceName('ThủĐứcX')).toBe(false)
  })

  it('both tone-mark placements match ("Khánh Hòa" / "Khánh Hoà") and decomposed (NFD) text too', () => {
    expect(hasPlaceName('Khánh Hòa')).toBe(true)
    expect(hasPlaceName('Khánh Hoà')).toBe(true)
    expect(placeOnlyTranslation('Thủ Đức'.normalize('NFD'), 'en')).toBe('Thu Duc')
  })
})

describe('place-names — spelling for the reader', () => {
  it('place-only text: unaccented for every language but Vietnamese, with the administrative word', () => {
    expect(placeOnlyTranslation('Thủ Đức', 'en')).toBe('Thu Duc')
    expect(placeOnlyTranslation('Thu Duc', 'vi')).toBe('Thủ Đức')
    expect(placeOnlyTranslation('Gò Vấp, TP. Hồ Chí Minh', 'en')).toBe('Go Vap, Ho Chi Minh City')
    expect(placeOnlyTranslation('Binh Thanh District, Ho Chi Minh City', 'vi')).toBe('Bình Thạnh, TP. Hồ Chí Minh')
    expect(placeOnlyTranslation('Huyện Nhà Bè', 'en')).toBe('Nha Be District')
    expect(placeOnlyTranslation('Quận 7 - Phú Mỹ Hưng', 'en')).toBe('District 7 - Phu My Hung')
  })

  it('anything beyond place names is not place-only', () => {
    expect(placeOnlyTranslation('Căn hộ Thủ Đức', 'en')).toBeNull()
    expect(placeOnlyTranslation('Vinhomes Grand Park, Thủ Đức', 'en')).toBeNull()
    expect(placeOnlyTranslation('Phòng 12', 'en')).toBeNull()
  })

  it('⛔ a name that is also an everyday phrase is place-only only with an admin word or beside another place', () => {
    expect(placeOnlyTranslation('Cần Giờ?', 'en')).toBeNull() // "need time?"
    expect(placeOnlyTranslation('Hòa Bình', 'en')).toBeNull() // peace
    expect(placeOnlyTranslation('Huyện Cần Giờ', 'en')).toBe('Can Gio District')
    expect(placeOnlyTranslation('Nhà Bè, TP.HCM', 'en')).toBe('Nha Be, HCM City')
    expect(placeOnlyTranslation('Hòa Bình, Long An', 'en')).toBe('Hoa Binh, Long An') // two places: an address
    expect(placeOnlyTranslation('Da Nang', 'vi')).toBeNull() // may be "đa năng" (multi-purpose)
    expect(placeOnlyTranslation('Đà Nẵng', 'en')).toBe('Da Nang')
    expect(placeOnlyTranslation('Da Nang, Hoi An', 'vi')).toBe('Đà Nẵng, Hội An')
    expect(placeOnlyTranslation('District 9', 'vi')).toBeNull() // a film as often as a district
    expect(placeOnlyTranslation('District 9 / District 13', 'vi')).toBeNull() // two films
    expect(placeOnlyTranslation('Ha Noi', 'en')).toBe('Ha Noi') // an English reader's own spelling stays
    expect(placeOnlyTranslation('HCMC', 'en')).toBe('HCMC')
    expect(placeOnlyTranslation('Hà Nội', 'en')).toBe('Hanoi')
    expect(placeOnlyTranslation('District 7, Thu Duc', 'vi')).toBe('Quận 7, Thủ Đức')
  })

  it('a long text is never place-only (and is not scanned)', () => {
    expect(placeOnlyTranslation(`${'Thủ Đức, '.repeat(20)}Thủ Đức`, 'en')).toBeNull()
  })
})
