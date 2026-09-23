import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── POSTING AFTER A SCAM-HOLD RELEASE, on every seller path that makes a listing active ──────────────
//
// Owner decision (2026-09-24): a seller whose ONLY standing scam charges are RELEASED regains posting —
// the restricted trust tier is waived for them — but while any released charge stands the storefront
// may hold at most ENFORCEMENT.SCAM_RELEASED.MAX_ACTIVE_LISTINGS active listings. A HELD charge still
// blocks posting exactly as before. The regime itself (which charges stand, released or held) is
// derived by src/lib/released-charge-gate.ts and proved end-to-end in src/lib/scam-hold.test.ts; here
// it is faked, and what is under test is WHERE each core asks and what it does with the answer.

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  /** The regime the fake gate reports: null = no released charge stands. */
  standing: null as { waivesRestricted: boolean; limit: number } | null,
  /** The storefront's active-listing count the fake gate reports. */
  active: 0,
  gateCalls: [] as Array<{ ownerId: unknown; sellerId?: unknown }>,
  current: null as Row | null,
  /** Rows by id (the sync tests): findUnique reads them, update moves `active` with their status. */
  rows: {} as Record<string, Row>,
  existing: [] as Row[],
  categories: [] as Row[],
  updates: [] as Row[],
  creates: 0,
}))

vi.mock('@/lib/released-charge-gate', () => {
  const gateFor = async (standing: { waivesRestricted: boolean; limit: number }) =>
    ({ ...standing, active: h.active, remaining: Math.max(0, standing.limit - h.active) })
  return {
    releasedChargeStanding: async (ownerId: unknown) => { h.gateCalls.push({ ownerId }); return ownerId ? h.standing : null },
    releasedChargeGateFor: async (standing: { waivesRestricted: boolean; limit: number }) => gateFor(standing),
    releasedChargeGate: async (ownerId: unknown, sellerId: unknown) => {
      h.gateCalls.push({ ownerId, sellerId })
      return ownerId && h.standing ? gateFor(h.standing) : null
    },
  }
})
vi.mock('@/lib/compliance/account-state', async (orig) => ({
  ...(await orig<typeof import('@/lib/compliance/account-state')>()),
  identityGateEnforced: () => false,
}))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({
  sellerPublishDecision: async () => ({ ok: true }),
  assertSellerMayPublish: async () => {},
}))
vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: () => {} }))
vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      findUnique: async (a: Row) => h.rows[a.where.id] ?? h.current,
      findMany: async () => h.existing,
      update: async (a: Row) => {
        h.updates.push(a)
        const r = h.rows[a.where.id]
        if (r && a.data.status && a.data.status !== r.status) {
          if (a.data.status === 'active') h.active++
          else if (r.status === 'active') h.active--
          r.status = a.data.status
        }
        return { id: a.where.id }
      },
      updateMany: async (a: Row) => { h.updates.push(a); return { count: 0 } },
      create: async () => { h.creates++; return { id: `new${h.creates}` } },
      count: async () => 0,
    },
    category: { findMany: async () => h.categories },
    $transaction: async (ops: unknown[]) => ops,
  },
}))
vi.mock('@/lib/enforcement', () => ({ bulkPostingBudget: async () => ({ blocked: null, maxNewActive: null }) }))
vi.mock('@/lib/listing-index', () => ({ reindexListing: async () => {}, removeFromIndex: async () => {} }))
vi.mock('@/lib/trust', () => ({ recordEngagement: async () => {} }))
vi.mock('@/lib/stale', () => ({ canBump: () => false }))
vi.mock('@/lib/translate', () => ({ warmTranslations: async () => {} }))
vi.mock('@/lib/listing-image', () => ({ isListingImageUrl: () => true, isListingVideoUrl: () => false }))
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
const { assertPublishable } = await import('@/lib/publish-guard')
const { ENFORCEMENT } = await import('@/lib/enforcement-machine')

const LIMIT = ENFORCEMENT.SCAM_RELEASED.MAX_ACTIVE_LISTINGS
const RELEASED_ONLY = { waivesRestricted: true, limit: LIMIT }
const RELEASED_AND_HELD = { waivesRestricted: false, limit: LIMIT }
const RESTRICTED = { id: 's1', ownerId: 'owner-1', trustTier: 'restricted', trustScore: 15 }
const STANDARD = { id: 's1', ownerId: 'owner-1', trustTier: 'standard', trustScore: 70 }
const CAP = 'released_charge_listing_cap'

beforeEach(() => {
  h.standing = null
  h.active = 0
  h.gateCalls = []
  h.current = null
  h.rows = {}
  h.existing = []
  h.categories = [{ id: 'c1', slug: 'phones', name: 'Phones', nameVi: 'Điện thoại' }]
  h.updates = []
  h.creates = 0
})

it('the cap is 10 (owner, 2026-09-24)', () => {
  expect(LIMIT).toBe(10)
})

describe('assertPublishable — the waiver and the cap are account refusals, checked before content', () => {
  const base = { images: [] as string[], texts: [] }
  it('restricted, no released charge → account_restricted (unchanged)', () => {
    expect(() => assertPublishable({ ...base, trustTier: 'restricted' })).toThrow('account_restricted')
  })
  it('restricted, only released charges, under the cap → past the account checks (the next refusal is content)', () => {
    expect(() => assertPublishable({ ...base, trustTier: 'restricted', releasedCharge: { waivesRestricted: true, remaining: 3 } })).toThrow('photo_required')
  })
  it('restricted, a HELD charge stands beside the released one → still account_restricted', () => {
    expect(() => assertPublishable({ ...base, trustTier: 'restricted', releasedCharge: { waivesRestricted: false, remaining: 3 } })).toThrow('account_restricted')
  })
  it('at the cap → released_charge_listing_cap, whatever the tier, before any content complaint', () => {
    expect(() => assertPublishable({ ...base, trustTier: 'restricted', releasedCharge: { waivesRestricted: true, remaining: 0 } })).toThrow(CAP)
    expect(() => assertPublishable({ ...base, trustTier: 'standard', releasedCharge: { waivesRestricted: true, remaining: 0 } })).toThrow(CAP)
  })
})

describe('createListingCore (web, /api/v1, MCP create)', () => {
  const create = (seller: typeof RESTRICTED) => createListingCore({
    seller: { ...seller, phone: null }, guestCreate: false, title: 'A thing', price: 100_000, body: {}, headers: new Headers(),
    category: { id: 'c1', slug: 'phones', name: 'Phones', nameVi: 'Điện thoại' },
  })

  it('asks the gate for the storefront OWNER and the storefront', async () => {
    await create(RESTRICTED).catch(() => {})
    expect(h.gateCalls).toEqual([{ ownerId: 'owner-1', sellerId: 's1' }])
  })

  it('restricted with no released charge → account_restricted, as before', async () => {
    await expect(create(RESTRICTED)).rejects.toMatchObject({ code: 'account_restricted' })
  })

  it('⛔ restricted, only RELEASED charges, under the cap → the restricted refusal is waived', async () => {
    h.standing = RELEASED_ONLY
    h.active = LIMIT - 1
    // No photos in this fixture: the refusal it reaches is the first CONTENT check, i.e. it got past
    // the account-level refusals.
    await expect(create(RESTRICTED)).rejects.toMatchObject({ code: 'photo_required' })
  })

  it('restricted, only released charges, AT the cap → released_charge_listing_cap', async () => {
    h.standing = RELEASED_ONLY
    h.active = LIMIT
    await expect(create(RESTRICTED)).rejects.toMatchObject({ code: CAP })
  })

  it('a HELD charge beside the released one keeps the restricted refusal', async () => {
    h.standing = RELEASED_AND_HELD
    h.active = 0
    await expect(create(RESTRICTED)).rejects.toMatchObject({ code: 'account_restricted' })
  })

  it('a standard-tier seller with a released charge is capped too (the cap follows the charge, not the tier)', async () => {
    h.standing = RELEASED_ONLY
    h.active = LIMIT
    await expect(create(STANDARD)).rejects.toMatchObject({ code: CAP })
  })
})

describe('setStatusCore — a relist is one more active listing', () => {
  const row = (status: string, state = 'throttled') => ({ status, sellerId: 's1', seller: { ownerId: 'owner-1', owner: { enforcementState: state } } })

  it('at the cap: sold → active is refused 403, NOTHING written', async () => {
    h.standing = RELEASED_ONLY
    h.active = LIMIT
    h.current = row('sold')
    expect(await setStatusCore('l1', 'active')).toEqual({ ok: false, code: 403, error: CAP })
    expect(h.updates).toEqual([])
    expect(h.gateCalls).toEqual([{ ownerId: 'owner-1', sellerId: 's1' }])
  })

  it('under the cap: the relist goes through', async () => {
    h.standing = RELEASED_ONLY
    h.active = LIMIT - 1
    h.current = row('hidden')
    expect(await setStatusCore('l1', 'active')).toEqual({ ok: true, status: 'active' })
    expect(h.updates[0].data).toMatchObject({ status: 'active' })
  })

  it('no released charge: unchanged', async () => {
    h.active = 500
    h.current = row('sold', 'good_standing')
    expect(await setStatusCore('l1', 'active')).toEqual({ ok: true, status: 'active' })
  })

  it('a row ALREADY active is not a transition: never capped, the gate not even asked', async () => {
    h.standing = RELEASED_ONLY
    h.active = LIMIT + 5
    h.current = row('active')
    expect(await setStatusCore('l1', 'active')).toEqual({ ok: true, status: 'active' })
    expect(h.gateCalls).toEqual([])
  })

  it('taking a listing down is never capped — from active, and between sold and hidden', async () => {
    h.standing = RELEASED_ONLY
    h.active = LIMIT + 5
    h.current = row('active')
    expect(await setStatusCore('l1', 'sold')).toEqual({ ok: true, status: 'sold' })
    expect(await setStatusCore('l1', 'hidden')).toEqual({ ok: true, status: 'hidden' })
    h.current = row('hidden')
    expect(await setStatusCore('l1', 'sold')).toEqual({ ok: true, status: 'sold' })
    expect(h.gateCalls).toEqual([])
  })

  it('a HELD account is refused by the hold first — the cap is not the answer it gets', async () => {
    h.standing = RELEASED_AND_HELD
    h.active = LIMIT
    h.current = row('sold', 'held')
    expect(await setStatusCore('l1', 'active')).toEqual({ ok: false, code: 403, error: 'account_held' })
  })
})

describe('confirmCore — only a confirm that REVIVES is one more active listing', () => {
  const row = (status: string) => ({ postedAt: new Date(), status, sellerTrustScore: 20, featured: false, views: 0, contactCount: 0, sellerId: 's1', seller: { ownerId: 'owner-1', owner: { enforcementState: 'throttled' } } })

  it('at the cap: a revive (sold → active) is refused, nothing written', async () => {
    h.standing = RELEASED_ONLY
    h.active = LIMIT
    h.current = row('sold')
    expect(await confirmCore('l1', 'owner-1')).toEqual({ ok: false, code: 403, error: CAP })
    expect(h.updates).toEqual([])
  })

  it('at the cap: an ordinary confirm on a LIVE listing adds nothing and goes through', async () => {
    h.standing = RELEASED_ONLY
    h.active = LIMIT
    h.current = row('active')
    expect(await confirmCore('l1', 'owner-1')).toEqual({ ok: true, bumped: false })
    expect(h.gateCalls).toEqual([])
  })

  it('under the cap: the revive goes through', async () => {
    h.standing = RELEASED_ONLY
    h.active = LIMIT - 1
    h.current = row('hidden')
    expect(await confirmCore('l1', 'owner-1')).toEqual({ ok: true, bumped: false })
    expect(h.updates[0].data).toMatchObject({ status: 'active' })
  })
})

describe('bulkImportCore (web bulk, /api/v1 bulk, MCP bulk, the sync\'s creates)', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({
    category_slug: 'phones', title: `Phone number ${i + 1}`, price: 100_000,
    image_urls: ['a', 'b', 'c'].map((x) => `https://img.example/${x}${i}.webp`).join('|'),
  }))

  it('restricted with no released charge: every row refused by the trust tier (unchanged)', async () => {
    const r = await bulkImportCore(RESTRICTED, rows(2))
    expect(r.created).toBe(0)
    expect(r.results.every((x) => /Account restricted/.test(x.error ?? ''))).toBe(true)
  })

  it('⛔ only released charges: the tier is waived and creation stops at the remaining allowance', async () => {
    h.standing = RELEASED_ONLY
    h.active = LIMIT - 2
    const r = await bulkImportCore(RESTRICTED, rows(4))
    expect(r.created).toBe(2)
    expect(h.creates).toBe(2)
    expect(r.results.slice(2).map((x) => x.error)).toEqual([CAP, CAP])
  })

  it('a held charge beside the released one: the trust tier still refuses every row', async () => {
    h.standing = RELEASED_AND_HELD
    const r = await bulkImportCore(RESTRICTED, rows(2))
    expect(r.created).toBe(0)
    expect(r.results.every((x) => /Account restricted/.test(x.error ?? ''))).toBe(true)
  })
})

describe('syncListingsCore — a revive past the allowance fails BEFORE any write', () => {
  const owned = (status: string) => ({ status, sellerId: 's1', seller: { ownerId: 'owner-1', owner: { enforcementState: 'throttled' } } })

  it('one slot left: the first revive goes through, the second is refused with its edit unapplied', async () => {
    h.standing = RELEASED_ONLY
    h.active = LIMIT - 1
    h.existing = [
      { id: 'L1', externalId: 'sold-1', status: 'sold' },
      { id: 'L2', externalId: 'sold-2', status: 'sold' },
    ]
    h.rows = { L1: owned('sold'), L2: owned('sold') }
    const out = await syncListingsCore(STANDARD, [
      { externalId: 'sold-1', status: 'active' },
      { externalId: 'sold-2', status: 'active', title: 'Back in stock' },
    ], 'partial')
    expect(out.results).toEqual([
      { external_id: 'sold-1', id: 'L1', action: 'updated' },
      { external_id: 'sold-2', id: 'L2', action: 'failed', error: CAP },
    ])
    expect(h.updates.filter((u) => u.where?.id === 'L2')).toEqual([])
  })

  it('⛔ a slot the SAME sync freed first is usable: take-downs earlier in the payload make room for revives', async () => {
    h.standing = RELEASED_ONLY
    h.active = LIMIT // at the cap when the call starts
    h.existing = [
      { id: 'A1', externalId: 'live-1', status: 'active' },
      { id: 'L1', externalId: 'sold-1', status: 'sold' },
    ]
    h.rows = { A1: owned('active'), L1: owned('sold') }
    const out = await syncListingsCore(STANDARD, [
      { externalId: 'live-1', status: 'sold' },
      { externalId: 'sold-1', status: 'active' },
    ], 'partial')
    expect(out.results).toEqual([
      { external_id: 'live-1', id: 'A1', action: 'updated' },
      { external_id: 'sold-1', id: 'L1', action: 'updated' },
    ])
    expect(h.active).toBe(LIMIT)
  })

  it('no released charge: revives are not budgeted', async () => {
    h.active = 500
    h.existing = [{ id: 'L1', externalId: 'sold-1', status: 'sold' }, { id: 'L2', externalId: 'sold-2', status: 'sold' }]
    h.current = { status: 'sold', sellerId: 's1', seller: { ownerId: 'owner-1', owner: { enforcementState: 'good_standing' } } }
    const out = await syncListingsCore(STANDARD, [{ externalId: 'sold-1', status: 'active' }, { externalId: 'sold-2', status: 'active' }], 'partial')
    expect(out.results.map((x) => x.action)).toEqual(['updated', 'updated'])
  })
})
