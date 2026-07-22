import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { listingMoneyFor, TAXONOMY, isVisaProductSlot, VISA_CATEGORY_SLUG, VISA_SUBCATEGORY_SLUG } from '../taxonomy'

/**
 * ⚠️ EVERY LISTING ON eno IS STORED IN ĐỒNG — INCLUDING E-VISA PRODUCTS.
 *
 * The owner's rule (2026-07-22): the visa admin prices a product in VND on an ordinary
 * marketplace listing, exactly like every other seller. Buyers see the VND price AND its
 * USD equivalent, and a PayPal buyer is charged a SERVER-ISSUED quote of that VND amount.
 * The dollars are therefore a display + checkout concern; they are never a stored listing
 * currency. A short-lived rule that stored services/visa-legal rows posted by the visa
 * storefront as '$' (f7f8ca40) is reverted, and this file is the fence that keeps it out.
 *
 * Two halves, because the write path has two halves:
 *   · CREATE stamps the currency  → proven on listingMoneyFor, the function it stamps from.
 *   · UPDATE must never re-stamp it → proven as an ABSENCE in the update path's source.
 * createListingCore/updateListingCore themselves need a live Postgres (they screen content,
 * resolve brands, check duplicates and write rows), so they cannot be called from this
 * suite; the source assertions below are how the update half is held. Reading source in a
 * test is an established pattern here — src/lib/sync-pairs.test.ts byte-compares files.
 */

const SRC = readFileSync(fileURLToPath(new URL('./listings.ts', import.meta.url)), 'utf8')

/** The body of one top-level exported function, from its signature to the next one. */
function bodyOf(name: string): string {
  const start = SRC.indexOf(`export async function ${name}`)
  expect(start, `${name} not found — the test's anchors are stale`).toBeGreaterThan(-1)
  const rest = SRC.slice(start + 1)
  const next = rest.search(/\nexport (async )?function /)
  return next === -1 ? rest : rest.slice(0, next)
}

describe('listingMoneyFor — ₫ for EVERY category × subcategory × intent', () => {
  it('prices a visa-legal service listing in đồng', () => {
    expect(listingMoneyFor({ categorySlug: VISA_CATEGORY_SLUG, subcategorySlug: VISA_SUBCATEGORY_SLUG, listingType: 'service' })).toEqual({
      currency: '₫',
      priceUnit: 'VND/service',
      isoCode: 'VND',
    })
  })

  it('sweeps the whole taxonomy and finds no other currency anywhere', () => {
    let combos = 0
    let visaSlots = 0
    for (const cat of TAXONOMY) {
      for (const sub of [...cat.subcategories.map((s) => s.slug), null]) {
        if (isVisaProductSlot(cat.slug, sub)) visaSlots++
        for (const listingType of [...cat.types, null]) {
          const money = listingMoneyFor({ categorySlug: cat.slug, subcategorySlug: sub, listingType })
          expect(money.currency, `${cat.slug}/${sub}/${listingType}`).toBe('₫')
          expect(money.isoCode, `${cat.slug}/${sub}/${listingType}`).toBe('VND')
          // The unit may vary with intent, but it is always a đồng unit.
          expect(money.priceUnit, `${cat.slug}/${sub}/${listingType}`).toMatch(/^VND/)
          combos++
        }
      }
    }
    // Guard the guard: an empty taxonomy would pass every assertion above vacuously, and
    // the visa slot has to be one of the combinations actually swept.
    // 379 when written; 292 after the 'wanted' listing type was retired the same day
    // (owner: "too broad not practical"), which removed one intent from nine categories.
    // The floor is a vacuity guard, not a census — keep it well under the real number so a
    // legitimate taxonomy edit does not read as a failure, but high enough that an empty or
    // collapsed sweep still fails loudly.
    expect(combos).toBeGreaterThan(250)
    expect(visaSlots).toBe(1)
  })

  it('ignores a stray seller flag — no seller buys an exception', () => {
    // The old rule keyed off `visaShopSeller`. The property is gone from the contract, so
    // this passes it the only way a caller still could: through an untyped bag.
    const withStaleFlag = {
      categorySlug: VISA_CATEGORY_SLUG,
      subcategorySlug: VISA_SUBCATEGORY_SLUG,
      listingType: 'service',
      visaShopSeller: true,
    } as Parameters<typeof listingMoneyFor>[0]
    expect(listingMoneyFor(withStaleFlag).currency).toBe('₫')
    expect(listingMoneyFor(withStaleFlag).isoCode).toBe('VND')
  })

  it('keeps the long-standing VND price units, byte for byte', () => {
    const unit = (listingType: string) => listingMoneyFor({ categorySlug: 'vehicles', subcategorySlug: 'car', listingType }).priceUnit
    expect(unit('rent')).toBe('VND/month')
    expect(unit('job')).toBe('VND/month')
    expect(unit('service')).toBe('VND/service')
    for (const t of ['sell', 'wanted', 'free', 'event', '']) expect(unit(t)).toBe('VND')
    expect(listingMoneyFor({ categorySlug: 'vehicles', subcategorySlug: 'car' }).priceUnit).toBe('VND')
  })
})

describe('createListingCore — stamps ₫, and can stamp nothing else', () => {
  const create = bodyOf('createListingCore')

  it('takes the currency from listingMoneyFor, which is typed to the literal ₫', () => {
    expect(create).toMatch(/const money = listingMoneyFor\(/)
    expect(create).toMatch(/^\s*currency: money\.currency,$/m)
    // ListingMoney.currency is `'₫'` (not a union), so tsc — not this assertion — is what
    // makes the line above unconditional. This just proves the line is still wired.
  })

  it('names no other currency symbol or code', () => {
    expect(create).not.toContain("'$'")
    expect(create).not.toContain('USD')
  })

  it('reports the same currency to Meta CAPI as it stored', () => {
    expect(create).toMatch(/currency: money\.isoCode/)
  })
})

describe('updateListingCore — never touches the currency', () => {
  const update = bodyOf('updateListingCore')

  it('writes neither `currency` nor `priceUnit` on an edit', () => {
    // An edit re-stamping the currency was exactly the reverted rule. The update path's
    // `data` object is what reaches prisma; it must never gain either key.
    expect(update).not.toMatch(/data\.currency/)
    expect(update).not.toMatch(/data\.priceUnit/)
    expect(update).not.toMatch(/^\s*currency:/m)
    expect(update).not.toMatch(/^\s*priceUnit:/m)
  })

  it('mentions no foreign currency at all', () => {
    expect(update).not.toContain("'$'")
    expect(update).not.toContain('USD')
  })
})

describe('the write path has no storefront-specific money rule left', () => {
  it('does not resolve the visa storefront to decide a currency', () => {
    expect(SRC).not.toContain('getVisaShopSeller')
    expect(SRC).not.toContain('visa-shop')
    expect(SRC).not.toContain('storedMoneyFor')
  })
})
