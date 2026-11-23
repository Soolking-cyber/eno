import { describe, expect, it } from 'vitest'
import { MAX_MONTHLY_VND, MAX_ONE_OFF_VND, affordability, compareRentals, moveInCost, percent, readMoney, readMonths } from './calc'

describe('readMoney — a đồng field', () => {
  const req = { max: MAX_MONTHLY_VND }
  const opt = { optional: true, max: MAX_ONE_OFF_VND }
  it('reads a full amount in either grouping, and the shorthand', () => {
    for (const s of ['15000000', '15.000.000', '15,000,000', '15tr', '15 triệu', ' 15tr ']) expect(readMoney(s, req), s).toEqual({ ok: true, value: 15_000_000 })
  })
  it('a required field: empty, zero, negative, absurd and unreadable are each their own error', () => {
    expect(readMoney('', req)).toEqual({ ok: false, error: 'empty' })
    expect(readMoney('  ', req)).toEqual({ ok: false, error: 'empty' })
    expect(readMoney('0', req)).toEqual({ ok: false, error: 'zero' })
    expect(readMoney('-5000000', req)).toEqual({ ok: false, error: 'negative' })
    expect(readMoney('20 tỷ', req)).toEqual({ ok: false, error: 'tooLarge' })
    expect(readMoney('99999999999999999999', req)).toEqual({ ok: false, error: 'tooLarge' })
    expect(readMoney('abc', req)).toEqual({ ok: false, error: 'notNumber' })
    expect(readMoney('15', req)).toEqual({ ok: false, error: 'noUnit' })
    expect(readMoney('15tr50', req)).toEqual({ ok: false, error: 'ambiguous' })
  })
  it('an optional field: empty and 0 are 0; the rest is read as usual', () => {
    expect(readMoney('', opt)).toEqual({ ok: true, value: 0 })
    expect(readMoney('0', opt)).toEqual({ ok: true, value: 0 })
    expect(readMoney('0 đ', opt)).toEqual({ ok: true, value: 0 })
    expect(readMoney('-1tr', opt)).toEqual({ ok: false, error: 'negative' })
    expect(readMoney('500k', opt)).toEqual({ ok: true, value: 500_000 })
    expect(readMoney('200 tỷ', opt)).toEqual({ ok: false, error: 'tooLarge' })
  })
})

describe('readMonths — a count of months', () => {
  it('whole months within the bounds; halves only where allowed', () => {
    expect(readMonths('12', { min: 1, max: 60 })).toEqual({ ok: true, value: 12 })
    expect(readMonths('0', { min: 0, max: 24 })).toEqual({ ok: true, value: 0 })
    expect(readMonths('1,5', { min: 0, max: 12, halves: true })).toEqual({ ok: true, value: 1.5 })
    expect(readMonths('1.5', { min: 0, max: 12, halves: true })).toEqual({ ok: true, value: 1.5 })
    expect(readMonths('1.5', { min: 0, max: 24 })).toEqual({ ok: false, error: 'notWhole' })
    expect(readMonths('1.3', { min: 0, max: 12, halves: true })).toEqual({ ok: false, error: 'notWhole' })
  })
  it('empty, zero below the minimum, negative, too many and not a number', () => {
    expect(readMonths('', { min: 1, max: 60 })).toEqual({ ok: false, error: 'empty' })
    expect(readMonths('0', { min: 1, max: 60 })).toEqual({ ok: false, error: 'zero' })
    expect(readMonths('-2', { min: 0, max: 12 })).toEqual({ ok: false, error: 'negative' })
    expect(readMonths('61', { min: 1, max: 60 })).toEqual({ ok: false, error: 'tooLarge' })
    expect(readMonths('1e3', { min: 1, max: 60 })).toEqual({ ok: false, error: 'notNumber' })
    expect(readMonths('twelve', { min: 1, max: 60 })).toEqual({ ok: false, error: 'notNumber' })
  })
})

describe('affordability', () => {
  it('rent ÷ take-home pay, what is left, and the two marks', () => {
    expect(affordability(25_000_000, 8_500_000)).toEqual({ share: 0.34, left: 16_500_000, at30: 7_500_000, at40: 10_000_000, band: 'upTo40' })
  })
  it('bands: at or under 30%, at or under 40%, over 40%, over the whole pay', () => {
    expect(affordability(10_000_000, 3_000_000).band).toBe('upTo30')
    expect(affordability(10_000_000, 4_000_000).band).toBe('upTo40')
    expect(affordability(10_000_000, 4_010_000).band).toBe('over40')
    expect(affordability(10_000_000, 10_000_000).band).toBe('over40')
    const over = affordability(10_000_000, 12_000_000)
    expect(over.band).toBe('overPay')
    expect(over.left).toBe(-2_000_000)
  })
  /**
   * ⛔ THE BAND FOLLOWS THE FIGURE ON SCREEN (gate round 1): a share of 30.01% printed "30%" beside "Above the 30% rule of
   * thumb". The share is rounded once, to a tenth of a percent, and both the figure and the band read that.
   */
  it('the band is decided from the printed, rounded share — never "30%" beside "above 30%"', () => {
    const just = affordability(10_000_000, 3_001_000) // 30.01%
    expect(percent(just.share, 'en')).toBe('30%')
    expect(just.band).toBe('upTo30')
    const over = affordability(10_000_000, 3_006_000) // 30.06%
    expect(percent(over.share, 'en')).toBe('30.1%')
    expect(over.band).toBe('upTo40')
    const forty = affordability(10_000_000, 4_000_001)
    expect([percent(forty.share, 'en'), forty.band]).toEqual(['40%', 'upTo40'])
    for (let rent = 2_990_000; rent <= 4_020_000; rent += 1_000) {
      const r = affordability(10_000_000, rent)
      const shown = Number(percent(r.share, 'en').replace('%', ''))
      const want = shown > 40 ? 'over40' : shown > 30 ? 'upTo40' : 'upTo30'
      expect(r.band, `${rent} → ${shown}%`).toBe(want)
    }
  })

  it('percent: whole numbers, one decimal when the share has one, each language’s decimal mark, never NaN%', () => {
    expect(percent(0.34, 'en')).toBe('34%')
    expect(percent(0.345, 'vi')).toBe('34,5%')
    expect(percent(0.045, 'en')).toBe('4.5%')
    expect(percent(0.045, 'vi')).toBe('4,5%')
    expect(percent(0.05, 'en')).toBe('5%')
    expect(percent(1.2, 'en')).toBe('120%')
    expect(percent(Number.NaN, 'en')).toBe('')
    expect(percent(Number.POSITIVE_INFINITY, 'en')).toBe('')
  })
})

describe('moveInCost', () => {
  it('cash at signing = deposit + advance + fee + setup; the monthly rent after is the rent, from the first unpaid month', () => {
    expect(moveInCost({ rent: 12_000_000, depositMonths: 2, advanceMonths: 1, agentFee: 2_000_000, setup: 5_000_000 })).toEqual({
      deposit: 24_000_000, advance: 12_000_000, agentFee: 2_000_000, setup: 5_000_000, atSigning: 43_000_000, monthly: 12_000_000, firstMonthDue: 2,
    })
  })
  it('the advance is counted once: three months in advance means the regular rent starts in month 4', () => {
    const r = moveInCost({ rent: 10_000_000, depositMonths: 1, advanceMonths: 3, agentFee: 0, setup: 0 })
    expect(r.atSigning).toBe(40_000_000)
    expect(r.monthly).toBe(10_000_000)
    expect(r.firstMonthDue).toBe(4)
  })
  it('no deposit and nothing in advance: only the fees at signing, rent from month 1', () => {
    const r = moveInCost({ rent: 8_000_000, depositMonths: 0, advanceMonths: 0, agentFee: 0, setup: 1_000_000 })
    expect(r).toMatchObject({ deposit: 0, advance: 0, atSigning: 1_000_000, firstMonthDue: 1 })
  })
  it('half a month of deposit is a whole number of đồng', () => {
    expect(moveInCost({ rent: 7_500_001, depositMonths: 1.5, advanceMonths: 1, agentFee: 0, setup: 0 }).deposit).toBe(11_250_002)
  })
})

describe('compareRentals', () => {
  const homes = [
    { rent: 9_000_000, deposit: 9_000_000, fees: 300_000, utilities: 1_200_000, commute: 1_500_000 },
    { rent: 10_500_000, deposit: 21_000_000, fees: 0, utilities: 1_000_000, commute: 300_000 },
    { rent: 8_000_000, deposit: 16_000_000, fees: 500_000, utilities: 1_500_000, commute: 2_500_000 },
  ]
  it('total = (rent + fees + utilities + commute) × months, the deposit never in it; ranked cheapest first', () => {
    const r = compareRentals(homes, 12)
    expect(r.map((x) => x.index)).toEqual([1, 0, 2])
    expect(r.map((x) => x.total)).toEqual([141_600_000, 144_000_000, 150_000_000])
    expect(r.map((x) => x.perMonth)).toEqual([11_800_000, 12_000_000, 12_500_000])
    expect(r.map((x) => x.overCheapest)).toEqual([0, 2_400_000, 8_400_000])
  })
  it('cash up front is the deposit plus the first month’s rent, kept apart from the total', () => {
    const r = compareRentals(homes, 12)
    expect(r.map((x) => x.upFront)).toEqual([31_500_000, 18_000_000, 24_000_000])
  })
  it('a tie on total goes to the smaller sum up front, then to the order entered', () => {
    const a = { rent: 10_000_000, deposit: 20_000_000, fees: 0, utilities: 0, commute: 0 }
    const b = { rent: 10_000_000, deposit: 10_000_000, fees: 0, utilities: 0, commute: 0 }
    expect(compareRentals([a, b], 6).map((x) => x.index)).toEqual([1, 0])
    expect(compareRentals([b, { ...b }], 6).map((x) => x.index)).toEqual([0, 1])
  })
  it('two homes are enough, and a one-month lease works', () => {
    const r = compareRentals(homes.slice(0, 2), 1)
    expect(r.map((x) => x.total)).toEqual([11_800_000, 12_000_000])
  })
})
