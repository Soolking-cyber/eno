import { describe, expect, it } from 'vitest'
import { jobSchoolId } from './job-match'

// Which school a live job lands on (jobsBySchool and the PDP's "what teachers say" link share this rule).
const bySeller = new Map([['seller-ila', 'school-ila']])
const byAlias = new Map([['royal school', 'school-royal']])
const job = (over: Partial<Parameters<typeof jobSchoolId>[0]>) => ({ employer: 'Royal School', sellerId: 'someone', city: 'Hồ Chí Minh', ...over })

describe('jobSchoolId', () => {
  it('matches the employer name for a job in Ho Chi Minh City, in every stored spelling of the city', () => {
    expect(jobSchoolId(job({}), bySeller, byAlias)).toBe('school-royal')
    expect(jobSchoolId(job({ city: 'Ho Chi Minh City' }), bySeller, byAlias)).toBe('school-royal')
    expect(jobSchoolId(job({ city: 'TP. Hồ Chí Minh' }), bySeller, byAlias)).toBe('school-royal')
  })

  it('ON PURPOSE: since the 2025 merger, Bình Dương and Vũng Tàu are Ho Chi Minh City', () => {
    // EIU (Thủ Dầu Một) is in the directory; a listing filed under the old province names is the new city.
    for (const city of ['Bình Dương', 'Thủ Dầu Một', 'Vũng Tàu', 'Bà Rịa - Vũng Tàu']) expect(jobSchoolId(job({ city }), bySeller, byAlias), city).toBe('school-royal')
  })

  it('the slang spellings of the city count', () => {
    for (const city of ['Saigon', 'Sài Gòn', 'TPHCM', 'TP.HCM', 'HCMC']) expect(jobSchoolId(job({ city }), bySeller, byAlias), city).toBe('school-royal')
  })

  it('never by name outside HCMC: a Hà Nội "Royal School" is another school', () => {
    expect(jobSchoolId(job({ city: 'Hà Nội' }), bySeller, byAlias)).toBeUndefined()
    expect(jobSchoolId(job({ city: 'Đà Nẵng' }), bySeller, byAlias)).toBeUndefined()
    // No city is not HCMC: an unplaced ad never borrows a Saigon school by name.
    expect(jobSchoolId(job({ city: '' }), bySeller, byAlias)).toBeUndefined()
    expect(jobSchoolId(job({ city: null }), bySeller, byAlias)).toBeUndefined()
  })

  it("the school's own linked shop counts wherever the job is", () => {
    expect(jobSchoolId(job({ sellerId: 'seller-ila', employer: 'anything', city: 'Hà Nội' }), bySeller, byAlias)).toBe('school-ila')
  })

  it('a generic or missing employer never matches', () => {
    expect(jobSchoolId(job({ employer: 'English center' }), bySeller, new Map([['english center', 'x']]))).toBeUndefined()
    expect(jobSchoolId(job({ employer: undefined }), bySeller, byAlias)).toBeUndefined()
    expect(jobSchoolId(job({ employer: 42 }), bySeller, byAlias)).toBeUndefined()
  })
})
