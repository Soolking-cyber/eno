// @vitest-environment jsdom
/**
 * /c's Map chip (UI climb 2026-11-09): in the "By area" row after "All", scoped like the district page's Map link — the
 * category, `homes=1` with the homes-only grid, `/vi` on a Vietnamese page — nofollow, and never on a category with no map.
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

let LANG = 'en'
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: LANG, tr: (en: string, vi?: string) => (LANG === 'vi' && vi != null ? vi : en) }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, prefetch, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => <a href={href} data-prefetch={String(prefetch)} {...rest}>{children}</a>,
}))
vi.mock('@/components/ui/icons', () => ({ Map: (p: React.SVGProps<SVGSVGElement>) => <svg data-icon="map" {...p} /> }))
// vitest runs as the SERVICES edition, where the `/vi` pilot is off; put the marketplace's lists in front.
vi.mock('@/lib/lang-pinned', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/lang-pinned')>()
  return { ...m, localizedHref: (href: string, variant: string) => m.localizedHref(href, variant, { live: m.VI_PREFIX_PATHS, retired: [] }) }
})

import { CategoryMapChip } from './category-map-chip'

afterEach(() => { cleanup(); LANG = 'en' })
const params = (a: HTMLElement) => {
  const href = a.getAttribute('href')!
  return { path: href.split('?')[0], q: Object.fromEntries(new URLSearchParams(href.split('?')[1] ?? '')) }
}

describe('CategoryMapChip', () => {
  it('/c/rentals with the homes-only grid: the rentals map, homes carried, nofollow, not prefetched', () => {
    render(<CategoryMapChip slug="rentals" homesOnly lang="en" />)
    const a = screen.getByRole('link', { name: /Map/ })
    expect(params(a)).toEqual({ path: '/', q: { category: 'rentals', homes: '1', view: 'map' } })
    expect(a.getAttribute('rel')).toBe('nofollow')
    expect(a.getAttribute('data-prefetch')).toBe('false')
    // Phones only: from sm the header's map button opens this category's map (header.tsx openMap).
    expect(a.className).toMatch(/(^|\s)sm:hidden(\s|$)/)
  })

  it('a Vietnamese page opens the /vi twin, labelled Bản đồ', () => {
    LANG = 'vi'
    render(<CategoryMapChip slug="furniture-appliances" homesOnly={false} lang="vi" />)
    expect(params(screen.getByRole('link', { name: /Bản đồ/ }))).toEqual({ path: '/vi', q: { category: 'furniture-appliances', view: 'map' } })
  })

  it('⛔ teachers have no map, so no chip', () => {
    const { container } = render(<CategoryMapChip slug="teachers" homesOnly={false} lang="en" />)
    expect(container.innerHTML).toBe('')
  })
})
