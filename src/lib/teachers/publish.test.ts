import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('@/lib/core/listings', () => ({ deleteListingCore: vi.fn(), parseVideoField: () => ({ action: 'ignore' }) }))
vi.mock('@/lib/ai-moderation', () => ({ moderateListingById: vi.fn() }))
vi.mock('@/lib/translate', () => ({ warmTranslations: vi.fn() }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ assertSellerMayPublish: vi.fn() }))
vi.mock('@/lib/trust', () => ({ initialSellerTrust: async () => ({}) }))

const { teacherVisaMention, screenTeacherTexts, optInWrites } = await import('./publish')
const { AI_NOTICE_VERSION, normalizeTeacherInput } = await import('./profile')
const { PublishBlockedError } = await import('@/lib/publish-guard')

describe('teacherVisaMention', () => {
  it('catches a visa mention in any form', () => {
    for (const s of ['I can help with your visa', 'VISAS sorted', 'e-visa support', '#visa', 'hỗ trợ thị thực', 'visa.', '비자 지원', 'v.i.s.a help', 'lo thị-thực', 'e.visa', 'Visa-sponsored teacher', 'visa_support', 'work-visa ok', 'VISA-ready']) {
      expect(teacherVisaMention(s), s).toBe(true)
    }
  })
  it('does not block real places and names (Opus, commit gate 09-30)', () => {
    for (const s of ['Western Visayas', 'Visayas State University', 'Visakha Sharma', 'Revisa Academy', 'siêu thị thực phẩm']) {
      expect(teacherVisaMention(s), s).toBe(false)
    }
  })
})

// The refusal names the FIELD, never the word (plan, 2026-10-08): the form jumps to that field, and a banned or visa word
// never reaches eno.vn's UI or wire.
describe('screenTeacherTexts — field by field', () => {
  const teacher = (o: Record<string, unknown> = {}) => normalizeTeacherInput({
    livesIn: 'city', currentCity: 'ho-chi-minh-city', teachAreas: ['ho-chi-minh-city'], fullName: 'Jane Doe', headline: 'English teacher',
    bio: 'I teach young learners.', experience: [{ role: 'Teacher', employer: 'ILA', city: 'HCMC' }], certificates: [{ type: 'celta', provider: 'Cambridge' }],
    ...o,
  })
  const refusal = (o: Record<string, unknown>) => {
    try { screenTeacherTexts(teacher(o)) } catch (e) { if (e instanceof PublishBlockedError) return { code: e.code, detail: e.detail } }
    return null
  }
  it('passes clean texts', () => {
    expect(refusal({})).toBeNull()
  })
  it('names the field holding a phone number, a banned word or a visa mention', () => {
    expect(refusal({ bio: 'Call me on 0901 234 567' })).toEqual({ code: 'contact_in_text', detail: 'bio' })
    expect(refusal({ experience: [{ role: 'Teacher', employer: 'I sell cocaine', city: '' }] })).toEqual({ code: 'banned_words', detail: 'experience.0' })
    expect(refusal({ certificates: [{ type: 'tefl', provider: 'visa help desk' }] })).toEqual({ code: 'banned_words', detail: 'certificates.0' })
    expect(refusal({ subjects: ['other-language'], teachLanguages: ['e-visa'] })).toEqual({ code: 'banned_words', detail: 'teachLanguages' })
  })
  it('screens the name as a contact name', () => {
    expect(refusal({ fullName: 'jane@example.com' })).toEqual({ code: 'contact_in_name', detail: 'fullName' })
  })
  it('⛔ never carries the offending word in the detail', () => {
    const r = refusal({ headline: 'cocaine dealer' })
    expect(r).toEqual({ code: 'banned_words', detail: 'headline' })
    expect(JSON.stringify(r)).not.toContain('cocaine')
  })
})

describe('optInWrites — one opt-in, its own evidence (plan review C2)', () => {
  const now = new Date('2026-10-08T12:00:00Z')
  const at = new Date('2026-10-08T01:00:00Z')
  it('a first switch-on stamps when, and under which AI notice', () => {
    expect(optInWrites(true, null, now)).toEqual({ on: true, at: now, version: AI_NOTICE_VERSION, withdrawnAt: null })
  })
  it('kept on under the same notice: the grant stands', () => {
    expect(optInWrites(true, { on: true, at, version: AI_NOTICE_VERSION, withdrawnAt: null }, now)).toEqual({ on: true, at, version: AI_NOTICE_VERSION, withdrawnAt: null })
  })
  it('kept on from an older notice (the Gemini one, no version): re-stamped under today\'s', () => {
    expect(optInWrites(true, { on: true, at: null, version: null, withdrawnAt: null }, now)).toMatchObject({ at: now, version: AI_NOTICE_VERSION })
  })
  it('switched off: the withdrawal\'s time, the last grant kept on record', () => {
    expect(optInWrites(false, { on: true, at, version: AI_NOTICE_VERSION, withdrawnAt: null }, now)).toEqual({ on: false, at, version: AI_NOTICE_VERSION, withdrawnAt: now })
  })
  it('staying off writes no new withdrawal', () => {
    expect(optInWrites(false, { on: false, at, version: AI_NOTICE_VERSION, withdrawnAt: at }, now).withdrawnAt).toEqual(at)
    expect(optInWrites(false, null, now)).toEqual({ on: false, at: null, version: null, withdrawnAt: null })
  })
})
