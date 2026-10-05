import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── A REMOVAL THAT LANDS BETWEEN A CORE'S READ AND ITS WRITE IS NEVER OVERWRITTEN (2026-10-01) ───────
//
// setStatusCore, confirmCore and updateListingCore each READ the row (status, gates, the edit's inputs)
// and then WRITE it. A tombstone (status 'removed' — src/lib/listing-removed.ts) written by a moderator,
// the admin console or the seller's own delete in between used to be overwritten by an unconditional
// `update({ where: { id } })`: a hide/sold/relist or an edit un-removed it. The write now carries the
// guard itself (`status <> 'removed'` in the UPDATE's WHERE) and zero rows is answered like the read
// path answers a tombstone: 404 not_found, with none of the write's side effects.
//
// The fake below models exactly that interleaving: `read` is what the core's findUnique sees, `row` is
// what the database holds when the write arrives.

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  /** What the core's read sees. */
  read: null as Row | null,
  /** What the database holds when the WRITE runs (the race: a removal committed in between). */
  row: null as Row | null,
  writes: [] as Array<{ m: string; args: Row }>,
  priceChanges: 0,
  txCalls: 0,
  purged: [] as string[],
  afters: 0,
  priceAudit: null as Row | null,
}))

/** Prisma's conditional-write semantics, on one row: does `where` still match it? (`equals` is the
 *  reactivation writes' status-they-read condition, 2026-10-05 — see setStatusCore / confirmCore.) */
function matches(row: Row | null, where: Row): boolean {
  if (!row || row.id !== where.id) return false
  const eq = where.status?.equals
  if (eq !== undefined && row.status !== eq) return false
  const not = where.status?.not
  return not === undefined || row.status !== not
}

vi.mock('@/lib/db', () => {
  const db: Row = {
    listing: {
      findUnique: async () => (h.read ? { ...h.read } : null),
      updateMany: async (a: Row) => {
        h.writes.push({ m: 'listing.updateMany', args: a })
        if (!matches(h.row, a.where)) return { count: 0 }
        Object.assign(h.row!, a.data)
        return { count: 1 }
      },
      update: async (a: Row) => {
        h.writes.push({ m: 'listing.update', args: a })
        // `update` with a non-unique filter: one UPDATE … WHERE id AND status <> 'removed'; zero rows → P2025.
        if (!matches(h.row, a.where)) throw Object.assign(new Error('No record was found for an update.'), { code: 'P2025' })
        Object.assign(h.row!, a.data)
        return { id: a.where.id }
      },
      count: async () => 0,
    },
    priceChange: { create: async () => { h.priceChanges++; return {} } },
    teacherProfile: { updateMany: async () => ({ count: 0 }) },
    // The ARRAY form, as the source calls it: a rejected operation rejects the transaction.
    $transaction: async (ops: Promise<unknown>[]) => { h.txCalls++; return Promise.all(ops) },
  }
  return { db }
})

vi.mock('next/server', () => ({ after: () => { h.afters++ } }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: (p: string) => { h.purged.push(p) } }))
vi.mock('@/lib/compliance/account-state', async (orig) => ({
  ...(await orig<typeof import('@/lib/compliance/account-state')>()),
  identityGateEnforced: () => false,
}))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ sellerPublishDecision: async () => ({ ok: true }), assertSellerMayPublish: async () => {} }))
vi.mock('@/lib/released-charge-gate', () => ({ releasedChargeGate: async () => null, releasedChargeStanding: async () => null, releasedChargeGateFor: async () => null }))
vi.mock('@/lib/listing-index', () => ({ reindexListing: async () => {}, removeFromIndex: async () => {} }))
vi.mock('@/lib/trust', () => ({ recordEngagement: async () => {} }))
vi.mock('@/lib/stale', () => ({ canBump: () => false }))
vi.mock('@/lib/translate', () => ({ warmTranslations: async () => {} }))
vi.mock('@/lib/listing-image', () => ({ isListingImageUrl: () => true, isListingVideoUrl: () => true, listingObjectKey: () => null }))
vi.mock('@/lib/core/media', () => ({ isCanonicalVideoUrl: () => true, removeListingVideoByUrl: async () => {} }))
vi.mock('@/lib/brand', () => ({ categoryHasBrand: () => false, resolveBrand: async () => null, bumpBrandCount: async () => {}, enrichBrandLogoIfMissing: async () => {} }))
vi.mock('@/lib/syndicate', () => ({ syndicateListing: async () => {} }))
vi.mock('@/lib/meta-capi', () => ({ sendMetaCapiEvent: async () => {}, metaUserDataFromHeaders: () => ({}) }))
vi.mock('@/lib/webhooks', () => ({ dispatchListingEvent: async () => {}, dispatchListingEventsBatch: async () => {} }))
vi.mock('@/lib/ranking', () => ({ browseRankScore: () => 0, recomputeRankScoreForListing: async () => {} }))
vi.mock('@/lib/duplicate-guard', () => ({ findDuplicateListing: async () => null }))
vi.mock('@/lib/ai-moderation', () => ({ moderateListingById: async () => {} }))
vi.mock('@/lib/image-provenance', () => ({ indexAndCheckProvenance: async () => {} }))
vi.mock('@/lib/price-drop', () => ({ priceChangeEffects: async () => ({ data: {}, audit: h.priceAudit, notify: null }) }))
vi.mock('@/lib/urgent', () => ({ activateUrgentGate: async () => ({ ok: true }), urgentQuotaFree: () => true, URGENT: {} }))

const { setStatusCore, confirmCore, updateListingCore } = await import('@/lib/core/listings')

/** The row as the core's read sees it — every field the three reads select, at their defaults. */
function listing(status: string): Row {
  return {
    id: 'L1', status, sellerId: 's1', listingType: 'sell', soldAt: null, updatedAt: new Date('2026-09-01'),
    seller: { ownerId: 'p1', owner: { enforcementState: 'good_standing' }, trustTier: 'standard' },
    postedAt: new Date('2026-09-01'), sellerTrustScore: 100, featured: false, views: 0, contactCount: 0,
    title: 'A bicycle', description: 'Blue', district: 'District 1', location: 'District 1', brandSlug: null, model: null,
    subcategorySlug: null, verified: true, images: '[]', video: null, condition: null, year: null, titleVi: null,
    descriptionVi: null, price: 1_000_000, createdAt: new Date('2026-09-01'), previousPrice: null, priceDropAt: null,
    lowestNotifiedPrice: null, priceDropNotifiedAt: null, urgentUntil: null,
    category: { slug: 'vehicles', name: 'Vehicles', nameVi: 'Xe cộ' },
  }
}

/** The race: the core reads `before`, and by the time it writes, the row is a tombstone. */
function removedMidway(before: string) {
  h.read = listing(before)
  h.row = { ...listing(before), status: 'removed', verified: false }
}

const NOT_FOUND = { ok: false, code: 404, error: 'not_found' }

beforeEach(() => {
  h.read = null
  h.row = null
  h.writes = []
  h.priceChanges = 0
  h.txCalls = 0
  h.purged = []
  h.afters = 0
  h.priceAudit = null
})

describe('setStatusCore — the write refuses a tombstone even when the read did not see one', () => {
  it.each([
    ['hidden', 'active'],
    ['sold', 'active'],
    ['hidden', 'sold'],
    ['active', 'hidden'],
    ['active', 'sold'],
    ['sold', 'hidden'],
  ])('%s → %s, removed in between: 404, the tombstone stays removed, no purge/reindex/webhook', async (from, to) => {
    removedMidway(from)
    expect(await setStatusCore('L1', to)).toEqual(NOT_FOUND)
    expect(h.row!.status).toBe('removed')
    expect(h.purged).toEqual([])
    expect(h.afters).toBe(0)
  })

  it('the guard is IN the write: where = { id, status: { not: "removed" } }', async () => {
    h.read = listing('active')
    h.row = listing('active')
    expect(await setStatusCore('L1', 'hidden')).toEqual({ ok: true, status: 'hidden' })
    expect(h.writes).toEqual([{ m: 'listing.updateMany', args: expect.objectContaining({ where: { id: 'L1', status: { not: 'removed' } } }) }])
    expect(h.row!.status).toBe('hidden')
  })

  it('a row that vanished between read and write is the same 404 (no P2025 → 500)', async () => {
    h.read = listing('hidden')
    h.row = null
    expect(await setStatusCore('L1', 'active')).toEqual(NOT_FOUND)
  })
})

describe('confirmCore — "still available" cannot revive a listing removed after the read', () => {
  it.each(['active', 'hidden', 'sold'])('read %s, removed before the write: 404 and the tombstone stays', async (from) => {
    removedMidway(from)
    expect(await confirmCore('L1', 'p1')).toEqual(NOT_FOUND)
    expect(h.row!.status).toBe('removed')
    expect(h.purged).toEqual([])
    expect(h.afters).toBe(0) // not even the engagement reward
  })

  it('the ordinary confirm writes through the guarded where — not removed, AND still the status it read', async () => {
    h.read = listing('active')
    h.row = listing('active')
    expect(await confirmCore('L1', 'p1')).toEqual({ ok: true, bumped: false })
    expect(h.writes[0].args.where).toEqual({ id: 'L1', status: { not: 'removed', equals: 'active' } })
  })

  it('read active, SOLD before the write (a mark-sold in another tab): 404, and the sale is not silently revived', async () => {
    h.read = listing('active')
    h.row = { ...listing('active'), status: 'sold' }
    expect(await confirmCore('L1', 'p1')).toEqual(NOT_FOUND)
    expect(h.row!.status).toBe('sold')
  })
})

describe('updateListingCore — an edit cannot land on a listing removed after the read', () => {
  it('plain edit, removed in between: 404, the tombstone keeps its content and status', async () => {
    removedMidway('active')
    expect(await updateListingCore('L1', { title: 'A red bicycle' })).toEqual(NOT_FOUND)
    expect(h.row).toMatchObject({ status: 'removed', title: 'A bicycle' })
    expect(h.purged).toEqual([])
    expect(h.afters).toBe(0)
  })

  it('price edit (the PriceChange transaction), removed in between: 404, the transaction is refused', async () => {
    removedMidway('active')
    h.priceAudit = { listingId: 'L1', oldPrice: 1_000_000, newPrice: 900_000 }
    expect(await updateListingCore('L1', { price: 900_000 })).toEqual(NOT_FOUND)
    expect(h.txCalls).toBe(1) // it went down the transaction branch, and that branch is guarded too
    expect(h.row).toMatchObject({ status: 'removed', price: 1_000_000 })
    expect(h.purged).toEqual([])
  })

  it('both branches write through the guarded where', async () => {
    h.read = listing('active')
    h.row = listing('active')
    expect(await updateListingCore('L1', { title: 'A red bicycle' })).toEqual({ ok: true })
    h.priceAudit = { listingId: 'L1', oldPrice: 1_000_000, newPrice: 900_000 }
    expect(await updateListingCore('L1', { price: 900_000 })).toEqual({ ok: true })
    const updates = h.writes.filter((w) => w.m === 'listing.update')
    expect(updates).toHaveLength(2)
    for (const u of updates) expect(u.args.where).toEqual({ id: 'L1', status: { not: 'removed' } })
  })

  it('a non-P2025 failure is not swallowed as a 404', async () => {
    h.read = listing('active')
    h.row = listing('active')
    const { db } = await import('@/lib/db')
    const real = db.listing.update
    ;(db.listing as Row).update = async () => { throw Object.assign(new Error('connection reset'), { code: 'P1017' }) }
    try {
      await expect(updateListingCore('L1', { title: 'A red bicycle' })).rejects.toThrow('connection reset')
    } finally {
      ;(db.listing as Row).update = real
    }
  })
})
