// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { act } from 'react'
import { LanguageProvider } from '@/context/language-context'
import { ListingDescription, gridTables } from './listing-content'
import { PinnedRegion, StickyActionBarSpacer } from '@/components/ui/sticky-action-bar'
import { ImportProvenance } from './import-provenance'
import { SellerInfo } from './seller-info'
import { PHONE_GRID } from './shelf'

/**
 * ⛔ THE GOODS SHEET'S COMPONENTS (owner-approved 2026-11-14, cook r06 "item"; src/lib/goods-sheet.ts): the description's fold
 * at its first table, the pinned tier's publishing, the source line and the shelves' phone grid — and since build 7
 * (owner-approved 2026-11-15 (build 7), cook r07 "item") the source line said once in the page, a short table as a grid and
 * Seller information's source line. The seller band is in pdp-shop-link.band.test.tsx, the photo in
 * listing-gallery.plain.test.tsx, the unboxed counsel in safety-strip.flow.test.tsx, the tier's chat line in
 * contact-composer.line-in-page.test.tsx.
 */
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.documentElement.removeAttribute('style'); document.documentElement.className = '' })

const BIKE = 'Price by rental length\n\nRent 1-2 days: 300,000 đ/day\nRent 3-15 days: 250,000 đ/day\nOver 15 days: 200,000 đ/day\nOne month: 180,000 đ/day\n\nTo rent\n- ID card and driving licence, plus a cash deposit\n- No cash deposit: ID card with household registration'
const BUY = 'Buy'
const X = 'x'
const en = (node: React.ReactNode) => <LanguageProvider initialLang="en" initialViDict={{}}>{node}</LanguageProvider>

describe('ListingDescription `goods`: the fold at the first table', () => {
  it('folds after the table (the blocks after it max-md:hidden, no 8-line clamp); See more is the same disclosure', () => {
    const { container } = render(en(<ListingDescription text={BIKE} goods />))
    const box = container.querySelector('.allow-select')!
    expect(box.className).not.toContain('max-md:line-clamp-8')
    const kids = [...box.children]
    const dl = kids.findIndex((k) => k.tagName === 'DL')
    expect(dl).toBeGreaterThan(0)
    expect(kids[dl].className).toContain('max-md:mb-0')
    for (const k of kids.slice(dl + 1)) expect(k.className).toContain('max-md:hidden')
    for (const k of kids.slice(0, dl)) expect(k.className).not.toContain('max-md:hidden')
    const more = container.querySelector('button[aria-controls]')!
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(more.getAttribute('aria-controls')).toBe(box.id)
    // Every word stays in the DOM.
    expect(box.textContent).toContain('No cash deposit')
  })
  it('See more opens every block', async () => {
    const { container } = render(en(<ListingDescription text={BIKE} goods />))
    await act(async () => { (container.querySelector('button[aria-controls]') as HTMLButtonElement).click() })
    for (const k of container.querySelector('.allow-select')!.children) expect(k.className).not.toContain('max-md:hidden')
  })
  it('without `goods` the 8-line clamp is as it was', () => {
    const { container } = render(en(<ListingDescription text={BIKE} />))
    const box = container.querySelector('.allow-select')!
    expect(box.className).toContain('max-md:line-clamp-8')
    for (const k of box.children) expect(k.className).not.toContain('max-md:hidden')
  })
  it('the server HTML is the first client render (no hydration mismatch)', async () => {
    const html = renderToString(en(<ListingDescription text={BIKE} goods />))
    const div = document.createElement('div')
    div.innerHTML = html
    document.body.appendChild(div)
    const errors: unknown[] = []
    await act(async () => { hydrateRoot(div, en(<ListingDescription text={BIKE} goods />), { onRecoverableError: (e) => errors.push(e) }) })
    expect(errors).toEqual([])
    div.remove()
  })
})

describe('PinnedRegion', () => {
  const mq = (matches: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches, media: q, addEventListener() {}, removeEventListener() {} }))
  it('renders a plain div with its props on the server, the same on the client', () => {
    const html = renderToString(<PinnedRegion id="contact" data-pin-action="" className="order-6"><a href="#">{BUY}</a></PinnedRegion>)
    expect(html).toBe(`<div id="contact" data-pin-action="" class="order-6"><a href="#">${BUY}</a></div>`)
  })
  it('below md it publishes its height, the clear line and scroll padding, and takes them back on unmount', () => {
    mq(true)
    const root = document.documentElement
    const { unmount } = render(<PinnedRegion id="contact">{X}</PinnedRegion>)
    expect(root.hasAttribute('data-sticky-action-bar')).toBe(true)
    expect(root.style.getPropertyValue('--sticky-action-bar-h')).toBe('0px') // jsdom has no layout
    expect(root.style.getPropertyValue('scroll-padding-bottom')).toContain('--sticky-action-bar-clear')
    unmount()
    expect(root.hasAttribute('data-sticky-action-bar')).toBe(false)
    expect(root.style.getPropertyValue('scroll-padding-bottom')).toBe('')
    expect(root.style.getPropertyValue('--sticky-action-bar-h')).toBe('0px')
  })
  it('from md, and in the store apps, it publishes nothing', () => {
    mq(false)
    render(<PinnedRegion id="contact">{X}</PinnedRegion>)
    expect(document.documentElement.hasAttribute('data-sticky-action-bar')).toBe(false)
    cleanup()
    mq(true)
    document.documentElement.classList.add('native')
    render(<PinnedRegion id="contact">{X}</PinnedRegion>)
    expect(document.documentElement.hasAttribute('data-sticky-action-bar')).toBe(false)
  })
  it('the spacer the page puts after the footer reserves the published height', () => {
    expect(renderToString(<StickyActionBarSpacer className="md:hidden [html.native_&]:hidden" />)).toContain('h-[calc(var(--sticky-action-bar-h,4.5rem)')
  })
})

// ⛔ Build 7 (owner-approved 2026-11-15 (build 7), cook r07 "item"): the tier is the button alone; the source line is said once
// in the page (`look="counsel"`), and the tier's own copy is `max-md:hidden` (it reverses r06's `inline` under the button).
describe('ImportProvenance `look="counsel"` (the source line, once in the page)', () => {
  const html = (node: React.ReactNode) => { const div = document.createElement('div'); div.innerHTML = renderToString(en(node)); return div }
  it('muted text, the link an underlined accent link in running text with no 44px overhang; same href, rel and target', () => {
    const div = html(<ImportProvenance kind="retail" site="Tuấn Nguyễn Mobile" iso={null} href="https://shop.example/p" look="counsel" className="text-sm md:hidden" />)
    const p = div.querySelector('p')!
    expect(p.getAttribute('data-provenance-line')).toBe('counsel')
    // The CTA's line keeps the one `data-import-provenance` hook (e2e/ci/provenance.spec.ts counts it).
    expect(p.hasAttribute('data-import-provenance')).toBe(false)
    expect(p.className.split(' ')).toEqual(expect.arrayContaining(['text-muted-foreground', 'text-sm', 'md:hidden']))
    expect(p.textContent).toMatch(/^Source: Tuấn Nguyễn Mobile/)
    const a = div.querySelector('a')!
    expect(a.className.split(' ')).toEqual(expect.arrayContaining(['underline', 'text-accent-foreground']))
    expect(a.className).not.toContain('tap-44')
    expect(a.getAttribute('href')).toBe('https://shop.example/p')
    expect(a.getAttribute('rel')).toBe('sponsored nofollow noopener noreferrer')
    expect(a.getAttribute('target')).toBe('_blank')
  })
  it('the CTA\'s copy: as it always was, plus the caller\'s class (the goods tier passes max-md:hidden)', () => {
    const p = html(<ImportProvenance kind="retail" site="Shop" iso={null} href="https://shop.example/p" className="max-md:hidden" />).querySelector('p')!
    expect(p.getAttribute('data-import-provenance')).toBe('true')
    expect(p.className).toBe('text-xs text-body max-md:hidden')
    expect(p.querySelector('a')!.className).toContain('tap-44')
  })
})

// ⛔ Build 7: a short table (the bike's price by rental length) as a 2-column grid of label over value below md.
describe('ListingDescription `goods`: a short table as a grid', () => {
  it('gridTables: 2, 4 or 6 short rows; a long value, an odd count or no table is not', () => {
    expect([...gridTables(BIKE)]).toEqual([1])
    expect(gridTables('Price\n\nScreen: 6.7-inch OLED, 120Hz ProMotion\nChip: A17 Pro').size).toBe(0)
    expect(gridTables('A: 1\nB: 2\nC: 3').size).toBe(0)
    expect(gridTables('Just words.').size).toBe(0)
  })
  it('the bike\'s table carries `data-table-grid` (and its fold class); the rules are max-md: and keyed on the mark', () => {
    const { container } = render(en(<ListingDescription text={BIKE} goods />))
    const box = container.querySelector('.allow-select')!
    const dl = box.querySelector('dl')!
    expect(dl.hasAttribute('data-table-grid')).toBe(true)
    expect(dl.className).toContain('max-md:mb-0')
    const grid = box.className.split(' ').filter((c) => c.includes('data-table-grid'))
    expect(grid).toEqual(expect.arrayContaining(['max-md:[&>dl[data-table-grid]]:grid', 'max-md:[&>dl[data-table-grid]]:grid-cols-2', 'max-md:[&>dl[data-table-grid]_dd]:font-normal', 'max-md:[&>dl[data-table-grid]_dt]:text-t-meta']))
    for (const c of grid) expect(c).toMatch(/^max-md:/)
  })
  it('without `goods` no mark', () => {
    const { container } = render(en(<ListingDescription text={BIKE} />))
    expect(container.querySelector('dl')!.hasAttribute('data-table-grid')).toBe(false)
  })
})

// ⛔ Build 7: Seller information takes the source line in place of its "Source" row below md (`sourceLine`); unboxed.
describe('SellerInfo `sourceLine` (the goods sheet)', () => {
  const info = { kind: 'source' as const, source: 'Tuấn Nguyễn Mobile', action: 'buy' as const }
  const SOURCE = "Source: Tuấn Nguyễn Mobile's website"
  const line = <p data-line="">{SOURCE}</p>
  it('the line right under the heading, the row hidden below md, the caption after; the heading 8px over it', () => {
    const { container } = render(en(<SellerInfo info={info} panel sourceLine={line} />))
    const kids = [...container.querySelector('section')!.children]
    expect(kids[0].tagName).toBe('H2')
    expect(kids[0].className).toContain('max-md:mb-2')
    expect(kids[1].hasAttribute('data-line')).toBe(true)
    expect(kids[2].tagName).toBe('DL')
    expect(kids[2].className).toContain('max-md:hidden')
    // (vitest builds the services edition, which names eno.forum: the caption is the edition's own, every word kept.)
    expect(kids[3].textContent).toMatch(/is not the seller here; you contact or buy on the source website\.$/)
  })
  it('without it the row is shown as before', () => {
    const { container } = render(en(<SellerInfo info={info} panel />))
    expect(container.querySelector('dl')!.className).not.toContain('max-md:hidden')
    expect(container.querySelector('dl')!.textContent).toContain('Tuấn Nguyễn Mobile')
  })
})

describe('Shelf `phoneGrid`', () => {
  it('below sm: the feed grid (2 columns, the 4px gap and bleed), full rows only; all max-sm:', () => {
    for (const c of PHONE_GRID.split(' ')) expect(c).toMatch(/^max-sm:/)
    expect(PHONE_GRID).toContain('max-sm:grid-cols-2')
    expect(PHONE_GRID).toContain('max-sm:gap-x-1')
    expect(PHONE_GRID).toContain('max-sm:[&>:last-child:nth-child(odd):not(:first-child)]:hidden')
  })
})
