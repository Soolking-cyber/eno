import { beforeEach, describe, expect, it, vi } from 'vitest'

// The teacher's part of the account export: a private intro video is DISCLOSED as existing — never its storage path —
// with the record of where it was asked for and sent; and (2026-10-08) every job match the AI judge made about the
// teacher, with what eno did with it — the AI's assessment of a person is that person's data.
const h = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  shares: [] as Record<string, unknown>[],
  sharesWhere: null as unknown,
  matches: [] as Record<string, unknown>[],
  matchesArgs: null as Record<string, unknown> | null,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({
  db: {
    teacherProfile: { findUnique: async () => h.row },
    teacherVideoShare: { findMany: async ({ where }: { where: unknown }) => { h.sharesWhere = where; return h.shares } },
    teacherJobMatch: { findMany: async (args: Record<string, unknown>) => { h.matchesArgs = args; return h.matches } },
  },
}))
const { teacherExportOf } = await import('./export')

const GRANT = new Date('2026-10-09T01:00:00Z')
beforeEach(() => {
  h.row = {
    id: 'tp1', fullName: 'Jane Doe', videoOnRequest: true, videoUrl: null,
    matchEmailOptIn: true, matchEmailOptInAt: GRANT, matchEmailNoticeVersion: '2026-10-08', matchEmailWithdrawnAt: null,
    private: { phone: '+84901234567', email: 'jane@example.com', cvFileName: 'cv.pdf', videoPath: 'p1/aaaa.mp4', updatedAt: new Date(0) },
  }
  h.shares = [{ conversationId: 'c1', requestedAt: new Date(1), sharedAt: new Date(2), revokedAt: null }]
  h.matches = [{
    listingId: 'l1', score: 84, reasons: ['IELTS 8.0'], concerns: [], decision: 'match', staffStatus: null,
    modelVersions: { judge: 'claude-haiku-5-5', effort: 'medium', route: 'subscription', prompt: 'teachers-judge-v2' },
    createdAt: new Date(3), emailedAt: new Date(4), listing: { title: 'IELTS Instructor' },
  }]
  h.matchesArgs = null
})

describe('teacherExportOf', () => {
  it('says a private video exists, never where it is stored, and lists where it was asked for and sent', async () => {
    const out = await teacherExportOf('p1')
    expect(JSON.stringify(out)).not.toContain('p1/aaaa.mp4')
    expect(out?.private).toEqual({ phone: '+84901234567', email: 'jane@example.com', cvFileName: 'cv.pdf', updatedAt: new Date(0), hasPrivateVideo: true })
    expect(out?.videoOnRequest).toBe(true)
    expect(out?.videoShares).toEqual(h.shares)
    expect(h.sharesWhere).toEqual({ conversation: { sellerProfileId: 'p1' } })
  })

  it('⛔ includes every job match about the teacher — score, reasons, concerns, the judge, emailed, staff status — with the job title', async () => {
    const out = await teacherExportOf('p1')
    expect(h.matchesArgs).toMatchObject({ where: { teacherProfileId: 'tp1' }, orderBy: { createdAt: 'desc' } })
    expect(h.matchesArgs?.select).toMatchObject({
      listingId: true, score: true, reasons: true, concerns: true, decision: true, modelVersions: true, staffStatus: true,
      createdAt: true, emailedAt: true, listing: { select: { title: true } },
    })
    expect(out?.matches).toEqual([{
      listingId: 'l1', score: 84, reasons: ['IELTS 8.0'], concerns: [], decision: 'match', staffStatus: null,
      modelVersions: { judge: 'claude-haiku-5-5', effort: 'medium', route: 'subscription', prompt: 'teachers-judge-v2' },
      createdAt: new Date(3), emailedAt: new Date(4), jobTitle: 'IELTS Instructor',
    }])
  })

  it('carries the consent evidence of each opt-in along with the row', async () => {
    const out = await teacherExportOf('p1')
    expect(out).toMatchObject({ matchEmailOptIn: true, matchEmailOptInAt: GRANT, matchEmailNoticeVersion: '2026-10-08', matchEmailWithdrawnAt: null })
  })

  it('no teacher profile: null', async () => {
    h.row = null
    expect(await teacherExportOf('p1')).toBeNull()
  })
})
