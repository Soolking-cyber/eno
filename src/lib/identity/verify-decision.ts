import 'server-only'


// ── Tier B decision: what we verified, and what we did NOT ──────────────────────────────────────
//
// OWNER DECISION, 2026-08-03 (recorded here because it is a RISK ACCEPTANCE, not an oversight):
// "there is no worldwide checking base for foreign passports so it's fine to have some legal
// obligation if local law will ask."
//
// That premise is correct. INTERPOL's SLTD (Stolen and Lost Travel Documents) is restricted to law
// enforcement and border authorities; there is no lookup a private marketplace can buy that answers
// "is this passport real and not reported stolen". Verifying a foreign passport to the standard a
// border post applies is not commercially available to us.
//
// ⚠️ SO THE DEFENCE IS THE RECORD, NOT THE CHECK. If a Vietnamese authority asks how eno.vn
// verified a foreign seller, the answer that holds up is "here is precisely what we validated, here
// is the assurance level we recorded, and here is why the stronger check was not available to us"
// — evidenced per-record, at the time. An unrecorded gap reads as negligence; a documented,
// reasoned, consistently-applied standard reads as proportionate compliance. That is the entire
// reason this module writes an explicit `assurance` and a `limitations` list on every decision
// rather than a bare boolean.
//
// ⚠️ DO NOT LET THIS SILENTLY BECOME "VERIFIED" WITH NO QUALIFIER. The temptation, once the flow
// works, is to collapse assurance into a single verified/unverified flag because the UI only shows
// a badge. The qualifier is the compliance artefact. It costs one column and it is the difference
// between an answerable question and an unanswerable one.

/**
 * How strong is the identity evidence behind this record?
 *
 * These are OUR levels, deliberately named so nobody mistakes them for eIDAS/NIST assurance levels.
 */
export type AssuranceLevel =
  /** Tier A: a state-backed eKYC provider affirmed the identity (VNPT → CCCD/VNeID). */
  | 'state_verified'
  /** Tier B + chip: the passport's own signature verified (NFC Passive Authentication). Not built. */
  | 'document_authenticated'
  /** Tier B: MRZ internally consistent, document unexpired, name matches. The realistic ceiling today. */
  | 'document_consistent'
  /** A human reviewed the images and accepted them. Used when automation is unavailable. */
  | 'manual_review'

/** Named so they can be quoted verbatim in an answer to a regulator. */
export const LIMITATION = {
  noStolenDocCheck: 'not_checked_against_stolen_document_registry',
  noIssuerConfirmation: 'issuing_authority_not_contacted',
  noChipAuthentication: 'epassport_chip_signature_not_verified',
  noBiometricBinding: 'holder_not_biometrically_bound_to_document',
} as const

export type Limitation = (typeof LIMITATION)[keyof typeof LIMITATION]

/**
 * ⚠️ EVERY Tier-B RECORD CARRIES THESE, ALWAYS — even a clean pass.
 * They are not failure flags. They are the honest scope of what "verified" means on this platform,
 * frozen at decision time so the answer cannot drift as the product changes around it.
 */
export const TIER_B_LIMITATIONS: readonly Limitation[] = [
  LIMITATION.noStolenDocCheck,
  LIMITATION.noIssuerConfirmation,
  LIMITATION.noChipAuthentication,
]

/**
 * Provider anti-forgery signals. OPTIONAL so the existing MRZ-only path still type-checks — but
 * see the note in decideTierB: absent means the checks did not RUN, which is not the same as
 * passing, and the assurance level records which of the two it was.
 */
export type ProviderSignals = {
  /** card/liveness: photographed from a real document, not a screen or a printout. */
  documentIsReal: boolean
  /** OCR tampering.is_legal — the provider's own validity verdict on the document. */
  legal: boolean
  /** OCR id_fake_warning. */
  fakeWarning: boolean
  /** face/compare msg === MATCH, using VNPT's calibrated threshold (never ours). */
  faceMatches: boolean
  /** face/liveness: a live human, not a photo of the portrait page. */
  faceIsLive: boolean
}

export type TierBInput = {
  /** 'A' = Vietnamese CCCD/VNeID, 'B' = foreign passport. The DECISION differs even though the
   *  provider endpoints do not — see the tier note in decideTierB. */
  tier?: 'A' | 'B'
  /**
   * ⚠️ EXPLICIT FIELDS, NOT A FAKED MRZ STRUCT. An earlier version called
   * `parsePassportMrz('', '')` and then overwrote the result with `valid: true` — which silently
   * turned the check-digit guard below into a no-op while LOOKING like it still ran. codex and agy
   * both caught it. Whatever produced these fields (a real MRZ parse, or VNPT's OCR) states its own
   * validity in `mrzValid`; this module never manufactures it.
   */
  surname: string
  givenNames: string
  /** ISO YYYY-MM-DD. Absent for a CCCD, which has no expiry in the passport sense. */
  documentExpiry?: string
  /** True only when real MRZ check digits passed. FALSE for an OCR-derived Tier A record. */
  mrzValid: boolean
  accountName: string
  /** Residence permit / long-stay visa expiry, entered or read separately from the passport. */
  residenceExpiresAt?: Date | null
  /**
   * ⚠️ THE PROVIDER SIGNALS ARE THE TRUST ANCHOR, AND NOT CONSUMING THEM WAS THE WHOLE GAP.
   * qwen caught that decideTierB() returned `verified` on MRZ checksums + expiry + name alone,
   * while the VNPT client that detects forgery sat unused beside it. Check digits are a mod-10
   * sum — a forged MRZ passes every one of them — so without these the decision was exactly as
   * weak as it was before the client existed.
   */
  provider?: ProviderSignals
  now?: Date
}

export type TierBDecision = {
  status: 'verified' | 'rejected' | 'pending'
  assurance: AssuranceLevel | null
  limitations: readonly Limitation[]
  /** Machine-readable list of what actually passed — this is the evidence, not prose. */
  checksPassed: string[]
  rejectReason?: 'mrz_invalid' | 'document_expired' | 'name_mismatch' | 'residence_expired' | 'document_not_authentic'
}

/** Diacritic- and filler-insensitive fold of ONE token. MRZ is ASCII, so NGUYỄN arrives as NGUYEN. */
export function foldName(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/đ/gi, 'd')                              // NFD does not decompose Vietnamese đ
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase()
}

/** Split a name into folded, non-empty tokens. `<` fillers and punctuation fall away. */
function nameTokens(s: string): string[] {
  return s.split(/[\s<]+/).map(foldName).filter(Boolean)
}

/**
 * Compare an MRZ name against an account name.
 *
 * ⚠️ COMPARE TOKEN SETS, NOT CONCATENATIONS — AND THIS WAS A REAL BUG, CAUGHT BY THE TEST.
 * The MRZ carries SURNAME first ("ERIKSSON" + "ANNA MARIA"); people write their account name
 * given-name first ("Anna Maria Eriksson"). Joining and comparing yields
 * ERIKSSONANNAMARIA ≠ ANNAMARIAERIKSSON, so the naive version routed essentially EVERY Western
 * expat to manual review — turning the human queue into the default path and deleting the point of
 * the automation. Order is not information here; the set of names is.
 *
 * ⚠️ SUBSET, NOT EQUALITY. Middle names are routinely omitted when signing up ("Anna Eriksson"),
 * and issuers differ on whether they appear at all. Requiring an exact set match fails those. The
 * standing posture on this platform is lenient — and a mismatch only routes to a human anyway, so
 * the cost of leniency here is bounded while the cost of strictness is every expat queuing.
 *
 * The surname must appear on both sides regardless: that is the token that actually identifies.
 */
export function namesCorrespond(mrzSurname: string, mrzGiven: string, accountName: string): boolean {
  // ⚠️ SURNAMES ARE OFTEN MULTI-WORD, AND THE CONCATENATED FORM NEVER MATCHES. agy caught this:
  // an MRZ surname of `NGUYEN<DUC` folded to "NGUYENDUC", which is not a token any account name
  // contains, so every compound surname auto-routed to manual review — Vietnamese, Spanish and
  // Portuguese double surnames alike. Check the surname TOKENS individually.
  const surnameTokens = nameTokens(mrzSurname)
  const mrzSet = new Set([...surnameTokens, ...nameTokens(mrzGiven)])
  const acctSet = new Set(nameTokens(accountName))
  if (!surnameTokens.length || !surnameTokens.every((t) => acctSet.has(t))) return false
  const [small, large] = mrzSet.size <= acctSet.size ? [mrzSet, acctSet] : [acctSet, mrzSet]
  return [...small].every((t) => large.has(t))
}

/**
 * Decide a Tier-B verification, server-side.
 *
 * ⚠️ THE ORDER IS DELIBERATE: hard document facts first, then identity correspondence. A name
 * mismatch on an EXPIRED passport should report the expiry — that is the thing the user must fix
 * first, and reporting the mismatch would send them to re-type their name for nothing.
 */
export function decideTierB(input: TierBInput): TierBDecision {
  const now = input.now ?? new Date()
  const passed: string[] = []

  const isPassport = (input.tier ?? 'B') === 'B'

  // 1. The document must have been READ reliably — by verified MRZ check digits, OR by the
  //    provider attesting to it. Either is sufficient; NEITHER is not.
  //    ⚠️ DO NOT REQUIRE `mrzValid` UNCONDITIONALLY FOR A PASSPORT. VNPT's OCR returns parsed
  //    fields, not MRZ lines, so `mrzValid` is honestly false on that path — and an unconditional
  //    check would have rejected EVERY provider-verified passport. (Caught immediately after
  //    de-faking the MRZ struct: removing the lie exposed that the guard was leaning on it.)
  //    ⚠️ A CCCD HAS NO MRZ AT ALL, so requiring one there rejects every Tier A record — the branch
  //    that was missing when both tiers shared a passport-shaped decision (codex).
  const readReliably = input.mrzValid || !!input.provider
  if (isPassport && !readReliably) {
    return { status: 'rejected', assurance: null, limitations: TIER_B_LIMITATIONS, checksPassed: passed, rejectReason: 'mrz_invalid' }
  }
  if (isPassport) passed.push('mrz_checksums')

  // 2. Document expiry. ⚠️ REQUIRED for a passport, OPTIONAL for a CCCD — Vietnamese ID cards
  //    issued before the current series carry no expiry at all, so demanding one rejects a whole
  //    generation of legitimate holders.
  const expiry = input.documentExpiry ? new Date(`${input.documentExpiry}T00:00:00Z`) : null
  if (isPassport && !expiry) {
    return { status: 'rejected', assurance: null, limitations: TIER_B_LIMITATIONS, checksPassed: passed, rejectReason: 'document_expired' }
  }
  if (expiry && expiry <= now) {
    return { status: 'rejected', assurance: null, limitations: TIER_B_LIMITATIONS, checksPassed: passed, rejectReason: 'document_expired' }
  }
  if (expiry) passed.push('document_unexpired')

  // 3. Residence document, when supplied. ⚠️ An EXPIRED residence permit is a rejection at
  //    submission time — distinct from the `expired` STATE, which is what a previously-verified
  //    seller transitions into when their permit lapses later.
  if (input.residenceExpiresAt && input.residenceExpiresAt <= now) {
    return { status: 'rejected', assurance: null, limitations: TIER_B_LIMITATIONS, checksPassed: passed, rejectReason: 'residence_expired' }
  }
  if (input.residenceExpiresAt) passed.push('residence_unexpired')

  // 4. Name correspondence. ⚠️ A MISMATCH IS NOT A REJECTION — it goes to a human. Transliteration
  //    is lossy in both directions, married names differ from passport names, and given-name order
  //    varies by issuer. Auto-rejecting here would fail a large slice of legitimate expats on a
  //    string comparison, and this platform's standing posture is to be lenient and fix false
  //    positives rather than tighten the check.
  if (!namesCorrespond(input.surname, input.givenNames, input.accountName)) {
    return { status: 'pending', assurance: null, limitations: TIER_B_LIMITATIONS, checksPassed: passed }
  }
  passed.push('name_matches_account')

  // 5. Provider anti-forgery. ⚠️ ABSENT ≠ PASSED. When the signals are missing the checks did not
  //    RUN — the provider was unreachable, or this is the MRZ-only path — and that must produce a
  //    WEAKER record, never a silent pass at full assurance. Treating "we could not ask" as "it
  //    answered yes" is the same fail-open shape as the liveness bug in vnpt-client.
  const p = input.provider
  if (p) {
    // A document the provider says is re-captured, tampered or fake is a REJECTION, not a queue:
    // these are affirmative negatives, unlike a name mismatch which is genuinely ambiguous.
    if (!p.documentIsReal || !p.legal || p.fakeWarning) {
      return { status: 'rejected', assurance: null, limitations: TIER_B_LIMITATIONS, checksPassed: passed, rejectReason: 'document_not_authentic' }
    }
    passed.push('document_authenticity_verified')

    // ⚠️ A FACE MISMATCH GOES TO A HUMAN, NOT TO REJECTION. Face comparison against a passport
    // photo that may be a decade old is the single most error-prone step for a legitimate person —
    // ageing, weight, glasses, beards. An affirmative forgery signal is a rejection; a failed
    // likeness is a question.
    if (!p.faceIsLive || !p.faceMatches) {
      return { status: 'pending', assurance: null, limitations: TIER_B_LIMITATIONS, checksPassed: passed }
    }
    passed.push('portrait_matched_holder')
    return {
      status: 'verified',
      assurance: 'document_authenticated',
      limitations: TIER_B_LIMITATIONS, // biometric binding DID happen — that limitation is lifted
      checksPassed: passed,
    }
  }

  // MRZ-only path: internally consistent, but nothing has attested the document is genuine.
  return {
    status: 'verified',
    assurance: 'document_consistent',
    limitations: [...TIER_B_LIMITATIONS, LIMITATION.noBiometricBinding],
    checksPassed: passed,
  }
}

/**
 * The sentence we can put in front of an authority for a Tier-B record.
 *
 * ⚠️ GENERATED FROM THE RECORD, NEVER WRITTEN BY HAND. A hand-written compliance statement is true
 * on the day it is written and unfalsifiable afterwards; this one is derived from the stored
 * decision, so it cannot describe checks that did not run.
 */
export function describeAssurance(d: TierBDecision): string {
  if (d.status !== 'verified') return `Not verified (${d.rejectReason ?? 'pending review'}).`
  return [
    `Identity evidence: ${d.assurance}. Validated: ${d.checksPassed.join(', ')}.`,
    `Not validated: ${d.limitations.join(', ')}.`,
    'No stolen/lost travel document registry is available to private operators (INTERPOL SLTD is',
    'restricted to law enforcement and border authorities), so document authenticity was assessed',
    'to the standard commercially available at the time of verification.',
  ].join(' ')
}
