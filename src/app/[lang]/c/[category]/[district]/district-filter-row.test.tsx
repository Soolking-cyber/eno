// @vitest-environment jsdom
/**
 * The district hub's filter row (rentals-03): Filters, Map and the bedroom chips at the top of
 * /c/<category>/<district>, every link scoped to the page (category, district, homes while the grid is
 * homes only) and in the reader's language (`/vi` on a Vietnamese page — A1-LANG).
 */
import React from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

let LANG = 'vi'
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: LANG, tr: (en: string, vi?: string) => (LANG === 'vi' && vi != null ? vi : en) }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, prefetch: _p, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('@/components/ui/icons', () => ({
  Map: (p: React.SVGProps<SVGSVGElement>) => <svg data-icon="map" {...p} />,
  SlidersHorizontal: (p: React.SVGProps<SVGSVGElement>) => <svg data-icon="sliders" {...p} />,
}))
// vitest runs as the SERVICES edition, where the `/vi` pilot is off; put the marketplace's lists in front.
vi.mock('@/lib/lang-pinned', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/lang-pinned')>()
  return { ...m, localizedHref: (href: string, variant: string) => m.localizedHref(href, variant, { live: m.VI_PREFIX_PATHS, retired: [] }) }
})

import { DistrictFilterRow } from './district-filter-row'

afterEach(() => { cleanup(); LANG = 'vi' })
const params = (a: HTMLElement) => {
  const href = a.getAttribute('href')!
  return { path: href.split('?')[0], q: Object.fromEntries(new URLSearchParams(href.split('?')[1] ?? '')) }
}

describe('DistrictFilterRow — the hub\'s way into the explorer, at the top', () => {
  it('a homes-only rentals hub in Vietnamese: Bộ lọc, Bản đồ and 1/2/3+ PN, all on /vi and scoped', () => {
    render(<DistrictFilterRow categorySlug="rentals" district="d2" homesOnly lang="vi" />)
    expect(params(screen.getByRole('link', { name: /Bộ lọc/ }))).toEqual({ path: '/vi', q: { category: 'rentals', district: 'd2', homes: '1' } })
    expect(params(screen.getByRole('link', { name: /Bản đồ/ }))).toEqual({ path: '/vi', q: { category: 'rentals', district: 'd2', homes: '1', view: 'map' } })
    // The label names its group for a screen reader: "1 PN" alone does not say it means apartments.
    const group = screen.getByRole('group', { name: 'Căn hộ:' })
    expect(within(group).getAllByRole('link')).toHaveLength(3)
    // Navigating chips are the canon's interactive chip (chipVariants on a <Link>), not a Badge.
    for (const a of within(group).getAllByRole('link')) expect(a.className).toMatch(/\brounded-full\b.*\bmin-h-8\b|\bmin-h-8\b.*\brounded-full\b/)
    const beds = ['1 PN', '2 PN', '3+ PN'].map((name) => params(screen.getByRole('link', { name })))
    expect(beds).toEqual(['1', '2', '3+'].map((n) => ({ path: '/vi', q: { category: 'rentals', district: 'd2', subcategory: 'apartment-rental', attr_bedrooms: n } })))
    for (const a of screen.getAllByRole('link')) {
      expect(a.getAttribute('rel')).toBe('nofollow')
    }
  })

  it('English stays on the plain explorer; without homes-only there are no bedroom chips', () => {
    LANG = 'en'
    render(<DistrictFilterRow categorySlug="rentals" district="thao-dien" homesOnly={false} lang="en" />)
    expect(params(screen.getByRole('link', { name: /Filters/ }))).toEqual({ path: '/', q: { category: 'rentals', district: 'thao-dien' } })
    expect(params(screen.getByRole('link', { name: /Map/ }))).toEqual({ path: '/', q: { category: 'rentals', district: 'thao-dien', view: 'map' } })
    expect(screen.queryByText('Apartments:')).toBeNull()
  })

  it('another category\'s district page gets Filters and Map, never apartment chips', () => {
    render(<DistrictFilterRow categorySlug="electronics" district="d1" homesOnly={false} lang="vi" />)
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })
})
