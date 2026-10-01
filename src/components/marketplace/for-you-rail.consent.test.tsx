// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { SerializedListingCard } from '@/lib/types'

/**
 * Consent v2 (`p`, Personalization) and the home rails: with Personalization off the For You rail must
 * still render — as "Trending now" from the server seed — and must not send the visitor's on-device
 * history anywhere; the Recently viewed rail must render nothing at all (no empty section). With `p`
 * on, the history reaches /api/recommendations.
 */

// The first test pays the cold import of the rails + LanguageProvider. It failed once under the full
// suite's parallel load (2026-10-01) while passing in isolation every time, so it gets the same kind of
// headroom privacy/page.test.tsx gives its re-imports.
vi.setConfig({ testTimeout: 30_000 })

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }))
// The card is a landmine-grade component with its own suites; the rails only need a stand-in.
vi.mock('./listing-card', () => ({ ListingCard: ({ listing }: { listing: { title: string } }) => <div data-testid="card">{listing.title}</div> }))

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed))
  return {
    get length() { return map.size },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => { map.clear() },
  } as Storage
}

const card = (id: string) => ({ id, title: `Listing ${id}` }) as unknown as SerializedListingCard
const SEED = ['a', 'b', 'c', 'd'].map(card)
const HISTORY = {
  'eno:viewed': JSON.stringify([{ c: 'phones', b: 'apple' }]),
  'eno:viewed_ids': JSON.stringify(['x1', 'x2', 'x3']),
  'eno:recent_searches': JSON.stringify(['iphone 15']),
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  // The Shelf's scroll arrows measure their scroller; jsdom has no ResizeObserver.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ listings: ['p', 'q', 'r'].map(card), personalized: true }) }))
  vi.stubGlobal('fetch', fetchMock)
  document.cookie.split(';').forEach((c) => { document.cookie = `${c.split('=')[0].trim()}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/` })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function mount(node: React.ReactNode) {
  const { LanguageProvider } = await import('@/context/language-context')
  render(<LanguageProvider>{node}</LanguageProvider>)
  await act(async () => { await Promise.resolve() })
}

describe('ForYouRail with Personalization OFF', () => {
  it('⛔ shows the seeded Trending rail and sends no history (no fetch at all for a seeded, signal-less visitor)', async () => {
    vi.stubGlobal('localStorage', memoryStorage(HISTORY)) // a history left on the device from before
    const { ForYouRail } = await import('./for-you-rail')
    await mount(<ForYouRail initial={SEED} />)
    expect(screen.getByText('Trending now')).toBeTruthy()
    expect(screen.getAllByTestId('card')).toHaveLength(4)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('ForYouRail with Personalization ON', () => {
  it('sends the on-device signals to /api/recommendations and upgrades to "For you"', async () => {
    vi.stubGlobal('localStorage', memoryStorage(HISTORY))
    const { setConsent } = await import('@/lib/consent')
    setConsent({ p: true, a: false, d: false }, { surface: 'banner', action: 'save', locale: 'en' })
    fetchMock.mockClear() // setConsent's own record beacon is not the rail
    const { ForYouRail } = await import('./for-you-rail')
    await mount(<ForYouRail initial={SEED} />)
    const urls = fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/api/recommendations'))
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('cats=phones')
    expect(new URL(urls[0], 'http://x').searchParams.get('terms')).toContain('iphone 15')
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('For you')).toBeTruthy()
  })
})

const TRENDING = ['t1', 't2', 't3'].map(card)
const PERSONAL = ['p1', 'p2', 'p3'].map(card)
const recoCalls = () => fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/api/recommendations'))
const grant = async () => (await import('@/lib/consent')).setConsent({ p: true, a: false, d: false }, { surface: 'banner', action: 'save', locale: 'en' })
const withdraw = async () => {
  const { setConsent } = await import('@/lib/consent')
  await act(async () => { setConsent({ p: false, a: false, d: false }, { surface: 'settings', action: 'save', locale: 'en' }) })
  await act(async () => { await Promise.resolve() })
}
const titles = () => screen.getAllByTestId('card').map((n) => n.textContent)

describe('ForYouRail — withdrawing Personalization takes effect on screen at once', () => {
  it('⛔ seeded: the history-ranked rail goes back to the Trending seed, with no new request', async () => {
    vi.stubGlobal('localStorage', memoryStorage(HISTORY))
    await grant()
    const { ForYouRail } = await import('./for-you-rail')
    await mount(<ForYouRail initial={SEED} />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('For you')).toBeTruthy()
    expect(titles()).toEqual(['Listing p', 'Listing q', 'Listing r'])
    fetchMock.mockClear()
    await withdraw()
    expect(screen.getByText('Trending now')).toBeTruthy()
    expect(titles()).toEqual(SEED.map((l) => l.title))
    expect(recoCalls()).toHaveLength(0) // seeded and signal-less: the seed IS the answer
  })

  it('⛔ unseeded: re-fetches WITHOUT the history and shows that answer', async () => {
    vi.stubGlobal('localStorage', memoryStorage(HISTORY))
    fetchMock.mockImplementation(async (url: string) => {
      const personal = String(url).includes('cats=')
      return { ok: true, json: async () => ({ listings: personal ? PERSONAL : TRENDING, personalized: personal }) }
    })
    await grant()
    const { ForYouRail } = await import('./for-you-rail')
    await mount(<ForYouRail />)
    await act(async () => { await Promise.resolve() })
    expect(titles()).toEqual(PERSONAL.map((l) => l.title))
    fetchMock.mockClear()
    await withdraw()
    const urls = recoCalls()
    expect(urls).toHaveLength(1)
    const sp = new URL(urls[0], 'http://x').searchParams
    expect(sp.has('cats')).toBe(false)
    expect(sp.has('brands')).toBe(false)
    expect(sp.has('terms')).toBe(false) // the saved searches go too; only inbound intent may be sent
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('Trending now')).toBeTruthy()
    expect(titles()).toEqual(TRENDING.map((l) => l.title))
  })

  it('⛔ a history request still in flight at the withdrawal cannot put the personalised rail back', async () => {
    vi.stubGlobal('localStorage', memoryStorage(HISTORY))
    await grant()
    let release: (v: unknown) => void = () => {}
    fetchMock.mockImplementation((url: string) => String(url).startsWith('/api/recommendations')
      ? new Promise((resolve) => { release = resolve })
      : Promise.resolve({ ok: true, json: async () => ({}) }))
    const { ForYouRail } = await import('./for-you-rail')
    await mount(<ForYouRail initial={SEED} />)
    expect(recoCalls()).toHaveLength(1)
    await withdraw()
    await act(async () => { release({ ok: true, json: async () => ({ listings: PERSONAL, personalized: true }) }) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByText('Trending now')).toBeTruthy()
    expect(titles()).toEqual(SEED.map((l) => l.title))
  })
})

describe('RecentlyViewedRail with Personalization OFF', () => {
  it('⛔ renders no section and fetches nothing, even with ids left on the device', async () => {
    vi.stubGlobal('localStorage', memoryStorage(HISTORY))
    vi.stubGlobal('IntersectionObserver', class { constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {} observe() { this.cb([{ isIntersecting: true }]) } disconnect() {} unobserve() {} })
    const { RecentlyViewedRail } = await import('./recently-viewed-rail')
    await mount(<RecentlyViewedRail />)
    expect(screen.queryByText('Recently viewed')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('RecentlyViewedRail — withdrawing Personalization hides it at once', () => {
  it('⛔ shows the history with `p`, and removes the section the moment `p` is switched off', async () => {
    vi.stubGlobal('localStorage', memoryStorage(HISTORY))
    vi.stubGlobal('IntersectionObserver', class { constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {} observe() { this.cb([{ isIntersecting: true }]) } disconnect() {} unobserve() {} })
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ listings: ['x1', 'x2', 'x3'].map(card) }) }))
    await grant()
    fetchMock.mockClear()
    const { RecentlyViewedRail } = await import('./recently-viewed-rail')
    await mount(<RecentlyViewedRail />)
    await act(async () => { await Promise.resolve() })
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(['/api/listings?ids=x1,x2,x3'])
    expect(screen.getByText('Recently viewed')).toBeTruthy()
    expect(screen.getAllByTestId('card')).toHaveLength(3)
    await withdraw()
    expect(screen.queryByText('Recently viewed')).toBeNull()
    expect(screen.queryAllByTestId('card')).toHaveLength(0)
  })
})
