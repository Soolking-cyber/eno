import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: { teacherProfile: { findUnique: vi.fn() } } }))
const { writeEligibility, hasTeacherProfile } = await import('./queries')
const { db } = await import('@/lib/db')

const person = { accountType: 'personal', enforcementState: 'good_standing', trustTier: 'standard', createdAt: new Date('2026-01-01T00:00:00Z'), phone: '0900000000' }

// Owner, 2026-11-23: "to upvote or downvote or comment on school users should have teacher profiles".
describe('writeEligibility — only teachers vote on, review and rate schools', () => {
  it('a member without a teacher profile is refused with its own code', () => {
    expect(writeEligibility(person, false)).toEqual({ ok: false, code: 'teacher_profile_required' })
  })
  it('a teacher in good standing may write', () => {
    expect(writeEligibility(person, true)).toMatchObject({ ok: true, countsNow: true })
  })
  it('a business account is still refused as one, teacher profile or not', () => {
    expect(writeEligibility({ ...person, accountType: 'business' }, true)).toEqual({ ok: false, code: 'business_account' })
    expect(writeEligibility({ ...person, accountType: 'business' }, false)).toEqual({ ok: false, code: 'business_account' })
  })
  it('a restricted account is refused as one first — never sent off to make a profile it still could not use', () => {
    expect(writeEligibility({ ...person, enforcementState: 'suspended' }, true)).toEqual({ ok: false, code: 'account_restricted' })
    expect(writeEligibility({ ...person, enforcementState: 'suspended' }, false)).toEqual({ ok: false, code: 'account_restricted' })
    expect(writeEligibility({ ...person, trustTier: 'restricted' }, false)).toEqual({ ok: false, code: 'account_restricted' })
  })
})

describe('hasTeacherProfile', () => {
  it('any teacher profile counts, hidden too; none does not', async () => {
    vi.mocked(db.teacherProfile.findUnique).mockResolvedValueOnce({ id: 't1' } as never)
    expect(await hasTeacherProfile('p1')).toBe(true)
    vi.mocked(db.teacherProfile.findUnique).mockResolvedValueOnce(null as never)
    expect(await hasTeacherProfile('p2')).toBe(false)
    expect(vi.mocked(db.teacherProfile.findUnique).mock.calls[0][0]).toEqual({ where: { profileId: 'p1' }, select: { id: true } })
  })
})
