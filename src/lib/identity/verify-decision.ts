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
  /**
   * ⛔ THE REPLACEMENT TRUST ANCHOR WHEN THERE IS NO PROVIDER, AND THE REASON THIS FIELD EXISTS.
   * The note on `provider` above says it: a forged MRZ passes every check digit, so MRZ + expiry +
   * name is not evidence of anything. Dropping VNPT (owner, 2026-08-20: "we skip the ekyc by vnpt
   * and create own checking flow") is EXACTLY the act that produces a caller with no provider — so
   * without this field the decision silently reverts to the weakness qwen caught.
   *
   * A self-built flow substitutes a HUMAN for the provider. Until that human has looked, the
   * honest answer is `pending`, never `verified`.
   *   undefined → no human has looked yet          → pending
   *   'approved' → a reviewer accepted the images   → verified, assurance `manual_review`
   *   'rejected' → a reviewer refused them          → rejected
   */
  humanReview?: 'approved' | 'rejected'
  now?: Date
}

export type TierBDecision = {
  status: 'verified' | 'rejected' | 'pending'
  assurance: AssuranceLevel | null
  limitations: readonly Limitation[]
  /** Machine-readable list of what actually passed — this is the evidence, not prose. */
  checksPassed: string[]
  /**
   * ⚠️ EVERY REASON HERE NEEDS BILINGUAL COPY AND A CTA BEFORE THE VERIFY ROUTE SHIPS. Nothing
   * renders these yet — there is no HTTP route — so three reviewers' "the seller sees a blank
   * reason" finding is not reachable today. It becomes reachable the moment the route lands, and
   * `document_expires_soon` / `document_expiry_unreadable` are precisely the two whose whole point
   * is telling the seller something actionable and different from "expired".
   */
  // ⚠️ `manual_review_rejected` JOINS THE BILINGUAL-COPY DEBT NOTED ABOVE, and it is the one
  // reason whose text cannot be generic: the other seven describe a fact about the document,
  // this one describes a person's judgement, so the seller needs the reviewer's note with it
  // or the message is 'no' with no way to act.
  rejectReason?: 'mrz_invalid' | 'document_expired' | 'document_expiry_unreadable' | 'document_expires_soon' | 'name_mismatch' | 'residence_expired' | 'document_not_authentic' | 'manual_review_rejected'
}

// ── The statutory validity floor for a foreign seller's document ────────────────────────────────
//
// NĐ 248/2026 Điều 18 khoản 1 điểm b requires, for a foreign individual, a passport or equivalent
// document "còn hiệu lực ít nhất 06 tháng kể từ ngày xét duyệt" — valid for at least six months
// from the REVIEW date. Merely-unexpired is not enough, which is what this module checked before.
//
// ⚠️ SIX CALENDAR MONTHS, NOT 180 DAYS. They differ by up to three days depending on which months
// are spanned, and always in the direction of rejecting a document the decree accepts.
//
// ⚠️ CLAMPED TO THE LAST DAY OF THE TARGET MONTH. 31 August + 6 months has no 31 February; naive
// month arithmetic rolls it forward to 3 March, making the threshold LATER and the gate STRICTER
// than the law. Clamping to 28/29 February matches how Vietnamese civil law reckons a period in
// months when the end month is short.
//
// ⚠️ RECKONED IN ICT, NOT UTC. "Ngày xét duyệt" is a Vietnamese calendar day. Using UTC would shift
// the review date back one day for any submission between 00:00 and 07:00 local — a one-day
// leniency on a legal gate, which is the wrong direction to be sloppy in. Vietnam has no DST, so a
// fixed +07:00 is exact rather than an approximation.
const ICT_OFFSET_MS = 7 * 60 * 60_000
export const MIN_DOCUMENT_VALIDITY_MONTHS = 6

/**
 * Strict `YYYY-MM-DD` → UTC-midnight Date. `null` for anything else, INCLUDING a well-formed string
 * naming a day that does not exist (`2027-02-31`), which `new Date` would silently roll to 3 March.
 */
function parseIsoDate(v: string | undefined): Date | null {
  if (!v) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return null
  const d = new Date(`${v}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  // Reject a rolled-over date: 2027-02-31 parses, but comes back as 3 March.
  return d.getUTCDate() === Number(m[3]) && d.getUTCMonth() + 1 === Number(m[2]) ? d : null
}

/**
 * The Vietnamese calendar day of `now`, as a UTC-midnight Date — the same representation
 * `parseIsoDate` produces, so the two are directly comparable.
 */
export function ictToday(now: Date): Date {
  const ict = new Date(now.getTime() + ICT_OFFSET_MS)
  return new Date(Date.UTC(ict.getUTCFullYear(), ict.getUTCMonth(), ict.getUTCDate()))
}

/** The earliest expiry date a foreign seller's document may carry and still be accepted. */
export function minimumValidityDate(now: Date): Date {
  const ict = new Date(now.getTime() + ICT_OFFSET_MS)
  const y = ict.getUTCFullYear()
  const m = ict.getUTCMonth()
  const d = ict.getUTCDate()
  // Day 0 of month (m + N + 1) is the last day of month (m + N). Date.UTC rolls the year over.
  const lastDayOfTarget = new Date(Date.UTC(y, m + MIN_DOCUMENT_VALIDITY_MONTHS + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m + MIN_DOCUMENT_VALIDITY_MONTHS, Math.min(d, lastDayOfTarget)))
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

  // ⚠️ THIS IS THE SELLER'S LEGAL TIER, NOT A SNIFF OF WHICH DOCUMENT THEY UPLOADED — and the name
  // matters, because the old name — `isPassport` — misled all THREE reviewers into the same two
  // false findings: that a Tier A holder presenting a Vietnamese passport would be caught by the
  // foreign-only rules, and that a Tier B holder presenting a non-passport equivalent would escape
  // them. Neither is possible: the value is derived from `tier` alone, so Tier B is subject to the
  // foreign rules whatever document arrives, and Tier A never is. Three independent misreadings of
  // one line is a fact about the name, not about the readers.
  const isTierB = (input.tier ?? 'B') === 'B'

  // 1. The document must have been READ reliably — by verified MRZ check digits, OR by the
  //    provider attesting to it. Either is sufficient; NEITHER is not.
  //    ⚠️ DO NOT REQUIRE `mrzValid` UNCONDITIONALLY FOR A PASSPORT. VNPT's OCR returns parsed
  //    fields, not MRZ lines, so `mrzValid` is honestly false on that path — and an unconditional
  //    check would have rejected EVERY provider-verified passport. (Caught immediately after
  //    de-faking the MRZ struct: removing the lie exposed that the guard was leaning on it.)
  //    ⚠️ A CCCD HAS NO MRZ AT ALL, so requiring one there rejects every Tier A record — the branch
  //    that was missing when both tiers shared a passport-shaped decision (codex).
  const readReliably = input.mrzValid || !!input.provider
  if (isTierB && !readReliably) {
    return { status: 'rejected', assurance: null, limitations: TIER_B_LIMITATIONS, checksPassed: passed, rejectReason: 'mrz_invalid' }
  }
  //    ⚠️ RECORD WHICH ONE ACTUALLY HAPPENED. This line used to push `mrz_checksums` for EVERY
  //    Tier B record that got past the guard — including the provider-attested ones, where no check
  //    digit was verified at all. Since verify-flow.ts:138 passes `mrzValid: false` on the only
  //    live path, that meant every single Tier B record in the compliance log claimed a check that
  //    never ran. `checksPassed` is the evidence we would hand a regulator, so a check named there
  //    must have executed. Found independently by agy and qwen; confirmed by reading the caller.
  //    ⚠️ AND TIER A NEEDS THE EVIDENCE TOO (agy). Keying the fallback on `isTierB` left a
  //    provider-verified CCCD with NEITHER token — the compliance log would carry no machine-
  //    readable statement of how a domestic document was read, which is the one thing the log
  //    exists to answer. The question is "what read it", and that has nothing to do with tier.
  if (input.mrzValid) passed.push('mrz_checksums')
  else if (input.provider) passed.push('provider_attested_read')

  // 2. Document expiry. ⚠️ REQUIRED for a passport, OPTIONAL for a CCCD — Vietnamese ID cards
  //    issued before the current series carry no expiry at all, so demanding one rejects a whole
  //    generation of legitimate holders.
  //    ⚠️ AN UNPARSEABLE DATE MUST NOT SAIL THROUGH — MEASURED, NOT THEORISED. `new Date()` on a
  //    malformed string yields Invalid Date, and EVERY comparison against it is false, so a value
  //    like `2027-02-03T10:00:00+07:00` (which produces a nonsense string once `T00:00:00Z` is
  //    appended) passed both the expiry guard AND the new six-month floor. `documentExpiry` is
  //    typed as an ISO date and `toIsoDate()` in verify-flow only ever emits one, so this is
  //    unreachable from today's single caller — but it fails OPEN, and every fail-open defect this
  //    subsystem has shipped looked exactly this unreachable beforehand. Parse strictly instead.
  //    ⚠️ AND IT IS REPORTED AS UNREADABLE, NOT AS EXPIRED (codex). Calling an unparseable date
  //    "expired" is the same false-but-plausible message the six-month reason exists to avoid: the
  //    seller checks their in-date passport, sees nothing wrong, and resubmits the same scan.
  const expiry = parseIsoDate(input.documentExpiry)
  if (input.documentExpiry && !expiry) {
    return { status: 'rejected', assurance: null, limitations: TIER_B_LIMITATIONS, checksPassed: passed, rejectReason: 'document_expiry_unreadable' }
  }
  //    ⚠️ ABSENT IS "UNREADABLE", NOT "EXPIRED" (codex). A passport with no expiry extracted is
  //    overwhelmingly a bad scan of a valid document, and the old wording sent that seller to check
  //    a date that is plainly fine — the same dead end `document_expires_soon` was added to avoid.
  if (isTierB && !expiry) {
    return { status: 'rejected', assurance: null, limitations: TIER_B_LIMITATIONS, checksPassed: passed, rejectReason: 'document_expiry_unreadable' }
  }
  //    ⚠️ COMPARED AS AN ICT CALENDAR DAY, NOT AS AN INSTANT (agy). `expiry` is UTC midnight while
  //    `now` is a real timestamp, so `expiry <= now` turned true at 07:00 Hanoi on the expiry date
  //    itself — rejecting a seller for seventeen hours of a day their document is still valid. It
  //    was also inconsistent with the six-month floor below, which this diff had already made
  //    ICT-aware: one function, two different notions of "today". A document is valid THROUGH its
  //    expiry date, so expired means strictly before today.
  if (expiry && expiry < ictToday(now)) {
    return { status: 'rejected', assurance: null, limitations: TIER_B_LIMITATIONS, checksPassed: passed, rejectReason: 'document_expired' }
  }
  if (expiry) passed.push('document_unexpired')

  //   ⚠️ AND IT MUST HAVE SIX MONTHS LEFT — NĐ 248/2026 Điều 18 kh.1 đ.b. See minimumValidityDate.
  //   ⚠️ FOREIGN DOCUMENTS ONLY. Điểm a, which governs a domestic individual, imposes NO validity
  //   floor — it asks only for họ tên, ngày sinh and số định danh cá nhân. Applying the six-month
  //   rule to a CCCD would invent a requirement and reject Vietnamese sellers the decree accepts.
  //   ⚠️ A DISTINCT REJECT REASON, NOT `document_expired`. Telling someone holding a valid passport
  //   that it has expired is false, and it is unactionable — they would check the date, see months
  //   remaining, and resubmit the same document. The reason they can act on is "renew it".
  //   `rejected` (not `pending`) is deliberate: no human reviewer can waive a statutory floor, and
  //   `canSelfRetry('rejected')` is true, so the seller returns the moment the new passport lands.
  //   ⚠️ `now` IS THE REVIEW DATE, AND A `pending` RECORD HAS TWO OF THEM (codex). The decree
  //   measures from "ngày xét duyệt" — the day the application is ADJUDICATED. For an auto-decision
  //   those are the same instant, so this is exact. But a record routed to a human is adjudicated
  //   days or weeks later, by which time the floor has moved: a passport with exactly six months
  //   left at submission no longer qualifies at approval. WHOEVER BUILDS THE ADMIN APPROVAL PATH
  //   MUST RE-RUN THIS DECISION AT APPROVAL TIME rather than committing the stored one — otherwise
  //   the manual queue quietly becomes the way to get a non-compliant document approved.
  if (isTierB && expiry) {
    const floor = minimumValidityDate(now)
    if (expiry < floor) {
      return { status: 'rejected', assurance: null, limitations: TIER_B_LIMITATIONS, checksPassed: passed, rejectReason: 'document_expires_soon' }
    }
    passed.push('document_valid_6_months')
  }

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
  //
  //    ⛔ AND A HUMAN VERDICT OUTRANKS THE QUEUE. This used to return `pending` unconditionally,
  //    which made the case UNAPPROVABLE: reviewKycCase calls back in with humanReview:'approved',
  //    got `pending` again because this check runs first, and recorded a REJECTION. So the one
  //    cohort manual review exists for — transliterations, married names, reordered given names —
  //    was the one cohort a reviewer could not clear. Three external reviewers caught it
  //    independently; `review.test.ts` had no mismatched-displayName case, so nothing local did.
  if (!namesCorrespond(input.surname, input.givenNames, input.accountName)) {
    if (!input.humanReview) {
      return { status: 'pending', assurance: null, limitations: TIER_B_LIMITATIONS, checksPassed: passed }
    }
    // ⚠️ ONLY ON AN APPROVAL. The first version pushed this before the branch, so a REJECTED case
    // carried `name_mismatch_accepted_by_reviewer` in its checksPassed — an audit trail recording
    // that the reviewer accepted the very thing they rejected. Caught by external review.
    if (input.humanReview === 'approved') passed.push('name_mismatch_accepted_by_reviewer')
  } else {
    passed.push('name_matches_account')
  }

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
    // ⛔ SAME CARVE-OUT AS THE NAME CHECK, FOR THE SAME REASON: a queued face mismatch that a
    //    reviewer has since adjudicated must be decidable, or approving it records a rejection.
    if (!p.faceIsLive || !p.faceMatches) {
      if (!input.humanReview) {
        return { status: 'pending', assurance: null, limitations: TIER_B_LIMITATIONS, checksPassed: passed }
      }
      if (input.humanReview === 'rejected') {
        return {
          status: 'rejected', assurance: null, limitations: TIER_B_LIMITATIONS,
          checksPassed: passed, rejectReason: 'manual_review_rejected',
        }
      }
      // Approved by a person despite a weak likeness — assurance drops to manual_review and the
      // biometric limitation stays, because no machine bound this face to this document.
      return {
        status: 'verified', assurance: 'manual_review',
        limitations: [...TIER_B_LIMITATIONS, LIMITATION.noBiometricBinding],
        checksPassed: [...passed, 'human_review_approved'],
      }
    }
    passed.push('portrait_matched_holder')
    return {
      status: 'verified',
      assurance: 'document_authenticated',
      limitations: TIER_B_LIMITATIONS, // biometric binding DID happen — that limitation is lifted
      checksPassed: passed,
    }
  }

  // MRZ-only path: internally consistent, but NOTHING HAS ATTESTED THE DOCUMENT IS GENUINE.
  //
  // ⛔ THIS USED TO RETURN `verified` AND MUST NOT. With a provider present that was defensible —
  // the provider is the attestation. With the provider gone it is a mod-10 checksum on digits the
  // forger chose, which is why the `provider` field carries the warning it does. A self-built flow
  // therefore answers `pending` and waits for a human; only that human can lift it.
  if (input.humanReview === 'rejected') {
    return {
      status: 'rejected', assurance: null,
      limitations: [...TIER_B_LIMITATIONS, LIMITATION.noBiometricBinding],
      checksPassed: passed, rejectReason: 'manual_review_rejected',
    }
  }
  if (input.humanReview === 'approved') {
    return {
      status: 'verified',
      // `manual_review`, NOT `document_consistent`: the thing that carried this record over the
      // line was a person looking at it, and the compliance sentence has to say so.
      assurance: 'manual_review',
      limitations: [...TIER_B_LIMITATIONS, LIMITATION.noBiometricBinding],
      checksPassed: [...passed, 'human_review_approved'],
    }
  }
  return {
    status: 'pending',
    assurance: null,
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
