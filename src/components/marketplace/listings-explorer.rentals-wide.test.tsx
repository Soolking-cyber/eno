// @vitest-environment jsdom
/**
 * ⛔ THE RENTALS FEED IS ONE COLUMN OF LARGE SQUARE CARDS ON A PHONE (owner-approved 2026-11-14, cook r06 rentals-a —
 * listings-explorer.tsx `rentalsWide`), through the REAL explorer (listings-explorer.jobs-rows.test.tsx's harness).
 *
 * The grid view of `?category=rentals` draws LISTING_GRID_WIDE and every card `wide` (its classes are all `max-sm:`, so no
 * width is read and the same tree serves every screen), the guest row `tight`, and the sticky row `stayPinned`. Every other
 * feed, the list view and the undirected home keep the two-up grid. Pinned here as with the Jobs rows: the presentation
 * follows the cards ON SCREEN, so a category change never re-lays the previous feed's cards in the next feed's shape.
 */
import React from 'react'
import { act, cleanup, configure, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCategory, SerializedListingCard } from '@/lib/types'
import { installFakeIntersectionObserver } from '@/test/fake-intersection-observer'
import { __resetBackToCloseForTests } from '@/lib/back-to-close'
import { __resetAreaCachesForTests } from '@/lib/vn-areas'

configure({ asyncUtilTimeout: 5_000 })
vi.setConfig({ testTimeout: 30_000 })

const h = vi.hoisted(() => {
  const router = { push: () => {}, prefetch: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }
  const tr = (en: string) => en
  const language = { lang: 'en', t: (k: string) => k, tr, setLang: () => {} }
  const auth = { user: null, profile: null, loading: false, openSignIn: () => {} }
  return { router, language, auth }
})

vi.mock('next/navigation', () => ({
  useRouter: () => h.router,
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(window.location.search),
}))
// Everything behind next/dynamic is stubbed out, except that a component handed a `listing` (the list row) leaves a marker.
vi.mock('next/dynamic', () => ({
  default: () => function Dyn({ listing }: { listing?: SerializedListingCard }) {
    return listing ? <div data-testid="row" data-id={listing.id} /> : null
  },
}))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => h.language,
  useTr: (s: string) => s,
  Tr: ({ text }: { text?: string | null }) => <>{text}</>,
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => h.auth }))
vi.mock('@/hooks/use-dashboard', () => ({ useDashboard: () => ({ dash: null, refresh: () => {}, loading: false, error: null, fresh: true }) }))
vi.mock('@/lib/analytics', () => ({ trackSearch: () => {} }))
vi.mock('./listing-card', () => ({
  ListingCard: function ListingCard({ listing, wide, sizes, holdPhoto }: { listing: SerializedListingCard; wide?: boolean; sizes?: string; holdPhoto?: boolean }) {
    return <button type="button" data-testid="card" data-id={listing.id} data-wide={String(!!wide)} data-sizes={sizes ?? ''} data-hold={String(!!holdPhoto)}>{listing.title}</button>
  },
}))
// The explorer preloads the row's chunk when a list is coming; here that must not evaluate the real row.
vi.mock('./compact-listing-row', () => ({ CompactListingRow: () => null }))
vi.mock('./category-rail', () => ({ CategoryRail: () => null }))
vi.mock('./capture-card', () => ({ CaptureCard: ({ tight }: { tight?: boolean }) => <div data-testid="capture" data-tight={String(!!tight)} /> }))
vi.mock('./brand-rail', () => ({ BrandRail: () => null }))
vi.mock('./for-you-rail', () => ({ ForYouRail: () => null }))
vi.mock('./recently-viewed-rail', () => ({ RecentlyViewedRail: () => null }))
vi.mock('./business-rail', () => ({ BusinessRail: () => null }))
vi.mock('./trending-searches', () => ({ TrendingSearches: () => null }))
vi.mock('./ai-concierge', () => ({ AISearchButton: () => null }))

import { ListingsExplorer, __resetExplorerCommittedForTests } from './listings-explorer'
import { LISTING_GRID, LISTING_GRID_WIDE, WIDE_CARD_SIZES } from './listing-grid'

// ─── A fake /api/listings ────────────────────────────────────────────────────────────────────────
const row = (id: string, category: string, extra: Record<string, unknown> = {}): SerializedListingCard =>
  ({
    id, title: `${category} #${id}`, titleVi: null, price: 1_000_000, location: 'Ho Chi Minh City', district: 'District 1',
    postedAt: '2026-09-01T00:00:00.000Z', contactCount: 0, category: { slug: category, name: category }, ...extra,
  } as unknown as SerializedListingCard)

const RENTALS = Array.from({ length: 20 }, (_, i) => row(`rent-${i}`, 'rentals'))
const GOODS = Array.from({ length: 20 }, (_, i) => row(`good-${i}`, 'electronics'))

function answer(url: URL) {
  const set = url.searchParams.get('category') === 'electronics' ? GOODS : RENTALS
  const offset = Number(url.searchParams.get('offset') ?? 0)
  const limit = Number(url.searchParams.get('limit') ?? 12)
  return { listings: set.slice(offset, offset + limit), total: set.length, offset, limit, subcategoryCounts: {}, categoryTotal: set.length, facets: {} }
}
function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    const url = new URL(u, 'https://eno.vn')
    const body = url.pathname === '/api/listings' ? answer(url) : {}
    return { ok: true, status: 200, json: async () => body } as Response
  }))
}

/** The one media query that matters here: `useIsPhone`'s. Everything else answers "no". */
let phone = true
function installDomStubs() {
  installFakeIntersectionObserver()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: phone && q === '(max-width: 639.98px)', media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  window.scrollTo = (() => {}) as typeof window.scrollTo
  window.scrollBy = (() => {}) as typeof window.scrollBy
  Element.prototype.scrollIntoView = () => {}
}

const CATEGORIES = [
  { id: 'c1', slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê', icon: 'home' },
  { id: 'c3', slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử', icon: 'Smartphone' },
] as unknown as SerializedCategory[]

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } })
function mountAt(url: string) {
  window.history.pushState({ __NA: true }, '', url)
  return render(
    <QueryClientProvider client={client()}>
      <ListingsExplorer categories={CATEGORIES} initialListings={[]} initialTotal={0} initialFetchedAt={Date.now()} />
    </QueryClientProvider>,
  )
}
const ids = (testid: string) => screen.queryAllByTestId(testid).map((c) => c.getAttribute('data-id'))
const cardIds = () => ids('card')
const wideIds = () => screen.queryAllByTestId('card').filter((c) => c.getAttribute('data-wide') === 'true').map((c) => c.getAttribute('data-id'))
const gridOf = () => screen.getAllByTestId('card')[0].closest('[data-feed-card]')!.parentElement!
/** Another address in the same document (a category tap, Back): the explorer re-reads it on popstate. */
const go = (url: string) => act(() => { window.history.replaceState(window.history.state, '', url); window.dispatchEvent(new PopStateEvent('popstate')) })

/**
 * Every card the document EVER draws wide that is not a rental, caught as it is drawn. A transition that re-laid the cards on
 * screen before its answer came would show up here for one commit and nowhere else.
 */
let wrong: string[] = []
let watcher: MutationObserver | null = null
function watchShapes() {
  wrong = []
  const scan = () => {
    for (const id of wideIds()) if (id && !id.startsWith('rent-')) wrong.push(`wide:${id}`)
  }
  watcher = new MutationObserver(scan)
  watcher.observe(document.body, { childList: true, subtree: true })
}

beforeEach(() => {
  phone = true
  __resetExplorerCommittedForTests()
  __resetBackToCloseForTests()
  __resetAreaCachesForTests()
  sessionStorage.clear()
  installDomStubs()
  stubFetch()
})
afterEach(() => {
  watcher?.disconnect(); watcher = null
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})

describe('the rentals feed on a phone: one column of large square cards (owner-approved 2026-11-14)', () => {
  it('?category=rentals: LISTING_GRID_WIDE, every card wide with the full-width sizes, held from the third', async () => {
    mountAt('/?category=rentals')
    await waitFor(() => expect(cardIds()).toEqual(RENTALS.slice(0, 12).map((r) => r.id)))
    expect(gridOf().className.split(' ')).toEqual(expect.arrayContaining(['feed-grid', ...LISTING_GRID_WIDE.split(' '), 'max-sm:[&>.col-span-full]:px-0']))
    expect(wideIds()).toHaveLength(12)
    const cards = screen.getAllByTestId('card')
    expect(cards.every((c) => c.getAttribute('data-sizes') === WIDE_CARD_SIZES)).toBe(true)
    expect(cards.map((c) => c.getAttribute('data-hold'))).toEqual(['false', 'false', ...Array(10).fill('true')])
    expect(cards.every((c) => c.closest('[data-feed-card]')!.hasAttribute('data-wide-cell'))).toBe(true)
  })

  it('the guest row is tight and the sticky row stays pinned there', async () => {
    mountAt('/?category=rentals')
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    expect(screen.getByTestId('capture').getAttribute('data-tight')).toBe('true')
    expect(document.getElementById('explorer-toolbar')!.getAttribute('data-stay-pinned')).toBe('true')
  })

  it('every other feed keeps the two-up grid, its guest row and its toolbar as they were', async () => {
    mountAt('/?category=electronics')
    await waitFor(() => expect(cardIds()[0]).toBe('good-0'))
    expect(wideIds()).toEqual([])
    expect(gridOf().className.split(' ')).toEqual(expect.arrayContaining(LISTING_GRID.split(' ')))
    expect(screen.getByTestId('capture').getAttribute('data-tight')).toBe('false')
    // ⛔ The strip pins here too since build 8 — not as the rentals row, as the GOODS strip (owner-approved 2026-11-15, cook r08
    // goods: electronics is a goods feed, `goodsLook`, and SortStrip `look="goods"` comes with it).
    const bar = document.getElementById('explorer-toolbar')!
    expect(bar.getAttribute('data-stay-pinned')).toBe('true')
    expect(bar.getAttribute('data-pills')).toBe('filled')
  })

  it('⛔ the one control row (owner, 2026-11-16, hub Q17): the view circle leads the pinned strip, and build 8\'s floating Map keeps its host beside it', async () => {
    const { MAP_FLOAT } = await import('./map-float')
    mountAt('/?category=rentals')
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    const bar = document.getElementById('explorer-toolbar')!
    await waitFor(() => expect(bar.querySelector('[data-scope-chip]')).not.toBeNull())
    expect(bar.querySelector('[data-scope-chip]')!.textContent).toBe('Rentals')
    expect(within(bar).getByRole('combobox', { name: /View/ })).toBeTruthy()
    // The floated Map: the same "Map view" toggle, in a `group/mapfloat` host that has no box of its own on a phone.
    const host = bar.querySelector<HTMLElement>('.group\\/mapfloat')!
    expect(host.className).toContain('max-sm:contents')
    const map = within(host).getByRole('button', { name: 'Map view' })
    for (const c of MAP_FLOAT.split(' ').slice(0, 3)) expect(map.className).toContain(c)
    // Every other desktop toggle steps down on a phone.
    for (const name of ['List view', 'Grid view']) expect(within(host).getByRole('button', { name }).className).toContain('max-sm:hidden')
    // The results row holds no second copy.
    expect(document.querySelector('#results [data-view-cluster]')).toBeNull()
  })

  it('the list view of rentals is not the wide grid', async () => {
    mountAt('/?category=rentals&view=compact')
    await waitFor(() => expect(screen.queryAllByTestId('row').length).toBe(12))
    expect(wideIds()).toEqual([])
  })

  it('⛔ into Rentals: the cards on screen keep their two-up shape until the rentals answer is drawn', async () => {
    mountAt('/?category=electronics')
    await waitFor(() => expect(cardIds()[0]).toBe('good-0'))
    watchShapes()
    await go('/?category=rentals')
    await waitFor(() => expect(wideIds()).toEqual(RENTALS.slice(0, 12).map((r) => r.id)))
    expect(wrong).toEqual([])
  })

  it('⛔ out of Rentals: the next feed\'s cards are never drawn wide', async () => {
    mountAt('/?category=rentals')
    await waitFor(() => expect(wideIds()).toHaveLength(12))
    watchShapes()
    await go('/?category=electronics')
    await waitFor(() => expect(cardIds()[0]).toBe('good-0'))
    expect(wideIds()).toEqual([])
    expect(wrong).toEqual([])
  })
})
