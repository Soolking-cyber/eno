// @vitest-environment jsdom
/**
 * ⛔ A HEADER HIDE/REVEAL DOES NOT RE-RENDER THE EXPLORER (smooth-01, 2026-11-10). The explorer called useHideOnScroll()
 * and passed the value to the sort strip and the desktop map's `--map-top`, so every change of scroll direction past 80px
 * re-rendered all of it: 395 components and an ~83 ms task at phone 4x on `/`, 248 on `/?category=rentals`, just as the
 * header and the strip start to move. The strip runs the hook itself now and hands each flip to <MapSplit> through a
 * signal; the explorer renders nothing.
 * Through the REAL explorer (the listings-explorer.teachers-map.test.tsx harness: a fake /api/listings, heavy children
 * stubbed). The category rail stub counts its renders: the explorer root renders it with fresh props every time it renders.
 * Mutation-checked 2026-11-10: on the old code both fail (one explorer render per flip: 6 → 8 and 10 → 12 rail renders), and a
 * useHideOnScroll() of the split's own fails the second ("calc(3.5rem + …)" where the header is already gone).
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
  /** Renders of the category rail stub — one per render of the explorer root. */
  const rail = { renders: 0 }
  return { router, language, auth, rail }
})

vi.mock('next/navigation', () => ({
  useRouter: () => h.router,
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(window.location.search),
}))
// Every chunk renders nothing except the MAP, a probe the test can find the split by.
vi.mock('next/dynamic', () => ({
  default: (loader: () => unknown) => {
    if (String(loader).includes('listings-map')) return function MapProbe() { return <div data-testid="map" /> }
    return () => null
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
    return <div data-testid="card" data-id={listing.id}>{listing.title}</div>
  },
}))
vi.mock('./category-rail', () => ({
  CategoryRail: () => {
    h.rail.renders++
    return <div data-testid="rail" />
  },
}))
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
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } })
function mount() {
  return render(
    <QueryClientProvider client={client()}>
      <ListingsExplorer categories={CATEGORIES} initialListings={[]} initialTotal={0} initialFetchedAt={Date.now()} />
    </QueryClientProvider>,
  )
}

let Y = 0
/** One real scroll frame at `y`: the event, then the animation frame the hook reads it in (queued after the hook's). */
async function scroll(y: number) {
  Y = y
  await act(async () => {
    window.dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
  })
}
const SHOWN_TOP = 'top-[calc(max(env(safe-area-inset-top),var(--safe-area-inset-top,0px))+3.5rem)]'
const strip = () => document.getElementById('explorer-toolbar')!
/** The map split: the map probe's wrapper's parent. */
const mapTop = () => screen.getByTestId('map').parentElement!.parentElement!.style.getPropertyValue('--map-top')
/** The feed is drawn and every follow-up render (query settle, deferred copies, timers) has run. */
async function settled() {
  await waitFor(() => expect(screen.getAllByTestId('card').length).toBeGreaterThan(0))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)) })
}

beforeEach(() => {
  Y = 0
  h.rail.renders = 0
  __resetExplorerCommittedForTests()
  __resetBackToCloseForTests()
  __resetAreaCachesForTests()
  sessionStorage.clear()
  installFakeIntersectionObserver()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  // From md, as the teachers-map harness's desktop: the ladder stays open, so the rail stub renders with every explorer render
  // (on a phone a directed feed folds it into a closed panel, and a counter there would count nothing).
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(min-width: 768px)', media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  window.scrollTo = (() => {}) as typeof window.scrollTo
  window.scrollBy = (() => {}) as typeof window.scrollBy
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => Y })
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => 4000 })
  stubFetch()
  window.history.pushState({ __NA: true }, '', '/?category=rentals')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})

describe('a header hide/reveal re-renders the strip, not the explorer', () => {
  it('the strip parks above the viewport and comes back; the explorer root renders zero times for either flip', async () => {
    mount()
    await settled()
    await scroll(400) // the hook's first frame only anchors
    const before = h.rail.renders
    expect(before).toBeGreaterThan(0) // the counter is live
    expect(strip().className).toContain(SHOWN_TOP)
    await scroll(900)
    expect(strip().className).toContain('top-[-9rem]')
    await scroll(600)
    expect(strip().className).toContain(SHOWN_TOP)
    expect(h.rail.renders).toBe(before)
  })

  it('the desktop map takes the CURRENT state when it opens in the middle of a visit, then follows every flip', async () => {
    mount()
    await settled()
    await scroll(400)
    await scroll(900) // header and strip gone, before the reader picks the map
    expect(strip().className).toContain('top-[-9rem]')
    act(() => { screen.getByRole('button', { name: 'Map view' }).click() })
    await waitFor(() => expect(screen.queryByTestId('map')).not.toBeNull())
    // A hook of the split's own would start "shown" here and pin the map 105px low under a header that is gone.
    expect(mapTop()).toBe('1rem')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)) }) // the map's own queries answer
    const before = h.rail.renders
    await scroll(600)
    expect(mapTop()).toMatch(/^calc\(3\.5rem \+ max\(env\(safe-area-inset-top\), var\(--safe-area-inset-top, 0px\)\) \+ \d+px \+ 1rem\)$/)
    await scroll(1100)
    expect(mapTop()).toBe('1rem')
    expect(h.rail.renders).toBe(before)
  })
})
