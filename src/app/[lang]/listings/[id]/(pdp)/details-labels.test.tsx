// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Bilingual } from '@/components/marketplace/bilingual'
import { LanguageProvider, Tr } from '@/context/language-context'
import { VI_OVERRIDES } from '@/generated/vi-overrides'
import { facetsFor } from '@/lib/taxonomy'

/**
 * ⛔ A DETAILS LABEL IS THE TAXONOMY'S, IN BOTH LANGUAGES — never the raw attribute key through `<Tr>`.
 *
 * The rental PDP printed its attribute KEYS ("bedrooms", "bathrooms") as the Details labels, through
 * the UI dictionary, which is keyed by exact English copy: it has "Bedrooms", not "bedrooms", so the
 * Vietnamese server HTML said "bedrooms" (prod, 2026-09-29) while the facet row beside it carried
 * labelVi "Phòng ngủ". The page now renders the facet's own pair for every category.
 */
const PAGE = readFileSync(join(process.cwd(), 'src/app/[lang]/listings/[id]/(pdp)/page.tsx'), 'utf8')

describe('PDP Details labels', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['vi-VN', 'vi'] })
  })
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'languages')
  })
  const html = (node: ReactNode) =>
    renderToString(<LanguageProvider initialLang="vi" initialViDict={VI_OVERRIDES}>{node}</LanguageProvider>)

  it('the page renders the facet’s label pair, for every category (not only jobs and eSIM)', () => {
    expect(PAGE).toContain('const labelFacet = !jobText ? attrFacets.find((f) => f.key === k) : undefined')
    expect(PAGE).toContain('<Bilingual en={labelFacet.label} vi={labelFacet.labelVi} />')
    expect(PAGE).toContain('<FacetValue facet={labelFacet} value={v} pageLang={pageVariant} />')
    // ⚠️ The values are no longer scoped to jobs and eSIM (pdp-02, 2026-10-04).
    expect(PAGE).not.toContain('const facet = labelled ? labelFacet : undefined')
  })

  it('the defect was real: the raw key misses the dictionary and stays English', () => {
    const rawKey = 'bedrooms'
    expect(html(<Tr text={rawKey} />)).toBe('bedrooms')
  })

  it('every rental facet has Vietnamese of its own, and that is what a Vietnamese reader gets', () => {
    const facets = facetsFor('rentals', 'house-rental')
    expect(facets.map((f) => f.key)).toEqual(expect.arrayContaining(['bedrooms', 'bathrooms']))
    for (const f of facets) {
      expect(f.labelVi.trim(), f.key).not.toBe('')
      expect(html(<Bilingual en={f.label} vi={f.labelVi} />)).toBe(f.labelVi)
    }
    expect(html(<Bilingual en="Bedrooms" vi={facets.find((f) => f.key === 'bedrooms')!.labelVi} />)).toBe('Phòng ngủ')
  })

  /**
   * ⛔ A DETAILS VALUE IS THE FACET OPTION'S, IN BOTH LANGUAGES — for every category, not only jobs and eSIM.
   * A Vietnamese car-hire PDP printed "Daily", "Delivered to you", "Automatic" in its server HTML
   * (pdp-02), because only jobs and eSIM mapped a value through its option pair; everything else went
   * through <Tr>, i.e. the machine-translation layer.
   */
  describe('values', () => {
    /**
     * ⛔ "NEVER MACHINE-TRANSLATED" IS PINNED BY MAKING THE MT PATH THROW. A fetch spy could not fail here:
     * renderToString runs no effects, and translateText only fetches after a timer. So the value renderer
     * is re-imported with `<Tr>` and `useTr` replaced by throwers — a value that reaches either fails.
     */
    type FacetValueModule = typeof import('./facet-value')
    type LanguageModule = typeof import('@/context/language-context')
    let FV: FacetValueModule
    let L: LanguageModule
    beforeAll(async () => {
      vi.resetModules()
      vi.doMock('@/context/language-context', async (importOriginal) => {
        const real = await importOriginal<LanguageModule>()
        const mt = () => { throw new Error('a Details value reached machine translation (<Tr> / useTr)') }
        return { ...real, Tr: mt, useTr: mt }
      })
      FV = await import('./facet-value')
      L = await import('@/context/language-context')
    })
    afterAll(() => {
      vi.doUnmock('@/context/language-context')
      vi.resetModules()
    })
    const facetOf = (category: string, sub: string, key: string) => {
      const facet = facetsFor(category, sub).find((f) => f.key === key)
      expect(facet, `${category}/${sub} has a ${key} facet`).toBeDefined()
      return facet!
    }
    const valueHtml = (category: string, sub: string, key: string, value: unknown, lang: 'vi' | 'en' = 'vi') =>
      renderToString(
        <L.LanguageProvider initialLang={lang} initialViDict={VI_OVERRIDES}>
          <FV.FacetValue facet={facetOf(category, sub, key)} value={value} pageLang={lang} />
        </L.LanguageProvider>,
      ).replaceAll('<!-- -->', '') // React's SSR text-boundary markers are not part of what a reader sees

    it('the pin is live: under this module, <Tr> throws', () => {
      expect(() => renderToString(<L.LanguageProvider initialLang="vi" initialViDict={VI_OVERRIDES}><L.Tr text="Automatic" /></L.LanguageProvider>)).toThrow(/machine translation/)
    })

    it('a vehicle-hire listing reads in Vietnamese: Theo ngày, Giao tận nơi, Số tự động', () => {
      expect(valueHtml('rentals', 'car-rental', 'rentalPeriod', 'daily')).toBe('Theo ngày')
      expect(valueHtml('rentals', 'car-rental', 'delivery', 'delivered')).toBe('Giao tận nơi')
      expect(valueHtml('rentals', 'car-rental', 'transmission', 'automatic')).toBe('Số tự động')
      // A bike names its gearbox differently from a car (one key, two facets — taxonomy.ts).
      expect(valueHtml('rentals', 'motorbike-rental', 'transmission', 'automatic')).toBe('Tự động / Xe ga')
    })

    it('a services listing reads in Vietnamese: Trực tuyến, Doanh nghiệp', () => {
      expect(valueHtml('services', 'cleaning', 'serviceLocation', 'online')).toBe('Trực tuyến')
      expect(valueHtml('services', 'cleaning', 'providerType', 'business')).toBe('Doanh nghiệp')
    })

    it('an array value maps element by element, never as one joined slug', () => {
      expect(valueHtml('services', 'cleaning', 'serviceLocation', ['online', 'at-customer'])).toBe('Trực tuyến, Tận nơi')
    })

    it('a value the facet does not list prints as stored, never through machine translation', () => {
      const facet = facetOf('rentals', 'car-rental', 'transmission')
      expect(FV.facetValueParts(facet, 'cvt')).toEqual([{ kind: 'raw', text: 'cvt', lang: null }])
      expect(FV.facetValueParts(facet, 'AUTOMATIC')).toEqual([{ kind: 'option', en: 'Automatic', vi: 'Số tự động' }])
      expect(valueHtml('rentals', 'car-rental', 'transmission', 'cvt')).toBe('cvt')
    })

    /**
     * ⛔ A LEGACY ROW THAT STORED THE LABEL IS STILL THAT OPTION (review, 2026-10-04): "Số tự động" stored as the
     * value printed raw Vietnamese on an English page. Labels in either language match exactly; a Vietnamese
     * word with no option behind it is marked lang="vi" off a Vietnamese page; plain Latin is left alone.
     */
    it('a stored LABEL reads in the reader’s language; an unlisted Vietnamese word carries lang="vi" on an English page', () => {
      expect(valueHtml('rentals', 'car-rental', 'transmission', 'Số tự động', 'en')).toBe('Automatic')
      expect(valueHtml('rentals', 'car-rental', 'transmission', 'automatic ', 'en')).toBe('Automatic')
      expect(valueHtml('rentals', 'car-rental', 'transmission', 'Automatic')).toBe('Số tự động')
      expect(valueHtml('rentals', 'car-rental', 'transmission', 'Số vô cấp', 'en')).toBe('<span lang="vi">Số vô cấp</span>')
      expect(valueHtml('rentals', 'car-rental', 'transmission', 'Số vô cấp')).toBe('Số vô cấp')
      expect(valueHtml('rentals', 'car-rental', 'transmission', 'cvt', 'en')).toBe('cvt')
    })

    /**
     * ⛔ THE ROW'S LABEL ALREADY NAMES THE UNIT (review, 2026-10-04): "Phòng ngủ: 2 PN", "Số chỗ: 4 chỗ" and
     * "Số khách: 1–2 khách" said it twice. facet-chip-label.ts's rule — an option that states its own count
     * and unit — decides it; a unit that IS the information ("128 GB", "7 ngày", an age range mixing tháng
     * and tuổi) stays.
     */
    it('a unit that restates the row’s label is dropped; a unit that informs stays', () => {
      expect(valueHtml('rentals', 'apartment-rental', 'bedrooms', '2')).toBe('2')
      expect(valueHtml('rentals', 'apartment-rental', 'bedrooms', '2', 'en')).toBe('2')
      expect(valueHtml('rentals', 'apartment-rental', 'bedrooms', '6')).toBe('6+')
      expect(valueHtml('rentals', 'car-rental', 'seats', '4')).toBe('4')
      expect(valueHtml('rentals', 'car-rental', 'seats', '9plus', 'en')).toBe('9+')
      expect(valueHtml('rentals', 'hotel-short-stay', 'guests', '1-2')).toBe('1–2')
      expect(valueHtml('rentals', 'hotel-short-stay', 'guests', '1-2', 'en')).toBe('1–2')
      expect(valueHtml('electronics', 'phones-tablets', 'storage', '128')).toBe('128 GB')
      expect(valueHtml('electronics', 'phones-tablets', 'ram', '8', 'en')).toBe('8 GB')
      expect(valueHtml('services', 'esim', 'validity', '7-days')).toBe('7 ngày')
      expect(valueHtml('baby-kids', 'toys', 'ageRange', '1-3-years')).toBe('1–3 tuổi')
      expect(valueHtml('baby-kids', 'toys', 'ageRange', '0-6-months')).toBe('0–6 tháng')
    })

    /**
     * ⛔ AN OPTION LABEL KEEPS ITS OWN CASE. The cell's `first-letter:uppercase` is for a value printed as
     * stored; on an option label it turned 'eSIM' into 'ESIM' and 'iPhone 17' into 'IPhone 17' — the very
     * regression the page's sentence-case note records for CSS `capitalize`.
     */
    it('only a value printed as stored gets its first letter raised — never an option label', () => {
      expect(FV.facetValueStartsRaw(facetOf('services', 'esim', 'planType'), 'esim')).toBe(false)
      expect(valueHtml('services', 'esim', 'planType', 'esim')).toBe('eSIM')
      expect(FV.facetValueStartsRaw(facetOf('rentals', 'car-rental', 'transmission'), 'automatic')).toBe(false)
      expect(FV.facetValueStartsRaw(facetOf('rentals', 'car-rental', 'transmission'), 'cvt')).toBe(true)
      expect(FV.facetValueStartsRaw(facetOf('rentals', 'car-rental', 'transmission'), ['cvt', 'automatic'])).toBe(true)
      expect(PAGE).toContain("className={cn('text-right font-medium text-foreground', facetValueStartsRaw(labelFacet, v) && 'first-letter:uppercase')}><FacetValue facet={labelFacet} value={v} pageLang={pageVariant} /></dd>")
    })
  })
})
