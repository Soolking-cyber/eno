import { describe, expect, it } from 'vitest'
import { clip, fillDescription, firstThatFits, shopTitle, titleWithPrice, titleWithSite, fitsTitle, fitsDescription, sentenceDescription } from './meta-description'

describe('fillDescription (Bing 2026-11-20: descriptions too short)', () => {
  it('adds the facts in order, only until the text is long enough', () => {
    const d = fillDescription('iPhone 17 Pro Max 512GB - Used, with scratches and dents.', [
      '35,000,000 đ, Electronics, District 7.',
      'Free classifieds for expats and locals in Vietnam.',
      'never reached',
    ])
    expect(d).toBe('iPhone 17 Pro Max 512GB - Used, with scratches and dents. 35,000,000 đ, Electronics, District 7. Free classifieds for expats and locals in Vietnam.')
    expect(d.length).toBeGreaterThanOrEqual(120)
    expect(d.length).toBeLessThanOrEqual(155)
  })
  it('leaves a long enough lead alone and skips empty extras', () => {
    const lead = 'x'.repeat(130)
    expect(fillDescription(lead, ['more'])).toBe(lead)
    expect(fillDescription('Short', ['', null, undefined, false, 'Fact'])).toBe('Short. Fact')
  })
  it('skips an extra that would pass 155 whole, and tries the next (Seobility 2026-11-23: 160 measured over 1000 px)', () => {
    expect(fillDescription('x'.repeat(100), ['y'.repeat(55), 'Short fact.'])).toBe(`${'x'.repeat(100)}. Short fact.`)
    expect(fillDescription('A lead', ['word '.repeat(60).trim(), 'Short fact.'])).toBe('A lead. Short fact.')
  })
  it('cuts only a lead that is itself too long, at a word', () => {
    const d = fillDescription('word '.repeat(60).trim(), ['never'])
    expect(d.length).toBeLessThanOrEqual(155)
    expect(d.endsWith('word…')).toBe(true)
  })
})

describe('clip', () => {
  it('keeps short text as it is and closes a cut with an ellipsis, no dangling separator', () => {
    expect(clip('short')).toBe('short')
    expect(clip(`${'a'.repeat(100)} · ${'b'.repeat(80)}`, 110)).toBe(`${'a'.repeat(100)}…`)
  })
})

describe('titleWithSite (Bing 2026-11-20: title too long)', () => {
  it('keeps the site name while the whole fits in 70 characters', () => {
    expect(titleWithSite('eSIM in Vietnam', 'eno.vn')).toBe('eSIM in Vietnam | eno.vn')
  })
  it('drops it when it would not fit, and cuts a title that is itself too long', () => {
    // 70 characters fits the character limit but not the result's 570 px (serp-width.ts), so it is cut at a word.
    const t = 'Cheap 5G phones in Vietnam — coverage, bands and the specs that matter'
    const out = titleWithSite(t, 'eno.vn')
    expect(out.startsWith('Cheap 5G phones in Vietnam')).toBe(true)
    expect(fitsTitle(out, 70)).toBe(true)
    expect(titleWithSite('Cheap 5G phones in Vietnam', 'eno.vn')).toBe('Cheap 5G phones in Vietnam | eno.vn')
    expect(titleWithSite('word '.repeat(20).trim(), 'eno.vn').length).toBeLessThanOrEqual(70)
  })
})

describe('titleWithPrice (Seobility 2026-11-23: listing titles 953–1045 px against ~580)', () => {
  it('keeps the whole "<title> — <price> | <site>" while it fits in 60', () => {
    expect(titleWithPrice('Honda Vision 2022', '18,000,000 đ', 'eno.vn')).toBe('Honda Vision 2022 — 18,000,000 đ | eno.vn')
    expect(titleWithPrice('Studio in Thao Dien', '', 'eno.vn')).toBe('Studio in Thao Dien | eno.vn')
  })
  it('drops the site first, then cuts the title at a word, never the price', () => {
    expect(titleWithPrice('Studio apartment in Thao Dien, District 2', '9,000,000 đ', 'eno.vn')).toBe('Studio apartment in Thao Dien, District 2 — 9,000,000 đ')
    expect(titleWithPrice('2-bedroom apartment with a river view, District 2', '25,000,000 đ', 'eno.vn')).toBe('2-bedroom apartment with a river view… — 25,000,000 đ')
    const long = titleWithPrice('Robusta clean 25% black & broken - Robusta coffee 25% black & broken. 10 packs', '1,250,000 đ', 'eno.vn')
    expect(long.length).toBeLessThanOrEqual(60)
    expect(long.endsWith('… — 1,250,000 đ')).toBe(true)
    expect(long.startsWith('Robusta clean 25% black')).toBe(true)
  })
})

describe('shopTitle (Seobility 2026-11-23: "ShopDunk | eno.vn" too short to say what the page is)', () => {
  it('names the page in the variant\'s language', () => {
    expect(shopTitle('ShopDunk', 'eno.vn', 'en')).toBe('ShopDunk — listings on eno.vn')
    expect(shopTitle('ShopDunk', 'eno.vn', 'vi')).toBe('ShopDunk — tin đăng trên eno.vn')
  })
  it('falls back to "<name> | <site>" (or the name cut) when the phrase does not fit', () => {
    expect(shopTitle('Saigon Scooter Centre Motorbike Rentals D1', 'eno.vn', 'en')).toBe('Saigon Scooter Centre Motorbike Rentals D1 | eno.vn')
    // 40 capitals are ~530 px on their own: past the result's width with any suffix, so the name is cut (serp-width.ts).
    expect(fitsTitle(shopTitle('A'.repeat(40), 'eno.vn', 'en'))).toBe(true)
    expect(shopTitle('word '.repeat(20).trim(), 'eno.vn', 'en').length).toBeLessThanOrEqual(60)
  })
})

describe('firstThatFits (Seobility 2026-11-23: a district title at 621 px)', () => {
  it('takes the longest form within 60, else the shortest', () => {
    const forms = ['Apartments & Houses for Rent in Binh Thanh District, HCMC | eno.vn', 'Apartments & Houses for Rent in Binh Thanh District, HCMC', 'Apartments & Houses for Rent in Binh Thanh District']
    expect(firstThatFits(forms)).toBe('Apartments & Houses for Rent in Binh Thanh District, HCMC')
    expect(firstThatFits(['Rentals in District 1, HCMC | eno.vn', 'x'])).toBe('Rentals in District 1, HCMC | eno.vn')
    expect(firstThatFits(['a'.repeat(70), 'b'.repeat(65)])).toBe('b'.repeat(65))
  })
})

describe('sentenceDescription (Seobility crawl 4, 2026-11-25: 29 guide descriptions past 1,000 px)', () => {
  it('a description that fits is untouched', () => {
    expect(sentenceDescription('Short and whole.')).toBe('Short and whole.')
  })
  it('keeps the longest run of whole sentences that fits and reaches 120 characters', () => {
    const two = 'Hourly and monthly pay by employer type in Ho Chi Minh City, Hanoi and Da Nang, mostly from this year’s job ads and school offers. Take-home pay is worked out under the new tax rules.'
    expect(fitsDescription(two)).toBe(false)
    expect(sentenceDescription(two)).toBe('Hourly and monthly pay by employer type in Ho Chi Minh City, Hanoi and Da Nang, mostly from this year’s job ads and school offers.')
  })
  it('⛔ a first sentence under 120 characters never replaces the word cut (gate review: 72 characters for ~150)', () => {
    const s = 'What a rental deposit in Vietnam covers and where the money sits while you live there. How to get every đồng of it back when you leave, and what a landlord may keep.'
    const out = sentenceDescription(s)
    expect(out.length).toBeGreaterThan(130)
    expect(out.endsWith('…')).toBe(true)
    expect(fitsDescription(out)).toBe(true)
  })
  it('"TP.HCM", "2.5", "TP. Hồ Chí Minh", "Q. 1" and "e.g. this" are not sentence ends', () => {
    const s = 'Giáo viên IELTS tại TP. Hồ Chí Minh dạy ở Q. 1 và Q. 7, giá từ 2.5 triệu một tháng tại TP.HCM, xem hồ sơ và lịch rảnh của từng người trước khi nhắn tin. Cách liên hệ.'
    const out = sentenceDescription(s)
    expect(out).not.toMatch(/(TP|Q)\.$/)
    expect(fitsDescription(out)).toBe(true)
    const eg = 'Shops quote by the day or month, e.g. this one rents a scooter for a week at the monthly rate when you ask before booking with them. A second sentence that pushes it past the limit.'
    expect(sentenceDescription(eg)).not.toBe('Shops quote by the day or month, e.g.')
  })
  it('one long sentence: cut at a word like clipDescription', () => {
    const long = 'Motorbikes and scooters for rent in Ho Chi Minh City from local rental shops with automatic or manual bikes and day and month prices worked out from live listings and how booking works.'
    const out = sentenceDescription(long)
    expect(fitsDescription(out)).toBe(true)
    expect(out.endsWith('…')).toBe(true)
  })
})
