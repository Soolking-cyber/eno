import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  askableFacetsFor,
  categoryDescriptionFor,
  MARKETPLACE_CATEGORY_DESCRIPTIONS,
  TAXONOMY,
  visaProductKeyAllowed,
  withoutDisallowedVisaAttrs,
  isPostableSubcategory,
  MARKETPLACE_SUBCAT_LABELS,
  postableSubcategoriesFor,
  subcategoriesFor,
  VISA_CATEGORY_SLUG,
  VISA_SUBCATEGORY_SLUG,
} from './taxonomy'

// O-34 (owner, 2026-09-30): the marketplace edition's POST picker stops offering "Visa runs".
// Browse keeps it (subcategoriesFor is untouched) and eno.forum keeps offering it.

const slugs = (xs: { slug: string }[]) => xs.map((s) => s.slug)

describe('post picker — visa runs on the marketplace edition', () => {
  it('drops tickets-travel/visa-runs from the marketplace picker', () => {
    expect(slugs(postableSubcategoriesFor('tickets-travel', null, true))).not.toContain('visa-runs')
    expect(isPostableSubcategory('tickets-travel', 'visa-runs', true)).toBe(false)
  })

  it('keeps every other travel subcategory, in taxonomy order', () => {
    const all = slugs(subcategoriesFor('tickets-travel'))
    expect(slugs(postableSubcategoriesFor('tickets-travel', null, true))).toEqual(all.filter((s) => s !== 'visa-runs'))
  })

  it('still offers it on the services edition (eno.forum)', () => {
    expect(slugs(postableSubcategoriesFor('tickets-travel', null, false))).toContain('visa-runs')
    expect(isPostableSubcategory('tickets-travel', 'visa-runs', false)).toBe(true)
  })

  it('keeps the value an EDITED listing already has (the wizard passes keep only when editing)', () => {
    expect(slugs(postableSubcategoriesFor('tickets-travel', 'visa-runs', true))).toContain('visa-runs')
  })

  it('leaves browse taxonomy untouched', () => {
    expect(slugs(subcategoriesFor('tickets-travel'))).toContain('visa-runs')
  })

  it('does not hide services/visa-legal (VietKite / GMBR) or anything outside travel', () => {
    expect(isPostableSubcategory(VISA_CATEGORY_SLUG, VISA_SUBCATEGORY_SLUG, true)).toBe(true)
    expect(slugs(postableSubcategoriesFor(VISA_CATEGORY_SLUG, null, true))).toEqual(slugs(subcategoriesFor(VISA_CATEGORY_SLUG)))
    for (const cat of ['electronics', 'vehicles', 'rentals']) {
      expect(postableSubcategoriesFor(cat, null, true)).toEqual(subcategoriesFor(cat))
    }
  })
})

// O-34, the visa-legal half: the marketplace edition NAMES services/visa-legal "Legal & permits" and
// does not ask an ordinary seller's NEW post for e-visa product chips. The slug, browse, search and
// VietKite's listings are untouched (VietKite's visa results on eno.vn are intended — owner 2026-08-13).
describe('services/visa-legal on the marketplace edition', () => {
  const visaLegal = (marketplace: boolean) => postableSubcategoriesFor(VISA_CATEGORY_SLUG, null, marketplace).find((s) => s.slug === VISA_SUBCATEGORY_SLUG)
  const keys = (opts: Parameters<typeof askableFacetsFor>[2]) => askableFacetsFor(VISA_CATEGORY_SLUG, VISA_SUBCATEGORY_SLUG, opts).map((f) => f.key)

  it('is named "Legal & permits" / "Giấy tờ & pháp lý" on eno.vn, "Visa" on eno.forum — same slug', () => {
    expect(visaLegal(true)).toMatchObject({ slug: 'visa-legal', name: 'Legal & permits', nameVi: 'Giấy tờ & pháp lý' })
    expect(visaLegal(false)).toMatchObject({ slug: 'visa-legal', name: 'Visa', nameVi: 'Visa' })
    expect(MARKETPLACE_SUBCAT_LABELS['services/visa-legal']).toEqual({ name: 'Legal & permits', nameVi: 'Giấy tờ & pháp lý' })
  })

  // ⚠️ EVERY DISPLAY, NOT ONLY THE PICKER. Browse chips, breadcrumbs, the PDP and /api/categories all
  // read the name from TAXONOMY (subcategoriesFor), so a MARKETPLACE BUILD must carry it there. The
  // suite runs as the services edition, so the module is re-imported under the marketplace flag.
  describe('on a marketplace build, the taxonomy itself', () => {
    afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
    it('names it "Legal & permits" everywhere it is read, and keeps the slug and the `visa` keyword', async () => {
      vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
      vi.resetModules()
      const tx = await import('./taxonomy')
      const sub = tx.subcategoriesFor(VISA_CATEGORY_SLUG).find((s) => s.slug === VISA_SUBCATEGORY_SLUG)
      expect(sub).toMatchObject({ slug: 'visa-legal', name: 'Legal & permits', nameVi: 'Giấy tờ & pháp lý' })
      expect(sub?.keywords).toContain('visa')
      expect(tx.SUBCATEGORIES[VISA_CATEGORY_SLUG].find((s) => s.slug === VISA_SUBCATEGORY_SLUG)?.name).toBe('Legal & permits')
    })
  })

  it('keeps the `visa` search keyword (VietKite stays findable)', () => {
    expect(visaLegal(true)?.keywords).toContain('visa')
  })

  it('drops visaEntryType + visaSpeed for a NEW post by a NON-partner on eno.vn', () => {
    const k = keys({ newPost: true, officialPartner: false, marketplace: true })
    expect(k).not.toContain('visaEntryType')
    expect(k).not.toContain('visaSpeed')
  })

  it('keeps them for an official partner, on an edit of a listing that carries them, on eno.forum, and when the caller says nothing', () => {
    for (const opts of [
      { newPost: true, officialPartner: true, marketplace: true },
      { newPost: false, officialPartner: true, marketplace: true },
      { newPost: false, officialPartner: false, marketplace: true, existing: { visaEntryType: 'single', visaSpeed: '1H' } },
      { newPost: true, officialPartner: false, marketplace: false },
      { newPost: true, officialPartner: true, marketplace: false },
      { marketplace: true },
    ]) {
      expect(keys(opts), JSON.stringify(opts)).toEqual(expect.arrayContaining(['visaEntryType', 'visaSpeed']))
    }
  })

  it('⛔ an EDIT by a non-partner keeps only the chips the listing already carries — it cannot add one', () => {
    expect(keys({ newPost: false, officialPartner: false, marketplace: true })).not.toEqual(expect.arrayContaining(['visaEntryType']))
    const one = keys({ newPost: false, officialPartner: false, marketplace: true, existing: { visaEntryType: 'single' } })
    expect(one).toContain('visaEntryType')
    expect(one).not.toContain('visaSpeed')
    // A NEW post ignores `existing` — a restored draft is not a listing that carries anything.
    expect(keys({ newPost: true, officialPartner: false, marketplace: true, existing: { visaEntryType: 'single' } })).not.toContain('visaEntryType')
  })

  it('touches no other subcategory or facet', () => {
    expect(askableFacetsFor('electronics', 'phones', { newPost: true, marketplace: true })).toEqual(askableFacetsFor('electronics', 'phones'))
    const other = postableSubcategoriesFor(VISA_CATEGORY_SLUG, null, true).filter((s) => s.slug !== VISA_SUBCATEGORY_SLUG)
    expect(other).toEqual(subcategoriesFor(VISA_CATEGORY_SLUG).filter((s) => s.slug !== VISA_SUBCATEGORY_SLUG))
  })
})

// The ONE rule the wizard and the server both apply (core/listings.ts create + update): see
// listings.sell-rules.test.ts for it against the real createListingCore / updateListingCore.
describe('visaProductKeyAllowed / withoutDisallowedVisaAttrs — O-34, server and form alike', () => {
  const json = JSON.stringify({ visaEntryType: 'single', visaSpeed: '1H', serviceLocation: 'online' })

  it('strips both for an ordinary seller on eno.vn, and nothing else', () => {
    expect(JSON.parse(withoutDisallowedVisaAttrs(json, { officialPartner: false, marketplace: true })!)).toEqual({ serviceLocation: 'online' })
    expect(withoutDisallowedVisaAttrs(JSON.stringify({ visaSpeed: '1H' }), { marketplace: true })).toBeNull()
  })

  it('returns the SAME string when nothing is dropped — partner, eno.forum, no visa keys', () => {
    expect(withoutDisallowedVisaAttrs(json, { officialPartner: true, marketplace: true })).toBe(json)
    expect(withoutDisallowedVisaAttrs(json, { officialPartner: false, marketplace: false })).toBe(json)
    const plain = JSON.stringify({ serviceLocation: 'online' })
    expect(withoutDisallowedVisaAttrs(plain, { marketplace: true })).toBe(plain)
    expect(withoutDisallowedVisaAttrs(null, { marketplace: true })).toBeNull()
  })

  it('keeps a key the stored row already carries (string or object), never one it does not', () => {
    const kept = withoutDisallowedVisaAttrs(json, { marketplace: true, existing: '{"visaEntryType":"multiple"}' })
    expect(JSON.parse(kept!)).toEqual({ visaEntryType: 'single', serviceLocation: 'online' })
    expect(visaProductKeyAllowed('visaSpeed', { marketplace: true, existing: { visaSpeed: '' } })).toBe(false)
    expect(visaProductKeyAllowed('serviceLocation', { marketplace: true })).toBe(true)
  })
})

describe('category descriptions — the marketplace says no "visa" in its chrome (O-34)', () => {
  const canonical = (slug: string) => TAXONOMY.find((c) => c.slug === slug)!.description

  it('eno.vn reads its own wording for services and tickets-travel; eno.forum the canonical one', () => {
    for (const slug of ['services', 'tickets-travel']) {
      expect(canonical(slug), slug).toMatch(/visa/i) // the canonical text, unchanged (eno.forum)
      expect(categoryDescriptionFor(slug, canonical(slug), true), slug).not.toMatch(/visa/i)
      expect(categoryDescriptionFor(slug, canonical(slug), true)).toBe(MARKETPLACE_CATEGORY_DESCRIPTIONS[slug])
      expect(categoryDescriptionFor(slug, canonical(slug), false)).toBe(canonical(slug))
    }
  })

  it('every other category reads its stored description on both editions', () => {
    expect(categoryDescriptionFor('electronics', 'Phones and laptops.', true)).toBe('Phones and laptops.')
    expect(categoryDescriptionFor('electronics', null, true)).toBeNull()
  })
})

// The wizard's condition chips now render the facet's own options (sell-09) instead of a hardcoded
// new/used pair — so the VALUES must stay exactly the two the stored column, the filters and the
// Merchant/Meta feeds read ('new' / 'used'), in every category that asks the question.
describe('condition — every category offers exactly the stored values new / used', () => {
  it('holds for each category facet keyed `condition`', () => {
    const conditionFacets = TAXONOMY.flatMap((c) => c.facets.filter((f) => f.key === 'condition').map((f) => [c.slug, f] as const))
    expect(conditionFacets.length).toBeGreaterThan(5)
    for (const [slug, f] of conditionFacets) expect(f.options.map((o) => o.value), slug).toEqual(['new', 'used'])
  })
})
