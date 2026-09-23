import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A SELLER'S DELETE MUST NOT ERASE OTHER PEOPLE'S EVIDENCE (2026-09-23).
 *
 * `Listing` → `Report` and `Listing` → `Conversation` both CASCADE, so a seller deleting a listing
 * deletes every buyer's report about it (and its dispute thread) and every buyer's chat. For a held or
 * suspended seller, or one with an open report, that is evidence destruction — during exactly the
 * window (a scam hold's 14 days before release) meant for other victims to come forward. So
 * deleteListingCore — the one core behind the dashboard, the partner API and the MCP tool — HIDES in
 * those cases and says so. These tests call the real function over a small fake database.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  listing: null as Row | null,
  owner: null as Row | null,
  reports: [] as Row[],
  /** Force the conditional delete to match nothing (a report landed after the check). */
  deleteMatchesNothing: false,
  calls: [] as Array<{ m: string; args: any }>,
}))

function matchReport(r: Row, where: Row): boolean {
  if (where.status === 'open' && r.status !== 'open') return false
  if (where.status?.not === 'open' && r.status === 'open') return false
  if (where.listingId !== undefined && r.listingId !== where.listingId) return false
  if (where.OR) return (where.OR as Row[]).some((w) => Object.entries(w).every(([k, v]) => r[k] === v))
  return true
}

vi.mock('@/lib/db', () => {
  const rec = (m: string, args: unknown) => { h.calls.push({ m, args }) }
  const db: Row = {
    listing: {
      findUnique: async (a: Row) => { rec('listing.findUnique', a); return h.listing ? { ...h.listing } : null },
      update: async (a: Row) => { rec('listing.update', a); if (h.listing) Object.assign(h.listing, a.data); return {} },
      deleteMany: async (a: Row) => {
        rec('listing.deleteMany', a)
        if (h.deleteMatchesNothing || !h.listing) return { count: 0 }
        h.listing = null
        return { count: 1 }
      },
      count: async () => 0,
    },
    profile: { findUnique: async (a: Row) => { rec('profile.findUnique', a); return h.owner } },
    report: {
      count: async (a: Row) => { rec('report.count', a); return h.reports.filter((r) => matchReport(r, a.where)).length },
      updateMany: async (a: Row) => {
        rec('report.updateMany', a)
        const hit = h.reports.filter((r) => matchReport(r, a.where))
        for (const r of hit) Object.assign(r, a.data)
        return { count: hit.length }
      },
    },
  }
  // An interactive transaction that ROLLS BACK on throw — the property the zero-row path relies on.
  db.$transaction = async (fn: (tx: Row) => Promise<unknown>) => {
    const snapshot = h.reports.map((r) => ({ ...r }))
    try {
      return await fn(db)
    } catch (e) {
      h.reports = snapshot
      rec('$transaction.rollback', null)
      throw e
    }
  }
  return { db }
})

// ── The dependency wall (same as listings.republish.test.ts): stubbed, not exercised. ─────────────
vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: () => {} }))
vi.mock('@/lib/listing-index', () => ({ reindexListing: async () => {}, removeFromIndex: async () => {} }))
vi.mock('@/lib/trust', () => ({ recordEngagement: async () => {} }))
vi.mock('@/lib/stale', () => ({ canBump: () => false }))
vi.mock('@/lib/translate', () => ({ warmTranslations: async () => {} }))
vi.mock('@/lib/listing-image', () => ({ isListingImageUrl: () => true }))
vi.mock('@/lib/core/media', () => ({ isCanonicalVideoUrl: () => true, removeListingVideoByUrl: async () => {} }))
vi.mock('@/lib/brand', () => ({ categoryHasBrand: () => false, resolveBrand: async () => null, bumpBrandCount: async () => {}, enrichBrandLogoIfMissing: async () => {} }))
vi.mock('@/lib/syndicate', () => ({ syndicateListingIfPublic: async () => {} }))
vi.mock('@/lib/meta-capi', () => ({ sendMetaCapiEvent: async () => {}, metaUserDataFromHeaders: () => ({}) }))
vi.mock('@/lib/webhooks', () => ({ dispatchListingEvent: async () => {} }))
vi.mock('@/lib/ranking', () => ({ browseRankScore: () => 0, recomputeRankScoreForListing: async () => {} }))
vi.mock('@/lib/compliance/account-state', () => ({ identityGateEnforced: () => false }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ assertSellerMayPublish: async () => {}, sellerPublishDecision: async () => ({ ok: true }) }))
vi.mock('@/lib/duplicate-guard', () => ({ findDuplicateListing: async () => null }))
vi.mock('@/lib/ai-moderation', () => ({ moderateListingById: async () => {} }))
vi.mock('@/lib/image-provenance', () => ({ indexAndCheckProvenance: async () => {} }))
vi.mock('@/lib/price-drop', () => ({ priceChangeEffects: async () => ({ data: {}, audit: null, notify: null }) }))
vi.mock('@/lib/urgent', () => ({ activateUrgentGate: async () => ({ ok: true }), urgentQuotaFree: () => true, URGENT: {} }))

const { deleteListingCore, DELETE_HOLD_MESSAGE } = await import('@/lib/core/listings')

const called = (m: string) => h.calls.filter((c) => c.m === m)
const hidWith = (status = 'hidden') => called('listing.update').some((c) => c.args.data.status === status)

beforeEach(() => {
  h.listing = { id: 'L1', brandSlug: null, sellerId: 's1', video: null, status: 'active', soldAt: null, updatedAt: new Date(), seller: { ownerId: 'p1' } }
  h.owner = { enforcementState: 'good_standing' }
  h.reports = []
  h.deleteMatchesNothing = false
  h.calls = []
})

describe('a seller under investigation cannot hard-delete — the listing is hidden instead', () => {
  it('held → hidden, nothing deleted, and the reason says so', async () => {
    h.owner = { enforcementState: 'held' }
    expect(await deleteListingCore('L1')).toEqual({ ok: true, deleted: false, hidden: true, reason: 'account_held' })
    expect(hidWith()).toBe(true)
    expect(called('listing.deleteMany')).toHaveLength(0)
    expect(called('report.updateMany')).toHaveLength(0)
  })

  it('suspended → hidden', async () => {
    h.owner = { enforcementState: 'suspended' }
    expect(await deleteListingCore('L1')).toMatchObject({ deleted: false, reason: 'account_suspended' })
    expect(called('listing.deleteMany')).toHaveLength(0)
  })

  it.each<[string, Row]>([
    ['this listing', { listingId: 'L1' }],
    ['the shop', { targetSellerId: 's1' }],
    ['the owner account', { targetProfileId: 'p1' }],
  ])('an OPEN report against %s → hidden', async (_label, target) => {
    h.reports = [{ id: 'r1', status: 'open', listingId: null, targetSellerId: null, targetProfileId: null, ...target }]
    expect(await deleteListingCore('L1')).toMatchObject({ deleted: false, hidden: true, reason: 'open_report' })
    expect(called('listing.deleteMany')).toHaveLength(0)
    expect(h.reports[0].listingId).toBe(target.listingId ?? null) // untouched
  })

  it('an already-hidden listing is not rewritten', async () => {
    h.owner = { enforcementState: 'held' }
    h.listing!.status = 'hidden'
    expect(await deleteListingCore('L1')).toMatchObject({ deleted: false, hidden: true })
    expect(called('listing.update')).toHaveLength(0)
  })

  it('a sold listing hides as a sold one does (its sale time frozen, not re-stamped)', async () => {
    h.owner = { enforcementState: 'held' }
    h.listing = { ...h.listing!, status: 'sold', soldAt: null, updatedAt: new Date('2026-01-01') }
    await deleteListingCore('L1')
    expect(called('listing.update')[0].args.data).toMatchObject({ status: 'hidden', soldAt: new Date('2026-01-01') })
  })

  it('every reason has an API/MCP sentence', () => {
    for (const r of ['account_suspended', 'account_held', 'open_report'] as const) expect(DELETE_HOLD_MESSAGE[r]).toMatch(/hidden, not deleted/)
  })
})

describe('an ordinary delete', () => {
  it('deletes, detaching RESOLVED reports first so the decided record survives', async () => {
    h.reports = [
      { id: 'r-confirmed', status: 'confirmed', listingId: 'L1' },
      { id: 'r-dismissed', status: 'dismissed', listingId: 'L1' },
      { id: 'r-other', status: 'confirmed', listingId: 'L9' },
    ]
    expect(await deleteListingCore('L1')).toEqual({ ok: true, deleted: true })
    expect(h.reports.map((r) => [r.id, r.listingId])).toEqual([['r-confirmed', null], ['r-dismissed', null], ['r-other', 'L9']])
    // The delete itself is CONDITIONAL on still having no open report — the race guard.
    expect(called('listing.deleteMany')[0].args.where).toEqual({ id: 'L1', reports: { none: { status: 'open' } } })
    expect(hidWith()).toBe(false)
  })

  it('a guest storefront (no owner) deletes when nothing is open, and never reads a profile', async () => {
    h.listing!.seller = { ownerId: null }
    expect(await deleteListingCore('L1')).toEqual({ ok: true, deleted: true })
    expect(called('profile.findUnique')).toHaveLength(0)
    expect(called('report.count')[0].args.where.OR).toEqual([{ listingId: 'L1' }, { targetSellerId: 's1' }])
  })

  it('a report landing between the check and the delete: the detach is ROLLED BACK and the listing hidden', async () => {
    h.reports = [{ id: 'r-confirmed', status: 'confirmed', listingId: 'L1' }]
    h.deleteMatchesNothing = true
    expect(await deleteListingCore('L1')).toEqual({ ok: true, deleted: false, hidden: true, reason: 'open_report' })
    expect(called('$transaction.rollback')).toHaveLength(1)
    expect(h.reports[0].listingId).toBe('L1') // not cut loose
    expect(hidWith()).toBe(true)
  })

  it('a listing that vanished concurrently is a typed not-found', async () => {
    h.listing = null
    expect(await deleteListingCore('L1')).toEqual({ ok: false, code: 404, error: 'not_found' })
  })
})
