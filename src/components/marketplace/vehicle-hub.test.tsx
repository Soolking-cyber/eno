// @vitest-environment jsdom
/**
 * The motorbike hub's text when every bike is posted on eno by its shop (2026-11-04 on: Blvck Motorbike's 19, no
 * imported row) — the owner's SEO pass, 2026-11-15:
 *   · "Thuê theo tháng" was three lines of "hiện chưa có xe nào" and "thuê theo tháng — 0 xe" on a page whose title
 *     promises "theo ngày hoặc theo tháng": with no row PRICED by the month it is one sentence instead.
 *   · "re-checked against the sources every week" (and the two-sources double count, the dollar conversion) are the
 *     import's facts: with no linked row nothing is re-checked, so the page does not say it is.
 * And the imported state (a linked row, a month price) keeps every line it had.
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./seller-listings', () => ({ SellerListings: () => null }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'vi', tr: (en: string, vi?: string) => vi ?? en }),
}))
vi.mock('@/components/marketplace/localized-link', () => ({
  LocalizedLink: ({ href, children, prefetch: _p, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('./vehicle-hub-filter-row', () => ({ VehicleHubFilterRow: () => null }))
vi.mock('next/link', () => ({
  default: ({ href, children, prefetch: _p, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => <a href={href} {...rest}>{children}</a>,
}))

import { vehicleHubContent } from './vehicle-hub'
import { bikeCohorts, periodOf, transmissionOf, type HubRow } from '@/lib/vehicle-hub-stats'
import type { VehicleHubData } from '@/lib/vehicle-hubs'

afterEach(cleanup)

const row = (price: number, transmission: 'automatic' | 'manual', period: 'daily' | 'monthly' = 'daily'): HubRow => ({
  price, priceUnit: period === 'daily' ? 'VND/day' : 'VND/month', attributes: JSON.stringify({ rentalPeriod: period, transmission }), title: 'Honda Vision', district: 'Quận 1',
})

/** The counts exactly as loadVehicleHub makes them (src/lib/vehicle-hubs.ts): periodOf and transmissionOf. */
function hub(rows: HubRow[], linked: number): VehicleHubData {
  const counts: Record<string, number> = {}
  for (const p of ['daily', 'monthly'] as const) counts[p] = rows.filter((r) => periodOf(r) === p).length
  for (const t of ['automatic', 'manual'] as const) counts[t] = rows.filter((r) => transmissionOf(r) === t).length
  return {
    kind: 'motorbike', total: rows.length, cohorts: bikeCohorts(rows), counts, districts: [],
    sources: linked > 0 ? [{ name: 'Some Shop', count: rows.length, linkedCount: linked }] : [{ name: 'Blvck Motorbike', count: rows.length, linkedCount: 0 }],
    linked, lastChange: new Date('2026-11-04T05:00:00Z'), listings: [],
  }
}

/** Every section's text, the grid aside (its cards are SellerListings', mocked out here). */
function renderHub(data: VehicleHubData, lang: 'en' | 'vi') {
  const content = vehicleHubContent(data, lang, '2026-09-30')
  return render(<>{content.sections.map((s) => <section key={s.id}><h2>{s.title}</h2>{s.body}</section>)}</>).container
}
const pageText = (data: VehicleHubData, lang: 'en' | 'vi') => renderHub(data, lang).textContent ?? ''
/** The href of the link whose text is exactly `label`, or null. */
const linkTo = (root: HTMLElement, label: string) => [...root.querySelectorAll('a')].find((a) => a.textContent?.trim() === label)?.getAttribute('href') ?? null

const SHOP_POSTED = [row(100_000, 'manual'), row(100_000, 'manual'), row(150_000, 'automatic'), row(150_000, 'automatic'), row(300_000, 'automatic'), row(500_000, 'automatic')]

describe('motorbike hub, every bike posted by its shop', () => {
  it('says once, in Vietnamese, that no bike is priced by the month, and where long-rental rates are', () => {
    const t = pageText(hub(SHOP_POSTED, 0), 'vi')
    expect(t).not.toContain('hiện chưa có xe nào')
    expect(t).toContain('Thuê theo tháng: chưa xe nào ở đây niêm yết giá riêng theo tháng;')
    expect(t).not.toMatch(/[Tt]huê theo tháng\s*—/)
    // The day half of the period bullet keeps its filter link (commit-gate review).
    expect(t).toMatch(/Thuê theo ngày\s*— 6 xe\./)
    expect(t).not.toContain('giá ngày nhân ba mươi')
    // The day prices are still summarised.
    expect(t).toContain('Thuê theo ngày:')
  })

  it('never claims a weekly re-check, a second source or a dollar conversion it does not do', () => {
    for (const lang of ['vi', 'en'] as const) {
      const t = pageText(hub(SHOP_POSTED, 0), lang)
      expect(t).not.toMatch(/đối chiếu lại với các nguồn|re-checked against the sources/)
      expect(t).not.toMatch(/đếm hai lần|counted twice/)
      expect(t).not.toMatch(/đô la Mỹ|US dollars/)
      expect(t).toMatch(/Lần cập nhật gần nhất được ghi nhận|Most recent change recorded/)
    }
  })

  it('in English too: one month sentence, no "none listed"', () => {
    const t = pageText(hub(SHOP_POSTED, 0), 'en')
    expect(t).not.toContain('none listed right now')
    expect(t).toContain('By the month: no bike here is priced by the month yet;')
    expect(t).not.toMatch(/[Pp]riced by the month\s*—/)
    expect(t).toMatch(/Priced by the day\s*— 6 bikes\./)
  })
})

describe('motorbike hub with imported rows and month prices keeps its lines', () => {
  it('prints the month cohorts, the period bullet and the import facts', () => {
    const rows = [...SHOP_POSTED, row(2_000_000, 'automatic', 'monthly'), row(1_500_000, 'manual', 'monthly')]
    const t = pageText(hub(rows, rows.length), 'vi')
    expect(t).toContain('giá ngày nhân ba mươi')
    expect(t).toMatch(/thuê theo tháng\s*— 2 xe/)
    expect(t).toContain('Danh sách được đối chiếu lại với các nguồn mỗi tuần')
    expect(t).toContain('đếm hai lần')
    expect(t).toContain('đô la Mỹ')
    expect(t).not.toContain('chưa xe nào ở đây niêm yết giá riêng theo tháng')
  })
})

describe('the month sentence and the period bullet read one count', () => {
  it('a monthly-only hub shows the month link alone and never says none are priced by the month', () => {
    const rows = [row(2_000_000, 'automatic', 'monthly'), row(1_500_000, 'manual', 'monthly')]
    const t = pageText(hub(rows, 0), 'vi')
    expect(t).toMatch(/Thuê theo tháng\s*— 2 xe\./)
    expect(t).not.toMatch(/Thuê theo ngày\s*—/)
    expect(t).not.toContain('chưa xe nào ở đây niêm yết giá riêng theo tháng')
  })
  it('a month row the price summary cannot use still counts as priced by the month (no contradiction)', () => {
    // price 0: left out of the cohort's prices (summarize), but its period is still monthly.
    const rows = [...SHOP_POSTED, row(0, 'automatic', 'monthly')]
    const t = pageText(hub(rows, 0), 'en')
    expect(t).toMatch(/priced by the month\s*— 1 bike\./)
    expect(t).not.toContain('no bike here is priced by the month yet')
  })
})

describe('a partly imported hub and a monthly-only one', () => {
  it('says the weekly re-check of the reference listings only', () => {
    const t = pageText(hub(SHOP_POSTED, 2), 'en')
    expect(t).toContain('The reference listings are re-checked against their sources every week')
    expect(t).not.toContain('The list is re-checked against the sources every week')
  })
  it('a monthly-only hub prints no "By the day" block', () => {
    const rows = [row(2_000_000, 'automatic', 'monthly'), row(1_500_000, 'manual', 'monthly')]
    const t = pageText(hub(rows, 0), 'vi')
    expect(t).not.toContain('Thuê theo ngày:')
    expect(t).not.toContain('hiện chưa có xe nào')
  })
  it('a rentalPeriod that disagrees with the price unit follows rentalPeriod, as the loader does', () => {
    const odd: HubRow = { ...row(2_000_000, 'automatic', 'monthly'), priceUnit: 'VND/day' }
    const t = pageText(hub([...SHOP_POSTED, odd], 0), 'en')
    expect(t).toMatch(/priced by the month\s*— 1 bike\./)
    expect(t).not.toContain('no bike here is priced by the month yet')
    // bikeCohorts buckets by the same periodOf, so the month summary counts that row too (not "none listed").
    expect(t).toMatch(/By the month:\s*All bikes: only 1 listed/)
  })
  it('the period links keep their filters: Rentals › motorbikes, by the day or by the month', () => {
    const shop = renderHub(hub(SHOP_POSTED, 0), 'en')
    const day = linkTo(shop, 'Priced by the day')
    expect(day).toContain('subcategory=motorbike-rental')
    expect(day).toContain('attr_rentalPeriod=daily')
    expect(linkTo(shop, 'priced by the month')).toBeNull()
    cleanup()
    const both = renderHub(hub([...SHOP_POSTED, row(2_000_000, 'automatic', 'monthly')], 0), 'en')
    expect(linkTo(both, 'priced by the month')).toContain('attr_rentalPeriod=monthly')
    expect(linkTo(both, 'Priced by the day')).toContain('attr_rentalPeriod=daily')
  })
  it('every link into the filtered feed is nofollow (a query, canonical to its path; filter-link-rel.ts)', () => {
    const root = renderHub(hub([...SHOP_POSTED, row(2_000_000, 'automatic', 'monthly')], 0), 'en')
    const feed = [...root.querySelectorAll('a')].filter((a) => a.getAttribute('href')?.includes('?'))
    expect(feed.length).toBeGreaterThan(2)
    for (const a of feed) expect(a.getAttribute('rel'), a.getAttribute('href')!).toBe('nofollow')
  })
})
