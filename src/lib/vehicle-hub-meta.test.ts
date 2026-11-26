import { describe, expect, it } from 'vitest'
import type { PriceSummary } from '@/lib/vehicle-hub-stats'
import type { VehicleHubData } from '@/lib/vehicle-hubs'
import { bikeHubDescription, carHubDescription } from './vehicle-hub-meta'

const band = (median: number, p25: number, p75: number, n = 40): PriceSummary => ({ kind: 'band', n, median, p25, p75, min: p25, max: p75 })

function hub(all: PriceSummary, seven: PriceSummary, total = 42): VehicleHubData {
  return {
    kind: 'car',
    total,
    cohorts: [
      { key: 'all', summary: all },
      { key: 'seats-4-5', summary: { kind: 'too-few', n: 2 } },
      { key: 'seats-7', summary: seven },
      { key: 'vinfast', summary: { kind: 'too-few', n: 0 } },
    ],
  } as unknown as VehicleHubData
}

const FALLBACK = 'the old wording'

describe('carHubDescription (owner 2026-11-22: answer "what does a self-drive car cost a day" first)', () => {
  it('English: the median and middle half of every car, then the 7-seat median', () => {
    expect(carHubDescription(hub(band(900_000, 800_000, 1_000_000), band(1_000_000, 900_000, 1_200_000)), 'en', FALLBACK)).toBe(
      'Self-drive car hire in Ho Chi Minh City: about 900,000 đ a day (middle half 800,000 đ–1,000,000 đ); 7-seaters about 1,000,000 đ. 42 cars from local shops.',
    )
  })

  it('Vietnamese: dot separators, /ngày', () => {
    expect(carHubDescription(hub(band(900_000, 800_000, 1_000_000), band(1_000_000, 900_000, 1_200_000)), 'vi', FALLBACK)).toBe(
      'Thuê xe tự lái TP.HCM: khoảng 900.000 đ/ngày (một nửa số xe 800.000 đ–1.000.000 đ); xe 7 chỗ khoảng 1.000.000 đ. 42 xe từ các cửa hàng địa phương.',
    )
  })

  it('a cohort under BAND_MIN gives its low–high range, as the page does', () => {
    const d = carHubDescription(hub({ kind: 'range', n: 8, min: 700_000, max: 1_700_000 }, { kind: 'range', n: 6, min: 800_000, max: 1_500_000 }), 'en', FALLBACK)
    expect(d).toBe('Self-drive car hire in Ho Chi Minh City: 700,000 đ–1,700,000 đ a day; 7-seaters 800,000 đ–1,500,000 đ. 42 cars from local shops.')
  })

  it('no 7-seat figure: the clause drops out', () => {
    const d = carHubDescription(hub(band(900_000, 800_000, 1_000_000), { kind: 'too-few', n: 2 }), 'en', FALLBACK)
    expect(d).not.toContain('7-seat')
    expect(d).toContain('(middle half 800,000 đ–1,000,000 đ). 42 cars')
  })

  it('the middle half is half the cars, never "most" (codex); equal ends print once', () => {
    const d = carHubDescription(hub(band(900_000, 900_000, 900_000), { kind: 'range', n: 6, min: 1_000_000, max: 1_000_000 }), 'en', FALLBACK)
    expect(d).toBe('Self-drive car hire in Ho Chi Minh City: about 900,000 đ a day; 7-seaters 1,000,000 đ. 42 cars from local shops.')
    expect(d).not.toMatch(/\bmost\b/)
  })

  it('stays within 160 characters with seven-figure prices', () => {
    for (const lang of ['en', 'vi'] as const) {
      const d = carHubDescription(hub(band(1_250_000, 1_000_000, 1_700_000), band(1_500_000, 1_200_000, 2_000_000), 123), lang, FALLBACK)
      expect(d.length).toBeLessThanOrEqual(160)
    }
  })

  it('no figure for all cars: the fallback, never a price the page does not show', () => {
    expect(carHubDescription(hub({ kind: 'too-few', n: 3 }, band(1_000_000, 900_000, 1_200_000)), 'en', FALLBACK)).toBe(FALLBACK)
    expect(carHubDescription({ ...hub({ kind: 'too-few', n: 0 }, { kind: 'too-few', n: 0 }), cohorts: [] }, 'vi', FALLBACK)).toBe(FALLBACK)
  })
})

describe('bikeHubDescription — a price first, only one the page prints (OpenSEO audit 2026-11-26)', () => {
  const bikes = (day: PriceSummary, total = 22) => ({ ...hub(day, day, total), kind: 'motorbike' as const, cohorts: [{ key: 'daily-all', summary: day }] })
  it("opens with the page's search and the lowest day price of its day figures", () => {
    const vi = bikeHubDescription(bikes({ kind: 'range', n: 9, min: 100_000, max: 700_000 }), 'vi', 'FALLBACK')
    expect(vi.startsWith('Thuê xe máy Sài Gòn (TP.HCM) từ 100.000 đ/ngày: 22 xe')).toBe(true)
    expect(bikeHubDescription(bikes({ kind: 'range', n: 9, min: 100_000, max: 700_000 }), 'en', 'FALLBACK')).toMatch(/^Motorbike rental in Ho Chi Minh City \(Saigon\), from 100,000 đ a day: 22 /)
    // A band prints its median and middle half, never its minimum: "about" the median, not "from" a minimum the page hides.
    const wide: PriceSummary = { kind: 'band', n: 22, median: 450_000, p25: 300_000, p75: 550_000, min: 100_000, max: 1_550_000 }
    expect(bikeHubDescription(bikes(wide), 'vi', 'FALLBACK')).toMatch(/^Thuê xe máy Sài Gòn \(TP\.HCM\) khoảng 450\.000 đ\/ngày: /)
    expect(bikeHubDescription(bikes(wide), 'en', 'FALLBACK')).not.toContain('100,000')
  })
  it('no day figure on the page, no price in the description', () => {
    expect(bikeHubDescription(bikes({ kind: 'too-few', n: 4 }), 'vi', 'FALLBACK')).toBe('FALLBACK')
    expect(bikeHubDescription({ ...bikes({ kind: 'too-few', n: 0 }), cohorts: [] }, 'en', 'FALLBACK')).toBe('FALLBACK')
  })
})
