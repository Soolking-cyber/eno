import { describe, expect, it } from 'vitest'
import { validateHandle } from './handle-format'
import {
  HOUSING_PARTNERS, dollarsToDong, dongFigures, housingPartner, housingPlace, rentConflict, housingSellerRefusal, looksVietnamese, mapHousingRecord,
  projectCompound, type HousingRecord,
} from './housing-partners'
import { richTextGroups } from './rich-text-blocks'

const OPTS = { vndPerUsd: 25_000, now: Date.parse('2026-11-22T00:00:00Z') }
const alpha = housingPartner('alphahousing')!
const hs = housingPartner('housingsaigon')!
const cvr = housingPartner('cvr')!

const rec = (o: Partial<HousingRecord> = {}): HousingRecord => ({
  id: 104_794, link: 'https://housingsgn.com/properties/x/', date: '2026-11-18T22:24:49', title: 'ANK0166 | COZY 1BR APARTMENT FOR RENT',
  priceUsd: 920, unit: 'month', status: 'Available', beds: 1, baths: 1, areaM2: 55, kind: 'apartment', city: 'Ho Chi Minh City',
  building: 'Somewhere Unmapped', district: 'District 2', description: [], features: ['Pool', 'Gym', 'Pool'], photos: [], ...o,
})

describe('the roster', () => {
  it('three agencies, valid handles, eno-held logins', () => {
    expect(HOUSING_PARTNERS.map((p) => p.handle)).toEqual(['alphahousing', 'housingsaigon', 'cvr'])
    for (const p of HOUSING_PARTNERS) {
      expect(validateHandle(p.handle)).toBeNull()
      expect(p.email).toBe(`support+${p.handle}@eno.vn`)
    }
  })
})

describe('mapHousingRecord', () => {
  it('a monthly rental: đồng only, the agency\'s terms, its post date, no Vietnamese description (Haiku writes it)', () => {
    const m = mapHousingRecord(hs, rec(), OPTS)
    if (!m.ok) throw new Error(m.detail)
    expect(m.row).toMatchObject({
      externalId: 'housingsaigon:104794', price: 23_000_000, priceUnit: 'VND/month', subcategorySlug: 'apartment-rental', city: 'Hồ Chí Minh',
      district: 'Quận 2', descriptionVi: null, negotiable: false, lat: null, lng: null, areaM2: 55,
    })
    expect(m.row.title).toBe('1-bedroom apartment, 55 m² · Somewhere Unmapped, District 2')
    expect(m.row.titleVi).toBe('Căn hộ 1PN 55 m² · Somewhere Unmapped, Quận 2')
    expect(m.row.description).toContain('Rent: 23,000,000 đ a month')
    expect(m.row.description).toContain('Minimum contract: 6 months')
    expect(m.row.description).toContain('Listed by Housing Saigon on 18 November 2026.')
    expect(m.row.description).not.toMatch(/US\$|\$\s?\d|\d\s?USD/)
    expect(m.row.description.match(/Pool/g)).toHaveLength(1) // features de-duplicated
    expect(m.postedAt.toISOString()).toBe('2026-11-18T22:24:49.000Z')
    expect(JSON.parse(m.row.attributes!)).toMatchObject({ bedrooms: expect.any(String) })
  })

  it('drops a rented unit and one with no monthly price; holds a place it cannot name', () => {
    expect(mapHousingRecord(hs, rec({ status: 'Rented' }), OPTS)).toMatchObject({ ok: false, kind: 'drop', reason: 'rented' })
    expect(mapHousingRecord(hs, rec({ priceUsd: null }), OPTS)).toMatchObject({ ok: false, kind: 'drop', reason: 'noMonthlyPrice' })
    expect(mapHousingRecord(hs, rec({ unit: 'night' }), OPTS)).toMatchObject({ ok: false, kind: 'drop' })
    expect(mapHousingRecord(hs, rec({ district: 'Orthers' }), OPTS)).toMatchObject({ ok: false, kind: 'hold', reason: 'noPlace' })
    expect(mapHousingRecord(hs, rec({ priceUsd: 60 }), OPTS)).toMatchObject({ ok: false, kind: 'hold', reason: 'priceBand' })
  })

  it('villas and houses go in the house aisle; a serviced flat carries the serviced chip', () => {
    const v = mapHousingRecord(hs, rec({ kind: 'villa', beds: 4, title: 'ANK0200 | 4BR VILLA FOR RENT' }), OPTS)
    expect(v.ok && v.row.subcategorySlug).toBe('house-rental')
    const s = mapHousingRecord(hs, rec({ kind: 'serviced' }), OPTS)
    expect(s.ok && JSON.parse(s.row.attributes!).aptType).toBe('serviced')
  })

  it('Alpha: a Hà Nội compound → its district, no pin; the agency\'s lines kept, its dollar fees in đồng, its list a list', () => {
    const r = rec({
      id: 271_825, date: '2026-07-15T09:59:22', title: 'Ciputra 2BR apartment for rent', city: 'Ha Noi', district: 'Ciputra', districtTax: ['Ciputra'], building: 'Ciputra', priceUsd: 2550, beds: 2, baths: 2, areaM2: 90,
      description: ['Brand new apartment on a high floor.', 'Services and fees included:', 'Gym and pool membership', 'Electricity and tap water: 70 usd/month'],
    })
    const m = mapHousingRecord(alpha, r, OPTS)
    if (!m.ok) throw new Error(m.detail)
    expect(m.row).toMatchObject({ city: 'Hà Nội', district: 'Tây Hồ', lat: null, lng: null, externalId: 'alphahousing:271825' })
    expect(m.row.title).toBe('2-bedroom apartment, 90 m² · Ciputra, Tay Ho')
    expect(m.row.description).toContain('- Electricity and tap water: about 1,750,000 đ/month')
    expect(m.row.description).not.toMatch(/usd/i)
    const groups = richTextGroups(m.row.description).map((g) => g.kind)
    expect(groups.slice(0, 4)).toEqual(['p', 'p', 'p', 'ul'])
  })

  it('Alpha: a bare district tag works too; an unknown compound holds', () => {
    expect(housingPlace(alpha, rec({ districtTax: ['Ba Dinh'], district: 'Ba Dinh' }))?.district.vi).toBe('Ba Đình')
    expect(housingPlace(alpha, rec({ districtTax: ['Somewhere'], district: 'Somewhere' }))).toBeNull()
  })

  it('a contact left in the agency\'s text holds the row (the screen a person\'s own post meets)', () => {
    const m = mapHousingRecord(alpha, rec({ districtTax: ['Tay Ho'], description: ['Call 0987 00 33 77 to view'] }), OPTS)
    expect(m).toMatchObject({ ok: false, kind: 'hold', reason: 'contactInText' })
  })
})

describe('dollarsToDong', () => {
  it('rewrites every dollar shape in đồng at the run rate', () => {
    expect(dollarsToDong('Fee $1,200 or 50 USD or 30$', 25_000)).toBe('Fee about 30,000,000 đ or about 1,250,000 đ or about 750,000 đ')
    // Prefix forms whole, and a dot as the thousands mark (agencies here write "1.200 USD").
    expect(dollarsToDong('Deposit US$1,200, parking USD 40, fee 1.200 USD', 25_000)).toBe('Deposit about 30,000,000 đ, parking about 1,000,000 đ, fee about 30,000,000 đ')
  })

  it('fails closed: a dollar figure it cannot read drops the line', () => {
    expect(dollarsToDong('Rent $700-800 depending on floor', 25_000)).toBeNull()
    expect(dollarsToDong('Service fee 1.5 usd per m2', 25_000)).toBeNull()
    // Ranges either way round, and dollars spelled out (commit-gate review, codex + Opus).
    expect(dollarsToDong('Parking 50-60 USD', 25_000)).toBeNull()
    expect(dollarsToDong('Rent 700 to 800$ by floor', 25_000)).toBeNull()
    expect(dollarsToDong('Rent $700 - 800 by floor', 25_000)).toBeNull()
    expect(dollarsToDong('Cleaning 500 US dollars a month', 25_000)).toBeNull()
    // Vietnamese "đô" (dollars) — a word boundary cannot see non-ASCII letters, so the rule anchors on letters itself.
    expect(dollarsToDong('Phí quản lý 50 đô/tháng', 25_000)).toBeNull()
    expect(dollarsToDong('Gần khu đô thị mới', 25_000)).toBe('Gần khu đô thị mới')
    expect(dollarsToDong('A quiet lane near the lake', 25_000)).toBe('A quiet lane near the lake')
  })
})

describe('the agency\'s text', () => {
  const base = { district: 'Ba Dinh', districtTax: ['Ba Dinh'] }
  it('a visa or work-permit line, and a fee feature it cannot convert, are not published', () => {
    const m = mapHousingRecord(alpha, rec({ ...base, description: ['Bright flat with a view.', 'We help with visa and work permit.'], features: ['Pool', 'Visa support', 'Parking $50-60'] }), OPTS)
    if (!m.ok) throw new Error(m.detail)
    expect(m.row.description).not.toMatch(/visa|permit|\$/i)
    expect(m.row.description).toContain('Pool')
  })

  it('a list after "…included:" ends at the next full sentence of prose', () => {
    const m = mapHousingRecord(alpha, rec({ ...base, description: ['Included:', 'Gym', 'Pool', 'The building sits on a quiet lane a short walk from the lake and its cafes.'] }), OPTS)
    if (!m.ok) throw new Error(m.detail)
    expect(m.row.description).toContain('- Gym\n- Pool\n\nThe building sits')
  })
})

describe('housingSellerRefusal', () => {
  it('only the right owned, official storefront', () => {
    const ok = { id: 's', ownerId: 'u', ownerEmail: 'support+housingsaigon@eno.vn', officialPartner: true, trustScore: 65 }
    expect(housingSellerRefusal(hs, ok)).toBeNull()
    expect(housingSellerRefusal(hs, { ...ok, officialPartner: false })).toMatch(/official/)
    expect(housingSellerRefusal(hs, { ...ok, ownerEmail: 'x@y.z' })).toMatch(/owned by/)
  })
})

describe('CVR (Đà Nẵng)', () => {
  const cv = (o: Partial<HousingRecord> = {}): HousingRecord => rec({
    id: '2cf15fe9-57bb-46b6-b887-f8180c8cecb8', link: 'https://cvr.com.vn/property/x', date: '2026-10-16T10:03:14.449Z',
    title: '2-Bedroom Sea-View Apartment for Rent at FPT Plaza 2, Da Nang', priceUsd: 635, status: 'rent', beds: 2, baths: 2, areaM2: 71,
    city: 'Da Nang', district: 'Ngu Hanh Son', building: 'FPT Plaza 2 Apartment Da Nang', features: ['Cable TV'],
    description: ['Located on the 24th floor of FPT Plaza 2.', 'Rental Terms:', '- Rent: VND 16,000,000/month (foreign tenants)', '- Deposit: 1 month'], ...o,
  })

  it('reads every way its text states đồng, and nothing else', () => {
    expect(dongFigures('Rent: VND 16,000,000/month')).toEqual([16_000_000])
    expect(dongFigures('VND 16 million/month for foreign tenants')).toEqual([16_000_000])
    expect(dongFigures('Giá thuê: 70 triệu VNĐ/tháng')).toEqual([70_000_000])
    expect(dongFigures('JUST 50 MILLION VND/MONTH')).toEqual([50_000_000])
    expect(dongFigures('Rent: 12 million/month')).toEqual([12_000_000])
    expect(dongFigures('Utilities about VND 2.3 million')).toEqual([2_300_000])
    // Unspaced, ungrouped and plural forms (commit-gate review, codex + Opus 2026-11-23).
    expect(dongFigures('16.000.000đ / 16,000,000VND / 16.000.000VNĐ')).toEqual([16_000_000, 16_000_000, 16_000_000])
    expect(dongFigures('Rent: 16000000 VND/month')).toEqual([16_000_000])
    expect(dongFigures('16 millions VND')).toEqual([16_000_000])
    // No đồng mark: a size, a count, a dollar price, a phone-like run are not money in đồng.
    expect(dongFigures('5 million visitors, 1,200 sqm, $1,200, 33,500,000 for 1 month')).toEqual([])
  })

  it('the price is the card; a stated rent the card does not match holds, and nothing else does', () => {
    // 635 US$ at 26,300 = 16.7 million; the text's "VND 16,000,000/month" is within 15 %.
    expect(rentConflict(cvr, cv(), 26_300)).toBeNull()
    expect(rentConflict(cvr, cv({ priceUsd: 1000, description: ['Local tenants: 25 million VND/month & foreign tenants: 27 million VND/month'] }), 26_300)).toBeNull()
    // A deposit or a second unit beside the rent never holds a listing whose rent the card matches…
    expect(rentConflict(cvr, cv({ priceUsd: 1000, description: ['Rent: VND 28 million/month; deposit: VND 52 million'] }), 26_300)).toBeNull()
    // …a text stating no rent cannot conflict (a deposit or bill line is not a rent line)…
    expect(rentConflict(cvr, cv({ description: ['Deposit: two months', 'Electricity about VND 2 million'] }), 26_300)).toBeNull()
    // …but a rent the card does not match is held, however far apart, whatever else the text prices.
    expect(rentConflict(cvr, cv({ priceUsd: 13_800, description: ['Rent: 200 million VND/month'] }), 26_300)).toEqual([200_000_000])
    expect(rentConflict(cvr, cv({ priceUsd: 1000, description: ['Rent: VND 70 million/month', 'Furniture package: VND 26 million'] }), 26_300)).toEqual([70_000_000])
    // Partners whose text is not read for rents never conflict.
    expect(rentConflict(hs, cv({ description: ['Rent: VND 70 million/month'] }), 26_300)).toBeNull()
  })

  it('a flat: its district, the project its title names, the card in đồng, no pin', () => {
    const m = mapHousingRecord(cvr, cv(), OPTS)
    if (!m.ok) throw new Error(m.detail)
    expect(m.row).toMatchObject({
      externalId: 'cvr:2cf15fe9-57bb-46b6-b887-f8180c8cecb8', city: 'Đà Nẵng', district: 'Ngũ Hành Sơn', location: 'Ngũ Hành Sơn (FPT Plaza 2)',
      price: 15_880_000, subcategorySlug: 'apartment-rental', lat: null, lng: null, descriptionVi: null,
    })
    expect(m.row.title).toBe('2-bedroom apartment, 71 m² · FPT Plaza 2, Ngu Hanh Son')
    expect(m.row.titleVi).toBe('Căn hộ 2PN 71 m² · FPT Plaza 2, Ngũ Hành Sơn')
    expect(m.row.description).toContain('Apartment for rent at FPT Plaza 2, Ngu Hanh Son, Da Nang: 2 bedrooms, 2 bathrooms, 71 m².')
    expect(m.row.description).toContain('- Rent: 15,880,000 đ a month')
    // The agency's own đồng line stays as it wrote it; eno's line says its figure is converted.
    expect(m.row.description).toContain('- Rent: VND 16,000,000/month (foreign tenants)')
    expect(m.row.description).toMatch(/shown in đồng at 25,000 đ per US dollar, so they are approximate/)
    expect(m.row.description).toContain('Listed by Central Vietnam Realty on 16 October 2026.')
  })

  it('Hội An is a district of Đà Nẵng', () => {
    const m = mapHousingRecord(cvr, cv({ city: 'Hoi An', district: 'Cam Thanh', building: null, title: 'Villa for Rent at Casamia', kind: 'villa', beds: 3, description: ['A quiet villa.'] }), OPTS)
    if (!m.ok) throw new Error(m.detail)
    expect(m.row).toMatchObject({ district: 'Hội An', subcategorySlug: 'house-rental', price: 15_880_000 })
    expect(m.row.title).toBe('3-bedroom villa, 71 m² · Hoi An')
    expect(m.row.description).toMatch(/shown in đồng at 25,000 đ per US dollar, so they are approximate/)
  })

  it('office and shop space go in the Office aisle, with no bedrooms', () => {
    const m = mapHousingRecord(cvr, cv({ kind: 'commercial', beds: 3, baths: 2, areaM2: 97, title: 'Commercial Space for Rent | Panoma 2', building: null }), OPTS)
    if (!m.ok) throw new Error(m.detail)
    expect(m.row.subcategorySlug).toBe('office-rental')
    expect(m.row.title).toBe('Commercial space, 97 m² · Ngu Hanh Son')
    expect(m.row.description).toContain('Commercial space for rent in Ngu Hanh Son, Da Nang: 97 m².')
    expect(m.row.attributes).toBeNull()
  })

  it('drops a sale or a transfer, holds a whole building, a wrong bedroom count, a Vietnamese text and an unknown place', () => {
    expect(mapHousingRecord(cvr, cv({ title: 'FPT PLAZA 2 – HIGH FLOOR 2-BEDROOM APARTMENT FOR SALE', priceUsd: 15_000 }), OPTS)).toMatchObject({ ok: false, kind: 'drop', reason: 'notForRent' })
    expect(mapHousingRecord(cvr, cv({ title: 'Spa Building for Lease / Transfer' }), OPTS)).toMatchObject({ ok: false, kind: 'drop', reason: 'notForRent' })
    expect(mapHousingRecord(cvr, cv({ title: 'Café for Transfer in An Thuong' }), OPTS)).toMatchObject({ ok: false, kind: 'drop', reason: 'notForRent' })
    // Not a sale: a rental offered for sale OR rent, or one with an airport transfer.
    expect(mapHousingRecord(cvr, cv({ title: '2-Bedroom Apartment FOR SALE OR RENT at FPT Plaza 2' }), OPTS).ok).toBe(true)
    expect(mapHousingRecord(hs, rec({ title: 'COZY 1BR APARTMENT, FREE AIRPORT TRANSFER' }), OPTS).ok).toBe(true)
    expect(mapHousingRecord(cvr, cv({ title: 'Luxury 10-Unit Apartment Building for Lease', beds: 10 }), OPTS)).toMatchObject({ ok: false, kind: 'hold', reason: 'wholeBuilding' })
    expect(mapHousingRecord(cvr, cv({ title: 'HIGH-FLOOR 3-BEDROOM APARTMENT FOR RENT', beds: 1 }), OPTS)).toMatchObject({ ok: false, kind: 'hold', reason: 'bedsConflict' })
    expect(mapHousingRecord(cvr, cv({ description: ['Villa cho thuê dài hạn, gồm 4 tầng với 8 phòng ngủ, phù hợp cho gia đình đông người.'] }), OPTS)).toMatchObject({ ok: false, kind: 'hold', reason: 'notEnglish' })
    expect(mapHousingRecord(cvr, cv({ city: 'Hue', district: 'Phu Hoi' }), OPTS)).toMatchObject({ ok: false, kind: 'hold', reason: 'noPlace' })
  })

  it('a project name only when the listing\'s own title names it (CVR links some to the wrong one)', () => {
    expect(projectCompound('FPT Plaza 2 Apartment Da Nang', '2-Bedroom Apartment at FPT Plaza 2')).toBe('FPT Plaza 2')
    expect(projectCompound('SAM TOWER DA NANG', '2-BEDROOM APARTMENT AT SAM TOWERS BUILDING')).toBe('Sam Tower')
    expect(projectCompound('The Filmore Da Nang Apartment Project', 'LUXURY 1-BEDROOM APARTMENT AT THE FILMORE DA NANG')).toBe('The Filmore')
    expect(projectCompound('Times Square Da Nang', 'LUXURY 2BEDROOM APARTMENT AT FUTA RESIDENCE')).toBeNull()
    expect(projectCompound('SUN COSMO RESIDENCE DA NANG', 'Studio at Panoma')).toBeNull()
    expect(projectCompound(null, 'anything')).toBeNull()
    // A phrase, not loose words: "Sun Residence" is not named by "Sun-filled … residence".
    expect(projectCompound('Sun Residence Da Nang', 'Sun-filled 2BR apartment in a quiet residence')).toBeNull()
    expect(projectCompound('Ocean Da Nang', 'Ocean-view studio')).toBeNull()
  })

  it('English with a Vietnamese place name is still English', () => {
    expect(looksVietnamese('A bright villa near Hội An old town and the Thu Bồn river, five minutes from An Bàng beach by bicycle.')).toBe(false)
    expect(looksVietnamese('Căn hộ ở Thảo Điền, Thủ Đức, gần Tây Hồ — Thảo Điền, Thủ Đức, Tây Hồ, Thảo Điền for rent near the river and the park and the school.')).toBe(true)
    expect(looksVietnamese('Villa cho thuê dài hạn, gồm 4 tầng với 8 phòng ngủ, phù hợp cho gia đình đông người.')).toBe(true)
  })
})
