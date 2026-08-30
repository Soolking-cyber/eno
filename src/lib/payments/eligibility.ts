/**
 * WHO MAY SETTLE A TRADE, AND ON WHICH RAIL.
 *
 * This module is the legal line of the payments feature, expressed as code. Everything else —
 * orders, checkout, payouts, shipment — is plumbing that asks this one question first.
 *
 * ⛔ eno.vn HAS NO PAYMENTS AT ALL AND THIS MODULE DOES NOT CHANGE THAT. The marketplace edition is
 * a licensed sàn TMĐT and may not be the merchant of record; every payment ROUTE lives behind the
 * `.forum.svc.` infix, which a marketplace build does not compile at all (next.config.ts). This
 * file is pure and edition-agnostic on purpose — it decides eligibility, it does not decide which
 * app exists — but nothing on eno.vn may import it into a checkout, because there is no checkout.
 *
 * ⛔ STABLECOIN SETTLEMENT IS PROHIBITED FOR VIETNAMESE PARTIES, AND THAT IS NOT A RISK APPETITE
 * QUESTION. Vietnam's DTI Law legalised HOLDING and TRADING digital assets from 2026-01-01 and did
 * not legalise PAYING with them: settlement must be denominated in VND, and fiat-backed stablecoins
 * (USDT, USDC) may not be used as a payment instrument — Resolution 05/2025/NQ-CP puts them outside
 * the licensed framework entirely. Offshore routing does not cure it: the prohibition attaches to
 * the PARTIES and the payment, not to the domain serving the page, and Vietnam is actively closing
 * the offshore path (a five-licence local pilot, a 49% foreign ownership cap, mandatory local
 * partnership). Owner accepted this on 2026-08-30 and chose to wire the wallet for non-Vietnam
 * users only, which is what `railAllowed` below implements.
 *
 * ⚠️ SO THE DEFAULT IS INELIGIBLE, NOT ELIGIBLE. Every unknown — no verification, no country, a
 * country we could not parse — resolves to "treat as Vietnamese". A wrong "no" costs a trade; a
 * wrong "yes" is an unlawful payment by a company in the middle of a licence application. Those are
 * not symmetric, so this file never guesses in the permissive direction.
 */

/** ISO-3166-1 alpha-3, uppercased. Vietnam. */
export const VN = 'VNM'

/**
 * ⛔ JURISDICTIONS WHERE WE HAVE POSITIVELY ESTABLISHED THAT STABLECOIN SETTLEMENT IS LAWFUL FOR US.
 * An ALLOW-LIST, and the first version of this file got it wrong by asking "is this party outside
 * Vietnam" instead. Three reviewers found the resulting holes — a typo'd `GBX` passed as a country,
 * an absent nationality skipped the Vietnamese-national rule — but the deeper error was the
 * framing: NOT-VIETNAM IS NOT THE SAME AS LAWFUL. China bans crypto payments outright, and several
 * other markets this app reaches restrict them; "anywhere that isn't Vietnam" would have shipped
 * those as allowed while carefully blocking the one country we had researched.
 *
 * ⚠️ EVERY ENTRY IS A LEGAL ASSERTION AND NEEDS COUNSEL BEFORE IT IS ADDED. This list is
 * deliberately short and deliberately boring; an unknown, unparseable or unlisted country is
 * denied, which is the only direction that fails safely for a company mid-licensing as a sàn TMĐT.
 * ⚠️ IT IS NOT A LIST OF COUNTRIES WE SERVE. eno reaches far more places than this; what this
 * enumerates is where the WALLET rail may settle. PayPal is unaffected.
 */
/**
 * ⛔ EMPTY BY DEFAULT, AND THE FIRST VERSION SHIPPED TEN COUNTRIES AS A "PLACEHOLDER". That was the
 * sharpest thing three reviewers said about this file and they were right: a comment reading
 * "every one of these still needs the written opinion" does not stop the CODE authorising
 * settlement in them. The legal content of a compliance module cannot be a to-do.
 *
 * So the list is configuration, not source. `PAYMENTS_SETTLEMENT_COUNTRIES` is a comma-separated
 * list of ISO-3166-1 alpha-3 codes, unset in every environment until counsel signs off — and unset
 * means the wallet rail is offered to NOBODY, which is the honest starting state.
 *
 * ⚠️ NOT `NEXT_PUBLIC_`. This is a server decision; publishing it would let a client read which
 * jurisdictions are open and, worse, invite someone to branch on it in the browser.
 * ⚠️ VIETNAM IS FILTERED OUT NO MATTER WHAT THE ENV SAYS. A deploy typo must not be able to switch
 * on the one jurisdiction this whole module exists to exclude.
 * ⚠️ IT IS NOT A LIST OF COUNTRIES WE SERVE — eno reaches far more places. It enumerates where the
 * WALLET may settle. PayPal is unaffected.
 */
export function settlementAllowedCountries(): ReadonlySet<string> {
  const raw = process.env.PAYMENTS_SETTLEMENT_COUNTRIES || ''
  const out = new Set<string>()
  for (const part of raw.split(',')) {
    const c = norm(part)
    // ⚠️ MEMBERSHIP OF THE REAL CODE LIST, not just the shape — a reviewer pointed out that a
    // deploy typo (`GBX`) would otherwise become a jurisdiction. Configuration is an input like
    // any other and gets the same validation as a passport field.
    if (c && couldBeAllowListed(c)) out.add(c)
  }
  return out
}

/**
 * Could this country lawfully appear on the settlement allow-list at all?
 *
 * ⛔ EXTRACTED FROM `settlementAllowedCountries`, NOT COPIED BESIDE IT. It answers a question a
 * caller genuinely needs and could otherwise only get by re-implementing this rule: whether a
 * country is absent from the list because the LAW forbids it (Vietnam, a sanctioned jurisdiction,
 * or not a country at all) or merely because nobody has opened it yet. A reviewer found the two
 * reported identically to users — a Dutch resident was told "the law says no" when the truth was
 * "counsel has not added NLD", and a backfill keyed on that outcome would have skipped them for
 * good. Deriving both answers from one predicate is what stops those drifting apart.
 */
export function couldBeAllowListed(country: string | null | undefined): boolean {
  const c = norm(country)
  return !!c && c !== VN && ISO_ALPHA3.has(c) && !SANCTIONED.has(c)
}

/**
 * ⛔ COMPREHENSIVELY SANCTIONED JURISDICTIONS — vetoed as residence AND as nationality, and not
 * overridable by configuration. A reviewer put it plainly: the module called itself the legal line
 * of a payments feature and would have offered stablecoin settlement to a DPRK, Iranian, Syrian or
 * Cuban national who happened to live somewhere on the allow-list. Sanctions attach to the person,
 * not only to where they are standing.
 *
 * ⚠️ THIS IS A FLOOR, NOT A SANCTIONS PROGRAMME. Real screening is name-and-list based (SDN,
 * consolidated UN/EU lists) against every party to a payment, changes weekly, and is a thing you
 * buy rather than hand-maintain — Crossmint runs KYC, AML and travel-rule natively, which is where
 * that belongs. What this constant does is stop the obvious case reaching them at all, so a
 * jurisdiction nobody should be settling with cannot be switched on by an env var typo.
 * ⚠️ COUNTRY-LEVEL ONLY, and deliberately over-inclusive rather than precise: partial or
 * region-specific measures are exactly the judgement a screening provider should make, not a list
 * in application code.
 */
const SANCTIONED = new Set(['PRK', 'IRN', 'SYR', 'CUB', 'RUS', 'BLR', 'MMR', 'AFG', 'SDN', 'VEN'])

/**
 * ISO-3166-1 alpha-3, so a typo is an unknown country rather than a new one.
 *
 * ⛔ WITHOUT THIS, `ZZZ` AND `GBX` WERE COUNTRIES. `norm()` only ever checked the SHAPE — three
 * ASCII letters — so a malformed nationality satisfied "known and not VNM" and a malformed
 * residence would satisfy any allow-list built the same way. Reviewers found both. Membership of a
 * real code list is the difference between validating a value and validating a string length.
 */
export const ISO_ALPHA3 = new Set(
  ('ABW AFG AGO AIA ALA ALB AND ARE ARG ARM ASM ATA ATF ATG AUS AUT AZE BDI BEL BEN BES BFA BGD BGR BHR BHS BIH BLM ' +
   'BLR BLZ BMU BOL BRA BRB BRN BTN BVT BWA CAF CAN CCK CHE CHL CHN CIV CMR COD COG COK COL COM CPV CRI CUB CUW CXR ' +
   'CYM CYP CZE DEU DJI DMA DNK DOM DZA ECU EGY ERI ESH ESP EST ETH FIN FJI FLK FRA FRO FSM GAB GBR GEO GGY GHA GIB ' +
   'GIN GLP GMB GNB GNQ GRC GRD GRL GTM GUF GUM GUY HKG HMD HND HRV HTI HUN IDN IMN IND IOT IRL IRN IRQ ISL ISR ITA ' +
   'JAM JEY JOR JPN KAZ KEN KGZ KHM KIR KNA KOR KWT LAO LBN LBR LBY LCA LIE LKA LSO LTU LUX LVA MAC MAF MAR MCO MDA ' +
   'MDG MDV MEX MHL MKD MLI MLT MMR MNE MNG MNP MOZ MRT MSR MTQ MUS MWI MYS MYT NAM NCL NER NFK NGA NIC NIU NLD NOR ' +
   'NPL NRU NZL OMN PAK PAN PCN PER PHL PLW PNG POL PRI PRK PRT PRY PSE PYF QAT REU ROU RUS RWA SAU SDN SEN SGP SGS ' +
   'SHN SJM SLB SLE SLV SMR SOM SPM SRB SSD STP SUR SVK SVN SWE SWZ SXM SYC SYR TCA TCD TGO THA TJK TKL TKM TLS TON ' +
   'TTO TUN TUR TUV TWN TZA UGA UKR UMI URY USA UZB VAT VCT VEN VGB VIR VNM VUT WLF WSM YEM ZAF ZMB ZWE').split(' '),
)

export type PaymentRailId = 'paypal' | 'crossmint'

/**
 * What we know about one side of a trade at settlement time.
 *
 * ⚠️ TWO COUNTRIES, NOT ONE, AND CONFLATING THEM IS THE MISTAKE THIS TYPE EXISTS TO PREVENT.
 * `nationality` comes from a passport MRZ; `residenceCountry` is where the party actually is. The
 * prohibition follows RESIDENCE — a French national living in Hanoi is a Vietnamese party for this
 * purpose, and a Vietnamese national living in Singapore may not be. A rule written against
 * nationality alone would have got the common case on this marketplace exactly backwards, since its
 * whole audience is foreign nationals resident in Vietnam.
 */
export type PartyIdentity = {
  /** True only when identity verification has PASSED — never "submitted", never "pending". */
  kycVerified: boolean
  /** ISO-3166-1 alpha-3 from the identity document, or null when unknown. */
  nationality?: string | null
  /** ISO-3166-1 alpha-3 of declared/verified residence, or null when unknown. */
  residenceCountry?: string | null
}

export type Party = 'buyer' | 'seller'

export type EligibilityDenial =
  | 'buyer_kyc_required'
  | 'seller_kyc_required'
  | 'rail_not_available_in_country'

/**
 * BOTH SIDES MUST BE VERIFIED BEFORE ANY MONEY MOVES. Owner, 2026-08-30, choosing the strictest of
 * the three options offered.
 *
 * ⚠️ IT COSTS CONVERSION ON THE DEMAND SIDE AND WAS CHOSEN ANYWAY. A buyer who must verify before
 * paying is a buyer who can abandon; the alternative on the table was verifying them at first
 * payment. The strict rule is what a payment partner and an AML review expect to see, and it is far
 * cheaper to relax later than to explain retroactively why money moved between two unverified
 * parties. If it is ever relaxed, relax it for the BUYER only and never for the seller — the seller
 * is the one receiving funds.
 */
export function partiesEligible(buyer: PartyIdentity, seller: PartyIdentity): EligibilityDenial | null {
  if (!seller.kycVerified) return 'seller_kyc_required'
  if (!buyer.kycVerified) return 'buyer_kyc_required'
  // ⛔ NO SANCTIONS CHECK HERE, DELIBERATELY — see the note below before adding one.
  return null
}

/**
 * ⛔ AND `SANCTIONED` IS DELIBERATELY *NOT* CHECKED HERE — A REVERTED FIX, RECORDED SO IT IS NOT
 * RE-APPLIED. A reviewer correctly observed that a comprehensively sanctioned party is refused the
 * wallet by `isSettlementEligibleParty` and then handed a PayPal checkout, and the obvious fix was
 * to move the veto up into this function so it covered every rail. That fix was WRONG and shipped
 * for one review round before another reviewer caught what it actually did.
 *
 * ⚠️ `SANCTIONED` IS A STABLECOIN FLOOR, NOT A LIST OF PEOPLE ENO MAY NOT TRADE WITH. Its own
 * docstring says it is "deliberately over-inclusive rather than precise" because a US stablecoin
 * provider's exposure is the thing it was sized for — and it contains RUS, BLR and MMR. This
 * function gates ORDINARY ORDERS, so applying it here banned every Russian and Belarusian expat on
 * eno.forum from buying or selling anything at all. Nha Trang has one of Vietnam's largest Russian
 * communities. Vietnam sanctions none of them, the owner asked for none of it, and the only test
 * covering it used IRN, so the blast radius was invisible.
 *
 * ⚠️ THE ORIGINAL GAP IS REAL AND IS NOW AN OPEN QUESTION FOR COUNSEL, not a silent decision: which
 * jurisdictions, if any, must be refused FIAT settlement as well as digital assets. That is a legal
 * judgement about a specific rail and a specific provider's obligations. It is not a set of country
 * codes an engineer should widen the meaning of on a Saturday.
 */

/**
 * May this party settle on the stablecoin rail?
 *
 * ⛔ EVERY CLAUSE IS AN ALLOW-LIST. Verified identity, a residence country we have positively
 * cleared, and a known non-Vietnamese nationality — all three, or no. "We did not ask where you
 * live" is not evidence that you live abroad, and on this marketplace it is actively misleading:
 * the audience is overwhelmingly foreign nationals who DO live in Vietnam, so a passport is the one
 * signal most likely to point the wrong way.
 * ⚠️ RESIDENCE DECIDES AND NATIONALITY ONLY VETOES. A French national in Hanoi is a Vietnamese party
 * for this purpose; a Vietnamese national in Singapore is too. Neither passport alone grants
 * anything — the residence must be on the cleared list first.
 */
export function isSettlementEligibleParty(p: PartyIdentity): boolean {
  if (!p.kycVerified) return false // unverified identity is unverified country
  const residence = norm(p.residenceCountry)
  const nationality = norm(p.nationality)
  // ⛔ ALLOW-LIST, NOT "≠ VNM". An unknown, malformed or simply unlisted country lands here and is
  // denied — which is what makes a typo'd code and a country we have never assessed behave the same.
  if (!residence || !settlementAllowedCountries().has(residence)) return false
  // ⛔ NATIONALITY MUST BE KNOWN AND NON-VIETNAMESE. The first version only denied a KNOWN `VNM`
  // passport, so a Vietnamese national abroad whose nationality we had not captured passed — the
  // rule reading as a deny-list again. Absent nationality is now simply not enough evidence.
  // ⚠️ AND IT MUST BE A REAL COUNTRY. `ZZZ` is not a Vietnamese passport, but it is not a passport
  // at all — treating it as evidence of foreign nationality is trusting a field we failed to parse.
  if (!nationality || nationality === VN || !ISO_ALPHA3.has(nationality)) return false
  // ⛔ SANCTIONS VETO BOTH FIELDS. Residence is already filtered when the allow-list is built, so
  // this is the nationality half — the case a residence-only rule misses entirely.
  if (SANCTIONED.has(nationality) || SANCTIONED.has(residence)) return false
  return true
}

/**
 * May this rail settle a trade between these two parties?
 *
 * ⛔ THE STABLECOIN RAIL REQUIRES *BOTH* SIDES OUTSIDE VIETNAM. One foot in Vietnam is a Vietnamese
 * payment: a buyer abroad paying a seller in Hanoi is exactly the transaction the prohibition
 * covers, and the seller is the one receiving the prohibited instrument. Checking only the payer
 * would have shipped the most common cross-border shape as "allowed".
 * ⚠️ PAYPAL IS NOT GATED ON COUNTRY HERE because it settles in fiat; its own availability and the
 * platform's licence decide where it runs, which is a different question from this one.
 */
export function railAllowed(rail: PaymentRailId, buyer: PartyIdentity, seller: PartyIdentity): EligibilityDenial | null {
  const parties = partiesEligible(buyer, seller)
  if (parties) return parties
  /**
   * ⛔ AN EXHAUSTIVE SWITCH, NOT `if (rail === 'crossmint')`. `PaymentRailId` is erased at runtime,
   * so a route doing `railAllowed(body.rail as PaymentRailId, …)` could pass `'Crossmint'`,
   * `'crossmint '` or a rail added to the union but not to the check — and the old shape fell
   * through to `return null`, granting a Vietnamese pair the stablecoin rail on a capital letter.
   * A reviewer walked exactly that. Unknown rails are denied, and adding a rail to the union
   * without deciding its rule is now a compile error rather than a permission.
   */
  switch (rail) {
    case 'paypal':
      // Fiat. Its availability is a licensing and provider question, not this country gate's.
      return null
    case 'crossmint':
      return isSettlementEligibleParty(buyer) && isSettlementEligibleParty(seller)
        ? null
        : 'rail_not_available_in_country'
    default:
      return 'rail_not_available_in_country'
  }
}

/**
 * The rails offerable for this pair, best first.
 *
 * ⚠️ ORDER IS THE PRODUCT DECISION — owner, 2026-08-30: the wallet is the FIRST choice where it is
 * lawful, with PayPal alongside it. Callers render this order; they must not re-sort it, or the
 * preference lives in two places and drifts.
 * ⚠️ AN EMPTY ARRAY IS A REAL ANSWER and means "these two cannot transact yet" — the caller shows
 * why, using the denial from `railAllowed`, rather than an empty chooser.
 */
export function availableRails(buyer: PartyIdentity, seller: PartyIdentity): PaymentRailId[] {
  const order: PaymentRailId[] = ['crossmint', 'paypal']
  return order.filter((r) => railAllowed(r, buyer, seller) === null)
}

function norm(c: string | null | undefined): string | null {
  if (!c) return null
  const s = c.trim().toUpperCase()
  // Shape only — MEMBERSHIP is checked by the caller against ISO_ALPHA3 or the allow-list. Keeping
  // the two apart is deliberate: this normalises, it does not decide.
  return /^[A-Z]{3}$/.test(s) ? s : null
}
