import { describe, expect, it } from 'vitest'
import {
  ACCOMMODATION_IDS, ACCOMMODATION_LABELS, BUDGETS, INTEREST_IDS, INTEREST_LABELS,
  PACE_IDS, PACE_LABELS,
} from './itinerary-data'

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

/**
 * ⚠️ ONE TABLE PER OPTION SET, ENFORCED.
 *
 * These labels were duplicated in three files. Moving them here did not remove the duplication —
 * murat's words, "it got relocated" — because `itinerary-builder.tsx` kept its own arrays and
 * `trip-card.tsx` kept its own map. And they HAD diverged: trip-card said `wellness` = "Thư giãn"
 * while this table and the builder said "Nghỉ dưỡng", so the saved-trip list and the builder
 * disagreed in Vietnamese about the same interest.
 *
 * A grep test rather than a type test on purpose: the failure mode is a NEW literal table appearing
 * somewhere, which no type can see. Every id must also be present in every table, so a new interest
 * is a compile error here and cannot be a silently missing chip anywhere else.
 */
describe('the option labels have exactly one home', () => {
  it('every id in the union has a label, so a new one is a compile error not a blank chip', () => {
    expect(Object.keys(INTEREST_LABELS).sort()).toEqual([...INTEREST_IDS].sort())
    expect(Object.keys(ACCOMMODATION_LABELS).sort()).toEqual([...ACCOMMODATION_IDS].sort())
    expect(Object.keys(PACE_LABELS).sort()).toEqual([...PACE_IDS].sort())
  })

  it('no other file declares a competing label table', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
      const p = join(dir, e)
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') || p.endsWith('.ts') ? [p] : []
    })
    // A literal table is a declaration whose body pairs an interest id with a Vietnamese label.
    const offenders = walk('src')
      .filter((f) => !f.endsWith('itinerary-data.ts') && !f.includes('.test.'))
      .filter((f) => {
        const src = readFileSync(f, 'utf8')
        return /(const|let)\s+(INTEREST_LABELS|ACCOMMODATION_LABELS|PACE_LABELS)\s*[:=]/.test(src)
      })
    expect(offenders, `these files re-declare a shared label table: ${offenders.join(', ')}`).toEqual([])
  })
})
