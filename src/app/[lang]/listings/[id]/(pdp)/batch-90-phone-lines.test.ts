/**
 * UI climb batch 90 (2026-11-14; owner 2026-11-13: "reduce lines … super clean, minimal wording, only what's necessary"; blind
 * A/B on live eno.vn, Opus +0.14/+0.12, GPT +0.17, trust ±0). Source pins, like the other contracts in this folder: page.tsx
 * is a server component too heavy to render here. The seller strip's half is rendered in pdp-shop-link.test.tsx, the Blvck
 * intro's in blvck-listing.test.ts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HOST_BAND } from '@/lib/rental-sheet'
import { GOODS_BAND } from '@/lib/goods-sheet'

const PAGE = readFileSync(join(process.cwd(), 'src/app/[lang]/listings/[id]/(pdp)/page.tsx'), 'utf8')

describe('batch 90 — no breadcrumb row on a phone listing page', () => {
  const navClasses = () => {
    const m = PAGE.match(/<LocalizedNav label="Breadcrumb" labelVi="Đường dẫn" data-crumb-trail="" className="([^"]*)">/)
    expect(m, 'the crumb trail nav').not.toBeNull()
    return m![1].split(/\s+/)
  }
  it('the trail is max-md:hidden — one nav, one class', () => {
    expect(PAGE.split('data-crumb-trail=""').length - 1).toBe(1)
    expect(navClasses()).toContain('max-md:hidden')
  })
  it('md and up are what they were: row 1, full width, the same type and tap room', () => {
    expect(navClasses().filter((c) => c !== 'max-md:hidden')).toEqual(['order-7', '-my-3', 'truncate', 'py-3', 'text-sm', 'text-muted-foreground', 'md:order-1', 'md:col-span-12'])
  })
  it('the BreadcrumbList JSON-LD is still emitted, from the same model', () => {
    expect(PAGE).toContain('const breadcrumbLd = pdpBreadcrumbLd({')
    expect(PAGE).toContain('<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(breadcrumbLd) }} />')
  })
  it('the phone "Hosted by" band is untouched: still md:hidden with its one line over it (the rental sheet: a card, no line)', () => {
    // Since 2026-11-14 (cook r05) the class lists are src/lib/rental-sheet.ts constants: HOST_BAND is the band's literal list.
    expect(HOST_BAND).toBe('order-7 md:hidden max-md:border-t max-md:border-border max-md:pt-4')
    // …and since 2026-11-14 (cook r06 "item") the goods sheet's slot (GOODS_BAND): md:hidden, its line on the band or the
    // Details twin over it (src/lib/goods-sheet.ts).
    expect(PAGE).toContain('<div className={rentalSheet ? HOST_CARD_SLOT : goodsSheet ? GOODS_BAND : HOST_BAND}>')
    expect(GOODS_BAND).toBe('order-7 md:hidden')
  })
  it('the phone row is in the DOM where it paints: after #contact and the market price, before the desktop twin and Costs', () => {
    const row = PAGE.indexOf('<div className={rentalSheet ? HOST_CARD_SLOT : goodsSheet ? GOODS_BAND : HOST_BAND}>')
    expect(row).toBeGreaterThan(0)
    // `#contact` is one element, a div or (on the goods sheet's pinned pages) PinnedRegion: `ContactBlock`.
    expect(row).toBeGreaterThan(PAGE.indexOf('<ContactBlock id="contact"'))
    expect(row).toBeGreaterThan(PAGE.indexOf('<div data-market-price className="order-6 lg:order-3">'))
    expect(row).toBeLessThan(PAGE.indexOf('<div className="order-7 hidden md:block">'))
    expect(row).toBeLessThan(PAGE.indexOf('<RentalCosts '))
    // …and no longer ahead of the (phone-hidden) crumb at the top of the grid.
    expect(row).toBeGreaterThan(PAGE.indexOf('data-crumb-trail=""'))
    // Three calls since 2026-11-14 (owner-approved, cook r06 jobs): a linked job's employer line under its role (`jobTitleLine`,
    // `md:hidden`) stands in for this band, which a linked job does not draw (`!isJob`). Still one row per width on every page.
    expect(PAGE.split('<PdpShopLink ').length - 1).toBe(3)
    expect(PAGE).toContain('{!isJob && (\n              <div className={rentalSheet ? HOST_CARD_SLOT : goodsSheet ? GOODS_BAND : HOST_BAND}>')
  })
})

describe('batch 90 — a Blvck bike\'s description does not print eno\'s intro sentence', () => {
  it('rebuilds the sentences from the listing\'s own titles, for an official partner\'s `blvck:` row only', () => {
    expect(PAGE).toContain("const blvckIntros = rawListing.seller.officialPartner === true && (rawListing.externalId ?? '').startsWith('blvck:')\n    ? blvckIntroSentences({ title: listing.title, titleVi: listing.titleVi })\n    : []")
  })
  it('hands them to the description, which drops only an exact first paragraph; every other listing passes an empty list', () => {
    expect(PAGE).toContain('<ListingDescription text={listing.description} vi={listing.descriptionVi} i18n={i18n[listing.description]} dropLead={blvckIntros} ')
    const comp = readFileSync(join(process.cwd(), 'src/components/marketplace/listing-content.tsx'), 'utf8')
    expect(comp).toContain('const shown = withoutLeadParagraph(showOriginal ? text : out, dropLead ?? [])')
  })
  it('⛔ the page never hides the Description on this account: the trim itself never empties a text (codex, 2026-11-14)', () => {
    // A server-side "was it only the intro?" check drew a new edge case every round (the Vietnamese column, a cached
    // translation, trailing blank lines); lead-paragraph.ts now returns the text unchanged when nothing else would remain.
    expect(PAGE).not.toContain('withoutLeadParagraph')
    expect(PAGE).not.toMatch(/blvckIntros\.length > 0 &&/)
  })
  it('the metadata and JSON-LD still read the full stored description', () => {
    expect(PAGE).toMatch(/plainSnippet\(listing\.description/)
    expect(PAGE).toContain('description: displayDesc,')
  })
})
