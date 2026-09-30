// @vitest-environment jsdom
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { LanguageProvider } from '@/context/language-context'
import { DistrictRent } from './district-rent'
import type { RentCell } from '@/lib/district-rent-cells'

/** SEO wave B, D2: the rent block — CS-2 D2-1…D2-13 in both languages, the cells it is given, no clock. */
const cells: RentCell[] = [
  { kind: 'br1', median: 7_480_000, n: 479 },
  { kind: 'br2', median: 16_000_000, n: 745 },
  { kind: 'br3plus', median: 26_000_000, n: 476 },
  { kind: 'house', median: 50_000_000, n: 277 },
  { kind: 'room', median: 4_000_000, n: 196 },
]
const D7 = { en: 'District 7 (Phu My Hung)', vi: 'Quận 7 (Phú Mỹ Hưng)' }
const asOf = { en: '30 Sep 2026', vi: '30/9/2026' }
const render = (lang: 'en' | 'vi', slug = 'd7', c = cells) => {
  const el = document.createElement('div')
  el.innerHTML = renderToString(
    <LanguageProvider initialLang={lang} initialViDict={{}}>
      <DistrictRent place={D7} slug={slug} cells={c} asOf={asOf} />
    </LanguageProvider>,
  )
  return el
}
const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

describe('DistrictRent', () => {
  it('English: heading, one figure per cell rounded for display, count, footnote with the date, link', () => {
    const el = render('en')
    expect(el.querySelector('h2')!.textContent).toBe('Median asking rent in District 7 (Phu My Hung)')
    expect([...el.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['1-bedroom apartments', '2-bedroom apartments', 'Apartments, 3+ bedrooms', 'Houses', 'Rooms'])
    const t = text(el)
    const dd = (i: number) => [...el.querySelectorAll('dd')][i].querySelectorAll('span')
    expect([...dd(0)].map((x) => x.textContent)).toEqual(['7,500,000 đ', 'per month', '479 listings'])
    expect(t).toContain('Asking prices from live listings, not signed rents. As of 30 Sep 2026.')
    expect(el.querySelector('a')!.getAttribute('href')).toBe('/hcmc-rent-index')
    expect(el.querySelector('a')!.textContent).toContain('How these figures are calculated, and every district')
  })
  it('Vietnamese: the index\'s own words and dot grouping', () => {
    const el = render('vi')
    expect(el.querySelector('h2')!.textContent).toBe('Giá thuê chào trung vị tại Quận 7 (Phú Mỹ Hưng)')
    expect([...el.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['Căn hộ 1 phòng ngủ', 'Căn hộ 2 phòng ngủ', 'Căn hộ từ 3 phòng ngủ', 'Nhà nguyên căn', 'Phòng trọ'])
    const t = text(el)
    expect([...[...el.querySelectorAll('dd')][0].querySelectorAll('span')].map((x) => x.textContent)).toEqual(['7.500.000 đ', 'mỗi tháng', '479 tin'])
    expect(t).toContain('Giá chào từ các tin đang đăng, không phải giá thuê đã ký. Số liệu ngày 30/9/2026.')
    expect(t).toContain('Cách tính và số liệu của mọi quận')
  })
  it.each(['en', 'vi'] as const)('%s: the District 2 / 9 and Thu Duc notes', (lang) => {
    expect(text(render(lang, 'd2'))).toContain(lang === 'vi' ? 'Các tin ghi Quận 2. Các tin này cũng được tính trong TP Thủ Đức.' : 'Listings labelled District 2. They are also counted in Thu Duc City.')
    expect(text(render(lang, 'd9'))).toContain(lang === 'vi' ? 'Các tin ghi Quận 9.' : 'Listings labelled District 9.')
    expect(text(render(lang, 'thu-duc'))).toContain(lang === 'vi' ? 'Toàn bộ TP Thủ Đức, gồm cả các tin vẫn ghi Quận 2 hoặc Quận 9' : 'All of Thu Duc City, including listings still labelled District 2 or 9')
    expect(text(render(lang, 'd7'))).not.toMatch(/Thu Duc|Thủ Đức/)
  })
  it('the all-sizes label, and nothing with no cell', () => {
    expect(render('en', 'd7', [{ kind: 'apartment', median: 9_000_000, n: 40 }]).querySelector('dt')!.textContent).toBe('Apartments, all sizes')
    expect(render('en', 'd7', []).innerHTML).toBe('')
  })
  it('has no clock and no use() — the server formats the date', () => {
    const src = readFileSync('src/app/[lang]/c/[category]/[district]/district-rent.tsx', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(src).not.toMatch(/\buse\(|new Date|Date\.now|toLocale/)
  })
})
