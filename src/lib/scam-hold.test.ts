import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE SCAM HOLD'S EXITS, END TO END — against one stateful fake database driving the REAL
 * computeTrustV2 / recomputeTrust (trust.ts), the REAL syncEnforcement / applyEnforcement /
 * liftAction (enforcement.ts) and the REAL release / overturn (scam-hold.ts).
 *
 * The property that matters is the one the old console broke: after an exit, the NEXT daily sync
 * must not re-hold the account. That can only be proved by running the real derivation over the rows
 * the exit wrote — a mocked computeTrustV2 would prove nothing. So the only things faked here are
 * storage, identity (hasVerifiedIdentity / sanctionedProfilesSharingIdentity), the audit chain and
 * the notification side effects.
 */

type Row = Record<string, any>
const DAY = 86_400_000

const h = vi.hoisted(() => ({
  profile: {} as Row,
  seller: {} as Row,
  events: [] as Row[],
  reports: [] as Row[],
  listings: [] as Row[],
  actions: [] as Row[],
  notices: [] as Row[],
  audit: [] as Row[],
  disputeNotices: [] as Row[],
  verified: true,
  linked: [] as string[],
  seq: 0,
  pending: [] as Promise<unknown>[],
}))

/** A small Prisma `where` evaluator — the operators the code under test actually uses. */
function match(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Row[]).some((w) => match(row, w))
    if (k === 'AND') return (v as Row[]).every((w) => match(row, w))
    if (k === 'NOT') return !match(row, v as Row)
    // A Report's `listing: {…}` relation filter (the release's open-report check) — evaluated
    // against the listing row, so a report on ANOTHER seller's listing does not match.
    if (k === 'listing' && v && typeof v === 'object' && 'listingId' in row) {
      const l = h.listings.find((x) => x.id === row.listingId)
      return !!l && match(l, v as Row)
    }
    const cell = row[k]
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return (v.in as unknown[]).includes(cell)
      if ('startsWith' in v) return typeof cell === 'string' && cell.startsWith(v.startsWith as string)
      if ('notIn' in v) return !(v.notIn as unknown[]).includes(cell)
      if ('not' in v) return v.not === null ? cell != null : cell !== v.not
      if ('gte' in v) return cell != null && cell >= v.gte
      if ('gt' in v) return cell != null && cell > v.gt
      if ('lte' in v) return cell != null && cell <= v.lte
      if ('lt' in v) return cell != null && cell < v.lt
      return true // relation filters (conversation: {...}) — not needed for these rows
    }
    if (v === null) return cell == null // an unset column IS null in Postgres
    return cell === v
  })
}
const newest = (rows: Row[]) => [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
const nextId = (p: string) => `${p}${++h.seq}`

vi.mock('./db', () => {
  const table = (rows: () => Row[], prefix: string) => ({
    findMany: async (a: Row = {}) => {
      const hit = rows().filter((r) => match(r, a.where))
      return a.orderBy?.createdAt === 'desc' ? newest(hit) : hit
    },
    findFirst: async (a: Row = {}) => newest(rows().filter((r) => match(r, a.where)))[0] ?? null,
    findUnique: async (a: Row) => rows().find((r) => match(r, a.where)) ?? null,
    count: async (a: Row = {}) => rows().filter((r) => match(r, a.where)).length,
    update: async (a: Row) => { const r = rows().find((x) => match(x, a.where)); if (r) Object.assign(r, a.data); return r ?? {} },
    updateMany: async (a: Row) => { const hit = rows().filter((r) => match(r, a.where)); for (const r of hit) Object.assign(r, a.data); return { count: hit.length } },
    updateManyAndReturn: async (a: Row) => { const hit = rows().filter((r) => match(r, a.where)); for (const r of hit) Object.assign(r, a.data); return hit.map((r) => ({ id: r.id })) },
    create: async (a: Row) => { const r = { id: nextId(prefix), createdAt: new Date(Date.now() + h.seq), ...a.data }; rows().push(r); return r },
    createMany: async (a: Row) => { for (const d of a.data) rows().push({ id: nextId(prefix), createdAt: new Date(Date.now() + h.seq), ...d }); return { count: a.data.length } },
    aggregate: async () => ({ _sum: { delta: 0 } }),
  })
  const db: Row = {
    profile: {
      findUnique: async () => (h.profile.id ? { ...h.profile } : null),
      findMany: async () => [],
      update: async (a: Row) => { Object.assign(h.profile, a.data); return {} },
      updateMany: async (a: Row) => { if (match(h.profile, a.where)) Object.assign(h.profile, a.data); return { count: 1 } },
    },
    seller: {
      findUnique: async () => h.seller,
      findMany: async () => [h.seller],
      updateMany: async (a: Row) => { Object.assign(h.seller, a.data); return { count: 1 } },
    },
    trustEvent: table(() => h.events, 'ev'),
    report: table(() => h.reports, 'r'),
    listing: table(() => h.listings, 'l'),
    enforcementAction: table(() => h.actions, 'a'),
    review: { findMany: async () => [] },
    conversation: { count: async () => 0 },
    message: { findMany: async () => [] },
    bannedIdentity: { deleteMany: async () => ({ count: 0 }), create: async () => ({}) },
    notification: { create: async (a: Row) => { h.notices.push(a.data); return {} } },
    $queryRaw: async () => [{ enforcementState: h.profile.enforcementState }],
    $executeRaw: async () => 0,
  }
  // A transaction that throws is ROLLED BACK — the property the overturn's single transaction relies on.
  db.$transaction = async (fn: (tx: Row) => unknown) => {
    const snap = structuredClone({ profile: h.profile, seller: h.seller, events: h.events, reports: h.reports, listings: h.listings, actions: h.actions, audit: h.audit })
    try {
      return await fn(db)
    } catch (e) {
      Object.assign(h, snap)
      throw e
    }
  }
  return { db }
})
vi.mock('./ranking', () => ({ recomputeRankScoreForSeller: async () => {} }))
vi.mock('./seller-metrics', () => ({ RESPONSE_METRIC_IS_REAL: true }))
vi.mock('./catalogue-seller', () => ({ isVerifiedCatalogueSeller: async () => false }))
vi.mock('./compliance/seller-publish-gate', () => ({
  partitionByIdentityGate: async (ids: string[]) => ({ allowed: ids, held: [] }),
  settleHolds: async () => 0,
}))
vi.mock('./push', () => ({ sendPushToProfile: async () => 0 }))
vi.mock('next/server', () => ({ after: (fn: () => Promise<unknown>) => { h.pending.push(fn()) } }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: () => {} }))
vi.mock('./kyc/identity', () => ({
  hasVerifiedIdentity: async () => h.verified,
  sanctionedProfilesSharingIdentity: async () => h.linked,
}))
vi.mock('./compliance/audit', () => ({ appendAudit: async (_tx: unknown, input: Row) => { h.audit.push(input) } }))
vi.mock('./dispute', () => ({ notifyDispute: async (pid: string, rid: string, key: string) => { h.disputeNotices.push({ pid, rid, key }) } }))

const { releaseScamHold, overturnScamHold, profileHasScamHold } = await import('./scam-hold')
const { recomputeTrust } = await import('./trust')
const { liftAction, syncEnforcement } = await import('./enforcement')
const { TRUST } = await import('./trust-math')
const { ENFORCEMENT } = await import('./enforcement-machine')
const { releasedChargeStanding, releasedChargeGate } = await import('./released-charge-gate')

const ADMIN = 'mod@eno.vn'
const PLAN = 'I shipped without tracking; I now use GHN with tracking numbers and refunded the buyer in full.'

/** The daily cron's per-profile step, verbatim in effect: recompute, then sync on that breakdown. */
async function dailySync() {
  const r = await recomputeTrust('p1')
  if (r) await syncEnforcement('p1', r.breakdown, { persistedScore: r.score })
  await Promise.all(h.pending)
  return h.profile.enforcementState as string
}

/**
 * A report confirmed `ageDays` ago as a SCAM, exactly as the moderation queue writes it. With a
 * `listingId`, the report is about that listing — the confirm-report takedown (verified=false) is then
 * the caller's to apply, AFTER the sync, in the order the route runs them.
 */
function confirmScam(reportId: string, ageDays: number, listingId: string | null = null, reporter = 'buyer1') {
  h.reports.push({ id: reportId, severity: 'severe', reporterProfileId: reporter, status: 'confirmed', resolvedBy: ADMIN, remediatedAt: null, targetProfileId: 'p1', targetSellerId: null, appealedAt: null, listingId, createdAt: new Date(Date.now() - (ageDays + 1) * DAY) })
  h.events.push({ id: nextId('ev'), subjectProfileId: 'p1', type: 'report_confirmed', delta: -45, reason: `report:${reportId}`, reportId, createdAt: new Date(Date.now() - ageDays * DAY) })
}

/** confirm-report's order: the sync (the hold pulls every live listing), THEN the takedown. */
async function confirmScamOnListing(reportId: string, ageDays: number, listingId: string) {
  confirmScam(reportId, ageDays, listingId)
  await dailySync()
  Object.assign(h.listings.find((l) => l.id === listingId)!, { verified: false, identityHold: false })
}

const pulledIds = () => h.actions.filter((a) => a.status === 'active').flatMap((a) => (a.pulledListingIds ? JSON.parse(a.pulledListingIds) as string[] : []))

const scamAction = () => h.actions.find((a) => a.status === 'active' && a.reason === 'scam_hold')!
const liveListings = () => h.listings.filter((l) => l.status === 'active' && l.verified).map((l) => l.id).sort()

beforeEach(() => {
  const now = Date.now()
  h.profile = { id: 'p1', createdAt: new Date(now - 400 * DAY), phone: '+84900000000', trustScore: 60, trustTier: 'standard', enforcementState: 'good_standing', enforcementUntil: null, goodStandingSince: null, locale: 'en' }
  h.seller = { id: 's1', ownerId: 'p1', responseRate: 100, responseMetricAt: null, trustScore: 60, trustTier: 'standard' }
  h.events = []
  h.reports = []
  h.listings = ['L1', 'L2'].map((id) => ({ id, sellerId: 's1', status: 'active', verified: true, identityHold: false, soldAt: null, updatedAt: new Date(now - 30 * DAY), postedAt: new Date(now - DAY), availabilityConfirmedAt: null, affiliateUrl: null }))
  h.actions = []
  h.notices = []
  h.audit = []
  h.disputeNotices = []
  h.verified = true
  h.linked = []
  h.seq = 0
  h.pending = []
})

describe('a scam hold', () => {
  it('holds on confirmation and pulls the live listings', async () => {
    confirmScam('r1', 20)
    expect(await dailySync()).toBe('held')
    expect(scamAction()).toBeTruthy()
    expect(liveListings()).toEqual([])
  })

  it('⛔ is NOT lifted by sales the seller marks themselves — the exit that used to take a minute', async () => {
    confirmScam('r1', 20)
    await dailySync()
    // Five pulled listings marked sold AFTER the confirmation (soldAt stamped now, as setStatusCore does).
    for (let i = 0; i < 5; i++) h.listings.push({ id: `S${i}`, sellerId: 's1', status: 'sold', verified: false, identityHold: false, soldAt: new Date(Date.now() - i * 1000), updatedAt: new Date(), affiliateUrl: null })
    expect(await dailySync()).toBe('held')
    expect(await dailySync()).toBe('held')
    expect(await profileHasScamHold('p1')).toBe(true)
  })

  it('the OLD console lift is undone by the next sync — the trap the route now refuses', async () => {
    confirmScam('r1', 20)
    await dailySync()
    expect(await liftAction(scamAction().id, { to: 'lifted', by: ADMIN })).toBe(true)
    expect(h.profile.enforcementState).toBe('good_standing')
    expect(await dailySync()).toBe('held') // re-held within a day, after "everything is restored"
  })
})

describe('RELEASE', () => {
  it('writes the marker + audit, restores the listings, and a later sync does NOT re-hold', async () => {
    confirmScam('r1', 20)
    await dailySync()
    h.notices = []
    const r = await releaseScamHold({ actionId: scamAction().id, admin: ADMIN, plan: PLAN })
    await Promise.all(h.pending)
    // C keeps the frozen charge (45 × 0.6 = 27): score 60 + 15 V + 5 freshness − 27 = 53 → throttled.
    expect(r).toEqual({ ok: true, state: 'throttled', charges: 1 })
    expect(liveListings()).toEqual(['L1', 'L2'])

    const markers = h.events.filter((e) => e.type === 'manual_adjust')
    expect(markers).toEqual([expect.objectContaining({ subjectProfileId: 'p1', delta: 0, reason: 'scam_release:r1', reportId: 'r1' })])
    expect(h.audit).toEqual([expect.objectContaining({
      actorType: 'admin', actorId: ADMIN, action: 'enforcement.scam_released', subjectType: 'profile', subjectId: 'p1',
      detail: expect.objectContaining({ plan: PLAN, charges: [expect.objectContaining({ key: 'r1', reportId: 'r1' })] }),
    })])
    // The seller hears it was a release — not "under review", not "everything is restored".
    expect(h.notices.map((n) => n.title)).toEqual(['Your listings are visible again'])

    expect(await dailySync()).toBe('throttled')
    expect(await dailySync()).toBe('throttled')
    expect(liveListings()).toEqual(['L1', 'L2'])
  })

  it('a double-click writes ONE marker (every marker is a line in the PDPL export)', async () => {
    confirmScam('r1', 20)
    await dailySync()
    const id = scamAction().id
    await releaseScamHold({ actionId: id, admin: ADMIN, plan: PLAN })
    // Second click lands on the now-lifted row → not_active, and no second marker.
    expect(await releaseScamHold({ actionId: id, admin: ADMIN, plan: PLAN })).toMatchObject({ ok: false, error: 'not_active' })
    expect(h.events.filter((e) => e.type === 'manual_adjust')).toHaveLength(1)
  })

  it('a retry after a sync that never landed FINISHES the release instead of 409ing (agy)', async () => {
    confirmScam('r1', 20)
    await dailySync()
    // The first release's marker committed, its (fail-quiet) sync did not: still held.
    h.events.push({ id: 'mk', subjectProfileId: 'p1', type: 'manual_adjust', delta: 0, reason: 'scam_release:r1', reportId: 'r1', createdAt: new Date() })
    expect(h.profile.enforcementState).toBe('held')
    const r = await releaseScamHold({ actionId: scamAction().id, admin: ADMIN, plan: PLAN })
    expect(r).toEqual({ ok: true, state: 'throttled', charges: 0 })
    expect(h.events.filter((e) => e.type === 'manual_adjust')).toHaveLength(1)
  })

  it('refuses before 14 days — no marker, still held, and says when', async () => {
    confirmScam('r1', 5)
    await dailySync()
    const r = await releaseScamHold({ actionId: scamAction().id, admin: ADMIN, plan: PLAN })
    expect(r).toMatchObject({ ok: false, status: 409, error: 'release_too_soon' })
    const eligible = new Date((r as { eligibleAt: string }).eligibleAt).getTime()
    expect(Math.abs(eligible - (Date.now() + (TRUST.SCAM_RELEASE_MIN_DAYS - 5) * DAY))).toBeLessThan(60_000)
    expect(h.events.some((e) => e.type === 'manual_adjust')).toBe(false)
    expect(await dailySync()).toBe('held')
  })

  it('the NEWEST held charge decides the 14 days', async () => {
    confirmScam('r1', 40)
    confirmScam('r2', 3)
    await dailySync()
    expect(await releaseScamHold({ actionId: scamAction().id, admin: ADMIN, plan: PLAN })).toMatchObject({ error: 'release_too_soon' })
  })

  it('refuses without a live verified identity', async () => {
    confirmScam('r1', 20)
    await dailySync()
    h.verified = false
    expect(await releaseScamHold({ actionId: scamAction().id, admin: ADMIN, plan: PLAN })).toEqual({ ok: false, status: 409, error: 'identity_unverified' })
    expect(h.events.some((e) => e.type === 'manual_adjust')).toBe(false)
  })

  it('refuses when the identity is shared with another held/suspended account, and names it to the admin', async () => {
    confirmScam('r1', 20)
    await dailySync()
    h.linked = ['p9']
    expect(await releaseScamHold({ actionId: scamAction().id, admin: ADMIN, plan: PLAN })).toEqual({ ok: false, status: 409, error: 'identity_linked', linkedProfileIds: ['p9'] })
    expect(await dailySync()).toBe('held')
  })

  it('refuses without a written plan', async () => {
    confirmScam('r1', 20)
    await dailySync()
    expect(await releaseScamHold({ actionId: scamAction().id, admin: ADMIN, plan: '  ok  ' })).toMatchObject({ ok: false, status: 400, error: 'plan_required' })
  })

  it('refuses an account with no scam charge, and a silent review flag', async () => {
    const flag = { id: 'f1', profileId: 'p1', state: 'good_standing', reason: 'velocity_review', decidedBy: 'system', status: 'active', createdAt: new Date() }
    h.actions.push(flag)
    expect(await releaseScamHold({ actionId: 'f1', admin: ADMIN, plan: PLAN })).toMatchObject({ error: 'not_active' })
    h.actions.push({ ...flag, id: 'a-admin', state: 'throttled', reason: 'admin_manual', decidedBy: ADMIN })
    expect(await releaseScamHold({ actionId: 'a-admin', admin: ADMIN, plan: PLAN })).toMatchObject({ error: 'no_scam_hold' })
  })

  it('answers the seller\'s pending appeal on the action with its own outcome', async () => {
    confirmScam('r1', 20)
    await dailySync()
    Object.assign(scamAction(), { appealText: PLAN, appealedAt: new Date() })
    const id = scamAction().id
    await releaseScamHold({ actionId: id, admin: ADMIN, plan: PLAN })
    expect(h.actions.find((a) => a.id === id)).toMatchObject({ appealOutcome: 'released', appealResolvedAt: expect.any(Date) })
  })

  it('a NEW scam confirmed after a release holds again', async () => {
    confirmScam('r1', 20)
    await dailySync()
    await releaseScamHold({ actionId: scamAction().id, admin: ADMIN, plan: PLAN })
    confirmScam('r2', 0)
    expect(await dailySync()).toBe('held')
  })
})

describe('OVERTURN', () => {
  it('reverses the report in the ledger, restores the seller, and a later sync does NOT re-hold', async () => {
    confirmScam('r1', 3)
    await dailySync()
    const id = scamAction().id
    const r = await overturnScamHold({ actionId: id, admin: ADMIN })
    expect(r).toEqual({ ok: true, state: 'good_standing', charges: 1, remaining: 0 })
    expect(h.reports[0]).toMatchObject({ status: 'overturned', resolvedBy: ADMIN })
    expect(h.events.filter((e) => e.type === 'report_dismissed')).toEqual([expect.objectContaining({ reportId: 'r1', reason: 'reversed:overturned', delta: 0 })])
    expect(h.actions.find((a) => a.id === id)!.status).toBe('overturned')
    expect(liveListings()).toEqual(['L1', 'L2'])
    expect(h.audit).toEqual([expect.objectContaining({ action: 'enforcement.scam_overturned', actorId: ADMIN, detail: { actionId: id, reportIds: ['r1'], remainingHeld: 0 } })])
    expect(h.disputeNotices).toEqual([{ pid: 'buyer1', rid: 'r1', key: 'decided_dismissed_reporter' }])

    expect(await dailySync()).toBe('good_standing')
    expect(await dailySync()).toBe('good_standing')
  })

  it('stays overturned even after the Report row cascades away with its listing (the ledger marker)', async () => {
    confirmScam('r1', 3)
    await dailySync()
    await overturnScamHold({ actionId: scamAction().id, admin: ADMIN })
    h.reports = [] // the seller (or an admin reject) deleted the listing; the status is unreadable now
    expect(await dailySync()).toBe('good_standing')
  })

  it('an APPEALED (re-opened) report is overturned too', async () => {
    confirmScam('r1', 3)
    await dailySync()
    Object.assign(h.reports[0], { status: 'open', appealedAt: new Date() })
    expect(await dailySync()).toBe('held') // a pending appeal keeps the charge
    await overturnScamHold({ actionId: scamAction().id, admin: ADMIN })
    expect(h.reports[0].status).toBe('overturned')
    expect(await dailySync()).toBe('good_standing')
  })

  it('from an admin suspension on top of a scam hold: reverses the charge and leaves the suspension', async () => {
    confirmScam('r1', 3)
    await dailySync()
    const { applyEnforcement } = await import('./enforcement')
    await applyEnforcement('p1', { state: 'suspended', reason: 'admin_manual', expiresAt: null }, { decidedBy: ADMIN })
    const susp = h.actions.find((a) => a.status === 'active')!
    expect(susp.reason).toBe('admin_manual')
    const r = await overturnScamHold({ actionId: susp.id, admin: ADMIN })
    expect(r).toMatchObject({ ok: true, state: 'suspended' }) // the suspension is the admin's to lift
    expect(await profileHasScamHold('p1')).toBe(false)
    expect(await liftAction(susp.id, { to: 'lifted', by: ADMIN })).toBe(true)
    expect(await dailySync()).toBe('good_standing')
  })

  it('refuses a legacy charge with no report (it has no reversal key) — Release handles it', async () => {
    h.events.push({ id: 'legacy1', subjectProfileId: 'p1', type: 'report_confirmed', delta: -25, reason: 'v1', reportId: null, createdAt: new Date(Date.now() - 30 * DAY) })
    await dailySync()
    expect(await overturnScamHold({ actionId: scamAction().id, admin: ADMIN })).toEqual({ ok: false, status: 409, error: 'legacy_charge' })
    const r = await releaseScamHold({ actionId: scamAction().id, admin: ADMIN, plan: PLAN })
    expect(r).toMatchObject({ ok: true })
    expect(h.events.find((e) => e.type === 'manual_adjust')).toMatchObject({ reason: 'scam_release:event:legacy1', reportId: null })
    expect(await dailySync()).not.toBe('held')
  })
})

// ── Review of the release/overturn, 2026-09-24 ────────────────────────────────────────────────────

describe('⛔ the listing a confirmed scam report is about STAYS DOWN (review: HIGH)', () => {
  it('the hold recorded it with the rest — a RELEASE restores the others and not it', async () => {
    await confirmScamOnListing('r1', 20, 'L1')
    expect(pulledIds().sort()).toEqual(['L1', 'L2']) // the sync ran before the takedown: L1 is on the list
    const r = await releaseScamHold({ actionId: scamAction().id, admin: ADMIN, plan: PLAN })
    expect(r).toMatchObject({ ok: true, state: 'throttled' })
    expect(liveListings()).toEqual(['L2'])
    expect(h.listings.find((l) => l.id === 'L1')).toMatchObject({ status: 'active', verified: false })
    expect(await dailySync()).toBe('throttled')
    expect(liveListings()).toEqual(['L2'])
  })

  it('…and an OVERTURN does not republish it either (the admin approves it in Moderation)', async () => {
    await confirmScamOnListing('r1', 3, 'L1')
    const r = await overturnScamHold({ actionId: scamAction().id, admin: ADMIN })
    expect(r).toMatchObject({ ok: true, state: 'good_standing', charges: 1 })
    expect(liveListings()).toEqual(['L2'])
  })

  it('…nor the retry that finishes a release whose sync never landed', async () => {
    await confirmScamOnListing('r1', 20, 'L1')
    h.events.push({ id: 'mk', subjectProfileId: 'p1', type: 'manual_adjust', delta: 0, reason: 'scam_release:r1', reportId: 'r1', createdAt: new Date() })
    expect(await releaseScamHold({ actionId: scamAction().id, admin: ADMIN, plan: PLAN })).toMatchObject({ ok: true, charges: 0 })
    expect(liveListings()).toEqual(['L2'])
  })

  it('forgetPulledListings leaves every other id on the list, and a hold with nothing left records null', async () => {
    const { forgetPulledListings } = await import('./enforcement')
    await confirmScamOnListing('r1', 20, 'L1')
    expect(await forgetPulledListings(['L1', null, 'nope'])).toBe(1)
    expect(pulledIds()).toEqual(['L2'])
    expect(await forgetPulledListings(['L2'])).toBe(1)
    expect(scamAction().pulledListingIds).toBeNull()
    expect(await forgetPulledListings([])).toBe(0)
  })
})

describe('RELEASE waits for OPEN reports (review: MEDIUM)', () => {
  it('a second victim\'s report, filed and still open, refuses the release — nothing is written', async () => {
    confirmScam('r1', 20)
    await dailySync()
    h.reports.push({ id: 'r9', status: 'open', severity: null, reporterProfileId: 'buyer2', targetProfileId: null, targetSellerId: null, listingId: 'L2', appealedAt: null, createdAt: new Date() })
    expect(await releaseScamHold({ actionId: scamAction().id, admin: ADMIN, plan: PLAN })).toEqual({ ok: false, status: 409, error: 'open_reports', count: 1, reportIds: ['r9'] })
    expect(h.events.some((e) => e.type === 'manual_adjust')).toBe(false)
    expect(h.audit).toEqual([])
    expect(await dailySync()).toBe('held')
  })

  it('an open report against the storefront or the profile refuses it too', async () => {
    confirmScam('r1', 20)
    await dailySync()
    h.reports.push({ id: 'r8', status: 'open', targetProfileId: null, targetSellerId: 's1', listingId: null, createdAt: new Date() })
    expect(await releaseScamHold({ actionId: scamAction().id, admin: ADMIN, plan: PLAN })).toMatchObject({ error: 'open_reports', reportIds: ['r8'] })
    h.reports.pop()
    h.reports.push({ id: 'r7', status: 'open', targetProfileId: 'p1', targetSellerId: null, listingId: null, createdAt: new Date() })
    expect(await releaseScamHold({ actionId: scamAction().id, admin: ADMIN, plan: PLAN })).toMatchObject({ error: 'open_reports', reportIds: ['r7'] })
  })

  it('an open report on SOMEONE ELSE\'s listing, or a decided one on this seller, does not block it', async () => {
    confirmScam('r1', 20)
    await dailySync()
    h.listings.push({ id: 'X1', sellerId: 's-other', status: 'active', verified: true })
    h.reports.push({ id: 'r6', status: 'open', targetProfileId: null, targetSellerId: null, listingId: 'X1', createdAt: new Date() })
    h.reports.push({ id: 'r5', status: 'dismissed', targetProfileId: 'p1', targetSellerId: null, listingId: 'L2', createdAt: new Date() })
    expect(await releaseScamHold({ actionId: scamAction().id, admin: ADMIN, plan: PLAN })).toMatchObject({ ok: true })
  })
})

describe('OVERTURN reverses ONLY the chosen report (review: MEDIUM)', () => {
  it('two victims, one wrong report: the other charge — and the hold — stay; only its reporter is told', async () => {
    confirmScam('r1', 20, null, 'buyer1')
    confirmScam('r2', 18, null, 'buyer2')
    await dailySync()
    const id = scamAction().id
    const r = await overturnScamHold({ actionId: id, admin: ADMIN, reportIds: ['r1'] })
    expect(r).toEqual({ ok: true, state: 'held', charges: 1, remaining: 1 })
    expect(h.reports.find((x) => x.id === 'r1')!.status).toBe('overturned')
    expect(h.reports.find((x) => x.id === 'r2')!.status).toBe('confirmed')
    expect(h.events.filter((e) => e.type === 'report_dismissed').map((e) => e.reportId)).toEqual(['r1'])
    expect(h.disputeNotices).toEqual([{ pid: 'buyer1', rid: 'r1', key: 'decided_dismissed_reporter' }])
    expect(h.actions.find((a) => a.id === id)!.status).toBe('active') // the hold row stands
    expect(liveListings()).toEqual([])
    expect(await dailySync()).toBe('held')
  })

  it('with two charges and no choice named, it refuses with the list — and changes nothing', async () => {
    confirmScam('r1', 20)
    confirmScam('r2', 18, 'L2')
    await dailySync()
    const r = await overturnScamHold({ actionId: scamAction().id, admin: ADMIN })
    expect(r).toMatchObject({ ok: false, status: 409, error: 'choose_reports' })
    expect((r as { charges: Array<Record<string, unknown>> }).charges).toEqual([
      expect.objectContaining({ reportId: 'r1', stage: 'held', listingId: null, reportStatus: 'confirmed' }),
      expect.objectContaining({ reportId: 'r2', stage: 'held', listingId: 'L2', reportStatus: 'confirmed' }),
    ])
    expect(h.reports.every((x) => x.status === 'confirmed')).toBe(true)
    expect(h.audit).toEqual([])
    expect(h.disputeNotices).toEqual([])
  })

  it('a named report that is not a standing charge of this account refuses the whole call', async () => {
    confirmScam('r1', 20)
    confirmScam('r2', 18)
    await dailySync()
    expect(await overturnScamHold({ actionId: scamAction().id, admin: ADMIN, reportIds: ['r1', 'someone-elses'] })).toMatchObject({ error: 'choose_reports' })
    expect(h.reports.every((x) => x.status === 'confirmed')).toBe(true)
  })

  it('choosing EVERY held charge ends the hold as overturned', async () => {
    confirmScam('r1', 20)
    confirmScam('r2', 18)
    await dailySync()
    const id = scamAction().id
    expect(await overturnScamHold({ actionId: id, admin: ADMIN, reportIds: ['r2', 'r1'] })).toEqual({ ok: true, state: 'good_standing', charges: 2, remaining: 0 })
    expect(h.actions.find((a) => a.id === id)!.status).toBe('overturned')
    expect(await dailySync()).toBe('good_standing')
  })

  it('scamChargesForAction lists the standing charges for the dialog, and null for a dead row', async () => {
    const { scamChargesForAction } = await import('./scam-hold')
    confirmScam('r1', 20, 'L1')
    await dailySync()
    const id = scamAction().id
    expect(await scamChargesForAction(id)).toEqual([expect.objectContaining({ reportId: 'r1', stage: 'held', listingId: 'L1', reason: null })])
    expect(await scamChargesForAction('nope')).toBeNull()
  })
})

describe('a release from an admin suspension row does not spend ITS appeal (review: LOW)', () => {
  it('the markers land, the suspension and its pending appeal are left for the admin', async () => {
    confirmScam('r1', 20)
    await dailySync()
    const { applyEnforcement } = await import('./enforcement')
    await applyEnforcement('p1', { state: 'suspended', reason: 'admin_manual', expiresAt: null }, { decidedBy: ADMIN })
    const susp = h.actions.find((a) => a.status === 'active')!
    Object.assign(susp, { appealText: 'please', appealedAt: new Date(), appealOutcome: null })
    const r = await releaseScamHold({ actionId: susp.id, admin: ADMIN, plan: PLAN })
    expect(r).toMatchObject({ ok: true, state: 'suspended', charges: 1 })
    expect(h.events.filter((e) => e.type === 'manual_adjust')).toHaveLength(1)
    expect(h.actions.find((a) => a.id === susp.id)).toMatchObject({ status: 'active', appealOutcome: null })
  })
})

describe('an overturn on a stale row never reports an overturn that did not happen (review: LOW)', () => {
  it('a merely RELEASED charge (the release\'s sync failed) is overturned for real, or not at all', async () => {
    confirmScam('r1', 20)
    await dailySync()
    // The release's marker landed; its fail-quiet sync did not — the scam_hold row is stale.
    h.events.push({ id: 'mk', subjectProfileId: 'p1', type: 'manual_adjust', delta: 0, reason: 'scam_release:r1', reportId: 'r1', createdAt: new Date() })
    const id = scamAction().id
    const r = await overturnScamHold({ actionId: id, admin: ADMIN })
    expect(r).toMatchObject({ ok: true, charges: 1, remaining: 0 })
    expect(h.reports[0].status).toBe('overturned') // the charge was actually reversed…
    expect(h.events.filter((e) => e.type === 'report_dismissed').map((e) => e.reportId)).toEqual(['r1'])
    expect(h.actions.find((a) => a.id === id)!.status).not.toBe('active') // …and the stale row is gone
    expect(await dailySync()).toBe('good_standing')
  })

  it('with NOTHING standing at all, the stale row is ended and the answer says 0 charges', async () => {
    confirmScam('r1', 20)
    await dailySync()
    h.reports[0].status = 'dismissed' // a won appeal whose re-derive never landed
    expect(await overturnScamHold({ actionId: scamAction().id, admin: ADMIN })).toEqual({ ok: true, state: 'good_standing', charges: 0, remaining: 0 })
  })
})

describe('the release notice says what a release gives back — posting, capped — and what it does not', () => {
  const LIMIT = ENFORCEMENT.SCAM_RELEASED.MAX_ACTIVE_LISTINGS

  it('en: names the listing that stays down, and says posting returns with the limit and why', async () => {
    await confirmScamOnListing('r1', 20, 'L1')
    h.notices = []
    await releaseScamHold({ actionId: scamAction().id, admin: ADMIN, plan: PLAN })
    await Promise.all(h.pending)
    const body = h.notices.map((n) => n.body).join(' ')
    expect(body).toMatch(/apart from any listing a confirmed report was about/)
    expect(body).toMatch(/You can post again, with a limit/)
    expect(body).toContain(`while it stands you can keep at most ${LIMIT} active listings, counting the ones now visible again`)
    expect(body).toMatch(/confirmed report stays on your record at full weight/)
    expect(body).not.toMatch(/may stay blocked/)
    expect(body).not.toMatch(/rebuild|recover|restored|improves/i)
  })

  it('vi: the same, curated', async () => {
    h.profile.locale = 'vi'
    await confirmScamOnListing('r1', 20, 'L1')
    h.notices = []
    await releaseScamHold({ actionId: scamAction().id, admin: ADMIN, plan: PLAN })
    await Promise.all(h.pending)
    const body = h.notices.map((n) => n.body).join(' ')
    expect(body).toMatch(/trừ tin đăng mà báo cáo đã xác nhận nhắc đến/)
    expect(body).toMatch(/Bạn có thể đăng tin trở lại/)
    expect(body).toContain(`chỉ được giữ tối đa ${LIMIT} tin đang đăng, kể cả các tin vừa hiển thị trở lại`)
    expect(body).not.toMatch(/vẫn bị chặn/)
    expect(body).not.toMatch(/phục hồi/)
  })
})

/**
 * POSTING AFTER A RELEASE (owner, 2026-09-24) — the regime the publish paths ask about, derived by the
 * REAL computeTrustV2 over the rows the real release wrote. The cores' use of it is proved in
 * src/lib/core/released-charge-cap.test.ts.
 */
describe('releasedChargeStanding / releasedChargeGate — the regime, from the ledger', () => {
  const LIMIT = ENFORCEMENT.SCAM_RELEASED.MAX_ACTIVE_LISTINGS

  it('no release marker ever written → null, even while a charge is HELD (the hold decides that seller)', async () => {
    confirmScam('r1', 20)
    await dailySync()
    expect(await releasedChargeStanding('p1')).toBeNull()
    expect(await releasedChargeGate('p1', 's1')).toBeNull()
  })

  it('⛔ after a release the account is STILL restricted-tier — which is why the waiver exists — and the regime waives it, capped', async () => {
    await confirmScamOnListing('r1', 20, 'L1')
    await releaseScamHold({ actionId: scamAction().id, admin: ADMIN, plan: PLAN })
    await Promise.all(h.pending)
    expect(h.profile.trustTier).toBe('restricted') // the frozen charge keeps the score under 60
    expect(await releasedChargeStanding('p1')).toEqual({ waivesRestricted: true, limit: LIMIT })
    // Both listings are status 'active' (L1, the reported one, stays down as verified=false but is
    // still an active row) — the cap counts the status, as the probation cap does.
    expect(await releasedChargeGate('p1', 's1')).toEqual({ waivesRestricted: true, limit: LIMIT, active: 2, remaining: LIMIT - 2 })
  })

  it('⛔ a released seller ALSO kept under the floor by OTHER confirmed conduct is not waived — the waiver is for the released charges only', async () => {
    await confirmScamOnListing('r1', 20, 'L1')
    await releaseScamHold({ actionId: scamAction().id, admin: ADMIN, plan: PLAN })
    await Promise.all(h.pending)
    expect(await releasedChargeStanding('p1')).toEqual({ waivesRestricted: true, limit: LIMIT })
    // Other confirmed, non-scam violations — enough to keep the account under 60 without the scam.
    for (let i = 0; i < 8; i++) {
      h.reports.push({ id: `m${i}`, severity: 'moderate', reporterProfileId: `b${i}`, status: 'confirmed', resolvedBy: ADMIN, remediatedAt: null, targetProfileId: 'p1', targetSellerId: null, appealedAt: null, listingId: null, createdAt: new Date(Date.now() - 6 * DAY) })
      h.events.push({ id: nextId('ev'), subjectProfileId: 'p1', type: 'report_confirmed', delta: -18, reason: `report:m${i}`, reportId: `m${i}`, createdAt: new Date(Date.now() - 5 * DAY) })
    }
    const { computeTrustV2 } = await import('./trust')
    expect((await computeTrustV2('p1'))!.inputs.scoreWithoutReleasedScams).toBeLessThan(60)
    expect(await releasedChargeStanding('p1')).toEqual({ waivesRestricted: false, limit: LIMIT })
  })

  it('a NEW held charge beside the released one → the restricted refusal is not waived (the cap still stands)', async () => {
    await confirmScamOnListing('r1', 20, 'L1')
    await releaseScamHold({ actionId: scamAction().id, admin: ADMIN, plan: PLAN })
    confirmScam('r2', 1, null, 'buyer2')
    await dailySync()
    expect(await releasedChargeStanding('p1')).toEqual({ waivesRestricted: false, limit: LIMIT })
  })

  it('the released charge later OVERTURNED → the regime is over (null)', async () => {
    confirmScam('r1', 20)
    await dailySync()
    await releaseScamHold({ actionId: scamAction().id, admin: ADMIN, plan: PLAN })
    // A released account sits on a `throttled` (conduct) action — any active ladder row carries the overturn.
    const row = h.actions.find((a) => a.status === 'active' && a.profileId === 'p1')!
    expect(row).toBeTruthy()
    expect(await releasedChargeStanding('p1')).not.toBeNull()
    expect(await overturnScamHold({ actionId: row.id, admin: ADMIN, reportIds: ['r1'] })).toMatchObject({ ok: true, charges: 1 })
    expect(await releasedChargeStanding('p1')).toBeNull()
  })
})

/**
 * Review of the gate run, 2026-09-24 (agy + opus). Two real defects fixed, one claim disproved here:
 *   · the release RETRY (the first click's markers landed, its fail-quiet sync did not) re-derived with
 *     no notice override, so the seller an admin had just released was told "under review" — and it
 *     wrote no audit line, nor did the overturn of a stale row;
 *   · "a listing an EARLIER released charge was about is republished by the next release" — it is not:
 *     the second hold never pulls it (it pulls verified or identity-parked rows only), so no restore
 *     can bring it back.
 */
describe('review 2026-09-24 — the retry, the stale overturn, and a second offence', () => {
  it('a release RETRY tells the seller it was a release (not "under review") and is on the record', async () => {
    await confirmScamOnListing('r1', 20, 'L1')
    // The first click's marker landed; its fail-quiet sync did not — the account is still held.
    h.events.push({ id: 'mk', subjectProfileId: 'p1', type: 'manual_adjust', delta: 0, reason: 'scam_release:r1', reportId: 'r1', createdAt: new Date() })
    h.notices = []
    h.audit = []
    const r = await releaseScamHold({ actionId: scamAction().id, admin: ADMIN, plan: PLAN })
    await Promise.all(h.pending)
    expect(r).toMatchObject({ ok: true, charges: 0 })
    expect(h.notices.map((n) => n.title)).toEqual(['Your listings are visible again'])
    expect(h.audit).toEqual([expect.objectContaining({ action: 'enforcement.scam_release_rederived', actorId: ADMIN, subjectId: 'p1' })])
  })

  it('the overturn of a STALE row (nothing standing) is on the record too', async () => {
    confirmScam('r1', 20)
    await dailySync()
    h.reports[0].status = 'dismissed' // a won appeal whose re-derive never landed
    h.audit = []
    await overturnScamHold({ actionId: scamAction().id, admin: ADMIN })
    expect(h.audit).toEqual([expect.objectContaining({ action: 'enforcement.scam_overturned', actorId: ADMIN, detail: expect.objectContaining({ reportIds: [], staleRow: true }) })])
  })

  it('⛔ a listing an EARLIER released charge was about stays down through a second hold and its release', async () => {
    await confirmScamOnListing('r1', 40, 'L1')
    await releaseScamHold({ actionId: scamAction().id, admin: ADMIN, plan: PLAN })
    await Promise.all(h.pending)
    expect(liveListings()).toEqual(['L2'])
    h.listings.push({ id: 'L3', sellerId: 's1', status: 'active', verified: true, identityHold: false, soldAt: null, updatedAt: new Date(), postedAt: new Date(), availabilityConfirmedAt: null, affiliateUrl: null })
    // A second victim: confirmed on L2, the new hold pulls the live rows (L3, L2) — not L1.
    await confirmScamOnListing('r2', 20, 'L2')
    expect(liveListings()).toEqual([])
    expect(pulledIds()).not.toContain('L1')
    const r = await releaseScamHold({ actionId: scamAction().id, admin: ADMIN, plan: PLAN })
    await Promise.all(h.pending)
    expect(r).toMatchObject({ ok: true, charges: 1 })
    expect(liveListings()).toEqual(['L3']) // L1 and L2 — both reported listings — stay down
  })
})

describe('review 2026-09-24 (second pass) — the notice override and the overturn\'s one transaction', () => {
  it('the release notice never rides a move that keeps listings down — that move gets its own notice', async () => {
    const { applyEnforcement } = await import('./enforcement')
    h.notices = []
    await applyEnforcement('p1', { state: 'held', reason: 'ban_evasion_review', expiresAt: null }, { decidedBy: 'system', notice: 'scam_released' })
    await Promise.all(h.pending)
    expect(h.notices).toHaveLength(1)
    expect(h.notices[0].title).not.toBe('Your listings are visible again')
  })

  it('⛔ the reversal markers commit WITH the report status: a failure leaves nothing half-done, and the retry completes it', async () => {
    // The FAKE db this file installs (vi.mock('./db') above) — typed as what it is here.
    const { db } = (await import('./db')) as unknown as { db: Row }
    confirmScam('r1', 20)
    await dailySync()
    const id = scamAction().id
    const createMany = db.trustEvent.createMany
    let failOnce = true
    db.trustEvent.createMany = async (a: Row) => {
      if (failOnce && a.data.some((d: Row) => d.type === 'report_dismissed')) { failOnce = false; throw new Error('db hiccup') }
      return createMany(a)
    }
    try {
      await expect(overturnScamHold({ actionId: id, admin: ADMIN })).rejects.toThrow('db hiccup')
      // Rolled back together: the report still carries the charge, and there is no half-written reversal.
      expect(h.reports[0].status).toBe('confirmed')
      expect(h.events.filter((e) => e.type === 'report_dismissed')).toEqual([])
      // The retry finds the charge still standing and does the whole overturn.
      expect(await overturnScamHold({ actionId: id, admin: ADMIN })).toMatchObject({ ok: true, charges: 1 })
      expect(h.reports[0].status).toBe('overturned')
      expect(h.events.filter((e) => e.type === 'report_dismissed').map((e) => e.reportId)).toEqual(['r1'])
    } finally {
      db.trustEvent.createMany = createMany
    }
  })
})
