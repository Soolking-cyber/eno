import { describe, expect, it } from 'vitest'
import { BUDGETS } from './itinerary-data'

/**
 * ⚠️ THE PRICE SHOWN MUST BE THE PRICE PLANNED TO.
 *
 * `daily` is what api/itineraries/generate sends the model as the target spend; `detail`/`detailVi`
 * are what the traveller reads on the chip before choosing (owner, 2026-07-26: "add price ranges
 * for customers to have expense range idea"). Those are two representations of one number, in two
 * files, and nothing but this test couples them — so editing a price without updating its label
 * would quietly promise one budget and plan another. That failure is invisible: the plan still
 * generates, it is just built to a figure the traveller was never shown.
 *
 * The route used to hold its OWN copy of these three figures too. It now reads BUDGETS.
 */
describe('budget tiers: the label states the number the generator is given', () => {
  it.each(BUDGETS)('$id label matches its daily figure', (tier) => {
    const millions = tier.daily / 1_000_000
    // "1.2" in English, "1,2" in Vietnamese — trailing ".0" dropped, as both labels write it.
    const en = String(millions)
    const vi = en.replace('.', ',')
    expect(tier.detail, `EN label must state ${en}m`).toContain(en)
    expect(tier.detailVi, `VI label must state ${vi} triệu`).toContain(vi)
  })

  it('every tier carries a usable daily figure', () => {
    for (const tier of BUDGETS) {
      expect(tier.daily).toBeGreaterThan(0)
      expect(Number.isFinite(tier.daily)).toBe(true)
    }
  })

  it('tiers ascend, so the chips read as a range rather than a list', () => {
    const dailies = BUDGETS.map((t) => t.daily)
    expect([...dailies].sort((a, b) => a - b)).toEqual(dailies)
  })
})
