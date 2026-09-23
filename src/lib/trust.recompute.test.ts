import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * computeTrustV2 / recomputeTrust AGAINST A FAKE LEDGER — the audit 2026-09-23 fixes that live in
 * the DB wiring rather than in the pure math:
 *   #26 — a sale is timed by soldAt (updatedAt is restamped by any write), and the trust cascade
 *         must never restamp Listing.updatedAt (it used to, via listing.updateMany).
 *   #15 — a report_confirmed event stops counting once its report is resolved NOT-confirmed, and
 *         duplicate events for one report (a lost appeal re-confirms) charge once.
 *   #13 — the storefront mirror runs even when the PROFILE score did not change, guarded.
 * The db, the ranking writer and enforcement are stubbed; every call is recorded.
 */

type Row = Record<string, any>
const DAY = 86_400_000

const h = vi.hoisted(() => ({
  profile: null as Row | null,
  events: [] as Row[],
  reports: [] as Row[],
  seller: null as Row | null,
  ownedSellers: [] as Row[],
  sold: [] as Row[],
  acceptedOffers: [] as Row[],
  executeRawCount: 0,
  appealedReports: [] as Row[],
  chargedEvents: [] as Row[],
  sellerOwners: [] as Row[],
  calls: [] as Array<{ m: string; args?: any }>,
}))

vi.mock('@/lib/db', () => {
  const rec = (m: string, args?: unknown) => { h.calls.push({ m, args }) }
  return {
    db: {
      profile: {
        findUnique: async (a: Row) => { rec('profile.findUnique', a); return h.profile },
        findMany: async (a: Row) => { rec('profile.findMany', a); return [] },
        update: async (a: Row) => { rec('profile.update', a); return {} },
        updateMany: async (a: Row) => { rec('profile.updateMany', a); return { count: 0 } },
      },
      trustEvent: {
        findMany: async (a: Row) => {
          rec('trustEvent.findMany', a)
          if (a?.where?.reason === 'kyc') return []
          if (a?.where?.reportId) return h.chargedEvents
          return h.events
        },
        aggregate: async (a: Row) => { rec('trustEvent.aggregate', a); return { _sum: { delta: 0 } } },
        create: async (a: Row) => { rec('trustEvent.create', a); return {} },
        createMany: async (a: Row) => { rec('trustEvent.createMany', a); return { count: a.data.length } },
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
      review: { findMany: async () => [] },
      conversation: { count: async () => 0 },
      message: { findMany: async () => h.acceptedOffers },
      listing: {
        count: async () => 0,
        findMany: async (a: Row) => { rec('listing.findMany', a); return h.sold },
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

import { computeTrustV2, initialSellerTrust, recomputeTrust, settleReportCharges } from './trust'
import { GUEST_SELLER_TRUST, TRUST } from './trust-math'

const called = (m: string) => h.calls.filter((c) => c.m === m)
const sqlText = (q: any): string => (Array.isArray(q?.strings) ? q.strings.join('?') : String(q?.sql ?? q))

beforeEach(() => {
  const now = Date.now()
  h.profile = { createdAt: new Date(now - 400 * DAY), phone: '+84900000000', trustScore: 60, trustTier: 'standard' }
  h.events = []
  h.reports = []
  h.seller = { id: 's1', responseRate: 100, responseMetricAt: null }
  h.ownedSellers = [{ id: 's1', trustScore: 60, trustTier: 'standard' }]
  h.sold = []
  h.acceptedOffers = []
  h.executeRawCount = 0
  h.appealedReports = []
  h.chargedEvents = []
  h.sellerOwners = []
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
