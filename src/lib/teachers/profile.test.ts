import { describe, expect, it } from 'vitest'
import {
  EMPTY_TEACHER, CITY_PROVINCE, DRAFT_STEPS, normalizeTeacherInput, validateTeacherInput, teacherFacetTokens,
  teacherFreeTexts, teacherSubcategory, experienceBucket, TEACHER_OPTIONS,
} from './profile'
import { CATEGORY_BY_SLUG } from '@/lib/taxonomy'
import { facetValues } from '@/lib/facet-tokens'

const complete = () => normalizeTeacherInput({
  fullName: 'Jane Doe', headline: 'CELTA-certified English teacher, 6 years with kids', bio: 'I love phonics.',
  photoUrl: 'https://sb.eno.vn/storage/v1/object/public/listings/a.webp', videoUrl: null,
  nationality: 'GB', nativeSpeaker: true, languages: ['English', 'French'],
  currentCity: 'ho-chi-minh-city', currentDistrict: 'Quận 7', preferredCities: ['ho-chi-minh-city', 'da-nang'],
  openToOnline: true, availableFrom: '2026-10-15', jobTypes: ['fulltime'], ageGroups: ['kids', 'teens'],
  subjects: ['general-english', 'phonics'], yearsExperience: 6,
  experience: [{ role: 'Teacher', employer: 'ILA', city: 'HCMC', from: '2020-01', to: '2024-06' }],
  degreeLevel: 'bachelor', degreeMajor: 'Linguistics', degreeInstitution: 'Leeds', degreeYear: 2018,
  certificates: [{ type: 'celta', hours: 120, provider: 'Cambridge', year: 2019 }],
  expectedSalaryM: 45, phone: '+84 901 234 567', staffContactOptIn: false, matchEmailOptIn: true, consentPublic: true,
})

describe('normalizeTeacherInput', () => {
  it('drops unknown keys, wrong types and values outside the taxonomy', () => {
    const t = normalizeTeacherInput({
      fullName: '  Jane   Doe ', nationality: 'gb', preferredCities: ['da-nang', 'atlantis', 7], subjects: ['ielts', 'ielts'],
      yearsExperience: '99', evil: '<script>', certificates: [{ type: 'fake-cert' }], experience: [{ from: '2020-13' }],
      currentCity: 'online',
    })
    expect(t.fullName).toBe('Jane Doe')
    expect(t.nationality).toBe('') // must be upper-case ISO alpha-2
    expect(t.preferredCities).toEqual(['da-nang'])
    expect(t.subjects).toEqual(['ielts'])
    expect(t.yearsExperience).toBe(50)
    expect(t.certificates[0].type).toBe('')
    expect(t.experience[0].from).toBe('')
    expect(t.currentCity).toBe('') // "online" is a preference, not where someone lives
    expect('evil' in t).toBe(false)
  })

  it('never throws on garbage', () => {
    for (const raw of [null, undefined, 42, 'x', [], { experience: 'nope', certificates: {} }]) {
      expect(() => normalizeTeacherInput(raw)).not.toThrow()
    }
  })
})

describe('validateTeacherInput', () => {
  it('accepts a complete profile', () => {
    expect(validateTeacherInput(complete())).toEqual({})
  })

  it('checks only the steps it is asked about — the teacher.eno.vn half never needs photo or phone', () => {
    const t = { ...complete(), photoUrl: null, phone: '', consentPublic: false }
    expect(validateTeacherInput(t, DRAFT_STEPS)).toEqual({})
    expect(Object.keys(validateTeacherInput(t)).sort()).toEqual(['consentPublic', 'phone', 'photoUrl'])
  })

  it('requires ONLY the public-profile consent; both opt-ins are optional (no bundled consent)', () => {
    const t = { ...complete(), staffContactOptIn: false, matchEmailOptIn: false }
    expect(validateTeacherInput(t)).toEqual({})
    expect(EMPTY_TEACHER.staffContactOptIn).toBe(false)
    expect(EMPTY_TEACHER.matchEmailOptIn).toBe(false)
  })

  it('flags an experience entry that ends before it starts', () => {
    const t = { ...complete(), experience: [{ role: 'T', employer: 'X', city: '', from: '2024-01', to: '2023-01' }] }
    expect(validateTeacherInput(t)['experience.0']).toBe('dates')
  })
})

describe('derived listing fields', () => {
  it('writes only taxonomy slugs into facetTokens, so every chip filters', () => {
    const tokens = teacherFacetTokens(complete())
    const cat = CATEGORY_BY_SLUG.teachers
    for (const f of cat.facets.filter((x) => x.kind !== 'range')) {
      for (const v of facetValues(tokens, f.key)) expect(f.options.map((o) => o.value)).toContain(v)
    }
    expect(facetValues(tokens, 'workIn')).toEqual(['ho-chi-minh-city', 'da-nang', 'online'])
    expect(facetValues(tokens, 'native')).toEqual(['native'])
    expect(facetValues(tokens, 'experience')).toEqual(['5-10-years'])
    expect(facetValues(tokens, 'cert')).toEqual(['celta'])
    expect(facetValues(tokens, 'degree')).toEqual(['bachelor'])
    expect(facetValues(tokens, 'video')).toEqual([])
  })

  it('buckets experience on the taxonomy boundaries', () => {
    expect([0, 1, 3, 5, 10].map(experienceBucket)).toEqual(['under-1-year', '1-3-years', '3-5-years', '5-10-years', 'over-10-years'])
  })

  it('picks a subcategory from the subjects', () => {
    expect(teacherSubcategory({ subjects: ['ielts'] })).toBe('exam-prep')
    expect(teacherSubcategory({ subjects: ['stem', 'general-english'] })).toBe('subjects')
    expect(teacherSubcategory({ subjects: ['other-language'] })).toBe('other-languages')
    expect(teacherSubcategory({ subjects: ['phonics'] })).toBe('english')
  })

  it('screens every free-text field, including experience and certificate providers', () => {
    const texts = teacherFreeTexts(complete())
    for (const s of ['Jane Doe', 'Quận 7', 'Linguistics', 'Leeds', 'ILA', 'HCMC', 'Cambridge', 'French']) expect(texts).toContain(s)
  })

  it('maps every currentCity option to a province the area filter knows', () => {
    const cities = TEACHER_OPTIONS.workIn.map((o) => o.value).filter((v) => v !== 'anywhere' && v !== 'online')
    for (const c of cities) expect(CITY_PROVINCE[c], c).toBeTruthy()
  })
})
