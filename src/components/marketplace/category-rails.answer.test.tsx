// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCategory } from '@/lib/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }))
vi.mock('./listing-card', () => ({ ListingCard: () => null }))
const h = vi.hoisted(() => ({ lang: 'en' }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: h.lang, tr: (en: string) => en, t: (en: string) => en }) }))

import { CategoryRails } from './category-rails'

/**
 * The home page holds this block's place until there is an answer (DeferredCategoryRails, listings-explorer.tsx): rails that arrived
 * from nothing threw the footer off the screen, 0.42 of real-user CLS on desktop. So every way out has to answer, or the place is held forever.
 */
const cats = [{ slug: 'rentals', name: 'Rentals', nameVi: 'Thuê' }] as unknown as SerializedCategory[]
const listing = (id: string) => ({ id, title: id, sellerId: 's', images: [] })
const answered = async (reply: () => Promise<unknown>) => {
  vi.stubGlobal('fetch', vi.fn(reply))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  const onAnswer = vi.fn()
  render(<CategoryRails categories={cats} onCategory={() => {}} onAnswer={onAnswer} />)
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  return onAnswer
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); h.lang = 'en' })

describe('CategoryRails answers the place it holds', () => {
  it('no answer while the request is out', async () => {
    const onAnswer = await answered(() => new Promise(() => {}))
    expect(onAnswer).not.toHaveBeenCalled()
  })
  it('rails to show', async () => {
    const onAnswer = await answered(async () => ({ ok: true, json: async () => ({ rails: [{ slug: 'rentals', listings: ['a', 'b', 'c', 'd'].map(listing) }] }) }))
    expect(onAnswer).toHaveBeenCalledWith('rails')
  })
  it.each([
    ['nothing over the sparse floor', async () => ({ ok: true, json: async () => ({ rails: [{ slug: 'rentals', listings: [listing('a')] }] }) })],
    ['an empty list', async () => ({ ok: true, json: async () => ({ rails: [] }) })],
    ['a failed response', async () => ({ ok: false })],
    ['a dropped request', async () => { throw new Error('offline') }],
  ])('none: %s', async (_name, reply) => {
    const onAnswer = await answered(reply)
    expect(onAnswer).toHaveBeenCalledWith('none')
  })
  it('a filtered feed lets the place go, and clearing the filter brings the rails back', async () => {
    window.history.replaceState(null, '', '/?category=rentals')
    const onAnswer = await answered(async () => ({ ok: true, json: async () => ({ rails: [{ slug: 'rentals', listings: ['a', 'b', 'c', 'd'].map(listing) }] }) }))
    expect(onAnswer).toHaveBeenLastCalledWith('none')
    window.history.replaceState(null, '', '/')
    await act(async () => { window.dispatchEvent(new Event('eno:query')) })
    expect(onAnswer).toHaveBeenLastCalledWith('rails')
  })
  it('asks with a time limit: a hung request must not hold the place for good', async () => {
    const onAnswer = await answered(() => new Promise(() => {}))
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
    expect(onAnswer).not.toHaveBeenCalled()
  })
  it('a browser with no AbortSignal.timeout still asks, rather than throwing in the effect', async () => {
    const original = AbortSignal.timeout
    Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true, writable: true })
    try {
      const onAnswer = await answered(async () => ({ ok: true, json: async () => ({ rails: [] }) }))
      expect(onAnswer).toHaveBeenCalledWith('none')
    } finally { Object.defineProperty(AbortSignal, 'timeout', { value: original, configurable: true, writable: true }) }
  })
})

/**
 * The reader's language goes in the URL (audit api-08): without it the answer carried every card's title in nine
 * machine-translated languages to a reader who needs one, or none. From the URL, never a cookie: the answer is publicly cached.
 */
describe('CategoryRails asks in the reader’s language', () => {
  const four = { ok: true, json: async () => ({ rails: [{ slug: 'rentals', listings: ['a', 'b', 'c', 'd'].map(listing) }] }) }
  const urls = () => vi.mocked(fetch).mock.calls.map((c) => String(c[0]))
  /** The ONE mounted tree, re-rendered under another language: English ⇄ a machine-translated one switches in place, no reload. */
  const mounted = async (reply: () => Promise<unknown>) => {
    vi.stubGlobal('fetch', vi.fn(reply))
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
    const onAnswer = vi.fn()
    const tree = () => <CategoryRails categories={cats} onCategory={() => {}} onAnswer={onAnswer} />
    const { container, rerender } = render(tree())
    const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    await settle()
    return { onAnswer, container, switchTo: async (lang: string) => { h.lang = lang; rerender(tree()); await settle() } }
  }

  it.each(['en', 'vi', 'ko', 'zh-Hans'])('%s', async (lang) => {
    h.lang = lang
    await answered(async () => four)
    expect(urls()).toEqual([`/api/category-rails?lang=${lang}`])
  })

  it('a language switched in place asks again, in the new one', async () => {
    const { switchTo } = await mounted(async () => four)
    await switchTo('ko')
    expect(urls()).toEqual(['/api/category-rails?lang=en', '/api/category-rails?lang=ko'])
  })

  it.each([
    ['a failed response', async () => ({ ok: false })],
    ['a dropped request', async () => { throw new Error('offline') }],
  ])('a failed re-ask keeps the rails already shown: %s', async (_name, failure) => {
    let asked = 0
    const { onAnswer, container, switchTo } = await mounted(async () => (asked++ === 0 ? four : failure()))
    expect(onAnswer).toHaveBeenLastCalledWith('rails')
    await switchTo('ko')
    expect(asked).toBe(2)
    expect(onAnswer).not.toHaveBeenCalledWith('none')
    expect(container.querySelector('section')).not.toBeNull()
  })
})

/**
 * Home asks for the answer at its first idle moment after `load` and draws the rails only when the reader nears them (owner,
 * 2026-11-12: "from services downwards loads slow"). The first mount takes that answer instead of asking again; it is taken
 * ONCE, a failed one is not kept, and until there is an answer the caller's placeholder stands in the place.
 */
describe('CategoryRails takes an answer asked for early', () => {
  // The ask is ONE module-level slot: each test starts past both of its windows (repeat 1 min, max age 10 min), so no
  // earlier test's ask is reused. Only Date.now is moved — the settle below needs real timers.
  let clock = Date.now()
  const later = (ms: number) => { clock += ms }
  beforeEach(() => { later(11 * 60_000); vi.spyOn(Date, 'now').mockImplementation(() => clock) })
  afterEach(() => { vi.restoreAllMocks() })
  const four = { ok: true, json: async () => ({ rails: [{ slug: 'rentals', listings: ['a', 'b', 'c', 'd'].map(listing) }] }) }
  const stubs = () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  }
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  const mount = async () => {
    const onAnswer = vi.fn()
    const view = render(<CategoryRails categories={cats} onCategory={() => {}} onAnswer={onAnswer} fallback={<p data-testid="held" />} />)
    await settle()
    return { onAnswer, ...view }
  }

  it('the first mount uses the early answer and does not ask again; the next mount asks afresh', async () => {
    const { prefetchCategoryRails } = await import('./category-rails')
    stubs()
    vi.stubGlobal('fetch', vi.fn(async () => four))
    prefetchCategoryRails('en')
    prefetchCategoryRails('en') // asked twice before any mount: still one request
    expect(fetch).toHaveBeenCalledTimes(1)
    const first = await mount()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(first.onAnswer).toHaveBeenCalledWith('rails')
    cleanup()
    const second = await mount()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(second.onAnswer).toHaveBeenCalledWith('rails')
  })

  it('a failed early answer is dropped, so the mount asks again', async () => {
    const { prefetchCategoryRails } = await import('./category-rails')
    stubs()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue(four))
    prefetchCategoryRails('en')
    await settle()
    const { onAnswer } = await mount()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(onAnswer).toHaveBeenCalledWith('rails')
  })

  it('an early answer in another language is not taken', async () => {
    const { prefetchCategoryRails } = await import('./category-rails')
    stubs()
    vi.stubGlobal('fetch', vi.fn(async () => four))
    prefetchCategoryRails('vi')
    await mount() // h.lang is 'en'
    expect(vi.mocked(fetch).mock.calls.map((c) => String(c[0]))).toEqual(['/api/category-rails?lang=vi', '/api/category-rails?lang=en'])
    cleanup()
    h.lang = 'vi'
    await mount() // one slot: the en mount's ask replaced the unused vi one, so this asks afresh
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('a prefetch that fails while the mount waits on it is asked again, not shown as no rails', async () => {
    const { prefetchCategoryRails } = await import('./category-rails')
    stubs()
    let fail: (v: unknown) => void = () => {}
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise((r) => { fail = r })).mockResolvedValue(four))
    prefetchCategoryRails('en')
    const { onAnswer } = await mount() // takes the prefetch while it is still out
    expect(onAnswer).not.toHaveBeenCalled()
    await act(async () => { fail({ ok: false }); await new Promise((r) => setTimeout(r, 0)) })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(onAnswer).toHaveBeenCalledWith('rails')
    expect(onAnswer).not.toHaveBeenCalledWith('none')
  })

  it('a mount that asked first is not asked again by a prefetch a moment later', async () => {
    const { prefetchCategoryRails } = await import('./category-rails')
    stubs()
    vi.stubGlobal('fetch', vi.fn(async () => four))
    await mount()
    prefetchCategoryRails('en')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('an unused prefetch is renewed after a minute, and not shown after ten', async () => {
    const { prefetchCategoryRails } = await import('./category-rails')
    stubs()
    vi.stubGlobal('fetch', vi.fn(async () => four))
    prefetchCategoryRails('en')
    later(61_000)
    prefetchCategoryRails('en') // a return to Home: a fresh ask
    expect(fetch).toHaveBeenCalledTimes(2)
    later(11 * 60_000)
    await mount() // too old to show: the mount asks
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('shows the caller’s placeholder until the answer, then the rails in its place', async () => {
    stubs()
    let reply: (v: unknown) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => { reply = r })))
    const { queryByTestId, container } = await mount()
    expect(queryByTestId('held')).not.toBeNull()
    await act(async () => { reply(four); await new Promise((r) => setTimeout(r, 0)) })
    expect(queryByTestId('held')).toBeNull()
    expect(container.querySelector('section')).not.toBeNull()
  })

  it('no prefetch on a directed feed: the rails hide there, so nothing is asked', async () => {
    const { prefetchCategoryRails } = await import('./category-rails')
    window.history.replaceState(null, '', '/?q=iphone')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ rails: [] }) })))
    prefetchCategoryRails('en')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a filtered feed shows no placeholder while the answer is out', async () => {
    window.history.replaceState(null, '', '/?category=rentals')
    stubs()
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { queryByTestId } = await mount()
    expect(queryByTestId('held')).toBeNull()
  })
})
