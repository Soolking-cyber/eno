import { describe, expect, it } from 'vitest'
import { teacherProfileLd } from './jsonld'

const base = {
  url: 'https://eno.vn/listings/x', fullName: 'Jane Doe', headline: 'CELTA teacher', photoUrl: 'https://x/p.webp',
  nationality: 'United Kingdom', languages: ['French'], cityLabel: 'Ho Chi Minh City', degreeLevel: 'bachelor',
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
