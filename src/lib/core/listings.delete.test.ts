import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A SELLER'S DELETE MUST NOT ERASE OTHER PEOPLE'S EVIDENCE (2026-09-23) — AND SINCE 2026-10-01 IT
 * ERASES NOTHING AT ALL.
 *
 * `Listing` → `Report` and `Listing` → `Conversation` both CASCADE, so a hard delete took every buyer's
 * report and chat with it. Two layers now: (1) a held or suspended seller, or one with an open report,
 * gets a HIDE instead (deleteHoldReason); (2) every other delete is a TOMBSTONE — status 'removed',
 * unpublished, a compliance_audit row — never a DELETE (Law 122/2025 Art 17.1(e); src/lib/listing-removed.ts).
 * These tests call the real function over a small fake database.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  listing: null as Row | null,
  owner: null as Row | null,
  reports: [] as Row[],
  /** Force the conditional tombstone write to match nothing (a report landed after the check). */
  deleteMatchesNothing: false,
  calls: [] as Array<{ m: string; args: any }>,
  audits: [] as Row[],
  /** after() callbacks, collected (not run) — a test runs them when it means to. */
  afters: [] as Array<() => unknown>,
  storageTombstones: [] as Row[],
  purgedUrls: [] as string[],
  cleared: [] as Row[],
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
      // setStatusCore's hide (hideInsteadOfDelete) — one id, conditional on not being a tombstone.
      updateMany: async (a: Row) => {
        rec('listing.updateMany', a)
        if (!h.listing || h.listing.status === a.where?.status?.not) return { count: 0 }
        Object.assign(h.listing, a.data)
        return { count: 1 }
      },
      deleteMany: async (a: Row) => { rec('listing.deleteMany', a); return { count: 0 } },
      // The tombstone's read and its conditional write (src/lib/core/listing-tombstone.ts).
      findMany: async (a: Row) => {
        rec('listing.findMany', a)
        const l = h.listing
        if (!l || l.status === 'removed') return []
        const openOnIt = h.reports.some((r) => r.status === 'open' && r.listingId === l.id)
        // The open-report guard is AND-ed by tombstoneListingsTx (never spread over its status filter).
        const guards: Row[] = [a.where ?? {}, ...((a.where?.AND as Row[] | undefined) ?? [])]
        if (guards.some((w) => w.reports?.none?.status === 'open') && openOnIt) return []
        return [{ id: l.id, status: l.status, verified: l.verified ?? true, externalId: l.externalId ?? null, sellerId: l.sellerId, brandSlug: l.brandSlug, video: l.video ?? null, images: l.images ?? '[]' }]
      },
      updateManyAndReturn: async (a: Row) => {
        rec('listing.updateManyAndReturn', a)
        if (h.deleteMatchesNothing || !h.listing || h.listing.status === 'removed') return []
        Object.assign(h.listing, a.data)
        return [{ id: h.listing.id }]
      },
      count: async () => 0,
    },
    profile: { findUnique: async (a: Row) => { rec('profile.findUnique', a); return h.owner } },
    // The teacher branch: the CV path, and the profile that goes with its listing.
    teacherPrivate: { findUnique: async (a: Row) => { rec('teacherPrivate.findUnique', a); return { cvPath: 'cv/tp1.pdf' } } },
    teacherProfile: { deleteMany: async (a: Row) => { rec('teacherProfile.deleteMany', a); return { count: 1 } } },
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

// The audit chain: recorded, not hashed (compliance/audit.ts has its own tests).
vi.mock('@/lib/compliance/audit', () => ({ appendAudit: async (_tx: unknown, input: Row) => { h.audits.push(input) } }))

// ── The dependency wall (same as listings.republish.test.ts): stubbed, not exercised. ─────────────
vi.mock('next/server', () => ({ after: (fn: () => unknown) => { h.afters.push(fn) } }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: () => {} }))
vi.mock('@/lib/listing-index', () => ({ reindexListing: async () => {}, removeFromIndex: async () => {} }))
vi.mock('@/lib/trust', () => ({ recordEngagement: async () => {} }))
vi.mock('@/lib/stale', () => ({ canBump: () => false }))
vi.mock('@/lib/translate', () => ({ warmTranslations: async () => {} }))
const STORE = 'https://sb.eno.vn/storage/v1/object/public/'
vi.mock('@/lib/listing-image', () => ({
  isListingImageUrl: () => true,
  // Only first-party objects parse — a foreign URL is not ours to delete.
  listingObjectKey: (u: string) => {
    for (const bucket of ['listings', 'listing-videos'] as const) if (u.startsWith(`${STORE}${bucket}/`)) return { bucket, key: u.slice(`${STORE}${bucket}/`.length), url: u }
    return null
  },
}))
vi.mock('@/lib/core/storage-tombstones', () => ({
  writeTombstones: async (_tx: unknown, refs: Row[], reason: string) => { h.storageTombstones.push(...refs.map((r) => ({ ...r, reason }))); return refs.length },
  clearTombstones: async (refs: Row[]) => { h.cleared.push(...refs); return refs.length },
}))
vi.mock('@/lib/core/storage-purge', () => ({
  purgeStorageObjects: async (urls: string[]) => {
    h.purgedUrls.push(...urls)
    return { deleted: urls.length, kept: 0, foreign: 0, failed: 0, residue: [], settled: urls.map((u) => ({ bucket: u.includes('/listing-videos/') ? 'listing-videos' : 'listings', path: u.split('/').pop() })) }
  },
}))
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
const hidWith = (status = 'hidden') => called('listing.updateMany').some((c) => c.args.data.status === status)

beforeEach(() => {
  h.listing = { id: 'L1', brandSlug: null, sellerId: 's1', video: null, status: 'active', verified: true, externalId: null, soldAt: null, updatedAt: new Date(), seller: { ownerId: 'p1' } }
  h.owner = { enforcementState: 'good_standing' }
  h.reports = []
  h.deleteMatchesNothing = false
  h.calls = []
  h.audits = []
  h.afters = []
  h.storageTombstones = []
  h.purgedUrls = []
  h.cleared = []
})

describe('a seller under investigation cannot hard-delete — the listing is hidden instead', () => {
  it('held → hidden, nothing deleted, and the reason says so', async () => {
    h.owner = { enforcementState: 'held' }
    expect(await deleteListingCore('L1')).toEqual({ ok: true, deleted: false, hidden: true, reason: 'account_held' })
    expect(hidWith()).toBe(true)
    expect(called('listing.deleteMany')).toHaveLength(0)
    expect(called('listing.updateManyAndReturn')).toHaveLength(0)
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
    expect(called('listing.updateMany')).toHaveLength(0)
  })

  it('a sold listing hides as a sold one does (its sale time frozen, not re-stamped)', async () => {
    h.owner = { enforcementState: 'held' }
    h.listing = { ...h.listing!, status: 'sold', soldAt: null, updatedAt: new Date('2026-01-01') }
    await deleteListingCore('L1')
    expect(called('listing.updateMany')[0].args.data).toMatchObject({ status: 'hidden', soldAt: new Date('2026-01-01') })
  })

  it('every reason has an API/MCP sentence — and none claims a delete would erase reports or chats', () => {
    for (const r of ['account_suspended', 'account_held', 'open_report'] as const) {
      expect(DELETE_HOLD_MESSAGE[r]).toMatch(/hidden, not deleted/)
      // A delete is a tombstone now: saying it "would erase" anything would be false.
      expect(DELETE_HOLD_MESSAGE[r]).not.toMatch(/erase/)
    }
  })
})

describe('an ordinary delete is a TOMBSTONE, never a DELETE', () => {
  it('status removed + unpublished, reports untouched, one audit row naming the owner', async () => {
    h.reports = [
      { id: 'r-confirmed', status: 'confirmed', listingId: 'L1' },
      { id: 'r-dismissed', status: 'dismissed', listingId: 'L1' },
    ]
    expect(await deleteListingCore('L1')).toEqual({ ok: true, deleted: true })
    expect(called('listing.deleteMany')).toHaveLength(0) // ⛔ never a hard delete
    expect(h.listing).toMatchObject({ status: 'removed', verified: false, identityHold: false, featured: false })
    // Reports keep pointing at the listing — the decided record stays attached to its evidence.
    expect(h.reports.map((r) => [r.id, r.listingId])).toEqual([['r-confirmed', 'L1'], ['r-dismissed', 'L1']])
    expect(called('report.updateMany')).toHaveLength(0)
    // The write is CONDITIONAL on still having no open report and not already being removed — the race guard.
    expect(called('listing.updateManyAndReturn')[0].args.where).toMatchObject({ status: { not: 'removed' }, AND: [{ reports: { none: { status: 'open' } } }] })
    expect(h.audits).toEqual([expect.objectContaining({
      action: 'listing.removed', actorType: 'user', actorId: 'p1', subjectType: 'listing', subjectId: 'L1', legalBasis: 'ecommerceLaw',
      detail: expect.objectContaining({ by: 'seller', reason: 'seller_deleted', priorStatus: 'active', priorVerified: true, sellerId: 's1' }),
    })])
  })

  it('releases the partner externalId (kept in the audit row) so a later sync can re-create the SKU', async () => {
    h.listing!.externalId = 'sku-1'
    await deleteListingCore('L1')
    expect(called('listing.updateManyAndReturn')[0].args.data).toMatchObject({ externalId: null })
    expect(h.audits[0].detail).toMatchObject({ externalId: 'sku-1' })
  })

  it('a guest storefront (no owner) is audited by its seller id, and never reads a profile', async () => {
    h.listing!.seller = { ownerId: null }
    expect(await deleteListingCore('L1')).toEqual({ ok: true, deleted: true })
    expect(called('profile.findUnique')).toHaveLength(0)
    expect(called('report.count')[0].args.where.OR).toEqual([{ listingId: 'L1' }, { targetSellerId: 's1' }])
    expect(h.audits[0]).toMatchObject({ actorType: 'user', actorId: 'seller:s1' })
  })

  it('a report landing between the check and the write: ROLLED BACK and the listing hidden', async () => {
    h.reports = [{ id: 'r-confirmed', status: 'confirmed', listingId: 'L1' }]
    h.deleteMatchesNothing = true
    expect(await deleteListingCore('L1')).toEqual({ ok: true, deleted: false, hidden: true, reason: 'open_report' })
    expect(called('$transaction.rollback')).toHaveLength(1)
    expect(h.reports[0].listingId).toBe('L1')
    expect(hidWith()).toBe(true)
    expect(h.audits).toHaveLength(0)
  })

  it('a listing that vanished, or is ALREADY a tombstone, is a typed not-found (no second audit row)', async () => {
    h.listing = null
    expect(await deleteListingCore('L1')).toEqual({ ok: false, code: 404, error: 'not_found' })
    h.listing = { id: 'L1', brandSlug: null, sellerId: 's1', status: 'removed', verified: false, seller: { ownerId: 'p1' } }
    expect(await deleteListingCore('L1')).toEqual({ ok: false, code: 404, error: 'not_found' })
    expect(h.audits).toHaveLength(0)
  })
})

describe('⛔ a TEACHER\'s profile listing is a person: its tombstone is SCRUBBED (2026-10-01 review)', () => {
  const PHOTO = `${STORE}listings/1700000000000-abcd.webp`
  const VIDEO = `${STORE}listing-videos/1700000000000-clip.mp4`
  const teacher = () => ({
    id: 'L1', brandSlug: null, sellerId: 's1', status: 'active', verified: true, externalId: null, seller: { ownerId: 'p1' },
    listingType: 'teacher', teacherProfile: { id: 'tp1' },
    title: 'Jane Doe', titleVi: null, description: 'CELTA-certified English teacher, 6 years in Saigon', descriptionVi: null,
    images: JSON.stringify([PHOTO, 'https://lh3.googleusercontent.com/a/foreign']), video: VIDEO,
    location: 'Thảo Điền, Hồ Chí Minh', district: 'Thảo Điền', searchText: 'jane doe celta english teacher', facetTokens: '|subject:english|',
  })

  it('leaves no name, bio, photo, video or location on the row — the removal record stays', async () => {
    h.listing = teacher()
    expect(await deleteListingCore('L1')).toEqual({ ok: true, deleted: true })
    expect(called('listing.deleteMany')).toHaveLength(0) // still a tombstone, not a hard delete
    expect(h.listing).toMatchObject({
      status: 'removed', verified: false, sellerId: 's1',
      title: '[removed]', titleVi: null, description: '', descriptionVi: null, images: '[]', video: null,
      searchText: '', facetTokens: null, location: '', district: null, lat: null, lng: null,
    })
    expect(JSON.stringify(h.listing)).not.toMatch(/Jane|CELTA|Thảo Điền|1700000000000/)
    // The audit row says the erasure happened — and still carries no PII.
    expect(h.audits[0]).toMatchObject({ action: 'listing.removed', detail: { reason: 'seller_deleted', personalDataScrubbed: true } })
    expect(JSON.stringify(h.audits[0])).not.toMatch(/Jane|CELTA/)
    // The profile and its CV go with it, as before.
    expect(called('teacherProfile.deleteMany')).toHaveLength(1)
  })

  it('queues the first-party photo and clip for the storage sweep IN the transaction, and purges them after it', async () => {
    h.listing = teacher()
    await deleteListingCore('L1')
    expect(h.storageTombstones).toEqual(expect.arrayContaining([
      { bucket: 'listings', path: '1700000000000-abcd.webp', reason: 'teacher_profile_deleted' },
      { bucket: 'listing-videos', path: '1700000000000-clip.mp4', reason: 'teacher_profile_deleted' },
    ]))
    expect(h.storageTombstones.some((t) => t.path === 'cv/tp1.pdf')).toBe(true) // the CV, as before
    expect(h.storageTombstones.some((t) => t.path.includes('googleusercontent'))).toBe(false) // a foreign URL is not ours
    expect(h.purgedUrls).toEqual([])
    for (const fn of h.afters) await fn()
    expect(h.purgedUrls).toEqual([PHOTO, VIDEO])
    expect(h.cleared).toHaveLength(2) // what the fast path settled leaves the sweep's queue
  })

  it('an ordinary goods listing is NOT scrubbed — the posted content is what the tombstone keeps', async () => {
    h.listing = { ...teacher(), listingType: 'sell', teacherProfile: null, title: 'iPhone 15 Pro', description: 'Like new' }
    await deleteListingCore('L1')
    expect(h.listing).toMatchObject({ status: 'removed', title: 'iPhone 15 Pro', description: 'Like new', video: VIDEO })
    expect(h.storageTombstones).toEqual([])
    for (const fn of h.afters) await fn()
    expect(h.purgedUrls).toEqual([])
  })
})
