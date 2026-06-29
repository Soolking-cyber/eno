import { describe, it, expect } from 'vitest'
import { parseVnd, formatMoneyFull } from './vnd'

// Money is always displayed grouped + suffixed "VND"; parseVnd is the inverse used
// on every price input. They must round-trip.
describe('parseVnd', () => {
  it('strips dot/comma separators to an integer', () => {
    expect(parseVnd('1.080.000.000')).toBe(1_080_000_000)
    expect(parseVnd('5,000,000 VND')).toBe(5_000_000)
  })

  it('returns 0 for empty / non-numeric', () => {
    expect(parseVnd('')).toBe(0)
    expect(parseVnd('abc')).toBe(0)
  })
})

describe('formatMoneyFull', () => {
  it('formats ₫ as grouped digits + VND suffix', () => {
    expect(formatMoneyFull(1_080_000_000, '₫')).toBe('1,080,000,000 VND')
    expect(formatMoneyFull(0, '₫')).toBe('0 VND')
  })

  it('round-trips with parseVnd', () => {
    expect(parseVnd(formatMoneyFull(12_000_000, '₫'))).toBe(12_000_000)
  })
})
