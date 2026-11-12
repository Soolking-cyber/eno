import { beforeEach, describe, expect, it, vi } from 'vitest'

// GET /api/account/export — the self-serve copy of everything held about the caller (PDPL access right). Here: the
// consent records the account acted under are in it — the CV reading's (2026-10-15) and "Improve with AI" on the About
// text (2026-10-21): the notice version and its hash, counts and outcomes, never a word of the text — and only the
// caller's own. Every other section reads as empty (a stand-in database that answers nothing).
const h = vi.hoisted(() => ({
  signedIn: true,
  consentQuery: null as null | { where: { actorId: string; action: { in: string[] } }; orderBy: unknown; select: unknown },
  consentRows: [] as Array<{ action: string; occurredAt: Date; detail: unknown }>,
  savedQuery: null as null | { where: { profileId: string }; orderBy: unknown; select: unknown },
  savedRows: [] as Array<{ listingId: string; createdAt: Date }>,
  savedMissing: false,
  savedDown: false,
  /** Service deals (spec v3 A6): the queries made, the rows answered, and a table that is not there yet. */
  dealQuery: null as null | { where: unknown; select: Record<string, boolean> },
  dealEventQuery: null as null | { where: unknown; select: Record<string, boolean> },
  dealRows: [] as Array<Record<string, unknown>>,
  dealEventRows: [] as Array<Record<string, unknown>>,
  dealMissing: false,
  /** The storefront this person owns (db.seller.findUnique by ownerId), or none. */
  seller: null as null | { id: string },
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
        const missingDeal = () => Object.assign(new Error('relation "DealConfirmation" does not exist'), { code: 'P2021' })
        if (model === 'dealConfirmation') return { findMany: async (q: NonNullable<typeof h.dealQuery>) => { h.dealQuery = q; if (h.dealMissing) throw missingDeal(); return h.dealRows } }
        if (model === 'dealConfirmationEvent') return { findMany: async (q: NonNullable<typeof h.dealEventQuery>) => { h.dealEventQuery = q; if (h.dealMissing) throw missingDeal(); return h.dealEventRows } }
        if (model === 'complianceAudit') return { findMany: async (q: NonNullable<typeof h.consentQuery>) => { h.consentQuery = q; return h.consentRows } }
        if (model === 'seller') return { findUnique: async () => h.seller }
        if (model === 'savedListing') return {
          findMany: async (q: NonNullable<typeof h.savedQuery>) => {
            h.savedQuery = q
            if (h.savedMissing) throw Object.assign(new Error('relation "SavedListing" does not exist'), { code: 'P2021' })
            if (h.savedDown) throw new Error('connection terminated')
            return h.savedRows
          },
        }
        return empty()
      },
    }),
  }
})

const { GET } = await import('./route')
const { MODERATION_ACTOR_ID } = await import('@/lib/service-deal-server')

beforeEach(() => {
  h.signedIn = true; h.consentQuery = null; h.consentRows = []; h.savedQuery = null; h.savedRows = []; h.savedMissing = false; h.savedDown = false
  h.dealQuery = null; h.dealEventQuery = null; h.dealRows = []; h.dealEventRows = []; h.dealMissing = false; h.seller = null
})

describe('GET /api/account/export — service deals (spec v3 A6, 2026-11-11)', () => {
  it('every DealConfirmation naming the person as buyer or seller, and every event they acted in or were the buyer of — with their role, never the other person\'s id', async () => {
    const at = new Date('2026-11-11T08:00:00Z')
    h.dealRows = [
      { conversationId: 'c1', listingId: 'L1', kind: 'rental', confirmedAt: at, revokedAt: null, declinedAt: null, confirmCount: 1, reviewId: null, createdAt: at, buyerProfileId: 'p1', sellerProfileId: 'seller-x' },
      { conversationId: 'c2', listingId: 'L2', kind: 'lesson', confirmedAt: at, revokedAt: null, declinedAt: null, confirmCount: 1, reviewId: 'r1', createdAt: at, buyerProfileId: 'buyer-y', sellerProfileId: 'p1' },
    ]
    h.dealEventRows = [
      { conversationId: 'c1', listingId: 'L1', action: 'confirm', createdAt: at, actorProfileId: 'seller-x', buyerProfileId: 'p1' },
      { conversationId: 'c2', listingId: 'L2', action: 'confirm', createdAt: at, actorProfileId: 'p1', buyerProfileId: 'buyer-y' },
    ]
    const body = await (await GET()).json()
    expect(h.dealQuery?.where).toEqual({ OR: [{ buyerProfileId: 'p1' }, { sellerProfileId: 'p1' }] })
    expect(h.dealEventQuery?.where).toEqual({ OR: [{ actorProfileId: 'p1' }, { buyerProfileId: 'p1' }] })
    expect(body.serviceDeals.confirmations.map((d: { conversationId: string; role: string }) => [d.conversationId, d.role])).toEqual([['c1', 'buyer'], ['c2', 'seller']])
    expect(body.serviceDeals.events.map((e: { action: string; byYou: boolean; youWereTheBuyer: boolean }) => [e.action, e.byYou, e.youWereTheBuyer])).toEqual([['confirm', false, true], ['confirm', true, false]])
    expect(JSON.stringify(body.serviceDeals)).not.toMatch(/seller-x|buyer-y/)
  })

  it('⛔ a seller\'s export includes a moderator\'s undo on their own deal (actor = MODERATION_ACTOR_ID, not them): byModeration, never the admin', async () => {
    const at = new Date('2026-11-12T08:00:00Z')
    h.seller = { id: 'shop-1' }
    h.dealEventRows = [
      { conversationId: 'c2', listingId: 'L2', action: 'confirm', createdAt: at, actorProfileId: 'p1', buyerProfileId: 'buyer-y' },
      { conversationId: 'c2', listingId: 'L2', action: 'admin_withdraw', createdAt: at, actorProfileId: MODERATION_ACTOR_ID, buyerProfileId: 'buyer-y' },
    ]
    const body = await (await GET()).json()
    expect(h.dealEventQuery?.where).toEqual({ OR: [{ actorProfileId: 'p1' }, { buyerProfileId: 'p1' }, { sellerId: { in: ['shop-1'] }, action: 'admin_withdraw' }] })
    expect(body.serviceDeals.events.map((e: { action: string; byYou: boolean; byModeration: boolean; youWereTheBuyer: boolean }) => [e.action, e.byYou, e.byModeration, e.youWereTheBuyer]))
      .toEqual([['confirm', true, false, false], ['admin_withdraw', false, true, false]])
    expect(JSON.stringify(body.serviceDeals)).not.toContain(MODERATION_ACTOR_ID)
  })

  it('no storefront → the events read is exactly as before (actor or buyer), and every event says byModeration: false', async () => {
    const at = new Date('2026-11-12T08:00:00Z')
    h.dealEventRows = [{ conversationId: 'c1', listingId: 'L1', action: 'confirm', createdAt: at, actorProfileId: 'seller-x', buyerProfileId: 'p1' }]
    const body = await (await GET()).json()
    expect(h.dealEventQuery?.where).toEqual({ OR: [{ actorProfileId: 'p1' }, { buyerProfileId: 'p1' }] })
    expect(body.serviceDeals.events[0].byModeration).toBe(false)
  })

  it('no deal tables yet (or a failed read): null for each, said — the rest of the export still comes', async () => {
    h.dealMissing = true
    const r = await GET()
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.serviceDeals).toEqual({ confirmations: null, events: null })
    expect(body.account).toBeTruthy()
  })
})

describe('GET /api/account/export — saved listings (2026-11-09)', () => {
  it('every row the account holds, newest first, ids and dates only', async () => {
    h.savedRows = [{ listingId: 'l2', createdAt: new Date('2026-11-09T10:00:00Z') }, { listingId: 'l1', createdAt: new Date('2026-11-08T10:00:00Z') }]
    const body = await (await GET()).json()
    expect(h.savedQuery).toEqual({ where: { profileId: 'p1' }, orderBy: { createdAt: 'desc' }, select: { listingId: true, createdAt: true } })
    expect(body.savedListings).toEqual([{ listingId: 'l2', createdAt: '2026-11-09T10:00:00.000Z' }, { listingId: 'l1', createdAt: '2026-11-08T10:00:00.000Z' }])
  })
  it('no table yet: null, said — the rest of the export still comes', async () => {
    h.savedMissing = true
    const r = await GET()
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.savedListings).toBeNull()
    expect(body.account).toBeTruthy()
  })
  it('⛔ any other failure fails the export — never an incomplete copy that does not say so', async () => {
    h.savedDown = true
    await expect(GET()).rejects.toThrow('connection terminated')
  })
})

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
