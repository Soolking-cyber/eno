// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LanguageProvider } from '@/context/language-context'
import { VI_OVERRIDES } from '@/generated/vi-overrides'
import { SellerInfo } from '@/components/marketplace/seller-info'

/**
 * THE LISTING PAGE'S SECTIONS FRAMED BY THE CANON'S HAIRLINE, PHONES ONLY (UI climb batch 79; owner, 2026-11-12: "continue the
 * ui ux improvement towards 10/10"; blind A/B on live eno.vn, GPT 7.56 → 7.71, Opus 7.61 → 7.74, trust ±0). Canon §3b (owner,
 * 2026-07-24: "lines between elements … almost no boxes"): every section that opens on the SECTION_TITLE h2 gets one
 * `border-t border-border` and 24px to its heading below md; the phone storefront row gets the line and 16px (the "Hosted by"
 * band). md and up, the shelves, the safety well and Reviews (which already wore the line) are untouched, and no `order`
 * changes. The page is ISR with a database behind it, so — like photo-first.contract.test.ts — this reads the source; the
 * one wrapper that lives in a component (Seller information's <section>) is also rendered, through the class merge it uses.
 */
const PAGE = readFileSync(join(process.cwd(), 'src/app/[lang]/listings/[id]/(pdp)/page.tsx'), 'utf8')

const SECTION_LINE = ['max-md:border-t', 'max-md:border-border', 'max-md:pt-6']
const BAND_LINE = ['max-md:border-t', 'max-md:border-border', 'max-md:pt-4']

/** The class list of the one `className="…"` the anchor pattern captures; fails loudly when the anchor is gone. */
function classesAt(re: RegExp): string[] {
  const m = PAGE.match(re)
  expect(m, `anchor not found: ${re}`).not.toBeNull()
  return m![1].split(/\s+/).filter(Boolean)
}
/** What a class list is from md up: everything but its `max-md:` classes. */
const fromMd = (classes: string[]) => classes.filter((c) => !c.startsWith('max-md:'))

/** Each section's wrapper, found by what it holds; `before` is its class list before batch 79 (md and up must still read so). */
const SECTIONS: { name: string; re: RegExp; before: string[] }[] = [
  // Batch 89: cn() adds `max-md:hidden` when the facts line holds every row Costs has below md (the next test).
  { name: 'Costs', re: /<div className=\{cn\('([^']*)', costsPhoneHidden\.length === costRows\.length && 'max-md:hidden'\)\}><RentalCosts rows=\{costRows\} phoneHidden=\{costsPhoneHidden\} \/><\/div>/, before: ['order-7'] },
  { name: 'Description', re: /<div className="([^"]*)">\s*<h2 className=\{SECTION_TITLE\}><Tr text="Description" \/><\/h2>/, before: ['space-y-2'] },
  { name: 'Amenities', re: /<div className="([^"]*)"><RentalAmenities items=\{amenities\} \/><\/div>/, before: [] },
  { name: 'Details', re: /<div className="([^"]*)">\s*<h2 className=\{SECTION_TITLE\}><Tr text="Details" \/><\/h2>/, before: ['space-y-2'] },
  { name: 'Seller information', re: /\{sellerInfo && <SellerInfo info=\{sellerInfo\} className="([^"]*)" \/>\}/, before: ['order-8'] },
  { name: 'Location', re: /<div id="location-on-map" className="([^"]*)">\s*<h2 className=\{SECTION_TITLE\}><Tr text="Location" \/><\/h2>/, before: ['order-11', 'space-y-2', 'scroll-mt-20'] },
]

describe('batch 79: one hairline over each listing-page section, below md only', () => {
  it.each(SECTIONS)('$name opens on the line and 24px below md, and is what it was from md', ({ re, before }) => {
    const classes = classesAt(re)
    for (const c of SECTION_LINE) expect(classes).toContain(c)
    expect(fromMd(classes)).toEqual(before)
  })

  it('batch 89: a section left with no row renders nothing — no heading, no stray line', () => {
    // Costs: hidden whole below md when its only rows there are the ones the facts line prints (the deposit); the line's
    // deposit is phone-only, so from md the block and its Deposit row are back.
    expect(PAGE).toContain("const costsPhoneHidden = factsLine && deposit ? ['deposit'] : []")
    // Details: decided on the rows that REMAIN after the facts line, the H1 and the price unit took theirs.
    expect(PAGE).toContain('const showDetails = !!providerValues || detailAttrs.length > 0 || detailSpecs.length > 0 || detailOnlySpecs.length > 0 || detailFactRows.length > 0')
    expect(PAGE).toMatch(/\{showDetails && \(\s*<div className="space-y-2 max-md:border-t/)
  })

  it('every SECTION_TITLE h2 the page draws itself sits directly in a wrapper that carries the line (none missed)', () => {
    const heads = [...PAGE.matchAll(/<div (?:id="[^"]*" )?className="([^"]*)">\s*<h2 className=\{SECTION_TITLE\}>/g)]
    expect(heads.length).toBe(PAGE.split('<h2 className={SECTION_TITLE}>').length - 1)
    expect(heads.length).toBe(3)
    for (const [, cls] of heads) for (const c of SECTION_LINE) expect(cls.split(' ')).toContain(c)
  })

  it('the phone storefront row (the "Hosted by" band) gets the line and 16px — over it only', () => {
    const classes = classesAt(/<div className="([^"]*)">\s*<PdpShopLink /)
    for (const c of BAND_LINE) expect(classes).toContain(c)
    expect(fromMd(classes)).toEqual(['order-7', 'md:hidden'])
    // Its desktop twin in the buy box is untouched.
    expect(PAGE).toMatch(/<div className="order-7 hidden md:block">\s*<PdpShopLink /)
  })

  it('nothing else on the page takes the line: seven class lists in all (six sections, one band), no md/lg border added', () => {
    // Literal class lists, and the literal first argument of a cn() (Costs since batch 89).
    const lists = [...PAGE.matchAll(/className="([^"]*)"/g), ...PAGE.matchAll(/className=\{cn\('([^']*)'/g)].map((m) => m[1])
    expect(lists.filter((l) => /(^|\s)max-md:border-t(\s|$)/.test(l))).toHaveLength(7)
    expect(lists.filter((l) => SECTION_LINE.every((c) => l.split(' ').includes(c)))).toHaveLength(6)
    expect(lists.filter((l) => BAND_LINE.every((c) => l.split(' ').includes(c)))).toHaveLength(1)
    // Reviews keeps its own all-widths line, and the safety well keeps its `max-md:border-t-0`.
    expect(PAGE).toContain('<div className="order-10 border-t border-border pt-4">')
    expect(PAGE).toContain('className="max-md:rounded-2xl max-md:border-t-0 max-md:bg-tint max-md:px-3.5 max-md:pb-2.5 max-md:pt-3.5"')
  })

  it('the shelves are not touched: no line on their call sites or in their components', () => {
    const shelves = PAGE.slice(PAGE.indexOf('<SameSellerShelf '), PAGE.indexOf('</main>'))
    expect(shelves).toContain('<RelatedListings')
    expect(shelves).toContain('<RecentlyViewedRail excludeId={listing.id} sectionClassName="mt-12" />')
    expect(shelves).not.toContain('max-md:border-t')
    for (const f of ['same-seller-shelf.tsx', 'related-listings.tsx', 'recently-viewed-rail.tsx', 'shelf.tsx']) {
      expect(readFileSync(join(process.cwd(), 'src/components/marketplace', f), 'utf8')).not.toContain('max-md:border-t')
    }
  })

  it('no section moved: the phone slots are the ones they were', () => {
    expect(PAGE).toContain('<div className="order-8 flex flex-col gap-8">')
    expect(PAGE).toContain('<div data-safety-block="" className="order-9 md:order-7">')
  })

  it('Seller information\'s <section> keeps every class through its merge (cn with space-y-2), and a seller with nothing to state renders nothing — no stray line', () => {
    const cls = classesAt(/\{sellerInfo && <SellerInfo info=\{sellerInfo\} className="([^"]*)" \/>\}/).join(' ')
    const html = renderToString(
      <LanguageProvider initialLang="en" initialViDict={VI_OVERRIDES}>
        <SellerInfo info={{ kind: 'source', source: 'Tiki', action: 'buy' }} className={cls} />
      </LanguageProvider>,
    )
    const div = document.createElement('div')
    div.innerHTML = html
    const section = div.querySelector('section[data-seller-info]')
    expect(section).not.toBeNull()
    for (const c of ['space-y-2', 'order-8', ...SECTION_LINE]) expect(section!.classList.contains(c)).toBe(true)
    const empty = renderToString(
      <LanguageProvider initialLang="en" initialViDict={VI_OVERRIDES}>
        <SellerInfo info={{ kind: 'business', holder: 'company', legalName: null, legalAddress: '  ', taxCode: null }} className={cls} />
      </LanguageProvider>,
    )
    expect(empty).not.toContain('border-t')
  })
})
