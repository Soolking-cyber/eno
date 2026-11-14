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

  it('with the page\'s count, the row opens on "All N": this page, in the applied look, not a link (2026-11-06 audit)', () => {
    render(<JobCityChips cities={cities} total={15} />)
    const group = screen.getByRole('group', { name: 'By city:' })
    expect(within(group).getAllByRole('link')).toHaveLength(2)
    const all = group.querySelector('[aria-current="page"]')!
    expect(all.tagName).toBe('SPAN')
    expect(all.textContent).toBe('All15')
    expect(all.className).toMatch(/\bbg-foreground\b/) // the ink fill, the applied look since 2026-11-14 (owner-approved)
    // Right after the label, ahead of every city.
    expect(group.children[1]).toBe(all)
  })

  it('without it, the cities alone (nothing in the applied look)', () => {
    render(<JobCityChips cities={cities} />)
    expect(screen.getByRole('group', { name: 'By city:' }).querySelector('[aria-current]')).toBeNull()
  })
})

/**
 * ⛔ THE PHONE COPY (owner-approved 2026-11-14, cook r06 jobs — `variant="phone"`, under /c/jobs' heading line): the browse
 * chips in one swipe row that bleeds to the screen edges (the chip the edge clips is the cue); "By city:" is the group's name only (sr-only); the tap is
 * the row's hand-off, unchanged.
 */
describe('JobCityChips variant="phone"', () => {
  const cities = jobCityChips([{ city: 'Hồ Chí Minh', count: 9 }, { city: 'Hà Nội', count: 6 }])
  beforeEach(() => { sessionStorage.clear(); LANG = 'en' })
  afterEach(cleanup)

  it('the label names the group for a screen reader and prints nothing', () => {
    render(<JobCityChips cities={cities} total={54} variant="phone" />)
    const group = screen.getByRole('group', { name: 'By city:' })
    const label = document.getElementById(group.getAttribute('aria-labelledby')!)!
    expect(label.className).toBe('sr-only')
  })

  it('the browse chips: white with a line-strong ring, "All N" in the ink fill, the counts regular', () => {
    render(<JobCityChips cities={cities} total={54} variant="phone" />)
    const group = screen.getByRole('group')
    const all = group.querySelector('[aria-current="page"]')!
    expect(all.className.split(' ')).toEqual(expect.arrayContaining(['pill-on', 'bg-foreground', 'text-background', 'min-h-9', 'rounded-full', 'text-sm', 'font-bold']))
    for (const a of within(group).getAllByRole('link')) {
      expect(a.className.split(' ')).toEqual(expect.arrayContaining(['border', 'border-line-strong', 'bg-background', 'text-foreground', 'tap-44', 'shrink-0']))
      expect(a.className).not.toMatch(/\btext-xs\b/)
      expect(a.querySelector('span')!.className.split(' ')).toEqual(expect.arrayContaining(['font-normal', 'text-muted-foreground']))
    }
  })

  it('one swipe row that bleeds to the screen edges: one axis, the hit areas inside its clip, no touch-action, no fade', () => {
    render(<JobCityChips cities={cities} total={54} variant="phone" />)
    const cls = screen.getByRole('group').className.split(' ')
    // No `relative` on the row: it was the offsetParent of the whole-chip fit (useWholeChipRow), dropped in commit review —
    // the clipped chip at the edge stays the swipe cue (explorer-toolbar.tsx). Each chip carries its own (PILL_BOX's tap-44).
    expect(cls).toEqual(expect.arrayContaining(['-mx-3', 'px-3', 'scroll-px-3', 'py-1', 'flex-nowrap', 'overflow-x-auto', 'overflow-y-hidden', 'overscroll-x-contain', 'mt-3']))
    expect(cls.join(' ')).not.toMatch(/touch-|mask|fade|sm:/)
    for (const a of within(screen.getByRole('group')).getAllByRole('link')) expect(a.className.split(' ')).toContain('relative')
  })

  it('a tap still hands the province to the explorer', () => {
    render(<JobCityChips cities={cities} variant="phone" />)
    fireEvent.click(screen.getByRole('link', { name: /Hanoi/ }), { button: 0 })
    expect(JSON.parse(sessionStorage.getItem('eno:pending-area')!)).toMatchObject({ province: { code: '01' } })
  })

  it('the row copy takes the page\'s class (its `max-sm:hidden`) and keeps its look', () => {
    render(<JobCityChips cities={cities} total={54} className="max-sm:hidden" />)
    const cls = screen.getByRole('group').className.split(' ')
    expect(cls).toEqual(expect.arrayContaining(['max-sm:hidden', 'sm:flex-wrap', 'sm:mt-6']))
    expect(document.getElementById(screen.getByRole('group').getAttribute('aria-labelledby')!)!.className).not.toContain('sr-only')
  })
})
