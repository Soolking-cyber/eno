// @vitest-environment jsdom
/**
 * THE STOREFRONT'S PHONE GRID (UI climb r12, cook store-r12c — the storefront batch measured +0.90 / +0.50 over live, blind),
 * through the REAL explorer (listings-explorer.rentals-wide.test.tsx's harness), a shop's explorer (`sellerId`):
 *   · S3 — the view pick leads the strip as the 36px circle (phone-only by class), the undirected "All listings · N listings"
 *     row is sr-only on a phone with its h2 and its live count kept, and the results row's own view pick is not drawn there;
 *     the view switch still works from its new place. The marketplace feed keeps its row and its reserve.
 *   · S4 — the default order spreads identical twins (a reorder of the same cards); an order the reader picks is drawn as the
 *     server sent it; the marketplace feed is never reordered.
 *   · S6 — the guest row is the calm panel (CaptureCard `panel`).
 *   · S4 — ⛔ a drawn card never moves: a page appended later is spread after the cards on screen (review, 2026-11-16).
 *   · S4 — ⛔ Back puts the grid back in the order it was DRAWN, after appends of 12 / 24 / 27 (a deduped page) / 36 rows.
 *   · S3 — ⛔ the cold-link hold is released once the URL is read, even when it directs nothing (`?province=999`).
 *   · S3 — a cold directed link (`serverDirected`) draws the results row from its first frame (server HTML), never sr-only.
 *   · Q15 (owner, 2026-11-16) — the shop's strip is the filled grey strip (`data-pills="filled"`), its sort pill naming the order.
 *   · Q21b (owner, 2026-11-16) — the shop's own cards carry no partner shield (ListingCard / CompactListingRow `ownShop`).
 */
import React from 'react'
import { act, cleanup, configure, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCategory, SerializedListingCard } from '@/lib/types'
import { installFakeIntersectionObserver } from '@/test/fake-intersection-observer'
import { __resetBackToCloseForTests } from '@/lib/back-to-close'
import { __resetAreaCachesForTests } from '@/lib/vn-areas'
import { extendSpread, spreadTwins } from '@/lib/spread-twins'
import { readExplorerUrl } from '@/lib/explorer-url'
import { renderToString } from 'react-dom/server'

configure({ asyncUtilTimeout: 5_000 })
vi.setConfig({ testTimeout: 30_000 })

const h = vi.hoisted(() => {
  const router = { push: () => {}, prefetch: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }
  const tr = (en: string) => en
  const language = { lang: 'en', t: (k: string) => k, tr, setLang: () => {} }
  const auth = { user: null, profile: null, loading: false, openSignIn: () => {} }
  return { router, language, auth, sorts: [] as string[] }
})

vi.mock('next/navigation', () => ({
  useRouter: () => h.router,
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(window.location.search),
}))
// Everything behind next/dynamic is stubbed out, except that a component handed a `listing` (the list row) leaves a marker.
vi.mock('next/dynamic', () => ({
  default: () => function Dyn({ listing }: { listing?: SerializedListingCard }) {
    return listing ? <div data-testid="row" data-id={listing.id} /> : null
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
// `onOpen` is what writes the back-nav snapshot (a card tap).
vi.mock('./listing-card', () => ({
  ListingCard: function ListingCard({ listing, ownShop, onOpen }: { listing: SerializedListingCard; ownShop?: boolean; onOpen?: (l: SerializedListingCard) => void }) {
    return <button type="button" data-testid="card" data-id={listing.id} data-own-shop={String(!!ownShop)} onClick={() => onOpen?.(listing)}>{listing.title}</button>
  },
}))
vi.mock('./compact-listing-row', () => ({ CompactListingRow: () => null }))
vi.mock('./category-rail', () => ({ CategoryRail: () => null }))
vi.mock('./capture-card', () => ({ CaptureCard: ({ panel }: { panel?: boolean }) => <div data-testid="capture" data-panel={String(!!panel)} /> }))
vi.mock('./brand-rail', () => ({ BrandRail: () => null }))
vi.mock('./for-you-rail', () => ({ ForYouRail: () => null }))
vi.mock('./recently-viewed-rail', () => ({ RecentlyViewedRail: () => null }))
vi.mock('./business-rail', () => ({ BusinessRail: () => null }))
vi.mock('./trending-searches', () => ({ TrendingSearches: () => null }))
vi.mock('./ai-concierge', () => ({ AISearchButton: () => null }))

import { ListingsExplorer, __resetExplorerCommittedForTests } from './listings-explorer'

// ─── A shop whose importer posted one flat many times (GoPlus' "Duplex 1.5M") ─────────────────────────────────────────────
const row = (id: string, title: string, price: number): SerializedListingCard =>
  ({
    id, title, titleVi: null, price, priceUnit: 'month', currency: 'VND', images: [`https://img.eno.vn/${id}.webp`],
    location: 'Ho Chi Minh City', district: 'District 1', postedAt: '2026-09-01T00:00:00.000Z', contactCount: 0,
    sellerId: 'shop-1', category: { slug: 'rentals', name: 'Rentals' },
  } as unknown as SerializedListingCard)
const TITLES: [string, number][] = [
  ['Duplex 1.5M', 1_500_000], ['Duplex 1.5M', 1_500_000], ['Duplex 1.5M', 1_500_000], ['Studio 20 m²', 5_100_000],
  ['Commercial space 30 m²', 6_000_000], ['2-bed 6.5M', 6_500_000], ['2-bed 6.5M', 6_500_000], ['Room Go Vap', 3_000_000],
  ['Duplex 1.5M', 1_500_000], ['Loft Binh Thanh', 4_200_000], ['Room Go Vap', 3_000_000], ['Studio District 3', 5_500_000],
  ['Duplex 1.5M', 1_500_000], ['Apartment D7', 9_000_000],
]
let SHOP = TITLES.map(([t, p], i) => row(`s${i}`, t, p))
const SHOP_14 = SHOP
const SHOP_IDS = SHOP.map((l) => l.id)
/** Two pages of a shop whose importer posted the same flat a dozen times: page 2 holds twins of page 1's cards. */
const SHOP_24 = [...TITLES, ...TITLES.slice(0, 10)].map(([t, p], i) => row(`d${i}`, t, p))
/**
 * A shop served page by page, as the server answered it (`PAGED`): the third page repeats nine rows the reader already has, so
 * the explorer appends only its 3 new ones (deduped by id) — 12, 24, 27, then 36 rows drawn. "Duplex" and "Studio" twins on
 * every page.
 */
const pageOf = (p: string, tag: string) => [...p].map((c, i) =>
  c === 'D' ? row(`${tag}${i}`, 'Duplex 1.5M', 1_500_000) : c === 'S' ? row(`${tag}${i}`, 'Studio 20 m²', 5_100_000) : row(`${tag}${i}`, `Flat ${tag}${i}`, 2_000_000 + i))
const P1 = pageOf('DDxSxxDxxSxx', 'a')
const P2 = pageOf('xDxxSDxxxDSx', 'b')
const P3 = [...pageOf('DDS', 'c'), ...P2.slice(0, 9)]
const P4 = [...pageOf('xxxSxxxxx', 'e'), ...P2.slice(9)]
let PAGED: SerializedListingCard[][] | null = null
const PAGED_TOTAL = 48

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    const url = new URL(u, 'https://eno.vn')
    if (url.pathname !== '/api/listings') return { ok: true, status: 200, json: async () => ({}) } as Response
    h.sorts.push(url.searchParams.get('sort') ?? '')
    // The server's order for ANY sort is the shop's list as stored: twins side by side.
    const offset = Number(url.searchParams.get('offset') ?? 0)
    const limit = Number(url.searchParams.get('limit') ?? 12)
    const rows = PAGED ? (PAGED[Math.floor(offset / 12)] ?? []) : SHOP.slice(offset, offset + limit)
    const total = PAGED ? PAGED_TOTAL : SHOP.length
    const body = { listings: rows, total, offset, limit, subcategoryCounts: {}, categoryTotal: total, facets: {} }
    return { ok: true, status: 200, json: async () => body } as Response
  }))
}

let io: ReturnType<typeof installFakeIntersectionObserver>
function installDomStubs() {
  io = installFakeIntersectionObserver()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  // A phone: `useIsPhone`'s query matches, `useSmUp`'s does not.
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(max-width: 639.98px)', media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  window.scrollTo = (() => {}) as typeof window.scrollTo
  window.scrollBy = (() => {}) as typeof window.scrollBy
  Element.prototype.scrollIntoView = () => {}
}

const CATEGORIES = [{ id: 'c1', slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê', icon: 'home' }] as unknown as SerializedCategory[]
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } })
function mount(sellerId?: string, seed = SHOP, qc = client()) {
  window.history.pushState({ __NA: true }, '', '/')
  return render(
    <QueryClientProvider client={qc}>
      <ListingsExplorer categories={sellerId ? [] : CATEGORIES} initialListings={seed} initialTotal={SHOP.length} initialFetchedAt={Date.now()} sellerId={sellerId} />
    </QueryClientProvider>,
  )
}
const cardIds = () => screen.queryAllByTestId('card').map((c) => c.getAttribute('data-id'))
const toolbar = () => document.getElementById('explorer-toolbar')!
const results = () => document.getElementById('results')!
const tokens = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/)

beforeEach(() => {
  SHOP = SHOP_14
  PAGED = null
  h.sorts = []
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

describe('a storefront on a phone — S3: one control row', () => {
  it('the view pick leads the strip as the circle, phone-only by class; the results row is sr-only with its h2 and live count', async () => {
    mount('shop-1')
    await waitFor(() => expect(cardIds().length).toBeGreaterThan(0))
    const pick = within(toolbar()).getByRole('combobox', { name: /View/ })
    expect(tokens(pick)).toEqual(expect.arrayContaining(['size-9', 'rounded-full', 'tap-44']))
    // Its wrapper hides it from sm (the results row's toggles serve there), and it is the FIRST control of the strip's row.
    const wrapper = pick.parentElement!.closest('.sm\\:hidden')!
    expect(wrapper).not.toBeNull()
    const firstControl = toolbar().querySelector('[role="combobox"]')
    expect(firstControl).toBe(pick)
    // The "All listings · N listings" row: the same element, sr-only on a phone, its heading and its live count kept.
    expect(tokens(results())).toContain('max-sm:sr-only')
    expect(within(results()).getByRole('heading', { level: 2 }).textContent).toBe('All listings')
    expect(results().querySelector('[aria-live]')).not.toBeNull()
    // No view pick in that row on a phone: its cluster is display:none there.
    expect(tokens(results().querySelector('[data-view-cluster]'))).toContain('max-sm:hidden')
  })

  it('the view switch still works from its new place: List view draws the rows', async () => {
    const user = userEvent.setup()
    mount('shop-1')
    await waitFor(() => expect(cardIds().length).toBeGreaterThan(0))
    await user.click(within(toolbar()).getByRole('combobox', { name: /View/ }))
    await user.click(await screen.findByRole('option', { name: 'List view' }))
    await waitFor(() => expect(screen.queryAllByTestId('row').length).toBeGreaterThan(0))
    expect(cardIds()).toEqual([])
    expect(within(toolbar()).getByRole('combobox', { name: /View/ }).textContent).toContain('List view')
  })

  it('the marketplace feed is unchanged: its results row is drawn, the strip holds only the reserve', async () => {
    mount()
    await waitFor(() => expect(cardIds().length).toBeGreaterThan(0))
    expect(tokens(results())).not.toContain('max-sm:sr-only')
    expect(within(toolbar()).queryByRole('combobox', { name: /View/ })).toBeNull()
    expect(toolbar().querySelector('.view-pick-reserve')).not.toBeNull()
    expect(tokens(results().querySelector('[data-view-cluster]'))).not.toContain('max-sm:hidden')
  })
})

describe('a storefront — S4: identical twins spread in the default order only', () => {
  it('the default order: the same cards, reordered so twins stand apart', async () => {
    mount('shop-1')
    await waitFor(() => expect(cardIds().length).toBe(SHOP.length))
    const drawn = cardIds()
    expect([...drawn].sort()).toEqual([...SHOP_IDS].sort())
    expect(drawn).toEqual(spreadTwins(SHOP).map((l) => l.id))
    expect(drawn).not.toEqual(SHOP_IDS)
    // No two "Duplex 1.5M" side by side any more.
    const titles = drawn.map((id) => SHOP.find((l) => l.id === id)!.title)
    expect(titles.some((t, i) => i > 0 && t === titles[i - 1] && t === 'Duplex 1.5M')).toBe(false)
  })

  it('⛔ an order the reader picks is drawn exactly as the server sent it', async () => {
    const user = userEvent.setup()
    mount('shop-1')
    await waitFor(() => expect(cardIds().length).toBe(SHOP.length))
    await user.click(within(toolbar()).getByRole('combobox', { name: /Sort by/ }))
    await user.click(await screen.findByRole('option', { name: 'Price: low to high' }))
    await waitFor(() => expect(h.sorts).toContain('price-low'))
    await waitFor(() => expect(cardIds()).toEqual(SHOP_IDS.slice(0, cardIds().length)))
    expect(cardIds().length).toBeGreaterThan(1)
  })

  it('the marketplace feed is never reordered', async () => {
    mount()
    await waitFor(() => expect(cardIds().length).toBeGreaterThan(1))
    expect(cardIds()).toEqual(SHOP_IDS.slice(0, cardIds().length))
  })
})

describe('a storefront — S6: the guest row is the calm panel', () => {
  it('CaptureCard `panel` on a storefront; the marketplace home keeps its row', async () => {
    mount('shop-1')
    await waitFor(() => expect(screen.getByTestId('capture')).toBeTruthy())
    expect(screen.getByTestId('capture').getAttribute('data-panel')).toBe('true')
    // The grid's padding-back skips the panel (it sits on the gutter by its own margin).
    expect(tokens(screen.getByTestId('capture').parentElement)).toContain('max-sm:[&>.col-span-full:not([data-capture-panel])]:px-3')
    cleanup()
    await act(async () => { mount() })
    await waitFor(() => expect(screen.getByTestId('capture')).toBeTruthy())
    expect(screen.getByTestId('capture').getAttribute('data-panel')).toBe('false')
  })
})

describe('a storefront — S4: ⛔ a drawn card never moves when a page appends', () => {
  it('page 2 is spread after the cards on screen: page 1 keeps its drawn order, the twins of page 2 spread among themselves', async () => {
    SHOP = SHOP_24
    mount('shop-1', SHOP_24.slice(0, 12))
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    const before = cardIds()
    expect(before).toEqual(spreadTwins(SHOP_24.slice(0, 12)).map((l) => l.id))
    // The undirected shop pages on its "Browse everything" (the sentinel takes over after it).
    await userEvent.setup().click(screen.getByRole('button', { name: 'Browse everything' }))
    await waitFor(() => expect(cardIds()).toHaveLength(24))
    expect(cardIds().slice(0, 12)).toEqual(before)
    const drawn = SHOP_24.slice(0, 12)
    expect(cardIds()).toEqual(extendSpread({ source: drawn, drawn: spreadTwins(drawn) }, SHOP_24).map((l) => l.id))
  })
})

describe('a storefront — S4: ⛔ Back puts the grid back in the order it was DRAWN (review, 2026-11-16)', () => {
  /** The reader pages the shop to `depth` rows: "Browse everything" for page 2, then the sentinel. */
  async function pageTo(depth: number) {
    await waitFor(() => expect(cardIds()).toHaveLength(12))
    if (depth >= 24) {
      await userEvent.setup().click(screen.getByRole('button', { name: 'Browse everything' }))
      await waitFor(() => expect(cardIds()).toHaveLength(24))
    }
    for (const next of [27, 36]) {
      if (depth < next) break
      io.scrollToSentinel()
      await waitFor(() => expect(cardIds()).toHaveLength(next))
    }
  }

  it.each([12, 24, 27, 36])('after %i rows: a card tapped and Back — every card where it was', async (depth) => {
    PAGED = [P1, P2, P3, P4]
    const qc = client()
    const first = mount('shop-1', P1, qc)
    await pageTo(depth)
    const before = cardIds()
    act(() => { screen.getAllByTestId('card')[depth - 2].click() })
    const snap = JSON.parse(sessionStorage.getItem('eno:feed-snap') ?? 'null')
    // The snapshot names the order drawn, not only the rows in the order they came.
    expect(snap.drawn).toEqual(before)
    expect(snap.listings).toHaveLength(depth)
    first.unmount() // → the listing
    mount('shop-1', P1, qc) // ← Back
    await waitFor(() => expect(cardIds()).toHaveLength(depth))
    expect(cardIds()).toEqual(before)
    expect(sessionStorage.getItem('eno:feed-snap')).toBeNull()
    // …and nothing re-lays it a render later.
    await new Promise((r) => setTimeout(r, 50))
    expect(cardIds()).toEqual(before)
    if (depth === 36) {
      // What the restore drew before: the seed's page kept, the rest re-cut into 12-row blocks — another order from row 24 on.
      const rows = [...P1, ...P2, ...P3.slice(0, 3), ...P4.slice(0, 9)]
      const rebuilt = extendSpread({ source: P1, drawn: spreadTwins(P1) }, rows).map((l) => l.id)
      expect(rebuilt).not.toEqual(before)
    }
  })
})

describe('a storefront — S3: ⛔ the cold-link hold never sticks (review, 2026-11-16)', () => {
  it('a link the server calls directed that directs nothing here (`?province=999`, no such province): released once the URL is read', async () => {
    // The server's half: a province code directs the link, so the row is drawn from the first frame.
    expect(readExplorerUrl(new URLSearchParams('province=999')).directed).toBe(true)
    window.history.replaceState({}, '', '/?province=999')
    render(
      <QueryClientProvider client={client()}>
        <ListingsExplorer categories={[]} initialListings={SHOP} initialTotal={SHOP.length} initialFetchedAt={Date.now()} sellerId="shop-1" serverDirected />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(cardIds().length).toBeGreaterThan(0))
    // No area was set, so the shop is undirected: its phone row goes sr-only, as on any undirected shop (it stayed drawn).
    await waitFor(() => expect(tokens(results())).toContain('max-sm:sr-only'))
    expect(results().hasAttribute('data-home-row')).toBe(true)
  })
})

describe('a storefront — S3: a cold directed link draws its results row from the first frame', () => {
  const firstFrame = (props: Partial<React.ComponentProps<typeof ListingsExplorer>>) => {
    const div = document.createElement('div')
    div.innerHTML = renderToString(
      <QueryClientProvider client={client()}>
        <ListingsExplorer categories={[]} initialListings={SHOP} initialTotal={SHOP.length} initialFetchedAt={Date.now()} sellerId="shop-1" {...props} />
      </QueryClientProvider>,
    )
    return div.querySelector('#results')!
  }

  it('undirected: sr-only on a phone from the server HTML; directed (`serverDirected`): drawn, in the directed row\'s shape', () => {
    expect(tokens(firstFrame({}))).toContain('max-sm:sr-only')
    const directed = firstFrame({ serverDirected: true })
    expect(tokens(directed)).not.toContain('max-sm:sr-only')
    // Not the undirected home's two-row grid (globals.css `#results[data-home-row]`), which the answer would re-lay.
    expect(directed.hasAttribute('data-home-row')).toBe(false)
  })

  it('after hydration the directed row stays drawn; clearing back to the whole shop takes it sr-only again', async () => {
    window.history.replaceState({}, '', '/?q=duplex')
    render(
      <QueryClientProvider client={client()}>
        <ListingsExplorer categories={[]} initialListings={SHOP} initialTotal={SHOP.length} initialFetchedAt={Date.now()} sellerId="shop-1" serverDirected />
      </QueryClientProvider>,
    )
    expect(tokens(results())).not.toContain('max-sm:sr-only')
    await waitFor(() => expect(cardIds().length).toBeGreaterThan(0))
    expect(tokens(results())).not.toContain('max-sm:sr-only')
  })
})

describe('a storefront — Q15: the filled grey strip, its sort pill naming the order (owner, 2026-11-16)', () => {
  it('a shop\'s strip is `data-pills="filled"` and its sort pill says "Relevance" — like every feed strip since hub Q15', async () => {
    mount('shop-1')
    await waitFor(() => expect(cardIds().length).toBeGreaterThan(0))
    expect(toolbar().getAttribute('data-pills')).toBe('filled')
    const sortPill = within(toolbar()).getByRole('combobox', { name: /Sort by/ })
    expect(sortPill.textContent).toContain('Relevance')
    expect(sortPill.querySelector('.sort-word-default')).toBeNull()
    // The marketplace feed's strip is filled too (owner 2026-11-16, hub Q15: "filled strips on feeds and shops").
    cleanup()
    mount()
    await waitFor(() => expect(cardIds().length).toBeGreaterThan(0))
    expect(toolbar().getAttribute('data-pills')).toBe('filled')
  })
})

describe('a storefront — Q21b: no partner shield on the shop\'s own cards (owner, 2026-11-16)', () => {
  it('the shop\'s cards are drawn `ownShop`; the marketplace feed\'s are not', async () => {
    mount('shop-1')
    await waitFor(() => expect(cardIds().length).toBeGreaterThan(0))
    expect(screen.getAllByTestId('card').every((c) => c.getAttribute('data-own-shop') === 'true')).toBe(true)
    cleanup()
    mount()
    await waitFor(() => expect(cardIds().length).toBeGreaterThan(0))
    expect(screen.getAllByTestId('card').every((c) => c.getAttribute('data-own-shop') === 'false')).toBe(true)
  })
})
