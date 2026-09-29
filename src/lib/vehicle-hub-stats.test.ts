import { describe, it, expect } from 'vitest'
import {
  BAND_MIN, RANGE_MIN, bikeCohorts, carCohorts, districtCounts, isVinFast, periodOf, quantile, summarize, type HubRow,
} from './vehicle-hub-stats'
import { MARKETPLACE_GUIDE_PATHS, marketplaceGuideAlternates, MARKETPLACE_GUIDE_SLUGS } from './expat-guides'
import { isVehicleHireReference } from './rental-places'
import { hcmcIsoDate, linkState, referenceSources } from './vehicle-hub-stats'
import { hubBooking, hubDisclosure, hubIntro, type HubCopyInput } from './vehicle-hub-copy'

const car = (price: number, seats: string | null, title = 'Toyota Vios 2022', unit = 'VND/day'): HubRow => ({
  price, priceUnit: unit, title, district: 'Quận 1',
  attributes: JSON.stringify({ rentalPeriod: unit === 'VND/day' ? 'daily' : 'monthly', ...(seats ? { seats } : {}) }),
})
const bike = (price: number, period: 'daily' | 'monthly', transmission: 'automatic' | 'manual'): HubRow => ({
  price, priceUnit: period === 'daily' ? 'VND/day' : 'VND/month', title: 'Honda Vision', district: null,
  attributes: JSON.stringify({ rentalPeriod: period, transmission }),
})

describe('summarize — the method the hub prints', () => {
  it('gives no figure below RANGE_MIN, a low–high range below BAND_MIN, and a median + middle half from BAND_MIN', () => {
    expect(summarize([1, 2, 3, 4].map((x) => x * 100_000))).toEqual({ kind: 'too-few', n: RANGE_MIN - 1 })
    const range = summarize(Array.from({ length: RANGE_MIN }, (_, i) => (i + 1) * 100_000))
    expect(range).toEqual({ kind: 'range', n: RANGE_MIN, min: 100_000, max: 500_000 })
    const band = summarize(Array.from({ length: BAND_MIN }, (_, i) => (i + 1) * 100_000))
    expect(band.kind).toBe('band')
    if (band.kind === 'band') {
      expect(band.n).toBe(BAND_MIN)
      // 1..20 × 100k: median 10.5 → 1,050,000; type-7 quartiles 5.75 / 15.25 → rounded to 1,000.
      expect(band.median).toBe(1_050_000)
      expect(band.p25).toBe(575_000)
      expect(band.p75).toBe(1_525_000)
    }
  })

  it('ignores zero, negative and non-finite prices rather than letting them drag the median', () => {
    expect(summarize([0, -5, Number.NaN, 100_000, 200_000, 300_000, 400_000, 500_000]).n).toBe(5)
  })

  it('interpolates quantiles like QUARTILE.INC', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(quantile([10], 0.25)).toBe(10)
  })
})

describe('cohorts', () => {
  it('cars: DAY prices only — a month-priced car never enters a day cohort', () => {
    const rows = [...Array.from({ length: 5 }, () => car(800_000, '5')), car(20_000_000, '5', 'Kia', 'VND/month')]
    const all = carCohorts(rows).find((c) => c.key === 'all')!.summary
    expect(all.n).toBe(5)
  })

  it('cars: 4 and 5 seats are one cohort, 7 seats another, VinFast by name', () => {
    const rows = [car(1, '4'), car(1, '5'), car(1, '7'), car(1, null, 'VinFast VF5 2026'), car(1, null, 'VF3 ECO Vinfast VF3')]
    const n = Object.fromEntries(carCohorts(rows).map((c) => [c.key, c.summary.n]))
    expect(n).toEqual({ all: 5, 'seats-4-5': 2, 'seats-7': 1, vinfast: 2 })
    expect(isVinFast({ ...car(1, null), title: 'Toyota Vios' })).toBe(false)
  })

  it('bikes: day and month are separate cohorts, and a month price is never derived from a day price', () => {
    const rows = [
      ...Array.from({ length: 6 }, () => bike(150_000, 'daily', 'automatic')),
      ...Array.from({ length: 6 }, () => bike(2_500_000, 'monthly', 'automatic')),
    ]
    const c = Object.fromEntries(bikeCohorts(rows).map((x) => [x.key, x.summary]))
    expect(c['daily-all']).toMatchObject({ kind: 'range', n: 6, min: 150_000, max: 150_000 })
    expect(c['monthly-all']).toMatchObject({ kind: 'range', n: 6, min: 2_500_000, max: 2_500_000 })
    expect(c['daily-manual']).toEqual({ kind: 'too-few', n: 0 })
  })

  it('reads the period from attributes first, then from the price unit', () => {
    expect(periodOf({ price: 1, priceUnit: 'VND/month', title: '', district: null, attributes: JSON.stringify({ rentalPeriod: 'daily' }) })).toBe('daily')
    expect(periodOf({ price: 1, priceUnit: 'VND/week', title: '', district: null, attributes: null })).toBe('weekly')
    expect(periodOf({ price: 1, priceUnit: 'VND', title: '', district: null, attributes: '{bad json' })).toBeNull()
  })

  it('counts districts largest first and leaves out rows with none', () => {
    const rows: HubRow[] = [car(1, '5'), car(1, '5'), { ...car(1, '5'), district: 'Quận 7' }, { ...car(1, '5'), district: null }]
    expect(districtCounts(rows)).toEqual([{ district: 'Quận 1', count: 2 }, { district: 'Quận 7', count: 1 }])
  })
})

describe('the hubs are registered, paired and reserved', () => {
  const HUBS = ['car-rental-ho-chi-minh-city', 'thue-xe-tu-lai-tphcm', 'motorbike-rental-ho-chi-minh-city', 'thue-xe-may-tphcm']

  it('are in the pages sitemap and reserved as handles', () => {
    for (const s of HUBS) {
      expect(MARKETPLACE_GUIDE_PATHS).toContain(`/${s}`)
      expect(MARKETPLACE_GUIDE_SLUGS).toContain(s)
    }
  })

  it('declare a reciprocal hreflang pair with x-default on the English page', () => {
    expect(marketplaceGuideAlternates('car-rental-ho-chi-minh-city').languages).toEqual({
      en: '/car-rental-ho-chi-minh-city', 'vi-VN': '/thue-xe-tu-lai-tphcm', 'x-default': '/car-rental-ho-chi-minh-city',
    })
    expect(marketplaceGuideAlternates('thue-xe-tu-lai-tphcm').languages).toEqual(marketplaceGuideAlternates('car-rental-ho-chi-minh-city').languages)
    expect(marketplaceGuideAlternates('thue-xe-may-tphcm').languages).toEqual({
      en: '/motorbike-rental-ho-chi-minh-city', 'vi-VN': '/thue-xe-may-tphcm', 'x-default': '/motorbike-rental-ho-chi-minh-city',
    })
  })
})

describe('isVehicleHireReference — the PDP noindex rule', () => {
  it('is true only for an outbound-linked vehicle-hire row in rentals', () => {
    const base = { affiliateUrl: 'https://www.mioto.vn/car/x/ABC', categorySlug: 'rentals' }
    expect(isVehicleHireReference({ ...base, subcategorySlug: 'car-rental' })).toBe(true)
    expect(isVehicleHireReference({ ...base, subcategorySlug: 'motorbike-rental' })).toBe(true)
    // A car a real person posts has no affiliateUrl: stays indexable.
    expect(isVehicleHireReference({ ...base, affiliateUrl: null, subcategorySlug: 'car-rental' })).toBe(false)
    // Imported homes (Rever) keep their indexing.
    expect(isVehicleHireReference({ ...base, affiliateUrl: 'https://rever.vn/x', subcategorySlug: 'apartment-rental' })).toBe(false)
    expect(isVehicleHireReference({ ...base, affiliateUrl: 'https://rever.vn/x', subcategorySlug: null })).toBe(false)
    // Vehicles FOR SALE are another category.
    expect(isVehicleHireReference({ affiliateUrl: 'https://x.vn/y', categorySlug: 'vehicles', subcategorySlug: 'car' })).toBe(false)
  })
})


describe('the hub trust copy follows what is actually live (codex/opus review, 2026-09-29)', () => {
  const input = (state: HubCopyInput['state'], lang: 'en' | 'vi' = 'en', kind: 'car' | 'motorbike' = 'car'): HubCopyInput =>
    ({ kind, lang, state, n: '6,156', from: state === 'none' ? '' : 'Mioto and BonbonCar', site: 'eno.vn' })

  it('counts linked ROWS, not sellers with any linked row', () => {
    expect(linkState(10, 10)).toBe('all')
    expect(linkState(10, 9)).toBe('some') // one person posted a car directly: no longer "all"
    expect(linkState(10, 0)).toBe('none')
    expect(linkState(0, 0)).toBe('none')
    expect(referenceSources([{ name: 'Mioto', linkedCount: 5 }, { name: 'Anh Tuấn', linkedCount: 0 }])).toEqual(['Mioto'])
  })

  it('says "every" and "reference listings" only when every row books on its source', () => {
    expect(hubIntro(input('all'))).toContain('Every car links to the page where you book it.')
    expect(hubDisclosure(input('all'))).toMatch(/^These are reference listings/)
    for (const lang of ['en', 'vi'] as const) {
      for (const kind of ['car', 'motorbike'] as const) {
        const some = input('some', lang, kind)
        expect(hubIntro(some)).not.toMatch(/Every|Mỗi xe đều/)
        expect(hubDisclosure(some)).not.toMatch(/^These are|^Đây là các tin tham khảo/)
        expect(hubBooking(some)).toMatch(/chat|nhắn tin/)
        expect(hubDisclosure(input('none', lang, kind))).toBeUndefined()
        expect(hubBooking(input('none', lang, kind))).not.toMatch(/not with eno\.vn|không qua eno\.vn/)
      }
    }
  })

  it('dates the JSON-LD on Ho Chi Minh City’s calendar, like the printed date', () => {
    // 2026-09-29 20:30 UTC is already 30 September in Saigon (UTC+7).
    expect(hcmcIsoDate(new Date('2026-09-29T20:30:00Z'))).toBe('2026-09-30')
  })
})

describe('the hub copy names the site it is served on', () => {
  it('says eno.forum on eno.forum, never a hard-coded eno.vn', () => {
    const forum = { kind: 'car' as const, lang: 'en' as const, state: 'some' as const, n: '3', from: 'Mioto', site: 'eno.forum' }
    for (const text of [hubDisclosure(forum)!, hubBooking(forum), hubIntro(forum)]) expect(text).not.toContain('eno.vn')
    expect(hubDisclosure(forum)).toContain('eno.forum')
  })
})
