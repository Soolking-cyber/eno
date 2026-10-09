// @vitest-environment jsdom
/**
 * ⛔ NO "SAVE SEARCH" / "CREATE AN ALERT" ON THE TEACHERS FEED (owner decision, 2026-10-09) — through the REAL explorer
 * (the listings-explorer.history.test.tsx harness: a fake /api/listings, the heavy children stubbed).
 *
 * The alert cron counts every saved search through scopedListingWhere's default, which leaves the teachers category out,
 * so no teachers alert is ever sent — yet the explorer offered all of its save CTAs on `?category=teachers`: the phone's
 * "Save search" pill, the labelled button beside the view modes and the zero-results "Create an alert for this search".
 * The rule is saved-search.ts savedSearchOffered; useSaveSearch hands the explorer no save function there, and every
 * button renders under it. Each case pins rentals beside teachers: every other feed keeps every offer, unchanged.
 */
import React from 'react'
import { cleanup, configure, render, screen, waitFor } from '@testing-library/react'
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
vi.mock('next/dynamic', () => ({ default: () => () => null }))
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
vi.mock('./category-rail', () => ({ CategoryRail: () => null }))
vi.mock('./capture-card', () => ({ CaptureCard: () => null }))
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
const TEACHERS = Array.from({ length: 5 }, (_, i) => row(`teacher-${i}`, 'teachers', { listingType: 'teacher', price: 0, district: null }))

function answer(url: URL) {
  // `q=nomatch` finds nothing anywhere — the zero-results screen and its "Create an alert" exit.
  const set = url.searchParams.get('q') === 'nomatch' ? [] : url.searchParams.get('category') === 'teachers' ? TEACHERS : RENTALS
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

function installDomStubs() {
  installFakeIntersectionObserver()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  window.scrollTo = (() => {}) as typeof window.scrollTo
  window.scrollBy = (() => {}) as typeof window.scrollBy
  Element.prototype.scrollIntoView = () => {}
}

const CATEGORIES = [
  { id: 'c1', slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê', icon: 'home' },
  { id: 'c3', slug: 'teachers', name: 'Teachers', nameVi: 'Giáo viên', icon: 'GraduationCap' },
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
const cardIds = () => screen.queryAllByTestId('card').map((c) => c.getAttribute('data-id'))
/** Every button that offers to save the search or alert on it — whichever entry point drew it. */
const saveOffers = () => screen.queryAllByRole('button').filter((b) => /Save (this )?search|Create an alert/.test(b.textContent ?? ''))
/** The phone's pill at the end of the count row (JOIN-SAVE) and the labelled button beside the view modes. */
const phonePill = () => document.querySelector('[data-slot="result-line"] button.sm\\:hidden')
const viewModesButton = () => Array.from(document.querySelectorAll('[data-view-cluster] button')).find((b) => b.textContent?.includes('Save search')) ?? null

beforeEach(() => {
  __resetExplorerCommittedForTests()
  __resetBackToCloseForTests()
  __resetAreaCachesForTests()
  sessionStorage.clear()
  installDomStubs()
  stubFetch()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})

describe('the teachers feed offers no saved search', () => {
  it('⛔ no "Save search" there — not the phone pill, not the labelled button beside the view modes; rentals keeps both', async () => {
    // Category + subcategory: two crumbs, which is what the labelled button waits for (shouldOfferSaveSearch).
    const rentals = mountAt('/?category=rentals&subcategory=apartment-rental')
    await waitFor(() => expect(cardIds()[0]).toBe('rent-0'))
    await waitFor(() => expect(phonePill()).not.toBeNull())
    expect(viewModesButton()).not.toBeNull()
    rentals.unmount()

    mountAt('/?category=teachers&subcategory=english')
    await waitFor(() => expect(cardIds()).toEqual(TEACHERS.map((t) => t.id)))
    expect(phonePill()).toBeNull()
    expect(viewModesButton()).toBeNull()
    expect(saveOffers()).toEqual([])
  })

  it('⛔ a teachers search that found nothing offers no "Create an alert for this search"; on rentals it is still there', async () => {
    const rentals = mountAt('/?category=rentals&q=nomatch')
    await screen.findByText('No listings match these filters.')
    expect(screen.queryAllByRole('button').some((b) => b.textContent === 'Create an alert for this search')).toBe(true)
    rentals.unmount()

    mountAt('/?category=teachers&q=nomatch')
    await screen.findByText('No listings match these filters.')
    // The rest of the recovery stays: the words can still be removed and the filters cleared.
    expect(screen.getByRole('button', { name: 'Clear all filters' })).toBeTruthy()
    expect(saveOffers()).toEqual([])
  })
})
