import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hubTypeChips } from './vehicle-hub-chips'
import { facetsFor } from './taxonomy'

/**
 * NAV-9: the vehicle hubs' type chips are offered "as the data supports" — one per facet value with a live
 * row, never a chip that opens an empty result — and their values are the taxonomy's own, so the explorer
 * applies each one (parseFilterParams keeps only a facet the subcategory offers).
 */

describe('hubTypeChips', () => {
  it('motorbikes: gearbox, xe ga / xe số, only where a bike is listed', () => {
    expect(hubTypeChips({ kind: 'motorbike', counts: { automatic: 180, manual: 52, daily: 200, monthly: 30 } })).toEqual({
      facet: 'transmission',
      types: [{ value: 'automatic', en: 'Automatic', vi: 'Xe ga' }, { value: 'manual', en: 'Manual', vi: 'Xe số' }],
    })
    expect(hubTypeChips({ kind: 'motorbike', counts: { automatic: 9, manual: 0 } }).types.map((t) => t.value)).toEqual(['automatic'])
  })

  it('cars: seats, in the facet\'s order, only the counts above 0', () => {
    const { facet, types } = hubTypeChips({ kind: 'car', counts: { 'seats-4': 120, 'seats-5': 0, 'seats-7': 64, 'seats-9plus': 0, 'seats-4-5': 120, vinfast: 30 } })
    expect(facet).toBe('seats')
    expect(types).toEqual([{ value: '4', en: '4 seats', vi: '4 chỗ' }, { value: '7', en: '7 seats', vi: '7 chỗ' }])
  })

  it('no live rows of any type → no chips (the row then shows Filters and Map only)', () => {
    expect(hubTypeChips({ kind: 'car', counts: {} }).types).toEqual([])
  })

  it('every chip value is an option of the facet the explorer offers on that subcategory', () => {
    for (const [kind, sub] of [['motorbike', 'motorbike-rental'], ['car', 'car-rental']] as const) {
      const all = Object.fromEntries(['automatic', 'manual', 'seats-4', 'seats-5', 'seats-7', 'seats-9plus'].map((k) => [k, 1]))
      const { facet, types } = hubTypeChips({ kind, counts: all })
      const offered = facetsFor('rentals', sub).find((f) => f.key === facet)
      expect(offered, `${sub} offers ${facet}`).toBeDefined()
      for (const t of types) expect(offered!.options.map((o) => o.value), `${sub} ${t.value}`).toContain(t.value)
    }
  })

  it('the hub loader tallies every count a chip reads (source contract)', () => {
    const LOADER = readFileSync(join(process.cwd(), 'src/lib/vehicle-hubs.ts'), 'utf8')
    expect(LOADER).toContain("for (const s of ['4', '5', '7', '9plus'] as const) counts[`seats-${s}`]")
    expect(LOADER).toMatch(/for \(const t of \['automatic', 'manual'\] as const\)/)
  })
})
