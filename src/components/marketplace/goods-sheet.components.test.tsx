// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { act } from 'react'
import { LanguageProvider } from '@/context/language-context'
import { ListingDescription } from './listing-content'
import { PinnedRegion, StickyActionBarSpacer } from '@/components/ui/sticky-action-bar'
import { ImportProvenance } from './import-provenance'
import { PHONE_GRID } from './shelf'

/**
 * ⛔ THE GOODS SHEET'S COMPONENTS (owner-approved 2026-11-14, cook r06 "item"; src/lib/goods-sheet.ts): the description's fold
 * at its first table, the pinned tier's publishing, the inline source link and the shelves' phone grid. The seller band is in
 * pdp-shop-link.band.test.tsx, the plain photo in listing-gallery.plain.test.tsx.
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

describe('ImportProvenance `inline` (under the pinned button)', () => {
  it('an underlined text link below md with its 44px area switched off there; same href, rel and target', () => {
    const html = renderToString(en(<ImportProvenance kind="retail" site="Tuấn Nguyễn Mobile" iso={null} href="https://shop.example/p" inline />))
    const div = document.createElement('div')
    div.innerHTML = html
    const a = div.querySelector('a')!
    expect(a.className).toContain('max-md:underline')
    expect(a.className).toContain('max-md:before:content-none!')
    expect(a.getAttribute('rel')).toBe('sponsored nofollow noopener noreferrer')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(div.querySelector('p')!.className).toContain('max-md:text-center')
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
