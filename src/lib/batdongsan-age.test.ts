import { describe, expect, it } from 'vitest'
import { ageWithin, bdsAgeDays, bdsScrapeStartMs, bdsWorstCaseDate } from './batdongsan-age'

describe('bdsAgeDays — the card\'s relative "Đăng …" label', () => {
  it('reads the labels the scraper actually stored', () => {
    expect(bdsAgeDays('Đăng hôm nay')).toEqual({ minDays: 0, maxDays: 1 })
    expect(bdsAgeDays('Đăng hôm qua')).toEqual({ minDays: 1, maxDays: 2 })
    expect(bdsAgeDays('Đăng 3 ngày trước')).toEqual({ minDays: 3, maxDays: 4 })
    expect(bdsAgeDays('Đăng 1 tuần trước')).toEqual({ minDays: 7, maxDays: 14 })
    expect(bdsAgeDays('Đăng 2 tháng trước')).toEqual({ minDays: 60, maxDays: 90 })
  })
  it('reads a decomposed (NFD) label the same', () => {
    expect(bdsAgeDays('Đăng 4 ngày trước'.normalize('NFD'))?.maxDays).toBe(5)
  })
  it('refuses what it cannot read, absolute dates included — an unreadable age is not a fresh one', () => {
    expect(bdsAgeDays('')).toBeNull()
    expect(bdsAgeDays(null)).toBeNull()
    expect(bdsAgeDays('Tin VIP')).toBeNull()
    expect(bdsAgeDays('Đăng 31/02/2099')).toBeNull()
  })
})

describe('ageWithin — a freshness cut on the WORST-case age', () => {
  it('admits exact ages up to the limit, counting the scrape\'s own fractional age', () => {
    expect(ageWithin(bdsAgeDays('Đăng 5 ngày trước'), 0.5, 7)).toBe(true)
    expect(ageWithin(bdsAgeDays('Đăng 6 ngày trước'), 0.5, 7)).toBe(false) // 6 to <7 days, plus half a day
    expect(ageWithin(bdsAgeDays('Đăng 6 ngày trước'), 0, 7)).toBe(true)
    expect(ageWithin(bdsAgeDays('Đăng hôm nay'), 0, 7)).toBe(true)
  })
  it('never lets a coarse "1 week ago" (up to 13 days) pass a 7- or 10-day cut', () => {
    expect(ageWithin(bdsAgeDays('Đăng 1 tuần trước'), 0, 7)).toBe(false)
    expect(ageWithin(bdsAgeDays('Đăng 1 tuần trước'), 0, 10)).toBe(false)
    expect(ageWithin(bdsAgeDays('Đăng 1 tuần trước'), 0, 14)).toBe(true) // 7 to <14 days
  })
  it('rejects a null age', () => {
    expect(ageWithin(null, 0, 7)).toBe(false)
  })
})

describe('bdsWorstCaseDate — the OLDEST instant a label allows', () => {
  const READ = Date.parse('2026-10-05T03:00:00Z')
  const DAY = 86_400_000
  it('counts the far end of the range back from the earliest read', () => {
    expect(bdsWorstCaseDate(bdsAgeDays('Đăng hôm nay')!, READ).getTime()).toBe(READ - DAY)
    expect(bdsWorstCaseDate(bdsAgeDays('Đăng 3 ngày trước')!, READ).getTime()).toBe(READ - 4 * DAY)
    expect(bdsWorstCaseDate(bdsAgeDays('Đăng 1 tuần trước')!, READ).getTime()).toBe(READ - 14 * DAY)
  })
  it('floors a fractional read time, so the written ISO date is never newer than the worst case', () => {
    expect(bdsWorstCaseDate(bdsAgeDays('Đăng hôm qua')!, READ + 0.9).getTime()).toBe(READ - 2 * DAY)
  })
})

describe('bdsScrapeStartMs — when the labels were read, at the earliest', () => {
  const BIRTH = Date.parse('2026-10-05T03:10:00Z')
  it('is the file birth without a crawl log', () => {
    expect(bdsScrapeStartMs(BIRTH, null)).toBe(BIRTH)
    expect(bdsScrapeStartMs(BIRTH, undefined)).toBe(BIRTH)
    expect(bdsScrapeStartMs(BIRTH, NaN)).toBe(BIRTH)
  })
  it("is the crawl's start when that is earlier — the scraper creates the file only at its first checkpoint", () => {
    expect(bdsScrapeStartMs(BIRTH, BIRTH - 600_000)).toBe(BIRTH - 600_000)
  })
  it('never moves LATER than the birth, whatever the log claims', () => {
    expect(bdsScrapeStartMs(BIRTH, BIRTH + 3_600_000)).toBe(BIRTH)
  })
})
