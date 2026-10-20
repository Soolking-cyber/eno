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
  sources: [{ kind: 'import', name: 'Nhatot.com' }, { kind: 'partner', name: 'GoPlus' }, { kind: 'members' }],
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

/**
 * ⛔ OWNER DECISION 9's METHOD FIX (2026-10-20): the methodology names the SNAPSHOT's sources, not five portals in a
 * fixed sentence that went false on 16 October, and says in one dated line what changed that day.
 */
describe('the method names the snapshot\'s sources', () => {
  const sourceLine = (el: HTMLElement) =>
    [...el.querySelectorAll('p')].find((p) => /Sources in this snapshot|Nguồn của số liệu lần này/.test(p.textContent!))?.textContent ?? null

  it.each(['en', 'vi'] as const)('%s: names exactly the snapshot\'s sources, store names as stored', (lang) => {
    const line = sourceLine(html(lang, <Methodology index={index} locale={locale(lang)} snapshot="20 October 2026" />))
    expect(line).toBe(lang === 'vi'
      ? 'Nguồn của số liệu lần này: Nhatot.com (tin được nhập từ trang đó) · GoPlus (tin đăng của đối tác chính thức của eno.vn) · tin do thành viên eno.vn đăng. Số liệu luôn được gộp chung, không bao giờ tách theo nguồn.'
      : 'Sources in this snapshot: Nhatot.com (listings imported from that site) · GoPlus (an official eno.vn partner\'s own listings) · listings posted by eno.vn members. The figures are always pooled and never broken down by source.')
  })

  it.each(['en', 'vi'] as const)('%s: a partner with no stored name is still named a partner, never members', (lang) => {
    const nameless: RentIndex = { ...index, sources: [{ kind: 'partner', name: '' }] }
    const line = sourceLine(html(lang, <Methodology index={nameless} locale={locale(lang)} snapshot="20 October 2026" />))
    expect(line).toBe(lang === 'vi'
      ? 'Nguồn của số liệu lần này: tin đăng của đối tác chính thức của eno.vn. Số liệu luôn được gộp chung, không bao giờ tách theo nguồn.'
      : 'Sources in this snapshot: an official eno.vn partner\'s own listings. The figures are always pooled and never broken down by source.')
  })

  it('names no source the snapshot does not hold — the old five-portal sentence is gone', () => {
    const one: RentIndex = { ...index, sources: [{ kind: 'partner', name: 'GoPlus' }] }
    for (const lang of ['en', 'vi'] as const) {
      const line = sourceLine(html(lang, <Methodology index={one} locale={locale(lang)} snapshot="20 October 2026" />))!
      expect(line).toContain('GoPlus')
      expect(line).not.toMatch(/batdongsan|nhatot|muaban|rever|honeycomb|thành viên|members/i)
    }
    const text = html('en', <Methodology index={index} locale="en" snapshot="20 October 2026" />).textContent!
    expect(text).not.toContain('Compiled from public listings on Batdongsan, Nhatot, Muaban, Rever, Honeycomb')
  })

  it.each(['en', 'vi'] as const)('%s: with no snapshot, or nothing counted, it names no source and still says the figures are pooled', (lang) => {
    for (const idx of [null, { ...index, sources: [] }]) {
      const el = html(lang, <Methodology index={idx} locale={locale(lang)} snapshot={null} />)
      expect(sourceLine(el)).toBeNull()
      expect(el.textContent).toContain(lang === 'vi' ? 'Số liệu luôn được gộp chung, không bao giờ tách theo nguồn.' : 'The figures are always pooled and never broken down by source.')
    }
  })

  it.each(['en', 'vi'] as const)('%s: states the 16 and 20 October 2026 source changes in one line, beside the version', (lang) => {
    const items = [...html(lang, <Methodology index={index} locale={locale(lang)} snapshot="20 October 2026" />).querySelectorAll('li')]
      .map((li) => li.textContent!)
    const at = items.findIndex((t) => t.startsWith(lang === 'vi' ? 'Ngày 16/10/2026' : 'On 16 October 2026'))
    expect(at).toBeGreaterThan(0)
    expect(items[at - 1]).toContain(`${lang === 'vi' ? 'Quy tắc phiên bản' : 'Rules version'} ${RENT_INDEX_RULES_VERSION}.`)
    expect(items[at]).toContain(lang === 'vi'
      ? 'Số liệu trước mỗi mốc này không so sánh được với số liệu sau đó.'
      : 'Figures from before either date are not comparable with later ones.')
    // It names the storefronts as the code pins them: the four that stopped on 16 October, Nhatot.com (filtered that day,
    // gone on 20 October) and GoPlus (added on 20 October).
    for (const name of ['Batdongsan.com.vn', 'Muaban.net', 'Rever.vn', 'Honeycomb House', 'Nhatot.com', 'GoPlus']) expect(items[at]).toContain(name)
    // Word for word: WHAT happened is the claim — eno.vn STOPPED importing four sites and DROPPED Nhatot.com's company
    // ads. A flipped verb ("started importing") kept every name and the closing sentence, and passed (verify pass).
    expect(items[at]).toBe(lang === 'vi'
      ? 'Ngày 16/10/2026, nguồn dữ liệu đã thay đổi: eno.vn ngừng nhập tin từ Batdongsan.com.vn, Muaban.net, Rever.vn và Honeycomb House, đồng thời bỏ các tin trên Nhatot.com được đánh dấu là tin của doanh nghiệp. Ngày 20/10/2026, nguồn lại thay đổi: eno.vn ngừng đăng tin từ Nhatot.com và bổ sung tin đăng của GoPlus. Số liệu trước mỗi mốc này không so sánh được với số liệu sau đó.'
      : 'On 16 October 2026 the sources changed: eno.vn stopped importing listings from Batdongsan.com.vn, Muaban.net, Rever.vn and Honeycomb House, and dropped Nhatot.com listings flagged as company ads. On 20 October 2026 they changed again: eno.vn stopped listing homes from Nhatot.com and added GoPlus\'s own listings. Figures from before either date are not comparable with later ones.')
  })
})
