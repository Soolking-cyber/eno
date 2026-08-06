import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * EDITING A LISTING MUST NEVER PUT IT BACK ON SALE.
 *
 * ⚠️ THIS FILE EXISTS BECAUSE MODERATION WAS ADVISORY. `updateListingCore` used to flip `verified`
 * back to true when a seller edited a held listing, guarded by `seller.trustTier !== 'restricted'`.
 * The suspension ladder does not write `trustTier` — it writes `Profile.enforcementState` — and
 * measured on production 2026-07-27 every seller was `standard` with NONE `restricted`, so the
 * guard was vacuously true for the whole platform. Any admin takedown could be undone by opening
 * the edit screen and saving.
 *
 * ⚠️ AND UNTIL 2026-08-05 THIS FILE COULD NOT HAVE CAUGHT THAT COMING BACK. Every assertion ran
 * against a `editMayChangeVerified()` helper DECLARED IN THIS FILE that did `return false`, so all
 * nine cases reduced to `expect(false).toBe(false)`. It never imported `updateListingCore`.
 * Reintroducing the republish branch would have left the suite green — the file read as coverage of
 * the platform's most sensitive write while asserting nothing about it. A test that cannot fail is
 * worse than an absent one, because it stops anybody writing the real one.
 *
 * The real rule, stated as this file now enforces it: `updateListingCore` builds an update payload
 * and `verified` IS NEVER A KEY IN IT — whatever the seller sends, whatever tier they are, whatever
 * pulled the listing down. The assertions below call the actual function with a real (faked) db and
 * inspect the payload it hands to `db.listing.update`.
 *
 * ⚠️ THE FIX WAS TO DELETE THE BRANCH, NOT TO GUARD IT BETTER, and the reason is a fact about the
 * data rather than a preference: the branch existed for listings "created below the photo bar", and
 * NO create path produces those any more. `createListingCore` and `bulk.ts:168` both insert
 * `verified: true`, `sync` never writes the column, and a publish violation THROWS
 * PublishBlockedError instead of saving a held row. So every `verified === false` in the database
 * arrived through one of the takedown paths enumerated below. There is no benign case left to serve.
 *
 * Two better-looking fixes were rejected with evidence first, and are recorded so they are not
 * re-proposed:
 *   · a `heldReason` column — fails closed only if all takedown paths are updated AND legacy NULLs
 *     are read as admin holds; done naively it grandfathers in every existing takedown (agy).
 *   · inferring the photo-hold from "the listing had zero photos" — refuted by measurement: the
 *     last held listing in production carried 1 image while its category required 3.
 */

/** Every write that can set `verified: false`. All are takedowns; none is a seller action. */
const TAKEDOWN_PATHS = [
  'api/admin/listings/route.ts:87 — admin bulk unverify',
  'api/admin/moderate/route.ts:133 — report confirmed',
  'api/admin/moderate/route.ts:168 — bare unpublish',
  'api/admin/moderate/route.ts:205 — report resolved against the listing',
  'lib/image-provenance.ts:85 — duplicate / stolen-photo auto-hold',
  'lib/ai-moderation.ts:156 — illegal-content auto-hold',
  'lib/enforcement.ts:283 — the ladder pulling a seller’s catalogue',
] as const

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  /** Every payload handed to `db.listing.update`, in order. The subject of every assertion here. */
  updates: [] as Row[],
  current: {} as Row,
  /** Non-null `audit` sends the write down the `$transaction` branch instead of the plain update. */
  priceAudit: null as Row | null,
  txCalls: 0,
}))

// ── The dependency wall ────────────────────────────────────────────────────────────────────────
// `core/listings.ts` imports 38 modules, most of which reach the DB, the search index, Gemini, or
// the network. They are stubbed rather than exercised because this file asserts ONE property of the
// update payload; a test that needed all of them working would not get written, which is how the
// tautology it replaces came to exist.
vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      findUnique: async () => h.current,
      update: async ({ data }: Row) => { h.updates.push(data); return { id: 'listing-1' } },
      count: async () => 0,
    },
    priceChange: { create: () => ({}) },
    // ⚠️ THE ARRAY FORM, MATCHING THE SOURCE. `core/listings.ts:513` calls
    // `db.$transaction([...])` — the array form, where the operations are already-built promises.
    // A reviewer of this file raised the interactive form (`$transaction(async tx => …)`), where a
    // mock like this would never invoke the callback and the payload would never be produced; that
    // would be a real defect in the mock, so it was checked against the source rather than assumed.
    // It is the array form, so the operations run before `$transaction` is ever called.
    $transaction: async (ops: unknown[]) => { h.txCalls++; return ops },
  },
}))
vi.mock('@/lib/listing-index', () => ({ reindexListing: async () => {}, removeFromIndex: async () => {} }))
vi.mock('@/lib/trust', () => ({ recordEngagement: async () => {} }))
vi.mock('@/lib/stale', () => ({ canBump: () => false }))
vi.mock('@/lib/translate', () => ({ warmTranslations: async () => {} }))
vi.mock('@/lib/listing-image', () => ({ isListingImageUrl: () => true }))
vi.mock('@/lib/core/media', () => ({ isCanonicalVideoUrl: () => true, removeListingVideoByUrl: async () => {} }))
vi.mock('@/lib/brand', () => ({
  categoryHasBrand: () => false,
  resolveBrand: async () => null,
  bumpBrandCount: async () => {},
  enrichBrandLogoIfMissing: async () => {},
}))
vi.mock('@/lib/syndicate', () => ({ syndicateListing: async () => {} }))
vi.mock('@/lib/meta-capi', () => ({ sendMetaCapiEvent: async () => {}, metaUserDataFromHeaders: () => ({}) }))
vi.mock('@/lib/webhooks', () => ({ dispatchListingEvent: async () => {} }))
vi.mock('@/lib/ranking', () => ({ browseRankScore: () => 0, recomputeRankScoreForListing: async () => {} }))
vi.mock('@/lib/compliance/account-state', () => ({ identityGateEnforced: () => false }))
vi.mock('@/lib/publish-guard', () => ({
  assertPublishable: async () => {},
  assertCleanTexts: async () => {},
  assertCleanContactName: async () => {},
  assertEnoughAngles: async () => {},
  PublishBlockedError: class PublishBlockedError extends Error {},
}))
vi.mock('@/lib/duplicate-guard', () => ({ findDuplicateListing: async () => null }))
vi.mock('@/lib/ai-moderation', () => ({ moderateListingById: async () => {} }))
vi.mock('@/lib/image-provenance', () => ({ indexAndCheckProvenance: async () => {} }))
vi.mock('@/lib/price-drop', () => ({
  priceChangeEffects: async () => ({ data: {}, audit: h.priceAudit, notify: null }),
}))
vi.mock('@/lib/urgent', () => ({ activateUrgentGate: async () => ({ ok: true }), urgentQuotaFree: () => true, URGENT: {} }))

const { updateListingCore } = await import('@/lib/core/listings')

/** A listing that a takedown has already pulled down. `verified: false` is the whole setup. */
function heldListing(overrides: Row = {}): Row {
  return {
    title: 'Old title',
    description: 'Old description',
    district: 'District 1',
    location: 'District 1',
    brandSlug: null,
    model: null,
    subcategorySlug: null,
    verified: false, // ← pulled down by one of TAKEDOWN_PATHS
    images: ['https://example.test/a.jpg'],
    video: null,
    price: 1_000_000,
    createdAt: new Date('2026-01-01'),
    sellerId: 'seller-1',
    previousPrice: null,
    priceDropAt: null,
    lowestNotifiedPrice: null,
    priceDropNotifiedAt: null,
    urgentUntil: null,
    seller: { trustTier: 'standard' }, // the tier the dead guard waved through
    category: { slug: 'vehicles', name: 'Vehicles', nameVi: 'Xe cộ' },
    ...overrides,
  }
}

beforeEach(() => {
  h.updates = []
  h.current = heldListing()
  h.priceAudit = null
  h.txCalls = 0
})

describe('an edit cannot republish a listing, whatever put it down', () => {
  it.each(TAKEDOWN_PATHS)('stays down after an edit — %s', async () => {
    const res = await updateListingCore('listing-1', { title: 'An edited title' })

    expect(res).toEqual({ ok: true })
    expect(h.updates).toHaveLength(1)
    // The assertion that matters: `verified` is not a key in the payload at all. Not
    // `verified: false` — ABSENT, because the edit path has no business expressing an opinion
    // about published state. `toHaveProperty` would pass on an explicit false; `in` would not.
    expect('verified' in h.updates[0]).toBe(false)
  })

  it('THE REGRESSION: a standard/good-standing seller no longer gets a free republish', async () => {
    // The exact production shape the old guard waved through: trustTier 'standard' (nobody is
    // 'restricted'), so `trustTier !== 'restricted'` was true and the listing went live again.
    const oldGuardWouldRepublish = (trustTier: string) => trustTier !== 'restricted'
    expect(oldGuardWouldRepublish('standard')).toBe(true) // ← what production did

    h.current = heldListing({ seller: { trustTier: 'standard' } })
    await updateListingCore('listing-1', { title: 'An edited title' })
    expect('verified' in h.updates[0]).toBe(false) // ← what it does now, asserted on the real payload
  })

  it('a seller cannot republish by SENDING verified:true either', async () => {
    // The edit body is attacker-controlled — it is whatever the client POSTed. `updateListingCore`
    // builds `data` key by key from an allow-list, so an injected `verified` is simply never read.
    // This is the case the old file could not have tested at all, having no payload to inspect.
    await updateListingCore('listing-1', { title: 'An edited title', verified: true })
    expect('verified' in h.updates[0]).toBe(false)
  })

  it('...and on the PRICE-CHANGE path too, which writes through a different branch', async () => {
    // ⚠️ THERE ARE TWO WRITES, NOT ONE, AND ONLY ONE WAS COVERED. `core/listings.ts:512-519`
    // commits through `db.$transaction([priceChange.create, listing.update])` when the edit moved
    // the price, and a plain `listing.update` otherwise. The payload is built once above both, so
    // today they cannot disagree — but "the tests only ever exercised the else branch" is exactly
    // how a future edit adds a `verified` to one of them unnoticed. A reviewer of the first version
    // of this file raised the single-payload blind spot; this closes it.
    h.priceAudit = { listingId: 'listing-1', oldPrice: 1_000_000, newPrice: 900_000 }
    await updateListingCore('listing-1', { price: 900_000 })

    expect(h.txCalls).toBe(1) // proves we actually went down the transaction branch
    expect(h.updates).toHaveLength(1)
    expect('verified' in h.updates[0]).toBe(false)
    expect(h.updates[0].price).toBe(900_000) // and the branch did its real job
  })

  it('the edit still does its actual job, or the test above would pass vacuously', async () => {
    // ⚠️ THE GUARD ON THIS FILE'S OWN GUARD. "No `verified` key" is trivially true of an update
    // that never happened, which is precisely the failure mode that made the previous version of
    // this file worthless. Pin that the edit really wrote the field the caller asked for.
    await updateListingCore('listing-1', { title: 'An edited title' })
    expect(h.updates[0].title).toBe('An edited title')
  })

  it('there are SEVEN takedown paths and they all write the same bare boolean', () => {
    // Pinned as a count: an eighth path added later without a matching thought about republishing
    // should break this test and force the author to read the note above. (The prose here said
    // "SIX" while the list held seven and the assertion said seven — corrected 2026-08-05.)
    expect(TAKEDOWN_PATHS).toHaveLength(7)
  })
})

describe('the escape hatch is a human, deliberately', () => {
  it('restoring a pulled listing requires the admin verify action, not a seller edit', async () => {
    // api/admin/listings/route.ts:86 — `case 'verify'`. Asserted here as the negative half: the
    // seller path cannot do it. "We removed auto-republish" is only safe because that way back
    // exists, and it takes an operator.
    await updateListingCore('listing-1', { title: 'Still down' })
    expect('verified' in h.updates[0]).toBe(false)
  })
})
