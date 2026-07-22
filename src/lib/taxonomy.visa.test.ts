import { describe, it, expect } from 'vitest'
import {
  facetsFor,
  isRequiredFacet,
  isVisaProductSlot,
  listingMoneyFor,
  subcategoriesFor,
  TAXONOMY,
  VISA_CATEGORY_SLUG,
  VISA_SUBCATEGORY_SLUG,
  type FacetDef,
} from './taxonomy'
import { VISA_ENTRY_TYPES, VISA_SPEED_CODES, VISA_SPEED_SPECS } from './visa/speed'

// The visa shop sells ORDINARY marketplace listings: one product = one entry type at
// one processing speed, priced on Listing.price by whoever posts it. The two product
// parameters therefore have to reach Listing.attributes through the SAME path every
// other facet uses — the post wizard renders facetsFor(category, subcategory) as chips
// and submits `attributes: Object.fromEntries(Object.entries(attrs)...)`.
//
// So the wiring that matters is exactly: does facetsFor('services','visa-legal') return
// these two, and does it return them to NOBODY else? Both halves are asserted below —
// the negative half is what stops a cleaner being asked for an e-visa entry type.

const facet = (subcat: string, key: string): FacetDef | undefined =>
  facetsFor('services', subcat).find((f) => f.key === key)

const values = (f: FacetDef | undefined) => (f?.options ?? []).map((o) => o.value)

describe("facetsFor('services','visa-legal')", () => {
  it('returns visaEntryType as a toggle of exactly single | multiple', () => {
    const f = facet('visa-legal', 'visaEntryType')
    expect(f).toBeDefined()
    expect(f!.kind).toBe('toggle')
    // 90-day is implied — the engine's MAX_EVISA_VALIDITY_DAYS is 90 and models no
    // other window, so any extra option here would be invented product.
    expect(values(f)).toEqual(['single', 'multiple'])
  })

  it('returns visaSpeed as a toggle of the seven tiers in the owner grid order', () => {
    const f = facet('visa-legal', 'visaSpeed')
    expect(f).toBeDefined()
    expect(f!.kind).toBe('toggle')
    expect(values(f)).toEqual(['1H', '2H', '4H', '1D', '2D', '3D', 'normal'])
  })

  it('labels both facets bilingually, including every option', () => {
    for (const key of ['visaEntryType', 'visaSpeed']) {
      const f = facet('visa-legal', key)!
      expect(f.label.length).toBeGreaterThan(0)
      expect(f.labelVi.length).toBeGreaterThan(0)
      // Vietnamese must be actual Vietnamese copy, not the English string echoed.
      expect(f.labelVi).not.toBe(f.label)
      for (const o of f.options) {
        expect(o.label.length).toBeGreaterThan(0)
        expect(o.labelVi.length).toBeGreaterThan(0)
      }
    }
  })

  it('carries no price anywhere — price lives on Listing.price, set by the admin', () => {
    const json = JSON.stringify([facet('visa-legal', 'visaEntryType'), facet('visa-legal', 'visaSpeed')])
    expect(json).not.toMatch(/price|usd|\$\d|\bfee\b/i)
    // and no bare number that could be read as one of the grid's amounts
    for (const amount of [115, 140, 85, 110, 61, 86, 55, 80, 45, 70, 42, 67, 30]) {
      expect(json).not.toContain(String(amount))
    }
  })

  it('still returns the generic Services facets alongside them', () => {
    const keys = facetsFor('services', 'visa-legal').map((f) => f.key)
    expect(keys).toEqual(expect.arrayContaining(['serviceLocation', 'providerType', 'visaEntryType', 'visaSpeed']))
  })
})

describe('scoping — no other subcategory sees the visa facets', () => {
  it("facetsFor('services','cleaning') returns NEITHER", () => {
    const keys = facetsFor('services', 'cleaning').map((f) => f.key)
    expect(keys).not.toContain('visaEntryType')
    expect(keys).not.toContain('visaSpeed')
    // sanity: cleaning still gets the unscoped Services facets, so an empty result
    // can never make this assertion pass by accident.
    expect(keys).toContain('serviceLocation')
  })

  it('no OTHER services subcategory sees them either, and neither does "no subcategory yet"', () => {
    const others = TAXONOMY.find((c) => c.slug === 'services')!
      .subcategories.map((s) => s.slug)
      .filter((s) => s !== 'visa-legal')
    expect(others.length).toBeGreaterThan(5)
    for (const sub of [...others, null, undefined, '']) {
      const keys = facetsFor('services', sub).map((f) => f.key)
      expect(keys, `subcat ${String(sub)}`).not.toContain('visaEntryType')
      expect(keys, `subcat ${String(sub)}`).not.toContain('visaSpeed')
    }
  })

  it('no other CATEGORY declares a visa facet key', () => {
    for (const cat of TAXONOMY) {
      for (const f of cat.facets) {
        if (f.key.startsWith('visa')) expect(cat.slug).toBe('services')
      }
    }
  })
})

// ── (c) ONE source of truth for the tier copy ──────────────────────────────────────
// src/lib/visa/speed.ts owns the seven codes AND their wording; this file's chips are
// built from it. That direction is the load-bearing one: parseVisaSpeedCode() accepts
// exactly VISA_SPEED_CODES, so a value renamed in the catalogue alone would leave every
// already-posted product unresolvable — and unsellable — while still looking fine in the
// wizard. The labels ride along so the buyer's chip and the operator's tier can't drift
// into two different promises ('Normal processing' vs 'Standard' — the actual drift these
// assertions were written for).

describe('speed + entry copy is DERIVED, never restated', () => {
  it('offers exactly the seven codes speed.ts declares, in its order', () => {
    expect(values(facet('visa-legal', 'visaSpeed'))).toEqual([...VISA_SPEED_CODES])
  })

  it('takes every label and labelVi straight from VISA_SPEED_SPECS', () => {
    for (const o of facet('visa-legal', 'visaSpeed')!.options) {
      const spec = VISA_SPEED_SPECS[o.value as keyof typeof VISA_SPEED_SPECS]
      expect(spec, `no spec for ${o.value}`).toBeDefined()
      expect(o.label).toBe(spec.label)
      expect(o.labelVi).toBe(spec.labelVi)
    }
  })

  it('offers exactly the entry types the payload models', () => {
    expect(values(facet('visa-legal', 'visaEntryType'))).toEqual([...VISA_ENTRY_TYPES])
  })

  it('exposes the slot the products live in', () => {
    expect(isVisaProductSlot(VISA_CATEGORY_SLUG, VISA_SUBCATEGORY_SLUG)).toBe(true)
    expect(subcategoriesFor(VISA_CATEGORY_SLUG).some((s) => s.slug === VISA_SUBCATEGORY_SLUG)).toBe(true)
    for (const [cat, sub] of [['services', 'cleaning'], ['electronics', 'visa-legal'], ['services', null]] as const) {
      expect(isVisaProductSlot(cat, sub)).toBe(false)
    }
  })
})

// ── (b) The two chips must NOT tighten the posting gate ────────────────────────────
// The post wizard requires every non-range facet of the chosen subcategory before it will
// publish. services/visa-legal is NOT a visa-products-only subcategory — its keywords are
// visa / work permit / legal / tax / permit / giấy tờ / thuế / pháp lý, and
// suggestSubcategory() files any matching Services listing there — so an unqualified
// requirement would stop an ordinary agent publishing a work-permit listing until they
// chose an e-visa entry type. Owner policy at launch is maximum leniency.

describe('isRequiredFacet — the publish gate', () => {
  it('does not require either visa product chip', () => {
    const required = facetsFor('services', 'visa-legal').filter(isRequiredFacet).map((f) => f.key)
    expect(required).not.toContain('visaEntryType')
    expect(required).not.toContain('visaSpeed')
    // …while the generic Services chips are STILL required — an empty result must not be
    // what makes the two assertions above pass.
    expect(required).toEqual(['serviceLocation', 'providerType'])
  })

  it('leaves every other subcategory\'s gate exactly as it was', () => {
    // The whole taxonomy: the ONLY facets opted out of the gate are the two visa chips
    // (plus range facets, which were never part of it). Anything else going optional is a
    // gate change nobody asked for, and lands here as a failure.
    const optional: string[] = []
    for (const cat of TAXONOMY) {
      for (const f of cat.facets) {
        if (f.optional) optional.push(`${cat.slug}/${f.key}`)
        // A range facet is not "optional" — it is simply not a chip. Keep them honest so
        // the flag can't be used to silently drop a real requirement.
        if (f.kind === 'range') expect(f.optional, `${cat.slug}/${f.key}`).toBeUndefined()
      }
    }
    expect(optional.sort()).toEqual(['services/visaEntryType', 'services/visaSpeed'])
  })

  it('is the OLD rule ("every non-range chip") everywhere but the visa slot', () => {
    // Swept across every category × subcategory: the required set is still literally the
    // pre-change rule, minus the two visa chips in the one subcategory that declares them.
    for (const cat of TAXONOMY) {
      for (const sub of [...cat.subcategories.map((s) => s.slug), null]) {
        const facets = facetsFor(cat.slug, sub)
        const oldRule = facets.filter((f) => f.kind !== 'range').map((f) => f.key)
        const expected = isVisaProductSlot(cat.slug, sub) ? oldRule.filter((k) => !k.startsWith('visa')) : oldRule
        expect(facets.filter(isRequiredFacet).map((f) => f.key), `${cat.slug}/${sub}`).toEqual(expected)
      }
    }
  })
})

// ── (a) A visa product must be PRICEABLE — i.e. stored in USD ──────────────────────
// visa-shop's sellablePriceCents() charges USD cents and refuses any currency that is not
// '$'/'USD', so a product stored in ₫ can never be sold. The currency is derived, never
// picked: there is no currency control anywhere in the app and a client cannot send one.
//
// ⚠️ The seller half is not decoration. The slot is shared with ordinary work-permit and
// tax listings, so "subcategory ⇒ USD" would re-price a Vietnamese agent's ₫1.500.000
// service as $1,500,000 — the 25 000× money bug in the other direction.

describe('listingMoneyFor — USD only for a visa product on the visa storefront', () => {
  const visa = { categorySlug: 'services', subcategorySlug: 'visa-legal', listingType: 'service' }

  it('prices a visa product on the visa storefront in USD', () => {
    expect(listingMoneyFor({ ...visa, visaShopSeller: true })).toEqual({
      currency: '$',
      // Empty: <Price> renders "$115" and would append " / USD" for any non-empty unit.
      priceUnit: '',
      isoCode: 'USD',
    })
  })

  it('leaves an ORDINARY seller in the same subcategory in đồng', () => {
    // The work-permit / tax / legal listings that share services/visa-legal.
    for (const visaShopSeller of [false, undefined]) {
      expect(listingMoneyFor({ ...visa, visaShopSeller })).toEqual({
        currency: '₫',
        priceUnit: 'VND/service (from)',
        isoCode: 'VND',
      })
    }
  })

  it('never prices anything else in USD — not even the visa storefront itself', () => {
    for (const cat of TAXONOMY) {
      for (const sub of [...cat.subcategories.map((s) => s.slug), null]) {
        if (isVisaProductSlot(cat.slug, sub)) continue
        for (const listingType of cat.types) {
          // visaShopSeller: true — the storefront posting a NON-visa listing is still ₫.
          const money = listingMoneyFor({ categorySlug: cat.slug, subcategorySlug: sub, listingType, visaShopSeller: true })
          expect(money.currency, `${cat.slug}/${sub}/${listingType}`).toBe('₫')
          expect(money.isoCode).toBe('VND')
        }
      }
    }
  })

  it('keeps the long-standing VND price units, byte for byte', () => {
    const unit = (listingType: string) => listingMoneyFor({ categorySlug: 'vehicles', subcategorySlug: 'car', listingType }).priceUnit
    expect(unit('rent')).toBe('VND/month')
    expect(unit('job')).toBe('VND/month')
    expect(unit('service')).toBe('VND/service (from)')
    for (const t of ['sell', 'wanted', 'free', 'event', '']) expect(unit(t)).toBe('VND')
    // An absent intent behaves like a plain sale (create resolves one before calling).
    expect(listingMoneyFor({ categorySlug: 'vehicles', subcategorySlug: 'car' }).priceUnit).toBe('VND')
  })
})
