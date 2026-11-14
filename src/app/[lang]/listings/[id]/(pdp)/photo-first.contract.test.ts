/**
 * THE PHONE'S LISTING PAGE, 2026-11-10 (owner: items 3 and 8 of the decision scorecard).
 *   3. A listing with photos opens on its photo: no site header below md, Back over the photo.
 *   8. The safety block follows the listing's own facts on a phone; from md nothing moves.
 * Both are decided by classes and one stylesheet block on the server's HTML, so nothing shifts and nothing waits for
 * script. These pin the pieces that have to agree across two files, read as source: a rendered-page check lives in the
 * e2e suites, and the geometry was measured on the build (the commit has the numbers).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(process.cwd(), 'src/app/[lang]/listings/[id]/(pdp)/page.tsx'), 'utf8')
const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
const BUTTON = readFileSync(join(process.cwd(), 'src/components/marketplace/pdp-back-button.tsx'), 'utf8')

describe('item 3: the photo-first hook', () => {
  it('is on the phone gallery only, and only when the page has a gallery', () => {
    // The rental sheet adds its photo slot below md (SHEET_PHOTO, owner-approved 2026-11-14, cook r05 "rental-c").
    const at = PAGE.indexOf("<div data-photo-first=\"\" className={cn('relative order-2 -mx-3 -mt-4 sm:-mx-6 md:hidden', rentalSheet && SHEET_PHOTO, goodsSheet && GOODS_PHOTO)}>")
    expect(at).toBeGreaterThan(-1)
    // One hook on the page: a second one would hide the header on a page with no photo to open on.
    expect(PAGE.split('data-photo-first=""').length - 1).toBe(1)
    // …inside the `!noGallery` branch (a linked job has no gallery and keeps its header).
    const guard = PAGE.lastIndexOf('{!noGallery && (', at)
    expect(guard).toBeGreaterThan(-1)
    expect(PAGE.slice(guard, at)).not.toContain(')}')
  })

  it('puts Back over the photo, opposite Share and Save, with the category as its fallback', () => {
    const at = PAGE.indexOf('data-photo-first=""')
    const block = PAGE.slice(at, PAGE.indexOf('<OwnerEditButton', at))
    // `plate-lg` (2026-11-14, owner-approved): the Back/Share/Save glyphs on 32px white plates.
    expect(block).toContain('<div className="plate-lg absolute left-3 top-3 z-10 flex items-center">')
    // The goods sheet sets its plates 12px apart below md (GOODS_PLATES_GAP, owner-approved 2026-11-14, cook r06 "item").
    expect(block).toContain("<div className={cn('plate-lg absolute right-3 top-3 z-10 flex items-center gap-2', goodsSheet && GOODS_PLATES_GAP)}>")
    expect(block).toContain('<PdpBackButton fallbackHref={localizedHref(categoryBrowsePath(rawListing.category.slug), pageVariant)} />')
    expect(block.indexOf('absolute left-3 top-3')).toBeLessThan(block.indexOf('absolute right-3 top-3'))
  })

  it('one stylesheet block hides the header, hands the notch inset to <main>, shows Back and moves the Video chip out from under it: same condition, phones, never the store apps', () => {
    const cond = 'html:not(.native):has(main [data-photo-first])'
    const at = CSS.indexOf('@media (max-width: 767.98px) {\n  ' + cond + ' #app-header')
    expect(at).toBeGreaterThan(-1)
    const block = CSS.slice(at, CSS.indexOf('\n}\n', at)).replace(/\s+/g, ' ')
    expect(block).toContain(cond + ' #app-header { display: none; }')
    expect(block).toContain(cond + ' main#main { padding-top: calc(1rem + max(env(safe-area-inset-top), var(--safe-area-inset-top, 0px))); }')
    expect(block).toContain(cond + ' [data-photo-back] { display: flex; }')
    expect(block).toContain(cond + ' [data-photo-first] [data-video-chip] { left: 3.5rem; top: 1.25rem; }')
    // Nothing else in the stylesheet keys on the hook: these four rules, in this one block.
    expect(CSS.split(cond).length - 1).toBe(4)
    expect(block.split(cond).length - 1).toBe(4)
  })

  it('the gallery\'s Video chip carries the hook that rule moves (it shares Back\'s corner)', () => {
    const gallery = readFileSync(join(process.cwd(), 'src/components/marketplace/listing-gallery.tsx'), 'utf8')
    expect(gallery).toContain('<span data-video-chip="" className="pointer-events-none absolute left-2 top-2 z-10')
    expect(gallery.split('data-video-chip=""').length - 1).toBe(1)
  })

  it('Back is hidden by default, so a browser that cannot read the rule shows the header and no second Back', () => {
    expect(BUTTON).toContain("className: 'icon-own-ink press hidden'")
    expect(BUTTON).toContain('data-photo-back=""')
  })

  it('Back is a link to its fallback, not a script-only button: the rule that hides the header needs no script either', () => {
    expect(BUTTON).toContain('<Link href={fallbackHref} prefetch={false} onClick={onBack} data-photo-back=""')
    expect(BUTTON).not.toContain('<IconButton')
  })
})

describe('item 8: the safety block follows the facts on a phone', () => {
  it('is one block, slot 9 below md and slot 7 from md', () => {
    // The goods sheet's counsel panel adds max-md: classes only (COUNSEL_WELL_*), a linked job's too (JOB_COUNSEL, owner-approved
    // 2026-11-14, cook r06 jobs); the slots are the same.
    expect(PAGE).toContain(`<div data-safety-block="" className={cn('order-9 md:order-7', goodsSheet && (sellerInfoShown ? COUNSEL_WELL_JOINED : COUNSEL_WELL_ALONE), isJob && JOB_COUNSEL)}>`)
    expect(PAGE.split('data-safety-block=""').length - 1).toBe(1)
    expect(PAGE.split('<SafetyStrip').length - 1).toBe(1)
  })

  it('sits after the description, the details and the seller information, before the reviews and the map', () => {
    // The slots those blocks hold on the phone's single column.
    expect(PAGE).toContain("<div className={cn('order-8 flex flex-col gap-8', goodsSheet && GOODS_SECTION, order8PhoneEmpty && 'max-md:hidden', isJob && (repeatCta ? 'max-md:order-10' : 'max-md:hidden'))}>")
    // The `sectionLine` classes are batch 79's phone section line (./section-hairline.test.tsx); the slots are unchanged.
    expect(PAGE).toContain("{sellerInfo && <SellerInfo info={sellerInfo} className={cn('order-8', goodsSheet ? COUNSEL_INFO : sectionLine(rentalSheet), isJob && 'max-md:hidden')} sheet={rentalSheet} panel={goodsSheet} />}")
    expect(PAGE).toContain('<div className="order-10 border-t border-border pt-4">')
    // ⛔ The map is slot 11 — except on the rental sheet, where it is slot 8, before the well (owner-approved 2026-11-14, cook
    // r05 "rental-c"); from md both paint in the same place (only order-12 items follow it in its column).
    expect(PAGE).toContain("<div id=\"location-on-map\" className={cn(rentalSheet ? 'order-8' : 'order-11', 'space-y-2 scroll-mt-20', goodsSheet ? GOODS_SECTION : sectionLine(rentalSheet), rentalSheet && SHEET_HEAD_GAP, goodsSheet && 'max-md:space-y-3')}>")
  })
})
