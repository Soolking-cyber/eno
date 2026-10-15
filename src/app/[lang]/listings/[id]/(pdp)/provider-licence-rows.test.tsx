// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToString } from 'react-dom/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { VI_OVERRIDES } from '@/generated/vi-overrides'

/**
 * ⛔ THE PROVIDER'S LICENCE ON AN e-VISA OR LEGAL & PERMITS PAGE (owner, 2026-10-14: "seller enters"; Quy chế Article 5).
 * A listing in either licence aisle prints the provider's registered business name and licence (or registration) number
 * as the FIRST rows of its Details table — exactly as stored (identifiers, never copy: no <Tr>, no FacetValue, no
 * first-letter uppercase, translate="no"), under authored Bilingual labels. The page is ISR with a database behind it,
 * so — like details-labels.test.tsx and safety-note-and-facts.test.tsx — its wiring is asserted on the source, and the
 * rows are rendered on their own.
 */
const PAGE = readFileSync(join(process.cwd(), 'src/app/[lang]/listings/[id]/(pdp)/page.tsx'), 'utf8')

const VIETKITE = 'CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ DU LỊCH VIETKITE'
const VISA_NO = '79-123/2019/TCDL-GP LHQT'
const HOANG_PHI = 'CÔNG TY LUẬT TNHH HOÀNG PHI'
const LEGAL_NO = '01021234/TP/ĐKHĐ'

/**
 * ⛔ "NEVER MACHINE-TRANSLATED" IS PINNED BY MAKING THE MT PATH THROW (details-labels.test.tsx's harness): the rows are
 * imported under a language context whose <Tr> and useTr throw, so a value — or a label — that reached either fails.
 */
type RowsModule = typeof import('./provider-licence-rows')
type LanguageModule = typeof import('@/context/language-context')
let R: RowsModule
let L: LanguageModule
beforeAll(async () => {
  vi.resetModules()
  vi.doMock('@/context/language-context', async (importOriginal) => {
    const real = await importOriginal<LanguageModule>()
    const mt = () => { throw new Error('a licence row reached machine translation (<Tr> / useTr)') }
    return { ...real, Tr: mt, useTr: mt }
  })
  R = await import('./provider-licence-rows')
  L = await import('@/context/language-context')
})
afterAll(() => {
  vi.doUnmock('@/context/language-context')
  vi.resetModules()
})
beforeEach(() => {
  Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['vi-VN', 'vi'] })
})
afterEach(() => {
  Reflect.deleteProperty(navigator, 'languages')
})

/** The two rows as a reader in `lang` gets them, inside the page's own <dl>, parsed. */
function rows(subcategorySlug: string, legalName: string, licenceNo: string, lang: 'vi' | 'en') {
  const html = renderToString(
    <L.LanguageProvider initialLang={lang} initialViDict={VI_OVERRIDES}>
      <dl><R.ProviderLicenceRows subcategorySlug={subcategorySlug} values={{ legalName, licenceNo }} /></dl>
    </L.LanguageProvider>,
  ).replaceAll('<!-- -->', '') // React's SSR text-boundary markers are not part of what a reader sees
  const dl = document.createElement('div')
  dl.innerHTML = html
  return {
    html,
    labels: [...dl.querySelectorAll('dt')].map((d) => d.textContent),
    values: [...dl.querySelectorAll('dd')].map((d) => ({ text: d.textContent, translate: d.getAttribute('translate'), cls: d.getAttribute('class') ?? '' })),
  }
}

describe('ProviderLicenceRows', () => {
  it('the pin is live: under this module, <Tr> throws', () => {
    expect(() => renderToString(<L.LanguageProvider initialLang="vi" initialViDict={VI_OVERRIDES}><L.Tr text="Licence no." /></L.LanguageProvider>)).toThrow(/machine translation/)
  })

  it('e-Visa: the name and the licence no. exactly as stored, each in dd[translate="no"], under curated Vietnamese labels', () => {
    const vi = rows('visa-legal', VIETKITE, VISA_NO, 'vi')
    expect(vi.labels).toEqual(['Đơn vị cung cấp được cấp phép', 'Số giấy phép'])
    expect(vi.values.map((v) => v.text)).toEqual([VIETKITE, VISA_NO])
    for (const v of vi.values) {
      expect(v.translate).toBe('no')
      expect(v.cls).not.toContain('first-letter') // printed as typed: never a raised first letter
    }
    expect(vi.html).toContain('data-fab-avoid') // the floating mark yields over a value, as on every Details row
    expect(rows('visa-legal', VIETKITE, VISA_NO, 'en').labels).toEqual(['Licensed provider', 'Licence no.'])
  })

  it('Legal & permits: its own number label — the licence OR registration no. — and not one visa word, in either language', () => {
    const vi = rows('legal-permits', HOANG_PHI, LEGAL_NO, 'vi')
    const en = rows('legal-permits', HOANG_PHI, LEGAL_NO, 'en')
    expect(vi.labels).toEqual(['Đơn vị cung cấp được cấp phép', 'Số giấy phép / đăng ký'])
    expect(en.labels).toEqual(['Licensed provider', 'Licence / registration no.'])
    expect(en.values.map((v) => v.text)).toEqual([HOANG_PHI, LEGAL_NO])
    expect(vi.html).not.toMatch(/visa|thị thực/i)
    expect(en.html).not.toMatch(/visa/i)
  })

  it('a value is never escaped into markup or rewritten: NFC as stored, HTML as text', () => {
    const odd = rows('visa-legal', 'A & B <Co>', '01-0912/2017/TCDL-GP LHQT', 'en')
    expect(odd.values.map((v) => v.text)).toEqual(['A & B <Co>', '01-0912/2017/TCDL-GP LHQT'])
  })
})

describe('the PDP wires them in', () => {
  it('reads the values only inside the two aisles, and only when both are there', () => {
    expect(PAGE).toContain('const licenceAisle = isLicenceCheckSlot(rawListing.category.slug, rawListing.subcategorySlug)')
    expect(PAGE).toContain('const providerValues = licenceAisle ? providerLicenceOf(rawListing.attributes) : null')
  })

  it('prints them as the FIRST rows of the Details table, which shows for them alone', () => {
    const dl = PAGE.slice(PAGE.indexOf('<dl className="divide-y divide-border'), PAGE.indexOf('</dl>'))
    expect(dl).toContain('{providerValues && <ProviderLicenceRows subcategorySlug={rawListing.subcategorySlug} values={providerValues} />}')
    expect(dl.indexOf('<ProviderLicenceRows')).toBeLessThan(dl.indexOf('numericSpecs'))
    expect(PAGE).toMatch(/const showDetails = !!providerValues \|\|/)
  })

  it('hides the raw keys everywhere — and providerType and serviceLocation on an aisle row', () => {
    expect(PAGE).toContain('const hiddenAttrs = new Set<string>(PROVIDER_LICENCE_KEYS)')
    expect(PAGE).toContain("if (licenceAisle) { hiddenAttrs.add('providerType'); hiddenAttrs.add('serviceLocation') }")
    expect(PAGE).toContain('const detailAttrs = attrs.filter(([k]) => !hiddenAttrs.has(k))')
  })

  it('a non-desk e-Visa page keeps its seller note and no desk disclosure — on eno.vn the desk branch cannot even be reached', () => {
    // The desk's disclosure lives only in the isVisaProduct branch; any other e-Visa listing gets EVisaSellerNote.
    expect(PAGE).toContain('const isVisaProduct = VISA_THREADS_ENABLED && VISA_START_AVAILABLE && (await isVisaShopListing(listing.id))')
    const deskBranch = PAGE.slice(PAGE.indexOf(': isVisaProduct\n'), PAGE.indexOf('{isVisaProductSlot(catSlug, rawListing.subcategorySlug) && <EVisaSellerNote'))
    expect(deskBranch).toContain('<VisaDisclosure')
    expect(PAGE.match(/<VisaDisclosure\b/g)).toHaveLength(1)
    expect(PAGE).toContain('{isVisaProductSlot(catSlug, rawListing.subcategorySlug) && <EVisaSellerNote seller={listing.seller.name} className="mb-4" />}')
    // eno.vn builds visa-start as its stub (next.config.ts), which never offers the desk's start button.
    expect(readFileSync(join(process.cwd(), 'src/components/marketplace/visa-start.stub.tsx'), 'utf8')).toContain('export const VISA_START_AVAILABLE = false')
  })
})
