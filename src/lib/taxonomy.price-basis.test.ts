import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { askableFacetsFor, facetsFor, isRequiredFacet, listingMoneyFor, servicePriceBasisApplies, servicePriceBasisOf, servicePriceBasisOfUnit } from './taxonomy'
import { FEED_EXCLUDED_PRICE_UNITS } from './product-feed'

/**
 * HOW A SERVICE IS CHARGED (owner, 2026-10-14: "service price if its hourly or one time payment"). The services ›
 * Pricing facet stamps the unit: 'hourly' → 'VND/hour' (rendered "/ giờ" by <Price>, HUR in JSON-LD), anything else the
 * service unit. Not asked where the price is a product's (e-Visa, eSIM); required in the wizard; absent = one-time.
 */
describe('services › Pricing (priceBasis)', () => {
  it('is asked on every service aisle but e-Visa and eSIM, and required there (a provider says which)', () => {
    for (const sub of [null, 'cleaning', 'childcare', 'pet-services', 'repair', 'legal-permits', 'service-other']) {
      const f = askableFacetsFor('services', sub).find((x) => x.key === 'priceBasis')
      expect(f, String(sub)).toBeDefined()
      expect(isRequiredFacet(f!)).toBe(true)
      expect(f!.options.map((o) => [o.value, o.label, o.labelVi])).toEqual([['hourly', 'Hourly', 'Theo giờ'], ['one-time', 'One-time', 'Trọn gói']])
    }
    for (const sub of ['visa-legal', 'esim']) expect(facetsFor('services', sub).some((x) => x.key === 'priceBasis'), sub).toBe(false)
    expect(facetsFor('electronics', null).some((x) => x.key === 'priceBasis')).toBe(false)
  })

  it('reads the basis from a stored JSON string or a posted object; anything else is no answer', () => {
    expect(servicePriceBasisOf('{"priceBasis":"hourly"}')).toBe('hourly')
    expect(servicePriceBasisOf({ priceBasis: 'one-time' })).toBe('one-time')
    for (const junk of [null, undefined, '', '{not json', { priceBasis: 'daily' }, { priceBasis: 7 }, []]) expect(servicePriceBasisOf(junk)).toBeNull()
    expect(servicePriceBasisApplies('services', 'cleaning')).toBe(true)
    expect(servicePriceBasisApplies('services', 'esim')).toBe(false)
  })

  it('stamps VND/hour for an hourly service or services Wanted; one-time and unanswered keep the old units', () => {
    const unit = (listingType: string, priceBasis: 'hourly' | 'one-time' | null, subcategorySlug: string | null = 'cleaning', categorySlug = 'services') =>
      listingMoneyFor({ categorySlug, subcategorySlug, listingType, priceBasis }).priceUnit
    expect(unit('service', 'hourly')).toBe('VND/hour')
    expect(unit('wanted', 'hourly')).toBe('VND/hour')
    expect(unit('service', 'one-time')).toBe('VND/service')
    expect(unit('service', null)).toBe('VND/service')
    expect(unit('wanted', null)).toBe('VND')
    expect(unit('service', 'hourly', null)).toBe('VND/hour') // no subcategory picked: the facet applies
  })

  it('⛔ a stray hourly answer never makes a product price a rate — e-Visa, eSIM, another category', () => {
    for (const sub of ['visa-legal', 'esim']) expect(listingMoneyFor({ categorySlug: 'services', subcategorySlug: sub, listingType: 'service', priceBasis: 'hourly' }).priceUnit, sub).toBe('VND/service')
    expect(listingMoneyFor({ categorySlug: 'electronics', subcategorySlug: null, listingType: 'sell', priceBasis: 'hourly' }).priceUnit).toBe('VND')
    expect(listingMoneyFor({ categorySlug: 'rentals', subcategorySlug: 'motorbike-rental', listingType: 'rent', rentalPeriod: 'daily', priceBasis: 'hourly' }).priceUnit).toBe('VND/day')
  })

  it('the wizard opens an edit on what the stored unit says', () => {
    expect(servicePriceBasisOfUnit('VND/hour')).toBe('hourly')
    for (const u of ['VND/service', 'VND', '', null, undefined]) expect(servicePriceBasisOfUnit(u)).toBe('one-time')
  })
})

describe('the unit wherever a service price is printed', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

  it('ad catalogues carry no rate — an hourly service is not a product price (eno.forum feeds)', () => {
    expect(FEED_EXCLUDED_PRICE_UNITS).toEqual(expect.arrayContaining(['VND/hour', 'VND/day', 'VND/week', 'VND/month']))
    for (const route of ['src/app/api/feeds/google-shopping/route.ts', 'src/app/api/feeds/facebook-catalog/route.ts']) {
      expect(src(route), route).toContain('priceUnit: { notIn: [...FEED_EXCLUDED_PRICE_UNITS] },')
    }
  })

  it('the listing page bakes an hourly service’s unit into its title and link preview, like a job’s', () => {
    expect(src('src/app/[lang]/listings/[id]/(pdp)/page.tsx')).toContain(": listing.listingType === 'service' || listing.listingType === 'wanted' ? priceUnitSuffix(listing.priceUnit) : null")
  })

  it('a phone list row keeps any rate’s unit, not only a rent’s', () => {
    expect(src('src/components/marketplace/compact-listing-row.tsx')).toContain("unit={l.listingType === 'rent' || priceUnitSuffix(l.priceUnit) ? true : 'sm'}")
  })
})
