// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LanguageProvider } from '@/context/language-context'
import { VI_OVERRIDES } from '@/generated/vi-overrides'
import { SellerInfo } from '@/components/marketplace/seller-info'
import { cn } from '@/lib/utils'
import { HOST_BAND, HOST_CARD_SLOT, SECTION_LINE as SECTION_LINE_CLS, SHEET_HEAD_GAP, SHEET_SECTION_LINE, sectionLine } from '@/lib/rental-sheet'
import { COUNSEL_INFO, GOODS_BAND, GOODS_DESC_SECTION, GOODS_SECTION } from '@/lib/goods-sheet'

/**
 * THE LISTING PAGE'S SECTIONS FRAMED BY THE CANON'S HAIRLINE, PHONES ONLY (UI climb batch 79; owner, 2026-11-12: "continue the
 * ui ux improvement towards 10/10"; blind A/B on live eno.vn, GPT 7.56 → 7.71, Opus 7.61 → 7.74, trust ±0). Canon §3b (owner,
 * 2026-07-24: "lines between elements … almost no boxes"): every section that opens on the SECTION_TITLE h2 gets one
 * `border-t border-border` and 24px to its heading below md; the phone storefront row gets the line and 16px (the "Hosted by"
 * band). md and up, the shelves, the safety well and Reviews (which already wore the line) are untouched.
 * ⛔ THE RENTAL SHEET (owner-approved 2026-11-14, cook r05 "rental-c"; src/lib/rental-sheet.ts): the same line and 32px to the
 * heading, 16 from heading to content; the host row is a card with no line, and Costs opens on its edge with none either.
 * ⛔ THE GOODS SHEET (owner-approved 2026-11-14, cook r06 "item"; src/lib/goods-sheet.ts): NO LINES below md — the sections stand
 * 32px apart under 17px headings, Details is a phone twin under the head (its own section `max-md:hidden`), Seller information
 * is the top of the counsel panel; the seller band keeps its one hairline (or the Details twin's bottom line).
 * The page is ISR with a database behind it, so — like photo-first.contract.test.ts — this pins each wrapper's class
 * EXPRESSION in the source and evaluates that same expression with the real constants, for both branches.
 */
const PAGE = readFileSync(join(process.cwd(), 'src/app/[lang]/listings/[id]/(pdp)/page.tsx'), 'utf8')

const SECTION_LINE = ['max-md:border-t', 'max-md:border-border', 'max-md:pt-6']
const SHEET_LINE = ['max-md:border-t', 'max-md:border-border', 'max-md:pt-8']
const BAND_LINE = ['max-md:border-t', 'max-md:border-border', 'max-md:pt-4']

const list = (c: string) => c.split(/\s+/).filter(Boolean)
/** What a class list is from md up: everything but its `max-md:` classes. */
const fromMd = (classes: string[]) => classes.filter((c) => !c.startsWith('max-md:'))

/** Each section's wrapper: the source it is pinned by, the same expression as a function of the branch, and its class list
 *  from md before batch 79 (md and up must still read so — on the sheet less the `md:` class that restores today's order). */
const SECTIONS: { name: string; src: string; classes: (sheet: boolean, goods?: boolean) => string; before: string[]; sheetBefore?: string[] }[] = [
  {
    name: 'Costs',
    src: "<div className={cn('order-7', !rentalSheet && SECTION_LINE, costsPhoneHidden.length === costRows.length && 'max-md:hidden')}><RentalCosts rows={costRows} phoneHidden={costsPhoneHidden} sheet={rentalSheet} /></div>",
    classes: (sheet) => cn('order-7', !sheet && SECTION_LINE_CLS),
    before: ['order-7'],
  },
  {
    name: 'Description',
    src: "<div className={cn('space-y-2', goodsSheet ? GOODS_DESC_SECTION : sectionLine(rentalSheet), rentalSheet && `${SHEET_HEAD_GAP} md:-order-1`)}>\n                <h2 className={goodsSheet ? GOODS_SECTION_TITLE : SECTION_TITLE}><Tr text=\"Description\" /></h2>",
    classes: (sheet, goods = false) => cn('space-y-2', goods ? GOODS_DESC_SECTION : sectionLine(sheet), sheet && `${SHEET_HEAD_GAP} md:-order-1`),
    before: ['space-y-2'],
    sheetBefore: ['space-y-2', 'md:-order-1'],
  },
  {
    name: 'Amenities',
    src: "<div className={cn(sectionLine(rentalSheet), rentalSheet && 'md:-order-1')}><RentalAmenities items={amenities} sheet={rentalSheet} /></div>",
    classes: (sheet) => cn(sectionLine(sheet), sheet && 'md:-order-1'),
    before: [],
    sheetBefore: ['md:-order-1'],
  },
  {
    name: 'Details',
    // A linked job's table is `max-md:hidden` too (its phone tags, owner-approved 2026-11-14, cook r06 jobs): the `goods` branch here.
    src: "<div className={cn('space-y-2', goodsSheet || isJob ? 'max-md:hidden' : sectionLine(rentalSheet), rentalSheet && SHEET_HEAD_GAP)}>\n          <h2 className={SECTION_TITLE}><Tr text=\"Details\" /></h2>",
    classes: (sheet, goods = false) => cn('space-y-2', goods ? 'max-md:hidden' : sectionLine(sheet), sheet && SHEET_HEAD_GAP),
    before: ['space-y-2'],
  },
  {
    name: 'Seller information',
    // A linked job adds `max-md:hidden` only (its phone copy opens the counsel panel, owner-approved 2026-11-14, cook r06 jobs).
    src: "{sellerInfo && <SellerInfo info={sellerInfo} className={cn('order-8', goodsSheet ? COUNSEL_INFO : sectionLine(rentalSheet), isJob && 'max-md:hidden')} sheet={rentalSheet} panel={goodsSheet} />}",
    classes: (sheet, goods = false) => cn('order-8', goods ? COUNSEL_INFO : sectionLine(sheet)),
    before: ['order-8'],
  },
  {
    name: 'Location',
    src: "<div id=\"location-on-map\" className={cn(rentalSheet ? 'order-8' : 'order-11', 'space-y-2 scroll-mt-20', goodsSheet ? GOODS_SECTION : sectionLine(rentalSheet), rentalSheet && SHEET_HEAD_GAP, goodsSheet && 'max-md:space-y-3')}>\n              <h2 className={goodsSheet ? GOODS_SECTION_TITLE : SECTION_TITLE}><Tr text=\"Location\" /></h2>",
    classes: (sheet, goods = false) => cn(sheet ? 'order-8' : 'order-11', 'space-y-2 scroll-mt-20', goods ? GOODS_SECTION : sectionLine(sheet), sheet && SHEET_HEAD_GAP, goods && 'max-md:space-y-3'),
    before: ['order-11', 'space-y-2', 'scroll-mt-20'],
    // Slot 8 on the sheet: from md it paints where slot 11 did (only `order-12` items follow it in that column).
    sheetBefore: ['order-8', 'space-y-2', 'scroll-mt-20'],
  },
]

describe('batch 79: one hairline over each listing-page section, below md only', () => {
  it('the constants are the lines the page has always drawn (24px), and the sheet\'s (32px)', () => {
    expect(list(SECTION_LINE_CLS)).toEqual(SECTION_LINE)
    expect(list(SHEET_SECTION_LINE)).toEqual(SHEET_LINE)
    expect(list(HOST_BAND)).toEqual(['order-7', 'md:hidden', ...BAND_LINE])
    expect(sectionLine(false)).toBe(SECTION_LINE_CLS)
    expect(sectionLine(true)).toBe(SHEET_SECTION_LINE)
  })

  it.each(SECTIONS)('$name: the source carries the expression this test evaluates', ({ src }) => {
    expect(PAGE).toContain(src)
  })

  it.each(SECTIONS)('$name opens on the line and 24px below md, and is what it was from md (every page but the sheet)', ({ classes, before }) => {
    const c = list(classes(false))
    for (const x of SECTION_LINE) expect(c).toContain(x)
    expect(fromMd(c)).toEqual(before)
  })

  it.each(SECTIONS.filter((s) => s.name !== 'Costs'))('$name on the rental sheet: the line and 32px, heading → content 16 where it has a heading of its own', ({ classes, before, sheetBefore }) => {
    const c = list(classes(true))
    for (const x of SHEET_LINE) expect(c).toContain(x)
    expect(c).not.toContain('max-md:pt-6')
    expect(fromMd(c)).toEqual(sheetBefore ?? before)
  })

  it('⛔ Costs on the rental sheet has NO line: it opens on the host card\'s edge (owner-approved 2026-11-14)', () => {
    const c = list(SECTIONS[0].classes(true))
    expect(c).toEqual(['order-7'])
  })

  it.each(SECTIONS.filter((s) => s.name !== 'Costs' && s.name !== 'Amenities'))('⛔ $name on the goods sheet: NO line below md, and from md exactly what it was (owner-approved 2026-11-14, cook r06 "item")', ({ classes, before }) => {
    const c = list(classes(false, true))
    expect(c).not.toContain('max-md:border-t')
    expect(fromMd(c)).toEqual(before)
  })

  it('batch 89: a section left with no row renders nothing — no heading, no stray line', () => {
    // Costs: hidden whole below md when its only rows there are the ones the facts line prints (the deposit); the line's
    // deposit is phone-only, so from md the block and its Deposit row are back.
    expect(PAGE).toContain("const costsPhoneHidden = factsLine && deposit ? ['deposit'] : []")
    // Details: decided on the rows that REMAIN after the facts line, the H1 and the price unit took theirs.
    expect(PAGE).toContain('const showDetails = !!providerValues || detailAttrs.length > 0 || detailSpecs.length > 0 || detailOnlySpecs.length > 0 || detailFactRows.length > 0')
    expect(PAGE).toMatch(/\{showDetails && \(\s*<div className=\{cn\('space-y-2', goodsSheet \|\| isJob \? 'max-md:hidden' : sectionLine\(rentalSheet\)/)
  })

  it('every SECTION_TITLE h2 the page draws itself sits directly in a wrapper that carries the line (none missed)', () => {
    const heads = [...PAGE.matchAll(/<div (?:id="[^"]*" )?className=\{cn\(([^\n]*)\)\}>\s*<h2 className=\{(?:goodsSheet \? GOODS_SECTION_TITLE : )?SECTION_TITLE\}>/g)]
    expect(heads.length).toBe(PAGE.split('<h2 className={SECTION_TITLE}>').length - 1 + PAGE.split('<h2 className={goodsSheet ? GOODS_SECTION_TITLE : SECTION_TITLE}>').length - 1)
    expect(heads.length).toBe(3)
    for (const [, expr] of heads) expect(expr).toContain('sectionLine(rentalSheet)')
  })

  it('the phone storefront row: the "Hosted by" band (line and 16px, over it only), or on the sheet the card\'s slot with no line', () => {
    expect(PAGE).toMatch(/<div className=\{rentalSheet \? HOST_CARD_SLOT : goodsSheet \? GOODS_BAND : HOST_BAND\}>\s*\{detailsTwin\}\s*<PdpShopLink [^\n]*variant=\{rentalSheet \? 'card' : goodsSheet \? 'band' : 'row'\} className=\{goodsSheet \? \(detailsTwin \? 'pt-4' : 'border-t border-border pt-4'\) : undefined\} \/>/)
    // The goods sheet's band: md:hidden, its one line the band's own (or the Details twin's bottom border over it).
    expect(list(GOODS_BAND)).toEqual(['order-7', 'md:hidden'])
    expect(fromMd(list(HOST_BAND))).toEqual(['order-7', 'md:hidden'])
    expect(list(HOST_CARD_SLOT)).toEqual(['order-7', 'md:hidden'])
    // Its desktop twin in the buy box is untouched.
    expect(PAGE).toMatch(/<div className="order-7 hidden md:block">\s*<PdpShopLink /)
  })

  it('nothing else on the page takes the line: no class list of the page\'s own spells it, every one comes from the constants', () => {
    // Literal class lists, and the literal first argument of a cn().
    const lists = [...PAGE.matchAll(/className="([^"]*)"/g), ...PAGE.matchAll(/className=\{cn\('([^']*)'/g)].map((m) => m[1])
    expect(lists.filter((l) => /(^|\s)max-md:border-t(\s|$)/.test(l))).toHaveLength(0)
    // Five sections through sectionLine(), Costs through the page line alone, and the band.
    expect(PAGE.match(/sectionLine\(rentalSheet\)/g)).toHaveLength(5)
    // The goods band's one literal line (`border-t border-border`, all widths on an md:hidden slot) is the only other.
    expect(PAGE.match(/!rentalSheet && SECTION_LINE\b/g)).toHaveLength(1)
    expect(PAGE.match(/\bHOST_BAND\b/g)).toHaveLength(2) // the import and the one slot
    // Reviews keeps its own all-widths line.
    expect(PAGE).toContain('<div className="order-10 border-t border-border pt-4">')
    expect(PAGE).toContain('className={rentalSheet ? SHEET_WELL : goodsSheet ? (sellerInfoShown ? COUNSEL_STRIP_JOINED : COUNSEL_STRIP_ALONE) : isJob ? JOB_COUNSEL_STRIP : PAGE_WELL}')
  })

  it('the shelves are not touched: no line on their call sites or in their components', () => {
    const shelves = PAGE.slice(PAGE.indexOf('<SameSellerShelf '), PAGE.indexOf('</main>'))
    // (the goods sheet's 32px over them below md, GOODS_SHELF_GAP — a gap, no line)
    expect(shelves).toContain('<RelatedListings')
    expect(shelves).toContain('<RecentlyViewedRail excludeId={listing.id} sectionClassName="mt-12" />')
    expect(shelves).not.toContain('max-md:border-t')
    for (const f of ['same-seller-shelf.tsx', 'related-listings.tsx', 'recently-viewed-rail.tsx', 'shelf.tsx']) {
      expect(readFileSync(join(process.cwd(), 'src/components/marketplace', f), 'utf8')).not.toContain('max-md:border-t')
    }
  })

  it('no section moved off the sheet: the phone slots are the ones they were', () => {
    // (A linked job below md: the slot-8 column holds only a repeat Apply, painted after the counsel panel — `max-md:order-10` —
    // or nothing; the panel is the safety block. Owner-approved 2026-11-14, cook r06 jobs.)
    expect(PAGE).toContain("<div className={cn('order-8 flex flex-col gap-8', goodsSheet && GOODS_SECTION, order8PhoneEmpty && 'max-md:hidden', isJob && (repeatCta ? 'max-md:order-10' : 'max-md:hidden'))}>")
    expect(PAGE).toContain(`<div data-safety-block="" className={cn('order-9 md:order-7', goodsSheet && (sellerInfoShown ? COUNSEL_WELL_JOINED : COUNSEL_WELL_ALONE), isJob && JOB_COUNSEL)}>`)
  })

  it('Seller information\'s <section> keeps every class through its merge (cn with space-y-2) on both branches, and a seller with nothing to state renders nothing — no stray line', () => {
    for (const sheet of [false, true]) {
      const cls = cn('order-8', sectionLine(sheet))
      const html = renderToString(
        <LanguageProvider initialLang="en" initialViDict={VI_OVERRIDES}>
          <SellerInfo info={{ kind: 'source', source: 'Tiki', action: 'buy' }} className={cls} sheet={sheet} />
        </LanguageProvider>,
      )
      const div = document.createElement('div')
      div.innerHTML = html
      const section = div.querySelector('section[data-seller-info]')
      expect(section).not.toBeNull()
      for (const c of ['space-y-2', 'order-8', ...(sheet ? [...SHEET_LINE, SHEET_HEAD_GAP] : SECTION_LINE)]) expect(section!.classList.contains(c), c).toBe(true)
      const empty = renderToString(
        <LanguageProvider initialLang="en" initialViDict={VI_OVERRIDES}>
          <SellerInfo info={{ kind: 'business', holder: 'company', legalName: null, legalAddress: '  ', taxCode: null }} className={cls} sheet={sheet} />
        </LanguageProvider>,
      )
      expect(empty).not.toContain('border-t')
    }
  })
})
