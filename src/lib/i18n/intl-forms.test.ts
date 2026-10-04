import { describe, expect, it } from 'vitest'
import { deviceOrIntlLocale, intlLocale, isMtLanguage } from './langs'
import { formatTravel } from '@/lib/travel'
import { formatOfferTimeLeft } from '@/lib/offers'
import { vndWords } from '@/lib/vnd'
import { formatArticleDate } from '@/lib/dates'
import { formatCalendarDay, longCalendarDate } from '@/lib/calendar-day'

/**
 * The nine machine-translated languages get Intl's own words for dates and units (2026-10-04 audit:
 * "min", "h", "million", "Oct" and "ago" were English for all of them). en and vi are hand-written and
 * must not move — every assertion pairs the new branch with the unchanged one.
 */
const MT = ['zh-Hans', 'ko', 'ja', 'ru', 'km', 'ms', 'th', 'fr', 'hi'] as const
const ASCII_WORD = /[A-Za-z]{2,}/

describe('only the nine machine-translated languages take the Intl branch', () => {
  it('a value that is not a site language keeps the hand-written English, as before', () => {
    expect(isMtLanguage('ru')).toBe(true)
    for (const v of ['en', 'vi', '', 'en-GB', 'vi-VN', 'xx', null, undefined, '__proto__', 'toString']) expect(isMtLanguage(v), String(v)).toBe(false)
    expect(formatCalendarDay('2026-10-08', '')).toBe('8 Oct 2026')
    expect(formatArticleDate('2026-09-23', 'en-GB')).toBe('23 Sep 2026')
    expect(formatTravel({ straightKm: 4, roadKm: 4, minutes: 13 }, 'vi-VN').time).toBe('13 min')
  })
})

describe('intlLocale', () => {
  it('keeps each call site\'s own en / vi locale and maps the nine others', () => {
    expect(intlLocale('en')).toBe('en-US')
    expect(intlLocale('en', 'en-GB')).toBe('en-GB')
    expect(intlLocale('vi')).toBe('vi-VN')
    expect(MT.map((l) => intlLocale(l))).toEqual(['zh-CN', 'ko-KR', 'ja-JP', 'ru-RU', 'km-KH', 'ms-MY', 'th-TH', 'fr-FR', 'hi-IN'])
    expect(intlLocale(undefined)).toBe('en-US')
  })
  it('deviceOrIntlLocale leaves en / vi on the device locale (undefined) and maps the nine', () => {
    expect(deviceOrIntlLocale('en')).toBeUndefined()
    expect(deviceOrIntlLocale('vi')).toBeUndefined()
    expect(deviceOrIntlLocale(null)).toBeUndefined()
    expect(deviceOrIntlLocale('hi')).toBe('hi-IN')
    // Not a site language → the device's own locale, as before — never a silent en-US.
    expect(deviceOrIntlLocale('en-GB')).toBeUndefined()
    expect(deviceOrIntlLocale('xx')).toBeUndefined()
  })
})

describe('formatTravel', () => {
  const near = { straightKm: 3, roadKm: 4, minutes: 13 }
  const far = { straightKm: 30, roadKm: 42.4, minutes: 125 }
  it('en and vi are unchanged', () => {
    expect(formatTravel(near, 'en')).toEqual({ dist: '4.0 km', time: '13 min' })
    expect(formatTravel(near, 'vi')).toEqual({ dist: '4,0 km', time: '13 phút' })
    expect(formatTravel(far, 'en')).toEqual({ dist: '42 km', time: '2h 5m' })
  })
  it('the nine others keep the precision and lose the English unit words', () => {
    // Machine-translated languages: CLDR-shaped, so the spacing/abbreviation dots may move between ICU
    // releases — assert the number and the localized unit, not CLDR's punctuation.
    expect(formatTravel(near, 'ru').dist).toMatch(/^4,0\s*км$/)
    expect(formatTravel(near, 'ru').time).toMatch(/^13\s*мин\.?$/)
    expect(formatTravel(far, 'ru').time).toMatch(/^2\s*ч\.?\s*5\s*мин\.?$/)
    // French and Malay abbreviate the minute "min" themselves; the other seven must not print it.
    for (const l of MT.filter((x) => x !== 'fr' && x !== 'ms')) expect(formatTravel(near, l).time, l).not.toMatch(/\bmin\b/)
  })
})

describe('formatOfferTimeLeft', () => {
  it('en and vi are unchanged', () => {
    expect(formatOfferTimeLeft(125 * 60_000, 'en')).toBe('2h 5m')
    expect(formatOfferTimeLeft(30_000, 'vi')).toBe('chưa đầy một phút')
    expect(formatOfferTimeLeft(Infinity, 'ru')).toBeNull()
  })
  it('the nine others use their own unit words', () => {
    expect(formatOfferTimeLeft(125 * 60_000, 'ru')).toMatch(/^2\s*ч\.?\s*5\s*мин\.?$/)
    expect(formatOfferTimeLeft(30_000, 'fr')).toMatch(/^< 1\s+min$/) // Intl puts a narrow no-break space in French
    for (const l of MT.filter((x) => x !== 'fr' && x !== 'ms')) expect(formatOfferTimeLeft(65 * 60_000, l), l).not.toMatch(ASCII_WORD)
  })
})

describe('vndWords', () => {
  it('en and vi are unchanged', () => {
    expect(vndWords(12_000_000, 'en')).toBe('12 million đ')
    expect(vndWords(12_000_000, 'vi')).toBe('12 triệu đ')
  })
  it('the nine others spell the magnitude in their own words', () => {
    expect(vndWords(12_500_000, 'ru')).toMatch(/^12,5\s+миллион\S*\s+đ$/)
    expect(vndWords(850_000, 'ja')).toMatch(/^85\s*万\s*đ$/)
    expect(vndWords(500, 'ru')).toBe('500 đ')
  })
})

describe('dates', () => {
  it('formatArticleDate: en / vi unchanged, the nine others zone-free in their own words', () => {
    expect(formatArticleDate('2026-09-23', 'en')).toBe('23 Sep 2026')
    expect(formatArticleDate('2026-09-23', 'vi')).toBe('23/9/2026')
    expect(formatArticleDate('2026-09-23T23:30:00Z', 'ru')).toMatch(/^23\s+сент\S*\s+2026/)
    expect(formatArticleDate('not a date', 'ru')).toBe('not a date')
    expect(formatArticleDate('2026-02-31', 'fr')).toBe('2026-02-31') // unchanged — never rolled into March
    expect(formatArticleDate('0099-01-02', 'fr')).toMatch(/\b99\b/) // Date.UTC would have said 1999
    expect(formatArticleDate('0099-01-02', 'fr')).not.toMatch(/1999/)
  })
  it('longCalendarDate spells the month', () => {
    expect(longCalendarDate('2026-10-01', 'fr')).toMatch(/^1(er)?\s+octobre\s+2026$/)
    expect(longCalendarDate('2026-10-01', 'th')).toMatch(/^1\s+ตุลาคม\s+2569$/) // Buddhist era — what a Thai reader expects
    expect(longCalendarDate('nope', 'fr')).toBe('nope')
  })
  it('no machine-translated language prints an English month', () => {
    for (const l of MT) {
      expect(formatCalendarDay('2026-10-08', l), l).not.toMatch(/Oct/)
      expect(longCalendarDate('2026-10-08', l), l).not.toMatch(/October/)
    }
  })
})
