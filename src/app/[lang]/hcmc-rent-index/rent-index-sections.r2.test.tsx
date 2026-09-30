// @vitest-environment jsdom
import * as React from 'react'
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { LanguageProvider } from '@/context/language-context'
import {
  APARTMENT_BANDS, DISPLAY_STEP_VND, MIN_CELL_N, RENT_INDEX_RULES_VERSION, RENT_TYPES, ROUND_VND,
  type DistrictRow, type RentIndex, type Stats,
} from '@/lib/rent-index'
import { formatMoneyFull } from '@/lib/vnd'
import { BedroomTable, Headline, Methodology } from './rent-index-sections'

/**
 * SEO wave B, R2: the rent-index page publishes rules v3 — the bedroom bands (city-wide row and a
 * district table), the `commercial` exclusion, and the v3 method — in English and in CS-2's approved
 * Vietnamese (2026-09-30).
 */
const empty: Stats = { n: 0, median: null, p25: null, p75: null, nArea: 0, medianPerM2: null }
const pub = (n: number, median: number): Stats => ({ n, median, p25: median - 1_000_000, p75: median + 1_000_000, nArea: 0, medianPerM2: null })
const bands = (b: Partial<Record<(typeof APARTMENT_BANDS)[number], Stats>>) =>
  Object.fromEntries(APARTMENT_BANDS.map((k) => [k, b[k] ?? empty])) as DistrictRow['bands']
const district = (slug: string, name: string, nameEn: string, b: DistrictRow['bands']): DistrictRow => ({
  slug, name, nameEn, partOf: null, total: 50,
  cells: Object.fromEntries(RENT_TYPES.map((t) => [t, empty])) as DistrictRow['cells'],
  bands: b,
})
const index: RentIndex = {
  rulesVersion: RENT_INDEX_RULES_VERSION,
  computedAt: '2026-09-30T00:00:00.000Z',
  read: 100,
  used: 80,
  excluded: { notResidential: 1, notForRent: 2, currency: 3, unit: 4, belowBand: 5, aboveBand: 6, commercial: 777, crossPosted: 8 },
  cityWide: Object.fromEntries(RENT_TYPES.map((t) => [t, empty])) as RentIndex['cityWide'],
  cityBands: bands({ br1: pub(400, 8_600_000), br2: pub(120, 31_000_000), br3plus: { ...empty, n: MIN_CELL_N - 1 } }),
  districts: [
    // d1: one band at the threshold, one just under it, one empty.
    district('d1', 'Quận 1', 'District 1', bands({ br1: pub(MIN_CELL_N, 8_600_000), br2: { ...empty, n: MIN_CELL_N - 1 } })),
    // can-gio: no banded apartment at all — its row is left out.
    district('can-gio', 'Cần Giờ', 'Can Gio District', bands({})),
  ],
  unassigned: 0,
}

const html = (lang: 'en' | 'vi', node: React.ReactNode) => {
  const el = document.createElement('div')
  el.innerHTML = renderToString(
    <LanguageProvider initialLang={lang} initialViDict={{}}>{node}</LanguageProvider>,
  )
  return el
}
const locale = (lang: 'en' | 'vi') => (lang === 'vi' ? 'vi' : 'en') as 'en' | 'vi'

describe('the bedroom table', () => {
  it.each(['en', 'vi'] as const)('%s: publishes only cells with n ≥ MIN_CELL_N, and skips districts with no banded apartment', (lang) => {
    const el = html(lang, <BedroomTable index={index} lang={lang} locale={locale(lang)} />)
    const rows = [...el.querySelectorAll('tbody tr')]
    expect(rows.map((r) => r.querySelector('th')!.textContent)).toEqual([lang === 'vi' ? 'Quận 1' : 'District 1'])
    const cells = [...rows[0].querySelectorAll('td')]
    expect(cells).toHaveLength(APARTMENT_BANDS.length)
    // br1 at the threshold publishes; br2 under it and br3plus empty print the dash.
    expect(cells[0].textContent).toContain(formatMoneyFull(8_600_000, '₫', locale(lang)))
    expect(cells[1].textContent).toContain('—')
    expect(cells[2].textContent).toContain('—')
    expect(cells[1].textContent).not.toMatch(/\d{1,3}[.,]\d{3}[.,]\d{3}/)
  })

  it('never prints a median under the threshold, even when the snapshot carries one', () => {
    const odd: RentIndex = { ...index, districts: [district('d1', 'Quận 1', 'District 1', bands({ br1: pub(MIN_CELL_N - 1, 9_900_000), br2: pub(MIN_CELL_N, 8_600_000) }))] }
    const cells = [...html('en', <BedroomTable index={odd} lang="en" locale="en" />).querySelectorAll('tbody td')]
    expect(cells[0].textContent).toContain('—')
    expect(cells[0].textContent).not.toContain('9,900,000')
    expect(cells[1].textContent).toContain('8,600,000')
    const head = html('en', <Headline index={{ ...index, cityBands: bands({ br1: pub(MIN_CELL_N - 1, 9_900_000) }) }} locale="en" />)
    expect(head.textContent).not.toContain('9,900,000')
  })

  it('notes the Thu Duc overlap on the bedroom table too', () => {
    const tt: RentIndex = { ...index, districts: [
      district('thu-duc', 'TP Thủ Đức', 'Thu Duc City', bands({ br1: pub(20, 8_000_000) })),
      { ...district('d2', 'Quận 2 (Thủ Đức)', 'District 2 (Thu Duc)', bands({ br1: pub(12, 9_000_000) })), partOf: 'thu-duc' },
    ] }
    const t = html('en', <BedroomTable index={tt} lang="en" locale="en" />).textContent!
    expect(t).toContain('All of Thu Duc City, including listings still labelled District 2 or 9')
    expect(t).toContain('also counted in Thu Duc City')
  })

  it.each(['en', 'vi'] as const)('%s: names no source', (lang) => {
    const el = html(lang, <BedroomTable index={index} lang={lang} locale={locale(lang)} />)
    expect(el.textContent).not.toMatch(/batdongsan|nhatot|chợ tốt|cho tot|muaban|rever|honeycomb/i)
  })

  it('renders CS-2 copy in both languages', () => {
    expect(html('en', <BedroomTable index={index} lang="en" locale="en" />).textContent)
      .toContain('Apartment rent by bedrooms and district')
    const vi = html('vi', <BedroomTable index={index} lang="vi" locale="vi" />).textContent!
    expect(vi).toContain('Giá thuê căn hộ theo số phòng ngủ và theo quận')
    expect(vi).toContain('Dấu gạch nghĩa là số tin chưa đạt ngưỡng công bố.')
    expect(vi).toContain('Từ 3 phòng ngủ')
  })

  it('renders nothing when no district has a banded apartment', () => {
    const none = { ...index, districts: [index.districts[1]] }
    expect(renderToString(<LanguageProvider initialLang="en" initialViDict={{}}><BedroomTable index={none} lang="en" locale="en" /></LanguageProvider>)).toBe('')
  })
})

describe('the city-wide band row', () => {
  it.each(['en', 'vi'] as const)('%s: follows the type row, one figure per band', (lang) => {
    const el = html(lang, <Headline index={index} locale={locale(lang)} />)
    const text = el.textContent!
    expect(text).toContain(lang === 'vi' ? 'Căn hộ theo số phòng ngủ' : 'Apartments by number of bedrooms')
    expect(text).toContain(formatMoneyFull(8_600_000, '₫', locale(lang)))
    expect(text).toContain(formatMoneyFull(31_000_000, '₫', locale(lang)))
    expect(text).toContain(lang === 'vi' ? '2 phòng ngủ' : '2 bedrooms')
  })
})

describe('the city-wide band row, empty', () => {
  it('is left out when no apartment carries a bedroom count', () => {
    const t = html('en', <Headline index={{ ...index, cityBands: bands({}) }} locale="en" />).textContent!
    expect(t).not.toContain('Apartments by number of bedrooms')
  })
})

describe('the v3 method', () => {
  it.each(['en', 'vi'] as const)('%s: lists the commercial exclusion with its count, and renders the version and steps from the constants', (lang) => {
    const el = html(lang, <Methodology index={index} locale={locale(lang)} snapshot="30 September 2026" />)
    const text = el.textContent!
    const commercial = [...el.querySelectorAll('li')].find((li) => li.textContent!.startsWith('777'))
    expect(commercial?.textContent).toContain(lang === 'vi' ? 'Nhà không ghi số phòng ngủ (xem là mặt bằng kinh doanh)' : 'A house with no bedroom count (counted as commercial)')
    expect(text).toContain(`${lang === 'vi' ? 'Quy tắc phiên bản' : 'Rules version'} ${RENT_INDEX_RULES_VERSION}.`)
    expect(text).toContain(formatMoneyFull(DISPLAY_STEP_VND, '₫', locale(lang)))
    expect(text).toContain(formatMoneyFull(ROUND_VND, '₫', locale(lang)))
    expect(text).toContain(lang === 'vi'
      ? 'Căn hộ dịch vụ và căn hộ mini được tính là căn hộ, theo số phòng ngủ.'
      : 'Serviced and mini apartments count as apartments, in their bedroom band.')
    // v2's exact-match cross-post rule is gone from the page.
    expect(text).not.toMatch(/same district, price and floor area/)
  })

  it('types no rule number into the copy', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/app/[lang]/hcmc-rent-index/rent-index-sections.tsx', 'utf8')
    expect(src).not.toMatch(/(?:en|vi)="[^"]*(?:version|phiên bản) \d/)
    expect(src).not.toMatch(/(?:en|vi)="[^"]*\d{1,3}[.,]000/)
  })
})
