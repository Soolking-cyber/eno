import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  askableFacetsFor,
  categoryDescriptionFor,
  facetsFor,
  isVisaProductSlot,
  licenceCheckHold,
  MARKETPLACE_CATEGORY_DESCRIPTIONS,
  SUBCATEGORY_FALLBACK,
  TEACHER_PROFILE_REFUSAL,
  isTeacherSeekingPost,
  TAXONOMY,
  isPostableSubcategory,
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

  it('offers every services aisle — the e-Visa subcategory included — on both editions, and nothing else changes', () => {
    for (const marketplace of [true, false]) {
      expect(slugs(postableSubcategoriesFor(VISA_CATEGORY_SLUG, null, marketplace)), String(marketplace)).toEqual(slugs(subcategoriesFor(VISA_CATEGORY_SLUG)))
      expect(isPostableSubcategory(VISA_CATEGORY_SLUG, VISA_SUBCATEGORY_SLUG, marketplace)).toBe(true)
    }
    for (const cat of ['electronics', 'vehicles', 'rentals']) {
      expect(postableSubcategoriesFor(cat, null, true)).toEqual(subcategoriesFor(cat))
    }
  })
})

// ⛔ THE e-VISA SUBCATEGORY (owner, 2026-10-14: "also have an evisa dedicated subcategory", then "Anyone posts, live
// after check"). One name on both editions, open to every poster, a licence check before anyone but eno's desk goes
// live (taxonomy.ts licenceCheckHold; the write paths are pinned in core/listings.sell-rules.test.ts). Retires O-34's
// eno.vn name ("Legal & permits") and O-34b's partner-only posting. Work permits, tax and legal have their own aisle —
// a licence aisle too ("Check them too"; taxonomy.licence.test.ts).
describe('the e-Visa subcategory (2026-10-14)', () => {
  const visa = () => subcategoriesFor(VISA_CATEGORY_SLUG).find((s) => s.slug === VISA_SUBCATEGORY_SLUG)!
  const legal = () => subcategoriesFor(VISA_CATEGORY_SLUG).find((s) => s.slug === 'legal-permits')!

  it('keeps its slug and is named "e-Visa" / "Visa điện tử", with visa keywords only', () => {
    expect(visa()).toMatchObject({ slug: 'visa-legal', name: 'e-Visa', nameVi: 'Visa điện tử' })
    expect(isVisaProductSlot(VISA_CATEGORY_SLUG, VISA_SUBCATEGORY_SLUG)).toBe(true)
    expect(visa().keywords).toEqual(expect.arrayContaining(['visa', 'e-visa', 'evisa', 'thị thực', 'visa điện tử']))
    for (const k of ['work permit', 'legal', 'tax', 'permit', 'giấy tờ', 'thuế', 'pháp lý']) expect(visa().keywords, k).not.toContain(k)
  })

  // ⚠️ EVERY DISPLAY, NOT ONLY THE PICKER: browse chips, breadcrumbs, the PDP and /api/categories read the name from
  // TAXONOMY. The suite runs as the services edition, so the module is re-imported under the marketplace flag.
  describe('on a marketplace build, the taxonomy itself', () => {
    afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
    it('names it "e-Visa" too — no edition relabel is left', async () => {
      vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
      vi.resetModules()
      const tx = await import('./taxonomy')
      expect(tx.subcategoriesFor(VISA_CATEGORY_SLUG).find((s) => s.slug === VISA_SUBCATEGORY_SLUG)).toMatchObject({ name: 'e-Visa', nameVi: 'Visa điện tử' })
      expect(tx.SUBCATEGORIES[VISA_CATEGORY_SLUG].find((s) => s.slug === 'legal-permits')?.name).toBe('Legal & permits')
    })
  })

  it('Legal & permits sits right after it, holds specific legal phrases (no bare legal/tax/permit), and asks no location chip', () => {
    const order = slugs(subcategoriesFor(VISA_CATEGORY_SLUG))
    expect(order.indexOf('legal-permits')).toBe(order.indexOf(VISA_SUBCATEGORY_SLUG) + 1)
    expect(legal()).toMatchObject({ name: 'Legal & permits', nameVi: 'Giấy tờ & pháp lý', icon: 'ClipboardList' })
    expect(legal().keywords).toEqual(expect.arrayContaining(['work permit', 'residence card', 'trc', 'giấy phép lao động', 'thẻ tạm trú', 'luật sư', 'dịch vụ pháp lý']))
    // A guess here asks for a licence (R3), so no bare word that ordinary services use (commit gate, 2026-10-14).
    for (const k of ['legal', 'tax', 'permit', 'giấy tờ', 'thuế', 'pháp lý']) expect(legal().keywords, k).not.toContain(k)
    expect(isVisaProductSlot(VISA_CATEGORY_SLUG, 'legal-permits')).toBe(false)
    expect(facetsFor(VISA_CATEGORY_SLUG, 'legal-permits').map((f) => f.key)).not.toContain('serviceLocation')
  })

  // Legal & permits is a licence aisle too since 2026-10-14 (owner: "Check them too") — held for non-desk posters.
  it('holds a listing in e-Visa AND Legal & permits for the licence check unless the poster is eno’s own desk — an official partner waits too', () => {
    for (const sub of [VISA_SUBCATEGORY_SLUG, 'legal-permits']) {
      expect(licenceCheckHold(VISA_CATEGORY_SLUG, sub, { desk: false }), sub).toBe(true)
      expect(licenceCheckHold(VISA_CATEGORY_SLUG, sub, { desk: true }), sub).toBe(false)
    }
    for (const sub of ['service-other', 'cleaning', null]) {
      expect(licenceCheckHold(VISA_CATEGORY_SLUG, sub, { desk: false }), String(sub)).toBe(false)
    }
    expect(licenceCheckHold('electronics', VISA_SUBCATEGORY_SLUG, { desk: false })).toBe(false)
  })

  it('a post nobody filed falls back to Services › Other, never the e-Visa slot; every other category to its first aisle', () => {
    expect(SUBCATEGORY_FALLBACK).toEqual({ services: 'service-other' })
    expect(subcategoriesFor(VISA_CATEGORY_SLUG)[0].slug).toBe(VISA_SUBCATEGORY_SLUG) // why the map exists
    expect(subcategoriesFor(VISA_CATEGORY_SLUG).some((s) => s.slug === 'service-other')).toBe(true)
  })

  it('asks every poster the e-visa product chips (O-34 retired) and changes no other facet', () => {
    const keys = askableFacetsFor(VISA_CATEGORY_SLUG, VISA_SUBCATEGORY_SLUG).map((f) => f.key)
    expect(keys).toEqual(expect.arrayContaining(['visaEntryType', 'visaSpeed']))
    expect(keys).not.toContain('providerType') // derived, never asked
    expect(askableFacetsFor('electronics', 'phones')).toEqual(facetsFor('electronics', 'phones').filter((f) => !f.derived))
  })

  // ⚠️ SOURCE ASSERTIONS ON THE WIZARD, kept to the identifiers the licence-aisle commit names (2026-10-14); the
  // behaviour itself is rendered in components/marketplace/post-wizard.licence-aisles.test.tsx.
  it('the wizard offers the plain picker, asks the provider’s values in both aisles and announces the check before Publish', () => {
    const wizard = readFileSync(join(__dirname, '../components/marketplace/post-wizard.tsx'), 'utf8')
    expect(wizard).toContain('postableSubcategoriesFor(categorySlug, keepSub, IS_MARKETPLACE)')
    // Both aisles from the one predicate — not the e-Visa product slot — and the values on every in-aisle form.
    expect(wizard).toMatch(/\bisLicenceCheckSlot\(categorySlug, subcategorySlug\)/)
    expect(wizard).toMatch(/<LicenceCheckNote\b/)
    expect(wizard).toMatch(/<ProviderLicenceFields\b/)
    expect(wizard).not.toMatch(/\bevisaHold\b|<EVisaLicenceNote\b/)
    // An AI photo-fill is a GUESS: it never files a post into either aisle (the server's keyword rule, alike).
    expect(wizard).toMatch(/aiSubOk[\s\S]{0,400}?!isLicenceCheckSlot\(/)
    // An edit the server holds lands on the dashboard with the reason, not on a page that is no longer public.
    expect(wizard).toMatch(/if \(saved\.held\) \{[\s\S]{0,1200}?router\.push\('\/dashboard'\)/)
    expect(wizard).not.toMatch(/subcategory_partner_only|isPartnerOnlySubcategory/)
  })

  it('a teacher looking for work: Jobs › Teaching + wanted only (2026-10-12), refused in the words the wizard types', () => {
    expect(isTeacherSeekingPost('jobs', 'wanted', 'teaching')).toBe(true)
    expect(isTeacherSeekingPost('jobs', 'job', 'teaching')).toBe(false)
    expect(isTeacherSeekingPost('jobs', 'wanted', 'hospitality')).toBe(false)
    expect(isTeacherSeekingPost('jobs', 'wanted', null)).toBe(false)
    expect(isTeacherSeekingPost('services', 'wanted', 'teaching')).toBe(false)
    // The pair exists in the taxonomy: Jobs offers both intents and the Teaching aisle.
    const jobs = TAXONOMY.find((c) => c.slug === 'jobs')!
    expect(jobs.types).toEqual(expect.arrayContaining(['job', 'wanted']))
    expect(subcategoriesFor('jobs').some((s) => s.slug === 'teaching')).toBe(true)
    const wizard = readFileSync(join(__dirname, '../components/marketplace/post-wizard.tsx'), 'utf8')
    const quoted = (x: string) => `'${x}'`
    expect(wizard).toContain([`msg === ${quoted('teacher_profile_instead')}`, `          ? t(${quoted(TEACHER_PROFILE_REFUSAL.vi)}, ${quoted(TEACHER_PROFILE_REFUSAL.en)})`].join('\n'))
  })
})

describe('category descriptions', () => {
  const canonical = (slug: string) => TAXONOMY.find((c) => c.slug === slug)!.description

  it('services reads its canonical text on both editions, naming e-Visa (owner, 2026-10-14)', () => {
    expect(MARKETPLACE_CATEGORY_DESCRIPTIONS.services).toBeUndefined()
    expect(canonical('services')).toMatch(/^e-Visa, legal & permits, /)
    for (const marketplace of [true, false]) expect(categoryDescriptionFor('services', canonical('services'), marketplace)).toBe(canonical('services'))
  })

  it('tickets-travel keeps its own eno.vn wording — visa runs are still not posted there (O-34)', () => {
    expect(canonical('tickets-travel')).toMatch(/visa/i)
    expect(categoryDescriptionFor('tickets-travel', canonical('tickets-travel'), true)).toBe(MARKETPLACE_CATEGORY_DESCRIPTIONS['tickets-travel'])
    expect(categoryDescriptionFor('tickets-travel', canonical('tickets-travel'), true)).not.toMatch(/visa/i)
    expect(categoryDescriptionFor('tickets-travel', canonical('tickets-travel'), false)).toBe(canonical('tickets-travel'))
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
