import { describe, expect, it } from 'vitest'
import { validateHandle } from './handle-format'
import {
  HOUSING_PARTNERS, dollarsToDong, housingPartner, housingPlace, housingSellerRefusal, mapHousingRecord, type HousingRecord,
} from './housing-partners'
import { richTextGroups } from './rich-text-blocks'

const OPTS = { vndPerUsd: 25_000, now: Date.parse('2026-11-22T00:00:00Z') }
const alpha = housingPartner('alphahousing')!
const hs = housingPartner('housingsaigon')!

const rec = (o: Partial<HousingRecord> = {}): HousingRecord => ({
  id: 104_794, link: 'https://housingsgn.com/properties/x/', date: '2026-11-18T22:24:49', title: 'ANK0166 | COZY 1BR APARTMENT FOR RENT',
  priceUsd: 920, unit: 'month', status: 'Available', beds: 1, baths: 1, areaM2: 55, kind: 'apartment', city: 'Ho Chi Minh City',
  building: 'Somewhere Unmapped', district: 'District 2', description: [], features: ['Pool', 'Gym', 'Pool'], photos: [], ...o,
})

describe('the roster', () => {
  it('two agencies, valid handles, eno-held logins', () => {
    expect(HOUSING_PARTNERS.map((p) => p.handle)).toEqual(['alphahousing', 'housingsaigon'])
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
    const v = mapHousingRecord(hs, rec({ kind: 'villa', beds: 4 }), OPTS)
    expect(v.ok && v.row.subcategorySlug).toBe('house-rental')
    const s = mapHousingRecord(hs, rec({ kind: 'serviced' }), OPTS)
    expect(s.ok && JSON.parse(s.row.attributes!).aptType).toBe('serviced')
  })

  it('Alpha: a Hà Nội compound → its district, no pin; the agency\'s lines kept, its dollar fees in đồng, its list a list', () => {
    const r = rec({
      id: 271_825, date: '2026-07-15T09:59:22', city: 'Ha Noi', district: 'Ciputra', districtTax: ['Ciputra'], building: 'Ciputra', priceUsd: 2550, beds: 2, baths: 2, areaM2: 90,
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
