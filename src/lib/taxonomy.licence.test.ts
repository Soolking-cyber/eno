import { describe, expect, it } from 'vitest'
import {
  LICENCE_CHECK_SUBCATEGORIES,
  TAXONOMY,
  VISA_CATEGORY_SLUG,
  VISA_SUBCATEGORY_SLUG,
  attributeBag,
  isLicenceCheckSlot,
  isVisaProductSlot,
  licenceCheckHold,
  subcategoriesFor,
} from './taxonomy'

/**
 * THE LICENCE AISLES (owner, 2026-10-14: "Anyone posts, live after check", then for Legal & permits "Check them too").
 * e-Visa and Legal & permits are both held for eno's licence check unless eno's own desk posts; e-Visa alone is still
 * the slot an e-visa PRODUCT is sold from. The write paths are pinned in core/listings.sell-rules.test.ts, the stamp in
 * licence-stamp.test.ts.
 */

describe('the two licence aisles', () => {
  it('are e-Visa and Legal & permits', () => {
    expect(LICENCE_CHECK_SUBCATEGORIES).toEqual(['visa-legal', 'legal-permits'])
    expect(LICENCE_CHECK_SUBCATEGORIES[0]).toBe(VISA_SUBCATEGORY_SLUG)
  })

  it('exist only under services — what lets the SQL guards ignore the category', () => {
    for (const c of TAXONOMY) {
      const here = c.subcategories.map((s) => s.slug).filter((s) => (LICENCE_CHECK_SUBCATEGORIES as readonly string[]).includes(s))
      expect(here, c.slug).toEqual(c.slug === VISA_CATEGORY_SLUG ? [...LICENCE_CHECK_SUBCATEGORIES] : [])
    }
  })

  it('isLicenceCheckSlot holds for both aisles and nothing else', () => {
    for (const sub of LICENCE_CHECK_SUBCATEGORIES) expect(isLicenceCheckSlot(VISA_CATEGORY_SLUG, sub), sub).toBe(true)
    for (const s of subcategoriesFor(VISA_CATEGORY_SLUG)) {
      if (!(LICENCE_CHECK_SUBCATEGORIES as readonly string[]).includes(s.slug)) expect(isLicenceCheckSlot(VISA_CATEGORY_SLUG, s.slug), s.slug).toBe(false)
    }
    for (const sub of [null, undefined, '']) expect(isLicenceCheckSlot(VISA_CATEGORY_SLUG, sub), String(sub)).toBe(false)
    for (const c of TAXONOMY.filter((x) => x.slug !== VISA_CATEGORY_SLUG)) {
      for (const sub of LICENCE_CHECK_SUBCATEGORIES) expect(isLicenceCheckSlot(c.slug, sub), `${c.slug}/${sub}`).toBe(false)
    }
  })

  it('licenceCheckHold holds both aisles for anyone but eno’s own desk', () => {
    for (const sub of LICENCE_CHECK_SUBCATEGORIES) {
      expect(licenceCheckHold(VISA_CATEGORY_SLUG, sub, { desk: false }), sub).toBe(true)
      expect(licenceCheckHold(VISA_CATEGORY_SLUG, sub, { desk: true }), sub).toBe(false)
    }
    for (const sub of ['service-other', 'cleaning', 'esim', null]) expect(licenceCheckHold(VISA_CATEGORY_SLUG, sub, { desk: false }), String(sub)).toBe(false)
    expect(licenceCheckHold('electronics', 'legal-permits', { desk: false })).toBe(false)
  })

  it('isVisaProductSlot is still e-Visa only', () => {
    expect(isVisaProductSlot(VISA_CATEGORY_SLUG, 'visa-legal')).toBe(true)
    expect(isVisaProductSlot(VISA_CATEGORY_SLUG, 'legal-permits')).toBe(false)
    expect(isVisaProductSlot('electronics', 'visa-legal')).toBe(false)
  })
})

describe('attributeBag (exported for provider-licence.ts)', () => {
  it('reads a stored JSON string or an object; null for anything else', () => {
    expect(attributeBag('{"a":"1"}')).toEqual({ a: '1' })
    const obj = { a: '1' }
    expect(attributeBag(obj)).toBe(obj)
    for (const junk of [null, undefined, '', '{not json', '[1]', ['a'], 7, 'plain']) expect(attributeBag(junk), String(junk)).toBeNull()
  })
})
