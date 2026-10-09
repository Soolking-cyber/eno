import { describe, expect, it } from 'vitest'
import { teacherProfileLd } from './jsonld'
import { homeLocationName, publicSituation } from './profile-view'

const base = {
  url: 'https://eno.vn/listings/x', fullName: 'Jane Doe', headline: 'CELTA teacher', photoUrl: 'https://x/p.webp',
  nationality: 'United Kingdom', languages: ['English', 'French'], homeLocation: 'Ho Chi Minh City' as string | null, degreeLevel: 'bachelor',
  degreeMajor: 'Linguistics', degreeInstitution: 'Leeds', certificates: [{ type: 'celta', provider: 'Cambridge' }],
  updatedAt: new Date('2026-09-30T00:00:00Z'),
}

describe('teacherProfileLd', () => {
  it('is a ProfilePage about a Person — never a Product or an Offer', () => {
    const ld = teacherProfileLd(base)
    expect(ld['@type']).toBe('ProfilePage')
    expect(ld.mainEntity['@type']).toBe('Person')
    const s = JSON.stringify(ld)
    expect(s).not.toMatch(/"Product"|"Offer"|"price"/)
  })
  it('carries no contact data at all', () => {
    const s = JSON.stringify(teacherProfileLd(base))
    expect(s).not.toMatch(/telephone|email|contactPoint/i)
  })
  it('lists the degree and certificates as credentials', () => {
    const creds = teacherProfileLd(base).mainEntity.hasCredential as { name: string }[]
    expect(creds.map((c) => c.name)).toEqual(["Bachelor's degree, Linguistics", 'CELTA'])
  })
})

// ── Where the teacher lives (teacher onboarding redesign, owner, 2026-10-08) ────────────────────────────────────────────
// It printed `${cityLabel}, Vietnam` whatever the city: a teacher abroad read ", Vietnam" (or the old Hồ Chí Minh
// fallback), and a teacher in a province no city chip covers had no honest value at all.
describe('teacherProfileLd — homeLocation only for a teacher who lives in Vietnam', () => {
  const ldFor = (row: Parameters<typeof publicSituation>[0]) => teacherProfileLd({ ...base, homeLocation: homeLocationName(publicSituation(row)) })

  it('a city teacher: the city, in Vietnam', () => {
    const ld = ldFor({ livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: 'd7' })
    expect(ld.mainEntity.homeLocation).toEqual({ '@type': 'Place', name: 'Ho Chi Minh City, Vietnam', address: { '@type': 'PostalAddress', addressCountry: 'VN' } })
  })
  it('"somewhere else in Vietnam": the province — never a city chip they do not live in', () => {
    expect(ldFor({ livesIn: 'elsewhere', currentProvince: '52' }).mainEntity.homeLocation).toMatchObject({ name: 'Gia Lai, Vietnam' })
  })
  it('⛔ abroad, or unanswered: no homeLocation at all — never ", Vietnam" and never Hồ Chí Minh', () => {
    for (const row of [{ livesIn: 'abroad', teachAreas: ['online'] }, { livesIn: null, currentCity: 'ho-chi-minh-city' }, {}]) {
      const ld = ldFor(row)
      expect('homeLocation' in ld.mainEntity, JSON.stringify(row)).toBe(false)
      const s = JSON.stringify(ld)
      expect(s).not.toContain(', Vietnam')
      expect(s).not.toMatch(/Ho Chi Minh|Hồ Chí Minh/)
    }
  })
})
