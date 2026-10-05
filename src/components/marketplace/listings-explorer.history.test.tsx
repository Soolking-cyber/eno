// @vitest-environment jsdom
/**
 * ⛔ BACK UNDOES THE LAST VIEW CHANGE INSTEAD OF LEAVING eno.vn (UX3 NAV-1, nav audit N1), AND THE AREA RIDES
 * IN THE URL (NAV-2, N3) — through the REAL explorer state machine (same harness as
 * listings-explorer.back-nav-filter.test.tsx: a fake /api/listings, the heavy children stubbed).
 *
 * Measured before (prod and preview, every viewport): land on `/`, tap a category tile or search, press Back
 * → about:blank. history.length stayed 2 because every change was a replaceState. And jobs + Hồ Chí Minh = 14
 * results, open one, Back → 25: the area was never written to the URL.
 */
import React from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot, type Root } from 'react-dom/client'
import { act, cleanup, configure, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCategory, SerializedListingCard } from '@/lib/types'
import { installFakeIntersectionObserver } from '@/test/fake-intersection-observer'
import { ENTRY_KEY, OVERLAY_KEY, __resetBackToCloseForTests, newHistoryKey } from '@/lib/back-to-close'
import { __resetAreaCachesForTests } from '@/lib/vn-areas'

configure({ asyncUtilTimeout: 5_000 })
vi.setConfig({ testTimeout: 30_000 })

const h = vi.hoisted(() => {
  const router = { push: () => {}, prefetch: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }
  const tr = (en: string) => en
  const language = { lang: 'en', t: (k: string) => k, tr, setLang: () => {} }
  const openSignIn = vi.fn()
  const auth = { user: null, profile: null, loading: false, openSignIn }
  return { router, language, auth, openSignIn }
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
vi.mock('@/lib/analytics', () => ({ trackSearch: () => {} }))
vi.mock('./listing-card', () => ({
  ListingCard: function ListingCard({ listing, onOpen }: { listing: SerializedListingCard; onOpen?: (l: SerializedListingCard) => void }) {
    return <button type="button" data-testid="card" data-id={listing.id} onClick={() => onOpen?.(listing)}>{listing.title}</button>
  },
}))
// The category rail as the reader uses it: one tile per category, wired to the explorer's own handler.
vi.mock('./category-rail', () => ({
  CategoryRail: ({ categories, activeCategory, onCategory }: { categories: SerializedCategory[]; activeCategory: string; onCategory: (s: string) => void }) => (
    <div>
      {categories.map((c) => (
        <button key={c.slug} type="button" data-tile={c.slug} onClick={() => onCategory(activeCategory === c.slug ? 'all' : c.slug)}>{c.name}</button>
      ))}
    </div>
  ),
}))
vi.mock('./capture-card', () => ({ CaptureCard: () => null }))
vi.mock('./brand-rail', () => ({ BrandRail: () => null }))
vi.mock('./for-you-rail', () => ({ ForYouRail: () => null }))
vi.mock('./recently-viewed-rail', () => ({ RecentlyViewedRail: () => null }))
vi.mock('./business-rail', () => ({ BusinessRail: () => null }))
vi.mock('./trending-searches', () => ({ TrendingSearches: () => null }))
vi.mock('./ai-concierge', () => ({ AISearchButton: () => null }))

import { ListingsExplorer, __resetExplorerCommittedForTests } from './listings-explorer'

// ─── A fake /api/listings + /api/geo ────────────────────────────────────────────────────────────
const row = (id: string, category: string): SerializedListingCard =>
  ({
    id, title: `${category} #${id}`, titleVi: null, price: 1_000_000, location: 'Ho Chi Minh City', district: 'District 1',
    postedAt: '2026-09-01T00:00:00.000Z', contactCount: 0, category: { slug: category, name: category },
  } as unknown as SerializedListingCard)

const ALL = Array.from({ length: 48 }, (_, i) => row(`home-${i}`, i % 2 ? 'rentals' : 'electronics'))
const RENTALS = Array.from({ length: 30 }, (_, i) => row(`rent-${i}`, 'rentals'))
const HONDA = Array.from({ length: 5 }, (_, i) => row(`honda-${i}`, 'vehicles'))
const HCMC_WARDS = [{ code: '26734', name: 'Bến Thành', nameEn: 'Ben Thanh' }, { code: '26737', name: 'Sài Gòn', nameEn: 'Sai Gon' }]

const requests: URL[] = []
/** When set, /api/geo answers only once it opens — a slow look-up. */
let geoGate: Promise<void> | null = null
function listingsRequests() { return requests.filter((u) => u.pathname === '/api/listings' && !u.searchParams.has('hasVideo')) }

function answer(url: URL) {
  const base = url.searchParams.get('q') === 'honda' ? HONDA : url.searchParams.get('category') === 'rentals' ? RENTALS : ALL
  // The area narrows the set, so a test can SEE which area a page was asked for: a ward to 3, a province to 7,
  // a near-you circle to 4.
  const set = url.searchParams.get('ward') ? base.slice(0, 3)
    : url.searchParams.get('province') ? base.slice(0, 7)
      : url.searchParams.get('radiusKm') ? base.slice(0, 4)
        : base
  const offset = Number(url.searchParams.get('offset') ?? 0)
  const limit = Number(url.searchParams.get('limit') ?? 12)
  return { listings: set.slice(offset, offset + limit), total: set.length, offset, limit, subcategoryCounts: {}, categoryTotal: set.length, facets: {} }
}

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    const url = new URL(u, 'https://eno.vn')
    requests.push(url)
    // A guest's save is refused, as the real route does (sign-in gate).
    if (url.pathname === '/api/saved-searches') return { ok: false, status: 401, json: async () => ({}) } as Response
    if (url.pathname === '/api/geo' && geoGate) await geoGate
    const body = url.pathname === '/api/listings'
      ? answer(url)
      : url.pathname === '/api/geo' ? { wards: url.searchParams.get('province') === '79' ? HCMC_WARDS : [] } : {}
    return { ok: true, status: 200, json: async () => body } as Response
  }))
}

let io: ReturnType<typeof installFakeIntersectionObserver>
function installDomStubs() {
  io = installFakeIntersectionObserver()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  window.scrollTo = (() => {}) as typeof window.scrollTo
  window.scrollBy = (() => {}) as typeof window.scrollBy
  Element.prototype.scrollIntoView = () => {}
}

const CATEGORIES = [
  { id: 'c1', slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê', icon: 'home' },
  { id: 'c2', slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử', icon: 'tv' },
] as unknown as SerializedCategory[]

const cardIds = () => screen.queryAllByTestId('card').map((c) => c.getAttribute('data-id'))
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
const entryState = () => (window.history.state ?? {}) as Record<string, unknown>

beforeEach(() => {
  h.openSignIn.mockClear()
  __resetExplorerCommittedForTests()
  __resetBackToCloseForTests()
  __resetAreaCachesForTests()
  geoGate = null
  requests.length = 0
  sessionStorage.clear()
  installDomStubs()
  stubFetch()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})

describe('a committed view change is a history entry Back undoes (NAV-1)', () => {
  it('a category tile pushes ONE entry; Back returns to the landing view and its URL', async () => {
    freshTop('/')
    mount(client(), ALL.slice(0, 12))
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    const before = window.history.length

    act(() => { (document.querySelector('[data-tile="rentals"]') as HTMLButtonElement).click() })
    await waitFor(() => expect(window.location.search).toBe('?category=rentals'))
    expect(window.history.length).toBe(before + 1)
    await waitFor(() => expect(cardIds()[0]).toBe('rent-0'))

    back()
    await waitFor(() => expect(window.location.search).toBe(''))
    await waitFor(() => expect(cardIds()[0]).toBe('home-0')) // the landing feed, not the rentals one
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Recommended') // the undirected home's heading
  })

  it('a search from the header (eno:search) is one entry too; Back restores the words that were there', async () => {
    freshTop('/?category=rentals')
    mount(client())
    await waitFor(() => expect(cardIds()[0]).toBe('rent-0'))
    const before = window.history.length
    act(() => { window.dispatchEvent(new CustomEvent('eno:search', { detail: { query: 'honda' } })) })
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('q')).toBe('honda'))
    expect(window.history.length).toBe(before + 1)
    back()
    await waitFor(() => expect(window.location.search).toBe('?category=rentals'))
    await waitFor(() => expect(cardIds()[0]).toBe('rent-0'))
  })

  it('a sort change stays in place — no entry (Baymard: sort is not a page)', async () => {
    freshTop('/?category=rentals')
    mount(client())
    await waitFor(() => expect(cardIds()[0]).toBe('rent-0'))
    const before = window.history.length
    // The sort is applied through the URL reader here (the strip is a code-split chunk in this harness).
    act(() => { window.history.replaceState(window.history.state, '', '/?category=rentals&sort=recent'); window.dispatchEvent(new PopStateEvent('popstate')) })
    await waitFor(() => expect(listingsRequests().some((u) => u.searchParams.get('sort') === 'recent')).toBe(true))
    expect(window.history.length).toBe(before)
  })

  it('the map is a step: into it pushes, Back lands on the list again (and `?view=` goes)', async () => {
    freshTop('/?category=rentals')
    mount(client())
    await waitFor(() => expect(cardIds()[0]).toBe('rent-0'))
    const before = window.history.length
    act(() => { window.dispatchEvent(new CustomEvent('eno:view-map')) })
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('view')).toBe('map'))
    expect(window.history.length).toBe(before + 1)
    // The grid gives way to the map's split view (its list column renders the cards as `data-lid` rows).
    await waitFor(() => expect(document.querySelectorAll('[data-feed-card]')).toHaveLength(0))
    expect(document.querySelector('[data-lid]')).not.toBeNull()
    back()
    await waitFor(() => expect(window.location.search).toBe('?category=rentals'))
    await waitFor(() => expect(document.querySelectorAll('[data-feed-card]').length).toBeGreaterThan(0))
    expect(document.querySelector('[data-lid]')).toBeNull()
  })

  it('a commit that lands on an open layer\'s entry TAKES IT OVER — no second entry, no dead one under it', async () => {
    freshTop('/')
    mount(client(), ALL.slice(0, 12))
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    // The phone search panel opened: its own state-only entry is on top (back-to-close.ts).
    const { useBackToClose } = await import('@/lib/back-to-close')
    function Panel() { useBackToClose(true, () => {}, 'search'); return null }
    render(<Panel />)
    await waitFor(() => expect((entryState()[OVERLAY_KEY] as { key?: string } | undefined)?.key).toBeTruthy())
    const withPanel = window.history.length
    act(() => { window.dispatchEvent(new CustomEvent('eno:search', { detail: { query: 'honda' } })) })
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('q')).toBe('honda'))
    expect(window.history.length).toBe(withPanel) // absorbed
    expect(entryState()[OVERLAY_KEY]).toBeUndefined()
    back()
    await waitFor(() => expect(window.location.search).toBe('')) // one Back: straight to where the panel opened
  })

  it('the logo (eno:reset-home) is a step too: Back from home returns to the results it was tapped on', async () => {
    freshTop('/?q=honda')
    mount(client())
    await waitFor(() => expect(cardIds()).toEqual(HONDA.map((l) => l.id)))
    const before = window.history.length
    act(() => { window.dispatchEvent(new CustomEvent('eno:reset-home')) })
    await waitFor(() => expect(window.location.search).toBe(''))
    expect(window.history.length).toBe(before + 1)
    back()
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('q')).toBe('honda'))
    await waitFor(() => expect(cardIds()).toEqual(HONDA.map((l) => l.id)))
  })

  it('removing a chip is a step: Back puts the filter back instead of landing on a twin of the same URL', async () => {
    freshTop('/')
    mount(client(), ALL.slice(0, 12))
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    act(() => { window.dispatchEvent(new CustomEvent('eno:search', { detail: { query: 'honda' } })) })
    await waitFor(() => expect(cardIds()).toEqual(HONDA.map((l) => l.id)))
    const before = window.history.length
    act(() => { screen.getByRole('button', { name: 'Remove "honda"' }).click() })
    await waitFor(() => expect(window.location.search).toBe(''))
    expect(window.history.length).toBe(before + 1)
    back()
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('q')).toBe('honda'))
    back()
    await waitFor(() => expect(window.location.search).toBe(''))
  })

  it('Back onto the entry UNDER the video takeover does not reopen the video (✕ looped forever — review)', async () => {
    freshTop('/?category=rentals')
    mount(client())
    await waitFor(() => expect(cardIds()[0]).toBe('rent-0'))
    // The lazily loaded takeover: `?view=video` lands on the entry under it before it pushes its own.
    act(() => {
      window.history.replaceState({ ...entryState() }, '', '/?category=rentals&view=video')
      window.history.pushState({ ...entryState(), takeover: 'video' }, '')
    })
    back() // the takeover's ✕ pops its entry
    await waitFor(() => expect(entryState().takeover).toBeUndefined())
    await new Promise((r) => setTimeout(r, 50))
    expect(document.querySelectorAll('[data-feed-card]').length).toBeGreaterThan(0) // still the list, not the video
    // …and that entry's URL says so again (a reload must not reopen the takeover).
    await waitFor(() => expect(window.location.search).toBe('?category=rentals'))
  })

  it('every entry the explorer writes carries an identity and its exact area', async () => {
    freshTop('/')
    mount(client(), ALL.slice(0, 12))
    await waitFor(() => expect(entryState()[ENTRY_KEY]).toEqual(expect.any(String)))
    expect(entryState().enoArea).toEqual({ province: null, ward: null, nearby: null })
  })
})

describe('Back restores the feed it left — rows AND place, not page one (NAV-1)', () => {
  it('a deep landing feed, then a header search, then Back: the same 36 rows, realigned on the card that was on screen', async () => {
    freshTop('/')
    const c = client()
    mount(c, ALL.slice(0, 12))
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    // "Browse everything" unlocks the landing feed; two more pages arrive by scrolling.
    act(() => { screen.getByText('Browse everything').click() })
    await waitFor(() => expect(cardIds()).toHaveLength(24))
    io.scrollToSentinel()
    await waitFor(() => expect(cardIds()).toHaveLength(36))

    // Card home-20 is the first one on screen when the reader searches (jsdom lays out nothing — so say so).
    const rect = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const id = this.getAttribute('data-feed-card')
      if (!id) return rect.call(this)
      const n = Number(id.split('-')[1])
      const top = (n - 20) * 300 + 120
      return { top, bottom: top + 280, left: 0, right: 0, width: 0, height: 280, x: 0, y: top, toJSON: () => ({}) } as DOMRect
    }
    try {
      act(() => { window.dispatchEvent(new CustomEvent('eno:search', { detail: { query: 'honda' } })) })
      await waitFor(() => expect(cardIds()).toEqual(HONDA.map((l) => l.id)))
    } finally {
      Element.prototype.getBoundingClientRect = rect
    }

    const realign = vi.fn()
    window.scrollBy = realign as unknown as typeof window.scrollBy
    // On the way back the card comes back 500px down (jsdom again) — the restore must move it to 120.
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.getAttribute('data-feed-card') !== 'home-20') return rect.call(this)
      return { top: 500, bottom: 780, left: 0, right: 0, width: 0, height: 280, x: 0, y: 500, toJSON: () => ({}) } as DOMRect
    }
    try {
      back()
      await waitFor(() => expect(cardIds()).toHaveLength(36))
      expect(cardIds().slice(0, 3)).toEqual(['home-0', 'home-1', 'home-2'])
      await waitFor(() => expect(realign).toHaveBeenCalledWith(0, 380))
    } finally {
      Element.prototype.getBoundingClientRect = rect
    }
  })

  it('Back from a listing opened after a PUSHED filter still restores that feed exactly (the card-tap snapshot)', async () => {
    freshTop('/')
    const c = client()
    const first = mount(c, ALL.slice(0, 12))
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    act(() => { (document.querySelector('[data-tile="rentals"]') as HTMLButtonElement).click() })
    await waitFor(() => expect(cardIds()[0]).toBe('rent-0'))
    io.scrollToSentinel()
    await waitFor(() => expect(cardIds()).toHaveLength(24))
    act(() => { screen.getAllByTestId('card')[15].click() }) // → /listings/rent-15
    expect(JSON.parse(sessionStorage.getItem('eno:feed-snap') ?? 'null')).toMatchObject({ page: 2, anchorId: 'rent-15' })
    first.unmount()
    // The tapped card comes back 500px from where it was tapped (jsdom lays out at 0): the restore must move it.
    const realign = vi.fn()
    window.scrollBy = realign as unknown as typeof window.scrollBy
    const rect = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.getAttribute('data-feed-card') !== 'rent-15') return rect.call(this)
      return { top: 500, bottom: 780, left: 0, right: 0, width: 0, height: 280, x: 0, y: 500, toJSON: () => ({}) } as DOMRect
    }
    try {
      mount(c) // ← Back: a client-side mount on /?category=rentals
      await waitFor(() => expect(cardIds()).toHaveLength(24))
      await waitFor(() => expect(realign).toHaveBeenCalledWith(0, 500)) // the tapped card, back where it was
    } finally {
      Element.prototype.getBoundingClientRect = rect
    }
    expect(sessionStorage.getItem('eno:feed-snap')).toBeNull()
    expect(window.location.search).toBe('?category=rentals')
    // …and one more Back is the landing view, not about:blank.
    back()
    await waitFor(() => expect(window.location.search).toBe(''))
    await waitFor(() => expect(cardIds()[0]).toBe('home-0'))
  })
})

describe('the area is in the URL — codes only, never the near-you circle (NAV-2)', () => {
  const HCMC = { code: '79', name: 'Hồ Chí Minh', nameEn: 'Ho Chi Minh' }
  const BEN_THANH = HCMC_WARDS[0]

  it('an area pick writes province + ward codes and is a step Back undoes; the API gets the names', async () => {
    freshTop('/?category=rentals')
    mount(client())
    await waitFor(() => expect(cardIds()[0]).toBe('rent-0'))
    const before = window.history.length
    act(() => { window.dispatchEvent(new CustomEvent('eno:set-area', { detail: { province: HCMC, ward: BEN_THANH, nearby: null } })) })
    await waitFor(() => expect(window.location.search).toBe('?category=rentals&province=79&ward=26734'))
    expect(window.history.length).toBe(before + 1)
    await waitFor(() => expect(listingsRequests().some((u) => u.searchParams.get('province') === 'Ho Chi Minh' && u.searchParams.get('ward') === 'Ben Thanh')).toBe(true))
    await waitFor(() => expect(cardIds()).toHaveLength(3)) // the ward's three
    back()
    await waitFor(() => expect(window.location.search).toBe('?category=rentals'))
    // Back dropped the area from the feed too, not only from the address bar: the whole aisle again.
    await waitFor(() => expect(cardIds()).toHaveLength(12))
  })

  it('…and Forward puts it back, exactly (the entry recorded the area it showed)', async () => {
    freshTop('/?category=rentals')
    mount(client())
    await waitFor(() => expect(cardIds()[0]).toBe('rent-0'))
    act(() => { window.dispatchEvent(new CustomEvent('eno:set-area', { detail: { province: HCMC, ward: BEN_THANH, nearby: null } })) })
    await waitFor(() => expect(cardIds()).toHaveLength(3))
    back()
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    act(() => { window.history.forward() })
    await waitFor(() => expect(window.location.search).toBe('?category=rentals&province=79&ward=26734'))
    await waitFor(() => expect(cardIds()).toHaveLength(3))
  })

  it('"near you" never reaches the URL — the circle lives in the entry\'s own state, and Back/Forward restore it', async () => {
    freshTop('/?category=rentals')
    mount(client())
    await waitFor(() => expect(cardIds()[0]).toBe('rent-0'))
    const nearby = { lat: 10.776, lng: 106.701, radiusKm: 5 }
    act(() => { window.dispatchEvent(new CustomEvent('eno:set-area', { detail: { province: HCMC, ward: null, nearby } })) })
    await waitFor(() => expect(listingsRequests().some((u) => u.searchParams.get('radiusKm') === '5')).toBe(true))
    expect(window.location.search).toBe('?category=rentals')
    expect(window.location.href).not.toMatch(/10\.776|106\.701|lat=|lng=|radius|near/)
    expect(entryState().enoArea).toMatchObject({ nearby })
    back()
    await waitFor(() => expect(entryState().enoArea).toMatchObject({ nearby: null }))
    act(() => { window.history.forward() })
    await waitFor(() => expect(entryState().enoArea).toMatchObject({ nearby }))
    await waitFor(() => expect(listingsRequests().at(-1)?.searchParams.get('radiusKm')).toBe('5'))
  })

  it('a near-you Apply from the phone Area sheet (no URL change) is KEPT, not popped as "untouched" (review)', async () => {
    freshTop('/?category=rentals')
    mount(client())
    await waitFor(() => expect(cardIds()[0]).toBe('rent-0'))
    const { useBackToClose } = await import('@/lib/back-to-close')
    let setOpen: (v: boolean) => void = () => {}
    function Sheet() {
      const [open, set] = React.useState(true)
      setOpen = set
      useBackToClose(open, () => set(false), 'area')
      return null
    }
    render(<Sheet />)
    await waitFor(() => expect((entryState()[OVERLAY_KEY] as { key?: string } | undefined)?.key).toBeTruthy())
    const withSheet = window.history.length
    const nearby = { lat: 10.776, lng: 106.701, radiusKm: 5 }
    // Apply: the area (onCommit → commitView) and the close, in one tap.
    act(() => {
      window.dispatchEvent(new CustomEvent('eno:set-area', { detail: { province: HCMC, ward: null, nearby } }))
      setOpen(false)
    })
    await waitFor(() => expect(cardIds()).toHaveLength(4)) // the circle's four
    await new Promise((r) => setTimeout(r, 50))
    expect(cardIds()).toHaveLength(4) // and it stays: no pop undid it
    expect(window.history.length).toBe(withSheet)
    expect(window.location.search).toBe('?category=rentals')
    back()
    await waitFor(() => expect(cardIds()).toHaveLength(12)) // Back undoes the circle
  })

  it('a cold link with a province applies it at once — the first request already carries it', async () => {
    window.history.replaceState({}, '', '/?category=rentals&province=79')
    mount(client())
    await waitFor(() => expect(listingsRequests().length).toBeGreaterThan(0))
    const areaRequests = listingsRequests().filter((u) => u.searchParams.get('category') === 'rentals')
    expect(areaRequests[0].searchParams.get('province')).toBe('Ho Chi Minh')
    expect(window.location.search).toBe('?category=rentals&province=79') // and the link is not rewritten away
  })

  it('a COLD link (hydration) with a ward resolves it BEFORE applying: no request goes out without the ward', async () => {
    window.history.replaceState({}, '', '/?category=rentals&province=79&ward=26734')
    document.documentElement.setAttribute('data-explorer-directed', '') // the pre-paint script's mark
    const el = (
      <QueryClientProvider client={client()}>
        <ListingsExplorer categories={CATEGORIES} initialListings={ALL.slice(0, 12)} initialTotal={ALL.length} initialFetchedAt={Date.now()} />
      </QueryClientProvider>
    )
    const container = document.body.appendChild(document.createElement('div'))
    container.innerHTML = renderToString(el)
    let root: Root | null = null
    try {
      await act(async () => { root = hydrateRoot(container, el, { onRecoverableError: () => {} }) })
      await waitFor(() => expect(listingsRequests().some((u) => u.searchParams.get('ward') === 'Ben Thanh')).toBe(true))
      const rentals = listingsRequests().filter((u) => u.searchParams.get('category') === 'rentals')
      expect(rentals.every((u) => u.searchParams.get('ward') === 'Ben Thanh')).toBe(true)
      expect(requests.some((u) => u.pathname === '/api/geo')).toBe(true)
      expect(window.location.search).toBe('?category=rentals&province=79&ward=26734')
      // …and the masked seed is lifted by THAT answer, not by a province-only one.
      await waitFor(() => expect(document.documentElement.hasAttribute('data-explorer-directed')).toBe(false))
      await waitFor(() => expect(container.querySelectorAll('[data-feed-card]')).toHaveLength(3))
    } finally {
      act(() => (root as Root | null)?.unmount())
      container.remove()
      document.documentElement.removeAttribute('data-explorer-directed')
    }
  })

  it('a COLD ward link whose look-up is slow keeps `?ward=` and lands the ward late — never a silently broadened link', async () => {
    let open = () => {}
    geoGate = new Promise<void>((r) => { open = r })
    window.history.replaceState({}, '', '/?category=rentals&province=79&ward=26734')
    const el = (
      <QueryClientProvider client={client()}>
        <ListingsExplorer categories={CATEGORIES} initialListings={ALL.slice(0, 12)} initialTotal={ALL.length} initialFetchedAt={Date.now()} />
      </QueryClientProvider>
    )
    const container = document.body.appendChild(document.createElement('div'))
    container.innerHTML = renderToString(el)
    let root: Root | null = null
    try {
      await act(async () => { root = hydrateRoot(container, el, { onRecoverableError: () => {} }) })
      // Past the 2.5 s wait the rest of the link applies (the province's 7)…
      await waitFor(() => expect(container.querySelectorAll('[data-feed-card]')).toHaveLength(7), { timeout: 8000 })
      expect(window.location.search).toBe('?category=rentals&province=79&ward=26734') // …and the address keeps the ward
      open()
      await waitFor(() => expect(listingsRequests().some((u) => u.searchParams.get('ward') === 'Ben Thanh')).toBe(true))
      await waitFor(() => expect(container.querySelectorAll('[data-feed-card]')).toHaveLength(3))
      expect(window.location.search).toBe('?category=rentals&province=79&ward=26734')
    } finally {
      act(() => (root as Root | null)?.unmount())
      container.remove()
    }
  }, 20000)

  it('a client-side arrival on a ward this document has not seen keeps `?ward=` while it is looked up, then applies it', async () => {
    window.history.replaceState({}, '', '/?category=rentals&province=79&ward=26737')
    mount(client())
    await waitFor(() => expect(listingsRequests().some((u) => u.searchParams.get('ward') === 'Sai Gon')).toBe(true))
    expect(window.location.search).toBe('?category=rentals&province=79&ward=26737') // never rewritten away meanwhile
    await waitFor(() => expect(cardIds()).toHaveLength(3))
  })

  it('junk area params are no place: ignored, and dropped from the URL on the next write', async () => {
    window.history.replaceState({ [ENTRY_KEY]: newHistoryKey() }, '', '/?category=rentals&province=Hanoi&ward=26734')
    mount(client())
    await waitFor(() => expect(cardIds()[0]).toBe('rent-0'))
    expect(listingsRequests().every((u) => !u.searchParams.has('province') && !u.searchParams.has('ward'))).toBe(true)
    await waitFor(() => expect(window.location.search).toBe('?category=rentals'))
  })
})

/**
 * ⛔ UX3 JOIN-SAVE (UX2 B1 items 3-4, handed over): on a phone, "Save search" — the account's best promise on
 * rental pages — was an unlabelled 36×24 bookmark that appeared only from the SECOND filter. It is now a
 * labelled 44px pill at the end of the count row from the FIRST query or filter (`sm:hidden`: from sm the
 * offer is the labelled button beside the view modes, unchanged), using the same save flow and sign-in gate.
 */
describe('the phone "Save search" pill (JOIN-SAVE)', () => {
  const pill = () => document.querySelector('[data-slot="result-line"] button.sm\\:hidden') as HTMLButtonElement | null

  it('is not offered on the undirected home — there is nothing to save', async () => {
    freshTop('/')
    mount(client(), ALL.slice(0, 12))
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    expect(pill()).toBeNull()
  })

  it('appears with the first search, labelled, 44px, in the count row', async () => {
    freshTop('/')
    mount(client(), ALL.slice(0, 12))
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    act(() => { window.dispatchEvent(new CustomEvent('eno:search', { detail: { query: 'honda' } })) })
    await waitFor(() => expect(pill()).not.toBeNull())
    expect(pill()!.textContent).toBe('Save search')
    expect(pill()!.className).toContain('min-h-11')
  })

  it('…and with one category alone', async () => {
    freshTop('/?category=rentals')
    mount(client())
    await waitFor(() => expect(cardIds()[0]).toBe('rent-0'))
    await waitFor(() => expect(pill()).not.toBeNull())
  })

  it('NOT for an area alone: a saved search cannot keep a province, so it would alert on everything', async () => {
    freshTop('/')
    mount(client(), ALL.slice(0, 12))
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    act(() => { window.dispatchEvent(new CustomEvent('eno:set-area', { detail: { province: { code: '79', name: 'Hồ Chí Minh', nameEn: 'Ho Chi Minh' }, ward: null, nearby: null } })) })
    await waitFor(() => expect(cardIds()).toHaveLength(7))
    expect(pill()).toBeNull()
  })

  it('a guest\'s tap goes through the existing flow: the save is refused and the sign-in sheet opens with its note', async () => {
    freshTop('/?q=honda')
    mount(client())
    await waitFor(() => expect(pill()).not.toBeNull())
    act(() => { pill()!.click() })
    await waitFor(() => expect(h.openSignIn).toHaveBeenCalledWith(expect.objectContaining({ note: 'Sign in to get alerts when new listings match this search.' })))
  })
})
