// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ids = vi.hoisted(() => ({ list: [] as string[], allowed: true }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('./listing-card', () => ({ ListingCard: ({ listing }: { listing: { id: string } }) => <div data-card={listing.id} /> }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('@/hooks/use-near-viewport', () => ({ useNearViewport: () => ({ ref: { current: null }, near: true }) }))
vi.mock('@/lib/consent', () => ({ personalizationAllowed: () => ids.allowed }))
vi.mock('@/lib/reco-signals', () => ({ getViewedListingIds: () => ids.list }))

import { RecentlyViewedRail } from './recently-viewed-rail'

/** The shelf's place is held as soon as the history says it is coming: arriving on the fetch's answer, it pushed whatever was being read. */
let answer: (v: unknown) => void
beforeEach(() => {
  ids.list = ['a', 'b', 'c']; ids.allowed = true
  vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => { answer = r })))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const reply = async (listings: { id: string; sellerId: string }[]) => { answer({ ok: true, json: async () => ({ listings }) }); await flush() }

describe('RecentlyViewedRail holds its place', () => {
  it('a history of two or more: the shelf is there before the answer, and the cards replace it', async () => {
    const { container } = render(<RecentlyViewedRail />)
    await flush()
    expect(container.querySelector('[data-rv-loading]')).not.toBeNull()
    await reply([{ id: 'a', sellerId: 's' }, { id: 'b', sellerId: 's' }])
    expect(container.querySelector('[data-rv-loading]')).toBeNull()
    expect(container.querySelectorAll('[data-card]')).toHaveLength(2)
  })
  it('an answer with too few collapses it', async () => {
    const { container } = render(<RecentlyViewedRail />)
    await flush()
    await reply([{ id: 'a', sellerId: 's' }])
    expect(container.querySelector('[data-rv-loading]')).toBeNull()
    expect(container.querySelector('section')).toBeNull()
  })
  it('consent withdrawn and given back: the place is held again, not left stale', async () => {
    const { container } = render(<RecentlyViewedRail />)
    await flush()
    await reply([{ id: 'a', sellerId: 's' }, { id: 'b', sellerId: 's' }])
    ids.allowed = false
    await act(async () => { window.dispatchEvent(new Event('eno:consent')) })
    expect(container.querySelector('[data-card]')).toBeNull()
    ids.allowed = true
    await act(async () => { window.dispatchEvent(new Event('eno:consent')) })
    expect(container.querySelector('[data-rv-loading]')).not.toBeNull()
  })
  it('the listing being read does not count toward the history', async () => {
    ids.list = ['a', 'b']
    const { container } = render(<RecentlyViewedRail excludeId="a" />)
    await flush()
    expect(container.querySelector('[data-rv-loading]')).toBeNull()
  })
  it('no consent, no shelf: the history is not even saved', async () => {
    ids.allowed = false
    const { container } = render(<RecentlyViewedRail />)
    await flush()
    expect(container.querySelector('[data-rv-loading]')).toBeNull()
  })
})
