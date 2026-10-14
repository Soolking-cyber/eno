import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ tr: (en: string) => en, lang: 'en' }) }))

const { EVisaSellerNote } = await import('./evisa-seller-note')

// Every e-Visa listing that is not eno's own desk carries this note on both editions (owner, 2026-10-14: the
// subcategory is open to every poster, live after a licence check). The desk's page keeps its own disclosure.
describe('EVisaSellerNote', () => {
  it('names the seller and the site, says it is not a government agency, and links the official portal', () => {
    const html = renderToString(<EVisaSellerNote seller="Saigon Visa Co" />)
    expect(html).toContain('sold and handled by Saigon Visa Co')
    expect(html).toMatch(/eno\.(vn|forum) is the marketplace/)
    expect(html).toContain('not a government agency')
    expect(html).toContain('href="https://evisa.gov.vn"')
    expect(html).not.toMatch(/\{seller\}|\{site\}|\$|USD/) // filled in, and no fee amounts
  })

  it('the listing page shows it for an e-Visa listing in the ordinary branch only — never beside the desk’s own disclosure', () => {
    const page = readFileSync(join(process.cwd(), 'src/app/[lang]/listings/[id]/(pdp)/page.tsx'), 'utf8')
    const desk = page.indexOf(': isVisaProduct')
    const note = page.indexOf('{isVisaProductSlot(catSlug, rawListing.subcategorySlug) && <EVisaSellerNote seller={listing.seller.name} className="mb-4" />}')
    const composer = page.indexOf('<IosAppHidden when={iosHideContact}><ContactComposer')
    expect(desk).toBeGreaterThan(-1)
    expect(note).toBeGreaterThan(desk)
    expect(composer).toBeGreaterThan(note)
  })
})
