// @vitest-environment jsdom
/**
 * NAV-9 (UX3, 2026-10-05): the vehicle hubs' filter row — Filters, Map and the type chips under the lede of
 * /motorbike-rental-ho-chi-minh-city, /thue-xe-may-tphcm, /car-rental-ho-chi-minh-city and
 * /thue-xe-tu-lai-tphcm (nav audit N9: the first filter was at y≈4,433). Every link scoped to Rentals › the
 * hub's subcategory, in the page's language (`/vi` on a Vietnamese hub), Ho Chi Minh City handed to the
 * explorer on a plain click; no "Theo ngày / tuần / tháng" chips (plan rev 2).
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

import { HCMC_PROVINCE_CODE, VehicleHubFilterRow } from './vehicle-hub-filter-row'
import { provinceByCode } from '@/lib/vn-areas'
import { hubTypeChips } from '@/lib/vehicle-hub-chips'

afterEach(() => { cleanup(); LANG = 'vi'; sessionStorage.clear() })
const params = (a: HTMLElement) => {
  const href = a.getAttribute('href')!
  return { path: href.split('?')[0], q: Object.fromEntries(new URLSearchParams(href.split('?')[1] ?? '')) }
}
const BIKE = { category: 'rentals', subcategory: 'motorbike-rental', province: '79' }

describe('VehicleHubFilterRow — the hub\'s way into the explorer, under the lede', () => {
  it('the Vietnamese motorbike hub: Bộ lọc, Bản đồ and Loại xe: Xe ga · Xe số, all on /vi and scoped', () => {
    const { facet, types } = hubTypeChips({ kind: 'motorbike', counts: { automatic: 180, manual: 52 } })
    render(<VehicleHubFilterRow kind="motorbike" facet={facet} types={types} lang="vi" />)
    expect(params(screen.getByRole('link', { name: /Bộ lọc/ }))).toEqual({ path: '/vi', q: BIKE })
    expect(params(screen.getByRole('link', { name: /Bản đồ/ }))).toEqual({ path: '/vi', q: { ...BIKE, view: 'map' } })
    const group = screen.getByRole('group', { name: 'Loại xe:' })
    expect(within(group).getAllByRole('link').map((a) => [a.textContent, params(a)])).toEqual([
      ['Xe ga', { path: '/vi', q: { ...BIKE, attr_transmission: 'automatic' } }],
      ['Xe số', { path: '/vi', q: { ...BIKE, attr_transmission: 'manual' } }],
    ])
    // Navigating chips are the canon's interactive chip (chipVariants on a <Link>), not a Badge.
    for (const a of within(group).getAllByRole('link')) expect(a.className).toMatch(/\brounded-full\b/)
    for (const a of screen.getAllByRole('link')) expect(a.getAttribute('rel')).toBe('nofollow')
  })

  it('no rental-period chips — "Theo tuần" means "priced per week" today (N17, undecided)', () => {
    const { facet, types } = hubTypeChips({ kind: 'motorbike', counts: { automatic: 1, manual: 1, daily: 9, monthly: 9 } })
    render(<VehicleHubFilterRow kind="motorbike" facet={facet} types={types} lang="vi" />)
    expect(screen.queryByText(/Theo (ngày|tuần|tháng)/)).toBeNull()
    for (const a of screen.getAllByRole('link')) expect(a.getAttribute('href')).not.toContain('rentalPeriod')
  })

  it('the English car hub stays on the plain explorer and offers the seats its cars have', () => {
    LANG = 'en'
    const { facet, types } = hubTypeChips({ kind: 'car', counts: { 'seats-4': 3, 'seats-7': 2 } })
    render(<VehicleHubFilterRow kind="car" facet={facet} types={types} lang="en" />)
    const CAR = { category: 'rentals', subcategory: 'car-rental', province: '79' }
    expect(params(screen.getByRole('link', { name: /Filters/ }))).toEqual({ path: '/', q: CAR })
    expect(params(screen.getByRole('link', { name: /Map/ }))).toEqual({ path: '/', q: { ...CAR, view: 'map' } })
    const group = screen.getByRole('group', { name: 'Type:' })
    expect(within(group).getAllByRole('link').map((a) => [a.textContent, params(a).q.attr_seats])).toEqual([['4 seats', '4'], ['7 seats', '7']])
  })

  it('without a type the data supports, the row is Filters and Map only', () => {
    render(<VehicleHubFilterRow kind="car" facet="seats" types={[]} lang="vi" />)
    expect(screen.getAllByRole('link')).toHaveLength(2)
    expect(screen.queryByRole('group')).toBeNull()
  })

  it('no click writes an area hand-off — the scope lives in the URL (codex + opus, gate 2026-10-05)', () => {
    render(<VehicleHubFilterRow kind="motorbike" facet="transmission" types={[{ value: 'automatic', en: 'Automatic', vi: 'Xe ga' }]} lang="vi" />)
    sessionStorage.clear()
    for (const name of [/Bộ lọc/, /Bản đồ/, 'Xe ga']) fireEvent.click(screen.getByRole('link', { name }))
    expect(sessionStorage.getItem('eno:pending-area')).toBeNull()
  })
})

describe('the hubs\' province code', () => {
  it('is Ho Chi Minh City in the area data the explorer reads it with — not a number that only matches itself', () => {
    expect(provinceByCode(HCMC_PROVINCE_CODE)).toMatchObject({ code: '79', name: 'Hồ Chí Minh' })
  })
})
