import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/report — the CONTENT targets (App Store gate `ugc-safety`, plan R5): `reviewId`, `commentId`
 * (a help-centre reply), `postId` (a member's help post).
 *
 * Gate OFF: the three fields mean nothing — a body naming only them answers 'Missing target' exactly as
 * before, and nothing is filed. Gate ON: exactly one well-formed id files a content case through
 * src/lib/reported-content.ts (tested there); the route only maps its outcome to the same four answers
 * every other surface gives. A listing / chat / storefront target always wins — content fields beside
 * one are ignored.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({
  filed: [] as Row[],
  outcome: { outcome: 'created', id: 'case-1' } as Row,
  me: { id: 'reporter-1', falseReportStrikes: 0, reportCooldownUntil: null } as Row | null,
  listings: new Map<string, Row>(),
}))

vi.mock('@/lib/admin', () => ({
  getAdmin: async () => null,
  getCurrentProfile: async () => h.me,
  getCurrentProfileId: async () => h.me?.id ?? null,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }) }))
vi.mock('@/lib/reported-content', () => ({
  fileContentReport: async (reporter: Row, target: Row, reason: string, detail: string | null) => { h.filed.push({ reporter: reporter.id, target, reason, detail }); return h.outcome },
}))
vi.mock('@/lib/dispute', () => ({ DISPUTE_WINDOW_MS: 1, notifyDispute: async () => {}, respondentProfileId: async () => null }))
vi.mock('@/lib/db', () => ({
  db: {
    listing: { findUnique: async ({ where }: Row) => h.listings.get(where.id) ?? null },
    report: {
      count: async () => 0,
      findFirst: async () => null,
      findMany: async () => [],
      create: async ({ data }: Row) => ({ id: 'listing-case', targetProfileId: data.targetProfileId, targetSellerId: data.targetSellerId }),
    },
    $executeRaw: async () => 1,
  },
}))

const { POST } = await import('./route')

async function report(body: Row) {
  const res = await POST(new Request('https://www.eno.forum/api/report', { method: 'POST', body: JSON.stringify(body) }) as never, {} as never)
  return { status: res.status, body: (await res.json()) as Row }
}

const REVIEW = 'cmreview0000001'

beforeEach(() => {
  h.filed = []
  h.outcome = { outcome: 'created', id: 'case-1' }
  h.me = { id: 'reporter-1', falseReportStrikes: 0, reportCooldownUntil: null }
  h.listings = new Map([['L1', { id: 'L1', sellerId: 'shop-1', seller: { ownerId: 'owner-1' } }]])
})
afterEach(() => vi.unstubAllEnvs())

describe('content targets with the gate OFF', () => {
  it('are ignored: the request answers Missing target, nothing is filed', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    for (const body of [{ reviewId: REVIEW }, { commentId: REVIEW }, { postId: REVIEW }]) {
      expect(await report({ ...body, reason: 'offensive' })).toEqual({ status: 400, body: { error: 'Missing target' } })
    }
    expect(h.filed).toEqual([])
  })
})

describe('content targets with the gate ON', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety'))

  it('files a review, a help reply and a help post as content cases (201 with the new case id)', async () => {
    expect(await report({ reviewId: REVIEW, reason: 'offensive', detail: '  slur  ' })).toEqual({ status: 201, body: { ok: true, id: 'case-1' } })
    await report({ commentId: 'cmcomment000001', reason: 'scam' })
    await report({ postId: 'cmpost000000001', reason: 'other' })
    expect(h.filed).toEqual([
      { reporter: 'reporter-1', target: { kind: 'review', id: REVIEW }, reason: 'offensive', detail: 'slur' },
      { reporter: 'reporter-1', target: { kind: 'help-comment', id: 'cmcomment000001' }, reason: 'scam', detail: null },
      { reporter: 'reporter-1', target: { kind: 'help-post', id: 'cmpost000000001' }, reason: 'other', detail: null },
    ])
  })

  it('maps the outcomes onto the answers every surface gives', async () => {
    h.outcome = { outcome: 'duplicate', id: 'case-7' }
    expect(await report({ reviewId: REVIEW, reason: 'offensive' })).toEqual({ status: 200, body: { ok: true, id: 'case-7' } })
    h.outcome = { outcome: 'suppressed' }
    expect(await report({ reviewId: REVIEW, reason: 'offensive' })).toEqual({ status: 200, body: { ok: true } })
    h.outcome = { outcome: 'cannot_report_self' }
    expect(await report({ reviewId: REVIEW, reason: 'offensive' })).toEqual({ status: 400, body: { error: 'cannot_report_self' } })
    h.outcome = { outcome: 'not_found' }
    expect(await report({ reviewId: REVIEW, reason: 'offensive' })).toEqual({ status: 404, body: { error: 'not_found' } })
  })

  it('needs exactly one well-formed id — two, or a malformed one, is a Missing target', async () => {
    expect((await report({ reviewId: REVIEW, commentId: 'cmcomment000001', reason: 'offensive' })).status).toBe(400)
    expect((await report({ reviewId: 'has_underscore_1', reason: 'offensive' })).status).toBe(400)
    expect((await report({ reviewId: { $ne: null }, reason: 'offensive' })).status).toBe(400)
    expect(h.filed).toEqual([])
  })

  it('a listing target wins: content fields beside it are ignored', async () => {
    const r = await report({ listingId: 'L1', reviewId: REVIEW, reason: 'scam' })
    expect(r.status).toBe(201)
    expect(r.body.id).toBe('listing-case')
    expect(h.filed).toEqual([])
  })

  it('the reason list still applies — and content takes only the three reasons the dialog offers', async () => {
    expect(await report({ reviewId: REVIEW, reason: 'banana' })).toEqual({ status: 400, body: { error: 'Invalid reason' } })
    for (const reason of ['counterfeit', 'sold', 'wrong-info', 'duplicate']) {
      expect(await report({ reviewId: REVIEW, reason }), reason).toEqual({ status: 400, body: { error: 'Invalid reason' } })
    }
    expect(h.filed).toEqual([])
  })
})
