import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * computeTrustV2 / recomputeTrust AGAINST A FAKE LEDGER — the audit 2026-09-23 fixes that live in
 * the DB wiring rather than in the pure math:
 *   #26 — a sale is timed by soldAt (updatedAt is restamped by any write), and the trust cascade
 *         must never restamp Listing.updatedAt (it used to, via listing.updateMany).
 *   #15 — a report_confirmed event stops counting once its report is resolved NOT-confirmed, and
 *         duplicate events for one report (a lost appeal re-confirms) charge once.
 *   #13 — the storefront mirror runs even when the PROFILE score did not change, guarded.
 * …and the LIVE identity (owner, 2026-10-15): V_KYC and rater credibility read identity_verifications through
 * verifiedProfileIds, and recomputeTrust lands the identity's step in full while it caps everything else (R1).
 * The db, the ranking writer and enforcement are stubbed; every call is recorded.
 */

type Row = Record<string, any>
const DAY = 86_400_000

const h = vi.hoisted(() => ({
  /** The Profile score write throws — the batch then rolls the identity_gate marker back with it. */
  profileUpdateFails: false,
  profile: null as Row | null,
  events: [] as Row[],
  reports: [] as Row[],
  seller: null as Row | null,
  ownedSellers: [] as Row[],
  sold: [] as Row[],
  acceptedOffers: [] as Row[],
  declined: [] as Row[],
  executeRawCount: 0,
  appealedReports: [] as Row[],
  chargedEvents: [] as Row[],
  sellerOwners: [] as Row[],
  /** identity_verifications rows (every profile's — the mock filters by `where.profileId.in`). */
  identity: [] as Row[],
  /** Rater profiles for the credibility lookup (profile.findMany). */
  raters: [] as Row[],
  /** Verified reviews of s1. */
  reviews: [] as Row[],
  /** The lifts already granted in the rolling 24h — the aggregate adds every h.events row its where selects. */
  lifted: 0,
  calls: [] as Array<{ m: string; args?: any }>,
}))

vi.mock('@/lib/db', () => {
  const rec = (m: string, args?: unknown) => { h.calls.push({ m, args }) }
  return {
    db: {
      profile: {
        findUnique: async (a: Row) => { rec('profile.findUnique', a); return h.profile },
        findMany: async (a: Row) => { rec('profile.findMany', a); return h.raters },
        update: async (a: Row) => { rec('profile.update', a); if (h.profileUpdateFails) throw new Error('profile write failed'); return {} },
        updateMany: async (a: Row) => { rec('profile.updateMany', a); return { count: 0 } },
      },
      // A batch transaction: every op runs, and if ANY rejects the batch rejects and its writes are rolled back — the
      // test marks them so `called()` stops counting them (Prisma's both-or-neither, modelled on the call log).
      $transaction: async (ops: Promise<unknown>[]) => {
        // The ops ran eagerly (these mocks are not lazy PrismaPromises): one recorded call each, the last ops.length.
        const mine = h.calls.slice(h.calls.length - ops.length)
        const settled = await Promise.allSettled(ops)
        rec('$transaction')
        const failed = settled.find((r) => r.status === 'rejected')
        if (failed) {
          for (const c of mine) c.m = `rolledBack:${c.m}`
          throw (failed as PromiseRejectedResult).reason
        }
        return settled.map((r) => (r as PromiseFulfilledResult<unknown>).value)
      },
      trustEvent: {
        findMany: async (a: Row) => {
          rec('trustEvent.findMany', a)
          // ⛔ TRIPWIRE: the dead 'kyc' ledger lookup (credibility and V both read it until 2026-10-15). Its only writer
          // was never called; the identity is read LIVE now, and asking the ledger again is the regression.
          if (a?.where?.reason === 'kyc') throw new Error("tripwire: trust read the dead 'kyc' ledger event")
          if (a?.where?.reportId) return h.chargedEvents
          return h.events
        },
        // ⚠️ THE CAP'S WINDOW, HONOURED — NOT A CONSTANT (review, 2026-10-16). It used to answer h.lifted whatever the
        // where said, so a cap that summed the identity_gate markers too passed every test here — and in production an
        // ON marker (+10) would spend the day's allowance after every approval, an OFF marker (−10) refund it. Now
        // h.lifted (the window's earlier lifts) plus every h.events row the where selects, by type and createdAt.
        aggregate: async (a: Row) => {
          rec('trustEvent.aggregate', a)
          const w = a?.where ?? {}
          const typeOk = (t: string) => w.type === undefined || (typeof w.type === 'string' ? t === w.type : (w.type.in ?? []).includes(t))
          const after: number = w.createdAt?.gt instanceof Date ? w.createdAt.gt.getTime() : -Infinity
          const inWindow = h.events.filter((e) => typeOk(e.type) && e.createdAt.getTime() > after)
          return { _sum: { delta: h.lifted + inWindow.reduce((s, e) => s + e.delta, 0) } }
        },
        create: async (a: Row) => { rec('trustEvent.create', a); return {} },
        createMany: async (a: Row) => { rec('trustEvent.createMany', a); return { count: a.data.length } },
        count: async (a: Row) => { rec('trustEvent.count', a); return 0 },
      },
      identityVerification: {
        findMany: async (a: Row) => {
          rec('identityVerification.findMany', a)
          const ids: string[] = a?.where?.profileId?.in ?? []
          return h.identity.filter((r) => ids.includes(r.profileId))
        },
      },
      report: {
        findMany: async (a: Row) => {
          rec('report.findMany', a)
          return a?.where?.appealedAt ? h.appealedReports : h.reports
        },
      },
      seller: {
        findUnique: async (a: Row) => { rec('seller.findUnique', a); return h.seller },
        findMany: async (a: Row) => {
          rec('seller.findMany', a)
          return a?.where?.ownerId ? h.ownedSellers : h.sellerOwners
        },
        updateMany: async (a: Row) => { rec('seller.updateMany', a); return { count: 1 } },
      },
      review: { findMany: async () => h.reviews },
      conversation: { count: async () => 0 },
      message: { findMany: async () => h.acceptedOffers },
      listing: {
        count: async () => 0,
        // The sold query answers h.sold; the buyer-denied query (saleDeclinedAt: { not: null }) answers h.declined.
        findMany: async (a: Row) => { rec('listing.findMany', a); return a?.where?.saleDeclinedAt && 'not' in a.where.saleDeclinedAt ? h.declined : h.sold },
        updateMany: async (a: Row) => { rec('listing.updateMany', a); return { count: 0 } },
      },
      $executeRaw: async (q: any) => { rec('$executeRaw', q); return h.executeRawCount },
    },
  }
})
vi.mock('@/lib/ranking', () => ({
  recomputeRankScoreForSeller: async (id: string) => { h.calls.push({ m: 'recomputeRankScoreForSeller', args: id }) },
}))
vi.mock('@/lib/seller-metrics', () => ({ RESPONSE_METRIC_IS_REAL: true }))
vi.mock('@/lib/enforcement', () => ({
  expireEnforcement: async () => 0,
  flagForReview: async () => false,
  syncEnforcement: async (...a: unknown[]) => { h.calls.push({ m: 'syncEnforcement', args: a }) },
}))
// ⛔ CACHE TRIPWIRE (the on-verified.test.ts pattern): the REAL verifiedProfileIds, and the request-memoised reads
// throwing. A recompute in the request that approved or revoked must see that decision, so trust may never ask the
// cache()-wrapped verifiedIdentityFor / hasVerifiedIdentity.
vi.mock('@/lib/kyc/identity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/kyc/identity')>()),
  verifiedIdentityFor: () => { throw new Error('tripwire: trust read the request-memoised verifiedIdentityFor') },
  hasVerifiedIdentity: () => { throw new Error('tripwire: trust read the request-memoised hasVerifiedIdentity') },
}))

import { applyTrustEvent, computeTrustV2, initialSellerTrust, recomputeTrust, settleReportCharges } from './trust'
import { GUEST_SELLER_TRUST, IDENTITY_GATE_EVENT, IDENTITY_GATE_OFF, IDENTITY_GATE_ON, TRUST, reviewScore } from './trust-math'

const called = (m: string) => h.calls.filter((c) => c.m === m)
const sqlText = (q: any): string => (Array.isArray(q?.strings) ? q.strings.join('?') : String(q?.sql ?? q))

beforeEach(() => {
  h.profileUpdateFails = false
  const now = Date.now()
  h.profile = { createdAt: new Date(now - 400 * DAY), phone: '+84900000000', trustScore: 60, trustTier: 'standard' }
  h.events = []
  h.reports = []
  h.seller = { id: 's1', responseRate: 100, responseMetricAt: null }
  h.ownedSellers = [{ id: 's1', trustScore: 60, trustTier: 'standard' }]
  h.sold = []
  h.acceptedOffers = []
  h.declined = []
  h.executeRawCount = 0
  h.appealedReports = []
  h.chargedEvents = []
  h.sellerOwners = []
  h.identity = []
  h.raters = []
  h.reviews = []
  h.lifted = 0
  h.calls = []
})

const confirmed = (reportId: string, ageDays: number, delta = -18) =>
  ({ type: 'report_confirmed', delta, reason: `report:${reportId}`, reportId, createdAt: new Date(Date.now() - ageDays * DAY) })

describe('#26 — sale timing ignores a restamped updatedAt', () => {
  it('sales that happened BEFORE a scam keep the hard hold, even when updatedAt was restamped after it', async () => {
    h.events = [confirmed('r1', 2, -45)]
    h.reports = [{ id: 'r1', severity: 'severe', reporterProfileId: null, status: 'confirmed', remediatedAt: null }]
    // Five sales a month ago, every row's updatedAt restamped yesterday (the old cascade).
    h.sold = Array.from({ length: 5 }, (_, i) => ({ id: `l${i}`, soldAt: new Date(Date.now() - 30 * DAY), updatedAt: new Date(Date.now() - DAY) }))
    const b = await computeTrustV2('p1')
    expect(b?.inputs.hasScamHold).toBe(true)
  })

  // ⛔ INVERTED 2026-09-23. This test used to assert the OPPOSITE ("five sales genuinely after the
  // scam still pay the dues") — and "genuinely" was the flaw: a `sold` row is the seller's own
  // claim. A held seller marked five pulled listings sold and walked out within the day.
  it('⛔ five sales the seller marked AFTER the scam no longer end the hold', async () => {
    h.events = [confirmed('r1', 20, -45)]
    h.reports = [{ id: 'r1', severity: 'severe', reporterProfileId: null, status: 'confirmed', remediatedAt: null }]
    h.sold = Array.from({ length: 5 }, (_, i) => ({ id: `l${i}`, soldAt: new Date(Date.now() - (10 - i) * DAY), updatedAt: new Date(Date.now() - DAY) }))
    const b = (await computeTrustV2('p1'))!
    expect(b.inputs.hasScamHold).toBe(true)
    expect(b.inputs.transactions365).toBe(5) // they still count as track record — just not as an exit
    expect(b.C).toBe(45 * TRUST.CRED_DEFAULT) // and the charge is still frozen at full weight
  })

  it('a sold row with no soldAt falls back to updatedAt (track record)', async () => {
    h.sold = Array.from({ length: 5 }, (_, i) => ({ id: `l${i}`, soldAt: null, updatedAt: new Date(Date.now() - (10 - i) * DAY) }))
    expect((await computeTrustV2('p1'))?.inputs.transactions365).toBe(5)
  })

  it('the sold query is windowed on soldAt, with updatedAt only for rows that have none', async () => {
    await computeTrustV2('p1')
    const where = called('listing.findMany')[0].args.where
    expect(where.updatedAt).toBeUndefined()
    expect(where.OR).toEqual([{ soldAt: { gte: expect.any(Date) } }, { soldAt: null, updatedAt: { gte: expect.any(Date) } }])
  })

  it('⛔ a denied deal does not score through its accepted offer either — the same deal is not counted twice over', async () => {
    h.sold = [{ id: 'l2', soldAt: new Date(Date.now() - 10 * DAY), updatedAt: new Date() }] // the DB already left out denied l1
    h.declined = [{ id: 'l1', soldToProfileId: 'buyerB' }]
    h.acceptedOffers = [
      { createdAt: new Date(Date.now() - 12 * DAY), conversation: { listingId: 'l1', buyerProfileId: 'buyerB' } }, // the denied deal's offer
      { createdAt: new Date(Date.now() - 5 * DAY), conversation: { listingId: 'l3', buyerProfileId: 'buyerC' } }, // an untouched deal
    ]
    expect((await computeTrustV2('p1'))?.inputs.transactions365).toBe(2) // l2 + l3, never l1
  })

  it('…but ANOTHER buyer\'s accepted offer on that listing is a different deal and still counts (a mis-named buyer)', async () => {
    h.sold = []
    h.declined = [{ id: 'l1', soldToProfileId: 'buyerB' }]
    h.acceptedOffers = [{ createdAt: new Date(Date.now() - 12 * DAY), conversation: { listingId: 'l1', buyerProfileId: 'buyerA' } }]
    expect((await computeTrustV2('p1'))?.inputs.transactions365).toBe(1)
  })

  it('⛔ a sale the buyer DENIED is no transaction; unconfirmed sales still count (owner, 2026-10-06)', async () => {
    await computeTrustV2('p1')
    const where = called('listing.findMany')[0].args.where
    expect(where.saleDeclinedAt).toBeNull()
    expect(where.saleConfirmedAt).toBeUndefined() // NOT confirmed-only — that would zero every track record
    expect(where.status).toBe('sold')
  })

  it('the trust cascade never goes through listing.updateMany (which restamps updatedAt)', async () => {
    h.profile!.trustScore = 90 // the recompute lands lower → a real score change
    h.ownedSellers = [{ id: 's1', trustScore: 90, trustTier: 'standard' }]
    h.executeRawCount = 3
    await recomputeTrust('p1')
    expect(called('listing.updateMany')).toHaveLength(0)
    const raw = called('$executeRaw')
    expect(raw).toHaveLength(1)
    const text = sqlText(raw[0].args)
    expect(text).toContain('"sellerTrustScore"')
    expect(text).toContain('IS DISTINCT FROM')
    expect(text).not.toContain('updatedAt')
    expect(called('recomputeRankScoreForSeller')).toHaveLength(1) // 3 listings moved → re-rank
  })
})

describe('#15 — appeal outcomes in the conduct ledger', () => {
  const report = (status: string) => ({ id: 'r1', severity: 'moderate', reporterProfileId: null, status, remediatedAt: null })

  it('a WON appeal (report dismissed) drops the penalty', async () => {
    h.events = [confirmed('r1', 5)]
    h.reports = [report('dismissed')]
    expect((await computeTrustV2('p1'))?.C).toBe(0)
  })

  it('abusive and overturned drop it too', async () => {
    for (const st of ['abusive', 'overturned']) {
      h.events = [confirmed('r1', 5)]
      h.reports = [report(st)]
      expect((await computeTrustV2('p1'))?.C).toBe(0)
    }
  })

  it('an appeal that is merely OPEN keeps the penalty', async () => {
    h.events = [confirmed('r1', 5)]
    h.reports = [report('open')]
    expect((await computeTrustV2('p1'))?.C).toBeGreaterThan(0)
  })

  it('a won appeal stays won after the Report row is cascade-deleted with its listing (ledger marker)', async () => {
    const marker = { type: 'report_dismissed', delta: 0, reason: 'reversed:appeal_won', reportId: 'r1', createdAt: new Date(Date.now() - DAY) }
    h.events = [confirmed('r1', 5, -45), marker]
    h.reports = [] // the row is gone — its 'dismissed' status can no longer be read
    const b = (await computeTrustV2('p1'))!
    expect(b.C).toBe(0)
    expect(b.inputs.hasScamHold).toBe(false)
    // Without the marker the same ledger charges in full — the regression this closes.
    h.events = [confirmed('r1', 5, -45)]
    expect((await computeTrustV2('p1'))!.inputs.hasScamHold).toBe(true)
  })

  it('a report_dismissed row WITHOUT the reversal prefix cancels nothing', async () => {
    h.events = [confirmed('r1', 5), { type: 'report_dismissed', delta: 0, reason: null, reportId: 'r1', createdAt: new Date() }]
    h.reports = [report('confirmed')]
    expect((await computeTrustV2('p1'))!.C).toBeGreaterThan(0)
  })

  it('an appealed confirmed report the REPORTER withdrew keeps its charge (no admin ruled)', async () => {
    h.events = [confirmed('r1', 5)]
    h.reports = [{ ...report('dismissed'), resolvedBy: 'withdrawn-by-reporter' }]
    expect((await computeTrustV2('p1'))!.C).toBeGreaterThan(0)
  })

  it('a LOST appeal (second report_confirmed for the same report) charges once', async () => {
    h.reports = [report('confirmed')]
    h.events = [confirmed('r1', 5)]
    const once = (await computeTrustV2('p1'))!
    h.events = [confirmed('r1', 5), confirmed('r1', 1)]
    const twice = (await computeTrustV2('p1'))!
    expect(twice.C).toBeCloseTo(once.C, 4) // two computes a few ms apart decay by ~1e-9
    expect(twice.inputs.reports90.count).toBe(1)
  })
})

describe('#13 — the storefront mirror runs even when the profile is unchanged', () => {
  // Put the Profile exactly where the composite lands, so the recompute is a PROFILE no-op.
  // Uncapped throughout: the +6/24h lift cap would otherwise walk the score up run by run.
  const settleProfile = async () => {
    const first = (await recomputeTrust('p1', { uncapped: true }))!
    h.profile!.trustScore = first.score
    h.profile!.trustTier = first.tier
    h.calls = []
  }

  it('a storefront stuck at the v1 default is re-synced with no profile change', async () => {
    await settleProfile()
    h.ownedSellers = [{ id: 's1', trustScore: 100, trustTier: 'standard' }]
    h.executeRawCount = 2
    const r = await recomputeTrust('p1', { uncapped: true })
    expect(r?.score).toBe(h.profile!.trustScore) // the composite landed where the profile already was
    expect(called('profile.update')).toHaveLength(0)
    const upd = called('seller.updateMany')
    expect(upd).toHaveLength(1)
    expect(upd[0].args.data).toEqual({ trustScore: r!.score, trustTier: r!.tier })
    expect(upd[0].args.where.id).toEqual({ in: ['s1'] })
    expect(called('$executeRaw')).toHaveLength(1)
    expect(called('recomputeRankScoreForSeller')).toHaveLength(1)
  })

  it('an in-sync storefront costs no seller write and no re-rank', async () => {
    await settleProfile()
    h.ownedSellers = [{ id: 's1', trustScore: h.profile!.trustScore, trustTier: h.profile!.trustTier }]
    await recomputeTrust('p1', { uncapped: true })
    expect(called('profile.update')).toHaveLength(0)
    expect(called('seller.updateMany')).toHaveLength(0)
    expect(called('recomputeRankScoreForSeller')).toHaveLength(0) // $executeRaw matched 0 rows
  })

  it('initialSellerTrust: the owner\'s current values, else the guest base (never 100)', async () => {
    h.profile = { trustScore: 72, trustTier: 'standard' }
    expect(await initialSellerTrust('p1')).toEqual({ trustScore: 72, trustTier: 'standard' })
    h.profile = null
    expect(await initialSellerTrust('gone')).toEqual({ ...GUEST_SELLER_TRUST })
    expect(await initialSellerTrust(null)).toEqual({ trustScore: TRUST.BASE, trustTier: 'standard' })
  })
})

describe('#15 — settleReportCharges re-derives exactly the charged profiles', () => {
  it('recomputes (uncapped) + syncs enforcement for the subject the report charged', async () => {
    h.appealedReports = [{ id: 'r1', targetProfileId: 'p1', targetSellerId: null, status: 'dismissed', resolvedBy: 'mod@eno.vn' }]
    h.chargedEvents = [{ subjectProfileId: 'p1', reportId: 'r1', type: 'report_confirmed', reason: null, createdAt: new Date('2026-09-01T00:00:00Z') }]
    expect(await settleReportCharges(['r1'])).toBe(1)
    const sync = called('syncEnforcement')
    expect(sync).toHaveLength(1)
    expect(sync[0].args[0]).toBe('p1')
    // uncapped: no daily-cap aggregate read even though the score is free to rise
    expect(called('trustEvent.aggregate')).toHaveLength(0)
    // …and the reversal is written to the LEDGER, where a later listing delete cannot erase it.
    const marks = called('trustEvent.createMany')
    expect(marks).toHaveLength(1)
    expect(marks[0].args.data).toEqual([{ subjectProfileId: 'p1', reportId: 'r1', type: 'report_dismissed', delta: 0, reason: 'reversed:appeal_won' }])
  })

  it('a REPORTER-withdrawn appealed report is not a won appeal: no marker, no re-derive', async () => {
    h.appealedReports = [{ id: 'r1', targetProfileId: 'p1', targetSellerId: null, status: 'dismissed', resolvedBy: 'withdrawn-by-reporter' }]
    h.chargedEvents = [{ subjectProfileId: 'p1', reportId: 'r1', type: 'report_confirmed', reason: null, createdAt: new Date('2026-09-01T00:00:00Z') }]
    expect(await settleReportCharges(['r1'])).toBe(0)
    expect(called('trustEvent.createMany')).toHaveLength(0)
    expect(called('syncEnforcement')).toHaveLength(0)
  })

  it('an ordinary (never-appealed) dismissal does nothing beyond one read', async () => {
    expect(await settleReportCharges(['r9'])).toBe(0)
    expect(called('trustEvent.findMany')).toHaveLength(0)
    expect(called('syncEnforcement')).toHaveLength(0)
  })

  // ⚠️ One marker per CHARGE: the same won appeal can be settled twice (approve, then dismiss-report),
  // and each marker is a line in the user's PDPL export.
  it('a charge already reversed gets no second marker', async () => {
    h.appealedReports = [{ id: 'r1', targetProfileId: 'p1', targetSellerId: null, status: 'dismissed', resolvedBy: 'mod@eno.vn' }]
    h.chargedEvents = [
      { subjectProfileId: 'p1', reportId: 'r1', type: 'report_confirmed', reason: null, createdAt: new Date('2026-09-01T00:00:00Z') },
      { subjectProfileId: 'p1', reportId: 'r1', type: 'report_dismissed', reason: 'reversed:appeal_won', createdAt: new Date('2026-09-02T00:00:00Z') },
    ]
    await settleReportCharges(['r1'])
    expect(called('trustEvent.createMany')).toHaveLength(0)
  })

  it('a re-confirmation AFTER a reversal is a new charge, and is reversed again', async () => {
    h.appealedReports = [{ id: 'r1', targetProfileId: 'p1', targetSellerId: null, status: 'dismissed', resolvedBy: 'mod@eno.vn' }]
    h.chargedEvents = [
      { subjectProfileId: 'p1', reportId: 'r1', type: 'report_confirmed', reason: null, createdAt: new Date('2026-09-01T00:00:00Z') },
      { subjectProfileId: 'p1', reportId: 'r1', type: 'report_dismissed', reason: 'reversed:appeal_won', createdAt: new Date('2026-09-02T00:00:00Z') },
      { subjectProfileId: 'p1', reportId: 'r1', type: 'report_confirmed', reason: null, createdAt: new Date('2026-09-03T00:00:00Z') },
    ]
    await settleReportCharges(['r1'])
    const marks = called('trustEvent.createMany')
    expect(marks).toHaveLength(1)
    expect(marks[0].args.data).toEqual([{ subjectProfileId: 'p1', reportId: 'r1', type: 'report_dismissed', delta: 0, reason: 'reversed:appeal_won' }])
  })

  it('an appealed report with no ledger charge re-derives nobody', async () => {
    h.appealedReports = [{ id: 'r1', targetProfileId: 'p1', targetSellerId: null, status: 'dismissed', resolvedBy: 'mod@eno.vn' }]
    h.chargedEvents = []
    expect(await settleReportCharges(['r1'])).toBe(0)
    expect(called('trustEvent.createMany')).toHaveLength(0)
    expect(called('syncEnforcement')).toHaveLength(0)
  })
})

describe('the scam hold ends only by a human (2026-09-23)', () => {
  const severe = { id: 'r1', severity: 'severe', reporterProfileId: null, status: 'confirmed', remediatedAt: null }
  const release = (key: string, ageDays: number) =>
    ({ id: `m-${key}`, type: 'manual_adjust', delta: 0, reason: `scam_release:${key}`, reportId: key.startsWith('event:') ? null : key, createdAt: new Date(Date.now() - ageDays * DAY) })

  it('an admin release marker written AFTER the confirmation ends the hold — and only the hold', async () => {
    h.events = [confirmed('r1', 20, -45), release('r1', 1)]
    h.reports = [severe]
    const b = (await computeTrustV2('p1'))!
    expect(b.inputs.hasScamHold).toBe(false)
    expect(b.inputs.scamCharges).toEqual([{ key: 'r1', reportId: 'r1', confirmedAtMs: expect.any(Number), stage: 'released' }])
    // A release is not a pardon: C keeps the full, frozen charge; the delta-0 marker adds nothing to M.
    expect(b.C).toBe(45 * TRUST.CRED_DEFAULT)
    expect(b.M).toBe(0)
  })

  it('a marker OLDER than the confirmation releases nothing', async () => {
    h.events = [confirmed('r1', 5, -45), release('r1', 10)]
    h.reports = [severe]
    const b = (await computeTrustV2('p1'))!
    expect(b.inputs.hasScamHold).toBe(true)
    expect(b.inputs.scamCharges[0].stage).toBe('held')
  })

  it('a release of ONE charge leaves another charge holding', async () => {
    h.events = [confirmed('r1', 20, -45), confirmed('r2', 3, -45), release('r1', 1)]
    h.reports = [severe, { ...severe, id: 'r2' }]
    const b = (await computeTrustV2('p1'))!
    expect(b.inputs.hasScamHold).toBe(true)
    expect(b.inputs.scamCharges.map((c) => [c.key, c.stage]).sort()).toEqual([['r1', 'released'], ['r2', 'held']])
  })

  it('accepted offers do not end it either', async () => {
    h.events = [confirmed('r1', 20, -45)]
    h.reports = [severe]
    h.acceptedOffers = Array.from({ length: 6 }, (_, i) => ({ createdAt: new Date(Date.now() - i * DAY), conversation: { listingId: `o${i}` } }))
    const b = (await computeTrustV2('p1'))!
    expect(b.inputs.transactions365).toBe(6)
    expect(b.inputs.hasScamHold).toBe(true)
  })

  it('a legacy charge with no report is releasable by its event key', async () => {
    const legacy = { id: 'ev-legacy', type: 'report_confirmed', delta: -25, reason: 'legacy', reportId: null, createdAt: new Date(Date.now() - 30 * DAY) }
    h.events = [legacy]
    expect((await computeTrustV2('p1'))!.inputs.scamCharges).toEqual([{ key: 'event:ev-legacy', reportId: null, confirmedAtMs: expect.any(Number), stage: 'held' }])
    h.events = [legacy, release('event:ev-legacy', 1)]
    expect((await computeTrustV2('p1'))!.inputs.hasScamHold).toBe(false)
  })

  it('the transaction window is T\'s trailing year, no longer stretched back to the oldest scam', async () => {
    h.events = [confirmed('r1', 800, -45)]
    h.reports = [severe]
    await computeTrustV2('p1')
    const since = called('listing.findMany')[0].args.where.OR[0].soldAt.gte as Date
    expect(Date.now() - since.getTime()).toBeLessThan(366 * DAY)
  })
})

/**
 * ⛔ IDENTITY COUNTS LIVE (owner, 2026-10-15): "a live verified identity counts in trust (+10) for every seller, on both
 * editions — flat while current, gone on expiry or revocation, no penalty". V_KYC and rater credibility read
 * identity_verifications through verifiedProfileIds (the real one, over the faked rows) — never the Profile cache,
 * never a 'kyc' ledger event (the trustEvent mock throws on that read), never the request-memoised reads (the identity
 * mock throws on those). Base fixture: a 400-day-old account with a verified phone and no storefront activity —
 * 60 + V 15 (phone + age) + freshness 5 = 80 without the identity, 90 with it.
 */
describe('⛔ identity counts LIVE — computeTrustV2', () => {
  let seq = 0
  const iv = (status: string, over: Row = {}): Row => ({
    id: `iv-${++seq}`, profileId: 'p1', tier: 'B', method: 'passport_mrz', status,
    decidedAt: new Date(Date.now() - 10 * DAY), documentExpiresAt: new Date(Date.now() + 365 * DAY), assuranceLevel: null, ...over,
  })
  // An ICT clock for the document-expiry cases: noon on 2026-10-15 in Saigon.
  const NOON_ICT = new Date('2026-10-15T12:00:00+07:00')
  afterEach(() => { vi.useRealTimers() })

  it('a verified row → kycVerified, V 25, score 90 — asked by profile id, from the rows', async () => {
    h.identity = [iv('verified')]
    const b = (await computeTrustV2('p1'))!
    expect(b.inputs.kycVerified).toBe(true)
    expect(b.V).toBe(25)
    expect(b.score).toBe(90)
    expect(b.inputs.scoreWithoutIdentity).toBe(80)
    expect(b.inputs.identityWorth).toBe(TRUST.V_KYC)
    expect(called('identityVerification.findMany')[0].args.where).toEqual({ profileId: { in: ['p1'] } })
  })

  it.each([
    ['no identity row at all', () => []],
    ['a pending submission only', () => [iv('pending', { decidedAt: null })]],
    ['a rejection only', () => [iv('rejected')]],
  ])('%s → not counted: V 15, score 80', async (_label, rows) => {
    h.identity = rows()
    const b = (await computeTrustV2('p1'))!
    expect(b.inputs.kycVerified).toBe(false)
    expect(b.V).toBe(15)
    expect(b.score).toBe(80)
    // The step is still known — a lapse needs it to take the identity OUT of a cached score.
    expect(b.inputs.identityWorth).toBe(TRUST.V_KYC)
  })

  it('a verified row beside a REVOKED one → not counted (revocation outranks everything)', async () => {
    h.identity = [iv('verified'), iv('revoked', { decidedAt: new Date(Date.now() - DAY) })]
    expect((await computeTrustV2('p1'))!.inputs.kycVerified).toBe(false)
  })

  it('the document clock is ICT and generous to the last day: lapsed yesterday → off; expiring today → on', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOON_ICT)
    h.identity = [iv('verified', { decidedAt: new Date('2025-01-10T00:00:00+07:00'), documentExpiresAt: new Date('2026-10-14T00:00:00+07:00') })]
    expect((await computeTrustV2('p1'))!.inputs.kycVerified).toBe(false)
    h.identity = [iv('verified', { decidedAt: new Date('2025-01-10T00:00:00+07:00'), documentExpiresAt: new Date('2026-10-15T00:00:00+07:00') })]
    expect((await computeTrustV2('p1'))!.inputs.kycVerified).toBe(true)
  })

  it('a citizen ID with NO expiry (tier A, CCCD) → on', async () => {
    h.identity = [iv('verified', { tier: 'A', method: 'vneid', documentExpiresAt: null })]
    expect((await computeTrustV2('p1'))!.inputs.kycVerified).toBe(true)
  })

  it('a verification survives a LATER rejection (a resubmission is additive) → on', async () => {
    h.identity = [iv('verified', { decidedAt: new Date(Date.now() - 30 * DAY) }), iv('rejected', { decidedAt: new Date(Date.now() - DAY) })]
    expect((await computeTrustV2('p1'))!.inputs.kycVerified).toBe(true)
  })

  it('flat: tier A and tier B are both exactly +10', async () => {
    for (const tier of ['A', 'B']) {
      h.identity = [iv('verified', { tier })]
      const b = (await computeTrustV2('p1'))!
      expect(b.score - b.inputs.scoreWithoutIdentity, tier).toBe(10)
      expect(b.V, tier).toBe(25)
    }
  })

  it("⛔ a lone legacy 'kyc' ledger row counts for NOTHING — not in V, not in M", async () => {
    h.events = [{ type: 'manual_adjust', delta: 10, reason: 'kyc', reportId: null, createdAt: new Date(Date.now() - 5 * DAY) }]
    const b = (await computeTrustV2('p1'))!
    expect(b.inputs.kycVerified).toBe(false)
    expect(b.V).toBe(15)
    expect(b.M).toBe(0)
    expect(b.score).toBe(80)
  })

  it('a RATER\'s live identity moves their credibility: CRED_DEFAULT → CRED_FULL on the review they wrote', async () => {
    h.reviews = [{ rating: 5, authorProfileId: 'r1', createdAt: new Date(Date.now() - 5 * DAY) }]
    // 60 days old, score 90: full weight needs a live identity (or 180 days) — otherwise the default.
    h.raters = [{ id: 'r1', trustScore: 90, createdAt: new Date(Date.now() - 60 * DAY), falseReportStrikes: 0 }]
    const fresh = TRUST.FRESH_MAX
    const without = (await computeTrustV2('p1'))!
    expect(without.Q - fresh).toBeCloseTo(reviewScore([{ rating: 5, weight: TRUST.CRED_DEFAULT }]), 10)
    h.identity = [iv('verified', { profileId: 'r1' })]
    h.calls = []
    const withId = (await computeTrustV2('p1'))!
    expect(withId.Q - fresh).toBeCloseTo(reviewScore([{ rating: 5, weight: TRUST.CRED_FULL }]), 10)
    // The seller is not verified — only the rater is.
    expect(withId.inputs.kycVerified).toBe(false)
    // One identity read for the seller, one batched read for the raters — and never the 'kyc' ledger (it throws).
    expect(called('identityVerification.findMany').map((c) => c.args.where)).toEqual(expect.arrayContaining([{ profileId: { in: ['p1'] } }, { profileId: { in: ['r1'] } }]))
  })

  // ⛔ NEVER Profile.verificationStatus. That cache is recomputeVerification's: it still reads `verified` from the midnight
  // a document lapses until the 09:05 ICT reconcile (longer if the timer is down), and a stale `expired` can outlive a
  // renewal until its own recompute lands. The mock hands back whatever the row holds, select or not — so a read of the
  // cache, for the seller or for a rater, would believe the stale value set here.
  it('⛔ the Profile cache is never the answer: a cached "verified" over lapsed or revoked rows → off; any other cached status over a live verification → on', async () => {
    h.profile!.verificationStatus = 'verified'
    h.identity = [iv('verified', { decidedAt: new Date(Date.now() - 400 * DAY), documentExpiresAt: new Date(Date.now() - 3 * DAY) })]
    expect((await computeTrustV2('p1'))!.inputs.kycVerified, 'lapsed three days ago').toBe(false)
    h.identity = [iv('verified', { decidedAt: new Date(Date.now() - 30 * DAY) }), iv('revoked', { decidedAt: new Date(Date.now() - DAY) })]
    expect((await computeTrustV2('p1'))!.inputs.kycVerified, 'revoked').toBe(false)
    for (const stale of ['expired', 'unverified', 'pending', 'rejected']) {
      h.profile!.verificationStatus = stale
      h.identity = [iv('verified')]
      expect((await computeTrustV2('p1'))!.inputs.kycVerified, stale).toBe(true)
    }
  })

  it('⛔ …nor for a RATER: a cached "verified" over a lapsed identity leaves them at CRED_DEFAULT', async () => {
    h.reviews = [{ rating: 5, authorProfileId: 'r1', createdAt: new Date(Date.now() - 5 * DAY) }]
    h.raters = [{ id: 'r1', trustScore: 90, createdAt: new Date(Date.now() - 60 * DAY), falseReportStrikes: 0, verificationStatus: 'verified' }]
    h.identity = [iv('verified', { profileId: 'r1', decidedAt: new Date(Date.now() - 400 * DAY), documentExpiresAt: new Date(Date.now() - 3 * DAY) })]
    const b = (await computeTrustV2('p1'))!
    expect(b.Q - TRUST.FRESH_MAX).toBeCloseTo(reviewScore([{ rating: 5, weight: TRUST.CRED_DEFAULT }]), 10)
  })

  it('no memo between recomputes: rows that flip pending → verified are seen by the very next call', async () => {
    h.identity = [iv('pending', { decidedAt: null })]
    expect((await computeTrustV2('p1'))!.inputs.kycVerified).toBe(false)
    h.identity = [iv('verified')]
    expect((await computeTrustV2('p1'))!.inputs.kycVerified).toBe(true)
  })
})

/**
 * ⚖️ R1 (plan review, 2026-10-15): THE IDENTITY'S STEP IS NEVER CAPPED, AND NOTHING ELSE IS UNCAPPED. recomputeTrust caps
 * the score WITHOUT the identity, measured from the part of the cached score that is not the identity's step, and adds
 * the step in full while the identity is live. The identity_gate ledger marker is what says whether the cached score
 * already carries the step — without it a verified seller's step would be counted twice on every recompute and the
 * cap would be gone (the "backlog stays capped" case below is that regression's test).
 */
describe('⚖️ R1 — recomputeTrust: the identity step lands in full; everything else stays capped', () => {
  let seq = 0
  const iv = (status: string, over: Row = {}): Row => ({
    id: `iv-${++seq}`, profileId: 'p1', tier: 'B', method: 'passport_mrz', status,
    decidedAt: new Date(Date.now() - 10 * DAY), documentExpiresAt: new Date(Date.now() + 365 * DAY), assuranceLevel: null, ...over,
  })
  /** A non-identity backlog: a fresh manual adjustment worth `n` (M, H=365 — no decay to speak of). */
  const backlog = (n: number) => ({ type: 'manual_adjust', delta: n, reason: 'test_backlog', reportId: null, createdAt: new Date() })
  /** The cap's memory: the identity's step is in the cached score (ON) or not (OFF). */
  const gate = (on: boolean, ageDays = 1) => ({ type: IDENTITY_GATE_EVENT, delta: on ? 10 : -10, reason: on ? IDENTITY_GATE_ON : IDENTITY_GATE_OFF, reportId: null, createdAt: new Date(Date.now() - ageDays * DAY) })
  const creates = () => called('trustEvent.create').map((c) => c.args.data)
  const lifts = () => creates().filter((d) => d.type === 'recompute_lift')
  const markers = () => creates().filter((d) => d.type === IDENTITY_GATE_EVENT)
  const persisted = () => called('profile.update').map((c) => c.args.data.trustScore)
  const setCached = (score: number) => { h.profile!.trustScore = score; h.ownedSellers = [{ id: 's1', trustScore: score, trustTier: 'standard' }] }
  afterEach(() => { vi.useRealTimers() })

  it('identity on, alone → +10 at once: no cap read, no recompute_lift, one ON marker', async () => {
    setCached(80)
    h.identity = [iv('verified')]
    const r = (await recomputeTrust('p1'))!
    expect(r.score).toBe(90)
    expect(persisted()).toEqual([90])
    expect(called('trustEvent.aggregate')).toHaveLength(0)
    expect(lifts()).toEqual([])
    expect(markers()).toEqual([{ subjectProfileId: 'p1', type: IDENTITY_GATE_EVENT, delta: 10, reason: IDENTITY_GATE_ON }])
  })

  it('identity on beside a +30 backlog → cached + the daily cap + 10; the backlog is capped and ledgered as before', async () => {
    setCached(80)
    h.identity = [iv('verified')]
    h.events = [backlog(30)]
    const r = (await recomputeTrust('p1'))!
    expect(r.breakdown.score).toBe(120) // the uncapped target
    expect(r.score).toBe(80 + TRUST.DAILY_POSITIVE_CAP + 10)
    expect(called('trustEvent.aggregate')).toHaveLength(1)
    expect(lifts()).toEqual([{ subjectProfileId: 'p1', type: 'recompute_lift', delta: TRUST.DAILY_POSITIVE_CAP, reason: 'daily_cap' }])
    expect(markers()).toHaveLength(1)
  })

  it('⛔ …and the backlog STAYS capped: the next recompute that day adds nothing, the day after only the cap', async () => {
    // The state the previous case left: 96 persisted, the step counted, 6 lifted in the last 24h.
    setCached(96)
    h.identity = [iv('verified')]
    h.events = [backlog(30), gate(true, 0)]
    h.lifted = 6
    expect((await recomputeTrust('p1'))!.score).toBe(96) // NOT 106: the step is already in 96 — never added twice
    expect(lifts()).toEqual([])
    expect(markers()).toEqual([])
    expect(persisted()).toEqual([])
    // A day later the window is empty: +6 more of the backlog, and still only one +10.
    h.lifted = 0
    h.calls = []
    expect((await recomputeTrust('p1'))!.score).toBe(102)
    expect(lifts().map((d) => d.delta)).toEqual([6])
  })

  // ⛔ THE MARKER IS BOOKKEEPING THE CAP NEVER SEES (trust-math.ts IDENTITY_GATE_EVENT: "its own type, so it can reach
  // neither M … nor the cap's window"). The window sums 'recompute_lift' and nothing else. Were it to count the markers,
  // an ON (+10) would spend the day's allowance after every approval and freeze any backlog for a day, and an OFF (−10)
  // would refund it — 6 − 10 — handing a seller whose identity just lapsed another +6 the same day.
  it('⛔ the cap\'s 24h window sums recompute_lift ONLY — a fresh identity marker neither spends the allowance nor refunds it', async () => {
    // ON an hour ago (the step landing), the step counted in 90: the +30 backlog still gets the day's full +6.
    setCached(90)
    h.identity = [iv('verified')]
    h.events = [gate(true, 1 / 24), backlog(30)]
    expect((await recomputeTrust('p1'))!.score).toBe(96)
    expect(lifts().map((d) => d.delta)).toEqual([TRUST.DAILY_POSITIVE_CAP])
    expect(called('trustEvent.aggregate')[0].args.where).toEqual({ subjectProfileId: 'p1', type: 'recompute_lift', createdAt: { gt: expect.any(Date) } })
    // OFF an hour ago (a revocation) after the day's +6 was already granted: nothing more today.
    setCached(80)
    h.identity = [iv('revoked')]
    h.events = [gate(true, 30), gate(false, 1 / 24), backlog(30)]
    h.lifted = TRUST.DAILY_POSITIVE_CAP
    h.calls = []
    expect((await recomputeTrust('p1'))!.score).toBe(80)
    expect(lifts()).toEqual([])
    expect(markers()).toEqual([]) // already OFF — no flip, no marker
  })

  it('a counted identity in sync: no cap read, no marker, no profile write', async () => {
    setCached(90)
    h.identity = [iv('verified')]
    h.events = [gate(true)]
    expect((await recomputeTrust('p1'))!.score).toBe(90)
    expect(called('trustEvent.aggregate')).toHaveLength(0)
    expect(creates()).toEqual([])
    expect(persisted()).toEqual([])
  })

  it('a small non-identity gain on a counted identity still goes through the cap ledger (never uncapped)', async () => {
    setCached(90)
    h.identity = [iv('verified')]
    h.events = [gate(true), backlog(2)]
    expect((await recomputeTrust('p1'))!.score).toBe(92)
    expect(called('trustEvent.aggregate')).toHaveLength(1)
    expect(lifts().map((d) => d.delta)).toEqual([2])
  })

  it('identity REVOKED → −10 at once (downward is never capped), and the OFF marker', async () => {
    setCached(90)
    h.identity = [iv('verified', { decidedAt: new Date(Date.now() - 30 * DAY) }), iv('revoked', { decidedAt: new Date(Date.now() - DAY) })]
    h.events = [gate(true, 30)]
    const r = (await recomputeTrust('p1'))!
    expect(r.score).toBe(80)
    expect(persisted()).toEqual([80])
    expect(called('trustEvent.aggregate')).toHaveLength(0)
    expect(markers()).toEqual([{ subjectProfileId: 'p1', type: IDENTITY_GATE_EVENT, delta: -10, reason: IDENTITY_GATE_OFF }])
  })

  it('identity LAPSED yesterday (ICT) → −10 at once; expiring TODAY → still on, nothing written', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-15T12:00:00+07:00'))
    setCached(90)
    h.events = [gate(true, 30)]
    h.identity = [iv('verified', { decidedAt: new Date('2025-01-10T00:00:00+07:00'), documentExpiresAt: new Date('2026-10-15T00:00:00+07:00') })]
    expect((await recomputeTrust('p1'))!.score).toBe(90)
    expect(creates()).toEqual([])
    h.identity = [iv('verified', { decidedAt: new Date('2025-01-10T00:00:00+07:00'), documentExpiresAt: new Date('2026-10-14T00:00:00+07:00') })]
    h.calls = []
    expect((await recomputeTrust('p1'))!.score).toBe(80)
    expect(markers().map((d) => d.reason)).toEqual([IDENTITY_GATE_OFF])
  })

  it('a lapse beside a backlog: the −10 lands in full while the backlog is capped (90 → 80 + 6)', async () => {
    setCached(90)
    h.identity = [iv('revoked')]
    h.events = [gate(true, 30), backlog(15)]
    expect((await recomputeTrust('p1'))!.score).toBe(86)
    expect(lifts().map((d) => d.delta)).toEqual([6])
    expect(markers().map((d) => d.reason)).toEqual([IDENTITY_GATE_OFF])
  })

  it('a citizen ID with no expiry and a passport land the same flat +10 (tier A / tier B)', async () => {
    for (const over of [{ tier: 'A', method: 'vneid', documentExpiresAt: null }, { tier: 'B' }]) {
      setCached(80)
      h.events = []
      h.identity = [iv('verified', over)]
      h.calls = []
      expect((await recomputeTrust('p1'))!.score, String(over.tier)).toBe(90)
    }
  })

  // ⚠️ "FLAT +10" HOLDS WHEREVER THE 0/150 CLAMP DOES NOT BITE, AND recomputeTrust DOES NOT CLAMP `base + worth`: the
  // clamp-aware worth (computeTrustV2 — the composite with the gate on minus off) is the only thing keeping the persisted
  // score inside [0, 150]. A plain V_KYC there would persist 160 on a full 150, and lift a seller clamped at 0 to 10.
  it('⚠️ the step is CLAMP-AWARE: only what fits under 150, nothing on a full 150 or at the 0 floor — never outside [0, 150]', async () => {
    // Five of headroom: 145 without the identity, 150 with it — the step is worth 5, and its marker records 5.
    setCached(145)
    h.identity = [iv('verified')]
    h.events = [backlog(65)]
    let r = (await recomputeTrust('p1'))!
    expect(r.breakdown.inputs.identityWorth).toBe(5)
    expect(r.score).toBe(TRUST.MAX)
    expect(markers()).toEqual([{ subjectProfileId: 'p1', type: IDENTITY_GATE_EVENT, delta: 5, reason: IDENTITY_GATE_ON }])
    // A full 150 without the identity, the step already counted: worth 0, and nothing on top.
    setCached(TRUST.MAX)
    h.events = [gate(true, 30), backlog(80)]
    h.calls = []
    r = (await recomputeTrust('p1'))!
    expect(r.breakdown.inputs.identityWorth).toBe(0)
    expect(r.score).toBe(TRUST.MAX)
    // The floor: −100 of adjustments clamp both composites at 0 — a live identity lifts nobody off it.
    setCached(0)
    h.events = [{ type: 'manual_adjust', delta: -100, reason: 'test_penalty', reportId: null, createdAt: new Date() }]
    h.calls = []
    r = (await recomputeTrust('p1'))!
    expect(r.breakdown.inputs.identityWorth).toBe(0)
    expect(r.score).toBe(0)
  })

  it('no identity on either side: byte-for-byte the cap it always was (60 → 66 toward 80), and no marker', async () => {
    const r = (await recomputeTrust('p1'))!
    expect(r.breakdown.score).toBe(80)
    expect(r.score).toBe(66)
    expect(lifts().map((d) => d.delta)).toEqual([6])
    expect(markers()).toEqual([])
  })

  it('the PHONE path is unchanged: its one-time event recomputes UNCAPPED and lands everything pending at once', async () => {
    h.profile!.phone = null
    h.events = [{ type: 'manual_adjust', delta: 10, reason: 'phone_verified', reportId: null, createdAt: new Date() }, backlog(30)]
    const r = (await applyTrustEvent('p1', 'manual_adjust', 10, { reason: 'phone_verified' }))!
    expect(r.score).toBe(110) // 60 + 15 + 5 + 30 — the backlog too, as it always has
    expect(called('trustEvent.aggregate')).toHaveLength(0)
    expect(lifts()).toEqual([])
  })

  it('an uncapped recompute with a live identity lands the whole target — and still records the step as counted', async () => {
    setCached(80)
    h.identity = [iv('verified')]
    h.events = [backlog(30)]
    expect((await recomputeTrust('p1', { uncapped: true }))!.score).toBe(120)
    expect(called('trustEvent.aggregate')).toHaveLength(0)
    expect(markers().map((d) => d.reason)).toEqual([IDENTITY_GATE_ON])
  })

  // ⚖️ Commit gate, 2026-10-15: a marker that landed without its score said "the step is in" over a score lacking it,
  // and the next recompute measured the cap from 10 too low (the +10 came back days late). Both or neither now.
  it('⚖️ the marker COMMITS WITH THE SCORE — a failed profile write leaves no marker behind', async () => {
    setCached(80)
    h.identity = [iv('verified')]
    await recomputeTrust('p1')
    expect(called('$transaction')).toHaveLength(1)
    expect(markers()).toHaveLength(1)
    h.calls = []
    h.profileUpdateFails = true
    await expect(recomputeTrust('p1')).rejects.toThrow(/profile write failed/)
    expect(markers()).toEqual([])
  })

  // Commit gate round 2: the cap's recompute_lift row was written alone, before the score — a failed score write then
  // spent the seller's daily allowance on a score that never moved.
  it('⚖️ …and so does the cap\'s recompute_lift: a failed profile write spends none of the allowance', async () => {
    setCached(80)
    h.identity = [iv('verified')]
    h.events = [backlog(30)]
    h.profileUpdateFails = true
    await expect(recomputeTrust('p1')).rejects.toThrow(/profile write failed/)
    expect(creates().filter((d) => d.type === 'recompute_lift')).toEqual([])
    expect(markers()).toEqual([])
    h.calls = []
    h.profileUpdateFails = false
    await recomputeTrust('p1')
    expect(called('$transaction')).toHaveLength(1)
    expect(creates().filter((d) => d.type === 'recompute_lift').map((d) => d.delta)).toEqual([6])
  })
})
