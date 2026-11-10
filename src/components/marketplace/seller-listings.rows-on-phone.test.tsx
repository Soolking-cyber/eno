// @vitest-environment jsdom
/**
 * `phoneRow` (owner, 2026-11-10: item 2 of the decision scorecard): on a phone the Jobs category page is a list of rows,
 * from `sm` up the cards it always was. The page is ONE cached document for every screen, so both shapes are in the HTML
 * and a class picks one. jsdom loads no stylesheet; what it can hold is that both are there, which class each carries, the
 * order they come in (a phone's rows must be parsed before the first-paint mark), and which images may load eagerly.
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en }),
  Tr: ({ text }: { text: string }) => <>{text}</>,
}))
vi.mock('./listing-card', () => ({
  ListingCard: ({ listing, priority, lcp }: { listing: SerializedListingCard; priority?: boolean; lcp?: boolean }) => (
    <article data-testid="card" data-id={listing.id} data-priority={String(!!priority)} data-lcp={String(!!lcp)} />
  ),
}))
import { SellerListings } from './seller-listings'

/** The row is handed in (`phoneRow`); here it is a marker that records what it was handed. */
function Row({ listing, index, clockInHtml, lazyThumb }: { listing: SerializedListingCard; index: number; clockInHtml?: boolean; lazyThumb?: boolean }) {
  return <div data-testid="row" data-id={listing.id} data-index={index} data-clock={String(!!clockInHtml)} data-lazy={String(!!lazyThumb)} />
}

const job = (id: string): SerializedListingCard =>
  ({ id, title: id, titleVi: null, price: 0, location: 'Ho Chi Minh City', district: 'District 1', postedAt: '2026-09-01T00:00:00.000Z', contactCount: 0, sellerId: `s-${id}` } as unknown as SerializedListingCard)
const JOBS = Array.from({ length: 6 }, (_, i) => job(`job-${i}`))

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })

const ids = (sel: string) => Array.from(document.querySelectorAll(sel)).map((e) => e.getAttribute('data-id'))

describe('SellerListings phoneRow', () => {
  it('draws the same listings twice: rows that leave at sm, cards that arrive at sm', () => {
    render(<SellerListings listings={JOBS} phoneRow={Row} />)
    const rows = document.querySelector('[data-phone-rows]') as HTMLElement
    expect(rows.className.split(' ')).toContain('sm:hidden')
    expect(ids('[data-phone-rows] [data-testid="row"]')).toEqual(JOBS.map((j) => j.id))
    const grid = document.querySelector('[data-testid="card"]')!.parentElement!.parentElement as HTMLElement
    expect(grid.className.split(' ')).toContain('max-sm:hidden')
    expect(ids('[data-testid="card"]')).toEqual(JOBS.map((j) => j.id))
  })

  it('puts the rows BEFORE the cards, so a phone has them by the time the first-paint mark (the fourth card) is parsed', () => {
    render(<SellerListings listings={JOBS} phoneRow={Row} />)
    const rows = document.querySelector('[data-phone-rows]')!
    const mark = document.getElementById('first-screen-end')!
    expect(mark.querySelector('[data-testid="card"]')!.getAttribute('data-id')).toBe('job-3')
    expect(rows.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // One mark on the page, and it is not in the rows.
    expect(document.querySelectorAll('#first-screen-end')).toHaveLength(1)
    expect(rows.querySelector('#first-screen-end')).toBeNull()
  })

  it('lets one image load eagerly (the first card, the wide screen\'s largest paint); a hidden eager image still loads', () => {
    render(<SellerListings listings={JOBS} phoneRow={Row} />)
    const cards = Array.from(document.querySelectorAll('[data-testid="card"]'))
    expect(cards.map((c) => c.getAttribute('data-priority'))).toEqual(['true', 'false', 'false', 'false', 'false', 'false'])
    expect(cards[0].getAttribute('data-lcp')).toBe('true')
    // Every row: the server-safe clock, and a thumbnail that never loads eagerly.
    for (const r of Array.from(document.querySelectorAll('[data-testid="row"]'))) {
      expect(r.getAttribute('data-clock')).toBe('true')
      expect(r.getAttribute('data-lazy')).toBe('true')
    }
  })

  it('keeps each row under its seller id, so a blocked shop\'s rows are hidden like its cards', () => {
    render(<SellerListings listings={JOBS} phoneRow={Row} />)
    const wrappers = Array.from(document.querySelectorAll('[data-phone-rows] > [data-sid]'))
    expect(wrappers.map((w) => w.getAttribute('data-sid'))).toEqual(JOBS.map((j) => j.sellerId))
  })

  it('does not import the row itself: the row reaches a page only through the wrapper that page renders', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/components/marketplace/seller-listings.tsx', 'utf8')
    // A type-only import is erased; a value import (or next/dynamic) would put the row's code on every category page and shop.
    expect(src).toContain("import type { CompactListingRowProps } from './compact-listing-row'")
    expect(src).not.toMatch(/import \{[^}]*\} from '\.\/compact-listing-row'/)
    expect(src).not.toMatch(/from 'next\/dynamic'/)
    const wrapper = readFileSync('src/components/marketplace/seller-listings-phone-rows.tsx', 'utf8')
    expect(wrapper).toContain("import { CompactListingRow } from './compact-listing-row'")
    expect(wrapper).toContain('<SellerListings {...props} phoneRow={CompactListingRow} />')
  })

  it('without the prop nothing changes: no rows, no class on the grid, four eager cards', () => {
    render(<SellerListings listings={JOBS} />)
    expect(document.querySelector('[data-phone-rows]')).toBeNull()
    expect(document.querySelectorAll('[data-testid="row"]')).toHaveLength(0)
    const grid = document.querySelector('[data-testid="card"]')!.parentElement!.parentElement as HTMLElement
    expect(grid.className).not.toContain('max-sm:hidden')
    expect(Array.from(document.querySelectorAll('[data-testid="card"]')).map((c) => c.getAttribute('data-priority'))).toEqual(['true', 'true', 'true', 'true', 'false', 'false'])
  })
})
