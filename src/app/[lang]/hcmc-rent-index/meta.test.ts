import { describe, expect, it } from 'vitest'
import type { RentIndex, Stats } from '@/lib/rent-index'
import { SITE_NAME } from '@/lib/edition'
import { rentIndexMeta } from './meta'
import { fitsDescription } from '@/lib/meta-description'

const stats = (median: number | null, n = 100): Stats => ({ n, median, p25: median, p75: median, nArea: 0, medianPerM2: null })

/** Only the fields rentIndexMeta reads; the rest of a snapshot is irrelevant to the head. */
function index(over: Partial<RentIndex['cityBands']> = {}, computedAt = '2026-11-22T00:15:00.000Z'): RentIndex {
  return {
    computedAt,
    used: 6304,
    cityBands: { studio: stats(4_300_000), br1: stats(8_000_000), br2: stats(9_700_000), br3plus: stats(29_100_000), ...over },
  } as unknown as RentIndex
}

describe('rentIndexMeta (owner 2026-11-22: rank for "rent prices in Ho Chi Minh City by district")', () => {
  it('English: the words people ask in, the snapshot month, and the 1- and 2-bedroom medians', () => {
    const m = rentIndexMeta(index(), 'en')
    expect(m.title).toBe('Ho Chi Minh City Rent Prices by District, November 2026') // over 60 with the site's name: it goes (Seobility 2026-11-23)
    expect(m.description).toBe(
      'Median asking rent in Ho Chi Minh City, 22 Nov 2026: 1-bedroom 8,000,000 đ, 2-bedroom 9,700,000 đ a month. By district, from 6,304 listings, updated daily.',
    )
    expect(`${m.title} ${m.description}`).not.toMatch(/Giá|TP\.HCM|theo quận/)
  })

  it('Vietnamese variant: Vietnamese only, dot separators, the HCMC date', () => {
    const m = rentIndexMeta(index(), 'vi')
    expect(m.title).toBe(`Giá thuê nhà TP.HCM theo quận, tháng 11/2026 | ${SITE_NAME}`)
    expect(m.description).toBe(
      'Giá thuê trung vị TP.HCM ngày 22/11/2026: căn hộ 1 phòng ngủ 8.000.000 đ, 2 phòng ngủ 9.700.000 đ/tháng. Từng quận, từ 6.304 tin, cập nhật mỗi ngày.',
    )
  })

  it('within a result (Seobility crawl 4: /vi at 1,022 px): bigger figures still fit, the figures sentence whole', () => {
    const m = rentIndexMeta({ ...index(), used: 1_234_567 }, 'vi')
    expect(fitsDescription(m.description)).toBe(true)
    expect(m.description).toContain('9.700.000 đ/tháng.')
  })

  it('the month and day are Ho Chi Minh City time: 17:30 UTC on 30 November is already 1 December there', () => {
    const m = rentIndexMeta(index({}, '2026-11-30T17:30:00.000Z'), 'en')
    expect(m.title).toContain('December 2026')
    expect(m.description).toContain(', 1 Dec 2026:')
  })

  it('a band without a published median drops out of the sentence; no median at all gives the plain wording', () => {
    expect(rentIndexMeta(index({ br1: stats(null, 4) }), 'en').description).toContain(': 2-bedroom 9,700,000 đ a month.')
    const none = rentIndexMeta(index({ br1: stats(null, 4), br2: stats(null, 3) }), 'en')
    expect(none.title).toBe('Ho Chi Minh City Rent Prices by District, November 2026') // over 60 with the site's name: it goes (Seobility 2026-11-23)
    expect(none.description).not.toMatch(/\d/)
  })

  it('no snapshot (a failed read): no month, no figure, in either language', () => {
    for (const lang of ['en', 'vi']) {
      const m = rentIndexMeta(null, lang)
      expect(m.title).not.toMatch(/\d/)
      expect(m.description).not.toMatch(/\d/)
    }
    expect(rentIndexMeta(null, 'en').title).toBe(`Ho Chi Minh City Rent Prices by District | ${SITE_NAME}`)
    expect(rentIndexMeta(null, 'vi').title).toBe(`Giá thuê nhà TP.HCM theo quận | ${SITE_NAME}`)
  })

  it('an unreadable snapshot time is treated as no snapshot, never "Invalid Date"', () => {
    const m = rentIndexMeta(index({}, 'not a date'), 'en')
    expect(m.title).toBe(`Ho Chi Minh City Rent Prices by District | ${SITE_NAME}`)
    expect(m.description).not.toContain('Invalid')
  })

  it('every machine-translated language gets the English head (only en and vi render on the server)', () => {
    expect(rentIndexMeta(index(), 'ja')).toEqual(rentIndexMeta(index(), 'en'))
  })

  it('titles stay within 70 characters and descriptions within 160 for the longest month and big numbers', () => {
    const big = index({ br1: stats(18_500_000), br2: stats(29_900_000) }, '2026-09-10T00:00:00.000Z')
    for (const lang of ['en', 'vi']) {
      const m = rentIndexMeta({ ...big, used: 12_345 } as RentIndex, lang)
      expect(m.title.length).toBeLessThanOrEqual(70)
      expect(m.description.length).toBeLessThanOrEqual(160)
    }
  })
})
