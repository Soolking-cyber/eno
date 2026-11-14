import { describe, expect, it } from 'vitest'
import { factSeparators, headingNamesEmployer, periodRestatedByUnit, roleOnlyHeading } from './pdp-repeat-rows'

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

describe('roleOnlyHeading — batch 95: a linked job\'s H1 is the role only where the storefront IS the employer', () => {
  const NORD = 'Nord Anglia Education'
  const nord = {
    title: 'Secondary Computer Science Teacher — Nord Anglia Education',
    titleVi: null,
    i18n: { vi: 'Giáo viên Tin học cấp trung học — Nord Anglia Education', ko: '중등 컴퓨터 과학 교사 — Nord Anglia Education' },
    employer: NORD,
    storefront: NORD,
  }

  it('Nord Anglia and Inspired: the role, in English and in every embedded translation whose tail is exact', () => {
    expect(roleOnlyHeading(nord)).toEqual({
      title: 'Secondary Computer Science Teacher',
      titleVi: null,
      i18n: { vi: 'Giáo viên Tin học cấp trung học', ko: '중등 컴퓨터 과학 교사' },
    })
    const inspired = roleOnlyHeading({ title: 'Primary Class Teacher — Inspired Education', titleVi: undefined, i18n: undefined, employer: 'Inspired Education', storefront: 'Inspired Education' })
    expect(inspired).toEqual({ title: 'Primary Class Teacher', titleVi: null, i18n: null })
  })

  it('the storefront is the employer whatever the Unicode form, spacing or case', () => {
    expect(roleOnlyHeading({ ...nord, storefront: '  nord  anglia EDUCATION ' })?.title).toBe('Secondary Computer Science Teacher')
    expect(roleOnlyHeading({ ...nord, employer: 'Nord  Anglia Education ' })?.title).toBe('Secondary Computer Science Teacher')
  })

  it('a stored Vietnamese title is cut the same way; a translation whose tail is not exact keeps its full text', () => {
    const out = roleOnlyHeading({ ...nord, titleVi: 'Giáo viên Khoa học Máy tính — Nord Anglia Education', i18n: { vi: 'Giáo viên — Tập đoàn Nord Anglia', fr: 'Enseignant en informatique — Nord Anglia Education' } })!
    expect(out.titleVi).toBe('Giáo viên Khoa học Máy tính')
    expect(out.i18n).toEqual({ vi: 'Giáo viên — Tập đoàn Nord Anglia', fr: 'Enseignant en informatique' })
  })

  it('⛔ RMIT: a stored employer that is not the storefront\'s name ("… LLC") keeps the full H1', () => {
    expect(roleOnlyHeading({ title: 'Associate Lecturer, Psychology — RMIT University Vietnam LLC', titleVi: null, i18n: null, employer: 'RMIT University Vietnam LLC', storefront: 'RMIT University Vietnam' })).toBeNull()
  })

  it('⛔ an aggregator board (LinkedIn naming Dwight) keeps "<role> — <employer>": the link can only name the board', () => {
    expect(roleOnlyHeading({ title: 'Grade 4 Homeroom Teacher — Dwight School Hanoi', titleVi: null, i18n: null, employer: 'Dwight School Hanoi', storefront: 'LinkedIn' })).toBeNull()
  })

  it('no exact tail, one word left, or no usable employer: null (the title as stored)', () => {
    expect(roleOnlyHeading({ ...nord, title: 'Secondary Computer Science Teacher' })).toBeNull()
    expect(roleOnlyHeading({ ...nord, title: 'Nord Anglia Education — Secondary Teacher' })).toBeNull()
    expect(roleOnlyHeading({ ...nord, title: 'Teacher — Nord Anglia Education' })).toBeNull()
    for (const employer of [undefined, null, 42, '', '  ']) expect(roleOnlyHeading({ ...nord, employer, storefront: employer === '' || employer === '  ' ? (employer as string) : NORD })).toBeNull()
  })

  it('⛔ never a cut that changes the language the H1 is localised by (detectContentLang)', () => {
    const vus = 'Trường Quốc Tế Á Châu'
    expect(roleOnlyHeading({ title: `English Teacher — ${vus}`, titleVi: null, i18n: null, employer: vus, storefront: vus })).toBeNull()
    // "Giáo viên tiếng Anh" has no letter only Vietnamese uses, so its cut would read as Latin: kept whole too.
    expect(roleOnlyHeading({ title: `Giáo viên tiếng Anh — ${vus}`, titleVi: null, i18n: null, employer: vus, storefront: vus })).toBeNull()
    expect(roleOnlyHeading({ title: `Giáo viên tiểu học — ${vus}`, titleVi: null, i18n: null, employer: vus, storefront: vus })?.title).toBe('Giáo viên tiểu học')
  })
})
