import { beforeEach, describe, expect, it, vi } from 'vitest'

// GET /api/account/export — the self-serve copy of everything held about the caller (PDPL access right). Here: the
// consent records the account acted under are in it — the CV reading's (2026-10-15) and "Improve with AI" on the About
// text (2026-10-21): the notice version and its hash, counts and outcomes, never a word of the text — and only the
// caller's own. Every other section reads as empty (a stand-in database that answers nothing).
const h = vi.hoisted(() => ({
  signedIn: true,
  consentQuery: null as null | { where: { actorId: string; action: { in: string[] } }; orderBy: unknown; select: unknown },
  consentRows: [] as Array<{ action: string; occurredAt: Date; detail: unknown }>,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin', () => ({
  getCurrentProfile: async () => (h.signedIn ? { id: 'p1', email: 'a@example.com', trustScore: 0, trustTier: 'new', positiveInteractions: 0, falseReportStrikes: 0, enforcementState: null } : null),
  getCurrentProfileId: async () => (h.signedIn ? 'p1' : null),
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }) }))
vi.mock('@/lib/teachers/export', () => ({ teacherExportOf: async () => null }))
vi.mock('@/lib/teachers/draft', () => ({ teacherDraftExportOf: async () => null }))
vi.mock('@/lib/kyc/export', () => ({ identityVerificationExportOf: async () => null }))
vi.mock('@/lib/trust', () => ({ describeTrustEvent: () => '' }))
vi.mock('@/lib/db', () => {
  /** Any model, any read: nothing (null for a single row, [] for a list). */
  const empty = () => new Proxy({}, { get: (_t, method) => async () => (method === 'findUnique' || method === 'findFirst' ? null : []) })
  return {
    db: new Proxy({}, {
      get: (_t, model) => {
        if (model === '$queryRaw') return async () => []
        if (model === 'complianceAudit') return { findMany: async (q: NonNullable<typeof h.consentQuery>) => { h.consentQuery = q; return h.consentRows } }
        return empty()
      },
    }),
  }
})

const { GET } = await import('./route')

beforeEach(() => { h.signedIn = true; h.consentQuery = null; h.consentRows = [] })

describe('GET /api/account/export — the consent records', () => {
  it('selects the CV reading’s and the About rewrite’s records — the consent and the outcome of each — and the opt-ins a new profile left on by default, of this account only', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(h.consentQuery?.where.actorId).toBe('p1')
    expect(h.consentQuery?.where.action.in).toEqual(['teacher.import.consent', 'teacher.import.result', 'teacher.bio.consent', 'teacher.bio.result', 'teacher.optins.default'])
  })

  it('⚖️ a default left on (owner, 2026-10-22) is handed back like the others: which switch, under which AI notice', async () => {
    const at = new Date('2026-10-22T05:00:00.000Z')
    const detail = { matchEmail: true, staffCall: false, aiNotice: '2026-10-08', teacherProfileId: 'tp1' }
    h.consentRows = [{ action: 'teacher.optins.default', occurredAt: at, detail }]
    const body = await (await GET()).json()
    expect(body.consentRecords).toEqual([{ action: 'teacher.optins.default', at: at.toISOString(), detail }])
  })

  it('hands them back as stored, oldest first: the action, when, and the detail', async () => {
    const at = new Date('2026-10-21T08:00:00.000Z')
    h.consentRows = [
      { action: 'teacher.bio.consent', occurredAt: at, detail: { readId: 'r1', notice: '2026-10-21', noticeSha: '0123456789abcdef', facts: 9, ownText: true } },
      { action: 'teacher.bio.result', occurredAt: at, detail: { readId: 'r1', outcome: 'ok', model: 'gemini-3.8-flash', calls: 1, words: 72 } },
    ]
    const body = await (await GET()).json()
    expect(h.consentQuery?.orderBy).toEqual({ occurredAt: 'asc' })
    expect(body.consentRecords).toEqual([
      { action: 'teacher.bio.consent', at: at.toISOString(), detail: { readId: 'r1', notice: '2026-10-21', noticeSha: '0123456789abcdef', facts: 9, ownText: true } },
      { action: 'teacher.bio.result', at: at.toISOString(), detail: { readId: 'r1', outcome: 'ok', model: 'gemini-3.8-flash', calls: 1, words: 72 } },
    ])
  })

  it('signed out: nothing is read', async () => {
    h.signedIn = false
    expect((await GET()).status).toBe(401)
    expect(h.consentQuery).toBeNull()
  })
})
