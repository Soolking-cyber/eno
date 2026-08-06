import { describe, it, expect } from 'vitest'
import { grossUpForProcessing } from './fx'

/**
 * The payment-processing GROSS-UP — the arithmetic that decides whether the desk actually keeps the
 * price it quoted.
 *
 * ⚠️ THE EXISTING fx.test.ts DOES NOT TEST THIS. Its 32 cases cover the rate (inversion, outage,
 * band) and cent rounding thoroughly, and none of them exercise the fee. That is the gap this file
 * fills, and it is worth filling precisely because the failure is invisible: naive addition
 * under-recovers by a fraction on every single order, forever, and only shows up when the books do
 * not reconcile.
 *
 * The property under test is the one the implementation comment claims:
 *   the processor takes `percent` of the TOTAL plus `fixed`, and what remains must be ≥ the service.
 */
const nets = (totalCents: number, percent: number, fixedCents: number) =>
  totalCents - (totalCents * (percent / 100) + fixedCents)

describe('grossUpForProcessing', () => {
  it('recovers the service amount in full — the whole reason it is a gross-up', () => {
    const r = grossUpForProcessing(10_000, { percent: 4.4, fixedCents: 30 })!
    expect(r).not.toBeNull()
    // $100.00 service → $104.92 charged (the figure worked in the implementation comment).
    expect(r.totalCents).toBe(10_492)
    expect(r.processingCents).toBe(492)
    expect(nets(r.totalCents, 4.4, 30)).toBeGreaterThanOrEqual(10_000)
  })

  it('beats naive addition, which under-recovers — the bug being prevented', () => {
    const naive = 10_000 + Math.round(10_000 * 0.044) + 30 // "just add the fee"
    expect(nets(naive, 4.4, 30)).toBeLessThan(10_000) // short: the leak
    const r = grossUpForProcessing(10_000, { percent: 4.4, fixedCents: 30 })!
    expect(nets(r.totalCents, 4.4, 30)).toBeGreaterThanOrEqual(10_000) // whole
  })

  it('never leaves the desk short across a wide sweep of prices', () => {
    for (const service of [1, 50, 99, 100, 1_234, 9_999, 10_000, 123_456, 999_999]) {
      const r = grossUpForProcessing(service, { percent: 4.4, fixedCents: 30 })
      expect(r, `service=${service}`).not.toBeNull()
      expect(nets(r!.totalCents, 4.4, 30), `service=${service}`).toBeGreaterThanOrEqual(service)
      // And never gouges: at most a cent of rounding above what is needed.
      expect(nets(r!.totalCents, 4.4, 30)).toBeLessThan(service + 1)
    }
  })

  it('always reports parts that sum to the total — the card renders both', () => {
    for (const service of [1, 100, 5_000, 250_000]) {
      const r = grossUpForProcessing(service, { percent: 4.4, fixedCents: 30 })!
      expect(service + r.processingCents).toBe(r.totalCents)
    }
  })

  it('handles a zero-fee processor without inventing a surcharge', () => {
    const r = grossUpForProcessing(10_000, { percent: 0, fixedCents: 0 })!
    expect(r.totalCents).toBe(10_000)
    expect(r.processingCents).toBe(0)
  })

  it('refuses nonsense terms rather than pricing them in', () => {
    expect(grossUpForProcessing(10_000, { percent: 99, fixedCents: 30 })).toBeNull() // > MAX_FEE_PERCENT
    expect(grossUpForProcessing(10_000, { percent: -1, fixedCents: 30 })).toBeNull()
    expect(grossUpForProcessing(10_000, { percent: 4.4, fixedCents: -1 })).toBeNull()
    expect(grossUpForProcessing(10_000, { percent: 4.4, fixedCents: 3_000 })).toBeNull() // units error
    expect(grossUpForProcessing(0, { percent: 4.4, fixedCents: 30 })).toBeNull()
    expect(grossUpForProcessing(1.5, { percent: 4.4, fixedCents: 30 })).toBeNull() // fractional cents
  })
})
