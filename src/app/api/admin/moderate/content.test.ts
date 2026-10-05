import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/admin/moderate — CONTENT cases (App Store gate `ugc-safety`, plan R5): a report on a seller
 * review, a help reply or a member's help post. Such a case has NO target column (src/lib/reported-content.ts
 * says why), so Confirm docks nobody's trust and instead TAKES THE CONTENT DOWN. Pinned:
 *   · an OPEN content case is decided BY its takedown — the decision rides in the removal's transaction
 *     (`decide`), so the route writes no flip of its own; no trust dock, no appeal notice (no respondent);
 *   · a failed takedown answers 500 with nothing committed: no flip, nobody told — the next Confirm is an
 *     ordinary one, and the reporter hears "upheld" then, even if the content vanished meanwhile;
 *   · a case someone else decided meanwhile (`decided: false`) is left alone and nobody is told;
 *   · a repeat Confirm of a confirmed case re-runs the plain takedown (no `decide`) and tells nobody again;
 *   · an ordinary report never reaches the takedown (no query, exactly as before);
 *   · bulk-confirm: the same per case, its own batch kept open for it, the still-up ones named.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({
  report: null as Row | null,
  batch: [] as Row[],
  updateCount: 1,
  flips: [] as string[],
  takedowns: [] as string[],
  takedownOpts: [] as Row[],
  // Case ids whose takedown throws (nothing committed).
  throwIds: [] as string[],
  // Whether a takedown run finds the content still up (false: it was already gone).
  removed: true,
  fx: [] as string[],
}))

/** The case row a takedown would see — the batch row, else the single case. */
const rowOf = (id: string) => h.batch.find((r) => r.id === id) ?? h.report

vi.mock('@/lib/db', () => ({
  db: {
    report: {
      findUnique: async () => h.report,
      findMany: async () => h.batch,
      // The route's own open→confirmed flip (ordinary reports, and a content case already decided).
      updateMany: async ({ where }: Row) => {
        h.flips.push(where.id)
        const row = h.batch.find((r) => r.id === where.id)
        return { count: row && row.status !== 'open' ? 0 : h.updateCount }
      },
    },
    listing: { update: async () => ({}) },
    profile: { findUnique: async () => ({ locale: 'en' }) },
    notification: { create: async () => ({}) },
    trustEvent: { findMany: async () => [] },
  },
}))
vi.mock('@/lib/admin', () => ({ getAdmin: async () => 'mod@eno.vn', getCurrentProfile: async () => null, getCurrentProfileId: async () => null }))
vi.mock('@/lib/reported-content', () => ({
  // The real one decides inside its transaction; this fake decides iff the case is open.
  takeDownReportedContent: async (id: string, _admin: string, opts: Row = {}) => {
    h.takedowns.push(id)
    h.takedownOpts.push(opts)
    if (h.throwIds.includes(id)) throw new Error('takedown exploded')
    const decided = !!opts.decide && rowOf(id)?.status === 'open'
    if (opts.decide && !decided) return { pointer: `review:${id}`, removed: false, decided: false }
    return { pointer: `review:${id}`, removed: h.removed, decided }
  },
}))
vi.mock('@/lib/trust', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  applyTrustEvent: async () => { h.fx.push('applyTrustEvent'); return { score: 70, breakdown: {} } },
  penalizeSeller: async () => { h.fx.push('penalizeSeller') },
  chargedReportIds: async () => new Set<string>(),
}))
vi.mock('@/lib/enforcement', () => ({ syncEnforcement: async () => { h.fx.push('syncEnforcement') }, forgetPulledListings: async () => 0 }))
vi.mock('@/lib/dispute', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  notifyDispute: async (_p: string, _id: string, key: string) => { h.fx.push(`notifyDispute:${key}`) },
  respondentProfileId: async () => null,
}))
vi.mock('@/lib/supabase-admin', () => ({ getSupabaseAdmin: () => { throw new Error('no storage') }, EVIDENCE_BUCKET: 'evidence', LISTING_VIDEOS_BUCKET: 'videos' }))
vi.mock('@/lib/push', () => ({ sendPushToProfile: async () => 0 }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: () => {} }))
vi.mock('@/lib/listing-surfaces', () => ({ refreshListingSurfaces: async () => {} }))
vi.mock('@/lib/core/listing-tombstone', () => ({ tombstoneListingsTx: async () => [] }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ partitionByIdentityGate: async (ids: string[]) => ({ allowed: ids, held: [] }), settleHolds: async () => 0 }))

const { POST } = await import('./route')

async function act(body: Row) {
  const res = await POST(new Request('https://www.eno.forum/api/admin/moderate', { method: 'POST', body: JSON.stringify(body) }) as never, {} as never)
  return { status: res.status, text: await res.text() }
}

const CONTENT = { id: 'case-1', status: 'open', targetProfileId: null, targetSellerId: null, listingId: null, conversationId: null, severity: 'moderate', appealedAt: null, reporterProfileId: 'reporter-1' }

beforeEach(() => { h.report = { ...CONTENT }; h.batch = []; h.updateCount = 1; h.flips = []; h.takedowns = []; h.takedownOpts = []; h.throwIds = []; h.removed = true; h.fx = [] })

describe('confirm-report on a content case', () => {
  it('is decided BY the takedown (the decision rides in its transaction); nobody\'s trust is docked; the reporter hears it', async () => {
    expect(await act({ action: 'confirm-report', id: 'case-1', severity: 'severe' })).toEqual({ status: 200, text: '{"ok":true}' })
    expect(h.takedowns).toEqual(['case-1'])
    expect(h.takedownOpts[0].decide).toEqual({ status: 'confirmed', severity: 'severe', resolvedBy: 'mod@eno.vn', resolvedAt: expect.any(Date), decisionNote: null })
    // The route writes no flip of its own.
    expect(h.flips).toEqual([])
    expect(h.fx).toEqual(['notifyDispute:decided_upheld_reporter'])
  })

  it('a failed takedown answers 500 with nothing committed — no flip, nobody told; the next Confirm is ordinary', async () => {
    h.throwIds = ['case-1']
    expect(await act({ action: 'confirm-report', id: 'case-1' })).toEqual({ status: 500, text: '{"error":"takedown_failed","reportId":"case-1"}' })
    expect(h.flips).toEqual([])
    expect(h.fx).toEqual([])
    // Next time it works — and the reporter hears it even if the content vanished another way meanwhile.
    h.throwIds = []
    h.removed = false
    expect(await act({ action: 'confirm-report', id: 'case-1' })).toEqual({ status: 200, text: '{"ok":true}' })
    expect(h.fx).toEqual(['notifyDispute:decided_upheld_reporter'])
  })

  it('a case another moderator decided meanwhile is left alone — nobody is told', async () => {
    // The route read it as open; by the time the takedown's transaction ran, someone had dismissed it.
    h.batch = [{ ...CONTENT, status: 'dismissed' }]
    expect(await act({ action: 'confirm-report', id: 'case-1' })).toEqual({ status: 200, text: '{"ok":true}' })
    expect(h.flips).toEqual([])
    expect(h.fx).toEqual([])
  })

  it('a repeat Confirm of a confirmed case re-runs the plain takedown and tells nobody again', async () => {
    h.report = { ...CONTENT, status: 'confirmed' }
    h.updateCount = 0
    h.removed = false
    expect(await act({ action: 'confirm-report', id: 'case-1' })).toEqual({ status: 200, text: '{"ok":true}' })
    expect(h.takedowns).toEqual(['case-1'])
    expect(h.takedownOpts[0].decide).toBeUndefined()
    expect(h.fx).toEqual([])
  })

  it('…and if the content were somehow up again, that run removes it and the reporter hears it', async () => {
    h.report = { ...CONTENT, status: 'confirmed' }
    h.updateCount = 0
    h.removed = true
    expect(await act({ action: 'confirm-report', id: 'case-1' })).toEqual({ status: 200, text: '{"ok":true}' })
    expect(h.fx).toEqual(['notifyDispute:decided_upheld_reporter'])
  })

  it('a dismissed content case is never taken down by a stray Confirm', async () => {
    h.report = { ...CONTENT, status: 'dismissed' }
    h.updateCount = 0
    expect(await act({ action: 'confirm-report', id: 'case-1' })).toEqual({ status: 200, text: '{"ok":true}' })
    expect(h.takedowns).toEqual([])
  })
})

describe('an ordinary report never reaches the content takedown', () => {
  it('a chat report / a person report / a listing report', async () => {
    for (const r of [{ conversationId: 'c1', targetProfileId: 'p1' }, { targetProfileId: 'p1' }, { targetSellerId: 's1' }, { listingId: 'l1', targetSellerId: 's1' }]) {
      h.report = { ...CONTENT, ...r }
      await act({ action: 'confirm-report', id: 'case-1' })
    }
    expect(h.takedowns).toEqual([])
  })
})

describe('bulk-confirm', () => {
  it('decides each content case by its takedown; a failed one stays open and untold; a decided one is skipped', async () => {
    h.batch = [{ ...CONTENT, id: 'case-1' }, { ...CONTENT, id: 'case-2', targetProfileId: 'p1' }, { ...CONTENT, id: 'case-3', status: 'dismissed' }, { ...CONTENT, id: 'case-4' }]
    h.throwIds = ['case-1']
    const r = await act({ action: 'bulk-confirm', ids: ['case-1', 'case-2', 'case-3', 'case-4'] })
    expect(r.status).toBe(500)
    expect(JSON.parse(r.text)).toEqual({ error: 'takedown_failed', confirmed: 2, skipped: 2, stillPublic: [], contentStillUp: ['case-1'] })
    // Content cases go through the takedown (which decides them); only the person report flips in the route.
    expect(h.takedowns).toEqual(['case-1', 'case-3', 'case-4'])
    expect(h.flips).toEqual(['case-2'])
    // case-2 (person report) and case-4 (content, removed) are decided and their reporters told.
    expect(h.fx.filter((x) => x.startsWith('notifyDispute'))).toEqual(['notifyDispute:decided_upheld_reporter', 'notifyDispute:decided_upheld_reporter'])
  })

  it('leaves the batch\'s own cases to the batch — a sibling in it is confirmed by the loop, not skipped', async () => {
    h.batch = [{ ...CONTENT, id: 'case-1' }, { ...CONTENT, id: 'case-2' }]
    const r = await act({ action: 'bulk-confirm', ids: ['case-1', 'case-2'] })
    expect(JSON.parse(r.text)).toEqual({ ok: true, confirmed: 2, skipped: 0 })
    expect(h.takedownOpts.map((o) => o.keepOpen)).toEqual([['case-1', 'case-2'], ['case-1', 'case-2']])
  })
})
