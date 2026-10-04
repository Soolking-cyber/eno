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
import { act, cleanup, configure, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToString } from 'react-dom/server'
import { hydrateRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'
import { installFakeIntersectionObserver } from '@/test/fake-intersection-observer'

// ⚠️ TIME FOR A HEAVY RENDER ON A LOADED MACHINE — TIMING, NOT BEHAVIOUR. At load average 120–170, 5 of
// 20 runs of this file failed on the defaults: "downloads every feed page ONCE" ran past vitest's 5 s
// test timeout, and "warms the last page" stopped at "12, expected 24" because page 2 landed in
// 830–960 ms against waitFor's 1,000 ms. Load, not a lost scroll: checked 2026-10-03 with an
// instrumented observer, and since 48f26b4c5 the fake cannot lose one — see
// src/test/fake-intersection-observer.ts. Same budget as listings-explorer.back-nav-filter.test.tsx,
// for this file only (vitest isolates files). Still bounded: a wait that never comes true fails at
// 5 s, a hung test at 30 s.
// ⛔ BUT A 5 s WAIT OUTLASTS SOME OF THE EXPLORER'S OWN TIMER FALLBACKS, which make the same thing true
// without the behaviour under test: the Back restore's 1.5 s release of the history entry, and the
// E-SSR mask's 12 s ceiling. A wait whose condition such a timer can reach must wait on something only
// the real path produces, or run with that timer disarmed (see the Back and E-SSR tests) — never just
// on the end state.
configure({ asyncUtilTimeout: 5_000 })
vi.setConfig({ testTimeout: 30_000 })

const h = vi.hoisted(() => {
  const router = { push: () => {}, prefetch: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }
  const tr = (en: string) => en
  const language = { lang: 'en', t: (k: string) => k, tr, setLang: () => {} }
  const auth = { user: null, profile: null, loading: false, openSignIn: () => {} }
  /** The props the explorer last handed <FacetBar> (a `next/dynamic` chunk, stubbed below). */
  const facet: { props: Record<string, unknown> | null } = { props: null }
  /** What `usePathname()` answers — the PUBLIC path in a browser, the INTERNAL `/en…` in a prerender. */
  const nav = { pathname: '/' }
  /** Every back-nav restore the explorer ran, as the `runRestore` wrapper below saw it. */
  const restores: {
    anchorId: string | null
    /** Did the loop ever find that card in the DOM? */
    found: boolean
    /** The entry's `history.scrollRestoration` when the loop started, and either side of its own `onDone`. */
    modeAtStart?: string
    modeBeforeDone?: string
    modeAfterDone?: string
  }[] = []
  return { router, language, auth, facet, nav, restores }
})

vi.mock('next/navigation', () => ({
  useRouter: () => h.router,
  usePathname: () => h.nav.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}))
// Every code-split chunk renders nothing — except that the FacetBar's props are RECORDED, because the
// Area pill's district is a contract under test. The loader is only inspected, never run; the tests
// that read the record assert it was filled, so a probe that stops matching fails loudly.
vi.mock('next/dynamic', () => ({
  default: (loader: () => unknown) => {
    if (String(loader).includes('facet-bar')) {
      return function FacetBarProbe(props: Record<string, unknown>) { h.facet.props = props; return null }
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
vi.mock('@/lib/analytics', () => ({ trackSearch: () => {} }))
vi.mock('./listing-card', () => ({
  ListingCard: ({ listing, onOpen }: { listing: SerializedListingCard; onOpen?: (l: SerializedListingCard) => void }) => (
    <button type="button" data-testid="card" data-id={listing.id} onClick={() => onOpen?.(listing)}>{listing.title}</button>
  ),
}))
vi.mock('./capture-card', () => ({ CaptureCard: () => null }))
// The two rails are markers: the phone ladder contract is about WHETHER they are on the page.
vi.mock('./brand-rail', () => ({ BrandRail: () => <div data-testid="brand-rail" /> }))
// The category rail is a marker too, carrying three sample tiles built from the explorer's own
// `hrefFor` — the E-TILES href contract is the explorer's, not the rail's.
vi.mock('./category-rail', () => ({
  CategoryRail: ({ hrefFor }: { hrefFor?: (p: { category?: string; type?: string } | null) => string }) => (
    <div data-testid="category-rail">
      {hrefFor ? (
        <>
          <a data-testid="tile-category" href={hrefFor({ category: 'rentals' })} />
          <a data-testid="tile-intent" href={hrefFor({ type: 'free' })} />
          <a data-testid="tile-clear" href={hrefFor(null)} />
        </>
      ) : null}
    </div>
  ),
}))
// The home placement renders nothing (as before); the sparse-results RECOVERY placement is a marker.
vi.mock('./for-you-rail', () => ({ ForYouRail: ({ recovery }: { recovery?: boolean }) => (recovery ? <div data-testid="for-you-recovery" /> : null) }))
vi.mock('./recently-viewed-rail', () => ({ RecentlyViewedRail: () => null }))
vi.mock('./business-rail', () => ({ BusinessRail: () => null }))
vi.mock('./trending-searches', () => ({ TrendingSearches: () => null }))
vi.mock('./ai-concierge', () => ({ AISearchButton: () => null }))
// The back-nav restore runs the REAL loop. The wrapper only records what it did, so the Back test can
// tell the restore's own release of the history entry from the explorer's 1.5 s safety net, which
// releases it on a timer whether anything was restored or not.
vi.mock('./feed-restore', async (importOriginal) => {
  const real = await importOriginal<typeof import('./feed-restore')>()
  const scrollMode = () => (window.history as { scrollRestoration?: string }).scrollRestoration
  const runRestore: typeof real.runRestore = (target, env, onDone) => {
    const run: (typeof h.restores)[number] = { anchorId: target.anchorId, found: false, modeAtStart: scrollMode() }
    h.restores.push(run)
    return real.runRestore(target, {
      ...env,
      anchorTopOf: (id) => {
        const top = env.anchorTopOf(id)
        if (top != null) run.found = true
        return top
      },
    }, () => {
      run.modeBeforeDone = scrollMode()
      onDone()
      run.modeAfterDone = scrollMode()
    })
  }
  return { ...real, runRestore }
})

import { ListingsExplorer, __resetExplorerCommittedForTests } from './listings-explorer'
import { SITE_NAME } from '@/lib/edition'

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
  // The server reads "Quận 7" out of the words when no explicit district is sent (district-query.ts).
  const inferredDistrict = !url.searchParams.get('district') && /quận 7/i.test(url.searchParams.get('q') ?? '') ? 'd7' : null
  const offset = Number(url.searchParams.get('offset') ?? 0)
  const limit = Number(url.searchParams.get('limit') ?? 12)
  const from = repeatFirstPage ? 0 : offset
  // "iphnoe" finds nothing as typed; asked with the spelling opt-in the server answers for "iphone"
  // and says so (src/app/api/listings/route.ts) — the only shape the explorer reads.
  if (url.searchParams.get('q') === 'iphnoe' && url.searchParams.get('spell') !== '1') {
    return { listings: [], total: 0, offset, limit, subcategoryCounts: {}, categoryTotal: 0, facets: {}, inferredDistrict, correctedQuery: null }
  }
  return {
    listings: catalogue.slice(from, from + limit), total: catalogue.length, offset, limit,
    subcategoryCounts: {}, categoryTotal: catalogue.length, facets: {}, inferredDistrict,
    correctedQuery: url.searchParams.get('q') === 'iphnoe' ? 'iphone' : null,
  }
}
/** What /api/search/trending answers: one is the typo itself, in another case. */
const TRENDING = ['iphone', 'Iphnoe', 'honda']

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    const url = new URL(u, 'https://eno.vn')
    requests.push(url)
    if (gate && url.pathname === '/api/listings') await gate
    const body = url.pathname === '/api/listings' ? answer(url) : url.pathname === '/api/search/trending' ? { trending: TRENDING } : {}
    return { ok: true, status: 200, json: async () => body } as Response
  }))
}

// ─── jsdom gaps the explorer touches ─────────────────────────────────────────────────────────
const viewport = { desktop: false }
let io: ReturnType<typeof installFakeIntersectionObserver>
function installDomStubs() {
  io = installFakeIntersectionObserver()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  // Every media query answers `false` — i.e. a PHONE (no `min-width: 768px`). `viewport.desktop = true`
  // makes the md-and-up query match instead.
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: viewport.desktop && q.includes('min-width: 768px'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  window.scrollTo = (() => {}) as typeof window.scrollTo
  window.scrollBy = (() => {}) as typeof window.scrollBy
  Element.prototype.scrollIntoView = () => {}
}

/** "Scroll to the bottom" — see src/test/fake-intersection-observer.ts for what the reader's being there means. */
function scrollToSentinel() { io.scrollToSentinel() }

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
  // Every test is a fresh document: its first mount is the cold path, a re-mount in it is a Back.
  __resetExplorerCommittedForTests()
  requests.length = 0
  gate = null
  repeatFirstPage = false
  viewport.desktop = false
  h.facet.props = null
  h.nav.pathname = '/'
  h.restores.length = 0
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
    // The scroll may reach an observer armed a moment after it (see the fake), so wait for the ask —
    // and by the time page 2 has been asked for, its twelve rows must already be held in the list.
    await waitFor(() => expect(listingsRequests().some((u) => u.searchParams.get('offset') === '12')).toBe(true))
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

describe('a district typed into search is the Area pill\'s district, and the chips never double up', () => {
  /** The applied-filter chips on the result line, by their ✕'s accessible name. */
  const chips = () => screen.queryAllByRole('button', { name: /^Remove / }).map((b) => b.getAttribute('aria-label'))
  const facet = () => {
    expect(h.facet.props).not.toBeNull() // the probe must have caught the FacetBar, or nothing below means anything
    return h.facet.props as { district: string; setDistrict: (slug: string) => void }
  }
  async function searchQuan7() {
    mount(newClient())
    act(() => { window.dispatchEvent(new CustomEvent('eno:search', { detail: { query: 'Quận 7' } })) })
    // The server has answered the words with its district reading: the Area pill names it, and — since
    // E-ACTIVE (owner O-14, 2026-09-30) — the result line draws NO chip for it, because the pill already
    // shows that value. Neither a district chip nor a `"Quận 7"` words chip may sit beside the pill.
    await waitFor(() => expect(facet().district).toBe('d7'))
    expect(chips()).toEqual([])
  }

  it('the Area pill names the district the server read out of the words (it read "Area")', async () => {
    await searchQuan7()
    expect(facet().district).toBe('d7')
  })

  it('picking that district in the Area panel never shows the old words beside it, in the same frame', async () => {
    await searchQuan7()
    act(() => { facet().setDistrict('d7') }) // the panel's pick: sets ?district=d7, strips "Quận 7" from the box
    // Same commit, inside the 150ms search debounce: production showed `"Quận 7"` AND "District 7" here.
    // The district itself is on the Area pill (no chip for it since O-14), so the line holds nothing.
    expect(chips()).toEqual([])
    expect(facet().district).toBe('d7')
    // …and the feed asks exactly that, from its first request: the district, without the words it
    // replaced (production also sent one request pairing the new district with the old words).
    await waitFor(() => expect(listingsRequests().some((u) => u.searchParams.get('district') === 'd7')).toBe(true))
    await new Promise((r) => setTimeout(r, 300)) // past the search debounce
    const picked = listingsRequests().filter((u) => u.searchParams.get('district') === 'd7')
    expect(picked.length).toBeGreaterThan(0)
    expect(picked.every((u) => !u.searchParams.has('q'))).toBe(true)
    expect(chips()).toEqual([])
    expect(facet().district).toBe('d7')
  })

  it('dropping it in the panel drops the typed district with it, as the chip\'s ✕ does', async () => {
    await searchQuan7()
    const before = listingsRequests().length
    act(() => { facet().setDistrict('all') })
    expect(chips()).toEqual([])
    expect(facet().district).toBe('all')
    // …and the feed follows: nothing asks for the words or a district again. (The unfiltered feed is
    // the server-seeded one here, so it needs no request of its own — the check is that none of the
    // old question goes out, e.g. "Quận 7" re-sent inside the search debounce.)
    await new Promise((r) => setTimeout(r, 300))
    expect(listingsRequests().slice(before).filter((u) => u.searchParams.has('q') || u.searchParams.has('district'))).toEqual([])
    expect(chips()).toEqual([])
  })
})

describe('Back from a listing: the browser\'s own scroll restoration is held off while a snapshot waits', () => {
  // jsdom does not implement `history.scrollRestoration`; the explorer's writes land on a plain
  // property, which is exactly what these assertions read.
  const mode = () => (window.history as { scrollRestoration?: string }).scrollRestoration
  afterEach(() => { (window.history as { scrollRestoration?: string }).scrollRestoration = 'auto' })

  it('tapping a card writes the snapshot AND holds "manual" on the feed\'s entry (the footer flash)', async () => {
    window.history.replaceState({}, '', '/?q=phone')
    mount(newClient())
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    expect(mode()).not.toBe('manual')
    act(() => { screen.getAllByTestId('card')[5].click() })
    expect(sessionStorage.getItem('eno:feed-snap')).not.toBeNull()
    expect(mode()).toBe('manual')
  })

  it('coming Back, the entry gets "auto" again once the restore has put the card back', async () => {
    const client = newClient()
    window.history.replaceState({}, '', '/?q=phone')
    const first = mount(client)
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    act(() => { screen.getAllByTestId('card')[5].click() })
    first.unmount()          // → /listings/<id>
    expect(mode()).toBe('manual')
    expect(h.restores).toEqual([]) // a cold mount has nothing to restore
    mount(client)            // ← Back: the snapshot is consumed and the restore runs
    await waitFor(() => expect(sessionStorage.getItem('eno:feed-snap')).toBeNull())
    // ⛔ WAIT FOR THE RESTORE TO FINISH, NEVER FOR THE MODE. The explorer also hands 'auto' back after
    // 1.5 s when a snapshot has not matched the feed (listings-explorer.tsx, `releaseFeedEntry` on a
    // timer), and the 5 s wait outlasts that, so `waitFor(mode() === 'auto')` passed with the restore
    // broken. Only the restore's own `onDone` fills `modeAfterDone`.
    await waitFor(() => expect(h.restores[0]?.modeAfterDone).toBeDefined())
    // One restore, aligned on the tapped card, which it found in the DOM; the entry stayed 'manual'
    // until the restore's `onDone` and was 'auto' as soon as that returned. Not a race with the 1.5 s
    // timer, however slow the frames: it releases only while `pendingSnapRef` is set, and the match
    // clears that inside the Back mount's own commit (the restore has already started when
    // `mount()` returns).
    expect(h.restores).toEqual([{ anchorId: 'r5', found: true, modeAtStart: 'manual', modeBeforeDone: 'manual', modeAfterDone: 'auto' }])
    expect(mode()).toBe('auto')
  })
})

describe('on a phone, a directed feed folds its category ladder into one compact row', () => {
  const CATS = [
    { id: 'c1', slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử', icon: 'Smartphone' },
    { id: 'c2', slug: 'vehicles', name: 'Vehicles', nameVi: 'Xe cộ', icon: 'Car' },
  ] as unknown as React.ComponentProps<typeof ListingsExplorer>['categories']
  const rails = () => ({ category: !!screen.queryByTestId('category-rail'), brand: !!screen.queryByTestId('brand-rail') })
  const compactRow = () => document.querySelector<HTMLElement>('[data-slot="ladder-compact-row"]')
  const scopeButton = () => compactRow()!.querySelector('button[aria-expanded]') as HTMLButtonElement
  function mountAt(url: string) {
    window.history.replaceState({}, '', url)
    return render(
      <QueryClientProvider client={newClient()}>
        <ListingsExplorer categories={CATS} initialListings={catalogue.slice(0, 12)} initialTotal={catalogue.length} />
      </QueryClientProvider>,
    )
  }

  it('home without filters is unchanged: the full tile rail, no compact row', async () => {
    mountAt('/')
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    expect(rails().category).toBe(true)
    expect(compactRow()).toBeNull()
  })

  it('a search folds the tile grid AND the brand rail into one row; the scope button opens and closes them', async () => {
    mountAt('/?q=phone')
    await waitFor(() => expect(compactRow()).not.toBeNull())
    expect(rails()).toEqual({ category: false, brand: false }) // ~375px of controls gone from above the results
    expect(scopeButton().getAttribute('aria-expanded')).toBe('false')
    expect(scopeButton().textContent).toContain('All categories') // the current scope, highlighted
    // …and the next rung is one tap away, in the same row: the categories as chips.
    expect(within(compactRow()!).getByRole('button', { name: 'Electronics' })).toBeTruthy()

    act(() => { scopeButton().click() })
    expect(scopeButton().getAttribute('aria-expanded')).toBe('true')
    // The category rail opens; the brand rail does NOT come with it on a free-text search over "All"
    // (E-RESULTS): there it is the most-listed-overall directory, which does not read the words.
    expect(rails()).toEqual({ category: true, brand: false })
    act(() => { scopeButton().click() })
    expect(rails()).toEqual({ category: false, brand: false })
  })

  it('in a brand category the opened ladder carries the brand rail too', async () => {
    mountAt('/?q=phone&category=electronics')
    await waitFor(() => expect(compactRow()).not.toBeNull())
    expect(rails()).toEqual({ category: false, brand: false })
    act(() => { scopeButton().click() })
    expect(rails()).toEqual({ category: true, brand: true })
  })

  it('in a category, the row names it and offers its subcategories; a chip narrows like the rail\'s', async () => {
    mountAt('/?category=electronics')
    await waitFor(() => expect(compactRow()).not.toBeNull())
    expect(scopeButton().textContent).toContain('Electronics')
    const phones = within(compactRow()!).getByRole('button', { name: 'Phones' })
    expect(phones.getAttribute('aria-pressed')).toBe('false')
    act(() => { phones.click() })
    await waitFor(() => expect(window.location.search).toContain('subcategory=phones'))
    expect(within(compactRow()!).getByRole('button', { name: 'Phones' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('a COLD load of a directed URL is not folded under the reader — the fold waits for their first change', async () => {
    // The ISR HTML is the unfiltered home and the URL's filters land after hydration; folding then
    // would move every result up ~220px with no input (measured: CLS 0.20 → 0.54 on /?category=…).
    window.history.replaceState({}, '', '/?q=phone')
    const el = (
      <QueryClientProvider client={newClient()}>
        <ListingsExplorer categories={CATS} initialListings={catalogue.slice(0, 12)} initialTotal={catalogue.length} />
      </QueryClientProvider>
    )
    const container = document.body.appendChild(document.createElement('div'))
    container.innerHTML = renderToString(el)
    let root: Root | null = null
    await act(async () => { root = hydrateRoot(container, el) })
    try {
      await waitFor(() => expect(listingsRequests().some((u) => u.searchParams.get('q') === 'phone')).toBe(true))
      await new Promise((r) => setTimeout(r, 50))
      expect(compactRow()).toBeNull()
      expect(rails().category).toBe(true)
      // The reader narrows the feed (a condition, from the facet bar): now it folds, in that commit.
      act(() => { (h.facet.props as { setConditionFilter: (v: string) => void }).setConditionFilter('new') })
      expect(compactRow()).not.toBeNull()
      expect(rails().category).toBe(false)
    } finally {
      act(() => { root?.unmount() })
      container.remove()
    }
  })

  it('desktop keeps the full rails when directed', async () => {
    viewport.desktop = true
    mountAt('/?category=electronics')
    await waitFor(() => expect(rails().brand).toBe(true))
    expect(rails().category).toBe(true)
    expect(compactRow()).toBeNull()
  })

  it('a free-text search on "All" draws no brand directory, on desktop too (E-RESULTS)', async () => {
    viewport.desktop = true
    mountAt('/?q=honda')
    await waitFor(() => expect(rails().category).toBe(true))
    expect(rails().brand).toBe(false)
    expect(compactRow()).toBeNull()
  })
})

describe('a client-side mount starts where the URL is (E-BACK)', () => {
  it('never renders the ISR seed under a directed URL — skeleton, then the answer', async () => {
    // The reader was on the feed before (an explorer committed in this document), left it, and came
    // back to a directed URL: the client-side mount the seed is for (see `explorerCommitted`).
    mount(newClient()).unmount()
    const seed = Array.from({ length: 12 }, (_, i) => row(`seed${i}`))
    window.history.replaceState({}, '', '/?q=phone')
    const seen = new Set<string>()
    const record = () => cardIds().forEach((id) => id && seen.add(id))
    const observer = new MutationObserver(record)
    observer.observe(document.body, { childList: true, subtree: true })
    const release = holdAll()
    mount(newClient(), { initialListings: seed, initialTotal: 999 })
    record()
    // Before the answer: no rows at all, twelve placeholders, and no count (not the seed's 999, not 0).
    expect(cardIds()).toHaveLength(0)
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
    expect(document.querySelector('[data-slot="result-line"] p[aria-live="polite"]')?.textContent ?? '').not.toMatch(/\d/)
    // The first request already carries the URL's words (no request for the unfiltered feed).
    await waitFor(() => expect(listingsRequests().length).toBeGreaterThan(0))
    expect(listingsRequests()[0].searchParams.get('q')).toBe('phone')
    release()
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    observer.disconnect()
    expect([...seen].some((id) => id.startsWith('seed'))).toBe(false)
  })

  it('a mount from router.push does not read the page being LEFT (history is written after render)', async () => {
    // Review, 2026-09-29: Next writes history in its router's useInsertionEffect, AFTER the render that
    // runs useState initialisers — so a pushed mount rendered while `location` was still the previous
    // page, and a storefront's `?q=` seeded (and fetched) the home. This stands in for Next's
    // HistoryUpdater: the target URL lands in the commit, before any layout or passive effect.
    mount(newClient()).unmount()
    window.history.replaceState({}, '', '/s/some-shop?q=foo')
    h.nav.pathname = '/' // the router's target, as usePathname() reads it during the pushed render
    function HistoryUpdater() {
      React.useInsertionEffect(() => { window.history.pushState({}, '', '/?category=rentals') }, [])
      return null
    }
    render(
      <QueryClientProvider client={newClient()}>
        <HistoryUpdater />
        <ListingsExplorer categories={[]} initialListings={[]} initialTotal={0} />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(listingsRequests().some((u) => u.searchParams.get('category') === 'rentals')).toBe(true))
    expect(listingsRequests().filter((u) => u.searchParams.get('q') === 'foo')).toEqual([])
  })

  it('the document\'s FIRST explorer, client-rendered (hydration recovery), is not seeded from the URL', async () => {
    // No explorer has committed yet (reset per test), so this plain render stands for React's
    // recovery render of a failed hydration: it must start where the server HTML did — on the seed —
    // and take the URL after mount, exactly like the cold path (the seeded variant measured CLS 1.1).
    const seed = Array.from({ length: 12 }, (_, i) => row(`seed${i}`))
    window.history.replaceState({}, '', '/?q=phone')
    const release = holdAll()
    mount(newClient(), { initialListings: seed, initialTotal: 999 })
    expect(cardIds()).toHaveLength(12)
    expect(cardIds().every((id) => id?.startsWith('seed'))).toBe(true)
    // …and the URL still reaches the fetcher once mounted.
    await waitFor(() => expect(listingsRequests().some((u) => u.searchParams.get('q') === 'phone')).toBe(true))
    release()
  })

  it('a cold load (hydration) still renders the seed and takes the URL after mount', async () => {
    window.history.replaceState({}, '', '/?q=phone')
    const seed = catalogue.slice(0, 12)
    const el = (
      <QueryClientProvider client={newClient()}>
        <ListingsExplorer categories={[]} initialListings={seed} initialTotal={catalogue.length} />
      </QueryClientProvider>
    )
    const container = document.body.appendChild(document.createElement('div'))
    container.innerHTML = renderToString(el)
    // The server HTML is the unfiltered seed — hydrating it must not mismatch.
    expect(container.querySelectorAll('[data-testid="card"]')).toHaveLength(12)
    const errors: unknown[] = []
    let root: Root | null = null
    await act(async () => { root = hydrateRoot(container, el, { onRecoverableError: (e) => errors.push(e) }) })
    try {
      expect(errors).toEqual([])
      await waitFor(() => expect(listingsRequests().some((u) => u.searchParams.get('q') === 'phone')).toBe(true))
    } finally {
      act(() => root?.unmount())
      container.remove()
    }
  })
})

describe('the tab and the outline name a directed feed (E-TITLE)', () => {
  it('titles a search with its words and count, and hands the base title back on the logo reset', async () => {
    document.title = `${SITE_NAME} - Trusted Expat Marketplace in Vietnam`
    window.history.replaceState({}, '', '/?q=phone')
    mount(newClient())
    await waitFor(() => expect(document.title).toBe(`“phone” · 30 listings | ${SITE_NAME}`))
    expect(screen.getByRole('heading', { level: 2, name: 'Results for “phone”' })).toBeTruthy()
    act(() => { window.dispatchEvent(new Event('eno:reset-home')) })
    await waitFor(() => expect(document.title).toBe(`${SITE_NAME} - Trusted Expat Marketplace in Vietnam`))
  })

  it('never overwrites a title it did not write (the next page\'s, on the way out)', async () => {
    document.title = `${SITE_NAME} - Trusted Expat Marketplace in Vietnam`
    window.history.replaceState({}, '', '/?q=phone')
    const view = mount(newClient())
    await waitFor(() => expect(document.title).toBe(`“phone” · 30 listings | ${SITE_NAME}`))
    document.title = `Some listing | ${SITE_NAME}` // Next titled the destination before our cleanup ran
    view.unmount()
    expect(document.title).toBe(`Some listing | ${SITE_NAME}`)
  })
})

describe('the home heading names the order the feed is in (E-SORT)', () => {
  it('reads "Recommended" in the default order and "Latest listings" under Newest', async () => {
    mount(newClient(), { initialListings: catalogue.slice(0, 12), initialTotal: catalogue.length })
    expect(screen.getByRole('heading', { level: 2, name: 'Recommended' })).toBeTruthy()
    act(() => { screen.getByRole('tab', { name: 'Newest' }).click() })
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Latest listings' })).toBeTruthy())
  })
})

describe('a zero-result search is answered for its likely spelling, and says so (S-RECALL)', () => {
  it('opts in with spell=1, shows "Showing results for", and "Search instead" asks the typed words', async () => {
    window.history.replaceState({}, '', '/?q=iphnoe')
    mount(newClient())
    // The live region is on the page BEFORE the answer, empty: a region inserted already holding its
    // text is not announced on several screen-reader/browser pairs.
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('')
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    expect(listingsRequests().every((u) => u.searchParams.get('spell') === '1')).toBe(true)
    expect(screen.getByRole('status')).toBe(status) // the same node: its content changed, it was not re-mounted
    expect(status.textContent).toContain('Showing results for iphone')
    // The outline and the tab name the words the grid answers.
    expect(screen.getByRole('heading', { level: 2, name: 'Results for “iphone”' })).toBeTruthy()

    act(() => { screen.getByRole('button', { name: 'Search instead for “iphnoe”' }).click() })
    await waitFor(() => expect(screen.getByText('No results for “iphnoe”')).toBeTruthy())
    expect(listingsRequests().at(-1)!.searchParams.has('spell')).toBe(false)
    expect(status.isConnected).toBe(true)
    expect(status.textContent).toBe('')
    // Popular searches rescue it — without the typo itself, whatever its case.
    await waitFor(() => expect(screen.getByText('Popular searches')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'iphone' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'honda' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Iphnoe' })).toBeNull()
  })

  it('the line arrives in the SAME commit as the corrected rows — never rows without it', async () => {
    // A regression guard, not a fix for a seen defect: the line's effect runs in the same flush as the
    // rows' sync effect, so they commit together (and the grid's deferred copy lands after both).
    // Proven able to fail: moving the line one extra effect later makes this red (2026-09-29).
    window.history.replaceState({}, '', '/?q=iphnoe')
    const torn: number[] = []
    const observer = new MutationObserver(() => {
      const said = document.querySelector('[data-slot="spell-correction"]')?.textContent ?? ''
      if (cardIds().length > 0 && !said.includes('Showing results for')) torn.push(cardIds().length)
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    mount(newClient())
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Showing results for iphone'))
    observer.disconnect()
    expect(torn).toEqual([])
  })

  it('"Search instead" keeps the line while the corrected cards are still on screen — it leaves WITH them', async () => {
    // Review, 2026-09-29: the line was gated on the REQUEST (`spellOn`), so the tap dropped it while
    // `placeholderData` kept the corrected cards on screen for the whole literal round trip.
    window.history.replaceState({}, '', '/?q=iphnoe')
    mount(newClient())
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Showing results for iphone'))
    // Every frame on the way: corrected cards never without the line, and the line never over the
    // literal empty state.
    const torn: string[] = []
    const observer = new MutationObserver(() => {
      const said = (document.querySelector('[data-slot="spell-correction"]')?.textContent ?? '').includes('Showing results for iphone')
      if (cardIds().length > 0 && !said) torn.push(`${cardIds().length} cards, no line`)
      if (said && screen.queryByText('No results for “iphnoe”')) torn.push('line over the empty state')
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    const release = holdAll()
    act(() => { screen.getByRole('button', { name: 'Search instead for “iphnoe”' }).click() })
    await waitFor(() => expect(listingsRequests().some((u) => u.searchParams.get('q') === 'iphnoe' && !u.searchParams.has('spell'))).toBe(true))
    // The literal answer is in flight: the corrected cards are still drawn, so the sentence is too.
    expect(cardIds()).toHaveLength(12)
    expect(screen.getByRole('status').textContent).toContain('Showing results for iphone')
    release()
    await waitFor(() => expect(screen.getByText('No results for “iphnoe”')).toBeTruthy())
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(''))
    observer.disconnect()
    expect(torn).toEqual([])
  })

  it('the price histogram asks for the word the FEED answered — never a spelling decision of its own', async () => {
    // Review, 2026-09-29: the histogram sent `spell=1` and was corrected from its own zero, which drops
    // the price band and the semantic set — so the slider could describe another word than the grid.
    window.history.replaceState({}, '', '/?q=iphnoe')
    mount(newClient())
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Showing results for iphone'))
    const corrected = new URLSearchParams(h.facet.props?.histogramQuery as string)
    expect(corrected.get('q')).toBe('iphone')
    expect(corrected.has('spell')).toBe(false)
    expect(corrected.get('histogram')).toBe('1')
    act(() => { screen.getByRole('button', { name: 'Search instead for “iphnoe”' }).click() })
    await waitFor(() => expect(screen.getByText('No results for “iphnoe”')).toBeTruthy())
    await waitFor(() => expect(new URLSearchParams(h.facet.props?.histogramQuery as string).get('q')).toBe('iphnoe'))
    expect(new URLSearchParams(h.facet.props?.histogramQuery as string).has('spell')).toBe(false)
  })

  it('the literal answer and the corrected one are two cache entries', async () => {
    const client = newClient()
    window.history.replaceState({}, '', '/?q=iphnoe')
    mount(client)
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    act(() => { screen.getByRole('button', { name: 'Search instead for “iphnoe”' }).click() })
    await waitFor(() => expect(screen.getByText('No results for “iphnoe”')).toBeTruthy())
    const spells = client.getQueryCache().findAll({ queryKey: ['listings'] }).map((q) => (q.queryKey[1] as { spell: boolean }).spell)
    expect(spells).toEqual(expect.arrayContaining([true, false]))
  })
})

describe('a short, complete answer ends on a recovery rail (E-ZERO)', () => {
  it('1–7 results: the trending rail follows the grid', async () => {
    catalogue = catalogue.slice(0, 3)
    window.history.replaceState({}, '', '/?q=phone')
    mount(newClient())
    await waitFor(() => expect(cardIds()).toHaveLength(3))
    expect(screen.getByTestId('for-you-recovery')).toBeTruthy()
  })

  it('8 or more results, or a storefront: no recovery rail', async () => {
    window.history.replaceState({}, '', '/?q=phone')
    const view = mount(newClient())
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    expect(screen.queryByTestId('for-you-recovery')).toBeNull()
    view.unmount()

    catalogue = catalogue.slice(0, 3)
    mount(newClient(), { sellerId: 'shop-1' })
    await waitFor(() => expect(cardIds()).toHaveLength(3))
    expect(screen.queryByTestId('for-you-recovery')).toBeNull()
  })
})

/**
 * E-SSR phase 1 (2026-09-29): a cold deep link's ISR seed is masked by `html[data-explorer-directed]`
 * (set by the home layout's pre-paint script) until the grid draws the URL's own answer — and while it
 * is, the count announces nothing and the masked cards take no taps.
 */
describe('a cold directed deep link waits for its own answer behind the mask (E-SSR)', () => {
  async function hydrateAt(search: string, masked: boolean) {
    window.history.replaceState({}, '', search)
    if (masked) document.documentElement.setAttribute('data-explorer-directed', '')
    const seed = Array.from({ length: 12 }, (_, i) => row(`seed${i}`))
    const el = (
      <QueryClientProvider client={newClient()}>
        <ListingsExplorer categories={[]} initialListings={seed} initialTotal={999} />
      </QueryClientProvider>
    )
    const container = document.body.appendChild(document.createElement('div'))
    container.innerHTML = renderToString(el)
    const errors: unknown[] = []
    let root: Root | null = null
    await act(async () => { root = hydrateRoot(container, el, { onRecoverableError: (e) => errors.push(e) }) })
    return { container, errors, unmount: () => { act(() => root?.unmount()); container.remove() } }
  }
  const count = (c: Element) => c.querySelector('[data-slot="result-line"] p[aria-live="polite"]')?.textContent ?? ''
  afterEach(() => { document.documentElement.removeAttribute('data-explorer-directed') })

  it('holds the mask and blocks taps on the seed until the answer lands', async () => {
    // ⛔ THE MASK'S 12 s CEILING IS DISARMED HERE, SO ONLY THE ANSWER CAN LIFT IT. The explorer also lifts
    // the mask on a timer, answer or not (listings-explorer.tsx, `setAwaitingUrlAnswer(false), 12_000`),
    // and two of this file's 5 s waits in a row can reach it, so a lift by that timer would pass this
    // test with the answer path broken. Picked out by its delay AND its callback (the `next/dynamic` probe
    // above reads a function's source the same way); every other timer runs as normal.
    const realSetTimeout = globalThis.setTimeout
    const ceilings: number[] = []
    const timers = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: (...a: unknown[]) => void, ms?: number, ...rest: unknown[]) => {
      if (ms === 12_000 && String(fn).includes('setAwaitingUrlAnswer')) { ceilings.push(ms); return realSetTimeout(() => {}, 0) }
      return realSetTimeout(fn, ms, ...rest)
    }) as unknown as typeof setTimeout)
    const release = holdAll()
    const v = await hydrateAt('/?q=phone', true)
    try {
      // The ceiling was armed, and disarmed: if its delay ever changes, this fails rather than letting the timer back in.
      expect(ceilings).toHaveLength(1)
      expect(v.errors).toEqual([])
      await waitFor(() => expect(listingsRequests().some((u) => u.searchParams.get('q') === 'phone')).toBe(true))
      expect(document.documentElement.hasAttribute('data-explorer-directed')).toBe(true)
      // The seed's count stays in place (so its row keeps its height) — the mask's `visibility: hidden`
      // is what takes it off the screen and out of the accessibility tree.
      expect(count(v.container)).toMatch(/999/)
      const grid = v.container.querySelector('.feed-grid')!.parentElement!.parentElement!
      expect(grid.hasAttribute('inert')).toBe(true)
      // The URL's words skipped the 150ms debounce: no request for anything but "phone" was needed.
      expect(listingsRequests().every((u) => u.searchParams.get('q') === 'phone')).toBe(true)
      release()
      await waitFor(() => expect(document.documentElement.hasAttribute('data-explorer-directed')).toBe(false))
      expect(count(v.container)).toMatch(/^30\b/)
      // The effect that lifts the mask drops the attribute itself and `inert` through the render its
      // setSeedMasked(false) schedules, so a check landing between the two read a still-inert grid
      // (1 run in 21 under load). Taps come back; that is the assertion, not the frame they come back in.
      await waitFor(() => expect(v.container.querySelector('.feed-grid')!.parentElement!.parentElement!.hasAttribute('inert')).toBe(false))
    } finally {
      v.unmount()
      timers.mockRestore() // (the file's afterEach restores it too, should hydrateAt itself throw)
    }
  })

  it('an unmarked cold load is untouched: the count is the seed\'s until its own answer', async () => {
    const v = await hydrateAt('/', false)
    try {
      expect(count(v.container)).toMatch(/999/)
      expect(document.documentElement.hasAttribute('data-explorer-directed')).toBe(false)
    } finally {
      v.unmount()
    }
  })
})

describe('the view is URL state (E-VIEWS)', () => {
  it('List view writes ?view=compact; Grid, the default, removes it', async () => {
    window.history.replaceState({}, '', '/?q=phone')
    mount(newClient())
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    act(() => { screen.getByRole('button', { name: 'List view' }).click() })
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('view')).toBe('compact'))
    act(() => { screen.getByRole('button', { name: 'Grid view' }).click() })
    await waitFor(() => expect(new URLSearchParams(window.location.search).has('view')).toBe(false))
    expect(new URLSearchParams(window.location.search).get('q')).toBe('phone')
  })

  it('asks for videos in the feed on screen, not the whole site', async () => {
    window.history.replaceState({}, '', '/?category=rentals')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      mount(newClient())
      await act(async () => { vi.advanceTimersByTime(11_000) })
    } finally {
      vi.useRealTimers()
    }
    await waitFor(() => expect(requests.some((u) => u.searchParams.has('hasVideo'))).toBe(true))
    const probe = requests.find((u) => u.searchParams.has('hasVideo'))!
    expect(probe.searchParams.get('category')).toBe('rentals')
    expect(probe.searchParams.get('facets')).toBe('0')
    // A FIXED plain sort (review, 2026-09-29): with none the route took its default, and a worded feed
    // then ran the relevance ranker's 900-row candidate read to answer limit=1. 'recent' is an ORDER BY.
    expect(probe.searchParams.get('sort')).toBe('recent')
  })
})

describe('an applied custom filter reads as the taxonomy names it (E-ACTIVE)', () => {
  it('"2 BR" and "Size 30–80 m²", never the state keys', async () => {
    window.history.replaceState({}, '', '/?category=rentals&subcategory=apartment-rental&attr_bedrooms=2&range_areaM2=30-80')
    mount(newClient())
    await waitFor(() => expect(cardIds().length).toBeGreaterThan(0))
    const line = document.querySelector('[data-slot="result-line"]')!
    await waitFor(() => expect(line.textContent).toContain('Size 30–80 m²'))
    expect(line.textContent).toContain('2 BR')
    expect(line.textContent).not.toMatch(/bedrooms:|areaM2/)
  })
})

describe('the facet bar is handed the feed\'s count and a panel signal (E-FILTER-SHEET)', () => {
  it('passes the deferred result count and a stable onPanelOpenChange', async () => {
    window.history.replaceState({}, '', '/?q=phone')
    mount(newClient())
    await waitFor(() => expect(h.facet.props?.resultCount).toBe(30))
    expect(typeof h.facet.props?.onPanelOpenChange).toBe('function')
    expect(h.facet.props).not.toHaveProperty('setActiveSubcategory')
  })
})

describe('the storefront\'s H1 is the shop\'s, and "Skip to listings" has somewhere to land (ST-HEADER, D-KEYBOARD)', () => {
  it('draws the site-name H1 only when not seller-scoped', async () => {
    const a = mount(newClient())
    expect(document.querySelectorAll('h1')).toHaveLength(1)
    a.unmount()
    mount(newClient(), { sellerId: 'shop-1' })
    expect(document.querySelectorAll('h1')).toHaveLength(0)
  })

  it('the results row is a focus target', () => {
    mount(newClient())
    const target = document.getElementById('results')!
    expect(target.getAttribute('tabindex')).toBe('-1')
    expect(target.closest('#listings')).not.toBeNull()
  })
})

describe('a tile links to the PUBLIC page on both sides of the lang rewrite (E-TILES)', () => {
  /**
   * The home is ISR-prerendered as `/en` / `/vi` and served at `/` (src/proxy.ts), so the build render's
   * `usePathname()` is the internal path while the browser's is public. React keeps a server attribute
   * through hydration, so whatever href the SERVER wrote is the one a ctrl-click or a crawler follows —
   * and the proxy 404s every public `/en…`. Rendered here exactly like that: server string under the
   * internal path, hydrated under the public one.
   */
  async function prerenderThenHydrate(internal: string, publicPath: string) {
    window.history.replaceState({}, '', publicPath)
    const el = (
      <QueryClientProvider client={newClient()}>
        <ListingsExplorer categories={[]} initialListings={[]} initialTotal={0} />
      </QueryClientProvider>
    )
    h.nav.pathname = internal
    const html = renderToString(el)
    h.nav.pathname = publicPath
    const container = document.body.appendChild(document.createElement('div'))
    container.innerHTML = html
    let root: Root | null = null
    await act(async () => { root = hydrateRoot(container, el, { onRecoverableError: () => {} }) })
    const href = (id: string) => container.querySelector(`[data-testid="${id}"]`)!.getAttribute('href')
    return { html, href, unmount: () => { act(() => root?.unmount()); container.remove() } }
  }

  it.each(['/en', '/vi'])('the home prerendered as %s writes /?category=…, never the internal path', async (internal) => {
    const v = await prerenderThenHydrate(internal, '/')
    try {
      expect(v.html).not.toMatch(/href="\/(en|vi)[?/"]/)
      expect(v.href('tile-category')).toBe('/?category=rentals')
      expect(v.href('tile-intent')).toBe('/?type=free')
      expect(v.href('tile-clear')).toBe('/')
    } finally {
      v.unmount()
    }
  })

  it('a per-request render (the storefront, served at / on its own host) already reads / — and still writes /?…', async () => {
    const v = await prerenderThenHydrate('/', '/')
    try {
      expect(v.href('tile-category')).toBe('/?category=rentals')
      expect(v.href('tile-clear')).toBe('/')
    } finally {
      v.unmount()
    }
  })
})
