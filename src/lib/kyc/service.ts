import 'server-only'
import { z } from 'zod'
import { db } from '@/lib/db'
import { hmacSubject, identityHashingAvailable, subjectHashEquals } from '@/lib/compliance/subject-hash'
import { recomputeVerification } from '@/lib/compliance/recompute-verification'
import { consumeChallenge } from '@/lib/identity/challenge'
import { ownsKycPath } from './store'
import { decideTierB, parseIsoDate } from '@/lib/identity/verify-decision'
import { parsePassportMrz } from '@/lib/visa/mrz'
import { passportNumberShape } from './passport-number'

// ── SUBMITTING A FOREIGN SELLER'S PASSPORT FOR REVIEW ────────────────────────────────────────────
//
// Decree 248/2026 Art 18.1(b) prescribes exactly this for a foreign seller: passport name, number
// and issuing country, valid for at least six months at review. That makes this path the LEGALLY
// PRESCRIBED method for the expat cohort — unlike the Vietnamese-seller path, where "xác thực điện
// tử" is a defined term reachable only through the national system (Decree 69/2024 Art 3.6).
//
// ⛔ THIS FUNCTION NEVER RETURNS `verified`. It creates a PENDING record. decideTierB stops at
// pending without a provider or a human, and the human is the admin review that comes later — see
// the note on `humanReview` in verify-decision.ts. A submit path that could verify would be a path
// that verifies whoever asks.

export const kycSubmitSchema = z.object({
  /** The challenge code of this capture attempt — its single-use submit token (since 2026-09-04 never shown to be
   *  written or photographed: src/lib/identity/challenge.ts). */
  challengeCode: z.string().min(1).max(32),
  /**
   * ⛔ REQUIRED AND EXPLICIT — NEVER DEFAULTED. `decideTierB` reads `input.tier ?? 'B'`, and both
   * plan reviewers named that fallback as a trap: a client bug that omits the field silently files a
   * Vietnamese CCCD as a passport and applies passport rules (MRZ, six-month validity) to a document
   * that has none. There is no sensible default here, so there is none.
   * 'A' = Vietnamese citizen (CCCD). 'B' = foreign resident (passport).
   */
  tier: z.enum(['A', 'B']),
  /** Two storage paths already uploaded to the private bucket by the documents route. */
  documentPath: z.string().min(1).max(300),
  selfiePath: z.string().min(1).max(300),
  /** MRZ lines from the passport data page, as the camera read them on the client. The web form stopped
   *  asking sellers to type them on 2026-10-21; an older client that still sends typed lines is accepted the
   *  same way, and lines that do not verify fall back to the typed fields below. */
  mrzLine1: z.string().max(60).optional(),
  mrzLine2: z.string().max(60).optional(),
  /** What the seller confirmed or typed. Without a verifying MRZ they ARE the passport's details, and the
   *  reviewer compares them with the photograph before anything is verified. */
  surname: z.string().max(120).optional(),
  givenNames: z.string().max(120).optional(),
  passportNumber: z.string().max(40).optional(),
  nationality: z.string().length(3).optional(),
  documentExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** PDPL consent, captured at the moment of submission. */
  consentVersion: z.string().min(1).max(40),
})

export type KycSubmitInput = z.infer<typeof kycSubmitSchema>

export type KycSubmitResult =
  | { ok: true; verificationId: string; status: 'pending' }
  | { ok: false; code: KycSubmitError }

export type KycSubmitError =
  | 'challenge_missing' | 'challenge_expired' | 'challenge_mismatch'
  /** The typed ID number is not the right shape. ⚠️ DISTINCT FROM `document_unreadable`, which tells
   *  the seller to photograph the card again — useless advice about a field they TYPED. */
  | 'document_number_invalid'
  /** A passport filed with no name, or with no real expiry date to judge — refused before the challenge, like the
   *  number. ⚠️ Not `document_unreadable` ("so we cleared the form") nor `rejected` (the six-month copy): both
   *  describe a spent attempt over two fields the seller can fill in. */
  | 'document_details_missing'
  | 'path_not_owned'
  | 'identity_hashing_unavailable'
  | 'document_unreadable'
  // ⚠️ THE CLAIMED TIER CONTRADICTS THE SUBMISSION — MRZ lines on a tier A (CCCD) claim. A CCCD has
  // no MRZ, so this is either a mis-set tier or a passport being filed under the branch that skips
  // the MRZ requirement. Both diff reviewers found the second one.
  | 'tier_mismatch'
  | 'already_pending'
  | 'duplicate_identity'
  | 'rejected'

/**
 * Fold what the caller gave us into the fields decideTierB needs.
 *
 * ⛔ A PASSPORT NO LONGER NEEDS AN MRZ (owner, 2026-10-21) — this reverses the rule that stood here.
 * It said "if the MRZ cannot be read, the right answer is retake the photo, not tell us the number
 * yourself", and the form backed it by making the seller TYPE both 44-character lines whenever the
 * camera failed: "too much to type and doesnt autofill". Asked to choose, the owner took "our team
 * checks by hand" over "retake until it reads". So a passport whose MRZ did not verify is filed from
 * the typed fields with `mrzValid: false` and method `passport_manual`, decideTierB holds it at
 * `pending`, and the reviewer compares the name and expiry with the photograph. A verifying MRZ still
 * wins wherever it is present, exactly as before.
 */
/** A Vietnamese CCCD is 12 digits (docs/compliance-2026.md:432). Nothing here has ever handled the
 *  9-digit CMND it replaced. Spaces, dots and dashes are how people write it, not part of it. */
export function cccdDigits(raw: string | undefined | null): string | null {
  const digits = (raw ?? '').replace(/[\s.-]/g, '')
  return /^\d{12}$/.test(digits) ? digits : null
}

/** Both MRZ lines present AND verifying — the only state in which they, not the typed fields, decide. */
function mrzVerifies(input: KycSubmitInput): boolean {
  return !!(input.mrzLine1 && input.mrzLine2 && parsePassportMrz(input.mrzLine1, input.mrzLine2).valid)
}

/** What a submission says about its document. `readDisagreement` = the MRZ verified but the seller typed a
 *  different passport number or expiry (2026-10-21) — filed as typed for the reviewer, who re-enters both off
 *  the photo; flagged with the read expiry date, never the read number. */
type DocumentRead = {
  surname: string
  givenNames: string
  documentExpiry?: string
  nationality?: string
  nationalityFromMrz: boolean
  issuingState?: string
  documentNumber?: string
  mrzValid: boolean
  readDisagreement?: { number?: true; expiry?: string }
}

function readDocument(input: KycSubmitInput): DocumentRead | null {
  // ⛔ TIER A HAS NO MRZ, AND REQUIRING ONE MADE EVERY CCCD SUBMISSION IMPOSSIBLE. This function is
  // the ONLY gate in front of the ONLY writer of `identity_verifications`, and it returned `null` for
  // anything without two MRZ lines — so a Vietnamese seller's submission was refused with
  // `document_unreadable` ("we could not read the details — photograph the card again") 100% of the
  // time, however good their photograph was. They then retake and retry into the same certain
  // refusal, spending a single-use consent challenge and one of five daily attempts on each loop.
  // MEASURED 2026-09-04: `identity_verifications` holds ZERO rows in production — no identity
  // submission has ever succeeded — and the tier A branch below `decideTierB` was written, tested and
  // unreachable, sitting underneath a guard that had already killed the request.
  //
  // ⚠️ SINCE 2026-10-21 A PASSPORT WITHOUT A VERIFYING MRZ IS FILED FROM ITS TYPED FIELDS TOO (the
  // docblock above), so both tiers now reach a human with a typed document number; only tier B still
  // prefers a verifying MRZ when one arrives.
  //
  // ⛔ A PASSPORT FILED AS TIER A WITH THE MRZ OMITTED IS STILL NOT CLOSED HERE, and the block at the
  // tier check below says so in as many words: in v1 both tiers are decided by a HUMAN who is shown
  // the document and the claimed tier. That is the control, unchanged by this branch.
  if (input.tier === 'A') {
    // ⚠️ THE NUMBER MUST LOOK LIKE AN ID NUMBER. Without a checksum to lean on (a CCCD has none we
    // can verify), FORMAT is the only machine check available — and accepting any non-empty string
    // files a mistyped phone number as a national ID for a reviewer to catch by eye days later.
    // ⛔ TWELVE DIGITS ONLY. An earlier version of this line also accepted the 9-digit CMND "because
    // holders still carry them" — invented, and contradicted by this repo's own compliance note that
    // "Vietnam's CCCD is 12 digits" (docs/compliance-2026.md:432). Nothing in this codebase has ever
    // handled a CMND. Accepting one would file a certain reviewer rejection as `pending` and spend
    // the seller's daily attempt on it.
    const digits = cccdDigits(input.passportNumber)
    return {
      surname: input.surname ?? '',
      givenNames: input.givenNames ?? '',
      // ⚠️ UNDEFINED IS A LEGITIMATE ANSWER HERE. A CCCD issued to someone over 60 reads
      // "Không thời hạn" — no expiry at all — and the row stores `documentExpiresAt: null` for it.
      // Requiring a date would refuse that entire cohort.
      documentExpiry: input.documentExpiry,
      // ⛔ ALWAYS 'VNM', NEVER THE CLIENT'S CLAIM. A CCCD is issued only to Vietnamese citizens, so
      // storing 'USA' on a `cccd_manual` row would be exactly the false statement in a compliance
      // record that the `method` field above is careful to avoid.
      nationality: 'VNM',
      // A CCCD has no MRZ and therefore no issuing-state field; the branch below fills this.
      issuingState: undefined as string | undefined,
      // ⚠️ FALSE FOR A CCCD FOR THE SAME REASON `mrzValid` IS: there is no strip to read. 'VNM' is
      // a rule about who a CCCD is issued to, not a machine reading, and the shape stays uniform so
      // a caller never has to ask which branch produced the object.
      nationalityFromMrz: false,
      documentNumber: digits ?? undefined,
      // ⚠️ FALSE, AND HONESTLY SO. Nothing machine-checked this card; the reviewer is the check, and
      // the compliance record must not claim otherwise. `decideTierB` returns `pending` for tier A
      // with `mrzValid: false` (measured), which is exactly the state a human then resolves.
      mrzValid: false,
    }
  }

  // ⛔ A VERIFYING MRZ CAN STILL DISAGREE WITH WHAT THE SELLER TYPED (2026-10-21). ICAO gives `G`/`6`, `S`/`8`,
  // `L`/`1` values exactly ten apart, so a misread letter in the NUMBER passes every mod-10 check digit, and
  // two misread expiry digits can cancel; the seller fixes it in the field above, and that correction used to
  // lose to the MRZ silently. Now any disagreement files the TYPED values for a human (`passport_manual`),
  // flagged — and the reviewer re-enters the number and the expiry off the photo before approving (review.ts),
  // so neither a correction nor someone turning an expired 2024 into 2030 is decided by what was typed.
  let readDisagreement: DocumentRead['readDisagreement']
  if (input.mrzLine1 && input.mrzLine2) {
    const mrz = parsePassportMrz(input.mrzLine1, input.mrzLine2)
    const typedAgainstMrz = passportNumberShape(input.passportNumber)
    const readExpiry = mrz.fields.passportExpiryDate?.slice(0, 10)
    const numberDiffers = !!(mrz.valid && typedAgainstMrz && mrz.fields.passportNumber && typedAgainstMrz !== mrz.fields.passportNumber)
    const expiryDiffers = !!(mrz.valid && input.documentExpiry && readExpiry && input.documentExpiry !== readExpiry)
    if (numberDiffers || expiryDiffers) {
      readDisagreement = { ...(numberDiffers ? { number: true as const } : {}), ...(expiryDiffers ? { expiry: readExpiry } : {}) }
    } else if (mrz.valid) {
      const f = mrz.fields
      return {
        surname: f.surname ?? input.surname ?? '',
        givenNames: f.givenNames ?? input.givenNames ?? '',
        // ⚠️ The MRZ carries YYMMDD; the decision layer wants ISO. `passportExpiryDate` is already
        // normalised by the parser — pass it straight through rather than re-deriving the century.
        documentExpiry: f.passportExpiryDate ?? input.documentExpiry,
        nationality: f.nationalityCode ?? input.nationality,
        /**
         * ⛔ WHICH OF THOSE TWO IT WAS, BECAUSE THE PANEL LABELS IT AND THE LABEL WAS LYING. The
         * line above falls back to what the APPLICANT TYPED when the MRZ nationality field is
         * unreadable, and the review panel then announced "MRZ nationality field: DEU" — a
         * machine-read claim no machine made — while the issuing-state cross-check was suppressed
         * for exactly that case, because a value was present (the Opus seat, on the diff,
         * 2026-09-09). A reviewer vouching for a document must be told which of the two they are
         * looking at.
         */
        nationalityFromMrz: !!f.nationalityCode,
        /**
         * ⚠️ A SUGGESTION FOR THE HUMAN, NEVER A VALUE FOR THE COLUMN. When the MRZ's nationality
         * field is unreadable — and it is the one field no check digit protects — the issuing state
         * off line 1 is very nearly always the same country, so it saves the reviewer transcribing
         * three characters they can already see. It is NOT written as the nationality because the
         * documents where the two differ are exactly the ones that matter: a refugee or stateless
         * travel document is issued by a state to someone who is not its national.
         */
        issuingState: f.issuingState,
        documentNumber: f.passportNumber ?? input.passportNumber,
        mrzValid: true,
      }
    }
  }
  // ⛔ THE TYPED PASSPORT (2026-10-21, docblock above): no MRZ, lines that do not verify, or a verified read the
  // seller corrected. The number must look like one (checked again in front of the challenge). ⛔ NO
  // NATIONALITY, WHATEVER THE CLIENT SENDS: nothing read one; the reviewer reads it off the passport at
  // approval, and the digest stays issuer-less (review.ts).
  const typedNumber = passportNumberShape(input.passportNumber)
  if (!typedNumber) return null
  return {
    surname: input.surname ?? '',
    givenNames: input.givenNames ?? '',
    documentExpiry: input.documentExpiry,
    nationality: undefined,
    nationalityFromMrz: false,
    issuingState: undefined,
    documentNumber: typedNumber,
    mrzValid: false,
    readDisagreement,
  }
}

export async function submitKycForReview(
  profileId: string,
  accountName: string,
  input: KycSubmitInput,
  now: Date = new Date(),
): Promise<KycSubmitResult> {
  // 0. ⛔ THE ONE CHECK THAT MUST COME BEFORE THE CHALLENGE IS SPENT. Everything below deliberately
  //    sits behind consumption so that probing it costs the attacker a code — but a seller who drops
  //    a digit from their own CCCD number is not probing anything, and making them pay a single-use
  //    challenge for a typo is how a form becomes unusable. This reads only the caller's OWN input,
  //    so it leaks nothing and gives an attacker no oracle about anyone else.
  //    ⚠️ IT SAVES THE CHALLENGE, NOT THE DAILY ATTEMPT — be precise, because the difference is the
  //    seller's afternoon. The five-a-day limiter is a ROUTE wrapper
  //    (`rateLimit: { bucket: 'identity-submit', limit: 5, window: '1 d' }`) and has already counted
  //    the request before this function runs, so a malformed number still costs one of the five. The
  //    only place that can be prevented is in front of the network call, which is why BOTH clients
  //    check the shape too — this is the backstop for a client that does not.
  //    ⚠️ SERVER-SIDE ON PURPOSE even though the web form now blocks it too — the native client
  //    submits to this same route, and a guard that lives only in one client is not a guard.
  if (input.tier === 'A' && !cccdDigits(input.passportNumber)) {
    return { ok: false, code: 'document_number_invalid' }
  }
  // The same backstop for a passport (2026-10-21): a number that is supplied must be one — or a malformed
  // correction is silently dropped for the MRZ's, where the form refuses it — and with no verifying MRZ a
  // number is required, or the challenge burns on `document_unreadable`, whose copy says to retake the photo.
  if (input.tier === 'B' && (input.passportNumber?.trim() ? !passportNumberShape(input.passportNumber) : !mrzVerifies(input))) {
    return { ok: false, code: 'document_number_invalid' }
  }
  // …and the other two fields a typed passport stands on (2026-10-25). With no name the case died after the
  // challenge on `document_unreadable`; with no expiry, or an impossible one (2027-02-30 passes the schema), on
  // `rejected` — the six-month copy, about a date nobody gave. The web form blocks both; this is the backstop for
  // a client that does not. `readDocument` is pure and reads only the caller's own input, so running it here
  // leaks nothing.
  // ⚠️ A NULL READ IS A MISSING NUMBER TOO: a verifying MRZ whose expiry the seller changed is filed as typed, and
  // with no typed number there is nothing to file (codex, on the diff).
  // ⚠️ THE TYPED DATE ITSELF IS CHECKED, not only the later-of-two decideTierB judges: an impossible typed date
  // earlier than the read one passed that, and `new Date('2025-02-30…')` stores 2 March (codex). The read date is
  // always a real day (mrzDate refuses any other), so this covers the judged one as well.
  const doc = readDocument(input)
  if (input.tier === 'B' && !doc) return { ok: false, code: 'document_number_invalid' }
  if (input.tier === 'B' && doc && (!(doc.surname || doc.givenNames) || !parseIsoDate(doc.documentExpiry))) {
    return { ok: false, code: 'document_details_missing' }
  }
  const judgedExpiry = doc?.readDisagreement?.expiry && doc.documentExpiry
    ? [doc.readDisagreement.expiry, doc.documentExpiry].sort().at(-1)
    : doc?.documentExpiry

  // 1. The challenge, FIRST and always consumed. Doing this before any other check means a probe
  //    of the other branches still costs the attacker their code.
  const challenge = await consumeChallenge(profileId, input.challengeCode, now)
  if (!challenge.ok) {
    return { ok: false, code: challenge.reason === 'no_challenge' ? 'challenge_missing'
      : challenge.reason === 'expired' ? 'challenge_expired' : 'challenge_mismatch' }
  }

  // 2. ⛔ THE TWO PATHS ARE CLIENT INPUT AND MUST BE PROVEN TO BELONG TO THIS SELLER. They arrive
  //    in the request body — the client echoing back what /api/seller/identity/documents returned —
  //    and listKycQueue later mints a SIGNED URL for whatever is recorded here. Without this check a
  //    seller can name any object in the private business-verification bucket (another seller's
  //    licence, another applicant's passport) and have an admin open it on their behalf.
  //
  //    ⚠️ AFTER the challenge, not before: the burn-first rule above exists so that probing any
  //    branch costs the attacker their code, and this is the branch most worth probing.
  if (
    !ownsKycPath(profileId, input.documentPath, 'document') ||
    !ownsKycPath(profileId, input.selfiePath, 'selfie') ||
    // ⛔ AND THEY MUST BE TWO DIFFERENT OBJECTS. The kind check already forces different filenames,
    // so this is belt-and-braces — but it is the invariant that actually matters (one document
    // photo AND one selfie holding it), so it is stated rather than inferred.
    input.documentPath === input.selfiePath
  ) {
    return { ok: false, code: 'path_not_owned' }
  }

  // 3. ⛔ FAIL CLOSED WITHOUT THE PEPPER. subject-hash refuses to emit an unkeyed digest, because a
  //    plain sha256 of a passport number is brute-forceable in seconds — the search space is tiny.
  //    Storing one would be worse than storing nothing.
  //    ⚠️ THIS COMMENT USED TO SAY THE PEPPER WAS SET IN NEITHER STORE, AND A REVIEWER BUILT A
  //    "every submit 503s" finding on it. Measured 2026-08-21: IDENTITY_HASH_PEPPER is present in
  //    BOTH eno-root-env and eno-services-env, so this is the guard, not the live path. A comment
  //    describing an environment is a comment that goes stale — re-measure before trusting it.
  if (!identityHashingAvailable()) return { ok: false, code: 'identity_hashing_unavailable' }

  // `document_unreadable` is the seller-facing "retake the data page" — see readDocument.
  if (!doc || !doc.documentNumber || !(doc.surname || doc.givenNames)) {
    return { ok: false, code: 'document_unreadable' }
  }

  // 4. One case in flight at a time. Without this a seller can queue submissions faster than a
  //    reviewer can clear them, and the queue becomes the attack.
  const existing = await db.identityVerification.findFirst({
    where: { profileId, status: 'pending' }, select: { id: true },
  })
  if (existing) return { ok: false, code: 'already_pending' }

  const subjectHash = hmacSubject(doc.documentNumber, { issuer: doc.nationality })

  // 5. ⛔ SAME HUMAN, SECOND ACCOUNT. The keyed digest exists precisely to catch this without
  //    holding the passport number. Anything already VERIFIED under this subject on another profile
  //    means one person is running two seller identities.
  //    ⚠️ A TYPED PASSPORT (2026-10-21) has no nationality, so its digest is issuer-less, here and for good,
  //    and here it only meets other issuer-less ones. Its real check is at APPROVAL: the reviewer re-types
  //    the number off the photograph, it must match this digest, and it is looked up under every issuer
  //    (review.ts). Not here: a bare number matched across every country before anyone has looked at the
  //    photo let a seller squat a number just by typing it.
  //    A camera-read passport meets the typed ones (filed issuer-less) at ITS approval, not here: it carries
  //    that digest (`anyIssuerHash`) for review.ts to match, because a bare-number match refuses the rare
  //    stranger abroad who shares the number, and that call is made in front of a human or not at all.
  const clash = await db.identityVerification.findFirst({
    where: { subjectHash, status: 'verified', NOT: { profileId } },
    select: { id: true, subjectHash: true },
  })
  if (clash && subjectHashEquals(clash.subjectHash, subjectHash)) return { ok: false, code: 'duplicate_identity' }

  // 6. The objective checks. `humanReview` is deliberately ABSENT: this call can only return
  //    `pending` or `rejected`, never `verified`.
  /**
   * ⛔ THE CLAIMED TIER IS CLIENT INPUT, AND BOTH DIFF REVIEWERS FOUND THE BYPASS IT OPENS: a
   * foreign passport submitted as `tier: 'A'` is judged by the CCCD branch, which skips the
   * passport rules (six-month floor, expiry required) entirely. (It also skipped the MRZ requirement,
   * which tier B itself dropped on 2026-10-21.) There is no honest way to CLASSIFY the document
   * server-side here — we hold two images and no reader — so this closes what can be closed and is
   * explicit about what it cannot.
   *
   * ⚠️ WHAT IT CLOSES: the self-contradicting submission. MRZ lines only exist on a passport, so a
   * tier A claim that carries them is refused rather than quietly accepted with its MRZ ignored.
   *
   * ⛔ WHAT IT DOES NOT CLOSE, STATED PLAINLY: someone submitting a passport as tier A and simply
   * omitting the MRZ. In v1 BOTH tiers are decided by a human who is shown the document AND the
   * claimed tier (`listKycQueue` selects `tier` for exactly this), so the reviewer is the control —
   * `decideTierB` was never the whole check for tier A, and the queue makes the mismatch visible.
   * This is the honest limit of a manual flow; a document classifier or the blocked provider
   * integration is what would make it a machine check. Do not read the tier A branch as an
   * automated assurance it never claimed to be.
   */
  if (input.tier === 'A' && (input.mrzLine1 || input.mrzLine2)) {
    return { ok: false, code: 'tier_mismatch' }
  }

  const decision = decideTierB({
    // ⚠️ THE SUBMITTED TIER, NOT A LITERAL. Passing 'B' unconditionally is what made tier A
    // unreachable: `decideTierB` already branches on this (`const isTierB = (input.tier ?? 'B') === 'B'`),
    // so the decision layer was ready and only the caller was hardcoded.
    tier: input.tier,
    surname: doc.surname, givenNames: doc.givenNames,
    // ⚠️ WHERE THE TYPED EXPIRY DISAGREES WITH THE LINES, NEITHER DATE REFUSES THE CASE HERE (2026-10-21) — the
    // later one is judged, and the reviewer's own reading decides at approval (review.ts). Judging the typed
    // date refused a seller whose slip made a valid passport look expired; judging the read one refused an
    // honest correction of a misread. Either way the form had promised "our team will check it".
    documentExpiry: judgedExpiry,
    mrzValid: doc.mrzValid,
    accountName, now,
  })
  if (decision.status === 'rejected') return { ok: false, code: 'rejected' }

  const row = await db.identityVerification.create({
    data: {
      profileId,
      tier: input.tier,
      // ⚠️ THE METHOD NAMES WHAT WAS ACTUALLY DONE, and for tier A that is not an MRZ read — a CCCD
      // has no machine-readable zone in the passport sense. Recording `passport_mrz` for a national
      // ID card would put a false statement about our own procedure into the compliance record.
      // The same holds for a passport nothing machine-read (2026-10-21): `passport_manual`, and the
      // review panel tells the reviewer what that asks of them.
      method: input.tier === 'A' ? 'cccd_manual' : doc.mrzValid ? 'passport_mrz' : 'passport_manual',
      status: 'pending',
      subjectHash,
      /**
       * ⛔ THE AFFIRMATION THAT AUTHORISED THIS CAPTURE, carried here from the challenge that was
       * burned two steps up. It is NOT rebuilt at this moment: rebuilding would stamp whichever
       * declaration is current NOW, which may not be the wording this person actually read if a new
       * version shipped mid-flow. `null` when the challenge predates the field — absent is not
       * refused, which is what the schema comment on these columns says.
       * From identity-v2 (2026-10-16) it is ALSO the record of a teacher's consent to "Identity
       * verified" on their profile (its clause 5 — src/lib/compliance/declaration-text.ts). Nothing
       * reads it to decide the mark: v1 identities show too (owner) — src/lib/teachers/identity-mark.ts.
       */
      declarationVersion: challenge.declaration?.version ?? null,
      declarationHash: challenge.declaration?.hash ?? null,
      declaredAt: challenge.declaration?.declaredAt ?? null,
      declarationIp: challenge.declaration?.ip ?? null,
      fullName: [doc.givenNames, doc.surname].filter(Boolean).join(' ').trim() || null,
      nationality: doc.nationality ?? null,
      documentType: input.tier === 'A' ? 'cccd' : 'passport',
      documentExpiresAt: doc.documentExpiry ? new Date(`${doc.documentExpiry}T00:00:00+07:00`) : null,
      // ⛔ EVIDENCE, NEVER THE DOCUMENT. The images stay in the private bucket; this column holds
      // only pointers and what the checks concluded, so a database dump is not a passport dump.
      evidence: {
        // ⚠️ RECORDED AS *CLAIMED*, because that is what it is. Nothing server-side classified the
        // document; the applicant chose the tier and a human confirms it. Naming the provenance in
        // the compliance record stops a later reader treating it as a machine determination.
        tierClaimedBy: 'applicant',
        /**
         * ⛔ OFFERED TO THE REVIEWER, NOT TREATED AS THE ANSWER. Present only when the MRZ's own
         * nationality field could not be read — the one field no check digit covers. The admin
         * panel prefills its nationality box from this so a reviewer confirms three characters
         * instead of transcribing them, and `nationality` stays NULL until a human says otherwise.
         */
        ...(doc.nationalityFromMrz || !doc.issuingState ? {} : {
          nationalitySuggested: doc.issuingState,
          nationalitySuggestedFrom: 'mrz_issuing_state',
        }),
        // ⚠️ AND WHETHER THE STORED VALUE IS A MACHINE READING OR A SELF-DECLARATION. Same reason:
        // the reviewer is being asked to vouch, and "the strip said so" and "they typed it" are not
        // the same evidence. Absent on tier A, which has no MRZ at all.
        ...(input.tier === 'A' ? {} : { nationalityFromMrz: !!doc.nationalityFromMrz }),
        // What the camera read where the seller typed something else — shown to the reviewer.
        ...(doc.readDisagreement ? { readDisagreement: doc.readDisagreement } : {}),
        // A camera-read passport's number with no issuer — what its approval matches typed passports on (review.ts).
        ...(input.tier === 'B' && doc.mrzValid ? { anyIssuerHash: hmacSubject(doc.documentNumber, { issuer: '' }) } : {}),
        documentPath: input.documentPath,
        selfiePath: input.selfiePath,
        // ⛔ THE DECISION INPUTS ARE CARRIED, NOT REBUILT. reviewKycCase has to re-run decideTierB
        // at adjudication, and it used to reconstruct these by splitting `fullName` on spaces and
        // re-deriving the expiry from the stored Date. Both were lossy and both were caught by
        // external review: "VAN DER BILT" came back as surname "BILT", and
        // `documentExpiresAt.toISOString()` reads the UTC instant of an ICT midnight, which is the
        // PREVIOUS DAY — so a passport on the six-month boundary lost a day between submit and
        // review. Storing what the decision actually took removes both round-trips.
        decisionInput: {
          surname: doc.surname,
          givenNames: doc.givenNames,
          documentExpiry: doc.documentExpiry ?? null,
          mrzValid: doc.mrzValid,
          accountName,
        },
        consentVersion: input.consentVersion,
        consentAt: now.toISOString(),
        // ⛔ THE SPENT CODE ITSELF — the receipt that this submission went through a challenge issued on the affirmed
        // declaration; evidence rather than a secret, never DISPLAYED, and it binds no image to a moment: since
        // 2026-09-04 the reviewer compares the face with the document, not a code with a photo (871b1a9ba). (Until
        // then it let the reviewer compare the paper in the selfie with THIS submission's code — storing only
        // `challengeSatisfied: true` had meant nobody checked, and a year-old selfie with any string on it passed.)
        challengeCode: challenge.code,
        challengeSatisfied: true,
        checksPassed: decision.checksPassed,
        limitations: decision.limitations,
      },
    },
    select: { id: true },
  })

  // 7. The cache follows the record, never the other way round.
  await recomputeVerification(profileId, now)
  return { ok: true, verificationId: row.id, status: 'pending' }
}
