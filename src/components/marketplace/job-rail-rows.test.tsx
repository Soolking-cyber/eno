// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'

/**
 * Batch 67: a job page's rails are rows on a phone. The Shelf draws both shapes when handed `phoneRows` (rows `sm:hidden`, the
 * rail `max-sm:hidden`) and is unchanged without it; "More like this" holds rows in its placeholder when the listing is a job,
 * and draws rows once every listing it got is a job.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('./listing-card', () => ({ ListingCard: ({ listing }: { listing: { id: string } }) => <article data-card={listing.id} /> }))
vi.mock('next/link', () => ({
  default: ({ href, children, prefetch: _p, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('./job-rail-rows', async (orig) => {
  const real = await orig<typeof import('./job-rail-rows')>()
  return { ...real, JobRailRows: ({ listings }: { listings: { id: string }[] }) => <>{listings.slice(0, real.JOB_RAIL_ROWS).map((l) => <div key={l.id} data-row={l.id} />)}</> }
})

import { Shelf } from './shelf'
import { RelatedListings } from './related-listings'
import { SameSellerShelf } from './same-seller-shelf'
import { allJobs } from './job-rail-rows'
import type { SerializedListingCard } from '@/lib/types'

let answer: (body: unknown) => void
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('IntersectionObserver', class { constructor(cb: (e: { isIntersecting: boolean }[]) => void) { setTimeout(() => cb([{ isIntersecting: true }]), 0) } observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { answer = (body) => resolve({ ok: true, json: () => Promise.resolve(body) }) })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const wrap = (node: React.ReactNode) => render(<LanguageProvider initialLang="en" initialViDict={{}}>{node}</LanguageProvider>)
const listings = (n: number, slug: string) => Array.from({ length: n }, (_, i) => ({ id: `j${i}`, sellerId: 's2', category: { slug } })) as unknown as SerializedListingCard[]
const TITLE = 'More like this'
const ROW = 'row'
const CARD = 'card'

describe('Shelf phoneRows', () => {
  it('without it the rail is drawn as before: no phone rows, no width wrapper', () => {
    const { container } = wrap(<Shelf title={TITLE}><div data-x="">{CARD}</div></Shelf>)
    expect(container.querySelector('[data-phone-rows]')).toBeNull()
    expect(container.querySelector('.max-sm\\:hidden')).toBeNull()
    expect(container.querySelector('[data-shelf-items]')).not.toBeNull()
  })
  it('with it: rows below sm, the rail from sm, one shared header', () => {
    const { container } = wrap(<Shelf title={TITLE} phoneRows={<div data-r="">{ROW}</div>}><div data-x="">{CARD}</div></Shelf>)
    const rows = container.querySelector('[data-phone-rows]')!
    expect(rows.className).toContain('sm:hidden')
    expect(rows.querySelector('[data-r]')).not.toBeNull()
    expect(container.querySelector('[data-shelf-items]')!.closest('.max-sm\\:hidden')).not.toBeNull()
    expect(container.querySelectorAll('h2')).toHaveLength(1)
  })
})

describe('allJobs', () => {
  it('true only for a non-empty list of jobs', () => {
    expect(allJobs(listings(3, 'jobs'))).toBe(true)
    expect(allJobs([...listings(2, 'jobs'), ...listings(1, 'electronics')])).toBe(false)
    expect(allJobs([])).toBe(false)
  })
})

describe('RelatedListings on a job page', () => {
  it('the placeholder holds rows on a phone for a job, and none for other categories', () => {
    const job = wrap(<RelatedListings listingId="l1" categorySlug="jobs" />)
    expect(job.container.querySelector('[data-related-loading] [data-phone-rows]')).not.toBeNull()
    cleanup()
    const other = wrap(<RelatedListings listingId="l1" categorySlug="electronics" />)
    expect(other.container.querySelector('[data-related-loading]')).not.toBeNull()
    expect(other.container.querySelector('[data-phone-rows]')).toBeNull()
  })
  it('an all-jobs answer draws at most four rows on a phone and keeps the cards from sm', async () => {
    const { container } = wrap(<RelatedListings listingId="l1" categorySlug="jobs" />)
    await act(async () => { await new Promise((r) => setTimeout(r, 5)) })
    await act(async () => { answer({ listings: listings(9, 'jobs') }) })
    const rows = container.querySelector('[data-phone-rows]')
    expect(rows).not.toBeNull()
    expect(rows!.querySelectorAll('[data-row]')).toHaveLength(4)
    expect(container.querySelectorAll('[data-card]').length).toBeGreaterThan(0)
  })
})

describe('SameSellerShelf on a job page', () => {
  it('a seller whose other listings are all jobs: at most four rows on a phone, the cards from sm', () => {
    const { container } = wrap(<SameSellerShelf listings={listings(6, 'jobs')} sellerHref="/s/x" sellerName="Nord Anglia" />)
    const rows = container.querySelector('[data-phone-rows]')!
    expect(rows.className).toContain('sm:hidden')
    expect(rows.querySelectorAll('[data-row]')).toHaveLength(4)
    expect(container.querySelector('[data-shelf-items]')!.closest('.max-sm\\:hidden')).not.toBeNull()
    expect(container.querySelectorAll('[data-card]')).toHaveLength(6)
  })
  it('any other seller keeps the rail alone', () => {
    const { container } = wrap(<SameSellerShelf listings={[...listings(2, 'jobs'), ...listings(1, 'electronics')]} sellerHref="/s/x" sellerName="Shop" />)
    expect(container.querySelector('[data-phone-rows]')).toBeNull()
    expect(container.querySelector('.max-sm\\:hidden')).toBeNull()
  })
})

