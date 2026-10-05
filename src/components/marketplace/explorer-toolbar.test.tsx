// @vitest-environment jsdom
/**
 * UX3 NAV-4 and NAV-13 on the explorer's sticky strip (SortStrip) and the category rail:
 *   · NAV-4 — the phone "›" at a scrolling row's edge was a `pointer-events-none` plate that looked like a
 *     button, so a tap fell THROUGH to the pill or tile under it (measured: it opened the Price sheet; on
 *     production it switched the category to Mẹ & Bé → 0 results). It is a real 44px button now, named
 *     "More" / "Xem thêm", that scrolls its row by the desktop arrows' own step (85%).
 *   · NAV-13 — the desktop price SORT tab read "Price ⇅" beside the "Price ▾" FILTER; it now names the
 *     order it gives, "Price low → high" / "Price high → low" (and the salary twins over jobs).
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCategory } from '@/lib/types'

const h = vi.hoisted(() => {
  const language = { lang: 'en', t: (k: string) => k, tr: (en: string, vi?: string) => (h.vi ? vi ?? en : en), setLang: () => {} }
  const h = { vi: false, language }
  return h
})
vi.mock('@/context/language-context', () => ({
  useLanguage: () => h.language,
  useTr: (s: string) => s,
  Tr: ({ text }: { text?: string | null }) => <>{text}</>,
  LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import { SortStrip } from './explorer-toolbar'
import { CategoryRail } from './category-rail'

/** Every scroller overflows: 300px wide, 1000px of content — so each row has more to its right. */
let scrollBy: ReturnType<typeof vi.fn>
beforeEach(() => {
  h.vi = false
  scrollBy = vi.fn()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 300 })
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => 1000 })
  ;(HTMLElement.prototype as unknown as { scrollBy: unknown }).scrollBy = scrollBy
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (HTMLElement.prototype as unknown as { clientWidth?: unknown }).clientWidth
  delete (HTMLElement.prototype as unknown as { scrollWidth?: unknown }).scrollWidth
})

const strip = (sort: Parameters<typeof SortStrip>[0]['sort'], priceLabel: 'price' | 'salary' = 'price') => (
  <SortStrip sort={sort} onPickSort={() => {}} goodPrice={false} onGoodPrice={() => {}} headerHidden={false} priceLabel={priceLabel} leading={<div data-facet-pills="" />} />
)

describe('NAV-4: the phone "›" is a real button that scrolls its row', () => {
  it('on the sort/filter strip: named "More", a 44px target, and it pages the row by 85% (the desktop arrows\' step)', async () => {
    render(strip('newest'))
    const more = await screen.findByRole('button', { name: 'More' })
    expect(more.className).toContain('tap-44') // the IconButton's 44px hit area around the unchanged 32px disc
    expect(more.className).toContain('sm:hidden')
    expect(more.className).not.toContain('pointer-events-none')
    fireEvent.click(more)
    expect(scrollBy).toHaveBeenCalledWith({ left: 255, behavior: expect.any(String) })
  })

  it('on the category rail too (phone only: `pc:hidden`; the desktop keeps its own arrows)', async () => {
    const cats = [
      { id: 'c1', slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê', icon: 'home', verifiedCount: 5 },
      { id: 'c2', slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử', icon: 'tv', verifiedCount: 5 },
    ] as unknown as SerializedCategory[]
    render(<CategoryRail categories={cats} activeCategory="all" activeSubcategory="all" subcategoryCounts={{}} onCategory={() => {}} onSubcategory={() => {}} />)
    const more = await screen.findByRole('button', { name: 'More' })
    expect(more.className).toContain('pc:hidden')
    expect(more.className).toContain('tap-44')
    fireEvent.click(more)
    await waitFor(() => expect(scrollBy).toHaveBeenCalledWith({ left: 255, behavior: expect.any(String) }))
  })

  it('reads "Xem thêm" in Vietnamese', async () => {
    h.vi = true
    render(strip('newest'))
    expect(await screen.findByRole('button', { name: 'Xem thêm' })).toBeTruthy()
  })
})

describe('NAV-13: the price sort tab names the order it gives', () => {
  const tab = () => screen.getByRole('tab', { name: /price|giá/i })

  it('not sorting by price, or low → high: "Price low → high", spoken "Price: low to high"', () => {
    for (const sort of ['newest', 'price-low'] as const) {
      const view = render(strip(sort))
      expect(tab().textContent).toBe('Price low → high')
      expect(tab().getAttribute('aria-label')).toBe('Price: low to high')
      view.unmount()
    }
  })

  it('after the re-tap flip: "Price high → low"', () => {
    render(strip('price-high'))
    expect(tab().textContent).toBe('Price high → low')
    expect(tab().getAttribute('aria-label')).toBe('Price: high to low')
  })

  it('in Vietnamese, and over jobs as salary', () => {
    h.vi = true
    const view = render(strip('price-low'))
    expect(screen.getByRole('tab', { name: 'Giá: thấp đến cao' }).textContent).toBe('Giá thấp → cao')
    view.unmount()
    render(strip('price-high', 'salary'))
    expect(screen.getByRole('tab', { name: 'Lương: cao đến thấp' }).textContent).toBe('Lương cao → thấp')
  })
})
