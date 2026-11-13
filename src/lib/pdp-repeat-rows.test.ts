import { describe, expect, it } from 'vitest'
import { headingNamesEmployer } from './pdp-repeat-rows'

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
