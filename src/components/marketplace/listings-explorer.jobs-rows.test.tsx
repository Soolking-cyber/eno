// @vitest-environment jsdom
/**
 * ⛔ JOBS READ AS ROWS ON A PHONE (owner, 2026-11-10: "1-6 1 by one go", item 2 of the decision scorecard), through the REAL
 * explorer (the listings-explorer.history.test.tsx harness: a fake /api/listings, the heavy children stubbed).
 *
 * Below `sm`, the Jobs category draws its default view as the list; every other feed, every wider screen and an asked-for
 * grid keep the cards. What is pinned here is the part a screenshot cannot hold: the presentation follows the rows ON
 * SCREEN, so a category change never re-lays the previous feed's rows in the next feed's shape for a commit.
 */
import React from 'react'
import { act, cleanup, configure, render, screen, waitFor } from '@testing-library/react'
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
  ListingCard: function ListingCard({ listing }: { listing: SerializedListingCard }) {
    return <button type="button" data-testid="card" data-id={listing.id}>{listing.title}</button>
  },
}))
// The explorer preloads the row's chunk when a list is coming; here that must not evaluate the real row.
vi.mock('./compact-listing-row', () => ({ CompactListingRow: () => null }))
vi.mock('./category-rail', () => ({ CategoryRail: () => null }))
vi.mock('./capture-card', () => ({ CaptureCard: () => <div data-testid="capture" /> }))
vi.mock('./brand-rail', () => ({ BrandRail: () => null }))
vi.mock('./for-you-rail', () => ({ ForYouRail: () => null }))
vi.mock('./recently-viewed-rail', () => ({ RecentlyViewedRail: () => null }))
vi.mock('./business-rail', () => ({ BusinessRail: () => null }))
vi.mock('./trending-searches', () => ({ TrendingSearches: () => null }))
vi.mock('./ai-concierge', () => ({ AISearchButton: () => null }))

import { ListingsExplorer, __resetExplorerCommittedForTests } from './listings-explorer'

// ─── A fake /api/listings ────────────────────────────────────────────────────────────────────────
const row = (id: string, category: string, extra: Record<string, unknown> = {}): SerializedListingCard =>
  ({
    id, title: `${category} #${id}`, titleVi: null, price: 1_000_000, location: 'Ho Chi Minh City', district: 'District 1',
    postedAt: '2026-09-01T00:00:00.000Z', contactCount: 0, category: { slug: category, name: category }, ...extra,
  } as unknown as SerializedListingCard)

const RENTALS = Array.from({ length: 20 }, (_, i) => row(`rent-${i}`, 'rentals'))
const JOBS = Array.from({ length: 20 }, (_, i) => row(`job-${i}`, 'jobs', { listingType: 'job', price: 0 }))

function answer(url: URL) {
  const set = url.searchParams.get('category') === 'jobs' ? JOBS : RENTALS
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
  { id: 'c2', slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm', icon: 'Briefcase' },
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
const rowIds = () => ids('row')
/** Another address in the same document (a category tap, Back): the explorer re-reads it on popstate. */
const go = (url: string) => act(() => { window.history.replaceState(window.history.state, '', url); window.dispatchEvent(new PopStateEvent('popstate')) })

/**
 * Every listing the document EVER draws in the wrong shape, caught as it is drawn: a rental as a row, a job as a card.
 * A transition that re-laid the rows on screen before its answer came would show up here for one commit and nowhere else.
 */
let wrong: string[] = []
let watcher: MutationObserver | null = null
function watchShapes() {
  wrong = []
  const scan = () => {
    for (const id of rowIds()) if (id && !id.startsWith('job-')) wrong.push(`row:${id}`)
    for (const id of cardIds()) if (id && id.startsWith('job-')) wrong.push(`card:${id}`)
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

describe('Jobs read as rows on a phone (owner, 2026-11-10: item 2)', () => {
  it('a phone on the Jobs feed draws rows, and no cards', async () => {
    mountAt('/?category=jobs')
    await waitFor(() => expect(rowIds()).toEqual(JOBS.slice(0, 12).map((j) => j.id)))
    expect(cardIds()).toEqual([])
    // The default stays out of the address, as the grid does everywhere else.
    expect(new URLSearchParams(window.location.search).get('view')).toBeNull()
  })

  it('keeps the guest sign-up row after the first page, where the grid had it', async () => {
    mountAt('/?category=jobs')
    await waitFor(() => expect(rowIds()).toHaveLength(12))
    const capture = screen.getAllByTestId('capture')
    expect(capture).toHaveLength(1)
    // …directly after the twelfth row.
    const twelfth = screen.getAllByTestId('row')[11].closest('[data-feed-card]')!
    expect(twelfth.nextElementSibling).toBe(capture[0])
  })

  it('the list a reader CHOSE (`view=compact`) has no sign-up row, as before', async () => {
    mountAt('/?category=rentals&view=compact')
    await waitFor(() => expect(rowIds()).toHaveLength(12))
    expect(screen.queryAllByTestId('capture')).toHaveLength(0)
  })

  it('a wider screen on the same address draws the cards it always did', async () => {
    phone = false
    mountAt('/?category=jobs')
    await waitFor(() => expect(cardIds()).toEqual(JOBS.slice(0, 12).map((j) => j.id)))
    expect(rowIds()).toEqual([])
  })

  it('every other category on a phone keeps its cards', async () => {
    mountAt('/?category=rentals')
    await waitFor(() => expect(cardIds()[0]).toBe('rent-0'))
    expect(rowIds()).toEqual([])
  })

  it('an asked-for grid (`view=grid`) gives the poster cards on a phone, and the address keeps saying so', async () => {
    mountAt('/?category=jobs&view=grid')
    await waitFor(() => expect(cardIds()).toEqual(JOBS.slice(0, 12).map((j) => j.id)))
    expect(rowIds()).toEqual([])
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('view')).toBe('grid'))
  })

  it('`view=grid` is written for Jobs on a phone only: on rentals, and on a wide screen, the address drops it as before', async () => {
    const rentals = mountAt('/?category=rentals&view=grid')
    await waitFor(() => expect(cardIds()[0]).toBe('rent-0'))
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('view')).toBeNull())
    rentals.unmount()
    phone = false
    mountAt('/?category=jobs&view=grid')
    await waitFor(() => expect(cardIds()[0]).toBe('job-0'))
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('view')).toBeNull())
  })

  it('⛔ an address that names a view is obeyed even when a video-return marker is waiting (the `else` stays with its `if`)', async () => {
    // The marker the Video feed leaves when a listing is opened from inside it, on the feed's own history entry.
    sessionStorage.setItem('eno:video-return', JSON.stringify({ path: '/', id: 'rent-3', params: '', ts: Date.now() }))
    window.history.pushState({ __NA: true, takeover: 'video' }, '', '/?category=rentals&view=compact')
    render(
      <QueryClientProvider client={client()}>
        <ListingsExplorer categories={CATEGORIES} initialListings={[]} initialTotal={0} initialFetchedAt={Date.now()} />
      </QueryClientProvider>,
    )
    // The list the address asked for. With the `else if (returning)` re-attached to another `if`, the video takeover
    // replaced it and no row was ever drawn.
    await waitFor(() => expect(rowIds()).toHaveLength(12))
    expect(new URLSearchParams(window.location.search).get('view')).toBe('compact')
  })

  it('⛔ into Jobs: the cards on screen stay cards until the Jobs answer is drawn; no rental is ever drawn as a row', async () => {
    mountAt('/?category=rentals')
    await waitFor(() => expect(cardIds()[0]).toBe('rent-0'))
    watchShapes()
    await go('/?category=jobs')
    await waitFor(() => expect(rowIds()).toEqual(JOBS.slice(0, 12).map((j) => j.id)))
    expect(cardIds()).toEqual([])
    expect(wrong).toEqual([])
  })

  it('⛔ out of Jobs: the rows on screen stay rows until the next answer is drawn; no job is ever drawn as a card', async () => {
    mountAt('/?category=jobs')
    await waitFor(() => expect(rowIds()[0]).toBe('job-0'))
    watchShapes()
    await go('/?category=rentals')
    await waitFor(() => expect(cardIds()[0]).toBe('rent-0'))
    expect(rowIds()).toEqual([])
    expect(wrong).toEqual([])
  })
})
