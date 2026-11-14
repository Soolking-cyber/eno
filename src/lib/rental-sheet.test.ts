import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  HOST_BAND, HOST_CARD_SLOT, PAGE_TITLE, SHEET_BAR_APPROX, SHEET_BAR_PRICE, SHEET_PHOTO, SHEET_PRICE, SHEET_PRICE_ROW, SHEET_ROWS,
  SHEET_TITLE, isRentalSheet,
} from './rental-sheet'

/**
 * ⛔ THE RENTAL SHEET (owner-approved 2026-11-14, cook r05 "rental-c": "after this cook round build all best options and deploy").
 * The predicate, the "below md only" contract of its classes, and the DOM moves in page.tsx it needs (read as source, like the
 * other contracts in (pdp)/: the page is a server component with a database behind it). What the components render is pinned
 * in their own suites (pdp-shop-link, rental-facts, listing-gallery.sheet, listing-detail-map, pdp-action-bar, price, the
 * protections row).
 */
const PAGE = readFileSync(join(process.cwd(), 'src/app/[lang]/listings/[id]/(pdp)/page.tsx'), 'utf8')
const words = (c: string) => c.split(/\s+/).filter(Boolean)

describe('isRentalSheet — every rentals listing that is a place, with a photo', () => {
  const base = { noGallery: false, categorySlug: 'rentals', listingType: 'rent' }
  it.each(['apartment-rental', 'house-rental', 'room-rental', 'office-rental', 'homestay-serviced', 'hotel-short-stay', null])('%s → the sheet', (sub) => {
    expect(isRentalSheet({ ...base, subcategorySlug: sub })).toBe(true)
  })
  it.each(['motorbike-rental', 'car-rental', 'bicycle-rental', 'ebike-rental'])('vehicle hire (%s) → not the sheet (the item page)', (sub) => {
    expect(isRentalSheet({ ...base, subcategorySlug: sub })).toBe(false)
  })
  it('not without a gallery, never a job, never another category', () => {
    expect(isRentalSheet({ ...base, subcategorySlug: 'apartment-rental', noGallery: true })).toBe(false)
    expect(isRentalSheet({ ...base, subcategorySlug: 'apartment-rental', listingType: 'job' })).toBe(false)
    for (const categorySlug of ['electronics', 'vehicles', 'jobs', 'services', 'home']) expect(isRentalSheet({ ...base, categorySlug, subcategorySlug: null })).toBe(false)
  })
  it('the page decides it once, on the server, from the listing alone', () => {
    expect(PAGE.match(/isRentalSheet\(/g)).toHaveLength(1)
    expect(PAGE).toContain('const rentalSheet = isRentalSheet({ noGallery, categorySlug: rawListing.category.slug, subcategorySlug: rawListing.subcategorySlug, listingType: listing.listingType })')
  })
})

describe('below md only — from md the page paints as before', () => {
  it('the H1: the display role below md, and from md exactly what every other page paints there', () => {
    // PAGE_TITLE at md+: 24px (sm:text-2xl), leading-tight, bold, foreground, no tracking.
    expect(words(SHEET_TITLE)).toEqual(expect.arrayContaining(['text-t-title', 'font-bold', 'text-foreground', '[overflow-wrap:anywhere]', 'md:text-2xl', 'md:leading-tight', 'md:tracking-normal']))
    expect(words(PAGE_TITLE)).toEqual(expect.arrayContaining(['sm:text-2xl', 'sm:leading-tight', 'font-bold', 'text-foreground']))
    expect(words(SHEET_TITLE).filter((c) => !c.startsWith('max-md:') && !c.startsWith('md:'))).toEqual(['text-t-title', 'font-bold', 'text-foreground', '[overflow-wrap:anywhere]'])
  })
  it('the price: the h2 role below md, today\'s 30px and tracking from md; first again from md', () => {
    expect(words(SHEET_PRICE)).toEqual(['text-t-h2', 'md:text-3xl', 'md:tracking-tight'])
    expect(words(SHEET_PRICE_ROW)).toEqual(['max-md:mt-2', 'md:order-first'])
  })
  it('the bar: the ≈ under the figure below md only; from md the same row as `dual="sm"`', () => {
    expect(words(SHEET_BAR_PRICE).filter((c) => !c.startsWith('max-md:'))).toEqual(['text-lg', 'leading-6'])
    for (const c of words(SHEET_BAR_APPROX)) expect(c).toMatch(/^max-md:/)
  })
  it('the rows and the host slot: every class max-md:, or the slot that is display:none from md', () => {
    for (const c of words(SHEET_ROWS)) expect(c).toMatch(/^max-md:/)
    expect(words(HOST_CARD_SLOT)).toEqual(['order-7', 'md:hidden'])
    expect(words(HOST_BAND)).toContain('md:hidden')
  })
  it('the photo: the 16px rounded sheet edge, above the slides and under the controls, never taking a tap', () => {
    expect(words(SHEET_PHOTO)).toEqual(expect.arrayContaining(['-mb-6', 'after:pointer-events-none', 'after:absolute', 'after:bottom-0', 'after:h-4', 'after:rounded-t-2xl', 'after:bg-background', 'after:shadow-sheet', 'after:z-[6]']))
    // On the phone gallery's wrapper only, which is md:hidden.
    // (The goods sheet's edge since 2026-11-14, cook r06 "item": GOODS_PHOTO, src/lib/goods-sheet.ts — never both, the two sheets exclude each other.)
    expect(PAGE).toContain("<div data-photo-first=\"\" className={cn('relative order-2 -mx-3 -mt-4 sm:-mx-6 md:hidden', rentalSheet && SHEET_PHOTO, goodsSheet && GOODS_PHOTO)}>")
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
    expect(css).toContain('@utility shadow-sheet { box-shadow: var(--shadow-sheet); }')
    expect(css.match(/--shadow-sheet:/g)).toHaveLength(2) // light and dark
  })
})

describe('page.tsx: DOM order is the phone\'s paint order', () => {
  // A linked job (never the sheet: `isJob` means no gallery) leads with its own role line instead and is pinned in
  // (pdp)/job-phone-order.contract.test.ts (cook r06 jobs, 2026-11-14) — hence `!isJob` on the other pages' branch.
  it('the head: on the sheet the title and the facts line come BEFORE the price row; on every other page after it', () => {
    const block = PAGE.slice(PAGE.indexOf("<div className={cn('order-3 flex flex-col gap-2', goodsSheet && GOODS_HEAD)}>"), PAGE.indexOf('{/* 4 — Enforcement caution'))
    const sheetHead = block.indexOf('{rentalSheet && headTitle}')
    const price = block.indexOf("{priceBlock && (\n                <div className={cn('flex flex-col gap-1.5', rentalSheet && SHEET_PRICE_ROW, goodsSheet && GOODS_PRICE_ROW, isJob && JOB_PRICE_ROW)}>")
    const pageHead = block.indexOf('{!rentalSheet && !isJob && headTitle}')
    expect(sheetHead).toBeGreaterThan(-1)
    expect(price).toBeGreaterThan(sheetHead)
    expect(pageHead).toBeGreaterThan(price)
    // One H1 on the page, rendered once on either branch.
    expect(PAGE.match(/<LocalizedTitleHeading /g)).toHaveLength(1)
    expect(PAGE.match(/headTitle\}/g)).toHaveLength(2)
  })

  it('slot 8: on the sheet Details comes first, Description and Amenities go back before it from md (`md:-order-1`)', () => {
    // (The wrapper's linked-job arm, `isJob && …`, is pinned in (pdp)/job-phone-order.contract.test.ts.)
    const wrap = PAGE.slice(PAGE.indexOf("<div className={cn('order-8 flex flex-col gap-8', goodsSheet && GOODS_SECTION, order8PhoneEmpty && 'max-md:hidden', isJob && (repeatCta ? 'max-md:order-10' : 'max-md:hidden'))}>"), PAGE.indexOf('{/* 8a — A GoPlus room'))
    const first = wrap.indexOf('{rentalSheet && detailsSection}')
    const desc = wrap.indexOf('<Tr text="Description" />')
    const amen = wrap.indexOf('<RentalAmenities ')
    const last = wrap.indexOf('{!rentalSheet && detailsSection}')
    const cta = wrap.indexOf('<AffiliateCtaRepeat ')
    expect(first).toBeGreaterThan(-1)
    expect(desc).toBeGreaterThan(first)
    expect(amen).toBeGreaterThan(desc)
    expect(last).toBeGreaterThan(amen)
    expect(cta).toBeGreaterThan(last)
    expect(wrap).toContain("rentalSheet && `${SHEET_HEAD_GAP} md:-order-1`")
    expect(wrap).toContain("rentalSheet && 'md:-order-1')}><RentalAmenities items={amenities} sheet={rentalSheet} />")
    expect(PAGE.match(/<h2 className=\{SECTION_TITLE\}><Tr text="Details" \/><\/h2>/g)).toHaveLength(1)
  })

  it('the phone host row sits after #contact and the market price, and is the card on the sheet', () => {
    const row = PAGE.indexOf('<div className={rentalSheet ? HOST_CARD_SLOT : goodsSheet ? GOODS_BAND : HOST_BAND}>')
    expect(row).toBeGreaterThan(0)
    expect(row).toBeGreaterThan(PAGE.indexOf('<ContactBlock id="contact"'))
    expect(row).toBeGreaterThan(PAGE.indexOf('data-market-price'))
    expect(row).toBeLessThan(PAGE.indexOf('<RentalCosts '))
    expect(PAGE.slice(row, PAGE.indexOf('</div>', row))).toContain("variant={rentalSheet ? 'card' : goodsSheet ? 'band' : 'row'}")
  })

  it('Location is slot 8 on the sheet only; the safety well keeps its one block', () => {
    expect(PAGE).toContain("className={cn(rentalSheet ? 'order-8' : 'order-11', 'space-y-2 scroll-mt-20', goodsSheet ? GOODS_SECTION : sectionLine(rentalSheet), rentalSheet && SHEET_HEAD_GAP, goodsSheet && 'max-md:space-y-3')}")
    expect(PAGE).toContain("look={rentalSheet ? 'sheet' : 'default'}")
    expect(PAGE.split('data-safety-block=""').length - 1).toBe(1)
    expect(PAGE).toContain('<ProtectionsRow inline shortLabel={rentalSheet || goodsSheet} />')
  })

  it('the pinned bar: one Price, compact on the per-unit threshold, the title caption from md on the sheet', () => {
    expect(PAGE).toContain("dual={rentalSheet ? true : 'sm'} className={rentalSheet ? SHEET_BAR_PRICE : 'text-lg leading-6'}")
    expect(PAGE).toContain("titleCaption={rentalSheet ? 'md' : 'always'}")
  })
})
