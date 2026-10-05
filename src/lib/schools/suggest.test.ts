import { describe, expect, it } from 'vitest'
import { checkSuggestion, websiteKey } from './suggest'

describe('checkSuggestion', () => {
  it('accepts a real school and returns the row a moderator would add', () => {
    const r = checkSuggestion({ name: '  Saigon   Star International School ', kind: 'international_school', website: 'www.saigonstar.edu.vn/en', districts: ['Thu Duc City (D2 & D9)'], note: 'Campus in Thao Dien, hiring every spring.' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.row).toMatchObject({ name: 'Saigon Star International School', slug: 'saigon-star-international-school', kind: 'international_school', website: 'https://www.saigonstar.edu.vn/en' })
    expect(r.value.nameKey).toBe('saigon star international school')
    expect(r.value.host).toBe('saigonstar.edu.vn')
    expect(r.value.note).toBe('Campus in Thao Dien, hiring every spring.')
  })

  it('a Vietnamese name keeps its diacritics and still gets a slug', () => {
    const r = checkSuggestion({ name: 'Trung tâm Anh ngữ Ánh Dương', kind: 'language_centre' })
    expect(r.ok && r.value.row.slug).toBe('trung-tam-anh-ngu-anh-duong')
    expect(r.ok && r.value.row.name).toBe('Trung tâm Anh ngữ Ánh Dương')
  })

  it('refuses a generic phrase, contact details, a bad website and an area outside HCMC', () => {
    expect(checkSuggestion({ name: 'English Centre', kind: 'language_centre' })).toEqual({ ok: false, code: 'school_name_invalid' })
    expect(checkSuggestion({ name: 'X', kind: 'language_centre' })).toEqual({ ok: false, code: 'school_name_invalid' })
    expect(checkSuggestion({ name: 'Bright Kids Academy', kind: 'language_centre', note: 'Call 0903 123 456' })).toEqual({ ok: false, code: 'contact_in_text' })
    expect(checkSuggestion({ name: 'Bright Kids Academy', kind: 'language_centre', note: 'write to hr@brightkids.vn' })).toEqual({ ok: false, code: 'contact_in_text' })
    expect(checkSuggestion({ name: 'Bright Kids Academy', kind: 'language_centre', website: 'not a url' })).toEqual({ ok: false, code: 'website_invalid' })
    expect(checkSuggestion({ name: 'Bright Kids Academy', kind: 'language_centre', website: 'ftp://brightkids.vn' })).toEqual({ ok: false, code: 'website_invalid' })
    expect(checkSuggestion({ name: 'Bright Kids Academy', kind: 'language_centre', districts: ['Hanoi'] })).toEqual({ ok: false, code: 'district_invalid' })
  })
})

describe('websiteKey', () => {
  it('compares hosts without www, and never a host many schools share', () => {
    expect(websiteKey('https://WWW.ILA.edu.vn/en/')).toBe('ila.edu.vn')
    expect(websiteKey('https://www.facebook.com/brightkids')).toBeNull()
    expect(websiteKey('https://brightkids.wixsite.com/home')).toBeNull()
    expect(websiteKey(null)).toBeNull()
    expect(websiteKey('nonsense')).toBeNull()
  })
})
