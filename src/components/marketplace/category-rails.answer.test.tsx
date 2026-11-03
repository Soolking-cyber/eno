// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCategory } from '@/lib/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }))
vi.mock('./listing-card', () => ({ ListingCard: () => null }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en, t: (en: string) => en }) }))

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

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })

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
