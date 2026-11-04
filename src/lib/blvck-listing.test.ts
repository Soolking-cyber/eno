import { describe, expect, it } from 'vitest'
import {
  BLVCK_BIKES, BLVCK_CACHED_LANGS, BLVCK_COPY, BLVCK_EMAIL, blvckDescription, blvckFeedProblem, blvckMoney, blvckSellerRefusal,
  blvckTitle, blvckTranslations, stageBlvckBike, type BlvckBike, type BlvckLang, type BlvckSeller,
} from './blvck-listing'
import { assertCleanTexts } from './publish-guard'
import { richTextGroups } from './rich-text-blocks'

const ALL_LANGS = Object.keys(BLVCK_COPY) as BlvckLang[]
const bike = (slug: string) => BLVCK_BIKES.find((b) => b.slug === slug) as BlvckBike
const STRINGS_OF_COPY = (l: BlvckLang) => Object.values(BLVCK_COPY[l]).filter((v): v is string => typeof v === 'string')

describe('the partner tables', () => {
  it('holds their 19 bikes, once each', () => {
    expect(BLVCK_BIKES).toHaveLength(19)
    expect(new Set(BLVCK_BIKES.map((b) => b.slug)).size).toBe(19)
  })

  it.each([
    ['honda-wave-alpha', [100_000, 80_000, 70_000, 50_000], { from: 1_000_000 }],
    ['honda-cub-50cc', [100_000, 80_000, 70_000, 50_000], { from: 1_000_000 }],
    ['honda-vision', [150_000, 120_000, 100_000, 80_000], { from: 1_000_000 }],
    ['vinfast-evo-200', [150_000, 120_000, 100_000, 80_000], { from: 1_000_000 }],
    ['honda-vario', [300_000, 250_000, 200_000, 180_000], { from: 3_000_000, to: 5_000_000 }],
    ['honda-winner', [250_000, 200_000, 150_000, 120_000], { from: 2_000_000 }],
    ['honda-sh-150cc', [500_000, 400_000, 350_000, 300_000], { from: 10_000_000 }],
  ])('%s carries its class table', (slug, tiers, deposit) => {
    expect(bike(slug).tiers).toEqual(tiers)
    expect(bike(slug).deposit).toEqual(deposit)
  })

  it('leads with the 1-2 day price, the one their price list and feed state', () => {
    for (const b of BLVCK_BIKES) if (b.tiers) expect(stageBlvckBike(b).price).toBe(b.tiers[0])
    expect(stageBlvckBike(bike('bmw-s1000rr')).price).toBe(1_500_000)
    expect(stageBlvckBike(bike('kawasaki-z1000')).priceUnit).toBe('VND/day')
  })
})

describe('every language', () => {
  it.each(ALL_LANGS)('%s: the price table stays a table, the conditions stay lists', (lang) => {
    for (const b of BLVCK_BIKES) {
      const groups = richTextGroups(blvckDescription(b, lang))
      const tables = groups.filter((g) => g.kind === 'dl')
      if (b.tiers) {
        expect(tables, b.slug).toHaveLength(1)
        expect(tables[0].kind === 'dl' && tables[0].rows.map((r) => r[0])).toEqual([...BLVCK_COPY[lang].tierLabels])
        expect(groups.filter((g) => g.kind === 'h')).toHaveLength(4)
      } else {
        expect(tables, b.slug).toHaveLength(0)
        expect(groups.filter((g) => g.kind === 'h')).toHaveLength(3)
      }
      expect(groups.filter((g) => g.kind === 'ul').length).toBe(3)
      // Nothing fell through to one run-on paragraph: the intro is the only paragraph.
      expect(groups.filter((g) => g.kind === 'p')).toHaveLength(1)
    }
  })

  it.each(ALL_LANGS)('%s: every price in its table is the class table price', (lang) => {
    const text = blvckDescription(bike('honda-vario'), lang)
    for (const p of [300_000, 250_000, 200_000, 180_000, 3_000_000, 5_000_000]) expect(text).toContain(blvckMoney(p, lang))
  })

  it.each(ALL_LANGS)('%s: passes the publish guard, so an admin editing the listing is not refused', (lang) => {
    for (const b of BLVCK_BIKES) expect(() => assertCleanTexts([blvckTitle(b, lang), blvckDescription(b, lang)])).not.toThrow()
  })

  it.each(ALL_LANGS)('%s: no phone, email, street or link of the partner', (lang) => {
    for (const b of BLVCK_BIKES) {
      const text = `${blvckTitle(b, lang)}\n${blvckDescription(b, lang)}`
      expect(text).not.toMatch(/0902|gmail|Pasteur|thuexemay|https?:/i)
    }
  })

  it.each(ALL_LANGS.filter((l) => l !== 'en'))('%s is its own text, not the English copy', (lang) => {
    const en = new Set(STRINGS_OF_COPY('en'))
    for (const s of STRINGS_OF_COPY(lang)) expect(en.has(s), s).toBe(false)
  })

  it('the conditions of the class tables are not claimed for the big bikes, which have no class table', () => {
    for (const lang of ALL_LANGS) {
      const c = BLVCK_COPY[lang]
      const text = blvckDescription(bike('bmw-s1000rr'), lang)
      for (const s of [c.noDeposit, c.foreigners, c.deliveryFree, c.helmetsOil, c.support]) expect(text).not.toContain(s)
      expect(text).toContain(c.bigLicence)
    }
  })
})

describe('stageBlvckBike', () => {
  it('writes the facets the hub and the filters read', () => {
    const scooter = stageBlvckBike(bike('honda-vision'))
    expect(JSON.parse(scooter.attributes)).toEqual({ rentalPeriod: 'daily', transmission: 'automatic' })
    expect(scooter.facetTokens).toBe('|rentalPeriod:daily|rentalPeriod:monthly|')
    expect(scooter.subcategorySlug).toBe('motorbike-rental')
    expect(scooter.listingType).toBe('rent')
    expect(JSON.parse(stageBlvckBike(bike('honda-wave-alpha')).attributes).transmission).toBe('manual')
    expect(stageBlvckBike(bike('bmw-s1000rr')).facetTokens).toBe('|rentalPeriod:daily|')
  })

  it('prints money as the site does: dots in Vietnamese', () => {
    expect(blvckDescription(bike('honda-vision'), 'vi')).toContain('Từ 1 đến 2 ngày: 150.000 đ/ngày')
    expect(blvckDescription(bike('honda-vision'), 'en')).toContain('Rent 1-2 days: 150,000 đ/day')
  })

  it('corrects their spelling of the Sirius in the title, and keeps it findable', () => {
    expect(stageBlvckBike(bike('yamaha-surius')).title).toContain('Yamaha Sirius')
    expect(stageBlvckBike(bike('yamaha-surius')).externalId).toBe('blvck:yamaha-surius')
  })

  it('keeps the rows in HCMC, as the hub asks', () => {
    for (const b of BLVCK_BIKES) expect(stageBlvckBike(b).city).toContain('Hồ Chí Minh')
  })
})

describe('blvckTranslations', () => {
  it('gives every bike a title and a description in each language without a column, keyed by the English source', () => {
    const rows = blvckTranslations(bike('honda-vision'))
    expect(rows).toHaveLength(BLVCK_CACHED_LANGS.length * 2)
    const en = stageBlvckBike(bike('honda-vision'))
    for (const l of BLVCK_CACHED_LANGS) {
      expect(rows.find((r) => r.target === l && r.source === en.title)?.value).toBe(blvckTitle(bike('honda-vision'), l))
      expect(rows.find((r) => r.target === l && r.source === en.description)?.value).toBe(blvckDescription(bike('honda-vision'), l))
    }
  })
})

describe('blvckFeedProblem', () => {
  const ok = { slug: 'honda-vision', isInStock: true, price: 150_000, photos: ['a', 'b', 'c'].map((x) => `https://thuexemaysaigon.vn/wp-content/uploads/2024/05/${x}.jpg`) }
  it('passes a bike whose feed agrees with the table', () => expect(blvckFeedProblem(bike('honda-vision'), ok)).toBeNull())
  it('stops on a moved price', () => expect(blvckFeedProblem(bike('honda-vision'), { ...ok, price: 160_000 })).toMatch(/re-read the tables/))
  it('takes a 0 only for a bike with no class table', () => {
    expect(blvckFeedProblem(bike('honda-vision'), { ...ok, price: 0 })).toMatch(/re-read the tables/)
    expect(blvckFeedProblem(bike('bmw-s1000rr'), { ...ok, price: 0 })).toBeNull()
  })
  it('stops on a missing bike, no stock, too few photos, a foreign photo', () => {
    expect(blvckFeedProblem(bike('honda-vision'), undefined)).toMatch(/not in the partner/)
    expect(blvckFeedProblem(bike('honda-vision'), { ...ok, isInStock: false })).toMatch(/out of stock/)
    expect(blvckFeedProblem(bike('honda-vision'), { ...ok, photos: ok.photos.slice(0, 2) })).toMatch(/photos/)
    expect(blvckFeedProblem(bike('honda-vision'), { ...ok, photos: [...ok.photos, 'https://evil.example/x.jpg'] })).toMatch(/outside/)
  })
})

describe('blvckSellerRefusal', () => {
  const seller: BlvckSeller = { id: 's', ownerId: 'o', ownerEmail: BLVCK_EMAIL, officialPartner: true, trustScore: 60, location: null }
  it('takes the partner storefront', () => expect(blvckSellerRefusal(seller)).toBeNull())
  it('refuses no storefront, no owner, another owner, or one not chat-only yet', () => {
    expect(blvckSellerRefusal(null)).toMatch(/register it first/)
    expect(blvckSellerRefusal({ ...seller, ownerId: null })).toMatch(/no owning account/)
    expect(blvckSellerRefusal({ ...seller, ownerEmail: 'someone@else.vn' })).toMatch(/owned by/)
    expect(blvckSellerRefusal({ ...seller, officialPartner: false })).toMatch(/official partner/)
  })
})
