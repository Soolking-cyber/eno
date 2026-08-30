import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// One KYC, reused by every feature — so the tests that matter are the ones proving a verification
// stops counting when it should, and that residence is never invented.

const h = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }))

vi.mock('@/lib/db', () => ({
  db: { identityVerification: { findMany: async () => h.rows } },
}))
// react's `cache()` memoises per REQUEST; there is no request here, so make it a pass-through or
// every case in this file would see the first one's answer.
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return { ...actual, cache: (fn: unknown) => fn }
})

const { verifiedIdentityFor, hasVerifiedIdentity, identityCapabilities, hasCapability, partiesFor, railsFor } =
  await import('./identity')

const PROFILE = '11111111-2222-4333-8444-555555555555'
const future = new Date(Date.now() + 365 * 86_400_000)
const past = new Date(Date.now() - 5 * 86_400_000)

let seq = 0
const row = (over: Record<string, unknown> = {}) => ({
  id: `row-${++seq}`,
  tier: 'B',
  method: 'passport_mrz',
  status: 'verified',
  assuranceLevel: 'manual_review',
  fullName: 'ALEX DOE',
  nationality: 'GBR',
  documentType: 'passport',
  residenceCountry: null,
  residenceSource: null,
  documentExpiresAt: future,
  decidedAt: new Date('2026-08-01T00:00:00Z'),
  ...over,
})

/** A party with a verified foreign residence — the only shape the wallet rail can open for. */
const foreignResident = (over: Record<string, unknown> = {}) =>
  row({ residenceCountry: 'GBR', residenceSource: 'provider_kyc', ...over })

beforeEach(() => { seq = 0; h.rows = [row()] })
// ⚠️ IN afterEach, NOT INLINE AT THE END OF EACH TEST. A reviewer pointed out that an inline
// `unstubAllEnvs()` never runs when an assertion above it fails, leaking an open allow-list into
// every test that follows — so one red test would quietly turn several others green.
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

describe('verifiedIdentityFor', () => {
  it('projects a live verification', async () => {
    const id = await verifiedIdentityFor(PROFILE)
    expect(id).toMatchObject({ profileId: PROFILE, tier: 'B', nationality: 'GBR' })
  })

  it('⛔ returns null when there is no history at all', async () => {
    h.rows = []
    expect(await verifiedIdentityFor(PROFILE)).toBeNull()
    expect(await hasVerifiedIdentity(PROFILE)).toBe(false)
  })

  it('⛔ an EXPIRED document is not a verified identity, whatever the row says', async () => {
    // A case can read `verified` while the passport behind it has since expired. Paying out
    // against that has verified nothing.
    h.rows = [row({ documentExpiresAt: past })]
    expect(await verifiedIdentityFor(PROFILE)).toBeNull()
    expect(await hasVerifiedIdentity(PROFILE)).toBe(false)
  })

  it('⛔ a REVOKED row kills the identity even though an older one still says verified', async () => {
    // ⛔ THE DEFECT ALL THREE REVIEWERS FOUND. The first version asked the database
    // `findFirst({ status: 'verified' })`, which cannot see a revocation at all — so a user revoked
    // for fraud kept wallet, payments and eSIM until their passport happened to expire. Revocation
    // is a NEW row, not an edit of the old one, which is exactly why the filter missed it.
    h.rows = [row(), row({ status: 'revoked', decidedAt: new Date('2026-08-20T00:00:00Z') })]
    expect(await verifiedIdentityFor(PROFILE)).toBeNull()
    expect((await identityCapabilities(PROFILE)).size).toBe(0)
  })

  it('⛔ revoked wins even when the revocation is OLDER than the verification', async () => {
    // deriveVerification ranks `revoked` above recency on purpose: otherwise a revoked user buries
    // it under a fresh submission. Asserted here so this module keeps inheriting that, not just the
    // easy newest-row case.
    h.rows = [row({ status: 'revoked', decidedAt: new Date('2026-01-01T00:00:00Z') }), row()]
    expect(await verifiedIdentityFor(PROFILE)).toBeNull()
  })

  it('a still-valid verification SURVIVES a later rejection', async () => {
    // The app's rule, and deliberately inherited rather than re-decided: a rejection says "this
    // submission does not qualify", never "the previous one was a lie". Revocation is that.
    h.rows = [row(), row({ status: 'rejected', decidedAt: new Date('2026-08-20T00:00:00Z') })]
    expect(await verifiedIdentityFor(PROFILE)).not.toBeNull()
  })

  it('⛔ a REJECTED-only history is not an identity', async () => {
    h.rows = [row({ status: 'rejected' })]
    expect(await verifiedIdentityFor(PROFILE)).toBeNull()
    expect((await identityCapabilities(PROFILE)).size).toBe(0)
  })

  it('⛔ a PENDING-only history is not an identity either', async () => {
    h.rows = [row({ status: 'pending', decidedAt: null })]
    expect(await verifiedIdentityFor(PROFILE)).toBeNull()
  })

  it('a pending resubmission does not disturb a live verification', async () => {
    h.rows = [row(), row({ status: 'pending', decidedAt: null })]
    expect(await hasVerifiedIdentity(PROFILE)).toBe(true)
  })

  it('a document with no recorded expiry still counts', async () => {
    h.rows = [row({ documentExpiresAt: null })]
    expect(await verifiedIdentityFor(PROFILE)).not.toBeNull()
  })

  it('⛔ never exposes subjectHash or evidence', async () => {
    // fullName and nationality ARE carried, on purpose — an eSIM registration needs a legal name.
    // What must never cross is the material the DECISION was made from.
    const id = await verifiedIdentityFor(PROFILE)
    expect(Object.keys(id ?? {})).not.toContain('subjectHash')
    expect(Object.keys(id ?? {})).not.toContain('evidence')
  })
})

describe('residence — only an address-verifying source can establish it', () => {
  it('a VNeID (tier A) establishes Vietnamese residence', async () => {
    h.rows = [row({ tier: 'A', documentType: 'cccd' })]
    expect((await verifiedIdentityFor(PROFILE))?.residenceCountry).toBe('VNM')
  })

  it('a temporary residence card establishes Vietnamese residence', async () => {
    h.rows = [row({ documentType: 'trc' })]
    expect((await verifiedIdentityFor(PROFILE))?.residenceCountry).toBe('VNM')
  })

  it('⛔ case and whitespace cannot change the legal answer', async () => {
    // Two reviewers found the exact-case comparison: a `'TRC'` from any producer fell straight
    // through to a stored foreign residence, which is the direction that opens the rail.
    for (const dt of ['TRC', ' Trc ', 'CCCD']) {
      h.rows = [foreignResident({ documentType: dt })]
      expect((await verifiedIdentityFor(PROFILE))?.residenceCountry, dt).toBe('VNM')
    }
    h.rows = [foreignResident({ tier: 'a', documentType: 'passport' })]
    expect((await verifiedIdentityFor(PROFILE))?.residenceCountry).toBe('VNM')
  })

  it('⛔ a PASSPORT establishes nothing about where its holder lives', async () => {
    // The audience here is foreign nationals living in Vietnam, so reading a foreign passport as
    // foreign residence would unlock the stablecoin rail for exactly the people the DTI Law covers.
    h.rows = [row({ documentType: 'passport', nationality: 'GBR' })]
    expect((await verifiedIdentityFor(PROFILE))?.residenceCountry).toBeNull()
  })

  it('⛔ a VISA establishes nothing either — it is permission to enter, not to live', async () => {
    h.rows = [row({ documentType: 'visa' })]
    expect((await verifiedIdentityFor(PROFILE))?.residenceCountry).toBeNull()
  })

  it('an address-verifying source CAN establish a foreign residence', async () => {
    h.rows = [foreignResident()]
    expect((await verifiedIdentityFor(PROFILE))?.residenceCountry).toBe('GBR')
  })

  it('⛔ an UNTRUSTED source is ignored, however confident the column looks', async () => {
    // ⛔ THE RULE THAT WAS ONLY A COMMENT. Without the allow-list, the first thing to write this
    // column — a self-declaration field, a CSV backfill, an admin form — silently became the law
    // deciding who may hold a stablecoin wallet.
    // ⛔ `residence_document` IS REJECTED HERE ON PURPOSE — it was briefly an ALLOW-list member,
    // until two reviewers showed the branch is unreachable for the case that justified it (a TRC or
    // VNeID has already returned VNM), so the only way to arrive carrying that label is to smuggle
    // a foreign country past the gate. This asserts it stays rejected.
    for (const src of [null, '', 'self_declared', 'admin_form', 'import', 'PROVIDER_KYC_v2', 'residence_document']) {
      h.rows = [row({ residenceCountry: 'GBR', residenceSource: src })]
      expect((await verifiedIdentityFor(PROFILE))?.residenceCountry, String(src)).toBeNull()
    }
  })

  it('⛔ a malformed country code is rejected rather than passed to the payments gate', async () => {
    for (const c of ['G', 'GBRX', '12', '', null]) {
      h.rows = [row({ residenceCountry: c, residenceSource: 'provider_kyc' })]
      expect((await verifiedIdentityFor(PROFILE))?.residenceCountry, String(c)).toBeNull()
    }
  })

  it('⛔ a TRC ANYWHERE in the history vetoes a foreign residence on a NEWER row', async () => {
    /**
     * ⛔ THE PER-ROW HOLE A REVIEWER FOUND IN ROUND THREE. Residence was derived from the single row
     * `deriveVerification` selected, so a TRC holder who later adds a verified passport row
     * carrying provider_kyc/GBR had the newer row chosen, the TRC went invisible, and a Vietnam
     * resident got a foreign residence — with no untrusted source involved anywhere.
     */
    h.rows = [
      row({ documentType: 'trc', decidedAt: new Date('2026-01-01T00:00:00Z') }),
      foreignResident({ documentType: 'passport', decidedAt: new Date('2026-08-01T00:00:00Z') }),
    ]
    expect((await verifiedIdentityFor(PROFILE))?.residenceCountry).toBe('VNM')
    vi.stubEnv('PAYMENTS_SETTLEMENT_COUNTRIES', 'GBR,DEU')
    expect((await identityCapabilities(PROFILE)).has('wallet')).toBe(false)
  })

  it('⛔ and so does a REVOKED or REJECTED Vietnamese document', async () => {
    // A TRC that was rejected is still evidence the person was living in Vietnam. The veto is about
    // where they are, not about whether that particular submission qualified.
    h.rows = [row({ status: 'rejected', documentType: 'trc' }), foreignResident()]
    expect((await verifiedIdentityFor(PROFILE))?.residenceCountry).toBe('VNM')
  })

  it('⛔ a Vietnamese document OVERRIDES a verified foreign residence', async () => {
    // The direction that must never be wrong is the one that opens the stablecoin rail.
    h.rows = [foreignResident({ documentType: 'trc' })]
    expect((await verifiedIdentityFor(PROFILE))?.residenceCountry).toBe('VNM')
  })
})

describe('partiesFor / railsFor — the intersection that replaced a summary', () => {
  const ident = (over: Record<string, unknown> = {}) => ({
    profileId: PROFILE, tier: 'B', fullName: 'A', nationality: 'GBR', nationalities: ['GBR'],
    residenceCountry: 'GBR', documentExpiresAt: null, verifiedAt: null, ...over,
  }) as Parameters<typeof partiesFor>[0]

  it('⛔ NEVER returns an empty party set — that is what keeps railsFor from granting everything', () => {
    /**
     * ⛔ THE INVARIANT BEHIND THE GUARD. `railsFor` refuses an empty set because `every()` is
     * vacuously TRUE on one, which would hand out every rail in the worst direction — but the guard
     * itself is unreachable while this holds, so THIS is the contract worth pinning. A reviewer
     * found both the hazard and that nothing tested it.
     */
    for (const n of [[], ['GBR', 'VNM']]) {
      expect(partiesFor(ident({ nationalities: n })).length, JSON.stringify(n)).toBeGreaterThan(0)
    }
    expect(partiesFor(ident({ nationalities: [], nationality: null }))).toEqual(
      [{ kycVerified: true, nationality: null, residenceCountry: 'GBR' }])
  })

  it('⛔ the fallback party is ISO-mapped too, not handed over raw', () => {
    // A reviewer spotted `isoNationality` applied to the list but not to this branch, so a lone
    // MRZ `'D'` would reach the gate unmapped and be refused as an unknown country.
    expect(partiesFor(ident({ nationalities: [], nationality: 'D' }))[0].nationality).toBe('DEU')
    // ⚠️ AND AN UNMAPPABLE CODE IS PASSED THROUGH, NOT DROPPED — eligibility.ts refuses it on its
    // own terms, which keeps the judgement in one place and is the safe direction.
    expect(partiesFor(ident({ nationalities: [], nationality: 'GBN' }))[0].nationality).toBe('GBN')
  })

  it('one party per nationality, each carrying the same residence', () => {
    const parties = partiesFor(ident({ nationalities: ['GBR', 'VNM'] }))
    expect(parties.map((p) => p.nationality)).toEqual(['GBR', 'VNM'])
    expect(parties.every((p) => p.residenceCountry === 'GBR')).toBe(true)
  })

  it('⛔ a rail survives only if EVERY nationality permits it', () => {
    vi.stubEnv('PAYMENTS_SETTLEMENT_COUNTRIES', 'GBR,DEU')
    expect(railsFor(ident())).toContain('crossmint')
    expect(railsFor(ident({ nationalities: ['GBR', 'VNM'] }))).not.toContain('crossmint')
  })

  it('⚠️ and the rail universe comes from eligibility.ts, never a list here', () => {
    // If this file kept its own rail list, a rail added there would simply never appear.
    vi.stubEnv('PAYMENTS_SETTLEMENT_COUNTRIES', 'GBR,DEU')
    expect(railsFor(ident()).sort()).toEqual(['crossmint', 'paypal'])
  })
})

describe('capabilities — one verification unlocks all of them', () => {
  it('a verified identity unlocks eSIM without any payment rail', async () => {
    // ⚠️ `visa` IS NOT ASSERTED because it is edition-gated and this suite must pass under either
    // build. The point of the test is the SHARING: none of these required a second document.
    const caps = await identityCapabilities(PROFILE)
    expect(caps.has('esim')).toBe(true)
    expect(await hasCapability(PROFILE, 'esim')).toBe(true)
  })

  it('⛔ wallet is NOT granted to a party the country rules do not allow', async () => {
    // ⛔ ALL THREE REVIEWERS READ THE CAPABILITY SET AS PERMISSION, which is how it will be read by
    // whatever renders from it. A Vietnamese resident holding a stablecoin wallet is one render
    // away from a settlement the DTI Law does not permit, so the rail decides, not the document.
    vi.stubEnv('PAYMENTS_SETTLEMENT_COUNTRIES', 'GBR,DEU') // ⚠️ or this passes against a shut gate
    h.rows = [row({ documentType: 'trc' })] // residence VNM
    const caps = await identityCapabilities(PROFILE)
    expect(caps.has('wallet')).toBe(false)
    expect(caps.has('esim')).toBe(true) // identity still proved — an eSIM is not a payment
  })

  it('the wallet DOES open for an allow-listed foreign resident', async () => {
    // ⚠️ WITHOUT THIS THE TWO TESTS ABOVE ARE VACUOUS. `PAYMENTS_SETTLEMENT_COUNTRIES` is empty by
    // default, so every wallet assertion would pass just as happily against a gate that is broken
    // shut — which is the failure that hides for months because nothing goes red.
    vi.stubEnv('PAYMENTS_SETTLEMENT_COUNTRIES', 'GBR,DEU')
    h.rows = [foreignResident()]
    const caps = await identityCapabilities(PROFILE)
    expect(caps.has('wallet')).toBe(true)
    expect(caps.has('payments')).toBe(true)
  })

  it('⛔ and NOT for a Vietnamese resident, even with the allow-list switched on', async () => {
    vi.stubEnv('PAYMENTS_SETTLEMENT_COUNTRIES', 'GBR,DEU,VNM')
    h.rows = [foreignResident({ documentType: 'trc' })] // TRC forces VNM over the stored GBR
    expect((await identityCapabilities(PROFILE)).has('wallet')).toBe(false)
  })

  it('⛔ the MARKETPLACE edition grants NO settlement capability, however eligible the person', async () => {
    /**
     * ⛔ THE LEGALLY IMPORTANT HALF, AND THE SUITE COULD NOT SEE IT. vitest pins
     * NEXT_PUBLIC_ENO_EDITION to 'services', so every other assertion here describes eno.forum —
     * while the rule that matters is about eno.vn, a licensed sàn TMĐT that may not carry PayPal or
     * a settlement layer at all. `IS_SERVICES` folds at module scope, so proving it takes a
     * resetModules + re-import; without this test the gate could be deleted and everything stays
     * green.
     */
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
    vi.stubEnv('PAYMENTS_SETTLEMENT_COUNTRIES', 'GBR,DEU')
    vi.resetModules()
    const fresh = await import('./identity')
    h.rows = [foreignResident()] // maximally eligible: verified, GBR resident, provider-verified
    const caps = await fresh.identityCapabilities(PROFILE)
    expect(caps.has('wallet'), 'wallet').toBe(false)
    expect(caps.has('payments'), 'payments').toBe(false)
    expect(caps.has('visa'), 'visa').toBe(false)
    expect(caps.has('esim'), 'esim').toBe(true) // identity is still proved — an eSIM is not a payment
  })

  it('⛔ an unknown residence is treated as Vietnam and gets no wallet', async () => {
    vi.stubEnv('PAYMENTS_SETTLEMENT_COUNTRIES', 'GBR,DEU') // ⚠️ or this passes against a shut gate
    h.rows = [row({ residenceCountry: null })]
    expect((await identityCapabilities(PROFILE)).has('wallet')).toBe(false)
  })

  it('⛔ a DUAL NATIONAL cannot shed a Vietnamese passport by adding a newer foreign one', async () => {
    /**
     * ⛔ ROUND FOUR: THE HISTORY FIX HAD BEEN APPLIED TO ONE FIELD OF TWO. Residence scanned every
     * row while nationality still came from the single selected row, so a VNM passport row plus a
     * newer GBR row with provider_kyc/DEU produced nationality GBR — and the Vietnamese veto in
     * `isSettlementEligibleParty` simply never fired.
     */
    vi.stubEnv('PAYMENTS_SETTLEMENT_COUNTRIES', 'GBR,DEU')
    h.rows = [
      row({ nationality: 'VNM', decidedAt: new Date('2026-01-01T00:00:00Z') }),
      row({ nationality: 'GBR', residenceCountry: 'DEU', residenceSource: 'provider_kyc',
            decidedAt: new Date('2026-08-01T00:00:00Z') }),
    ]
    const id = await verifiedIdentityFor(PROFILE)
    expect(id?.nationality, 'the selected document still reads GBR').toBe('GBR')
    expect(id?.nationalities.sort()).toEqual(['GBR', 'VNM'])
    expect((await identityCapabilities(PROFILE)).has('wallet'), 'but the VNM veto must fire').toBe(false)
  })

  it('⛔ a SANCTIONED nationality anywhere in the history vetoes the rail', async () => {
    vi.stubEnv('PAYMENTS_SETTLEMENT_COUNTRIES', 'GBR,DEU')
    h.rows = [
      row({ nationality: 'IRN', decidedAt: new Date('2026-01-01T00:00:00Z') }),
      foreignResident({ nationality: 'GBR', decidedAt: new Date('2026-08-01T00:00:00Z') }),
    ]
    expect((await identityCapabilities(PROFILE)).has('wallet')).toBe(false)
  })

  it('⛔ a MALFORMED nationality anywhere blocks the rail, because the gate never saw it before', async () => {
    // ⚠️ THE CASE THE OLD "PICK THE MOST RESTRICTIVE ONE" SHAPE HID. `ZZZ` is not a Vietnamese
    // passport and not a sanctioned one, so the summarising version passed the innocent `GBR` over
    // instead — and eligibility.ts's rule that an unparseable nationality is not evidence of foreign
    // nationality never got to fire. Asking it about every value is what fixed it.
    vi.stubEnv('PAYMENTS_SETTLEMENT_COUNTRIES', 'GBR,DEU')
    for (const bad of ['ZZZ', 'VN', 'VIETNAM', 'GBX']) {
      h.rows = [
        row({ nationality: bad, decidedAt: new Date('2026-01-01T00:00:00Z') }),
        foreignResident({ nationality: 'GBR', decidedAt: new Date('2026-08-01T00:00:00Z') }),
      ]
      expect((await identityCapabilities(PROFILE)).has('wallet'), bad).toBe(false)
    }
  })

  it('a sanctioned national loses the WALLET but keeps ordinary commerce', async () => {
    /**
     * ⛔ THIS TEST ASSERTED THE OPPOSITE FOR ONE ROUND, AND THE OPPOSITE WAS A PRODUCT-WIDE BAN.
     * `SANCTIONED` is a stablecoin floor that is "deliberately over-inclusive" and contains RUS and
     * BLR; making it veto every rail stopped Russian expats — one of Vietnam's largest foreign
     * communities — buying or selling anything on eno.forum. Which jurisdictions must also be
     * refused FIAT is a question for counsel, not a widening of a list that was sized for a
     * different purpose.
     */
    vi.stubEnv('PAYMENTS_SETTLEMENT_COUNTRIES', 'GBR,DEU')
    for (const nationality of ['IRN', 'RUS']) {
      h.rows = [foreignResident({ nationality })]
      const caps = await identityCapabilities(PROFILE)
      expect(caps.has('wallet'), nationality).toBe(false)
      expect(caps.has('payments'), nationality).toBe(true)
      expect(caps.has('esim'), nationality).toBe(true)
    }
  })

  it('a single foreign nationality is untouched by the veto', async () => {
    vi.stubEnv('PAYMENTS_SETTLEMENT_COUNTRIES', 'GBR,DEU')
    h.rows = [foreignResident({ nationality: 'GBR' })]
    expect((await identityCapabilities(PROFILE)).has('wallet')).toBe(true)
  })

  it('⛔ a variant or LOCALISED document label still vetoes', async () => {
    // Exact matching missed `trc_renewal`; a prefix match still missed `thẻ tạm trú`, which the
    // prefix fix's own comment had cited as the case it handled. Two rounds, one substring.
    for (const dt of ['TRC_renewal', 'thẻ tạm trú', 'The Tam Tru', 'cccd_gan_chip', 'CMND']) {
      h.rows = [foreignResident({ documentType: dt })]
      expect((await verifiedIdentityFor(PROFILE))?.residenceCountry, dt).toBe('VNM')
    }
  })

  it('a trusted source stating VIETNAM is the answer until a NEWER trusted one supersedes it', async () => {
    /**
     * ⛔ THIS RATCHETED FOR ONE ROUND AND A REVIEWER SHOWED THE COST: a genuine emigration could
     * never be recorded by the one source trusted to record it. Only DOCUMENTS are one-way. A TRC
     * is a fact about a moment that we cannot un-observe and did not adjudicate; a provider's
     * address check is a dated finding by a regulated party, which that same party can supersede.
     */
    const vnRow = row({ documentType: 'passport', residenceCountry: 'VNM', residenceSource: 'provider_kyc',
                        decidedAt: new Date('2026-01-01T00:00:00Z') })
    h.rows = [vnRow]
    expect((await verifiedIdentityFor(PROFILE))?.residenceCountry, 'alone').toBe('VNM')

    h.rows = [vnRow, foreignResident({ decidedAt: new Date('2026-08-01T00:00:00Z') })]
    expect((await verifiedIdentityFor(PROFILE))?.residenceCountry, 'superseded').toBe('GBR')

    // ⚠️ BUT A DOCUMENT STILL OVERRIDES BOTH — that ratchet is unchanged.
    h.rows = [row({ documentType: 'trc' }), foreignResident({ decidedAt: new Date('2026-08-01T00:00:00Z') })]
    expect((await verifiedIdentityFor(PROFILE))?.residenceCountry, 'document wins').toBe('VNM')
  })

  it('⛔ RENEWING A PASSPORT does not revoke a verified foreign residence', async () => {
    /**
     * ⛔ THE MIRROR IMAGE OF THE PER-ROW BUG, found by a reviewer one round after the first half was
     * fixed. Residence was read off the single selected row, so a foreign resident verified through
     * the provider who later renews their passport gets a newer row with no residence on it, the
     * verified address is forgotten, and the wallet is revoked. A passport renewal is not a move.
     */
    vi.stubEnv('PAYMENTS_SETTLEMENT_COUNTRIES', 'GBR,DEU')
    h.rows = [
      foreignResident({ decidedAt: new Date('2026-01-01T00:00:00Z') }),
      row({ documentType: 'passport', decidedAt: new Date('2026-08-01T00:00:00Z') }), // renewal, no residence
    ]
    expect((await verifiedIdentityFor(PROFILE))?.residenceCountry).toBe('GBR')
    expect((await identityCapabilities(PROFILE)).has('wallet')).toBe(true)
  })

  it('but the NEWEST trusted answer wins — a real relocation still takes effect', async () => {
    h.rows = [
      foreignResident({ residenceCountry: 'GBR', decidedAt: new Date('2026-01-01T00:00:00Z') }),
      foreignResident({ residenceCountry: 'DEU', decidedAt: new Date('2026-08-01T00:00:00Z') }),
    ]
    expect((await verifiedIdentityFor(PROFILE))?.residenceCountry).toBe('DEU')
  })

  it('⛔ a REJECTED nationality does not permanently lock a verified user out', async () => {
    /**
     * ⛔ THE SAME TRUST BOUNDARY, MISSED ON NATIONALITY FOR ONE ROUND AFTER RESIDENCE GOT IT. All
     * three commit-gate families found it: `nationalities` scanned every row, so a rejected upload
     * carrying a garbled or unlisted code stayed in the set forever — and since every nationality
     * must clear the gate, one bad submission revoked settlement permanently with no way back.
     */
    vi.stubEnv('PAYMENTS_SETTLEMENT_COUNTRIES', 'GBR,DEU')
    for (const bad of ['ZZZ', 'VNM', 'IRN']) {
      h.rows = [
        { ...row({ nationality: bad, decidedAt: new Date('2026-01-01T00:00:00Z') }), status: 'rejected' },
        foreignResident({ nationality: 'GBR', decidedAt: new Date('2026-08-01T00:00:00Z') }),
      ]
      expect((await identityCapabilities(PROFILE)).has('wallet'), bad).toBe(true)
    }
  })

  it('⛔ but a VERIFIED Vietnamese passport still vetoes — the dual-national fix survives', async () => {
    vi.stubEnv('PAYMENTS_SETTLEMENT_COUNTRIES', 'GBR,DEU')
    h.rows = [
      row({ nationality: 'VNM', decidedAt: new Date('2026-01-01T00:00:00Z') }),
      foreignResident({ nationality: 'GBR', decidedAt: new Date('2026-08-01T00:00:00Z') }),
    ]
    expect((await identityCapabilities(PROFILE)).has('wallet')).toBe(false)
  })

  it('⛔ a REJECTED row cannot supply the foreign residence that opens the rail', async () => {
    /**
     * ⛔ THE COMMIT-GATE FINDING, RAISED BY ALL THREE FAMILIES AT ONCE. The VNM ratchet scans every
     * status on purpose — a rejected TRC is still evidence of living in Vietnam — and the branch
     * that OPENS the rail was doing the same. So a live verification could take its foreign
     * residence from a row rejected for identity mismatch: an address belonging to whoever's
     * document was misused. The closing direction may read everything; the opening direction may not.
     */
    vi.stubEnv('PAYMENTS_SETTLEMENT_COUNTRIES', 'GBR,DEU')
    for (const status of ['rejected', 'pending', 'revoked']) {
      h.rows = [
        row({ documentType: 'passport', decidedAt: new Date('2026-01-01T00:00:00Z') }),
        { ...foreignResident({ decidedAt: new Date('2026-08-01T00:00:00Z') }), status },
      ]
      // A revoked row kills the identity outright; the other two leave the Jan verification live.
      const id = await verifiedIdentityFor(PROFILE)
      expect(id?.residenceCountry ?? null, status).toBeNull()
    }
  })

  it('an UNTRUSTED source claiming Vietnam does not ratchet — it is ignored entirely', async () => {
    h.rows = [
      row({ residenceCountry: 'VNM', residenceSource: 'self_declared',
            decidedAt: new Date('2026-01-01T00:00:00Z') }),
      foreignResident({ decidedAt: new Date('2026-08-01T00:00:00Z') }),
    ]
    expect((await verifiedIdentityFor(PROFILE))?.residenceCountry).toBe('GBR')
  })

  it('a Vietnamese resident DOES keep `payments` — the DTI restriction is stablecoins, not fiat', async () => {
    // ⚠️ DELIBERATE, AND ASSERTED SO IT IS NOT MISTAKEN FOR THE ROUND-TWO BUG. PayPal is lawful for
    // a Vietnamese party; what the DTI Law forbids is PAYING with digital assets. So on the
    // services edition a VN resident gets `payments` and never `wallet`.
    vi.stubEnv('PAYMENTS_SETTLEMENT_COUNTRIES', 'GBR,DEU')
    h.rows = [row({ documentType: 'trc' })]
    const caps = await identityCapabilities(PROFILE)
    expect(caps.has('payments')).toBe(true)
    expect(caps.has('wallet')).toBe(false)
  })

  it('⛔ an identity with NO nationality on record gets no wallet, not every rail', async () => {
    // ⛔ THE VACUOUS-`every()` HAZARD. `partiesFor` falls back to one party rather than none, and
    // `railsFor` now refuses an empty set outright — without both, an all-null history would have
    // intersected zero answers and granted EVERY rail. A reviewer found the branch untested.
    vi.stubEnv('PAYMENTS_SETTLEMENT_COUNTRIES', 'GBR,DEU')
    h.rows = [foreignResident({ nationality: null })]
    const caps = await identityCapabilities(PROFILE)
    expect(caps.has('wallet')).toBe(false)
    expect(caps.has('esim')).toBe(true)
  })

  it('⛔ a GERMAN passport is not silently ineligible forever', async () => {
    /**
     * ⛔ ICAO 9303 IS NOT ISO 3166. The MRZ parser takes the nationality field verbatim and ICAO
     * writes Germany as `D`, so `isSettlementEligibleParty` — which requires an ISO alpha-3 code —
     * refused every German passport holder with no way to tell that from a lawful refusal. A
     * reviewer found it by reading the parser; the tests had only ever used codes identical in both.
     */
    vi.stubEnv('PAYMENTS_SETTLEMENT_COUNTRIES', 'GBR,DEU')
    h.rows = [foreignResident({ nationality: 'D', residenceCountry: 'DEU' })]
    expect((await identityCapabilities(PROFILE)).has('wallet')).toBe(true)
  })

  it('⛔ but an unmappable code is NOT guessed at — it stays ineligible', async () => {
    // GBN, XXA and the rest are real ICAO codes whose settlement status is a question for counsel,
    // not a lookup table to invent. They fail closed, and on-verified.ts reports them separately so
    // the people behind them surface for a decision instead of vanishing.
    vi.stubEnv('PAYMENTS_SETTLEMENT_COUNTRIES', 'GBR,DEU')
    for (const n of ['GBN', 'XXA', 'ZZZ', 'RKS']) {
      h.rows = [foreignResident({ nationality: n })]
      expect((await identityCapabilities(PROFILE)).has('wallet'), n).toBe(false)
    }
  })

  it('⛔ a malformed RESIDENCE is rejected by the code list, not by its shape', async () => {
    // ⚠️ `'D'` IS IN THIS LIST DELIBERATELY. Residence validation briefly reused `isoNationality`,
    // which carries the MRZ alias D→DEU — but that alias belongs to a passport's nationality field,
    // and a residence comes from the provider's KYC, which speaks ISO. A reviewer caught the reuse.
    vi.stubEnv('PAYMENTS_SETTLEMENT_COUNTRIES', 'GBR,DEU')
    for (const c of ['ZZZ', 'GBX', 'XXA', 'D']) {
      h.rows = [foreignResident({ residenceCountry: c })]
      expect((await verifiedIdentityFor(PROFILE))?.residenceCountry, c).toBeNull()
    }
  })

  it('⛔ no LEGAL NAME means no eSIM — a carrier will not register a blank subscriber', async () => {
    // A reviewer noticed `fullName` is nullable and the capability was granted anyway, so a user
    // would be told they can buy an eSIM and then be refused at the carrier. Advertising a
    // capability the next step rejects is worse than not advertising it.
    for (const n of [null, '', '   ']) {
      h.rows = [row({ fullName: n })]
      const caps = await identityCapabilities(PROFILE)
      expect(caps.has('esim'), JSON.stringify(n)).toBe(false)
      expect(caps.has('visa'), JSON.stringify(n)).toBe(false)
    }
    h.rows = [row({ fullName: 'ALEX DOE' })]
    expect((await identityCapabilities(PROFILE)).has('esim')).toBe(true)
  })

  it('⛔ no verification unlocks nothing', async () => {
    h.rows = []
    expect((await identityCapabilities(PROFILE)).size).toBe(0)
    expect(await hasCapability(PROFILE, 'wallet')).toBe(false)
  })

  it('⛔ an expired document revokes every capability at once', async () => {
    h.rows = [row({ documentExpiresAt: past })]
    expect((await identityCapabilities(PROFILE)).size).toBe(0)
  })
})
