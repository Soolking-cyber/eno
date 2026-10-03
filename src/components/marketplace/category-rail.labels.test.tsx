// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

import { LanguageProvider } from '@/context/language-context'
import { CategoryRail } from './category-rail'

/**
 * ⛔ A CATEGORY TILE SHOWS THE ROW'S OWN VIETNAMESE, AND ASKS NO MACHINE FOR IT.
 *
 * The tile label took one string — the Vietnamese name for a Vietnamese reader — and ran it through
 * useTr, whose dictionary is keyed by English: "Cho thuê" and "Sách" were posted to /api/translate
 * on every vi home view, to come back unchanged (2026-09-29).
 */
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
HTMLElement.prototype.scrollTo = () => {}

type Cats = React.ComponentProps<typeof CategoryRail>['categories']
const CATS = [
  { id: 'rentals', slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê', icon: 'Home' },
  { id: 'books', slug: 'books', name: 'Books', nameVi: 'Sách', icon: 'Book' },
  // Not 'vehicles' since 2026-10-03: a retired shelf is not a tile (src/lib/retired-categories.ts).
  { id: 'electronics', slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử', icon: 'Smartphone' },
] as unknown as Cats

function renderIn(lang: 'en' | 'vi') {
  return render(
    <LanguageProvider initialLang={lang} initialViDict={{}}>
      <CategoryRail categories={CATS} activeCategory="all" activeSubcategory="all" subcategoryCounts={{}} onCategory={() => {}} onSubcategory={() => {}} />
    </LanguageProvider>,
  )
}
const tiles = (c: HTMLElement) => [...c.querySelectorAll('[data-cat]')].map((b) => b.textContent?.trim())

describe('<CategoryRail> tile labels', () => {
  it('a Vietnamese reader gets each row’s nameVi, with no request', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = renderIn('vi')
    expect(tiles(container)).toEqual(['Cho thuê', 'Sách', 'Điện tử'])
    await new Promise((r) => setTimeout(r, 120)) // past the batcher's 60ms window
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('an English reader gets the English names', () => {
    const { container } = renderIn('en')
    expect(tiles(container)).toEqual(['Rentals', 'Books', 'Electronics'])
  })
})
