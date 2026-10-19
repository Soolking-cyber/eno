// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { setConsent } from '@/lib/consent'

/**
 * ⛔ A TEACHER PROFILE COUNTS ITS VIEWS AND NOTHING ELSE (2026-10-19). The teacher page returned before
 * <TrackView> rendered, so every teacher profile read 0 views; it now mounts <TrackViewCount>, the counter
 * alone. <TrackView>'s other two channels stay off a person: the GA4/Meta item carries the listing title (a
 * teacher's NAME) to the ad platforms, and the reco history would keep a person in "Recently viewed".
 */

const spies = vi.hoisted(() => ({ trackViewListing: vi.fn(), recordView: vi.fn(), recordViewedListing: vi.fn() }))
vi.mock('@/lib/analytics', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/analytics')>()), trackViewListing: spies.trackViewListing }))
vi.mock('@/lib/reco-signals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reco-signals')>()),
  recordView: spies.recordView,
  recordViewedListing: spies.recordViewedListing,
}))

const { TrackView, TrackViewCount, VIEW_DEDUP_KEY } = await import('./track-view')

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  }
}

let posts: { url: string; init?: RequestInit }[] = []

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
  posts = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { posts.push({ url: String(url), init }); return new Response(null, { status: 204 }) }))
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: () => true })
  document.cookie.split(';').forEach((c) => { document.cookie = `${c.split('=')[0].trim()}=; max-age=0; path=/` })
  for (const s of Object.values(spies)) s.mockClear()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete (navigator as { webdriver?: boolean }).webdriver })

const viewsOf = (id: string) => posts.filter((p) => p.url === `/api/listings/${id}/view`)

describe('TrackViewCount (teacher profiles)', () => {
  it('POSTs the view counter, fire-and-forget', () => {
    render(<TrackViewCount id="t1" />)
    expect(viewsOf('t1')).toHaveLength(1)
    expect(viewsOf('t1')[0].init).toMatchObject({ method: 'POST', keepalive: true })
  })

  it('counts once per tab window — a re-open does not count again, through the same dedup map as <TrackView>', () => {
    render(<TrackViewCount id="t1" />)
    cleanup()
    render(<TrackViewCount id="t1" />)
    expect(viewsOf('t1')).toHaveLength(1)
    expect(Object.keys(JSON.parse(sessionStorage.getItem(VIEW_DEDUP_KEY)!))).toEqual(['t1'])
  })

  it('a soft navigation to another teacher counts the new one', () => {
    const { rerender } = render(<TrackViewCount id="t1" />)
    rerender(<TrackViewCount id="t2" />)
    expect(viewsOf('t1')).toHaveLength(1)
    expect(viewsOf('t2')).toHaveLength(1)
  })

  it('⛔ never feeds the ad platforms or the reco history — even with every consent switched on', () => {
    setConsent({ p: true, a: true, d: true }, { surface: 'banner', action: 'save', locale: 'en' })
    render(<TrackViewCount id="t1" />)
    expect(spies.trackViewListing).not.toHaveBeenCalled()
    expect(spies.recordView).not.toHaveBeenCalled()
    expect(spies.recordViewedListing).not.toHaveBeenCalled()
    expect(viewsOf('t1')).toHaveLength(1) // the counter itself still counts
  })

  it('…while <TrackView> on a product still feeds all three (the spies are live)', () => {
    render(<TrackView id="l1" title="Phone" price={100} currency="VND" category="Phones" categorySlug="phones" brandSlug="apple" />)
    expect(spies.trackViewListing).toHaveBeenCalledTimes(1)
    expect(spies.recordView).toHaveBeenCalledWith('phones', 'apple')
    expect(spies.recordViewedListing).toHaveBeenCalledWith('l1')
    expect(viewsOf('l1')).toHaveLength(1)
  })

  it('a webdriver-driven browser never fires it', () => {
    Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => true })
    render(<TrackViewCount id="t1" />)
    expect(viewsOf('t1')).toHaveLength(0)
  })
})
