// @vitest-environment jsdom
/**
 * THE FEED'S MOBILE UX CONTRACTS (mobile audit, wave 2) — replayed through the real
 * <ListingsExplorer> against a fake /api/listings. Each `describe` is one fix, and each test was
 * run against the explorer WITHOUT that fix and failed there (mutation-checked when it landed).
 *
 * ⚠️ NO NETWORK: `fetch` is a fake server. The heavy children (cards, rails, dynamic chunks) are
 * stubbed; the explorer's own state machine — URL hydration, the react-query keys, the prefetch,
 * the sync effect — is the real one. Same harness shape as listings-explorer.back-nav-filter.test.tsx.
 */
import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'

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
// Every code-split chunk (FacetBar, map, video, rails) is out of scope and renders nothing.
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => h.language,
  useTr: (s: string) => s,
  Tr: ({ text }: { text?: string | null }) => <>{text}</>,
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => h.auth }))
vi.mock('@/lib/analytics', () => ({ trackSearch: () => {} }))
vi.mock('./listing-card', () => ({
  ListingCard: ({ listing, onOpen }: { listing: SerializedListingCard; onOpen?: (l: SerializedListingCard) => void }) => (
    <button type="button" data-testid="card" data-id={listing.id} onClick={() => onOpen?.(listing)}>{listing.title}</button>
  ),
}))
vi.mock('./capture-card', () => ({ CaptureCard: () => null }))
vi.mock('./brand-rail', () => ({ BrandRail: () => null }))
vi.mock('./category-rail', () => ({ CategoryRail: () => null }))
vi.mock('./for-you-rail', () => ({ ForYouRail: () => null }))
vi.mock('./recently-viewed-rail', () => ({ RecentlyViewedRail: () => null }))
vi.mock('./business-rail', () => ({ BusinessRail: () => null }))
vi.mock('./trending-searches', () => ({ TrendingSearches: () => null }))
vi.mock('./ai-concierge', () => ({ AISearchButton: () => null }))

import { ListingsExplorer } from './listings-explorer'

// ─── A fake /api/listings ────────────────────────────────────────────────────────────────────
const row = (id: string): SerializedListingCard =>
  ({
    id, title: `Listing ${id}`, titleVi: null, price: 1_000_000, location: 'Ho Chi Minh City', district: 'District 1',
    postedAt: '2026-09-01T00:00:00.000Z', contactCount: 0,
    category: { slug: 'electronics', name: 'Electronics' },
  } as unknown as SerializedListingCard)

/** The whole catalogue the fake server pages through; tests size it per case. */
let catalogue: SerializedListingCard[] = []
const requests: URL[] = []
/** While set, every /api/listings request waits for it (a slow phone network). */
let gate: Promise<void> | null = null
function holdAll() {
  let release = () => {}
  gate = new Promise<void>((r) => { release = r })
  return () => { gate = null; release() }
}
/** When set, the server answers every page past the first with page 1's rows again (a reshuffle). */
let repeatFirstPage = false
function listingsRequests() { return requests.filter((u) => u.pathname === '/api/listings' && !u.searchParams.has('hasVideo')) }

function answer(url: URL) {
  const offset = Number(url.searchParams.get('offset') ?? 0)
  const limit = Number(url.searchParams.get('limit') ?? 12)
  const from = repeatFirstPage ? 0 : offset
  return {
    listings: catalogue.slice(from, from + limit), total: catalogue.length, offset, limit,
    subcategoryCounts: {}, categoryTotal: catalogue.length, facets: {},
  }
}

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    const url = new URL(u, 'https://eno.vn')
    requests.push(url)
    if (gate && url.pathname === '/api/listings') await gate
    const body = url.pathname === '/api/listings' ? answer(url) : {}
    return { ok: true, status: 200, json: async () => body } as Response
  }))
}

// ─── jsdom gaps the explorer touches ─────────────────────────────────────────────────────────
type FakeIO = { cb: IntersectionObserverCallback; el: Element | null }
const observers = new Set<FakeIO>()
function installDomStubs() {
  observers.clear()
  class IO {
    rec: FakeIO
    constructor(cb: IntersectionObserverCallback) { this.rec = { cb, el: null }; observers.add(this.rec) }
    observe(el: Element) { this.rec.el = el }
    unobserve() {}
    disconnect() { observers.delete(this.rec) }
    takeRecords() { return [] }
  }
  vi.stubGlobal('IntersectionObserver', IO)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  window.scrollTo = (() => {}) as typeof window.scrollTo
  window.scrollBy = (() => {}) as typeof window.scrollBy
  Element.prototype.scrollIntoView = () => {}
}

/** "Scroll to the bottom": fire every live observer as intersecting (the load-more sentinel among them). */
function scrollToSentinel() {
  act(() => {
    for (const o of [...observers]) {
      if (!o.el) continue
      o.cb([{ isIntersecting: true, target: o.el } as unknown as IntersectionObserverEntry], {} as IntersectionObserver)
    }
  })
}

const cardIds = () => screen.queryAllByTestId('card').map((c) => c.getAttribute('data-id'))
type FeedKey = readonly [string, { page: number }]
/** The pages `prefetchQuery` was asked to warm. */
const warmedPages = (spy: { mock: { calls: [{ queryKey?: unknown }][] } }) =>
  spy.mock.calls.map(([opts]) => (opts.queryKey as FeedKey)[1].page)
/** How many feed cache entries exist for one page — two means the warm-up and the live query disagree on the key. */
const entriesForPage = (client: QueryClient, page: number) =>
  client.getQueryCache().findAll({ queryKey: ['listings'] }).filter((q) => (q.queryKey as unknown as FeedKey)[1].page === page).length
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } })

function mount(client: QueryClient, props: Partial<React.ComponentProps<typeof ListingsExplorer>> = {}) {
  return render(
    <QueryClientProvider client={client}>
      <ListingsExplorer categories={[]} initialListings={[]} initialTotal={0} {...props} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  requests.length = 0
  gate = null
  repeatFirstPage = false
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

describe('the next-page warm-up shares the live query\'s cache entry', () => {
  it('downloads every feed page ONCE — the warm-up and the live query are one request', async () => {
    // A visual-search feed (?match=any): the hand-copied prefetch key had no `match` at all, so it
    // never equalled the live key and both went out — measured on prod as offsets 12…96 each twice.
    const client = newClient()
    const prefetch = vi.spyOn(client, 'prefetchQuery')
    window.history.replaceState({}, '', '/?q=phone&match=any')
    mount(client)
    await waitFor(() => expect(cardIds()).toHaveLength(12))

    scrollToSentinel()
    await waitFor(() => expect(cardIds()).toHaveLength(24))

    // The warm-up DID run (so "one request" below is a dedupe, not a warm-up that never fired)…
    expect(warmedPages(prefetch)).toContain(2)
    // …it and the live query are ONE cache entry…
    expect(entriesForPage(client, 2)).toBe(1)
    // …and ONE request, which is the LIVE question: the prefetch's own params dropped `match=any`,
    // which would seed the live page with a strict-AND answer now that the two share an entry.
    const page2 = listingsRequests().filter((u) => u.searchParams.get('offset') === '12')
    expect(page2).toHaveLength(1)
    expect(page2[0].searchParams.get('match')).toBe('any')
  })

  it('warms the last, partial page too (maxPage divides by the page size, 12 — not 24)', async () => {
    const client = newClient()
    const prefetch = vi.spyOn(client, 'prefetchQuery')
    window.history.replaceState({}, '', '/?q=phone')
    mount(client)
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    scrollToSentinel()
    await waitFor(() => expect(cardIds()).toHaveLength(24))

    scrollToSentinel() // 30 rows = pages of 12, 12, 6: page 3 exists
    await waitFor(() => expect(cardIds()).toHaveLength(30))
    expect(warmedPages(prefetch)).toContain(3)
    expect(entriesForPage(client, 3)).toBe(1) // warmed into the entry the live page 3 then read
  })
})

describe('"Browse everything" reserves the next rows in the tap\'s own frame', () => {
  const skeletons = () => document.querySelectorAll('[data-feed-skeleton]').length
  /** The home feed exactly as the ISR HTML seeds it: 12 rows of 30, behind the "Browse everything" gate. */
  function mountHome(client = newClient()) {
    mount(client, { initialListings: catalogue.slice(0, 12), initialTotal: catalogue.length })
    return client
  }

  it('appends 12 skeleton cells to the same grid in the tap\'s commit, then swaps them for the cards in place', async () => {
    mountHome()
    expect(cardIds()).toHaveLength(12)
    const release = holdAll() // page 2 is slow, as it is on a phone
    act(() => { screen.getByRole('button', { name: 'Browse everything' }).click() })

    // Before the answer: the grid already holds page 2's height. The shelves below moved with the tap
    // (0.514 CLS on production, where they rose into the button's place and were thrown down ~1s later).
    expect(skeletons()).toBe(12)
    expect(document.querySelector('.feed-grid [data-feed-skeleton]')).not.toBeNull()

    release()
    await waitFor(() => expect(cardIds()).toHaveLength(24))
    expect(skeletons()).toBe(0)
  })

  it('reserves only what the last page can hold, and leaves nothing behind once the feed ends', async () => {
    catalogue = catalogue.slice(0, 20) // pages of 12 and 8
    mountHome()
    const release = holdAll()
    act(() => { screen.getByRole('button', { name: 'Browse everything' }).click() })
    expect(skeletons()).toBe(8)
    release()
    await waitFor(() => expect(cardIds()).toHaveLength(20))
    expect(skeletons()).toBe(0)
  })

  it('the list view reserves its own rows the same way (auto-paging a searched feed)', async () => {
    window.history.replaceState({}, '', '/?q=phone&view=compact')
    mount(newClient())
    const rows = () => document.querySelectorAll('[data-feed-card]').length
    await waitFor(() => expect(rows()).toBe(12))
    const release = holdAll()
    scrollToSentinel()
    expect(skeletons()).toBe(12)
    release()
    await waitFor(() => expect(rows()).toBe(24))
    expect(skeletons()).toBe(0)
  })

  it('a page that brings nothing new (duplicates) does not strand its skeletons', async () => {
    repeatFirstPage = true
    mountHome()
    const release = holdAll()
    act(() => { screen.getByRole('button', { name: 'Browse everything' }).click() })
    expect(skeletons()).toBe(12) // reserved while it was on its way…
    release()
    await waitFor(() => expect(listingsRequests().some((u) => u.searchParams.get('offset') === '12')).toBe(true))
    await waitFor(() => expect(skeletons()).toBe(0)) // …and released when it brought nothing new
    expect(cardIds()).toHaveLength(12)
  })
})
