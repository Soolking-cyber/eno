import { describe, expect, it, vi, beforeEach } from 'vitest'

// Tests for who ESCAPES the new-account listing cap (owner, 2026-08-11).
//
// ⚠️ THE POINT OF THESE IS THE *NEGATIVE* CASE. Confirming a partner is exempt is the easy
// half and would pass on almost any implementation. What actually matters is that a
// SELF-DECLARED business is NOT exempt: `Profile.accountType === 'business'` is a free choice
// in a signup dropdown that nobody checks, so exempting it would not narrow the probation cap,
// it would delete it — every spammer ticks the box and posts without limit on day one. If a
// future change makes that test go green, the cap has quietly stopped existing.

const findUniqueSeller = vi.fn()
const findUniqueProfile = vi.fn()
const listingCount = vi.fn()
const findManyListing = vi.fn()
const findManyMessage = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('./db', () => ({
  db: {
    seller: { findUnique: (...a: unknown[]) => findUniqueSeller(...a) },
    profile: { findUnique: (...a: unknown[]) => findUniqueProfile(...a) },
    listing: { count: (...a: unknown[]) => listingCount(...a), findMany: (...a: unknown[]) => findManyListing(...a) },
    message: { findMany: (...a: unknown[]) => findManyMessage(...a) },
    notification: { create: vi.fn() },
  },
}))
vi.mock('./push', () => ({ sendPushToProfile: vi.fn() }))
vi.mock('next/server', () => ({ after: (fn: () => void) => fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { postingGate, bulkPostingBudget } = await import('./enforcement')

const { sellerIdentityHash } = await import('./business-verification')

/**
 * A seller row that IS genuinely business-verified, unless an override breaks exactly one
 * precondition.
 *
 * ⚠️ THE DEFAULT MUST BE VALID, INCLUDING A REAL COMPUTED HASH. The first version defaulted
 * `verifiedIdentityHash` to null, which made isBusinessVerified fail on its FIRST check — so
 * the "expired verification" case never reached the expiry check at all and passed for the
 * wrong reason. A reviewer caught it: a negative test that fails early is indistinguishable
 * from one that works, and it would have gone on passing if expiry stopped being enforced.
 * With a valid baseline, each override isolates the one precondition it names.
 */
const verifiedBusiness = (over: Record<string, unknown> = {}) => {
  const identity = { name: 'Acme Co', legalName: 'Acme Co', legalAddress: 'HCMC', idNumber: null, taxCode: '0101234567' }
  return {
    officialPartner: false,
    ...identity,
    taxCheckedAt: new Date(), taxRegisteredName: 'Acme Co', taxActive: true,
    verifiedIdentityHash: sellerIdentityHash(identity),
    verifiedUntil: new Date(Date.now() + 86_400_000),
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // A brand-new account, already at the cap, with no transactions → squarely on probation.
  findUniqueProfile.mockResolvedValue({ createdAt: new Date(), enforcementState: null })
  listingCount.mockResolvedValue(999)
  findManyListing.mockResolvedValue([])
  findManyMessage.mockResolvedValue([])
})

describe('new-account listing cap — who is exempt', () => {
  it('BLOCKS an ordinary brand-new seller at the cap', async () => {
    findUniqueSeller.mockResolvedValue(verifiedBusiness({ verifiedIdentityHash: null, taxActive: false }))
    const r = await postingGate('p1', 's1')
    expect(r).toMatchObject({ error: 'probation_listing_cap' })
  })

  it('EXEMPTS an official partner', async () => {
    findUniqueSeller.mockResolvedValue(verifiedBusiness({ officialPartner: true, taxActive: false }))
    expect(await postingGate('p1', 's1')).toBeNull()
  })

  it('EXEMPTS a genuinely verified business', async () => {
    // The factory's hash is COMPUTED from the same identity fields isBusinessVerified re-hashes,
    // so this proves the real predicate rather than a stubbed boolean.
    findUniqueSeller.mockResolvedValue(verifiedBusiness())
    expect(await postingGate('p1', 's1')).toBeNull()
  })

  it('does NOT exempt a self-declared business — the cap would otherwise be deleted', async () => {
    // ⚠️ The mocked PROFILE claims accountType 'business' — the state a spammer can self-select
    // — while the seller has no stamped verification. A reviewer noted the first version never
    // constructed that state at all, so an implementation that wrongly trusted accountType
    // would have passed. The route must still cap it.
    findUniqueProfile.mockResolvedValue({ createdAt: new Date(), enforcementState: null, accountType: 'business' })
    findUniqueSeller.mockResolvedValue(verifiedBusiness({ officialPartner: false, verifiedIdentityHash: null }))
    expect(await postingGate('p1', 's1')).toMatchObject({ error: 'probation_listing_cap' })
  })

  it('does NOT exempt a business whose verification has EXPIRED', async () => {
    findUniqueSeller.mockResolvedValue(verifiedBusiness({ verifiedUntil: new Date(Date.now() - 1000) }))
    expect(await postingGate('p1', 's1')).toMatchObject({ error: 'probation_listing_cap' })
  })

  it('does NOT exempt a seller that cannot be found', async () => {
    findUniqueSeller.mockResolvedValue(null)
    expect(await postingGate('p1', 's1')).toMatchObject({ error: 'probation_listing_cap' })
  })

  it('applies the SAME exemption to the bulk budget, not just the single-post gate', async () => {
    // ⚠️ The two gates drifting is the failure this covers: exempt at postingGate but capped
    // here means the wizard says yes and the bulk core silently truncates.
    findUniqueSeller.mockResolvedValue(verifiedBusiness({ officialPartner: true }))
    expect(await bulkPostingBudget('p1', 's1')).toEqual({ blocked: null, maxNewActive: null })

    findUniqueSeller.mockResolvedValue(verifiedBusiness({ officialPartner: false, verifiedIdentityHash: null }))
    const capped = await bulkPostingBudget('p1', 's1')
    expect(capped.maxNewActive).toBe(0) // at 999 active, no budget left
  })
})
