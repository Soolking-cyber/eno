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
    // "Zalo for urgent cover" (2026-10-28): the schools that saw the number — its own test below.
    teacherZaloReveal: { findMany: async (args: { where: unknown }) => { zaloSeen.where = args.where; return zaloSeen.rows } },
  },
}))
const zaloSeen = vi.hoisted(() => ({ where: null as unknown, rows: [] as Array<{ viewerName: string; grantAt: Date; revealedAt: Date }> }))
const { teacherExportOf } = await import('./export')

const GRANT = new Date('2026-10-09T01:00:00Z')
const WITHDRAWN = new Date('2026-10-12T01:00:00Z')
beforeEach(() => {
  h.row = {
    id: 'tp1', fullName: 'Jane Doe', videoOnRequest: true, videoUrl: null,
    matchEmailOptIn: true, matchEmailOptInAt: GRANT, matchEmailNoticeVersion: '2026-10-08', matchEmailWithdrawnAt: null,
    identityMarkOn: false, identityMarkAt: GRANT, identityMarkNoticeVersion: '2026-10-16', identityMarkWithdrawnAt: WITHDRAWN,
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

  // "Identity verified" (AUTOMATIC since 2026-10-16): its four columns are the record of the teacher's own acts on its
  // switch — the last show, the last hide, the words beside it — never an opt-in consent (that is the identity
  // declaration). The access copy carries all four as stored, and LABELS them for what they record now.
  it('carries the "Identity verified" columns as stored — and labels them: hidden, shown again at, hidden at, words version', async () => {
    const out = await teacherExportOf('p1')
    expect(out).toMatchObject({ identityMarkOn: false, identityMarkAt: GRANT, identityMarkNoticeVersion: '2026-10-16', identityMarkWithdrawnAt: WITHDRAWN })
    expect(out?.identityMark).toEqual({ hidden: true, shownAgainAt: GRANT, hiddenAt: WITHDRAWN, wordsVersion: '2026-10-16' })
  })
  it('the label says what the rule says: untouched (false, NULL) is NOT hidden; shown again after a hide is not hidden', async () => {
    h.row = { ...h.row, identityMarkOn: false, identityMarkAt: null, identityMarkNoticeVersion: null, identityMarkWithdrawnAt: null }
    expect((await teacherExportOf('p1'))?.identityMark).toEqual({ hidden: false, shownAgainAt: null, hiddenAt: null, wordsVersion: null })
    h.row = { ...h.row, identityMarkOn: true, identityMarkAt: GRANT, identityMarkNoticeVersion: '2026-10-16-auto', identityMarkWithdrawnAt: WITHDRAWN }
    expect((await teacherExportOf('p1'))?.identityMark).toMatchObject({ hidden: false, shownAgainAt: GRANT, hiddenAt: WITHDRAWN })
  })

  it('no teacher profile: null', async () => {
    h.row = null
    expect(await teacherExportOf('p1')).toBeNull()
  })
})

describe('Zalo for urgent cover in the export (2026-10-28)', () => {
  it('carries the number, its grant and withdrawal, and every school that saw it — by name, never its account', async () => {
    const at = new Date('2026-10-28T03:00:00Z')
    h.row = { ...h.row, private: { phone: '0901234567', email: null, cvFileName: null, videoPath: null, updatedAt: at, coverZalo: '0901234567', coverZaloAt: at, coverZaloVersion: '2026-10-28', coverZaloWithdrawnAt: null, coverZaloInvitedAt: at } }
    zaloSeen.rows = [{ viewerName: 'School One', grantAt: at, revealedAt: at }]
    const out = await teacherExportOf('p1')
    expect(out?.coverZalo).toEqual({ number: '0901234567', grantedAt: at, noticeVersion: '2026-10-28', withdrawnAt: null, invitedAt: at, seenBy: zaloSeen.rows })
    expect(zaloSeen.where).toEqual({ teacherProfileId: 'tp1' })
  })
})
