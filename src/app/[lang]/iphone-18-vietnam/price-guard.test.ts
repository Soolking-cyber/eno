import { describe, expect, it } from 'vitest'
import { APPLE_VN_FROM_PRICE, onSaleYet, plausibleTier, priceBand } from './price-guard'

const p = (...prices: number[]) => prices.map((price) => ({ price }))

describe('plausibleTier — a typo or a lure never headlines a price page', () => {
  it('a busy tier: a price under half its median is left out', () => {
    expect(plausibleTier(p(28_000_000, 29_000_000, 30_000_000, 3_000_000), []).map((r) => r.price)).toEqual([28_000_000, 29_000_000, 30_000_000])
  })

  it('a thin tier is judged against the whole model (commit-gate review: <3 rows were unguarded)', () => {
    const model = p(39_000_000, 41_000_000, 60_000_000, 3_900_000)
    expect(plausibleTier(p(39_000_000, 3_900_000), model).map((r) => r.price)).toEqual([39_000_000])
    // A legitimate cheap tier of the same model survives the looser yardstick (256GB vs a 2TB-heavy median).
    expect(plausibleTier(p(28_000_000), p(28_000_000, 60_000_000, 62_000_000, 63_000_000)).map((r) => r.price)).toEqual([28_000_000])
  })

  it('a lone listing of a new model is judged against Apple Vietnam\'s own price', () => {
    const from = APPLE_VN_FROM_PRICE['iPhone 18 Pro']
    expect(plausibleTier(p(3_890_000), p(3_890_000), from)).toEqual([])
    expect(plausibleTier(p(33_500_000), p(33_500_000), from).map((r) => r.price)).toEqual([33_500_000])
  })

  it('a whole tier of bad rows is checked against the rest of the model (review: they agree with each other)', () => {
    const bad = p(2_000_000, 2_100_000, 2_200_000)
    const model = [...bad, ...p(20_000_000, 21_000_000, 24_000_000, 25_000_000, 27_000_000, 30_000_000)]
    expect(plausibleTier(bad, model)).toEqual([])
  })

  it('a price out of line UPWARD is left out too (review: "389.000.000" for a 38.900.000 phone)', () => {
    const from = APPLE_VN_FROM_PRICE['iPhone 18 Pro']
    expect(plausibleTier(p(389_000_000), p(389_000_000), from)).toEqual([])
    expect(plausibleTier(p(20_000_000, 21_000_000, 22_000_000, 210_000_000), []).map((r) => r.price)).toEqual([20_000_000, 21_000_000, 22_000_000])
  })

  it('nothing to judge by → nothing is quoted (commit-gate review: an unchecked price is not published)', () => {
    expect(priceBand(p(5_000_000), p(5_000_000))).toBeNull()
    expect(plausibleTier(p(3_000_000, 21_000_000), p(3_000_000, 21_000_000))).toEqual([])
  })
})

describe('onSaleYet — no second-hand unit before Apple Vietnam\'s first deliveries', () => {
  it('the Duo is not quoted before 23 October 2026 (ICT), and is from that morning', () => {
    expect(onSaleYet('iPhone Duo', new Date('2026-10-22T16:59:59Z'))).toBe(false)
    expect(onSaleYet('iPhone Duo', new Date('2026-10-22T17:00:00Z'))).toBe(true)
  })
  it('a model without a date is on sale', () => {
    expect(onSaleYet('iPhone 17 Pro', new Date('2020-01-01T00:00:00Z'))).toBe(true)
  })
})
