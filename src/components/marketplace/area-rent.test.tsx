// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { LanguageProvider, type Language } from '@/context/language-context'
import { formatCalendarDay } from '@/lib/calendar-day'
import type { AreaRent as AreaRentData } from '@/lib/area-rent'
import { AreaRent } from './area-rent'

/**
 * <AreaRent> — the words of the area rent line, as the SERVER renders them (renderToStaticMarkup): Google reads this HTML
 * without running JavaScript, so the line must be in it.
 */
const RENT: AreaRentData = {
  kind: 'studio', place: { en: 'Go Vap District', vi: 'Gò Vấp' }, low: 4_200_000, high: 4_700_000, n: 1154, position: 'below', asOf: '2026-11-19T00:49:00.000Z',
}

function html(lang: Language, rent: AreaRentData = RENT) {
  return renderToStaticMarkup(<LanguageProvider initialLang={lang} initialViDict={{}}><AreaRent rent={rent} /></LanguageProvider>)
}
const text = (h: string) => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')

describe('the area rent line, in the server HTML', () => {
  it('English: the cell, its range a month, the verdict, the index, its count and date', () => {
    const t = text(html('en'))
    expect(t).toContain('Typical rent for a studio in Go Vap District: 4.2M – 4.7M a month. This rent is below the typical range.')
    expect(t).toContain(`HCMC Rent Index · asking rents of 1,154 listings, ${formatCalendarDay(RENT.asOf, 'en')}`)
  })

  it('Vietnamese: the same, in the index\'s own words and the Vietnamese place name', () => {
    const t = text(html('vi'))
    expect(t).toContain('Giá thuê phổ biến cho studio tại Gò Vấp: 4,2tr – 4,7tr mỗi tháng. Giá thuê này thấp hơn mức phổ biến.')
    expect(t).toContain(`Chỉ số giá thuê nhà TP.HCM · giá chào thuê của 1.154 tin, ngày ${formatCalendarDay(RENT.asOf, 'vi')}`)
  })

  it('links the rent index', () => {
    expect(html('en')).toContain('href="/hcmc-rent-index"')
  })

  it.each([
    ['within', 'This rent is within the typical range.'],
    ['above', 'This rent is above the typical range.'],
  ] as const)('position %s reads "%s"', (position, words) => {
    expect(text(html('en', { ...RENT, position }))).toContain(words)
  })

  it.each([
    ['br2', 'a 2-bedroom apartment', 'căn hộ 2 phòng ngủ'],
    ['br3plus', 'an apartment with 3+ bedrooms', 'căn hộ từ 3 phòng ngủ'],
    ['apartment', 'an apartment', 'căn hộ'],
    ['house', 'a house', 'nhà nguyên căn'],
    ['room', 'a room', 'phòng trọ'],
  ] as const)('kind %s is named "%s" / "%s"', (kind, en, vi) => {
    expect(text(html('en', { ...RENT, kind }))).toContain(`Typical rent for ${en} in`)
    expect(text(html('vi', { ...RENT, kind }))).toContain(`Giá thuê phổ biến cho ${vi} tại`)
  })

  it('a range whose two ends print the same prints one figure', () => {
    expect(text(html('en', { ...RENT, high: RENT.low }))).toContain('Go Vap District: 4.2M a month.')
  })
})
