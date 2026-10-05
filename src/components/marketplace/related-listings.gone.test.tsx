// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'

/**
 * B8-GONE-LANDERS: the gone page's "Similar second-hand listings" rail (RelatedListings variant 'gone').
 * Pinned END TO END: the queries the rail sends, then those exact queries through the feed's own filter
 * builder — so "used only, live only, edition-scoped" is proven of what the rail actually asks for, not
 * of a query string written out by hand.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('./listing-card', () => ({ ListingCard: ({ listing }: { listing: { id: string } }) => <article data-card={listing.id} /> }))
vi.mock('next/link', () => ({
  default: ({ href, children, prefetch: _p, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => <a href={href} {...rest}>{children}</a>,
}))
// The feed builder's server dependencies. The edition scope answers with a recognisable desk exclusion and
// teacher exclusion, so the test can see both reach the `where`.
const DESK_SCOPE = { sellerId: { notIn: ['visa-desk-seller'] } }
const TEACHERS = { categoryId: { not: 'teachers-category' } }
vi.mock('@/lib/db', () => ({ db: { listing: { groupBy: vi.fn(async () => []), findFirst: vi.fn(async () => null) }, category: { findUnique: vi.fn(async () => null) } } }))
vi.mock('@/lib/edition-scope', () => ({
  scopedListingWhere: async (w: unknown) => ({ AND: [w, DESK_SCOPE] }),
  marketplaceListingScope: async () => DESK_SCOPE,
  teacherExclusion: async () => TEACHERS,
}))
vi.mock('@/lib/serialize', () => ({ LISTING_CARD_SELECT: {}, serializeListingCard: (r: unknown) => r }))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: async (l: unknown) => l }))

import { RelatedListings } from './related-listings'
import { buildFeedFilters } from '@/app/api/listings/feed-query'
import { conditionWhere } from '@/lib/listing-condition'

let urls: string[] = []
beforeEach(() => {
  urls = []
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  // Every pass answers with one card, so the rail never reaches "enough" and asks every scope it has.
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    urls.push(u)
    return { ok: true, json: async () => ({ listings: [{ id: `c${urls.length}`, sellerId: 's2' }] }) }
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'languages')
})

function renderIn(lang: 'en' | 'vi', node: React.ReactNode) {
  Object.defineProperty(navigator, 'languages', { configurable: true, get: () => (lang === 'vi' ? ['vi-VN', 'vi'] : ['en-US', 'en']) })
  return render(<LanguageProvider initialLang={lang} initialViDict={{}}>{node}</LanguageProvider>)
}
const params = (u: string) => new URLSearchParams(u.slice(u.indexOf('?') + 1))
const has = (andFilters: unknown[], clause: unknown) => andFilters.some((f) => JSON.stringify(f) === JSON.stringify(clause))

describe('RelatedListings — the gone variant', () => {
  it('asks narrowest first — brand + model, the shelf’s brand, the shelf, the category — and EVERY pass is condition=used', async () => {
    const { container } = renderIn('en', <RelatedListings listingId="L1" categorySlug="electronics" subcategorySlug="phones-tablets" brandSlug="oppo" model="A6c" variant="gone" />)
    await act(async () => {})
    expect(urls.map((u) => Object.fromEntries([...params(u)].filter(([k]) => k !== 'limit' && k !== 'sort')))).toEqual([
      { category: 'electronics', brand: 'oppo', model: 'A6c', condition: 'used' },
      { category: 'electronics', subcategory: 'phones-tablets', brand: 'oppo', condition: 'used' },
      { category: 'electronics', subcategory: 'phones-tablets', condition: 'used' },
      { category: 'electronics', condition: 'used' },
    ])
    expect(screen.getByText('Similar second-hand listings')).toBeTruthy()
    expect(container.querySelectorAll('[data-card]')).toHaveLength(4)
  })

  it('⛔ a row with no brand, model or shelf asks for NOTHING — newest used electronics are not "similar" to a mis-filed book', async () => {
    renderIn('en', <RelatedListings listingId="L1" categorySlug="electronics" variant="gone" />)
    await act(async () => {})
    expect(urls).toHaveLength(0)
    expect(document.body.textContent).not.toContain('Similar second-hand listings')
  })

  it('⛔ a brand but no shelf: the brand within its category — never the plain category', async () => {
    renderIn('en', <RelatedListings listingId="L1" categorySlug="electronics" brandSlug="oppo" variant="gone" />)
    await act(async () => {})
    expect(urls.map((u) => Object.fromEntries([...params(u)].filter(([k]) => k !== 'limit' && k !== 'sort')))).toEqual([
      { category: 'electronics', brand: 'oppo', condition: 'used' },
    ])
  })

  it('a row with a shelf but no brand still gets the category pass after the shelf', async () => {
    renderIn('en', <RelatedListings listingId="L1" categorySlug="furniture-appliances" subcategorySlug="sofa-seating" variant="gone" />)
    await act(async () => {})
    expect(urls.map((u) => params(u).get('subcategory'))).toEqual(['sofa-seating', null])
    expect(urls.every((u) => params(u).get('condition') === 'used')).toBe(true)
  })

  it('holds its place while loading (it sits under the item’s name), and says it in Vietnamese', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { container } = renderIn('vi', <RelatedListings listingId="L1" categorySlug="electronics" subcategorySlug="phones" variant="gone" />)
    expect(container.querySelector('[data-related-loading]')).not.toBeNull()
    expect(screen.getByText('Tin tương tự đã qua sử dụng')).toBeTruthy()
  })

  it('⛔ what it asks the feed for is used, verified, active and edition-scoped — through buildFeedFilters itself', async () => {
    renderIn('en', <RelatedListings listingId="L1" categorySlug="electronics" subcategorySlug="phones-tablets" brandSlug="oppo" model="A6c" variant="gone" />)
    await act(async () => {})
    expect(urls).toHaveLength(4)
    for (const u of urls) {
      const { andFilters } = await buildFeedFilters(params(u))
      expect(has(andFilters, { verified: true }), u).toBe(true)
      expect(has(andFilters, { status: 'active' }), u).toBe(true)
      // The edition boundary (the visa/trip desk never on eno.vn) and the teacher exclusion, as their own clauses.
      expect(has(andFilters, DESK_SCOPE), u).toBe(true)
      expect(has(andFilters, TEACHERS), u).toBe(true)
      // The one definition of "used": has a condition, and it is not new-ish.
      expect(has(andFilters, conditionWhere('used')), u).toBe(true)
    }
    // ⛔ The narrowest pass really narrows to the model (gate, 2026-10-05): feed-query.ts turns `model=` into a clause
    // carrying the catalogue value, and only that pass asks for it.
    const [first, ...rest] = await Promise.all(urls.map(async (u) => JSON.stringify((await buildFeedFilters(params(u))).andFilters)))
    expect(first).toContain('A6c')
    for (const r of rest) expect(r).not.toContain('A6c')
  })

  it('the PDP and sold rails are unchanged: no condition filter, no model pass', async () => {
    for (const variant of ['pdp', 'sold'] as const) {
      urls = []
      renderIn('en', <RelatedListings listingId="L1" categorySlug="electronics" subcategorySlug="phones-tablets" brandSlug="oppo" model="A6c" variant={variant} />)
      await act(async () => {})
      expect(urls.length, variant).toBe(3)
      for (const u of urls) {
        expect(params(u).has('condition'), u).toBe(false)
        expect(params(u).has('model'), u).toBe(false)
      }
      cleanup()
    }
  })
})
