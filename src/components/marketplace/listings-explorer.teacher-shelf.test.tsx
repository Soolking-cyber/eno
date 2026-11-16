// @vitest-environment jsdom
/**
 * THE HOME "FIND A TEACHER" SHELF INSIDE THE REAL <ListingsExplorer> (owner, 2026-10-13 — teacher-shelf.tsx) — replayed
 * through the explorer's own state machine against a fake /api/listings, the feed-ux harness's shape: the heavy children
 * are stubbed, the URL hydration, the react-query keys and the back-nav snapshot are the real ones.
 *
 * Pinned: the shelf is the grid row right AFTER the twelfth feed card and before the guest capture row, in the server
 * HTML and through hydration with no recoverable error; feed card 0 keeps the desktop's LCP hint (the phone's is the Trending
 * lane's — the home page's phone lanes, below); it is the undirected
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
// The card: its id, and the two LCP props as attributes, so "who got the preload" can be read off the DOM (`lcp` is true or a
// media query since 2026-11-14 — ListingCard's prop note).
vi.mock('./listing-card', () => ({
  ListingCard: ({ listing, onOpen, priority, lcp }: { listing: SerializedListingCard; onOpen?: (l: SerializedListingCard) => void; priority?: boolean; lcp?: boolean | string }) => (
    <button type="button" data-testid="card" data-id={listing.id} data-priority={priority ? '' : undefined} data-lcp={lcp === true ? 'true' : lcp || undefined} onClick={() => onOpen?.(listing)}>
      {listing.title}
    </button>
  ),
}))
// The guest capture row is a MARKER here: the shelf's place is "after card 12, before this". Like the real row, it
// renders nothing for a signed-in reader.
vi.mock('./capture-card', () => ({ CaptureCard: () => (h.auth.user ? null : <div data-testid="capture-row" />) }))
vi.mock('./brand-rail', () => ({ BrandRail: () => null }))
// The tile rail is a MARKER carrying whether the explorer asked for the home's phone pills (build 7, `pills`).
vi.mock('./category-rail', () => ({ CategoryRail: ({ pills }: { pills?: boolean }) => <div data-testid="category-rail" data-pills={pills ? '' : undefined} /> }))
// The two seeded rails are MARKERS carrying the props the explorer decides (where, which look, which LCP / personalization media).
vi.mock('./for-you-rail', () => ({
  ForYouRail: ({ look, lead, lcpMedia, liveMedia }: { look?: string; lead?: boolean; lcpMedia?: string; liveMedia?: string }) => (
    <section data-rail="trending" data-look={look ?? 'rail'} data-lead={lead ? '' : undefined} data-lcp-media={lcpMedia} data-live-media={liveMedia} />
  ),
}))
vi.mock('./recently-viewed-rail', () => ({ RecentlyViewedRail: () => null }))
vi.mock('./business-rail', () => ({ BusinessRail: ({ look }: { look?: string }) => <section data-rail="business" data-look={look ?? 'rail'} /> }))
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
/** What /api/category-rails answers (the home lanes' freshness check — category-rails.tsx useFreshCategoryLanes). */
let railsAnswer: unknown = {}
const requests: URL[] = []
function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    const url = new URL(u, 'https://eno.vn')
    requests.push(url)
    const offset = Number(url.searchParams.get('offset') ?? 0)
    const limit = Number(url.searchParams.get('limit') ?? 12)
    const body = url.pathname === '/api/listings'
      ? { listings: catalogue.slice(offset, offset + limit), total: catalogue.length, offset, limit, subcategoryCounts: {}, categoryTotal: catalogue.length, facets: {}, inferredDistrict: null, correctedQuery: null }
      : url.pathname === '/api/search/trending' ? { trending: [] }
      : url.pathname === '/api/category-rails' ? railsAnswer : {}
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
/** The grid's children as the reader meets them: a card id, 'band', 'shelf', 'capture', or another tag. */
const gridOrder = (g: Element = grid()) => [...g.children].map((el) =>
  el.getAttribute('data-feed-card') ?? (el.hasAttribute('data-partner-band') ? 'band' : el.hasAttribute('data-teacher-shelf') ? 'shelf' : el.getAttribute('data-testid') === 'capture-row' ? 'capture' : el.tagName))
/** The phone's lanes above the feed (2026-11-14): each lane's marker or heading, in document order. */
const laneOrder = () => [...(document.querySelector('[data-home-lanes]')?.children ?? [])].map((el) =>
  el.getAttribute('data-rail') ?? (el.hasAttribute('data-partner-band') ? 'partners' : el.querySelector('h2')?.textContent ?? el.tagName))
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
  railsAnswer = {}
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

describe('the home page\'s ItemList JSON-LD (home-item-lists.ts)', () => {
  const ldOf = (root: ParentNode) => {
    const el = root.querySelector('script[type="application/ld+json"]')
    return el ? (JSON.parse(el.textContent || '{}') as { '@graph': Array<{ name: string; itemListElement: Array<{ position: number; url: string }> }> }) : null
  }
  const ids = (list: { itemListElement: Array<{ url: string }> }) => list.itemListElement.map((i) => i.url.replace(/^.*\/listings\//, ''))

  it('in the SERVER HTML: one ItemList per drawn list, the arrays the rails draw, URL-only; it hydrates with no recoverable error', async () => {
    const TRENDING = () => catalogue.slice(12, 16)
    const el = (
      <QueryClientProvider client={newClient()}>
        <ListingsExplorer categories={[]} initialListings={SEED()} initialTotal={catalogue.length} initialTeachers={TEACHERS()} initialTrending={TRENDING()} homeItemLists siteHeading={false} />
      </QueryClientProvider>
    )
    const container = document.body.appendChild(document.createElement('div'))
    const errors: unknown[] = []
    let root: Root | null = null
    try {
      container.innerHTML = renderToString(el)
      const ld = ldOf(container)!
      const { CATEGORY_ENTRY_LABELS } = await import('@/lib/category-entry-label')
      expect(ld['@graph'].map((l) => l.name)).toEqual(['Trending now', CATEGORY_ENTRY_LABELS.teachers.name, 'Recommended'])
      const [trending, teachers, recommended] = ld['@graph']
      expect(ids(trending)).toEqual(TRENDING().map((l) => l.id))
      expect(ids(teachers)).toEqual(['t0', 't1', 't2'])
      expect(ids(recommended)).toEqual(SEED().map((l) => l.id))
      // ⛔ Only what the page draws: every teacher and feed item is a card in this same server HTML.
      const drawn = new Set([...container.querySelectorAll('[data-testid="card"]')].map((c) => c.getAttribute('data-id')))
      for (const id of [...ids(teachers), ...ids(recommended)]) expect(drawn.has(id), id).toBe(true)
      expect(recommended.itemListElement[0]).toEqual({ '@type': 'ListItem', position: 1, url: expect.stringMatching(/^https?:\/\/[^/]+\/listings\/r0$/) })
      await act(async () => { root = hydrateRoot(container, el, { onRecoverableError: (e) => errors.push(e) }) })
      expect(errors).toEqual([])
    } finally {
      act(() => root?.unmount())
      container.remove()
    }
  })

  it('a rail under its draw floor is not listed; nothing at all without homeItemLists or on a storefront', () => {
    const html = (props: Partial<React.ComponentProps<typeof ListingsExplorer>>) => {
      const div = document.createElement('div')
      div.innerHTML = renderToString(
        <QueryClientProvider client={newClient()}>
          <ListingsExplorer categories={[]} initialListings={SEED()} initialTotal={catalogue.length} {...props} />
        </QueryClientProvider>,
      )
      return div
    }
    const thin = ldOf(html({ homeItemLists: true, siteHeading: false, initialTrending: catalogue.slice(12, 14), initialTeachers: TEACHERS(2) }))!
    expect(thin['@graph'].map((l) => l.name)).toEqual(['Recommended'])
    expect(ldOf(html({ initialTrending: catalogue.slice(12, 16) }))).toBeNull()
    expect(ldOf(html({ homeItemLists: true, sellerId: 'shop1', initialTrending: catalogue.slice(12, 16) }))).toBeNull()
  })
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

  it('feed card 0 keeps the desktop\'s LCP hint (media-scoped on the home, whose phone opens on its lanes); no shelf card takes priority or lcp', () => {
    mount(newClient(), { initialTrending: Array.from({ length: 3 }, (_, i) => row(`tr${i}`)) })
    const lcp = [...document.querySelectorAll('[data-testid="card"][data-lcp]')].map((c) => [c.getAttribute('data-id'), c.getAttribute('data-lcp')])
    expect(lcp).toEqual([['r0', '(min-width: 40rem)']])
    // The phone's half is the Trending lane's first card.
    expect(document.querySelector('[data-home-lanes] [data-rail="trending"]')!.getAttribute('data-lcp-media')).toBe('(max-width: 39.99rem)')
    expect(shelfEl()!.querySelectorAll('[data-lcp], [data-priority]')).toHaveLength(0)
    cleanup()
    __resetExplorerCommittedForTests()
    // A storefront has no lanes: its first card keeps the whole hint.
    mount(newClient(), { sellerId: 'shop-1' })
    expect([...document.querySelectorAll('[data-testid="card"][data-lcp]')].map((c) => c.getAttribute('data-lcp'))).toEqual(['true'])
    cleanup()
    __resetExplorerCommittedForTests()
    // Under three Trending seeds the phone's Trending lane draws nothing: the grid's first card keeps the whole hint.
    mount(newClient(), { initialTrending: Array.from({ length: 2 }, (_, i) => row(`tr${i}`)) })
    expect([...document.querySelectorAll('[data-testid="card"][data-lcp]')].map((c) => [c.getAttribute('data-id'), c.getAttribute('data-lcp')])).toEqual([['r0', 'true']])
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
    // …and the phone's partner row with it (owner, 2026-11-10: a search or a category result shows no band on a phone).
    await waitFor(() => expect(document.querySelector('[data-partner-band]')).toBeNull())
    // …while the feed itself is still a grid with its capture row: only the home's own rows went.
    await waitFor(() => expect(document.querySelector('[data-testid="capture-row"]')).not.toBeNull())
  })

  it.each([['the map', '/?view=map'], ['the video feed', '/?view=video']])('gone in %s view', async (_name, url) => {
    window.history.replaceState({}, '', url)
    mount(newClient())
    await waitFor(() => expect(shelfEl()).toBeNull())
    await waitFor(() => expect(document.querySelector('[data-partner-band]')).toBeNull())
  })

  it('never on a storefront, never below three teachers, never without the prop', () => {
    mount(newClient(), { sellerId: 'shop-1' })
    expect(shelfEl()).toBeNull()
    expect(document.querySelector('[data-partner-band]')).toBeNull() // nor the partner row: a storefront is not the home feed
    cleanup()
    __resetExplorerCommittedForTests()
    mount(newClient(), { initialTeachers: TEACHERS(2) })
    expect(shelfEl()).toBeNull()
    expect(document.querySelector('[data-testid="capture-row"]')).not.toBeNull() // the grid itself is unchanged
    cleanup()
    __resetExplorerCommittedForTests()
    mount(newClient(), { initialTeachers: undefined })
    expect(shelfEl()).toBeNull()
    // The partner lane does not depend on teachers: it is still among the phone's lanes, and never a grid row (2026-11-14).
    expect(document.querySelector('[data-home-lanes] [data-partner-band]')).not.toBeNull()
    expect(grid().querySelector('[data-partner-band]')).toBeNull()
  })

  // Commit review (2026-11-10): the layout's own band is hidden on a phone, so a short home feed must still carry one — it is
  // a lane above the feed now, whatever the feed's length.
  it('a home feed of three cards still shows the partner lane', async () => {
    const full = catalogue
    catalogue = full.slice(0, 3)
    try {
      mount(newClient(), { initialListings: catalogue, initialTotal: 3 })
      await waitFor(() => expect(gridOrder()).toEqual(['r0', 'r1', 'r2']))
      expect(document.querySelector('[data-home-lanes] [data-partner-band]')).not.toBeNull()
    } finally {
      catalogue = full
    }
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
    // twelve cards + the shelf + the sr-only heading + page two's twelve (the partner row left the grid on 2026-11-14)
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
    // The phone's Partners lane heads its lanes, above the feed (2026-11-14; its other lanes are markers here).
    expect(h2s()).toEqual(['Partners', 'Recommended', 'Find a teacher'])
    act(() => { screen.getByRole('button', { name: 'Browse everything' }).click() })
    await waitFor(() => expect(gridOrder().slice(11, 16)).toEqual(['r11', 'shelf', 'capture', 'H2', 'r12']))
    expect(h2s()).toEqual(['Partners', 'Recommended', 'Find a teacher', 'Recommended (sr-only)'])
  })

  it('names the order the feed is in, as the heading above does (Newest → "Latest listings")', async () => {
    h.auth.user = { id: 'u1' }
    window.history.replaceState({}, '', '/?sort=recent')
    mount(newClient())
    await waitFor(() => expect(listingsRequests().some((u) => u.searchParams.get('sort') === 'recent')).toBe(true))
    act(() => { screen.getByRole('button', { name: 'Browse everything' }).click() })
    await waitFor(() => expect(gridOrder().slice(11, 15)).toEqual(['r11', 'shelf', 'H2', 'r12']))
    expect(h2s()).toEqual(['Partners', 'Latest listings', 'Find a teacher', 'Latest listings (sr-only)'])
  })

  it('no shelf, no second heading: page two simply continues the feed', async () => {
    h.auth.user = { id: 'u1' }
    mount(newClient(), { initialTeachers: TEACHERS(2) })
    act(() => { screen.getByRole('button', { name: 'Browse everything' }).click() })
    await waitFor(() => expect(gridOrder().slice(11, 13)).toEqual(['r11', 'r12']))
    expect(h2s()).toEqual(['Partners', 'Recommended'])
  })
})

/**
 * ⛔ THE HOME PAGE'S PHONE LANES (owner-approved 2026-11-14, cook r04 home-b "lanes as rails" — listings-explorer.tsx, the
 * `data-home-lanes` block). On a phone the undirected home reads tiles → lanes → toolbar → Recommended → grid; the block is
 * `sm:hidden`, and the shelves under the feed are `max-sm:hidden` (desktop unchanged). jsdom draws no CSS, so this pins the
 * structure and the classes those rules read, in the server HTML and through hydration.
 */
describe('the home page\'s phone lanes', () => {
  const cat = (slug: string) => ({ id: `c-${slug}`, slug, name: slug, nameVi: slug, icon: 'Home' }) as unknown as import('@/lib/types').SerializedCategory
  const cats = ['rentals', 'services', 'fashion-beauty', 'furniture-appliances'].map(cat)
  const rails = cats.map((c, i) => ({ slug: c.slug, listings: Array.from({ length: 4 }, (_, j) => row(`${c.slug}-${i}-${j}`)) }))
  const homeProps = { categories: cats, initialCategoryRails: rails, initialTrending: Array.from({ length: 4 }, (_, i) => row(`tr${i}`)), initialBusinesses: Array.from({ length: 4 }, (_, i) => row(`b${i}`)) }

  // ⛔ Product lanes first, then Partners, then Outstanding businesses and the flyer lanes (owner-approved 2026-11-15 (build 8),
  // cook r08 home — it reverses build 7's Partners before the second category lane and r04's fixed order). In the DOM, picked
  // by slug (Services goes last whatever the server's order put it second), so the reading order is the screen's.
  it('in order: Trending, the product category lanes in the server\'s order, Partners, Outstanding businesses, then Services', () => {
    mount(newClient(), homeProps)
    expect(laneOrder()).toEqual(['trending', 'rentals', 'fashion-beauty', 'furniture-appliances', 'partners', 'business', 'services'])
    // Every lane in the lane look; Trending carries the phone's LCP and personalizes only on a phone.
    const trending = document.querySelector('[data-home-lanes] [data-rail="trending"]')!
    expect([trending.getAttribute('data-look'), trending.getAttribute('data-live-media')]).toEqual(['lane', '(max-width: 39.99rem)'])
    expect(document.querySelector('[data-home-lanes] [data-rail="business"]')!.getAttribute('data-look')).toBe('lane')
    expect(document.querySelectorAll('[data-home-lanes] section[data-lane]')).toHaveLength(4) // the four category lanes
  })

  // ⛔ The first lane leads (build 7): Trending's heading is the page's one display line; with too few Trending cards to draw,
  // the first category lane's is. No other lane takes it.
  it('the lead heading: Trending, or the first category lane when Trending cannot draw', () => {
    mount(newClient(), homeProps)
    expect(document.querySelector('[data-home-lanes] [data-rail="trending"]')!.hasAttribute('data-lead')).toBe(true)
    const display = () => [...document.querySelectorAll('[data-home-lanes] section[data-lane]')].map((s) => s.querySelector('h2 [class~="max-sm:text-t-display"]') !== null)
    expect(display()).toEqual([false, false, false, false])
    cleanup()
    __resetExplorerCommittedForTests()
    mount(newClient(), { ...homeProps, initialTrending: Array.from({ length: 2 }, (_, i) => row(`tr${i}`)) })
    expect(display()).toEqual([true, false, false, false])
  })

  // ⛔ The undirected home's phone category row is pills (build 7, category-rail.tsx `pills`) exactly where the lanes are: never on
  // a storefront, and not once the feed is directed (where a phone folds the row into its compact panel).
  it('asks the category rail for pills on the undirected home only', async () => {
    mount(newClient(), homeProps)
    expect(screen.getAllByTestId('category-rail').every((r) => r.hasAttribute('data-pills'))).toBe(true)
    cleanup()
    __resetExplorerCommittedForTests()
    mount(newClient(), { ...homeProps, sellerId: 'shop-1' })
    expect(screen.getAllByTestId('category-rail').some((r) => r.hasAttribute('data-pills'))).toBe(false)
    cleanup()
    __resetExplorerCommittedForTests()
    window.history.replaceState({}, '', '/?category=rentals')
    mount(newClient(), homeProps)
    await waitFor(() => expect(listingsRequests().some((u) => u.searchParams.get('category') === 'rentals')).toBe(true))
    await waitFor(() => expect(screen.queryAllByTestId('category-rail').some((r) => r.hasAttribute('data-pills'))).toBe(false))
  })

  it('above the toolbar and the feed, phone-only; the shelves under the feed are desktop-only and draw the same lanes', () => {
    mount(newClient(), homeProps)
    const lanes = document.querySelector('[data-home-lanes]')!
    // 40px between lanes and no top padding (build 8; the pills' own 12px margin is the space above the first lane).
    expect(lanes.className.split(' ')).toEqual(expect.arrayContaining(['sm:hidden', 'flex', 'flex-col', 'gap-10']))
    expect(lanes.className.split(' ')).not.toContain('pt-1')
    const toolbar = document.getElementById('explorer-toolbar')!
    expect(lanes.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(lanes.compareDocumentPosition(grid()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The first category lane's cards are drawn (in the server HTML); the later ones wait behind same-size placeholders.
    const laneSections = [...lanes.querySelectorAll('section[data-lane]')]
    expect(laneSections[0].querySelectorAll('[data-testid="card"]')).toHaveLength(4)
    expect(laneSections[1].querySelectorAll('[data-testid="card"]')).toHaveLength(0)
    // No grid row for the partners any more.
    expect(grid().querySelector('[data-partner-band]')).toBeNull()
  })

  // ⛔ Build 8: the pills pin under the header while the lanes scroll and let go with the last lane — their sticky box is the
  // ladder's head (the slot, the recents row, the lanes), and the feed's sticky strip is outside it. The header stays put
  // while the lanes are drawn (use-header-pin.ts), and slides again once the feed is directed.
  it('the ladder\'s head holds the category row and the lanes — not the toolbar; the header is pinned while the lanes are drawn', async () => {
    const { useHeaderPinned } = await import('@/hooks/use-header-pin')
    const Probe = () => <i data-testid="pin-probe" data-pinned={String(useHeaderPinned())} />
    mount(newClient(), homeProps)
    render(<Probe />)
    const head = document.querySelector('[data-ladder] > [data-ladder-head]')!
    expect(head).not.toBeNull()
    expect(head.className.split(' ')).toEqual(['space-y-3'])
    expect(head.contains(screen.getAllByTestId('category-rail')[0])).toBe(true)
    expect(head.contains(document.querySelector('[data-home-lanes]'))).toBe(true)
    expect(head.contains(document.getElementById('explorer-toolbar'))).toBe(false)
    expect(screen.getByTestId('pin-probe').getAttribute('data-pinned')).toBe('true')
    cleanup()
    __resetExplorerCommittedForTests()
    render(<Probe />)
    // The explorer is gone: nothing pins the header.
    expect(screen.getByTestId('pin-probe').getAttribute('data-pinned')).toBe('false')
    // A feed that keeps its compact row (Jobs — its teacher door; since 2026-11-16 a bare category feed opens on the goods
    // search's title line instead, owner hub Q17 — listings-explorer.tsx `catRow`).
    window.history.replaceState({}, '', '/?category=jobs')
    mount(newClient(), homeProps)
    await waitFor(() => expect(document.querySelector('[data-home-lanes]')).toBeNull())
    expect(screen.getByTestId('pin-probe').getAttribute('data-pinned')).toBe('false')
    // Directed, the head is still there (nothing remounts), holding only the slot.
    expect(document.querySelector('[data-ladder] > [data-ladder-head]')).not.toBeNull()
  })

  it('in the server HTML, hydrating with no recoverable error', async () => {
    const el = (
      <QueryClientProvider client={newClient()}>
        <ListingsExplorer initialListings={SEED()} initialTotal={catalogue.length} initialTeachers={TEACHERS()} {...homeProps} />
      </QueryClientProvider>
    )
    const container = document.body.appendChild(document.createElement('div'))
    const errors: unknown[] = []
    let root: Root | null = null
    try {
      container.innerHTML = renderToString(el)
      expect(container.querySelector('[data-home-lanes]')).not.toBeNull()
      expect(container.querySelectorAll('[data-home-lanes] section[data-lane] h2')).toHaveLength(4)
      await act(async () => { root = hydrateRoot(container, el, { onRecoverableError: (e) => errors.push(e) }) })
      expect(errors).toEqual([])
    } finally {
      act(() => root?.unmount())
      container.remove()
    }
  })

  it.each([
    ['a search', '/?q=phone'],
    ['a category', '/?category=rentals'],
    ['the map view', '/?view=map'],
  ])('gone on %s, and the pre-paint mark goes with them', async (_name, url) => {
    window.history.replaceState({}, '', url)
    document.documentElement.setAttribute('data-explorer-directed', '')
    document.documentElement.setAttribute('data-home-lanes-off', '')
    try {
      mount(newClient(), homeProps)
      await waitFor(() => expect(document.querySelector('[data-home-lanes]')).toBeNull())
      await waitFor(() => expect(document.documentElement.hasAttribute('data-home-lanes-off')).toBe(false))
    } finally {
      document.documentElement.removeAttribute('data-explorer-directed')
      document.documentElement.removeAttribute('data-home-lanes-off')
    }
  })

  /**
   * ⛔ THE ISR ANSWER IS CHECKED ONCE (commit review, 2026-11-14 — category-rails.tsx useFreshCategoryLanes): the lanes paint
   * the server's cards, then a phone asks /api/category-rails once and a card taken down since leaves, however young the
   * page; the phone's copy asks only on a phone, and the desktop's shelves only once they are drawn.
   */
  describe('the freshness check', () => {
    const OLD = () => Date.now() - 6 * 3600_000
    const railsAsks = () => requests.filter((u) => u.pathname === '/api/category-rails').map((u) => u.search)
    const laneCards = (i: number) => [...document.querySelectorAll('[data-home-lanes] section[data-lane]')[i].querySelectorAll('[data-testid="card"]')].map((c) => c.getAttribute('data-id'))
    const onPhone = () => vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(max-width: 39.99rem)', media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))

    it('on a phone: one ask, in the reader\'s language, and the card taken down since leaves the first lane', async () => {
      onPhone()
      const [gone, ...kept] = rails[0].listings
      railsAnswer = { rails: [{ ...rails[0], listings: kept }, ...rails.slice(1)] }
      mount(newClient(), { ...homeProps, initialFetchedAt: OLD() })
      expect(laneCards(0)).toEqual(rails[0].listings.map((l) => l.id)) // the server's cards paint first
      await waitFor(() => expect(laneCards(0)).toEqual(kept.map((l) => l.id)))
      expect(laneCards(0)).not.toContain(gone.id)
      expect(railsAsks()).toEqual(['?lang=en'])
      expect(laneOrder()).toEqual(['trending', 'rentals', 'fashion-beauty', 'furniture-appliances', 'partners', 'business', 'services'])
    })

    it('a young answer is checked too (no age gate on the browser clock); a desktop, where the phone block is display:none, asks nothing', async () => {
      onPhone()
      mount(newClient(), { ...homeProps, initialFetchedAt: Date.now() - 20_000 })
      await waitFor(() => expect(railsAsks()).toEqual(['?lang=en']))
      cleanup()
      __resetExplorerCommittedForTests()
      installDomStubs() // matchMedia: nothing matches — a desktop's widths for these queries
      const before = railsAsks().length
      mount(newClient(), { ...homeProps, initialFetchedAt: OLD() })
      await act(async () => { await new Promise((r) => setTimeout(r, 800)) })
      expect(railsAsks().slice(before)).toEqual([])
    })
  })

  it('kept with a sort (not a filter), and never on a storefront', async () => {
    window.history.replaceState({}, '', '/?sort=recent')
    mount(newClient(), homeProps)
    await waitFor(() => expect(listingsRequests().some((u) => u.searchParams.get('sort') === 'recent')).toBe(true))
    expect(laneOrder()[0]).toBe('trending')
    cleanup()
    __resetExplorerCommittedForTests()
    window.history.replaceState({}, '', '/')
    mount(newClient(), { ...homeProps, sellerId: 'shop-1' })
    expect(document.querySelector('[data-home-lanes]')).toBeNull()
  })
})
