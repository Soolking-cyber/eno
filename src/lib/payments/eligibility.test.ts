import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'


/**
 * ⚠️ EVERY TEST BELOW ASSUMES THE SERVICES EDITION, AND NOTHING HERE ESTABLISHES IT. `availableRails`
 * and `railAllowed` now return nothing on the marketplace build (eno.vn is paymentless), and
 * `IS_SERVICES` folds at module scope — so these pass because `vitest.config.ts` pins
 * NEXT_PUBLIC_ENO_EDITION to 'services', not because they say so. A reviewer flagged the ambient
 * coupling: run this file under the other edition and every rail assertion fails at once, for a
 * reason none of them mention.
 * ⚠️ THE EDITION ITSELF IS TESTED IN eligibility-edition.test.ts, in its own file because proving it
 * needs `vi.resetModules()` — doing that here polluted the worker and turned five unrelated tests
 * red in the full suite while they passed in isolation.
 */import {
  availableRails,
  isSettlementEligibleParty,
  partiesEligible,
  vietqrPayoutReady,
  railAllowed,
  type PartyIdentity,
} from './eligibility'

// This module is the legal line of the payments feature, so the tests that matter are the ones
// asserting what is NOT allowed. A wrong "no" costs a trade; a wrong "yes" is an unlawful payment.

/**
 * ⛔ THE ALLOW-LIST IS CONFIGURATION AND DEFAULTS TO EMPTY, so these tests set it explicitly. That
 * default is the point: an environment that has not had counsel's sign-off offers the wallet to
 * nobody. The suite below asserts that too.
 */
const ALLOWED = 'GBR,SGP,USA'
beforeEach(() => { process.env.PAYMENTS_SETTLEMENT_COUNTRIES = ALLOWED })
afterEach(() => { delete process.env.PAYMENTS_SETTLEMENT_COUNTRIES })

const verified = (over: Partial<PartyIdentity> = {}): PartyIdentity => ({
  kycVerified: true,
  nationality: 'GBR',
  residenceCountry: 'GBR',
  ...over,
})

describe('partiesEligible — both sides, always', () => {
  it('allows two verified parties', () => {
    expect(partiesEligible(verified(), verified())).toBeNull()
  })

  it('names the seller first, because the seller receives the money', () => {
    expect(partiesEligible(verified({ kycVerified: false }), verified({ kycVerified: false }))).toBe('seller_kyc_required')
  })

  it('⛔ refuses an unverified buyer even when the seller is verified', () => {
    expect(partiesEligible(verified({ kycVerified: false }), verified())).toBe('buyer_kyc_required')
  })

  it('⛔ refuses an unverified seller even when the buyer is verified', () => {
    expect(partiesEligible(verified(), verified({ kycVerified: false }))).toBe('seller_kyc_required')
  })
})

describe('isSettlementEligibleParty — three allow-lists, all of which must pass', () => {
  it('a verified resident of a cleared country on a foreign passport is eligible', () => {
    expect(isSettlementEligibleParty(verified({ nationality: 'GBR', residenceCountry: 'GBR' }))).toBe(true)
  })

  it('⛔ a foreign national RESIDENT IN VIETNAM is not', () => {
    // The whole audience of this marketplace is foreign nationals living in Vietnam, so a rule
    // written against nationality would have got the commonest case exactly backwards.
    expect(isSettlementEligibleParty(verified({ nationality: 'GBR', residenceCountry: 'VNM' }))).toBe(false)
  })

  it('⛔ a Vietnamese national abroad is not — nationality vetoes', () => {
    expect(isSettlementEligibleParty(verified({ nationality: 'VNM', residenceCountry: 'SGP' }))).toBe(false)
  })

  it('⛔ ABSENT nationality is not enough evidence, even from a cleared country', () => {
    // The deny-list version let a Vietnamese national abroad through whenever we had not captured
    // their passport. Three reviewers found it; an allow-list cannot express that bug.
    expect(isSettlementEligibleParty({ kycVerified: true, residenceCountry: 'SGP' })).toBe(false)
    expect(isSettlementEligibleParty(verified({ nationality: null, residenceCountry: 'SGP' }))).toBe(false)
  })

  it('⛔ a country we have never cleared is denied, even though it is not Vietnam', () => {
    // NOT-VIETNAM IS NOT LAWFUL. China bans crypto payments outright; the old framing shipped
    // every unassessed country as allowed.
    expect(isSettlementEligibleParty(verified({ nationality: 'CHN', residenceCountry: 'CHN' }))).toBe(false)
    expect(isSettlementEligibleParty(verified({ nationality: 'KHM', residenceCountry: 'KHM' }))).toBe(false)
  })

  it('⛔ a malformed three-letter code is unknown, not a country', () => {
    // `ZZZ`/`GBX` passed the old shape-only check and unlocked the rail.
    for (const bad of ['ZZZ', 'GBX', 'AAA', '', '  ', 'VN', 'Vietnam', 'XX']) {
      expect(isSettlementEligibleParty(verified({ residenceCountry: bad })), JSON.stringify(bad)).toBe(false)
    }
  })

  it('⛔ a malformed NATIONALITY is not evidence of foreign nationality either', () => {
    // It is not a Vietnamese passport — but it is not a passport at all, and the old rule read
    // "known and not VNM" against a shape check, so `ZZZ` counted as known.
    for (const bad of ['ZZZ', 'GBX', 'AAA']) {
      expect(isSettlementEligibleParty(verified({ nationality: bad, residenceCountry: 'GBR' })), bad).toBe(false)
    }
  })

  it('⛔ WITH NO CONFIGURED JURISDICTIONS THE RAIL IS OFFERED TO NOBODY', () => {
    // The default state of every environment until counsel signs off. The first version of this
    // module shipped ten countries as a "placeholder", which authorised settlement in all of them.
    // ⚠️ THE *STABLECOIN* RAIL. The fiat rails are unaffected — they are not what the allow-list
    // governs — so the assertion is that `crossmint` is absent, not that nothing is offered.
    delete process.env.PAYMENTS_SETTLEMENT_COUNTRIES
    expect(isSettlementEligibleParty(verified())).toBe(false)
    expect(availableRails(verified(), verified())).not.toContain('crossmint')
  })

  it('⛔ a SANCTIONED nationality is refused even from an allow-listed residence', () => {
    // Sanctions attach to the person, not only to where they are standing.
    for (const n of ['PRK', 'IRN', 'SYR', 'CUB', 'RUS']) {
      expect(isSettlementEligibleParty(verified({ nationality: n, residenceCountry: 'GBR' })), n).toBe(false)
    }
  })

  it('⛔ neither a sanctioned jurisdiction nor a typo can be configured in', () => {
    process.env.PAYMENTS_SETTLEMENT_COUNTRIES = 'PRK,IRN,GBX,ZZZ,GBR'
    expect(isSettlementEligibleParty(verified({ nationality: 'GBR', residenceCountry: 'PRK' }))).toBe(false)
    expect(isSettlementEligibleParty(verified({ nationality: 'GBR', residenceCountry: 'GBX' }))).toBe(false)
    // …and the one real entry beside them still works, so the filter is not just rejecting the lot.
    expect(isSettlementEligibleParty(verified({ nationality: 'GBR', residenceCountry: 'GBR' }))).toBe(true)
  })

  it('⛔ Vietnam cannot be switched on by configuration', () => {
    process.env.PAYMENTS_SETTLEMENT_COUNTRIES = 'VNM,GBR'
    expect(isSettlementEligibleParty(verified({ nationality: 'GBR', residenceCountry: 'VNM' }))).toBe(false)
    expect(isSettlementEligibleParty(verified({ nationality: 'GBR', residenceCountry: 'GBR' }))).toBe(true)
  })

  it('⛔ unverified identity is unverified country', () => {
    expect(isSettlementEligibleParty(verified({ kycVerified: false }))).toBe(false)
  })

  it('accepts lowercase and padded alpha-3', () => {
    expect(isSettlementEligibleParty(verified({ nationality: 'gbr', residenceCountry: ' gbr ' }))).toBe(true)
  })
})

describe('railAllowed — the stablecoin rail needs BOTH sides outside Vietnam', () => {
  const abroad = verified({ nationality: 'GBR', residenceCountry: 'GBR' })
  const inVietnam = verified({ nationality: 'GBR', residenceCountry: 'VNM' })

  it('⛔ denies a rail id it does not recognise', () => {
    // PaymentRailId is erased at runtime, so a route casting a request body could pass anything.
    // The old `if (rail === "crossmint")` fell through to allowed on a capital letter.
    for (const bogus of ['Crossmint', 'crossmint ', 'crossmint_solana', '', 'stripe']) {
      expect(railAllowed(bogus as never, inVietnam, inVietnam), bogus).toBe('rail_not_available_in_country')
    }
  })

  it('allows crossmint when both parties are abroad', () => {
    expect(railAllowed('crossmint', abroad, abroad)).toBeNull()
  })

  it('⛔ refuses crossmint when the SELLER is in Vietnam', () => {
    // The seller receives the prohibited instrument — this is the shape a payer-only check would
    // have wrongly allowed.
    expect(railAllowed('crossmint', abroad, inVietnam)).toBe('rail_not_available_in_country')
  })

  it('⛔ refuses crossmint when the BUYER is in Vietnam', () => {
    expect(railAllowed('crossmint', inVietnam, abroad)).toBe('rail_not_available_in_country')
  })

  it('⛔ refuses crossmint when both are in Vietnam', () => {
    expect(railAllowed('crossmint', inVietnam, inVietnam)).toBe('rail_not_available_in_country')
  })

  it('⛔ KYC is checked before country, so an unverified pair never reveals rail availability', () => {
    expect(railAllowed('crossmint', abroad, verified({ kycVerified: false }))).toBe('seller_kyc_required')
  })

  it('paypal is not country-gated here — it settles in fiat', () => {
    expect(railAllowed('paypal', inVietnam, inVietnam)).toBeNull()
  })

  it('⛔ but paypal still requires both sides verified', () => {
    expect(railAllowed('paypal', verified({ kycVerified: false }), abroad)).toBe('buyer_kyc_required')
  })
})

describe('availableRails — the wallet leads where it is lawful', () => {
  const abroad = verified({ nationality: 'GBR', residenceCountry: 'GBR' })
  const inVietnam = verified({ nationality: 'GBR', residenceCountry: 'VNM' })

  it('offers the wallet first, then paypal, for a foreign pair', () => {
    /**
     * ⛔ NO `vietqr` HERE, AND THIS TEST ASSERTED THE OPPOSITE FOR ONE ROUND. A GBR buyer paying a
     * GBR seller who holds a Vietnamese account was offered a NAPAS 247 QR above PayPal — a code
     * no foreign banking app can execute. A reviewer found it by reading the test rather than the
     * comment above the code, which is the right way round.
     */
    expect(availableRails(abroad, { ...abroad, vietqrPayout: true })).toEqual(['crossmint', 'paypal'])
    expect(availableRails(abroad, abroad)).toEqual(['crossmint', 'paypal'])
  })

  it('⛔ VietQR needs a buyer who can plausibly send one', () => {
    const payable = { ...inVietnam, vietqrPayout: true }
    expect(railAllowed('vietqr', inVietnam, payable), 'VN buyer').toBeNull()
    // ⚠️ UNKNOWN RESIDENCE IS ALLOWED, the opposite of the wallet rule — being wrong here shows
    // someone an option they cannot use, not an unlawful settlement.
    expect(railAllowed('vietqr', { ...inVietnam, residenceCountry: null }, payable), 'unknown').toBeNull()
    expect(railAllowed('vietqr', abroad, payable), 'GBR buyer').toBe('rail_not_available_in_country')
  })

  it('⛔ vietqrPayoutReady is the ONLY producer of that boolean', () => {
    // It is a boolean on PartyIdentity, so any caller could just pass `true`; two reviewers called
    // it a claim rather than a fact. Shape-checked, not merely present — a seller who typed their
    // account with dashes is not payable, and finding that out at checkout is too late.
    expect(vietqrPayoutReady({ bankBin: '970415', bankAccountNo: '0011001932418', bankAccountName: 'NGUYEN VAN A' })).toBe(true)
    for (const bad of [
      { bankBin: '97041', bankAccountNo: '0011001932418', bankAccountName: 'A' },
      { bankBin: '970415', bankAccountNo: '0011-0019', bankAccountName: 'A' },
      { bankBin: '970415', bankAccountNo: '0011001932418', bankAccountName: '  ' },
      { bankBin: null, bankAccountNo: null, bankAccountName: null },
      {},
      // ⛔ NULL IS THE DEFAULT STATE — `Seller.payout` is a nullable relation and no existing row
      // has one, so this is the obvious call, and it used to throw rather than answer.
      null,
      undefined,
    ]) expect(vietqrPayoutReady(bad), JSON.stringify(bad)).toBe(false)
  })

  it('⛔ VietQR is NOT offered when the seller has no account to be paid into', () => {
    /**
     * ⛔ EVERY EXISTING Seller ROW HAS NULL BANK DETAILS. Returning `null` unconditionally and
     * leaving it to "the checkout" offered the rail to everybody and made it fulfillable by
     * nobody — a buyer would reach a payment page that cannot render a QR. All three reviewers
     * refused it. A rail you cannot be paid on is not an available rail.
     */
    expect(railAllowed('vietqr', inVietnam, inVietnam)).toBe('payout_details_missing')
    expect(railAllowed('vietqr', inVietnam, { ...inVietnam, vietqrPayout: true })).toBeNull()
  })

  it('⛔ inside Vietnam the wallet is gone and the QR is what remains', () => {
    /**
     * ⛔ THE WHOLE POINT OF THE THIRD RAIL. Vietnam is the market — owner, 2026-08-31: "vietnam is
     * the place users will pay with qr" — and it is exactly the population the DTI Law bars from
     * paying with digital assets. Before `vietqr` existed this test read "falls back to paypal
     * alone", which is to say the primary market had only the rail it is least likely to use.
     */
    const rails = availableRails(inVietnam, { ...inVietnam, vietqrPayout: true })
    expect(rails).not.toContain('crossmint')
    expect(rails).toContain('vietqr')
  })

  it('⛔ offers nothing at all when a party is unverified', () => {
    expect(availableRails(abroad, verified({ kycVerified: false }))).toEqual([])
  })
})

describe('⚠️ sanctions veto the WALLET only — and that is deliberate', () => {
  const ok = { kycVerified: true, nationality: 'GBR', residenceCountry: 'GBR' }
  const russian = { kycVerified: true, nationality: 'RUS', residenceCountry: 'GBR' }
  const iranian = { kycVerified: true, nationality: 'IRN', residenceCountry: 'GBR' }

  it('⛔ a sanctioned nationality is refused the STABLECOIN rail', () => {
    expect(railAllowed('crossmint', iranian, ok)).toBe('rail_not_available_in_country')
    expect(railAllowed('crossmint', russian, ok)).toBe('rail_not_available_in_country')
  })

  it('⛔ but ORDINARY COMMERCE is untouched, and this is the case that was broken', () => {
    /**
     * ⛔ A REVERTED FIX, PINNED SO IT CANNOT COME BACK BY ACCIDENT. Moving the SANCTIONED veto into
     * `partiesEligible` so it covered PayPal looked like closing a hole; what it did was ban every
     * Russian and Belarusian expat on eno.forum from buying or selling anything. `SANCTIONED` is a
     * stablecoin floor that is "deliberately over-inclusive", not a trading ban — and only IRN was
     * tested, so the blast radius was invisible for a whole review round.
     */
    for (const p of [russian, iranian]) {
      expect(railAllowed('paypal', p, ok)).toBeNull()
      expect(partiesEligible(p, ok)).toBeNull()
    }
  })

  it('an unsanctioned pair still gets PayPal with the allow-list empty', () => {
    expect(railAllowed('paypal', ok, ok)).toBeNull()
  })
})
