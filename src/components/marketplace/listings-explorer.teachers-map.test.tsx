// @vitest-environment jsdom
/**
 * ⛔ THE TEACHERS FEED HAS NO MAP VIEW (gate review, 2026-10-09) — through the REAL explorer state machine (the
 * listings-explorer.history.test.tsx harness: a fake /api/listings, the heavy children stubbed). map-pin-rows.ts drops
 * every teacher (a person has places they can teach, not a location) and `?category=teachers` returns nothing else, so
 * the explorer's Map view over that feed was a map without one pin and nothing saying why — and the toolbar offered it.
 *
 * How the harness tells the views apart: the map itself is a `next/dynamic` chunk, stubbed here as a PROBE that records
 * its props (`data-testid="map"`); the map view's own list column renders its cards as `data-lid` rows; the grid's are
 * `data-feed-card`. Every other feed keeps its map — pinned beside each teachers case.
 * Mutation-checked 2026-10-09: each piece of the fix reverted alone fails a test here — the Map-tab gate and its call
 * site (the toolbar test), the derived view (the client-mount test: two map queries went out), the state reset (the
 * category-change test: the map came back), both together (every `?view=map` route), the header's early return, and
 * "show on map" leaving for the marketplace map.
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
  /** What the map chunk was last handed — null while no map is mounted. */
  const map: { props: Record<string, unknown> | null } = { props: null }
  /** A trending rental with a place: what the sparse-results recovery rail shows under a short teachers answer. */
  const trending = {
    id: 'trend-1', title: 'Trending studio', titleVi: null, price: 9_000_000, location: 'Ho Chi Minh City', district: 'District 3',
    postedAt: '2026-09-01T00:00:00.000Z', contactCount: 0, category: { slug: 'rentals', name: 'Rentals' }, lat: 10.78, lng: 106.69,
  }
  /** The shared dashboard store's answer (null = a visitor signed out, or not loaded). */
  const dash: { value: { hasTeacher?: boolean } | null } = { value: null }
  return { router, language, auth, map, trending, dash }
})

vi.mock('next/navigation', () => ({
  useRouter: () => h.router,
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(window.location.search),
}))
// Every chunk renders nothing except the MAP, which is a probe: on screen while the explorer mounts it, and its last
// props kept (reset before each test). The loader is only inspected, never run; the tests that read the record assert
// it was filled, so a probe that stops matching fails loudly.
vi.mock('next/dynamic', () => ({
  default: (loader: () => unknown) => {
    if (String(loader).includes('listings-map')) {
      return function MapProbe(props: Record<string, unknown>) {
        h.map.props = props
        return <div data-testid="map" />
      }
    }
    return () => null
  },
}))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => h.language,
  useTr: (s: string) => s,
  Tr: ({ text }: { text?: string | null }) => <>{text}</>,
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => h.auth }))
vi.mock('@/hooks/use-dashboard', () => ({ useDashboard: () => ({ dash: h.dash.value, refresh: () => {}, loading: false, error: null, fresh: true }) }))
vi.mock('@/lib/analytics', () => ({ trackSearch: () => {} }))
vi.mock('./listing-card', () => ({
  ListingCard: function ListingCard({ listing, onOpen }: { listing: SerializedListingCard; onOpen?: (l: SerializedListingCard) => void }) {
    return <button type="button" data-testid="card" data-id={listing.id} onClick={() => onOpen?.(listing)}>{listing.title}</button>
  },
}))
// The category rail as the reader uses it: one tile per category, wired to the explorer's own handler.
vi.mock('./category-rail', () => ({
  CategoryRail: ({ categories, activeCategory, onCategory, teacherProfile }: { categories: SerializedCategory[]; activeCategory: string; onCategory: (s: string) => void; teacherProfile?: boolean }) => (
    <div data-teacher-profile={String(!!teacherProfile)}>
      {categories.map((c) => (
        <button key={c.slug} type="button" data-tile={c.slug} onClick={() => onCategory(activeCategory === c.slug ? 'all' : c.slug)}>{c.name}</button>
      ))}
    </div>
  ),
}))
// The recovery placement is a card with the real rail's "show on map" wiring (for-you-rail.tsx: `eno:locate`).
vi.mock('./for-you-rail', () => ({
  ForYouRail: ({ recovery }: { recovery?: boolean }) => (recovery ? (
    <button type="button" data-testid="rail-locate" aria-label="Show on map" onClick={() => window.dispatchEvent(new CustomEvent('eno:locate', { detail: { id: h.trending.id, listing: h.trending } }))} />
  ) : null),
}))
vi.mock('./capture-card', () => ({ CaptureCard: () => null }))
vi.mock('./brand-rail', () => ({ BrandRail: () => null }))
vi.mock('./recently-viewed-rail', () => ({ RecentlyViewedRail: () => null }))
vi.mock('./business-rail', () => ({ BusinessRail: () => null }))
vi.mock('./trending-searches', () => ({ TrendingSearches: () => null }))
vi.mock('./ai-concierge', () => ({ AISearchButton: () => null }))

import { ListingsExplorer, __resetExplorerCommittedForTests } from './listings-explorer'

// ─── A fake /api/listings (+ the map's own two queries) ──────────────────────────────────────────
const row = (id: string, category: string, extra: Record<string, unknown> = {}): SerializedListingCard =>
  ({
    id, title: `${category} #${id}`, titleVi: null, price: 1_000_000, location: 'Ho Chi Minh City', district: 'District 1',
    postedAt: '2026-09-01T00:00:00.000Z', contactCount: 0, category: { slug: category, name: category }, ...extra,
  } as unknown as SerializedListingCard)

const ALL = Array.from({ length: 24 }, (_, i) => row(`home-${i}`, i % 2 ? 'rentals' : 'electronics'))
const RENTALS = Array.from({ length: 20 }, (_, i) => row(`rent-${i}`, 'rentals', { lat: 10.78, lng: 106.7 }))
// A teacher as the feed serves one: listingType 'teacher', no coordinates (the publish core writes none), no price.
// Five of them — a short answer, so the recovery rail shows under it (totalCount < 8, nothing more to page).
const TEACHERS = Array.from({ length: 5 }, (_, i) => row(`teacher-${i}`, 'teachers', { listingType: 'teacher', price: 0, district: null, location: 'Online' }))
const TEACHER_IDS = TEACHERS.map((l) => l.id)

const requests: URL[] = []
/** The map view's own queries (building pins, district shapes, an outline) — map view only. */
function mapRequests() { return requests.filter((u) => u.pathname === '/api/listings/buildings' || u.pathname.startsWith('/api/geo/boundar')) }

function answer(url: URL) {
  const category = url.searchParams.get('category')
  const set = category === 'teachers' ? TEACHERS : category === 'rentals' ? RENTALS : ALL
  const offset = Number(url.searchParams.get('offset') ?? 0)
  const limit = Number(url.searchParams.get('limit') ?? 12)
  return { listings: set.slice(offset, offset + limit), total: set.length, offset, limit, subcategoryCounts: {}, categoryTotal: set.length, facets: {} }
}

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    const url = new URL(u, 'https://eno.vn')
    requests.push(url)
    const body = url.pathname === '/api/listings' ? answer(url)
      : url.pathname === '/api/listings/buildings' ? { buildings: [] }
        : url.pathname.startsWith('/api/geo/boundar') ? { boundaries: [], boundary: null, complete: true }
          : {}
    return { ok: true, status: 200, json: async () => body } as Response
  }))
}

const media = (desktop: boolean) => (q: string) => ({
  matches: desktop && q === '(min-width: 768px)', media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false,
})
function installDomStubs() {
  installFakeIntersectionObserver()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', media(false))
  window.scrollTo = (() => {}) as typeof window.scrollTo
  window.scrollBy = (() => {}) as typeof window.scrollBy
  Element.prototype.scrollIntoView = () => {}
}

const CATEGORIES = [
  { id: 'c1', slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê', icon: 'home' },
  { id: 'c2', slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử', icon: 'tv' },
  { id: 'c3', slug: 'teachers', name: 'Teachers', nameVi: 'Giáo viên', icon: 'GraduationCap' },
] as unknown as SerializedCategory[]

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } })
function mount(c: QueryClient, seed: SerializedListingCard[] = []) {
  return render(
    <QueryClientProvider client={c}>
      <ListingsExplorer categories={CATEGORIES} initialListings={seed} initialTotal={seed.length ? ALL.length : 0} initialFetchedAt={Date.now()} />
    </QueryClientProvider>,
  )
}
/** A clean top of history: no forward entries an earlier test left (a push would truncate them). */
function freshTop(url = '/') { window.history.pushState({ __NA: true }, '', url) }
const back = () => act(() => { window.history.back() })
const gridIds = () => Array.from(document.querySelectorAll('[data-feed-card]')).map((e) => e.getAttribute('data-feed-card'))
/** The map view: its chunk mounted, or its list column drawn. */
const onMap = () => !!screen.queryByTestId('map') || !!document.querySelector('[data-lid]')
const mapTab = () => screen.queryByRole('button', { name: 'Map view' })
const view = () => new URLSearchParams(window.location.search).get('view')

beforeEach(() => {
  h.dash.value = null
  __resetExplorerCommittedForTests()
  __resetBackToCloseForTests()
  __resetAreaCachesForTests()
  requests.length = 0
  h.map.props = null
  sessionStorage.clear()
  installDomStubs()
  stubFetch()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})

describe('the teachers feed offers no Map view', () => {
  it('its toolbar has no Map tab (List and Grid stay); rentals and the undirected home keep theirs, and it still opens the map', async () => {
    freshTop('/?category=teachers')
    const teachers = mount(client())
    await waitFor(() => expect(gridIds()).toEqual(TEACHER_IDS))
    expect(mapTab()).toBeNull()
    expect(screen.getByRole('button', { name: 'List view' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Grid view' })).toBeTruthy()
    teachers.unmount()

    freshTop('/')
    const home = mount(client(), ALL.slice(0, 12))
    await waitFor(() => expect(gridIds()).toHaveLength(12))
    expect(mapTab()).not.toBeNull()
    home.unmount()

    freshTop('/?category=rentals')
    mount(client())
    await waitFor(() => expect(gridIds()[0]).toBe('rent-0'))
    act(() => { mapTab()!.click() })
    await waitFor(() => expect(view()).toBe('map'))
    await waitFor(() => expect(screen.queryByTestId('map')).not.toBeNull())
    // The probe is live: on a map-capable feed the map's own queries DO go out — so "none" below means something.
    await waitFor(() => expect(mapRequests().length).toBeGreaterThan(0))
  })
})

describe('no route lands on the teachers map — `?view=map` reads as the default view there', () => {
  it('a `?view=map` link (the first explorer of the document — the `?view=` reader) shows the grid, drops `view=map` in place, starts no map query', async () => {
    freshTop('/?category=teachers&view=map')
    const before = window.history.length
    mount(client())
    await waitFor(() => expect(gridIds()).toEqual(TEACHER_IDS))
    expect(onMap()).toBe(false)
    await waitFor(() => expect(window.location.search).toBe('?category=teachers'))
    expect(window.history.length).toBe(before) // rewritten, not a new step
    expect(mapRequests()).toEqual([])
  })

  it('…and on a client-side mount, whose state is SEEDED from the URL (Back from a listing, an in-app link)', async () => {
    freshTop('/?category=rentals')
    const first = mount(client())
    await waitFor(() => expect(gridIds()[0]).toBe('rent-0'))
    first.unmount()
    window.history.replaceState(window.history.state, '', '/?category=teachers&view=map')
    requests.length = 0
    mount(client())
    await waitFor(() => expect(gridIds()).toEqual(TEACHER_IDS))
    expect(onMap()).toBe(false)
    await waitFor(() => expect(window.location.search).toBe('?category=teachers'))
    expect(mapRequests()).toEqual([])
    // The same seeded mount of a rentals map link still opens the map (the seed path is unchanged elsewhere).
    cleanup()
    window.history.replaceState(window.history.state, '', '/?category=rentals&view=map')
    mount(client())
    await waitFor(() => expect(screen.queryByTestId('map')).not.toBeNull())
    expect(view()).toBe('map')
  })

  it('Back/Forward onto a teachers entry that says `view=map` shows the grid', async () => {
    freshTop('/?category=rentals')
    mount(client())
    await waitFor(() => expect(gridIds()[0]).toBe('rent-0'))
    act(() => { window.history.replaceState(window.history.state, '', '/?category=teachers&view=map'); window.dispatchEvent(new PopStateEvent('popstate')) })
    await waitFor(() => expect(gridIds()).toEqual(TEACHER_IDS))
    expect(onMap()).toBe(false)
    await waitFor(() => expect(window.location.search).toBe('?category=teachers'))
    expect(mapRequests()).toEqual([])
  })

  it('a category change made ON the map: Teachers from the rentals map is the grid, leaving teachers does not bring the map back, and Back still walks to the rentals map', async () => {
    vi.stubGlobal('matchMedia', media(true)) // desktop: the full category rail stays on screen over a directed feed
    freshTop('/?category=rentals&view=map')
    mount(client())
    await waitFor(() => expect(screen.queryByTestId('map')).not.toBeNull())
    const tile = (slug: string) => document.querySelector(`[data-tile="${slug}"]`) as HTMLButtonElement

    act(() => { tile('teachers').click() })
    await waitFor(() => expect(gridIds()).toEqual(TEACHER_IDS))
    expect(onMap()).toBe(false)
    await waitFor(() => expect(window.location.search).toBe('?category=teachers'))

    // Out of teachers again: the map stays gone — the address stopped naming it, so the state did too.
    act(() => { tile('rentals').click() })
    await waitFor(() => expect(gridIds()[0]).toBe('rent-0'))
    await waitFor(() => expect(window.location.search).toBe('?category=rentals'))
    expect(onMap()).toBe(false)

    // …while the rentals map the reader started on is still one entry back in history (two steps: teachers, rentals).
    back()
    await waitFor(() => expect(window.location.search).toBe('?category=teachers'))
    await waitFor(() => expect(gridIds()).toEqual(TEACHER_IDS))
    expect(onMap()).toBe(false)
    back()
    await waitFor(() => expect(view()).toBe('map'))
    await waitFor(() => expect(screen.queryByTestId('map')).not.toBeNull())
  })
})

describe('the explicit map requests on the teachers feed', () => {
  it('the header\'s Map (`eno:view-map`) opens the MARKETPLACE map there — one step Back undoes — and still opens the rentals map', async () => {
    freshTop('/?category=teachers')
    const teachers = mount(client(), ALL.slice(0, 12))
    await waitFor(() => expect(gridIds()).toEqual(TEACHER_IDS))
    await waitFor(() => expect(window.location.search).toBe('?category=teachers'))
    const before = window.history.length
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    act(() => { window.dispatchEvent(new CustomEvent('eno:view-map')) })
    await waitFor(() => expect(window.location.search).toBe('?view=map'))
    expect(window.history.length).toBe(before + 1)
    await waitFor(() => expect(screen.queryByTestId('map')).not.toBeNull())
    await waitFor(() => expect(document.querySelector('[data-lid="home-0"]')).not.toBeNull())
    const props = h.map.props as { listings?: { id: string }[] }
    expect(props.listings?.some((l) => l.id.startsWith('teacher-'))).toBe(false)
    back()
    await waitFor(() => expect(window.location.search).toBe('?category=teachers'))
    await waitFor(() => expect(gridIds()).toEqual(TEACHER_IDS))
    expect(onMap()).toBe(false)
    teachers.unmount()

    freshTop('/?category=rentals')
    mount(client())
    await waitFor(() => expect(gridIds()[0]).toBe('rent-0'))
    act(() => { window.dispatchEvent(new CustomEvent('eno:view-map')) })
    await waitFor(() => expect(view()).toBe('map'))
    await waitFor(() => expect(screen.queryByTestId('map')).not.toBeNull())
    expect(scrolled).toHaveBeenCalled()
  })

  it('"show on map" from the recovery rail under a short teachers answer opens the marketplace map focused on that listing — one step Back undoes', async () => {
    freshTop('/?category=teachers')
    // With the home route's ISR seed, as production mounts it: the unfiltered feed it lands on is that seed.
    mount(client(), ALL.slice(0, 12))
    await waitFor(() => expect(gridIds()).toEqual(TEACHER_IDS))
    const locate = await screen.findByTestId('rail-locate')
    await waitFor(() => expect(window.location.search).toBe('?category=teachers'))
    const before = window.history.length

    act(() => { locate.click() })
    await waitFor(() => expect(window.location.search).toBe('?view=map'))
    expect(window.history.length).toBe(before + 1)
    // The unfiltered map: its list column holds the whole feed, its pins add the located listing, and it is focused there.
    await waitFor(() => expect(document.querySelector('[data-lid="home-0"]')).not.toBeNull())
    expect(screen.queryByTestId('map')).not.toBeNull()
    const props = h.map.props as { focusId?: string; listings?: { id: string }[] }
    expect(props.focusId).toBe(h.trending.id)
    expect(props.listings?.map((l) => l.id)).toEqual(expect.arrayContaining([h.trending.id, 'home-0']))
    expect(props.listings?.some((l) => l.id.startsWith('teacher-'))).toBe(false)

    back()
    await waitFor(() => expect(window.location.search).toBe('?category=teachers'))
    await waitFor(() => expect(gridIds()).toEqual(TEACHER_IDS))
    expect(onMap()).toBe(false)
  })

  it('on any other feed "show on map" is as it was: same category, its map, focused on the listing', async () => {
    freshTop('/?category=rentals')
    mount(client())
    await waitFor(() => expect(gridIds()[0]).toBe('rent-0'))
    act(() => { window.dispatchEvent(new CustomEvent('eno:locate', { detail: { id: h.trending.id, listing: h.trending } })) })
    await waitFor(() => expect(window.location.search).toBe('?category=rentals&view=map'))
    await waitFor(() => expect(h.map.props).not.toBeNull())
    expect((h.map.props as { focusId?: string }).focusId).toBe(h.trending.id)
  })
})

describe('a "near me" radius never reaches the teachers feed — teacher rows have no place (commit gate, 2026-10-09)', () => {
  it('carried in from rentals it is NOT sent for teachers (no lat/lng), and it is still there back on rentals', async () => {
    vi.stubGlobal('matchMedia', media(true)) // desktop: the full category rail stays on screen over a directed feed
    window.history.pushState({ __NA: true, enoArea: { province: null, ward: null, nearby: { lat: 10.77, lng: 106.7, radiusKm: 3 } } }, '', '/?category=rentals')
    mount(client())
    const feed = (cat: string) => requests.filter((u) => u.pathname === '/api/listings' && u.searchParams.get('category') === cat)
    await waitFor(() => expect(feed('rentals').some((u) => u.searchParams.get('radiusKm') === '3')).toBe(true))
    act(() => { (document.querySelector('[data-tile="teachers"]') as HTMLButtonElement).click() })
    await waitFor(() => expect(feed('teachers').length).toBeGreaterThan(0))
    expect(feed('teachers').every((u) => !u.searchParams.has('lat') && !u.searchParams.has('radiusKm'))).toBe(true)
    await waitFor(() => expect(gridIds()).toEqual(TEACHER_IDS))
    const before = feed('rentals').length
    act(() => { (document.querySelector('[data-tile="rentals"]') as HTMLButtonElement).click() })
    await waitFor(() => expect(feed('rentals').length).toBeGreaterThan(before))
    expect(feed('rentals').at(-1)!.searchParams.get('radiusKm')).toBe('3')
  })
})

describe('the rail is told who already has a teacher profile (the dashboard store; owner, 2026-10-09)', () => {
  it('a signed-out visitor: false — the chips offer the sign-up form', async () => {
    vi.stubGlobal('matchMedia', media(true)) // desktop: the full category rail stays on screen over a directed feed
    freshTop('/?category=teachers')
    mount(client())
    await waitFor(() => expect(gridIds()).toEqual(TEACHER_IDS))
    expect(document.querySelector('[data-teacher-profile]')?.getAttribute('data-teacher-profile')).toBe('false')
  })

  it('a teacher who already has a profile (dashboard hasTeacher): true — the chips open their profile', async () => {
    vi.stubGlobal('matchMedia', media(true))
    h.dash.value = { hasTeacher: true }
    freshTop('/?category=teachers')
    mount(client())
    await waitFor(() => expect(gridIds()).toEqual(TEACHER_IDS))
    expect(document.querySelector('[data-teacher-profile]')?.getAttribute('data-teacher-profile')).toBe('true')
  })
})
