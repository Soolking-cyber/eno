import { describe, expect, it } from 'vitest'
import { teacherTitleLine, titleSubjects } from './search-title'

/**
 * THE PROFILE'S <title> LINE (SEO plan P1 item 14, 2026-10-20): "<subjects> teacher, <City>" from the fields the page
 * shows — at most two subjects (the first specialism, then English for a General English teacher), the city they live
 * in; a missing field is left out, never guessed.
 */
const HCMC = { livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: 'd7', currentProvince: null, teachAreas: ['online', 'd7'] }

describe('teacherTitleLine', () => {
  it('the plan\'s example: "IELTS & English teacher, Ho Chi Minh City" — and in Vietnamese', () => {
    const t = { ...HCMC, subjects: ['general-english', 'ielts', 'toefl-toeic', 'cambridge'] }
    expect(teacherTitleLine(t, 'en')).toBe('IELTS & English teacher, Ho Chi Minh City')
    expect(teacherTitleLine(t, 'vi')).toBe('Giáo viên IELTS và tiếng Anh tại TP. Hồ Chí Minh')
  })
  it('General English alone: "English teacher"; the city level only (never the district)', () => {
    expect(teacherTitleLine({ ...HCMC, subjects: ['general-english'] }, 'en')).toBe('English teacher, Ho Chi Minh City')
  })
  it('a province for "somewhere else in Vietnam"', () => {
    expect(teacherTitleLine({ livesIn: 'elsewhere', currentCity: '', currentProvince: '52', subjects: ['phonics'] }, 'en')).toBe('Phonics teacher, Gia Lai')
    expect(teacherTitleLine({ livesIn: 'elsewhere', currentCity: '', currentProvince: '52', subjects: ['phonics'] }, 'vi')).toBe('Giáo viên Phonics tại Gia Lai')
  })
  it('⛔ abroad, or not answered: no place — never "Vietnam", never Hồ Chí Minh', () => {
    for (const where of [{ livesIn: 'abroad', currentCity: '' }, { livesIn: null, currentCity: 'ho-chi-minh-city' }, {}]) {
      const en = teacherTitleLine({ ...where, subjects: ['general-english', 'ielts'] }, 'en')
      expect(en, JSON.stringify(where)).toBe('IELTS & English teacher')
      expect(teacherTitleLine({ ...where, subjects: ['general-english', 'ielts'] }, 'vi')).toBe('Giáo viên IELTS và tiếng Anh')
    }
  })
  it('no subject: "Teacher" / "Giáo viên" — with the place when there is one', () => {
    expect(teacherTitleLine({ ...HCMC, subjects: [] }, 'en')).toBe('Teacher, Ho Chi Minh City')
    expect(teacherTitleLine({ ...HCMC, subjects: [] }, 'vi')).toBe('Giáo viên tại TP. Hồ Chí Minh')
    expect(teacherTitleLine({}, 'en')).toBe('Teacher')
    expect(teacherTitleLine({}, 'vi')).toBe('Giáo viên')
  })
})

describe('titleSubjects — at most two, in the order the page lists them', () => {
  it('the first specialism, then English for a General English teacher', () => {
    expect(titleSubjects({ subjects: ['general-english', 'cambridge', 'phonics'] }, 'en')).toEqual(['Cambridge', 'English'])
    expect(titleSubjects({ subjects: ['general-english', 'stem'] }, 'en')).toEqual(['STEM', 'English'])
  })
  it('no General English: the first two specialisms', () => {
    expect(titleSubjects({ subjects: ['ielts', 'toefl-toeic', 'cambridge'] }, 'en')).toEqual(['IELTS', 'TOEFL/TOEIC'])
  })
  it('⛔ Business English first already says English: never "Business English & English"', () => {
    expect(titleSubjects({ subjects: ['general-english', 'business-english'] }, 'en')).toEqual(['Business English'])
    expect(titleSubjects({ subjects: ['general-english', 'business-english', 'stem'] }, 'en')).toEqual(['Business English', 'STEM'])
    expect(titleSubjects({ subjects: ['general-english', 'business-english'] }, 'vi')).toEqual(['tiếng Anh thương mại'])
  })
  it('"Other language" is the languages the teacher typed, as the page prints them — none typed, nothing', () => {
    expect(titleSubjects({ subjects: ['other-language'], teachLanguages: ['Korean', 'Japanese', 'French'] }, 'en')).toEqual(['Korean', 'Japanese'])
    expect(titleSubjects({ subjects: ['general-english', 'other-language'], teachLanguages: ['French'] }, 'en')).toEqual(['French', 'English'])
    expect(titleSubjects({ subjects: ['other-language'], teachLanguages: [] }, 'en')).toEqual([])
    expect(titleSubjects({ subjects: ['other-language'], teachLanguages: ['  '] }, 'vi')).toEqual([])
  })

  it('a Vietnamese title names a common language the Vietnamese way; one it does not know stays as typed', () => {
    expect(titleSubjects({ subjects: ['other-language'], teachLanguages: ['Korean', ' japanese '] }, 'vi')).toEqual(['tiếng Hàn', 'tiếng Nhật'])
    expect(titleSubjects({ subjects: ['general-english', 'other-language'], teachLanguages: ['French'] }, 'vi')).toEqual(['tiếng Pháp', 'tiếng Anh'])
    expect(titleSubjects({ subjects: ['other-language'], teachLanguages: ['Esperanto'] }, 'vi')).toEqual(['Esperanto'])
    expect(titleSubjects({ subjects: ['other-language'], teachLanguages: ['Korean'] }, 'en')).toEqual(['Korean'])
  })
  it('a value the taxonomy does not know is left out, never printed raw', () => {
    expect(titleSubjects({ subjects: ['made-up', 'general-english'] }, 'en')).toEqual(['English'])
    expect(titleSubjects({ subjects: ['constructor'] }, 'en')).toEqual([])
    expect(titleSubjects({ subjects: null }, 'en')).toEqual([])
  })
})
