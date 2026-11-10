// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { LanguageProvider, useLanguage } from '@/context/language-context'
import type { Language } from '@/lib/languages'

/**
 * A10-SOLD (2026-10-04): the sold page's "Similar items still available" rail. Below sm it sits ABOVE the
 * seller · category · Home buttons (sold-listing.tsx), so it holds its place while it loads — a rail
 * arriving from nothing pushed those buttons a card height down. The PDP's rail holds its place too.
 * "See all" keeps a Vietnamese reader in Vietnamese.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('./listing-card', () => ({ ListingCard: ({ listing }: { listing: { id: string } }) => <article data-card={listing.id} /> }))
vi.mock('next/link', () => ({
  default: ({ href, children, prefetch: _p, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => <a href={href} {...rest}>{children}</a>,
}))

import { RelatedListings } from './related-listings'

let answer: (body: unknown) => void
beforeEach(() => {
  // jsdom has no ResizeObserver; the shelf's scroll arrows (use-scroll-arrows.tsx) only need it to exist.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => {
    answer = (body) => resolve({ ok: true, json: () => Promise.resolve(body) })
  })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'languages')
})

function renderIn(lang: 'en' | 'vi', node: React.ReactNode) {
  Object.defineProperty(navigator, 'languages', { configurable: true, get: () => (lang === 'vi' ? ['vi-VN', 'vi'] : ['en-US', 'en']) })
  return render(<LanguageProvider initialLang={lang} initialViDict={{}}>{node}</LanguageProvider>)
}
const cards = (n: number) => ({ listings: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, sellerId: 's2' })) })

describe('RelatedListings', () => {
  it('sold: the shelf (title + card placeholders) holds its place until the answer lands, then the cards replace it', async () => {
    const { container } = renderIn('en', <RelatedListings listingId="l1" categorySlug="electronics" variant="sold" />)
    expect(container.querySelector('[data-related-loading]')).not.toBeNull()
    expect(screen.getByText('Similar items still available')).toBeTruthy()
    expect(container.querySelectorAll('[data-related-loading] .skeleton-photo').length).toBeGreaterThan(0)
    await act(async () => { answer(cards(9)) })
    expect(container.querySelector('[data-related-loading]')).toBeNull()
    expect(container.querySelectorAll('[data-card]')).toHaveLength(9)
  })

  it('sold: an empty answer collapses to nothing', async () => {
    const { container } = renderIn('en', <RelatedListings listingId="l1" categorySlug="electronics" variant="sold" />)
    // Category-only scope: one pass, and it comes back empty.
    await act(async () => { answer({ listings: [] }) })
    expect(container.querySelector('section')).toBeNull()
    expect(container.querySelector('[data-related-loading]')).toBeNull()
  })

  it('pdp: holds its place too: it sits right above the footer, which it threw 350px down (0.22 of CLS)', () => {
    const { container } = renderIn('en', <RelatedListings listingId="l1" categorySlug="electronics" />)
    expect(container.querySelector('[data-related-loading]')).not.toBeNull()
    expect(container.querySelectorAll('[data-related-loading] .skeleton-photo').length).toBeGreaterThan(0)
  })

  it('"See all" keeps a Vietnamese reader in Vietnamese on eno.vn (an English-pinned pilot path gets its /vi twin)', async () => {
    // The /vi pilot is a MARKETPLACE list (lang-pinned.ts VI_PILOT; this suite runs as services by default),
    // so the edition is switched and the modules re-imported — the provider too, for one context identity.
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
    vi.resetModules()
    try {
      const { RelatedListings: Rail } = await import('./related-listings')
      const { LanguageProvider: Provider } = await import('@/context/language-context')
      const at = (lang: 'en' | 'vi') => {
        Object.defineProperty(navigator, 'languages', { configurable: true, get: () => (lang === 'vi' ? ['vi-VN', 'vi'] : ['en-US', 'en']) })
        return render(<Provider initialLang={lang} initialViDict={{}}><Rail listingId="l1" categorySlug="furniture-appliances" variant="sold" /></Provider>)
      }
      expect(at('vi').container.querySelector('a[href="/vi/c/furniture-appliances"]')).not.toBeNull()
      cleanup()
      expect(at('en').container.querySelector('a[href="/c/furniture-appliances"]')).not.toBeNull()
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })
})

/**
 * R41 (2026-11-10): the passes were awaited one after another, and on an edge miss (the usual case) each held the
 * skeleton ~0.5 s. They are now asked at once and merged in pass order, so the rail must come out exactly as the
 * one-by-one loop built it, whatever order the answers arrive in.
 */
describe('RelatedListings — every pass asked at once, merged narrowest first', () => {
  // Each request waits until the test answers it, so the test chooses the order the answers arrive in.
  let pending: { url: string; signal?: AbortSignal; answer: (body: unknown) => void; fail: () => void }[]
  beforeEach(() => {
    pending = []
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => new Promise((resolve, reject) => {
      // The language context's own requests (a machine-translated dictionary) are not the rail's.
      if (!url.startsWith('/api/listings')) return
      const signal = init?.signal ?? undefined
      // As a real fetch does, a cancelled request rejects with an AbortError.
      signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
      pending.push({ url, signal, answer: (body) => resolve({ ok: true, json: () => Promise.resolve(body) }), fail: () => reject(new TypeError('offline')) })
    })))
  })
  afterEach(() => {
    // setLang writes the language cookies and localStorage; a later mount would read them back as the reader's choice.
    for (const c of document.cookie.split('; ')) if (c) document.cookie = `${c.split('=')[0]}=;path=/;max-age=0`
    try { localStorage.clear() } catch { /* no storage */ }
  })
  const rows = (prefix: string, n: number) => ({ listings: Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, sellerId: 's2' })) })
  const ids = (c: HTMLElement) => [...c.querySelectorAll('[data-card]')].map((e) => e.getAttribute('data-card'))
  const q = (u: string) => new URLSearchParams(u.slice(u.indexOf('?') + 1))
  const watch = <RelatedListings listingId="l1" categorySlug="electronics" subcategorySlug="smartwatches" brandSlug="samsung" />

  it('asks every scope before any has answered, each with facets=0 and the reader’s language', async () => {
    renderIn('vi', watch)
    await act(async () => {})
    expect(pending.map((p) => [q(p.url).get('subcategory'), q(p.url).get('brand')])).toEqual([
      ['smartwatches', 'samsung'],
      ['smartwatches', null],
      [null, null],
    ])
    for (const p of pending) {
      expect(q(p.url).get('facets'), p.url).toBe('0')
      expect(q(p.url).get('lang'), p.url).toBe('vi')
    }
  })

  it('the widest pass answering first changes nothing: the cards keep pass order, duplicates keep their narrow place', async () => {
    const { container } = renderIn('en', watch)
    await act(async () => {})
    const [brand, shelf, wide] = pending
    await act(async () => { wide.answer({ listings: [{ id: 'b0', sellerId: 's2' }, ...rows('w', 6).listings] }) })
    await act(async () => { shelf.answer(rows('s', 3)) })
    // Still waiting for the narrowest pass: nothing is shown out of order in the meantime.
    expect(container.querySelector('[data-related-loading]')).not.toBeNull()
    // The listing itself is never in its own rail.
    await act(async () => { brand.answer({ listings: [{ id: 'l1', sellerId: 's2' }, ...rows('b', 2).listings] }) })
    expect(ids(container)).toEqual(['b0', 'b1', 's0', 's1', 's2', 'w0', 'w1', 'w2', 'w3', 'w4'])
  })

  it('stops where the one-by-one rail stopped: a narrow pass with enough fills the rail without waiting for the rest', async () => {
    const { container } = renderIn('en', watch)
    await act(async () => {})
    const [brand, , wide] = pending
    await act(async () => { wide.answer(rows('w', 12)) })
    await act(async () => { brand.answer(rows('b', 8)) })
    // The shelf pass never answered, and the wide one's cards stay out, as they did when it was never asked.
    expect(ids(container)).toEqual(['b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'])
  })

  it('a failed pass is skipped and the passes either side of it still fill the rail', async () => {
    const { container } = renderIn('en', watch)
    await act(async () => {})
    const [brand, shelf, wide] = pending
    await act(async () => { shelf.fail() })
    await act(async () => { wide.answer(rows('w', 3)) })
    await act(async () => { brand.answer(rows('b', 2)) })
    expect(ids(container)).toEqual(['b0', 'b1', 'w0', 'w1', 'w2'])
    // The merge read every pass; its controller is released all the same.
    expect(pending.map((p) => p.signal?.aborted)).toEqual([true, true, true])
  })

  it('a first load on which every pass fails ends as the empty rail, not a skeleton that waits forever', async () => {
    const { container } = renderIn('en', watch)
    await act(async () => {})
    for (const p of pending) await act(async () => { p.fail() })
    expect(container.querySelector('[data-related-loading]')).toBeNull()
    expect(container.querySelector('section')).toBeNull()
  })

  it('a narrow pass that fills the rail cancels the wider requests it no longer needs', async () => {
    const { container } = renderIn('en', watch)
    await act(async () => {})
    const [brand, shelf, wide] = pending
    expect(pending.map((p) => p.signal?.aborted)).toEqual([false, false, false])
    await act(async () => { brand.answer(rows('b', 8)) })
    expect(ids(container)).toEqual(['b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'])
    expect(shelf.signal?.aborted).toBe(true)
    expect(wide.signal?.aborted).toBe(true)
  })

  it('unmounting cancels every request still out', async () => {
    const { unmount } = renderIn('en', watch)
    await act(async () => {})
    expect(pending).toHaveLength(3)
    unmount()
    expect(pending.map((p) => p.signal?.aborted)).toEqual([true, true, true])
  })

  let switchTo: (l: Language) => void = () => {}
  function Switch() {
    switchTo = useLanguage().setLang
    return null
  }

  it('a language switch on which every request fails keeps the cards already shown', async () => {
    const { container } = renderIn('en', <><Switch /><RelatedListings listingId="l1" categorySlug="electronics" subcategorySlug="smartwatches" brandSlug="samsung" /></>)
    await act(async () => {})
    await act(async () => { pending[0].answer(rows('e', 9)) })
    const shown = ids(container)
    expect(shown).toHaveLength(9)
    await act(async () => { switchTo('ko') })
    const korean = pending.slice(3)
    expect(korean.map((p) => q(p.url).get('lang'))).toEqual(['ko', 'ko', 'ko'])
    for (const p of korean) await act(async () => { p.fail() })
    expect(ids(container)).toEqual(shown)
  })

  it('a language switch answered with no rows is an answer: the rail empties', async () => {
    const { container } = renderIn('en', <><Switch /><RelatedListings listingId="l1" categorySlug="electronics" /></>)
    await act(async () => {})
    await act(async () => { pending[0].answer(rows('e', 9)) })
    await act(async () => { switchTo('ko') })
    await act(async () => { pending[1].answer({ listings: [] }) })
    expect(ids(container)).toEqual([])
    expect(container.querySelector('section')).toBeNull()
  })

  it('a different listing whose requests all fail does not keep the previous listing’s cards (commit-gate review)', async () => {
    // Keeping the cards is for the same question asked again (a language switch). Another listing is another question:
    // its failure must not leave the first listing's rail on screen.
    const wrap = (id: string) => <LanguageProvider initialLang="en" initialViDict={{}}><RelatedListings listingId={id} categorySlug="electronics" /></LanguageProvider>
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['en-US', 'en'] })
    const { container, rerender } = render(wrap('l1'))
    await act(async () => {})
    await act(async () => { pending[0].answer(rows('e', 9)) })
    expect(ids(container)).toHaveLength(9)
    await act(async () => { rerender(wrap('l2')) })
    expect(pending).toHaveLength(2)
    await act(async () => { pending[1].fail() })
    expect(ids(container)).toEqual([])
  })

  it('a language switched in place asks again in that language: the rows carry only the reader’s own titles', async () => {
    const { container } = renderIn('en', <><Switch /><RelatedListings listingId="l1" categorySlug="electronics" /></>)
    await act(async () => {})
    expect(pending.map((p) => q(p.url).get('lang'))).toEqual(['en'])
    await act(async () => { pending[0].answer(rows('e', 9)) })
    await act(async () => { switchTo('ko') })
    expect(pending.map((p) => q(p.url).get('lang'))).toEqual(['en', 'ko'])
    // The English cards stay up until the Korean ones land, then are replaced.
    expect(ids(container)).toHaveLength(9)
    await act(async () => { pending[1].answer(rows('k', 4)) })
    expect(ids(container)).toEqual(['k0', 'k1', 'k2', 'k3'])
  })
})
