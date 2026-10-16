import { describe, expect, it } from 'vitest'
import { EMPTY_TEACHER } from '@/lib/teachers/profile'
import { mergeImport, type ImportedAnswers } from '@/lib/teachers/import-map'
import { importSummary, undoImport, untouchedImport } from './import-summary'

const tr = (en: string) => en
const values: ImportedAnswers = {
  subjects: ['ielts', 'general-english'], ageGroups: ['adults'], experienceBand: '1-3-years',
  experience: [
    { role: 'ESL Teacher', employer: 'ILA Vietnam', city: 'Ho Chi Minh City', from: '2023-02', to: '' },
    { role: 'Tutor', employer: 'Self-employed', city: '', from: '2021-01', to: '2022-12' },
  ],
  degreeLevel: 'bachelor', degreeYear: 2016, certificates: [{ type: 'celta', hours: null, provider: '', year: 2019 }],
  fullName: 'Jane Smith', nationality: 'GB', englishLevel: 'fluent', languages: ['French'], headline: 'IELTS teacher', bio: 'x'.repeat(300),
}

describe('importSummary', () => {
  it('one row per filled answer, under the step that asks it, in the form’s own words', () => {
    const { filled } = mergeImport(EMPTY_TEACHER, values)
    const groups = importSummary(values, filled, tr, 'en')
    expect(groups.map((g) => g.step)).toEqual(['teaching', 'about'])
    const rows = Object.fromEntries(groups.flatMap((g) => g.rows).map((r) => [r.key, r]))
    expect(rows.experienceBand.check).toBe(true) // worked out from the jobs — the summary says so
    expect(rows.experience.value).toBe('2 · ESL Teacher, ILA Vietnam and more')
    expect(rows.degree.value).toBe("Bachelor's · 2016")
    expect(rows.certificates.value).toBe('CELTA')
    expect(rows.nationality.value).toMatch(/United Kingdom/)
    expect(rows.englishLevel.value).toBe('Fluent')
    expect(rows.bio.value.length).toBeLessThanOrEqual(140)
  })
  it('never a row for an answer the import did not fill (the teacher’s own stays theirs)', () => {
    const { filled } = mergeImport({ ...EMPTY_TEACHER, fullName: 'Jane Q.', headline: 'Mine' }, values)
    const keys = importSummary(values, filled, tr, 'en').flatMap((g) => g.rows.map((r) => r.key))
    expect(keys).not.toContain('fullName')
    expect(keys).not.toContain('headline')
  })
})

describe('undo', () => {
  it('puts back only what the teacher has not changed since', () => {
    const before = { ...EMPTY_TEACHER, fullName: 'Jane Q.' }
    const { next, filled } = mergeImport(before, values)
    const edited = { ...next, headline: 'My own headline now' }
    expect(untouchedImport(edited, values, filled)).not.toContain('headline')
    const back = undoImport(edited, values, filled, Object.fromEntries(filled.map((k) => [k, before[k]])))
    expect(back.headline).toBe('My own headline now')
    expect(back.subjects).toEqual([])
    expect(back.fullName).toBe('Jane Q.')
  })
  it('nothing left to undo: the same object back', () => {
    const t = { ...EMPTY_TEACHER, subjects: ['phonics'] }
    expect(undoImport(t, values, ['subjects'], { subjects: [] })).toBe(t)
  })
})
