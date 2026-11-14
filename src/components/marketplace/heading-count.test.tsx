// @vitest-environment jsdom
/**
 * /c/rentals' phone count at the end of the heading line (UI climb batch 93, owner decision 5, 2026-11-14 — heading-count.tsx).
 *
 * ⛔ THE SERVER'S HTML ALREADY SAYS IT, AND HYDRATION CHANGES NOTHING. The page renders <HeadingCount> from a seed (the
 * listings it rendered, the scope's total); SellerListings then publishes its own text. If the two ever disagreed on the
 * first render, the float would change width at hydration and the heading's ellipsis beside it would move — so the first
 * test renders the real pair to HTML, hydrates it, and asserts the same words before and after, in English and Vietnamese.
 * ⚠️ TRI-STATE: a published `null` hides the count and never falls back to the seed (codex, plan review round 4).
 */
import React, { act, useLayoutEffect } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot, type Root } from 'react-dom/client'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LanguageProvider } from '@/context/language-context'
import type { SerializedListingCard } from '@/lib/types'
import { HeadingCount, HeadingCountProvider, groupedIn, phoneCountText, useHeadingCount, usePublishHeadingCount } from './heading-count'
import { SellerListings } from './seller-listings'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rentals' }))
// The card itself is not under test and drags in images, links and contexts.
vi.mock('./listing-card', () => ({
  ListingCard: ({ listing }: { listing: SerializedListingCard }) => <article data-testid="card">{listing.title}</article>,
}))

const card = (id: string): SerializedListingCard =>
  ({ id, title: id, titleVi: null, price: 9_000_000, location: 'Ho Chi Minh City', district: 'District 1', postedAt: '2026-09-01T00:00:00.000Z', contactCount: 0 } as unknown as SerializedListingCard)
/** /c/rentals' first page: 48 homes of 5,344 (PAGE_SIZE and the homes total, as (index)/page.tsx hands them over). */
const PAGE = Array.from({ length: 48 }, (_, i) => card(`home-${i}`))
const TOTAL = 5344

beforeEach(() => {
  Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['en-US'] })
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'languages')
})

/** The page's pair, as (index)/page.tsx renders it: the seed from the same rows and the same total as `serverScope`. */
const pagePair = (lang: 'en' | 'vi') => (
  <LanguageProvider initialLang={lang} initialViDict={{}}>
    <HeadingCountProvider>
      <HeadingCount seed={{ shown: PAGE.length, total: TOTAL }} />
      <SellerListings
        listings={PAGE}
        sortable
        serverScope={{ params: { category: 'rentals', kind: 'places', homes: '1' }, total: TOTAL, pageSize: 48 }}
        phoneOneRow={{ chips: <a href="/c/rentals/go-vap" aria-label="Go Vap District" /> }}
      />
    </HeadingCountProvider>
  </LanguageProvider>
)

describe('HeadingCount on the server and at hydration', () => {
  it.each([['en', '48 of 5,344'], ['vi', '48/5.344 tin']] as const)('%s: the HTML carries "%s", the same words SellerListings announces, and hydration keeps them', async (lang, words) => {
    const html = renderToString(pagePair(lang))
    const el = document.createElement('div')
    el.innerHTML = html
    document.body.appendChild(el)
    const float = () => el.querySelector('[data-heading-count]')?.textContent
    const live = () => el.querySelector('p.sr-only[aria-live="polite"]')?.textContent
    expect(float()).toBe(words)
    // SellerListings' own first value (its announced copy is the same `countText` it publishes).
    expect(live()).toBe(words)

    const errors: unknown[] = []
    let root: Root | undefined
    await act(async () => {
      root = hydrateRoot(el, pagePair(lang), { onRecoverableError: (e) => errors.push(e) })
    })
    expect(errors).toEqual([])
    expect(float()).toBe(words)
    expect(live()).toBe(words)
    await act(async () => root!.unmount())
    el.remove()
  })

  it('the seed and SellerListings\' first count are one function of the same inputs, in both languages', () => {
    for (const lang of ['en', 'vi'] as const) {
      const tr = (en: string, vi?: string) => (lang === 'vi' && vi != null ? vi : en)
      const seed = phoneCountText(tr, groupedIn(lang), { awaiting: false, shown: 48, total: TOTAL })
      const out = renderToString(<LanguageProvider initialLang={lang} initialViDict={{}}><HeadingCount seed={{ shown: 48, total: TOTAL }} /></LanguageProvider>)
      expect(out).toContain(`>${seed}</span>`)
    }
  })
})

describe('phoneCountText (the words the sort row used to carry, unchanged)', () => {
  const en = (a: string) => a
  const vi = (_a: string, b?: string) => b ?? _a
  it('a page of the scope, all of it, one, and a query in flight', () => {
    expect(phoneCountText(en, groupedIn('en'), { awaiting: false, shown: 48, total: 5344 })).toBe('48 of 5,344')
    expect(phoneCountText(vi, groupedIn('vi'), { awaiting: false, shown: 48, total: 5344 })).toBe('48/5.344 tin')
    expect(phoneCountText(en, groupedIn('en'), { awaiting: false, shown: 7, total: 7 })).toBe('7 listings')
    expect(phoneCountText(en, groupedIn('en'), { awaiting: false, shown: 1, total: 1 })).toBe('1 listing')
    expect(phoneCountText(vi, groupedIn('vi'), { awaiting: false, shown: 1, total: 1 })).toBe('1 tin đăng')
    expect(phoneCountText(en, groupedIn('en'), { awaiting: true, shown: 0, total: 5344 })).toBe('Searching…')
    expect(phoneCountText(vi, groupedIn('vi'), { awaiting: true, shown: 0, total: 5344 })).toBe('Đang tìm…')
  })
})

describe('HeadingCount reads what is published', () => {
  function Publisher({ text }: { text: string | null | undefined }) {
    const publish = usePublishHeadingCount()
    useLayoutEffect(() => { if (text !== undefined) publish(text) }, [publish, text])
    return null
  }
  const tree = (text: string | null | undefined) => (
    <LanguageProvider initialLang="en" initialViDict={{}}>
      <HeadingCountProvider>
        <HeadingCount seed={{ shown: 48, total: TOTAL }} />
        <Publisher text={text} />
      </HeadingCountProvider>
    </LanguageProvider>
  )
  const float = () => document.querySelector('[data-heading-count]')

  it('nothing published yet: the seed', () => {
    render(tree(undefined))
    expect(float()?.textContent).toBe('48 of 5,344')
  })

  it('a published text replaces it; a published null hides it and never falls back to the seed', () => {
    const { rerender } = render(tree('96 of 5,344'))
    expect(float()?.textContent).toBe('96 of 5,344')
    rerender(tree(null))
    expect(float()).toBeNull()
  })

  it('the float: aria-hidden, at the line\'s right end, 12px body ink on the mock\'s 26px line, never wider than 40%', () => {
    render(tree(undefined))
    const el = float()!
    expect(el.tagName).toBe('SPAN')
    expect(el.getAttribute('aria-hidden')).toBe('true')
    expect(el.className.split(/\s+/)).toEqual(expect.arrayContaining(['float-right', 'ml-3', 'max-w-[40%]', 'truncate', 'text-xs', 'text-body', 'leading-[1.625rem]']))
  })

  it('outside a provider: the seed, and publishing is a no-op (no throw)', () => {
    function Probe() { return <output data-probe={String(useHeadingCount())} /> }
    render(
      <LanguageProvider initialLang="en" initialViDict={{}}>
        <HeadingCount seed={{ shown: 3, total: 3 }} />
        <Publisher text="ignored" />
        <Probe />
      </LanguageProvider>,
    )
    expect(float()?.textContent).toBe('3 listings')
    expect(document.querySelector('[data-probe]')!.getAttribute('data-probe')).toBe('undefined')
  })
})
