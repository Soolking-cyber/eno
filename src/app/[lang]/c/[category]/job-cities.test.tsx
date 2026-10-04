// @vitest-environment jsdom
/**
 * /c/jobs "By city" (rentals-11): one chip per province with its count, built from `Listing.city`, and a
 * tap that opens the jobs explorer already filtered to that province (the explorer's own consume-once
 * area hand-off — it has no `province` URL param).
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let LANG = 'en'
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: LANG, tr: (en: string, vi?: string) => (LANG === 'vi' && vi != null ? vi : en) }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, prefetch: _p, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => <a href={href} {...rest}>{children}</a>,
}))
// vitest runs as the SERVICES edition, where the `/vi` pilot is off; put the marketplace's lists in front.
vi.mock('@/lib/lang-pinned', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/lang-pinned')>()
  return { ...m, localizedHref: (href: string, variant: string) => m.localizedHref(href, variant, { live: m.VI_PREFIX_PATHS, retired: [] }) }
})

import { JOB_CITY_CHIPS, jobCityChips } from './job-cities'
import { JobCityChips } from './job-city-chips'

describe('jobCityChips — city groups to province chips', () => {
  it('merges the spellings of one place, keeps the filter\'s vn-units names, and orders by count', () => {
    const chips = jobCityChips([
      { city: 'Hà Nội', count: 4 },
      { city: 'Hồ Chí Minh', count: 9 },
      { city: 'Ha Noi', count: 2 }, // an English-typed row: the same province
      { city: 'Khánh Hòa', count: 1 }, // vn-units may spell it Hoà or Hòa — one place either way
      { city: 'Nowhere Town', count: 7 }, // not a province: dropped, never guessed
      { city: null, count: 3 },
    ])
    expect(chips.map((c) => [c.geo.code, c.count])).toEqual([['79', 9], ['01', 6], ['56', 1]])
    const hcm = chips[0]
    expect(hcm.geo).toEqual({ code: '79', name: 'Hồ Chí Minh', nameEn: 'Ho Chi Minh' })
    expect(hcm.label).toEqual({ en: 'Ho Chi Minh City', vi: 'Hồ Chí Minh' })
    expect(chips[1].label).toEqual({ en: 'Hanoi', vi: 'Hà Nội' })
  })

  it('caps the row', () => {
    const many = ['Hồ Chí Minh', 'Hà Nội', 'Đà Nẵng', 'Hải Phòng', 'Cần Thơ', 'Huế', 'Lâm Đồng', 'Gia Lai', 'Nghệ An', 'Đồng Nai']
    expect(jobCityChips(many.map((city, i) => ({ city, count: 20 - i })))).toHaveLength(JOB_CITY_CHIPS)
  })
})

describe('JobCityChips — "Theo tỉnh/thành / By city"', () => {
  const cities = jobCityChips([{ city: 'Hồ Chí Minh', count: 9 }, { city: 'Hà Nội', count: 6 }])

  beforeEach(() => { sessionStorage.clear(); LANG = 'en' })
  afterEach(cleanup)

  it('Vietnamese: the /vi jobs explorer, the label and the counts', () => {
    LANG = 'vi'
    render(<JobCityChips cities={cities} />)
    const group = screen.getByRole('group', { name: 'Theo tỉnh/thành:' })
    expect(within(group).getAllByRole('link')).toHaveLength(2)
    const hn = screen.getByRole('link', { name: /Hà Nội/ })
    expect(hn.className).toMatch(/\brounded-full\b/) // chipVariants on a <Link> — the canon's navigating chip
    expect(hn.getAttribute('href')).toBe('/vi?category=jobs')
    expect(hn.getAttribute('rel')).toBe('nofollow')
    expect(hn.textContent).toContain('6')
  })

  it('a tap leaves the province for the explorer to apply on mount — the shape header.tsx writes', () => {
    render(<JobCityChips cities={cities} />)
    const hcm = screen.getByRole('link', { name: /Ho Chi Minh City/ })
    expect(hcm.getAttribute('href')).toBe('/?category=jobs')
    fireEvent.click(hcm)
    expect(JSON.parse(sessionStorage.getItem('eno:pending-area')!)).toEqual({
      province: { code: '79', name: 'Hồ Chí Minh', nameEn: 'Ho Chi Minh' }, ward: null, nearby: null,
    })
  })

  it('a modified click (new tab) leaves nothing behind in this tab', () => {
    render(<JobCityChips cities={cities} />)
    fireEvent.click(screen.getByRole('link', { name: /Hanoi/ }), { metaKey: true })
    fireEvent.click(screen.getByRole('link', { name: /Hanoi/ }), { ctrlKey: true })
    expect(sessionStorage.getItem('eno:pending-area')).toBeNull()
  })
})
