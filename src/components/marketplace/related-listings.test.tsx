// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'

/**
 * A10-SOLD (2026-10-04): the sold page's "Similar items still available" rail. Below sm it sits ABOVE the
 * seller · category · Home buttons (sold-listing.tsx), so it holds its place while it loads — a rail
 * arriving from nothing pushed those buttons a card height down. The PDP's rail is below the fold and
 * keeps its zero-size sentinel. "See all" keeps a Vietnamese reader in Vietnamese.
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

  it('pdp: no placeholder — the zero-size sentinel only, as before', () => {
    const { container } = renderIn('en', <RelatedListings listingId="l1" categorySlug="electronics" />)
    expect(container.querySelector('section')).toBeNull()
    expect(container.querySelector('div[aria-hidden="true"].absolute')).not.toBeNull()
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
