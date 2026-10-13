// @vitest-environment jsdom
/**
 * THE HOME "FIND A TEACHER" SHELF INSIDE THE REAL <ListingsExplorer> (owner, 2026-10-13 — teacher-shelf.tsx) — replayed
 * through the explorer's own state machine against a fake /api/listings, the feed-ux harness's shape: the heavy children
 * are stubbed, the URL hydration, the react-query keys and the back-nav snapshot are the real ones.
 *
 * Pinned: the shelf is the grid row right AFTER the twelfth feed card and before the guest capture row, in the server
 * HTML and through hydration with no recoverable error; feed card 0 keeps the page's one LCP hint; it is the undirected
 * home's only — gone on a search, a category, the map or video view, a storefront, below three teachers or with none
 * passed — and a sort keeps it; and a tap on it is snapshotted WITHOUT an anchor, so Back restores the raw offset in the
 * Back mount's first frame instead of hunting ~2/3 s for a card that is not in the grid.
 */
import React from 'react'
import { act, cleanup, configure, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToString } from 'react-dom/server'
import { hydrateRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'
import { installFakeIntersectionObserver } from '@/test/fake-intersection-observer'

// Same budget as the other explorer harnesses (a heavy render on a loaded machine is timing, not behaviour).
configure({ asyncUtilTimeout: 5_000 })
vi.setConfig({ testTimeout: 30_000 })

const h = vi.hoisted(() => {
  const router = { push: (_href: string) => {}, prefetch: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }
  const tr = (en: string) => en
  const language = { lang: 'en', t: (k: string) => k, tr, setLang: () => {} }
  const auth = { user: null as null | { id: string }, profile: null, loading: false, openSignIn: () => {} }
  const nav = { pathname: '/' }
  /** Every back-nav restore the explorer ran, as the `runRestore` wrapper below saw it. */
  const restores: Array<{ anchorId: string | null; found: boolean }> = []
  return { router, language, auth, nav, restores }
})

vi.mock('next/navigation', () => ({
  useRouter: () => h.router,
  usePathname: () => h.nav.pathname,
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
// The card: its id, and the two LCP props as attributes, so "who got the preload" can be read off the DOM.
vi.mock('./listing-card', () => ({
  ListingCard: ({ listing, onOpen, priority, lcp }: { listing: SerializedListingCard; onOpen?: (l: SerializedListingCard) => void; priority?: boolean; lcp?: boolean }) => (
    <button type="button" data-testid="card" data-id={listing.id} data-priority={priority ? '' : undefined} data-lcp={lcp ? '' : undefined} onClick={() => onOpen?.(listing)}>
      {listing.title}
    </button>
  ),
}))
// The guest capture row is a MARKER here: the shelf's place is "after card 12, before this". Like the real row, it
// renders nothing for a signed-in reader.
vi.mock('./capture-card', () => ({ CaptureCard: () => (h.auth.user ? null : <div data-testid="capture-row" />) }))
vi.mock('./brand-rail', () => ({ BrandRail: () => null }))
vi.mock('./category-rail', () => ({ CategoryRail: () => null }))
vi.mock('./for-you-rail', () => ({ ForYouRail: () => null }))
vi.mock('./recently-viewed-rail', () => ({ RecentlyViewedRail: () => null }))
vi.mock('./business-rail', () => ({ BusinessRail: () => null }))
vi.mock('./trending-searches', () => ({ TrendingSearches: () => null }))
vi.mock('./ai-concierge', () => ({ AISearchButton: () => null }))
// The back-nav restore runs the REAL loop; the wrapper only records what it was asked to align on, and whether it found it.
vi.mock('./feed-restore', async (importOriginal) => {
  const real = await importOriginal<typeof import('./feed-restore')>()
  const runRestore: typeof real.runRestore = (target, env, onDone) => {
    const run = { anchorId: target.anchorId, found: false }
    h.restores.push(run)
    return real.runRestore(target, { ...env, anchorTopOf: (id) => { const top = env.anchorTopOf(id); if (top != null) run.found = true; return top } }, onDone)
  }
  return { ...real, runRestore }
})

import { ListingsExplorer, __resetExplorerCommittedForTests } from './listings-explorer'

// ─── A fake /api/listings ────────────────────────────────────────────────────────────────────
const row = (id: string): SerializedListingCard =>
  ({
    id, title: `Listing ${id}`, titleVi: null, price: 1_000_000, location: 'Ho Chi Minh City', district: 'District 1',
    postedAt: '2026-09-01T00:00:00.000Z', contactCount: 0, images: [`https://x/${id}.webp`],
    category: { slug: 'electronics', name: 'Electronics' },
  } as unknown as SerializedListingCard)
const teacher = (id: string): SerializedListingCard =>
  ({
    id, title: `Teacher ${id}`, titleVi: `Teacher ${id}`, price: 35_000_000, location: 'Thủ Đức', district: null, listingType: 'teacher',
    postedAt: '2026-10-01T00:00:00.000Z', contactCount: 0, images: [`https://x/${id}.webp`],
    category: { slug: 'teachers', name: 'Teachers' },
  } as unknown as SerializedListingCard)

let catalogue: SerializedListingCard[] = []
const requests: URL[] = []
function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    const url = new URL(u, 'https://eno.vn')
    requests.push(url)
    const offset = Number(url.searchParams.get('offset') ?? 0)
    const limit = Number(url.searchParams.get('limit') ?? 12)
    const body = url.pathname === '/api/listings'
      ? { listings: catalogue.slice(offset, offset + limit), total: catalogue.length, offset, limit, subcategoryCounts: {}, categoryTotal: catalogue.length, facets: {}, inferredDistrict: null, correctedQuery: null }
      : url.pathname === '/api/search/trending' ? { trending: [] } : {}
    return { ok: true, status: 200, json: async () => body } as Response
  }))
}
const listingsRequests = () => requests.filter((u) => u.pathname === '/api/listings' && !u.searchParams.has('hasVideo'))

function installDomStubs() {
  installFakeIntersectionObserver()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  window.scrollTo = (() => {}) as typeof window.scrollTo
  window.scrollBy = (() => {}) as typeof window.scrollBy
  Element.prototype.scrollIntoView = () => {}
}

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } })
const SEED = () => catalogue.slice(0, 12)
const TEACHERS = (n = 3) => Array.from({ length: n }, (_, i) => teacher(`t${i}`))

function mount(client: QueryClient, props: Partial<React.ComponentProps<typeof ListingsExplorer>> = {}) {
  return render(
    <QueryClientProvider client={client}>
      <ListingsExplorer categories={[]} initialListings={SEED()} initialTotal={catalogue.length} initialTeachers={TEACHERS()} {...props} />
    </QueryClientProvider>,
  )
}

const shelfEl = () => document.querySelector('[data-teacher-shelf]')
const grid = () => document.querySelector('.feed-grid') as HTMLElement
/** The grid's children as the reader meets them: a card id, 'shelf', 'capture', or another tag. */
const gridOrder = (g: Element = grid()) => [...g.children].map((el) =>
  el.getAttribute('data-feed-card') ?? (el.hasAttribute('data-teacher-shelf') ? 'shelf' : el.getAttribute('data-testid') === 'capture-row' ? 'capture' : el.tagName))
/** Every h2 on the page in document order, with whether it is the screen-reader-only kind. */
const h2s = () => [...document.querySelectorAll('h2')].map((el) => `${el.textContent}${el.classList.contains('sr-only') ? ' (sr-only)' : ''}`)

beforeEach(() => {
  __resetExplorerCommittedForTests()
  requests.length = 0
  h.nav.pathname = '/'
  h.restores.length = 0
  h.router.push = () => {}
  h.auth.user = null
  catalogue = Array.from({ length: 30 }, (_, i) => row(`r${i}`))
  sessionStorage.clear()
  installDomStubs()
  stubFetch()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.history.replaceState({}, '', '/')
})

describe('the server HTML and its hydration', () => {
  it('the shelf is the row right after the twelfth card and before the capture row; it hydrates with no recoverable error', async () => {
    const el = (
      <QueryClientProvider client={newClient()}>
        <ListingsExplorer categories={[]} initialListings={SEED()} initialTotal={catalogue.length} initialTeachers={TEACHERS()} />
      </QueryClientProvider>
    )
    const container = document.body.appendChild(document.createElement('div'))
    const errors: unknown[] = []
    let root: Root | null = null
    // ONE try for the whole test: a failure before the hydration must still take its container away, or every later
    // test of this file reads that stale server HTML from document.body (`shelfEl()` is document-wide).
    try {
      container.innerHTML = renderToString(el)
      // In the server HTML already — crawlers and a cold phone see it without JS. Ends at the capture row: no sr-only
      // feed heading after the shelf while it closes page one (the seed is exactly one page).
      const serverGrid = container.querySelector('.feed-grid')!
      expect(gridOrder(serverGrid)).toEqual([...SEED().map((l) => l.id), 'shelf', 'capture'])
      await act(async () => { root = hydrateRoot(container, el, { onRecoverableError: (e) => errors.push(e) }) })
      expect(errors).toEqual([])
      expect(gridOrder(container.querySelector('.feed-grid')!)).toEqual([...SEED().map((l) => l.id), 'shelf', 'capture'])
      // The shelf's cards are in it, and none of them is a feed card (the e2e suites count those).
      const shelf = container.querySelector('[data-teacher-shelf]')!
      expect([...shelf.querySelectorAll('[data-testid="card"]')].map((c) => c.getAttribute('data-id'))).toEqual(['t0', 't1', 't2'])
      expect(shelf.querySelector('[data-feed-card]')).toBeNull()
    } finally {
      act(() => root?.unmount())
      container.remove()
    }
  })

  it('feed card 0 keeps the page\'s one LCP hint; no shelf card takes priority or lcp', () => {
    mount(newClient())
    const lcp = [...document.querySelectorAll('[data-testid="card"][data-lcp]')].map((c) => c.getAttribute('data-id'))
    expect(lcp).toEqual(['r0'])
    expect(shelfEl()!.querySelectorAll('[data-lcp], [data-priority]')).toHaveLength(0)
  })
})

describe('only on the undirected home', () => {
  it('present on the home page — and with a sort, which is not a filter (?sort=recent)', async () => {
    mount(newClient())
    expect(gridOrder()).toEqual([...SEED().map((l) => l.id), 'shelf', 'capture'])
    cleanup()
    __resetExplorerCommittedForTests()
    window.history.replaceState({}, '', '/?sort=recent')
    mount(newClient())
    // The URL was applied (its own request went out) and the shelf is still after the twelfth card.
    await waitFor(() => expect(listingsRequests().some((u) => u.searchParams.get('sort') === 'recent')).toBe(true))
    await waitFor(() => expect(gridOrder().slice(11, 14)).toEqual(['r11', 'shelf', 'capture']))
  })

  it.each([
    ['a search', '/?q=phone', (u: URL) => u.searchParams.get('q') === 'phone'],
    ['a category', '/?category=rentals', (u: URL) => u.searchParams.get('category') === 'rentals'],
  ])('gone on %s once the URL is applied', async (_name, url, asked) => {
    window.history.replaceState({}, '', url)
    mount(newClient())
    await waitFor(() => expect(listingsRequests().some(asked)).toBe(true))
    await waitFor(() => expect(shelfEl()).toBeNull())
    // …while the feed itself is still a grid with its capture row: only the shelf went.
    await waitFor(() => expect(document.querySelector('[data-testid="capture-row"]')).not.toBeNull())
  })

  it.each([['the map', '/?view=map'], ['the video feed', '/?view=video']])('gone in %s view', async (_name, url) => {
    window.history.replaceState({}, '', url)
    mount(newClient())
    await waitFor(() => expect(shelfEl()).toBeNull())
  })

  it('never on a storefront, never below three teachers, never without the prop', () => {
    mount(newClient(), { sellerId: 'shop-1' })
    expect(shelfEl()).toBeNull()
    cleanup()
    __resetExplorerCommittedForTests()
    mount(newClient(), { initialTeachers: TEACHERS(2) })
    expect(shelfEl()).toBeNull()
    expect(document.querySelector('[data-testid="capture-row"]')).not.toBeNull() // the grid itself is unchanged
    cleanup()
    __resetExplorerCommittedForTests()
    mount(newClient(), { initialTeachers: undefined })
    expect(shelfEl()).toBeNull()
  })
})

describe('a tap on the shelf', () => {
  const scrollY = (y: number) => Object.defineProperty(window, 'scrollY', { value: y, configurable: true })
  afterEach(() => {
    scrollY(0)
    delete (document.documentElement as unknown as { scrollHeight?: number }).scrollHeight
    ;(window.history as { scrollRestoration?: string }).scrollRestoration = 'auto'
  })

  it('opens the profile and snapshots the feed WITHOUT an anchor — and Back restores the raw offset in its first frame', async () => {
    const push = vi.fn()
    h.router.push = push
    const client = newClient()
    const first = mount(client)
    scrollY(1_800)
    act(() => { (shelfEl()!.querySelectorAll('[data-testid="card"]')[1] as HTMLButtonElement).click() })
    expect(push).toHaveBeenCalledWith('/listings/t1')
    const snap = JSON.parse(sessionStorage.getItem('eno:feed-snap') ?? 'null')
    expect(snap).toMatchObject({ anchorId: null, scrollY: 1_800, page: 1 })
    first.unmount() // → /listings/t1

    // ← Back. A document tall enough to hold the offset (jsdom lays out nothing — so say so).
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 6_000, configurable: true })
    const scrolled = vi.fn()
    window.scrollTo = scrolled as unknown as typeof window.scrollTo
    mount(client)
    // In the Back mount's own commit — no frame loop hunting for a `[data-feed-card="t1"]` that the grid never holds.
    expect(h.restores).toEqual([{ anchorId: null, found: false }])
    expect(scrolled).toHaveBeenCalledWith(0, 1_800)
  })

  it('a feed card\'s tap still anchors on the card (every other caller is unchanged)', () => {
    mount(newClient())
    act(() => { (document.querySelector('[data-feed-card="r4"] [data-testid="card"]') as HTMLButtonElement).click() })
    expect(JSON.parse(sessionStorage.getItem('eno:feed-snap') ?? 'null')).toMatchObject({ anchorId: 'r4' })
  })
})

/**
 * Signed in, the guest capture row is gone, so the shelf is the grid's LAST row until "Browse everything" and then has
 * page two's cards right after it — the two states globals.css and the shelf's `not-last:` hairline key on (one line
 * between blocks: the feed footer's own when it is last, its bottom one when rows follow). jsdom draws no CSS; this pins
 * the structure those rules read.
 */
describe('signed in (no guest capture row)', () => {
  it('the shelf is the grid\'s last row until "Browse everything"; page two\'s cards then follow it', async () => {
    h.auth.user = { id: 'u1' }
    mount(newClient())
    expect(gridOrder()).toEqual([...SEED().map((l) => l.id), 'shelf'])
    act(() => { screen.getByRole('button', { name: 'Browse everything' }).click() })
    await waitFor(() => expect(gridOrder().slice(11, 15)).toEqual(['r11', 'shelf', 'H2', 'r12']))
    expect(gridOrder()).toHaveLength(12 + 1 + 1 + 12)
  })
})

/**
 * THE OUTLINE (canon §3b, WCAG 1.3.1 — review, 2026-10-13). The shelf's <h2> sits inside the grid, so the cards AFTER it
 * would be outlined under "Find a teacher". Once cards follow it, an sr-only <h2> naming the feed (the heading above the
 * grid says it) hands them back — after the capture row for a guest, so globals.css's `[data-teacher-shelf] + …` hairline
 * rule still lands on that row. None while the shelf is the end of page one (the server HTML), and none without a shelf.
 */
describe('the feed\'s heading after the shelf', () => {
  it('a guest after "Browse everything": shelf → capture row → the feed\'s sr-only <h2> → page two', async () => {
    mount(newClient())
    expect(h2s()).toEqual(['Recommended', 'Find a teacher'])
    act(() => { screen.getByRole('button', { name: 'Browse everything' }).click() })
    await waitFor(() => expect(gridOrder().slice(11, 16)).toEqual(['r11', 'shelf', 'capture', 'H2', 'r12']))
    expect(h2s()).toEqual(['Recommended', 'Find a teacher', 'Recommended (sr-only)'])
  })

  it('names the order the feed is in, as the heading above does (Newest → "Latest listings")', async () => {
    h.auth.user = { id: 'u1' }
    window.history.replaceState({}, '', '/?sort=recent')
    mount(newClient())
    await waitFor(() => expect(listingsRequests().some((u) => u.searchParams.get('sort') === 'recent')).toBe(true))
    act(() => { screen.getByRole('button', { name: 'Browse everything' }).click() })
    await waitFor(() => expect(gridOrder().slice(11, 15)).toEqual(['r11', 'shelf', 'H2', 'r12']))
    expect(h2s()).toEqual(['Latest listings', 'Find a teacher', 'Latest listings (sr-only)'])
  })

  it('no shelf, no second heading: page two simply continues the feed', async () => {
    h.auth.user = { id: 'u1' }
    mount(newClient(), { initialTeachers: TEACHERS(2) })
    act(() => { screen.getByRole('button', { name: 'Browse everything' }).click() })
    await waitFor(() => expect(gridOrder().slice(11, 13)).toEqual(['r11', 'r12']))
    expect(h2s()).toEqual(['Recommended'])
  })
})
