import { describe, expect, it } from 'vitest'
import { factSeparators, headingNamesEmployer, periodRestatedByUnit } from './pdp-repeat-rows'

describe('headingNamesEmployer — batch 84: a linked job drops its Employer row only when the heading names the employer', () => {
  it("the importer's \"<role> — <employer>\" heading names it, in any case or Unicode form", () => {
    expect(headingNamesEmployer('Secondary Computer Science Teacher — Nord Anglia Education', 'Nord Anglia Education')).toBe(true)
    expect(headingNamesEmployer('GIÁO VIÊN TIẾNG ANH — TRƯỜNG QUỐC TẾ Á CHÂU', 'Trường Quốc Tế Á Châu')).toBe(true)
    expect(headingNamesEmployer('Teacher — Trường Á Châu'.normalize('NFD'), 'Trường Á Châu')).toBe(true)
  })
  it('⛔ never inside another word (commit review: "Ace" in "Workplace", "IT" in "Digital")', () => {
    expect(headingNamesEmployer('Workplace Coordinator', 'Ace')).toBe(false)
    expect(headingNamesEmployer('Digital Marketing Lead', 'IT')).toBe(false)
    expect(headingNamesEmployer('Teacher of IT — Ace', 'Ace')).toBe(true)
  })
  it('⛔ the FULL name: a shared prefix is not a match', () => {
    expect(headingNamesEmployer('English Teacher — International School Saigon', 'International School Hanoi')).toBe(false)
    expect(headingNamesEmployer('English Teacher — Nord Anglia', 'Nord Anglia Education')).toBe(false)
  })
  it('no usable name: no match', () => {
    expect(headingNamesEmployer('English Teacher', undefined)).toBe(false)
    expect(headingNamesEmployer('English Teacher', 42)).toBe(false)
    expect(headingNamesEmployer('English Teacher', ' ')).toBe(false)
    expect(headingNamesEmployer('A — B', 'B')).toBe(false)
  })
})

describe('periodRestatedByUnit — batch 89: "Rental period" goes only when the price\'s own unit says it', () => {
  it('a unit period equal to the stored unit', () => {
    expect(periodRestatedByUnit('daily', 'VND/day')).toBe(true)
    expect(periodRestatedByUnit('monthly', 'VND/month')).toBe(true)
    expect(periodRestatedByUnit('hourly', 'VND/hour')).toBe(true)
    expect(periodRestatedByUnit('weekly', 'VND/week')).toBe(true)
  })
  it('⛔ a different unit, no unit (a bare VND, a Free price), or "long-term" (a chip, not a unit) keeps the row', () => {
    expect(periodRestatedByUnit('daily', 'VND/month')).toBe(false)
    expect(periodRestatedByUnit('monthly', 'VND')).toBe(false)
    expect(periodRestatedByUnit('monthly', null)).toBe(false)
    expect(periodRestatedByUnit('long-term', 'VND/month')).toBe(false)
    expect(periodRestatedByUnit(undefined, 'VND/month')).toBe(false)
  })
})

describe('factSeparators — batch 89: a dot only ever sits between two facts the reader sees, at every width', () => {
  /** What the line reads at a width, from the flags the page renders by (a phone-only fact and its dot are gone from md). */
  const read = (facts: string[], phone: boolean[], md: boolean) => {
    const seps = factSeparators(phone)
    return facts.map((f, i) => (md && phone[i] ? '' : f + (seps[i] === 'all' || (seps[i] === 'phone' && !md) ? ' · ' : ''))).join('')
  }
  it('no phone-only fact: a dot after every fact but the last', () => {
    expect(factSeparators([false, false, false])).toEqual(['all', 'all', null])
    expect(read(['A', 'B', 'C'], [false, false, false], false)).toBe('A · B · C')
  })
  it('the deposit in the middle, last, first or alone', () => {
    expect(read(['A', 'Dep', 'C'], [false, true, false], false)).toBe('A · Dep · C')
    expect(read(['A', 'Dep', 'C'], [false, true, false], true)).toBe('A · C')
    expect(read(['A', 'Dep'], [false, true], false)).toBe('A · Dep')
    expect(read(['A', 'Dep'], [false, true], true)).toBe('A')
    expect(read(['Dep', 'C'], [true, false], false)).toBe('Dep · C')
    expect(read(['Dep', 'C'], [true, false], true)).toBe('C')
    expect(read(['Dep'], [true], true)).toBe('')
    expect(factSeparators([])).toEqual([])
  })
})
