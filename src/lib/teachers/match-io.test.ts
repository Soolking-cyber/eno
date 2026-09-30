import { describe, expect, it } from 'vitest'
import { csvCell, parseMatchOutput, provinceToCitySlug, MATCH_MIN_SCORE } from './match-io'
import { renderTeacherMatches } from '@/lib/emails/teacher-matches'

const pair = (over: Record<string, unknown> = {}) => ({ teacherProfileId: 't1', listingId: 'l1', score: 90, match: true, reasons: [], concerns: [], decision: 'match', modelVersions: {}, ...over })

describe('parseMatchOutput — nothing is written from an output it does not trust', () => {
  it('accepts a well-formed run', () => {
    expect(parseMatchOutput({ version: 1, generatedAt: 'x', pairs: [pair(), pair({ teacherProfileId: undefined, leadId: 'L', decision: 'reject_sample', match: false, score: 20 })] }).pairs).toHaveLength(2)
  })
  it('refuses a pair with both or neither owner (the one-owner CHECK, enforced before the DB sees it)', () => {
    expect(() => parseMatchOutput({ version: 1, pairs: [pair({ leadId: 'L' })] })).toThrow()
    expect(() => parseMatchOutput({ version: 1, pairs: [pair({ teacherProfileId: undefined })] })).toThrow()
  })
  it('refuses a "match" below the bar or not judged a match', () => {
    expect(() => parseMatchOutput({ version: 1, pairs: [pair({ score: MATCH_MIN_SCORE - 1 })] })).toThrow()
    expect(() => parseMatchOutput({ version: 1, pairs: [pair({ match: false })] })).toThrow()
  })
  it('refuses an unknown version', () => {
    expect(() => parseMatchOutput({ version: 2, pairs: [] })).toThrow()
  })
})

describe('staff CSV cells', () => {
  it('neutralises spreadsheet formulas and quotes', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('+84 901')).toBe(`"'+84 901"`)
    expect(csvCell(null)).toBe('""')
  })
})

describe('provinceToCitySlug', () => {
  it('maps stored provinces back to the teacher city slugs', () => {
    expect(provinceToCitySlug('Hồ Chí Minh')).toBe('ho-chi-minh-city')
    expect(provinceToCitySlug('Hà Nội')).toBe('ha-noi')
    expect(provinceToCitySlug('Đà Nẵng')).toBe('da-nang')
    expect(provinceToCitySlug('Cà Mau')).toBeNull()
  })
})

describe('renderTeacherMatches', () => {
  const out = renderTeacherMatches({
    jobs: [{ title: 'IELTS Instructor', city: 'Hà Nội', pay: '30M', url: 'https://eno.vn/listings/j', reasons: ['IELTS trainer'], applyAtSource: true }],
    origin: 'https://eno.vn', unsubscribeUrl: 'https://eno.vn/unsubscribe?token=t&list=teacher-matches', recipientName: 'Marco Reyes', siteName: 'eno.vn',
  })
  it('names the job, links it, and carries the list-specific unsubscribe', () => {
    expect(out.subject).toContain('IELTS Instructor')
    expect(out.html).toContain('https://eno.vn/listings/j')
    expect(out.html).toContain('list=teacher-matches')
    expect(out.text).toContain('list=teacher-matches')
  })
  it('escapes and never mentions visas', () => {
    expect(out.html + out.text).not.toMatch(/visa/i)
  })
})
