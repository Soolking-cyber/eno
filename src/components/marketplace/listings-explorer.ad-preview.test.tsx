// @vitest-environment jsdom
/**
 * The creative ads' private test (src/lib/ads/creative-gate.ts): a page opened with `adpreview=1` asks the feed for the
 * preview — the explorer forwards the param from its own URL into every /api/listings request, beside `adc=1` — and a page
 * without it never sends one. Through the REAL explorer (the listings-explorer.scroll-flip.test.tsx harness: a fake
 * /api/listings, heavy children stubbed).
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
  return { router, language, auth, requests: [] as URL[] }
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
    return <div data-testid="card" data-id={listing.id}>{listing.title}</div>
  },
}))
vi.mock('./category-rail', () => ({ CategoryRail: () => null }))
vi.mock('./for-you-rail', () => ({ ForYouRail: () => null }))
vi.mock('./capture-card', () => ({ CaptureCard: () => null }))
vi.mock('./brand-rail', () => ({ BrandRail: () => null }))
vi.mock('./recently-viewed-rail', () => ({ RecentlyViewedRail: () => null }))
vi.mock('./business-rail', () => ({ BusinessRail: () => null }))
vi.mock('./trending-searches', () => ({ TrendingSearches: () => null }))
vi.mock('./ai-concierge', () => ({ AISearchButton: () => null }))

import { ListingsExplorer, __resetExplorerCommittedForTests } from './listings-explorer'

const row = (id: string): SerializedListingCard =>
  ({
    id, title: `rentals #${id}`, titleVi: null, price: 1_000_000, location: 'Ho Chi Minh City', district: 'District 1',
    postedAt: '2026-09-01T00:00:00.000Z', contactCount: 0, category: { slug: 'rentals', name: 'Rentals' }, lat: 10.78, lng: 106.7,
  } as unknown as SerializedListingCard)
const RENTALS = Array.from({ length: 20 }, (_, i) => row(`rent-${i}`))

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    const url = new URL(u, 'https://eno.vn')
    if (url.pathname === '/api/listings' && !url.searchParams.has('histogram')) h.requests.push(url)
    const offset = Number(url.searchParams.get('offset') ?? 0)
    const limit = Number(url.searchParams.get('limit') ?? 12)
    const body = url.pathname === '/api/listings'
      ? { listings: RENTALS.slice(offset, offset + limit), total: RENTALS.length, offset, limit, subcategoryCounts: {}, categoryTotal: RENTALS.length, facets: {} }
      : url.pathname === '/api/listings/buildings' ? { buildings: [] }
        : url.pathname.startsWith('/api/geo/boundar') ? { boundaries: [], boundary: null, complete: true }
          : {}
    return { ok: true, status: 200, json: async () => body } as Response
  }))
}

const CATEGORIES = [{ id: 'c1', slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê', icon: 'home' }] as unknown as SerializedCategory[]
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ListingsExplorer categories={CATEGORIES} initialListings={[]} initialTotal={0} initialFetchedAt={Date.now()} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  h.requests = []
  __resetExplorerCommittedForTests()
  __resetBackToCloseForTests()
  __resetAreaCachesForTests()
  sessionStorage.clear()
  installFakeIntersectionObserver()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(min-width: 768px)', media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  window.scrollTo = (() => {}) as typeof window.scrollTo
  Element.prototype.scrollIntoView = () => {}
  stubFetch()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})

describe('the feed request and the page\'s adpreview', () => {
  it('a page opened with adpreview=1 sends it on every feed request, beside adc=1', async () => {
    window.history.pushState({ __NA: true }, '', '/?category=rentals&adpreview=1')
    mount()
    await waitFor(() => expect(screen.getAllByTestId('card').length).toBeGreaterThan(0))
    expect(h.requests.length).toBeGreaterThan(0)
    for (const u of h.requests) {
      expect(u.searchParams.get('adpreview'), u.search).toBe('1')
      expect(u.searchParams.get('adc'), u.search).toBe('1')
    }
    // The explorer's own URL sync keeps the param in the address bar, so the next request still carries it.
    expect(new URLSearchParams(window.location.search).get('adpreview')).toBe('1')
  })

  it('a page without it never sends one (adpreview=0 is not a preview either)', async () => {
    window.history.pushState({ __NA: true }, '', '/?category=rentals&adpreview=0')
    mount()
    await waitFor(() => expect(screen.getAllByTestId('card').length).toBeGreaterThan(0))
    expect(h.requests.length).toBeGreaterThan(0)
    for (const u of h.requests) {
      expect(u.searchParams.has('adpreview'), u.search).toBe(false)
      expect(u.searchParams.get('adc'), u.search).toBe('1')
    }
  })
})
