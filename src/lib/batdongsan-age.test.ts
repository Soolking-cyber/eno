import { describe, expect, it } from 'vitest'
import { ageWithin, bdsAgeDays } from './batdongsan-age'

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
