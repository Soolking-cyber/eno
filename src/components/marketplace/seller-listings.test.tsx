// @vitest-environment jsdom
/**
 * ⛔ A STOREFRONT SEARCHED AND SORTED 60 OF ITS 9,726 LISTINGS WHILE ANNOUNCING 9,726.
 *
 * `SellerListings` filters and re-sorts the array it is handed. That is right when the array IS the
 * catalogue and wrong the moment the page holds a window of it: the CellphoneS storefront rendered
 * its 60 NEWEST listings under a heading with the true count, so "Price ↑" reordered those 60 and
 * could not reach the cheapest phone in the shop, and typing a model name searched 0.6% of it. The
 * district landing pages had the same shape over their own page of cards.
 *
 * ⚠️ SO EVERY TEST BELOW ASKS THE SAME QUESTION: DID THE ANSWER COME FROM THE SERVER, AND DID IT
 * CARRY THE SCOPE? An off-page record must be reachable, the scope params must ride on every
 * request including load-more, and a failed request must never quietly fall back to re-sorting the
 * page's own rows — that is a wrong answer wearing a right answer's clothes.
 *
 * ⚠️ NO NETWORK. `fetch` is stubbed per test.
 */
import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'
import { SellerListings } from './seller-listings'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en }),
  Tr: ({ text }: { text: string }) => <>{text}</>,
}))
// The card itself is not under test and drags in images, links and contexts.
vi.mock('./listing-card', () => ({
  ListingCard: ({ listing }: { listing: SerializedListingCard }) => (
    <article data-testid="card" data-id={listing.id}>{listing.title}</article>
  ),
}))

const card = (id: string, price: number, title = id): SerializedListingCard =>
  ({
    id, title, titleVi: null, price, location: 'Ho Chi Minh City', district: 'District 1',
    postedAt: '2026-09-01T00:00:00.000Z', contactCount: 0,
  } as unknown as SerializedListingCard)

/** The 60 newest, all expensive — the window the storefront used to hand the browser. */
const PAGE = Array.from({ length: 60 }, (_, i) => card(`new-${i}`, 20_000_000 + i))
/** The cheapest phone in the shop, ranked far outside that window. */
const CHEAPEST = card('cheap-1', 90_000, 'The cheapest phone')

type Reply = { listings: SerializedListingCard[]; total: number } | 'fail'
function stubFetch(reply: (url: URL, call: number) => Reply) {
  const urls: URL[] = []
  const mock = vi.fn(async (u: string) => {
    const url = new URL(u, 'https://eno.vn')
    const r = reply(url, urls.length)
    urls.push(url)
    if (r === 'fail') return { ok: false, status: 500, json: async () => ({}) } as any
    return { ok: true, json: async () => r } as any
  })
  vi.stubGlobal('fetch', mock)
  return urls
}

function renderShop(extra: Record<string, unknown> = {}) {
  return render(
    <SellerListings
      listings={PAGE}
      searchable
      sortable
      initialSort="recent"
      serverScope={{ params: { seller: 's1' }, total: 9726, pageSize: 60 }}
      {...extra}
    />,
  )
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })
beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })

describe('SellerListings in server-scoped mode', () => {
  it('renders the server-rendered page without asking the network for anything', async () => {
    const urls = stubFetch(() => ({ listings: [], total: 0 }))
    renderShop()
    expect(screen.getAllByTestId('card')).toHaveLength(60)
    expect(screen.getByText('Showing 60 of 9,726 listings.')).toBeTruthy()
    await new Promise((r) => setTimeout(r, 500))
    expect(urls).toHaveLength(0)
  })

  it('reaches the cheapest listing in the shop, which is nowhere on the page', async () => {
    // ⛔ THE DEFECT, EXACTLY: with an in-memory sort this card cannot appear at any price order.
    const urls = stubFetch(() => ({ listings: [CHEAPEST, ...PAGE.slice(0, 47)], total: 9726 }))
    renderShop()
    await userEvent.click(screen.getByRole('tab', { name: /price/i }))
    await waitFor(() => expect(screen.getByText('The cheapest phone')).toBeTruthy())
    expect(urls[0].searchParams.get('sort')).toBe('price-low')
    // ⚠️ THE SCOPE RIDES ON THE REQUEST. A sort that dropped `seller` would answer with the
    // cheapest listing on the whole site under this seller's heading.
    expect(urls[0].searchParams.get('seller')).toBe('s1')
    expect(urls[0].searchParams.get('offset')).toBe('0')
  })

  it('searches the whole shop, not the page', async () => {
    const match = card('deep-1', 5_000_000, 'iPhone 12 mini')
    const urls = stubFetch(() => ({ listings: [match], total: 1 }))
    renderShop()
    await userEvent.type(screen.getByLabelText('Search this seller'), 'iphone 12')
    await waitFor(() => expect(screen.getByText('iPhone 12 mini')).toBeTruthy(), { timeout: 3000 })
    expect(urls[urls.length - 1].searchParams.get('q')).toBe('iphone 12')
    expect(urls[urls.length - 1].searchParams.get('seller')).toBe('s1')
    expect(screen.getByText('1 listing.')).toBeTruthy()
  })

  it('loads the next page from the right offset and keeps the scope', async () => {
    const second = Array.from({ length: 60 }, (_, i) => card(`p2-${i}`, 1_000 + i))
    const urls = stubFetch((u, call) => ({
      listings: call === 0 ? PAGE.map((l) => card(`s-${l.id}`, l.price)) : second,
      total: 9726,
    }))
    renderShop()
    await userEvent.click(screen.getByRole('tab', { name: /price/i }))
    await waitFor(() => expect(screen.getAllByTestId('card')).toHaveLength(60))
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }))
    await waitFor(() => expect(screen.getAllByTestId('card')).toHaveLength(120))
    expect(urls[1].searchParams.get('offset')).toBe('60')
    expect(urls[1].searchParams.get('seller')).toBe('s1')
    expect(urls[1].searchParams.get('sort')).toBe('price-low')
  })

  it('does not render the same listing twice when a page overlaps', async () => {
    // A listing posted between two requests shifts the offset window, so page 2 can repeat a row.
    const urls = stubFetch((u) => ({
      listings: u.searchParams.get('offset') === '0' ? [card('a', 1), card('b', 2)] : [card('b', 2), card('c', 3)],
      total: 4,
    }))
    renderShop()
    await userEvent.click(screen.getByRole('tab', { name: /price/i }))
    await waitFor(() => expect(screen.getAllByTestId('card')).toHaveLength(2))
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }))
    await waitFor(() => expect(screen.getAllByTestId('card')).toHaveLength(3))
    expect(urls).toHaveLength(2)
  })

  it('a failed sort says so instead of re-sorting the page and calling it the answer', async () => {
    stubFetch(() => 'fail')
    renderShop()
    await userEvent.click(screen.getByRole('tab', { name: /price/i }))
    await waitFor(() => expect(screen.getByText("Couldn't load listings.")).toBeTruthy())
    // ⛔ THE 60 EXPENSIVE ROWS MUST NOT BE ON SCREEN AS "cheapest first".
    expect(screen.queryAllByTestId('card')).toHaveLength(0)
  })

  /**
   * ⛔ AN EMPTY GRID IS THE RIGHT STATE AND "Showing 0 of 9,726" IS THE WRONG CAPTION FOR IT.
   * Between asking for a sort and receiving it there is nothing honest to show, so the surface
   * says it is searching and stands skeletons in for the cards — it does not announce a zero
   * through aria-live over a shop that has 9,726 listings (external review).
   */
  it('says it is searching while the query is in flight, never "0 of 9,726"', async () => {
    let release: (v: unknown) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => { release = r })))
    renderShop()
    await userEvent.click(screen.getByRole('tab', { name: /price/i }))
    await waitFor(() => expect(screen.getByText('Searching all listings…')).toBeTruthy())
    expect(screen.queryByText(/Showing 0 of/)).toBeNull()
    release({ ok: true, json: async () => ({ listings: [{ id: 'x', title: 'Cheapest', price: 1 }], total: 1 }) })
  })

  it('pluralises the count — "1 listing", not "1 listings"', async () => {
    stubFetch(() => ({ listings: [card('only', 1)], total: 1 }))
    renderShop()
    await userEvent.click(screen.getByRole('tab', { name: /price/i }))
    await waitFor(() => expect(screen.getByText('1 listing.')).toBeTruthy())
  })

  it('offers no "Show more" once everything in scope is on screen', async () => {
    stubFetch(() => ({ listings: [card('only', 1)], total: 1 }))
    renderShop()
    await userEvent.click(screen.getByRole('tab', { name: /price/i }))
    await waitFor(() => expect(screen.getByText('1 listing.')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })

  it('without serverScope it still sorts in place — the seller who owns every row', async () => {
    const urls = stubFetch(() => ({ listings: [], total: 0 }))
    render(<SellerListings listings={[card('a', 300), card('b', 100)]} sortable />)
    await userEvent.click(screen.getByRole('tab', { name: /price/i }))
    await waitFor(() => expect(screen.getAllByTestId('card')[0].getAttribute('data-id')).toBe('b'))
    expect(urls).toHaveLength(0)
  })
})
