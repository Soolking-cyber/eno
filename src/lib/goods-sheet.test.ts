import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as G from './goods-sheet'
import { isGoodsSheet, pinsAction, COUNSEL_WELL_JOINED } from './goods-sheet'
import { tableFold } from '@/components/marketplace/listing-content'

/**
 * ⛔ THE GOODS SHEET (owner-approved 2026-11-14, cook r06 "item"; src/lib/goods-sheet.ts): which pages it is, which of them pin
 * their action, and the class contract (below md only; from md exactly what the page paints today).
 */
const PAGE = readFileSync(join(process.cwd(), 'src/app/[lang]/listings/[id]/(pdp)/page.tsx'), 'utf8')
const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')

const base = {
  goodsSheet: true, affiliate: false, job: false, booking: false, commission: false, discountCode: false, productStep: false,
  price: 12_000_000, negotiable: false, visa: false, iosHide: false, tripDesk: false, rentalCheck: false,
}

describe('isGoodsSheet', () => {
  it('a listing with a gallery that is neither a job nor a home to rent', () => {
    expect(isGoodsSheet({ noGallery: false, rentalSheet: false, factsLine: true })).toBe(true)
    expect(isGoodsSheet({ noGallery: true, rentalSheet: false, factsLine: true })).toBe(false)
    expect(isGoodsSheet({ noGallery: false, rentalSheet: true, factsLine: true })).toBe(false)
    expect(isGoodsSheet({ noGallery: false, rentalSheet: false, factsLine: false })).toBe(false)
  })
  it('the page decides it from the same facts batch 95 and the rental sheet key on', () => {
    expect(PAGE).toContain('const goodsSheet = isGoodsSheet({ noGallery, rentalSheet, factsLine })')
    expect(PAGE).toContain("const factsLine = listing.listingType !== 'job' && rawListing.category.slug !== 'jobs'")
  })
})

describe('pinsAction — one control and one line, or nothing pinned', () => {
  it('Chat now on a fixed-price or unpriced listing pins; the offer panel does not', () => {
    expect(pinsAction(base)).toBe(true)
    expect(pinsAction({ ...base, price: 0, negotiable: true })).toBe(true)
    expect(pinsAction({ ...base, negotiable: true })).toBe(false)
  })
  it('a plain partner purchase or rental link pins; a booking, a commission, a code or a product step does not', () => {
    const link = { ...base, affiliate: true, negotiable: true }
    expect(pinsAction(link)).toBe(true)
    expect(pinsAction({ ...link, booking: true })).toBe(false)
    expect(pinsAction({ ...link, commission: true })).toBe(false)
    expect(pinsAction({ ...link, discountCode: true })).toBe(false)
    expect(pinsAction({ ...link, productStep: true })).toBe(false)
  })
  it('never a job, an e-visa page, an iOS-hidden contact, the trip desk, an availability check, or a page off the goods sheet', () => {
    for (const k of ['job', 'visa', 'iosHide', 'rentalCheck'] as const) {
      expect(pinsAction({ ...base, [k]: true }), k).toBe(false)
      expect(pinsAction({ ...base, affiliate: true, [k]: true }), `${k} (link)`).toBe(false)
    }
    expect(pinsAction({ ...base, tripDesk: true })).toBe(false)
    expect(pinsAction({ ...base, goodsSheet: false })).toBe(false)
  })
  it('the page feeds it the facts the blocks are rendered from', () => {
    for (const s of [
      'commission: !!affiliateUrl && isCommissionLink(affiliateUrl),',
      'discountCode: !!listing.affiliateDiscountCode,',
      'productStep: !!affiliateUrl && embeddedProductUrl(affiliateUrl) !== null,',
      'visa: isVisaProduct || isVisaProductSlot(catSlug, rawListing.subcategorySlug),',
      'iosHide: iosHideContact,',
      'tripDesk: isTripProduct,',
      "rentalCheck: rentalCheckApplies(rawListing.category.slug, rawListing.subcategorySlug, chatOnlyPartner) && listing.status === 'active',",
    ]) expect(PAGE).toContain(s)
  })
})

describe('the pinned tier', () => {
  it('is `#contact` itself, in its DOM place, marked `data-pin-action` only when pinned; the spacer follows the footer', () => {
    expect(PAGE).toContain("const ContactBlock: ElementType = pinned ? PinnedRegion : 'div'")
    expect(PAGE).toContain("<ContactBlock id=\"contact\" data-pin-action={pinned ? '' : undefined}")
    expect(PAGE.split('id="contact"').length - 1).toBe(1)
    expect(PAGE).toContain('{pinned && <StickyActionBarSpacer className="md:hidden [html.native_&]:hidden" />}')
    expect(PAGE.indexOf('<StickyActionBarSpacer')).toBeGreaterThan(PAGE.indexOf('<Footer />'))
    expect(PAGE).toContain('pinned={pinned} />')
  })
  it('PIN_TIER fixes it below md and outside the store apps only, and moves by translate only', () => {
    for (const c of G.PIN_TIER.split(' ')) expect(c).toMatch(/^(\[html:not\(\.native\)_&\]:max-md:|max-md:|motion-reduce:)/)
    expect(G.PIN_TIER).toContain('[html:not(.native)_&]:max-md:fixed')
    expect(G.PIN_TIER).toContain('max-md:transition-[translate]')
  })
  // ⛔ One bar at a time, as in the iOS app (owner, 2026-11-15): the tab bar shows → the tier steps down out of view.
  it('one stylesheet block: the tab bar starts retracted on a pinned page, and while it shows the tier steps away — phones, never the apps', () => {
    const at = CSS.indexOf('html:not(.native):has(#contact[data-pin-action]) .mobile-nav:not([data-scrolled-up]):not(:focus-within)')
    expect(at).toBeGreaterThan(0)
    expect(CSS.slice(CSS.lastIndexOf('@media', at), at)).toMatch(/^@media \(max-width: 767\.98px\) \{\s*$/)
    const away = CSS.indexOf('html:not(.native):has(.mobile-nav[data-scrolled-up]:not([data-short-page])) #contact[data-pin-action],')
    expect(away).toBeGreaterThan(at)
    expect(CSS.slice(away, CSS.indexOf('}', away))).toMatch(/translate: 0 100%;\s*pointer-events: none;/)
    // Both bars, the tier above the tabs: a page too short to scroll, and keyboard focus inside the tier while the tabs show.
    const both = CSS.indexOf('html:not(.native):has(.mobile-nav[data-short-page]) #contact[data-pin-action],')
    expect(both).toBeGreaterThan(away)
    const bothBlock = CSS.slice(both, CSS.indexOf('}', both))
    expect(bothBlock).toContain('#contact[data-pin-action]:focus-within')
    expect(bothBlock).toMatch(/translate: 0 calc\(-1 \* \(3\.5rem \+ var\(--tabbar-inset\)\)\);\s*pointer-events: auto;/)
    // Without :has() the tab bar never retracts, so the tier still rides above it there (never hidden under the nav).
    const sup = CSS.indexOf('@supports not selector(:has(*))')
    expect(CSS.slice(sup, CSS.indexOf('\n}\n', sup))).toContain('translate: 0 calc(-1 * (3.5rem + var(--tabbar-inset)));')
    // Only `translate` and `opacity` move anything: no box property, so no layout shift.
    const block = CSS.slice(at, CSS.indexOf('\n}\n', at))
    expect(block).not.toMatch(/\b(?:top|bottom|height|margin|padding)\s*:/)
  })
})

describe('the class contract: below md only', () => {
  const PHONE_ONLY = ['GOODS_PHOTO', 'GOODS_PLATES_GAP', 'GOODS_HEAD', 'GOODS_PRICE_ROW', 'GOODS_FACTS', 'GOODS_FACT', 'GOODS_SECTION', 'GOODS_DESC_SECTION', 'GOODS_MAP_BOX', 'COUNSEL_INFO', 'COUNSEL_WELL_JOINED', 'COUNSEL_WELL_ALONE', 'COUNSEL_STRIP', 'GOODS_NOTE'] as const
  it.each(PHONE_ONLY)('%s is max-md: (or a sheet-edge after: pseudo) only', (k) => {
    for (const c of (G[k] as string).split(' ')) expect(c, `${k}: ${c}`).toMatch(/^(max-md:|after:)/)
  })
  it('the price and the H1 put back their md paint (30px / 24px)', () => {
    expect(G.GOODS_PRICE).toBe('text-t-figure md:text-3xl md:tracking-tight')
    expect(G.GOODS_TITLE).toContain('md:text-2xl md:leading-tight')
    expect(G.GOODS_SECTION_TITLE).toBe('text-t-h3 text-foreground md:text-2xl md:font-semibold')
  })
  it('⛔ the safety advice stands 16px under Seller information: `-mt-2` against the column\'s `gap-6`', () => {
    expect(COUNSEL_WELL_JOINED.split(' ')).toContain('max-md:-mt-2')
    expect(PAGE).toContain("<div className={cn('flex flex-col gap-6 md:grid")
  })
  // ⛔ Build 7 (owner-approved 2026-11-15 (build 7), cook r07 "item"): the counsel without the box — no tint, no radius, no
  // padding, nothing on the 4px media edge; both sections on the 12px text edge.
  it('⛔ no box: no tint, radius, padding or media-edge bleed in any counsel class', () => {
    for (const k of ['COUNSEL_INFO', 'COUNSEL_WELL_JOINED', 'COUNSEL_WELL_ALONE', 'COUNSEL_STRIP'] as const) {
      expect(G[k] as string, k).not.toMatch(/bg-tint|rounded|(^|\s)max-md:-mx-|(^|\s)max-md:p[xbt]?-[1-9]/)
    }
    expect(G.COUNSEL_STRIP).toBe('max-md:border-t-0 max-md:pt-0')
    expect(PAGE).toContain('flow={goodsSheet}')
    expect(PAGE).toContain('<ProtectionsRow inline shortLabel={rentalSheet || goodsSheet} accent={goodsSheet} />')
  })
  it('⛔ Details\' rows are 10px (44 tall) since build 7', () => {
    expect(G.GOODS_DETAILS_ROWS.split(' ')).toContain('[&>div]:py-2.5')
    expect(G.GOODS_DETAILS_ROWS).not.toContain('py-4')
  })
  it('⛔ no fade over the tier (owner, 2026-11-15: "without weird haze on top of chat bar")', () => {
    expect('GOODS_TIER_FADE' in G).toBe(false)
    expect(PAGE).toContain('pinned && PIN_TIER)}>')
  })
  it('⛔ the tier\'s line is said once in the page: the tier\'s copies hidden below md, the page\'s from the same facts', () => {
    expect(PAGE).toContain('const tierLineInPage = pinned && goodsSheet')
    expect(PAGE).toContain("className={tierLineInPage ? 'max-md:hidden' : undefined}")
    expect(PAGE).toContain('lineInPage={tierLineInPage}')
    expect(PAGE).toContain("contactLine(listing.seller.officialPartner ? 'partner' : 'person', tr)")
    expect(PAGE).toContain("sourceLine={provenanceInInfo ? counselProvenance('text-sm md:hidden') : undefined}")
    expect(PAGE).toContain('caption={tierLine}')
    // One seller row, before "More like this", on every width (the r06 phone twin after it is gone).
    expect(PAGE.match(/<SameSellerShelf\b/g)).toHaveLength(1)
    expect(PAGE.indexOf('<SameSellerShelf ')).toBeLessThan(PAGE.indexOf('<RelatedListings'))
    expect(PAGE).not.toContain('sellerShelfLast')
  })
  it('the Details twin is display:none from md; the section is display:none below it on the goods sheet', () => {
    expect(G.GOODS_DETAILS_TWIN).toBe('md:hidden')
    // A linked job steps the table down below md too (its tags stand under the head: (pdp)/job-phone-order.contract.test.ts).
    expect(PAGE).toContain("goodsSheet || isJob || detailsPhoneHidden ? 'max-md:hidden' : sectionLine(rentalSheet)")
  })
})

describe('tableFold — the description folds at its first table, after a short lead', () => {
  const TABLE = 'Rent 1-2 days: 300,000 đ/day\nRent 3-15 days: 250,000 đ/day\nOver 15 days: 200,000 đ/day'
  it('folds after the table when the lead is short and more follows', () => {
    const at = tableFold(`Price by rental length\n\n${TABLE}\n\nTo rent\n- ID card and licence`)
    expect(at).toBeGreaterThan(-1)
  })
  it('does not fold with no table, a table last, or a long prose lead (the 8-line clamp then)', () => {
    expect(tableFold('Just words.\n\nMore words.')).toBe(-1)
    expect(tableFold(`Lead\n\n${TABLE}`)).toBe(-1)
    expect(tableFold(`${'A long sentence about the bike. '.repeat(30)}\n\n${TABLE}\n\nTo rent`)).toBe(-1)
  })
})
