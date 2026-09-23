import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── The seller identity gate on the SELLER-INITIATED cores: create, bulk, sync, relist, confirm ─────
//
// These paths REFUSE (the seller is right there and can go and verify); the admin/system paths HOLD
// and are covered in compliance/seller-publish-gate.test.ts. Two properties matter and both are
// pinned per path:
//   1. gate ON + refused owner → nothing moves into public state, and the refusal carries the code;
//   2. gate OFF → the write is byte-for-byte what it was before the gate existed, with no extra read.
// The decision itself is faked here (its rules have their own tests); what is under test is WHERE
// each core asks, what it does with a refusal, and that it asks only on a transition INTO active.

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  enforced: false,
  decision: { ok: true } as { ok: true } | { ok: false; code: string },
  decisionCalls: [] as Array<Record<string, unknown>>,
  /** What createListingCore handed assertSellerMayPublish. */
  assertCalls: [] as Array<Record<string, unknown>>,
  /** db.listing.findUnique result (setStatusCore's gate read, confirmCore's current row). */
  current: null as Row | null,
  existing: [] as Row[],
  updates: [] as Row[],
  creates: 0,
  reads: [] as string[],
}))

vi.mock('@/lib/compliance/account-state', async (orig) => ({
  ...(await orig<typeof import('@/lib/compliance/account-state')>()),
  identityGateEnforced: () => h.enforced,
}))
vi.mock('@/lib/compliance/seller-publish-gate', async () => {
  // The REAL pure rules for the ownerless branch, so the create tests below show what a guest flag
  // actually decides rather than only that it was passed.
  const { decideBeforeStatus } = await vi.importActual<typeof import('@/lib/compliance/seller-publish-decision')>('@/lib/compliance/seller-publish-decision')
  const { PublishBlockedError } = await vi.importActual<typeof import('@/lib/publish-guard')>('@/lib/publish-guard')
  return {
    // Mirrors the real helper's first line: gate off → allowed, whatever the owner.
    sellerPublishDecision: async (input: Record<string, unknown>) => {
      h.decisionCalls.push(input)
      return h.enforced ? h.decision : { ok: true }
    },
    // createListingCore's gate. A refusal throws exactly as the real one does; a pass throws a marker
    // so the test stops here instead of mocking the whole create behind it.
    assertSellerMayPublish: async (input: { ownerId: string | null; guestCreate?: boolean }) => {
      h.assertCalls.push(input)
      const d = input.ownerId ? (h.enforced ? h.decision : { ok: true as const }) : decideBeforeStatus({ enforced: h.enforced, ownerId: null, guestCreate: input.guestCreate, now: new Date() })
      if (d && !d.ok) throw new PublishBlockedError(d.code as never)
      throw new Error('PASSED_IDENTITY_GATE')
    },
  }
})
vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: () => {} }))
vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      findUnique: async () => { h.reads.push('listing.findUnique'); return h.current },
      findMany: async () => { h.reads.push('listing.findMany'); return h.existing },
      update: async (a: Row) => { h.updates.push(a); return { id: a.where.id } },
      updateMany: async (a: Row) => { h.updates.push(a); return { count: 0 } },
      create: async () => { h.creates++; return { id: 'new' } },
      count: async () => 0,
    },
    category: { findMany: async () => { h.reads.push('category.findMany'); return [] } },
    $transaction: async (ops: unknown[]) => ops,
  },
}))
vi.mock('@/lib/enforcement', () => ({ bulkPostingBudget: async () => ({ blocked: null, maxNewActive: null }) }))
vi.mock('@/lib/listing-index', () => ({ reindexListing: async () => {}, removeFromIndex: async () => {} }))
vi.mock('@/lib/trust', () => ({ recordEngagement: async () => {} }))
vi.mock('@/lib/stale', () => ({ canBump: () => false }))
vi.mock('@/lib/translate', () => ({ warmTranslations: async () => {} }))
vi.mock('@/lib/listing-image', () => ({ isListingImageUrl: () => true, isListingVideoUrl: () => true }))
vi.mock('@/lib/ssrf', () => ({ safeFetch: async () => { throw new Error('no network in tests') } }))
vi.mock('@/lib/core/media', () => ({ isCanonicalVideoUrl: () => true, removeListingVideoByUrl: async () => {}, storeListingImage: async () => null, IMG_MAX_BYTES: 1 }))
vi.mock('@/lib/brand', () => ({ categoryHasBrand: () => false, resolveBrand: async () => null, bumpBrandCount: async () => {}, enrichBrandLogoIfMissing: async () => {} }))
vi.mock('@/lib/syndicate', () => ({ syndicateListing: async () => {} }))
vi.mock('@/lib/meta-capi', () => ({ sendMetaCapiEvent: async () => {}, metaUserDataFromHeaders: () => ({}) }))
vi.mock('@/lib/webhooks', () => ({ dispatchListingEvent: async () => {}, dispatchListingEventsBatch: async () => {} }))
vi.mock('@/lib/ranking', () => ({ browseRankScore: () => 0, recomputeRankScoreForListing: async () => {} }))
vi.mock('@/lib/duplicate-guard', () => ({ findDuplicateListing: async () => null }))
vi.mock('@/lib/ai-moderation', () => ({ moderateListingById: async () => {} }))
vi.mock('@/lib/image-provenance', () => ({ indexAndCheckProvenance: async () => {} }))
vi.mock('@/lib/price-drop', () => ({ priceChangeEffects: async () => ({ data: {}, audit: null, notify: null }) }))
vi.mock('@/lib/urgent', () => ({ activateUrgentGate: async () => ({ ok: true }), urgentQuotaFree: () => true, URGENT: {} }))

const { setStatusCore, confirmCore, createListingCore } = await import('@/lib/core/listings')
const { bulkImportCore } = await import('@/lib/core/bulk')
const { syncListingsCore } = await import('@/lib/core/sync')

const SELLER = { id: 's1', ownerId: 'owner-1', trustTier: 'standard', trustScore: 100 }
const REFUSED = { ok: false as const, code: 'identity_unverified' }

beforeEach(() => {
  h.enforced = false
  h.decision = { ok: true }
  h.decisionCalls = []
  h.assertCalls = []
  h.current = null
  h.existing = []
  h.updates = []
  h.creates = 0
  h.reads = []
})

describe('createListingCore — a GUEST is a signed-out web post, not an ownerless row', () => {
  const OWNERLESS = { id: 's0', ownerId: null, trustTier: 'standard', trustScore: 100, phone: null }
  const create = (seller: Parameters<typeof createListingCore>[0]['seller'], guestCreate: boolean) => createListingCore({
    seller, guestCreate, title: 'A thing', price: 100_000, body: {}, headers: new Headers(),
    category: { id: 'c1', slug: 'phones', name: 'Phones', nameVi: 'Điện thoại' },
  })

  it('⛔ gate on: an ownerless shop reached by API key (v1 / MCP pass false) is a platform import — NOT refused', async () => {
    h.enforced = true
    await expect(create(OWNERLESS, false)).rejects.toThrow('PASSED_IDENTITY_GATE')
    expect(h.assertCalls).toEqual([{ ownerId: null, guestCreate: false }])
  })

  it('gate on: the signed-out web post (the session route passes true) is refused with the guest code', async () => {
    h.enforced = true
    await expect(create(OWNERLESS, true)).rejects.toMatchObject({ code: 'identity_sign_in_required' })
  })

  it('gate on: an owned shop is decided on its OWNER, whatever the flag says', async () => {
    h.enforced = true
    h.decision = REFUSED
    await expect(create({ ...SELLER, phone: null }, false)).rejects.toMatchObject({ code: 'identity_unverified' })
    expect(h.assertCalls).toEqual([{ ownerId: 'owner-1', guestCreate: false }])
  })

  it('⛔ gate off: a guest passes, exactly as before the gate', async () => {
    await expect(create(OWNERLESS, true)).rejects.toThrow('PASSED_IDENTITY_GATE')
  })
})

describe('bulkImportCore — the WHOLE batch is refused before any row runs', () => {
  it('gate on + refused owner → blocked with the code, every row failed, nothing read or created', async () => {
    h.enforced = true
    h.decision = REFUSED
    const rows = [{ title: 'a', category_slug: 'phones' }, { title: 'b', category_slug: 'phones' }]
    const r = await bulkImportCore(SELLER, rows)
    expect(r).toEqual({
      created: 0, failed: 2, imageBudgetReached: false, blocked: 'identity_unverified',
      results: [{ row: 1, error: 'identity_unverified' }, { row: 2, error: 'identity_unverified' }],
    })
    expect(h.creates).toBe(0)
    // Refused BEFORE category resolution — no row was looked at, no image fetched.
    expect(h.reads).toEqual([])
    // ONE decision for the batch, for the shop's owner, and not as a guest.
    expect(h.decisionCalls).toEqual([{ ownerId: 'owner-1' }])
  })

  it('⛔ each refused row carries its external_id (normalised as a created row\'s is), so a partner can correlate', async () => {
    h.enforced = true
    h.decision = REFUSED
    const r = await bulkImportCore(SELLER, [{ title: 'a', external_id: ' SKU-1 ' }, { title: 'b' }, { title: 'c', external_id: 'SKU-3' }])
    expect(r.results).toEqual([
      { row: 1, external_id: 'SKU-1', error: 'identity_unverified' },
      { row: 2, error: 'identity_unverified' },
      { row: 3, external_id: 'SKU-3', error: 'identity_unverified' },
    ])
  })

  it('a decision passed in by the caller (the sync) is used as-is — no second resolution', async () => {
    h.enforced = true
    const r = await bulkImportCore(SELLER, [{ title: 'a' }], { publishDecision: REFUSED as never })
    expect(r.blocked).toBe('identity_unverified')
    expect(h.decisionCalls).toEqual([])
  })

  it('gate off → never blocked; the batch proceeds into the per-row loop as before', async () => {
    const r = await bulkImportCore(SELLER, [{ title: 'a', category_slug: 'nope' }])
    expect(r.blocked).toBeUndefined()
    expect(h.reads).toContain('category.findMany')
  })
})

describe('setStatusCore — relisting is refused, never held', () => {
  it('gate on + refused owner + hidden → active: 403 with the code and NO write', async () => {
    h.enforced = true
    h.decision = REFUSED
    h.current = { status: 'hidden', seller: { ownerId: 'owner-1' } }
    expect(await setStatusCore('l1', 'active')).toEqual({ ok: false, code: 403, error: 'identity_unverified' })
    expect(h.updates).toEqual([])
  })

  it('gate on + refused owner: a listing ALREADY active is not a transition and is not refused', async () => {
    h.enforced = true
    h.decision = REFUSED
    h.current = { status: 'active', seller: { ownerId: 'owner-1' } }
    expect(await setStatusCore('l1', 'active')).toEqual({ ok: true, status: 'active' })
    expect(h.decisionCalls).toEqual([])
  })

  it('gate on + refused owner: sold and hidden are never gated (taking a listing DOWN is always allowed)', async () => {
    h.enforced = true
    h.decision = REFUSED
    expect(await setStatusCore('l1', 'sold')).toEqual({ ok: true, status: 'sold' })
    expect(await setStatusCore('l1', 'hidden')).toEqual({ ok: true, status: 'hidden' })
    expect(h.reads).toEqual([])
  })

  it('⛔ gate off: relisting writes exactly what it always wrote, with no extra read', async () => {
    h.current = { status: 'sold', seller: { ownerId: 'owner-1' } }
    expect(await setStatusCore('l1', 'active')).toEqual({ ok: true, status: 'active' })
    expect(h.reads).toEqual([])
    expect(h.decisionCalls).toEqual([])
    expect(h.updates).toHaveLength(1)
    expect(h.updates[0].where).toEqual({ id: 'l1' })
    expect(h.updates[0].data).toMatchObject({ status: 'active', marketPosition: null, soldAt: null, soldChannel: null, soldToProfileId: null, soldPlatform: null })
  })
})

describe('confirmCore — gated ONLY when "still available" would REVIVE a sold/hidden listing', () => {
  const live = { postedAt: new Date(), status: 'active', sellerTrustScore: 100, featured: false, views: 0, contactCount: 0 }

  it('gate on + refused owner + a sold listing → 403 with the code and NO write', async () => {
    h.enforced = true
    h.decision = REFUSED
    // findUnique serves both confirmCore's own read and the gate's owner lookup.
    h.current = { ...live, status: 'sold', seller: { ownerId: 'owner-1' } }
    expect(await confirmCore('l1', 'owner-1')).toEqual({ ok: false, code: 403, error: 'identity_unverified' })
    expect(h.updates).toEqual([])
    // The decision is the STOREFRONT owner's, read from the listing, not the caller's profile id.
    expect(h.decisionCalls).toEqual([{ ownerId: 'owner-1' }])
  })

  it('gate on + refused owner: the ordinary confirm on a LIVE listing is untouched', async () => {
    h.enforced = true
    h.decision = REFUSED
    h.current = live
    expect(await confirmCore('l1', 'owner-1')).toEqual({ ok: true, bumped: false })
    expect(h.decisionCalls).toEqual([])
    expect(h.updates[0].data).toMatchObject({ status: 'active' })
  })

  it('⛔ gate off: the revive goes through exactly as before — the lifecycle is unchanged', async () => {
    h.current = { ...live, status: 'hidden' }
    expect(await confirmCore('l1', 'owner-1')).toEqual({ ok: true, bumped: false })
    expect(h.reads).toEqual(['listing.findUnique']) // confirmCore's own read, nothing more
    expect(h.updates).toHaveLength(1)
    expect(h.updates[0].data).toMatchObject({ status: 'active', soldAt: null, soldChannel: null, soldToProfileId: null, soldPlatform: null, marketPosition: null })
  })
})

describe('syncListingsCore — creates and revives refused, the rest of the sync still applies', () => {
  it('gate on + refused owner: create refused, revive refused BEFORE any write, a live row still updates', async () => {
    h.enforced = true
    h.decision = REFUSED
    h.existing = [
      { id: 'L-sold', externalId: 'sold-1', status: 'sold' },
      { id: 'L-live', externalId: 'live-1', status: 'active' },
    ]
    h.current = { status: 'active', seller: { ownerId: 'owner-1' } }
    const out = await syncListingsCore(SELLER, [
      { externalId: 'new-1', title: 'New thing', categorySlug: 'phones' },
      { externalId: 'sold-1', status: 'active', title: 'Back in stock' },
      { externalId: 'live-1', status: 'active' },
    ], 'partial')
    expect(out.blocked).toBe('identity_unverified')
    expect(out.created).toBe(0)
    expect(out.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ external_id: 'new-1', action: 'failed', error: 'identity_unverified' }),
      { external_id: 'sold-1', id: 'L-sold', action: 'failed', error: 'identity_unverified' },
      { external_id: 'live-1', id: 'L-live', action: 'updated' },
    ]))
    // ⚠️ The refused revive wrote NOTHING — not even its title edit.
    expect(h.updates.filter((u) => u.where?.id === 'L-sold')).toEqual([])
    // One decision for the whole call.
    expect(h.decisionCalls).toHaveLength(1)
  })

  it('gate off: no `blocked`, and a revive goes through', async () => {
    h.existing = [{ id: 'L-sold', externalId: 'sold-1', status: 'sold' }]
    const out = await syncListingsCore(SELLER, [{ externalId: 'sold-1', status: 'active' }], 'partial')
    expect(out.blocked).toBeUndefined()
    expect(out.results).toEqual([{ external_id: 'sold-1', id: 'L-sold', action: 'updated' }])
    expect(h.updates.some((u) => u.where?.id === 'L-sold' && u.data?.status === 'active')).toBe(true)
  })
})
