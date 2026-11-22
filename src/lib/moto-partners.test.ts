import { describe, expect, it } from 'vitest'
import { validateHandle } from './handle-format'
import {
  EXTRA_MILE_BIKES, MOTO_PARTNERS, SSC_SCOOTERS, extraMileDescription, extraMilePrice, extraMileResearchProblem, extraMileTitle,
  motoPartner, motoPartnerSellerRefusal, sscDescription, sscResearchProblem, sscTitle, stageExtraMileBike, stageSscListing, type Fx,
} from './moto-partners'
import { assertCleanTexts } from './publish-guard'
import { richTextGroups } from './rich-text-blocks'

const LANGS = ['en', 'vi'] as const
const FX: Fx = { vndPerUsd: 26_300, dayEn: '22 November 2026', dayVi: '22/11/2026' }
const bike = (slug: string) => EXTRA_MILE_BIKES.find((b) => b.slug === slug)!

describe('the roster', () => {
  it('two shops, each with a valid handle and an eno-held email for it', () => {
    expect(MOTO_PARTNERS.map((p) => p.handle)).toEqual(['theextramile', 'saigonscootercentre'])
    for (const p of MOTO_PARTNERS) {
      expect(validateHandle(p.handle), p.handle).toBeNull()
      expect(p.email).toBe(`support+${p.handle}@eno.vn`)
    }
  })

  it('every Extra Mile bike is unique, priced one way or the other, and the CRF150L (no photos of its own) is not here', () => {
    expect(EXTRA_MILE_BIKES).toHaveLength(22)
    expect(new Set(EXTRA_MILE_BIKES.map((b) => b.slug)).size).toBe(EXTRA_MILE_BIKES.length)
    expect(new Set(EXTRA_MILE_BIKES.map((b) => b.name)).size).toBe(EXTRA_MILE_BIKES.length)
    expect(EXTRA_MILE_BIKES.map((b) => b.slug)).not.toContain('honda-crf150l')
    for (const b of EXTRA_MILE_BIKES) {
      expect(b.city || b.road, b.slug).toBeTruthy()
      if (b.city) {
        expect(b.city.month).toBe(b.city.firstDay * 10) // the shop's pages: a month is ten first days, on every bike
        if (b.city.table) expect(b.city.table.d2).toBe(b.city.firstDay * 2)
      }
    }
  })
})

describe('the listing text', () => {
  it.each(LANGS)('%s: no phone, link, email or street address anywhere (chat-only partners)', (lang) => {
    for (const b of EXTRA_MILE_BIKES) expect(() => assertCleanTexts([extraMileTitle(b, lang), extraMileDescription(b, FX, lang)]), b.slug).not.toThrow()
    expect(() => assertCleanTexts([sscTitle(lang), sscDescription(FX, lang)])).not.toThrow()
  })

  it.each(LANGS)('%s: a city-and-road bike reads intro, a city price TABLE, road trip, terms, source — nothing run together', (lang) => {
    const groups = richTextGroups(extraMileDescription(bike('honda-vision-v2-2019-2020'), FX, lang)).map((g) => g.kind)
    expect(groups).toEqual(['p', 'h', 'dl', 'p', 'h', 'ul', 'h', 'ul', 'p'])
  })

  it.each(LANGS)('%s: where the site\'s table disagrees with the bike page, only the page\'s three figures, still a table', (lang) => {
    const d = extraMileDescription(bike('honda-xr-150'), FX, lang)
    expect(richTextGroups(d).map((g) => g.kind)).toEqual(['p', 'h', 'dl', 'p', 'h', 'ul', 'h', 'ul', 'p'])
    expect(d).toContain(lang === 'en' ? '6,000,000 đ' : '6.000.000 đ')
    expect(d).not.toContain(lang === 'en' ? '5,700,000' : '5.700.000') // the table's month for the XR 150
  })

  it.each(LANGS)('%s: a road-trip-only bike prints its dollar table and says its đồng price is converted', (lang) => {
    const d = extraMileDescription(bike('kawasaki-versys-x-300'), FX, lang)
    expect(richTextGroups(d).map((g) => g.kind)).toEqual(['p', 'h', 'dl', 'p', 'h', 'ul', 'p'])
    expect(d).toContain('US$850')
    expect(d).toContain(lang === 'en' ? '26,300 đ' : '26.300 đ')
  })

  it.each(LANGS)('%s: an e-bike has no road-trip section (the site: "Not Available") and no fuel-tank rule', (lang) => {
    for (const slug of ['vinfast-klara-s-v1-2021-2023', 'dat-bike-quantum-s3-2024']) {
      const d = extraMileDescription(bike(slug), FX, lang)
      expect(richTextGroups(d).map((g) => g.kind)).toEqual(['p', 'h', 'dl', 'p', 'h', 'ul', 'p'])
      expect(d).not.toMatch(/tank|bình xăng/)
    }
    expect(extraMileDescription(bike('honda-vision-v2-2019-2020'), FX, lang)).toMatch(lang === 'en' ? /tank full/ : /bình xăng/)
  })

  it.each(LANGS)('%s: Saigon Scooter Centre: a three-scooter price table, then included and terms lists', (lang) => {
    const d = sscDescription(FX, lang)
    expect(richTextGroups(d).map((g) => g.kind)).toEqual(['p', 'h', 'dl', 'ul', 'h', 'ul', 'h', 'ul', 'p'])
    for (const s of SSC_SCOOTERS) expect(d).toContain(`US$${s.perDayUsd}`)
    // Its Terms page is for tours: none of it is printed.
    expect(d).not.toMatch(/950/)
  })

  it('states whose prices they are and when', () => {
    for (const b of EXTRA_MILE_BIKES) {
      expect(extraMileDescription(b, FX, 'en')).toContain('as The Extra Mile publishes them, read 22 November 2026')
      expect(extraMileDescription(b, FX, 'vi')).toContain('cập nhật 22/11/2026')
    }
    expect(sscDescription(FX, 'en')).toContain('as Saigon Scooter Centre publishes them, read 22 November 2026')
  })
})

describe('the rows', () => {
  it('a city bike is priced by the month in đồng and answers both period chips; a road-only bike by the converted day', () => {
    const v = stageExtraMileBike(bike('honda-pcx-150-2019-2020'), FX)
    expect(v).toMatchObject({ externalId: 'theextramile:honda-pcx-150-2019-2020', price: 4_500_000, priceUnit: 'VND/month', subcategorySlug: 'motorbike-rental', negotiable: false, district: 'Quận 2' })
    expect(JSON.parse(v.attributes)).toEqual({ rentalPeriod: 'monthly', transmission: 'automatic' })
    expect(v.facetTokens).toContain('monthly')
    expect(v.facetTokens).toContain('daily')
    const cb = stageExtraMileBike(bike('honda-cb500x'), FX)
    expect(cb).toMatchObject({ price: 1_580_000, priceUnit: 'VND/day' }) // 60 × 26,300 = 1,578,000 → nearest 10,000
    expect(extraMilePrice(bike('honda-cb500x'), FX).convertedFromUsd).toBe(60)
  })

  it('the Dat Bike\'s 6,000 W reads as six thousand in Vietnamese too', () => {
    expect(extraMileDescription(bike('dat-bike-quantum-s3-2024'), FX, 'en')).toContain('Electric, 6,000 W')
    expect(extraMileDescription(bike('dat-bike-quantum-s3-2024'), FX, 'vi')).toContain('Xe điện, 6.000 W')
  })

  it('e-bikes go in the e-bike aisle', () => {
    expect(stageExtraMileBike(bike('dat-bike-quantum-s3-2024'), FX).subcategorySlug).toBe('ebike-rental')
  })

  it('Saigon Scooter Centre: one row, priced at the scooter its title names first', () => {
    const r = stageSscListing(FX)
    expect(r).toMatchObject({ externalId: 'saigonscootercentre:scooter-rental', price: 260_000, priceUnit: 'VND/day', subcategorySlug: 'motorbike-rental' })
    expect(r.title.indexOf('Air Blade')).toBeLessThan(r.title.indexOf('Scomadi'))
    expect(JSON.parse(r.attributes)).toEqual({ rentalPeriod: 'daily' })
  })
})

describe('the run\'s checks', () => {
  it('refuses a bike whose research moved on ANY printed figure, not only the card price', () => {
    // The XR 150 as researched: its city table disagrees with its page (5.7 M), so no table is printed for it.
    const xr = bike('honda-xr-150')
    const xrR = { slug: xr.slug, cityFirst: 600_000, cityMonth: 6_000_000, deposit: '4,000,000 VND', roadFirstUsd: 25,
      cityTable: { month: 5_700_000, d2: 1_140_000, d7: 2_770_000, d14: 3_980_000, waiver30: 6_908_000 }, roadTable: { d1: 24, d7: 155, d14: 273, d30: 450, oneWayExtra: 70 } }
    expect(extraMileResearchProblem(xr, xrR)).toBeNull()
    expect(extraMileResearchProblem(xr, { ...xrR, cityMonth: 6_500_000 })).toMatch(/a month/)
    expect(extraMileResearchProblem(xr, { ...xrR, cityFirst: 650_000 })).toMatch(/first day/)
    expect(extraMileResearchProblem(xr, { ...xrR, deposit: '5,000,000 VND' })).toMatch(/deposit/)
    expect(extraMileResearchProblem(xr, { ...xrR, roadFirstUsd: 27 })).toMatch(/road-trip day/)
    // …and a table that now AGREES with the page is a change too: the module would print the wrong (no) table.
    expect(extraMileResearchProblem(xr, { ...xrR, cityTable: { ...xrR.cityTable, month: 6_000_000 } })).toMatch(/city table/)
    // A printed table row that moved.
    const v = bike('honda-vision-v2-2019-2020')
    const vR = { slug: v.slug, cityFirst: 280_000, cityMonth: 2_800_000, deposit: '4,000,000 VND', roadFirstUsd: 14,
      cityTable: { month: 2_800_000, d2: 560_000, d7: 1_360_000, d14: 1_960_000, waiver30: 3_394_000 }, roadTable: { d1: 13, d7: 85, d14: 156, d30: 280, oneWayExtra: 70 } }
    expect(extraMileResearchProblem(v, vR)).toBeNull()
    expect(extraMileResearchProblem(v, { ...vR, cityTable: { ...vR.cityTable, d7: 1_400_000 } })).toMatch(/city table/)
    const cb = bike('honda-cb500x')
    const cbR = { slug: cb.slug, cityFirst: null, cityMonth: null, deposit: 'NA', roadFirstUsd: 60, cityTable: null, roadTable: { d1: 60, d7: 399, d14: 721, d30: 1150, oneWayExtra: 70 } }
    expect(extraMileResearchProblem(cb, cbR)).toBeNull()
    expect(extraMileResearchProblem(cb, { ...cbR, roadTable: { ...cbR.roadTable, d30: 1200 } })).toMatch(/road-trip table/)
    expect(extraMileResearchProblem(cb, { ...cbR, roadTable: { ...cbR.roadTable, oneWayExtra: 80 } })).toMatch(/one-way/)
    expect(extraMileResearchProblem(xr, undefined)).toMatch(/not in the research/)
    expect(sscResearchProblem([{ key: 'airblade', perDayUsd: 10 }, { key: 'scomadi', perDayUsd: 45 }, { key: 'vespa', perDayUsd: 75 }])).toBeNull()
    expect(sscResearchProblem([{ key: 'airblade', perDayUsd: 12 }, { key: 'scomadi', perDayUsd: 45 }, { key: 'vespa', perDayUsd: 75 }])).toMatch(/airblade/)
  })

  it('writes only onto the right owned, official storefront', () => {
    const p = motoPartner('theextramile')!
    const ok = { id: 's1', ownerId: 'u1', ownerEmail: 'support+theextramile@eno.vn', officialPartner: true, trustScore: 50, location: null }
    expect(motoPartnerSellerRefusal(p, ok)).toBeNull()
    expect(motoPartnerSellerRefusal(p, null)).toMatch(/register it first/)
    expect(motoPartnerSellerRefusal(p, { ...ok, ownerId: null })).toMatch(/no owning account/)
    expect(motoPartnerSellerRefusal(p, { ...ok, ownerEmail: 'someone@else.vn' })).toMatch(/owned by/)
    expect(motoPartnerSellerRefusal(p, { ...ok, officialPartner: false })).toMatch(/not an official partner/)
  })
})
