// @vitest-environment jsdom
/**
 * ⛔ "CHANGED FROM IPHONE 12 PRO MAX TO 13 MINI, PRODUCTS DON'T UPDATE" (owner, 2026-09-24).
 *
 * On eno.vn, Electronics → Apple → iPhone 12 Pro Max, sort Price ↑: scroll the feed past page 1,
 * open a listing, press Back, pick "iPhone 13 Mini". The header said "3 listings" and the chip said
 * 13 Mini, while the grid kept all 39 iPhone 12 Pro Max cards. Reproduced 3/3 on production, and
 * ONLY after a back-navigation from a deep feed — a fresh load was right 15/15.
 *
 * THE MECHANISM, which every test below replays through the real component:
 *   · The back-nav restore re-armed a one-shot `skipFirstPageResetRef` in a layout effect that
 *     runs one render AFTER the filter change it was meant to skip, so nothing consumed it.
 *   · The reader's NEXT filter change consumed it instead and never reset `page` to 1, so the new
 *     model was fetched at the restored depth (`offset=48`), not at `offset=0`.
 *   · The sync effect's page>1 branch then APPENDED that wrong page onto the old rows (nothing,
 *     for 13 Mini) while `setTotalCount` updated the header anyway.
 *
 * ⚠️ NO NETWORK: `fetch` is a fake server. The heavy children (cards, rails, dynamic chunks) are
 * stubbed; the explorer's own state machine — URL hydration, the snapshot, the page reset, the
 * react-query key and the sync effect — is the real one.
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
// Every code-split chunk (FacetBar, map, video, drawers, rails) is out of scope and renders nothing.
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => h.language,
  useTr: (s: string) => s,
  Tr: ({ text }: { text?: string | null }) => <>{text}</>,
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => h.auth }))
vi.mock('@/lib/analytics', () => ({ trackSearch: () => {} }))
// The card is not under test. It keeps the one prop the bug path needs: `onOpen`, which is what
// writes the back-nav snapshot.
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
const row = (id: string, title: string, price: number): SerializedListingCard =>
  ({
    id, title, titleVi: null, price, location: 'Ho Chi Minh City', district: 'District 1',
    postedAt: '2026-09-01T00:00:00.000Z', contactCount: 0,
    category: { slug: 'electronics', name: 'Electronics' },
  } as unknown as SerializedListingCard)

const CATALOGUE: Record<string, SerializedListingCard[]> = {
  'iPhone 12 Pro Max': Array.from({ length: 39 }, (_, i) => row(`pm12-${i}`, `iPhone 12 Pro Max #${i}`, 9_490_000 + i * 10_000)),
  'iPhone 13 Mini': Array.from({ length: 3 }, (_, i) => row(`mini13-${i}`, `iPhone 13 Mini #${i}`, 6_000_000 + i * 10_000)),
  'iPhone 17 Pro Max': Array.from({ length: 57 }, (_, i) => row(`pm17-${i}`, `iPhone 17 Pro Max #${i}`, 30_000_000 + i * 10_000)),
}

const requests: URL[] = []
/** Models whose /api/listings requests answer 503 (a dropped request on a phone network). */
const failing = new Set<string>()
/** A request whose model is listed here waits until the test releases it (a slow phone network). */
const held = new Map<string, { release: () => void; gate: Promise<void> }>()
function hold(model: string) {
  let release = () => {}
  const gate = new Promise<void>((r) => { release = r })
  held.set(model, { release, gate })
  return () => { held.delete(model); release() }
}
function listingsRequests() { return requests.filter((u) => u.pathname === '/api/listings' && !u.searchParams.has('hasVideo')) }

function answer(url: URL) {
  const model = url.searchParams.get('model') ?? ''
  const radius = url.searchParams.get('radiusKm')
  // "Near you": a wider circle holds more of the same model (2 per km, for a readable number).
  const all = radius ? (CATALOGUE[model] ?? []).slice(0, Number(radius) * 2) : (CATALOGUE[model] ?? [])
  const sorted = url.searchParams.get('sort') === 'recent' ? [...all].reverse() : all
  const offset = Number(url.searchParams.get('offset') ?? 0)
  const limit = Number(url.searchParams.get('limit') ?? 12)
  // Titles in a language other than en/vi come back in that language (the payload's titleI18n).
  const lang = url.searchParams.get('lang') ?? 'en'
  const listings = sorted.slice(offset, offset + limit)
    .map((l) => (lang === 'en' || lang === 'vi' ? l : { ...l, title: `${l.title} [${lang}]` }))
  // Production's count is cached for 60s, so a deep feed can be told there is one more row than
  // there is — which is exactly how the owner's feed reached page 5 (offset=48) and got [] back.
  const total = model === 'iPhone 12 Pro Max' && !radius && offset < 48 ? all.length + 1 : all.length
  return { listings, total, offset, limit, subcategoryCounts: {}, categoryTotal: total, facets: {} }
}

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    const url = new URL(u, 'https://eno.vn')
    requests.push(url)
    const wait = held.get(url.searchParams.get('model') ?? '')
    if (wait) await wait.gate
    if (url.pathname === '/api/listings' && failing.has(url.searchParams.get('model') ?? '')) return { ok: false, status: 503, json: async () => ({}) } as Response
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
const countLine = () => document.querySelector('[data-slot="result-line"] p[aria-live="polite"]')?.textContent ?? ''
/** The header's number, exactly — "3" must not be satisfied by "39 listings". */
const countIs = (n: number) => expect(countLine()).toMatch(new RegExp(`^${n}\\b`))

const URL_12_PRO_MAX = '/?category=electronics&brand=apple&model=iPhone+12+Pro+Max&sort=price-low'

function mount(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <ListingsExplorer categories={[]} initialListings={[]} initialTotal={0} />
    </QueryClientProvider>,
  )
}

/** A reader picking a different filter. popstate runs the explorer's own `applyParams`, i.e. the same setters a chip tap reaches. */
function navigateFilters(search: string) {
  act(() => {
    window.history.pushState({}, '', search)
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
}

/**
 * The owner's path up to the moment of the bug: load 12 Pro Max + Price ↑, scroll until the feed
 * has paged to offset 48, open card #14, come Back. Returns the shared client (react-query's cache
 * survives a client-side navigation, which is why the restore itself fires no request).
 */
async function deepFeedThenBack() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } })
  window.history.replaceState({}, '', URL_12_PRO_MAX)
  const first = mount(client)
  await waitFor(() => expect(cardIds()).toHaveLength(12))
  for (const depth of [24, 36, 39]) {
    scrollToSentinel()
    await waitFor(() => expect(cardIds()).toHaveLength(depth))
  }
  // offset=48 comes back empty with the true total — the feed now holds all 39.
  scrollToSentinel()
  await waitFor(() => expect(listingsRequests().some((u) => u.searchParams.get('offset') === '48')).toBe(true))
  await waitFor(() => countIs(39))
  expect(cardIds()).toHaveLength(39)

  act(() => { screen.getAllByTestId('card')[13].click() })
  const snap = JSON.parse(sessionStorage.getItem('eno:feed-snap') ?? 'null')
  expect(snap).toMatchObject({ page: 5, totalCount: 39 })
  expect(snap.listings).toHaveLength(39)

  first.unmount() // → /listings/<id>
  mount(client)   // ← Back
  // Restored from the snapshot, not refetched from page 1: 39 cards and the saved count.
  await waitFor(() => expect(cardIds()).toHaveLength(39))
  await waitFor(() => countIs(39))
  expect(sessionStorage.getItem('eno:feed-snap')).toBeNull()
  return client
}

beforeEach(() => {
  requests.length = 0
  held.clear()
  failing.clear()
  sessionStorage.clear()
  installDomStubs()
  stubFetch()
})
afterEach(() => {
  cleanup()
  h.language.lang = 'en'
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})

describe('the first filter change after a back-navigation into a deep feed', () => {
  it('shows ONLY the new model\'s listings under its count, fetched from offset 0 (the owner\'s report)', async () => {
    await deepFeedThenBack()
    const before = listingsRequests().length

    navigateFilters('/?category=electronics&brand=apple&model=iPhone+13+Mini&sort=price-low')

    // What the owner saw instead: all 39 "iPhone 12 Pro Max" cards under "3 listings".
    await waitFor(() => expect(cardIds()).toEqual(['mini13-0', 'mini13-1', 'mini13-2']))
    countIs(3)
    const firstNew = listingsRequests()[before]
    expect(firstNew.searchParams.get('model')).toBe('iPhone 13 Mini')
    expect(firstNew.searchParams.get('offset')).toBe('0') // was 48: the restored depth
    // …and it stays that way: no later render drifts the grid back to the old rows.
    await new Promise((r) => setTimeout(r, 50))
    expect(cardIds()).toEqual(['mini13-0', 'mini13-1', 'mini13-2'])
  })

  it('never mixes the old model\'s rows with a page of the new one (scenario G: 17 Pro Max, 57 results)', async () => {
    await deepFeedThenBack()
    const before = listingsRequests().length

    navigateFilters('/?category=electronics&brand=apple&model=iPhone+17+Pro+Max&sort=price-low')

    // What production showed: 39 × 12 Pro Max with 17 Pro Max rows 48-56 appended under them.
    const expected = CATALOGUE['iPhone 17 Pro Max'].slice(0, 12).map((l) => l.id)
    await waitFor(() => expect(cardIds()).toEqual(expected))
    countIs(57)
    expect(listingsRequests()[before].searchParams.get('offset')).toBe('0')
  })

  it('a SORT-only change re-reads from the top in the new order (scenario H)', async () => {
    await deepFeedThenBack()
    const before = listingsRequests().length

    navigateFilters('/?category=electronics&brand=apple&model=iPhone+12+Pro+Max&sort=recent')

    // What production showed: the Price ↑ order kept under the "Newest" tab.
    const newestFirst = [...CATALOGUE['iPhone 12 Pro Max']].reverse().slice(0, 12).map((l) => l.id)
    await waitFor(() => expect(cardIds()).toEqual(newestFirst))
    const firstNew = listingsRequests()[before]
    expect(firstNew.searchParams.get('sort')).toBe('recent')
    expect(firstNew.searchParams.get('offset')).toBe('0')
  })
})

describe('rows and count always come from the same result set', () => {
  /**
   * Deep in 12 Pro Max, pick 13 Mini on a slow connection, and open one of the (dimmed, still
   * tappable) 12 Pro Max cards before the answer lands. The snapshot then pairs 13 Mini's filters
   * with 12 Pro Max's rows; on Back, the restore's "keep the longer list" guard kept those rows over
   * 13 Mini's three whenever there were more of them — the owner's screenshot by a second route. (It
   * checked only the LENGTH, never which query the rows came from.)
   * `legacy` replays the same thing with a snapshot written before snapshots carried `rowsSig` (or
   * one whose rows have no known provenance): it must be refused, not trusted.
   */
  async function tapWhileLoadingThenBack(legacy: boolean, stillLoadingOnBack: boolean) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } })
    window.history.replaceState({}, '', URL_12_PRO_MAX)
    const first = mount(client)
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    for (const depth of [24, 36, 39]) {
      scrollToSentinel()
      await waitFor(() => expect(cardIds()).toHaveLength(depth))
    }
    const release = hold('iPhone 13 Mini')
    navigateFilters('/?category=electronics&brand=apple&model=iPhone+13+Mini&sort=price-low')
    await waitFor(() => expect(listingsRequests().some((u) => u.searchParams.get('model') === 'iPhone 13 Mini')).toBe(true))
    expect(cardIds()).toHaveLength(39) // still the old rows while the request is out

    act(() => { screen.getAllByTestId('card')[13].click() })
    const snap = JSON.parse(sessionStorage.getItem('eno:feed-snap') ?? 'null')
    expect(snap).toMatchObject({ page: 1 })
    expect(typeof snap.rowsSig).toBe('string')
    if (legacy) {
      delete snap.rowsSig
      sessionStorage.setItem('eno:feed-snap', JSON.stringify(snap))
    }
    first.unmount()
    if (!stillLoadingOnBack) {
      release()
      await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: ['listings'] })
        .some((q) => (q.state.data as { listings?: SerializedListingCard[] } | undefined)?.listings?.[0]?.id === 'mini13-0')).toBe(true))
    }

    mount(client) // ← Back, to the 13 Mini URL
    if (stillLoadingOnBack) {
      // The interim matters as much as the end state: restored rows are live and tappable (they are
      // not a react-query placeholder, so nothing dims them), so for as long as 13 Mini is loading
      // no 12 Pro Max card may be on screen at all.
      await new Promise((r) => setTimeout(r, 100))
      expect(cardIds().filter((id) => id?.startsWith('pm12-'))).toEqual([])
      release()
    }
    await waitFor(() => expect(cardIds()).toEqual(['mini13-0', 'mini13-1', 'mini13-2']))
    countIs(3)
    await new Promise((r) => setTimeout(r, 50))
    expect(cardIds()).toEqual(['mini13-0', 'mini13-1', 'mini13-2'])
  }

  it('a card tapped while the new model was still loading does not bring the OLD rows back — not even while it loads', async () => {
    await tapWhileLoadingThenBack(false, true)
  })

  it('…nor does a snapshot that cannot say which result set its rows came from (written before `rowsSig`)', async () => {
    await tapWhileLoadingThenBack(true, false)
  })

  it('a filter change DURING a restore replaces the restored rows instead of keeping the longer list', async () => {
    // The restore holds `restoredScrollRef` until it has realigned the tapped card, and while it is
    // held a page 1 that is SHORTER than the restored list is ignored — right for the same feed,
    // wrong for another one. With frames frozen the restore never finishes, which pins that window
    // open; a new model picked inside it must still win.
    vi.stubGlobal('requestAnimationFrame', () => 0)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } })
    window.history.replaceState({}, '', URL_12_PRO_MAX)
    const first = mount(client)
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    for (const depth of [24, 36]) {
      scrollToSentinel()
      await waitFor(() => expect(cardIds()).toHaveLength(depth))
    }
    act(() => { screen.getAllByTestId('card')[20].click() })
    first.unmount()
    mount(client) // ← Back: the restore starts, and cannot finish
    await waitFor(() => expect(cardIds()).toHaveLength(36))

    navigateFilters('/?category=electronics&brand=apple&model=iPhone+13+Mini&sort=price-low')
    await waitFor(() => expect(cardIds()).toEqual(['mini13-0', 'mini13-1', 'mini13-2']))
    countIs(3)
  })

  it('the home feed\'s own server-rendered rows stay restorable on Back (the ISR seed has provenance too)', async () => {
    // The seed never passes through the queryFn, so it carries no stamp. Refusing unstamped
    // snapshots must not cost the most common restore there is: scroll the home feed, open a card,
    // come back.
    const seed = CATALOGUE['iPhone 17 Pro Max'].slice(0, 12)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } })
    const home = () => render(
      <QueryClientProvider client={client}>
        <ListingsExplorer categories={[]} initialListings={seed} initialTotal={57} initialFetchedAt={Date.now()} />
      </QueryClientProvider>,
    )
    const first = home()
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    act(() => { screen.getAllByTestId('card')[5].click() })
    const snap = JSON.parse(sessionStorage.getItem('eno:feed-snap') ?? 'null')
    expect(typeof snap?.rowsSig).toBe('string')
    first.unmount()
    const realign = vi.fn()
    window.scrollBy = realign as unknown as typeof window.scrollBy
    home()
    // The restore's proof: it realigns the TAPPED card (scrollBy), which nothing else does.
    await waitFor(() => expect(realign).toHaveBeenCalled())
    expect(cardIds()).toEqual(seed.map((l) => l.id))
  })

  it('a FAILED request for the new model shows an honest error with Try again — never the old cards under the new chips', async () => {
    // Production's client retries once (query-provider.tsx: `retry: 1`), so this does too.
    const client = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } } })
    window.history.replaceState({}, '', URL_12_PRO_MAX)
    mount(client)
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    for (const depth of [24, 36, 39]) {
      scrollToSentinel()
      await waitFor(() => expect(cardIds()).toHaveLength(depth))
    }
    failing.add('iPhone 13 Mini')
    navigateFilters('/?category=electronics&brand=apple&model=iPhone+13+Mini&sort=price-low')

    // Measured before the fix: 39 dimmed "iPhone 12 Pro Max" cards, no error, indefinitely.
    await waitFor(() => expect(screen.getByText("Couldn't load listings.")).toBeTruthy(), { timeout: 5000 })
    expect(cardIds()).toEqual([])
    expect(countLine()).toBe('') // not "39 listings": that was the previous filters' answer
    expect(screen.getByRole('alert').textContent).toBe("Couldn't load listings.") // and it is announced
    const tries = listingsRequests().filter((u) => u.searchParams.get('model') === 'iPhone 13 Mini').length
    expect(tries).toBe(2) // the request and its one retry — nothing pages past the failed page 1

    failing.clear()
    act(() => { screen.getByText('Try again').click() })
    await waitFor(() => expect(cardIds()).toEqual(['mini13-0', 'mini13-1', 'mini13-2']))
    countIs(3)
  })

  it('after a failed request, picking ANOTHER model lands on that model\'s rows, not the pre-failure ones', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } })
    window.history.replaceState({}, '', URL_12_PRO_MAX)
    mount(client)
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    for (const depth of [24, 36, 39]) {
      scrollToSentinel()
      await waitFor(() => expect(cardIds()).toHaveLength(depth))
    }
    failing.add('iPhone 13 Mini')
    navigateFilters('/?category=electronics&brand=apple&model=iPhone+13+Mini&sort=price-low')
    await waitFor(() => expect(screen.getByText("Couldn't load listings.")).toBeTruthy())

    navigateFilters('/?category=electronics&brand=apple&model=iPhone+17+Pro+Max&sort=price-low')
    const expected = CATALOGUE['iPhone 17 Pro Max'].slice(0, 12).map((l) => l.id)
    await waitFor(() => expect(cardIds()).toEqual(expected))
    countIs(57)
    expect(screen.queryByText("Couldn't load listings.")).toBeNull()
  })

  it('switching to a language the rows are not in re-reads page 1 in it (en↔vi do not: both titles ride in every row)', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } })
    window.history.replaceState({}, '', URL_12_PRO_MAX)
    const view = mount(client)
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    for (const depth of [24, 36]) {
      scrollToSentinel()
      await waitFor(() => expect(cardIds()).toHaveLength(depth))
    }
    const rerender = () => view.rerender(
      <QueryClientProvider client={client}>
        <ListingsExplorer categories={[]} initialListings={[]} initialTotal={0} />
      </QueryClientProvider>,
    )
    const before = listingsRequests().length
    h.language.lang = 'vi'
    act(() => rerender())
    await new Promise((r) => setTimeout(r, 50))
    expect(cardIds()).toHaveLength(36) // en → vi keeps the feed where it is

    h.language.lang = 'ko'
    act(() => rerender())
    // Before: the Korean page 3 came back with ids already on screen, was dropped as "seen", and
    // 36 English titles stayed under a Korean UI.
    await waitFor(() => expect(screen.getAllByTestId('card')[0].textContent).toContain('[ko]'))
    expect(cardIds()).toHaveLength(12)
    const ko = listingsRequests().slice(before).filter((u) => u.searchParams.get('lang') === 'ko')
    expect(ko[0].searchParams.get('offset')).toBe('0')
  })

  it('…and a Back into a feed snapshotted in English, after switching to Korean, does not keep the English rows', async () => {
    // The language is switched on the listing page, so the explorer comes back ALREADY in Korean and
    // restores an English snapshot. It used to keep those rows (the longer list) and then drop every
    // Korean page as "already seen".
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } })
    window.history.replaceState({}, '', URL_12_PRO_MAX)
    const first = mount(client)
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    for (const depth of [24, 36]) {
      scrollToSentinel()
      await waitFor(() => expect(cardIds()).toHaveLength(depth))
    }
    act(() => { screen.getAllByTestId('card')[20].click() })
    first.unmount()
    h.language.lang = 'ko'
    const release = hold('iPhone 12 Pro Max') // a slow network: Korean page 1 has not arrived yet
    mount(client)
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryAllByTestId('card').filter((c) => !c.textContent?.includes('[ko]'))).toEqual([])
    release()
    await waitFor(() => expect(screen.getAllByTestId('card')[0].textContent).toContain('[ko]'))
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.getAllByTestId('card').every((c) => c.textContent?.includes('[ko]'))).toBe(true)
  })

  it('the same filters in another order are the same result set: paging continues instead of snapping back to page 1', async () => {
    // Guards the guard. If a page's provenance were `filterSig` (insertion-ordered JSON) rather than
    // its react-query key (hashed with sorted keys), a URL with its attr_* params reordered would
    // make cached pages and fresh pages of ONE result set look like two — and the append guard
    // would throw the reader back to page 1 every time the feed reached a freshly fetched page.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } })
    window.history.replaceState({}, '', `${URL_12_PRO_MAX}&attr_warranty=yes&attr_color=black`)
    mount(client)
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    scrollToSentinel()
    await waitFor(() => expect(cardIds()).toHaveLength(24))

    navigateFilters(`${URL_12_PRO_MAX}&attr_color=black&attr_warranty=yes`)
    // (the reorder still resets the page — pre-existing, and harmless: page 1 comes from cache)
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    scrollToSentinel()
    await waitFor(() => expect(cardIds()).toHaveLength(24))
    scrollToSentinel() // page 3 is a FRESH request, stamped under the reordered filters
    await waitFor(() => expect(cardIds()).toHaveLength(36))
    await new Promise((r) => setTimeout(r, 50))
    expect(cardIds()).toHaveLength(36)
    expect(listingsRequests().every((u) => u.searchParams.get('attr_warranty') === 'yes')).toBe(true)
  })

  it('moving between two storefronts starts the new shop from its own page 1 (the shop is in the key AND the page reset)', async () => {
    // A storefront-to-storefront navigation can keep this component mounted with a new `sellerId`.
    // The shop is part of the request, so it must be part of the cache key (or shop B is served shop
    // A's cached page) and of `filterSig` (or shop B is fetched at shop A's depth).
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } })
    window.history.replaceState({}, '', URL_12_PRO_MAX)
    const shop = (sellerId: string) => (
      <QueryClientProvider client={client}>
        <ListingsExplorer categories={[]} initialListings={[]} initialTotal={0} sellerId={sellerId} />
      </QueryClientProvider>
    )
    const view = render(shop('shop-a'))
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    scrollToSentinel()
    await waitFor(() => expect(cardIds()).toHaveLength(24))
    const before = listingsRequests().length
    act(() => view.rerender(shop('shop-b')))
    await waitFor(() => expect(listingsRequests().slice(before).some((u) => u.searchParams.get('seller') === 'shop-b')).toBe(true))
    const firstB = listingsRequests().slice(before).find((u) => u.searchParams.get('seller') === 'shop-b')!
    expect(firstB.searchParams.get('offset')).toBe('0')
    await waitFor(() => expect(cardIds()).toHaveLength(12))
  })

  it('widening "Near you" from 5 km to 10 km asks the server again (the key used to be `near: 1` for any circle)', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } })
    window.history.replaceState({}, '', URL_12_PRO_MAX)
    mount(client)
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    const area = (radiusKm: number) => act(() => {
      window.dispatchEvent(new CustomEvent('eno:set-area', { detail: { nearby: { lat: 10.77, lng: 106.7, radiusKm } } }))
    })

    // (No count assertions here: with an area set the line prints the loaded rows, not the total.)
    area(5)
    await waitFor(() => expect(cardIds()).toHaveLength(10))

    area(10)
    await waitFor(() => expect(listingsRequests().some((u) => u.searchParams.get('radiusKm') === '10' && u.searchParams.get('offset') === '0')).toBe(true))
    // 10 km holds 20: a full first page. Before, no request went out and the 10 rows stayed.
    await waitFor(() => expect(cardIds()).toEqual(CATALOGUE['iPhone 12 Pro Max'].slice(0, 12).map((l) => l.id)))
  })
})

