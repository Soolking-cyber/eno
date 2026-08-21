import 'server-only'
import { z } from 'zod'
import { db } from '@/lib/db'
import { hmacSubject, identityHashingAvailable, subjectHashEquals } from '@/lib/compliance/subject-hash'
import { recomputeVerification } from '@/lib/compliance/recompute-verification'
import { consumeChallenge } from '@/lib/identity/challenge'
import { ownsKycPath } from './store'
import { decideTierB } from '@/lib/identity/verify-decision'
import { parsePassportMrz } from '@/lib/visa/mrz'

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
  /** The code the seller wrote on paper and held in the selfie. */
  challengeCode: z.string().min(1).max(32),
  /** Two storage paths already uploaded to the private bucket by the documents route. */
  documentPath: z.string().min(1).max(300),
  selfiePath: z.string().min(1).max(300),
  /** MRZ lines from the passport data page, as read on the client or retyped by the seller. */
  mrzLine1: z.string().max(60).optional(),
  mrzLine2: z.string().max(60).optional(),
  /** Fallbacks when the MRZ could not be read at all — the reviewer confirms them by eye. */
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
  | 'path_not_owned'
  | 'identity_hashing_unavailable'
  | 'document_unreadable'
  | 'already_pending'
  | 'duplicate_identity'
  | 'rejected'

/**
 * Fold what the caller gave us into the fields decideTierB needs.
 *
 * ⛔ THE MRZ IS REQUIRED FOR A PASSPORT, AND I HAD THIS BACKWARDS AT FIRST. The first version
 * accepted hand-typed fields as a fallback "so a glare band does not bounce an honest seller" —
 * but verify-decision.ts:275 refuses a Tier B record with neither a valid MRZ nor a provider, so
 * that fallback could only ever produce `rejected`, and the reassuring comment described behaviour
 * that did not exist.
 *
 * Requiring it is also the better rule. EVERY ICAO passport has an MRZ; if it cannot be read, the
 * right answer is "retake the photo", not "tell us the number yourself" — a typed number is the
 * seller's claim about their own document, which is exactly what verification is supposed to test.
 * The hand-entered fields survive only as a cross-check the reviewer can compare against.
 */
function readDocument(input: KycSubmitInput) {
  if (input.mrzLine1 && input.mrzLine2) {
    const mrz = parsePassportMrz(input.mrzLine1, input.mrzLine2)
    if (mrz.valid) {
      const f = mrz.fields
      return {
        surname: f.surname ?? input.surname ?? '',
        givenNames: f.givenNames ?? input.givenNames ?? '',
        // ⚠️ The MRZ carries YYMMDD; the decision layer wants ISO. `passportExpiryDate` is already
        // normalised by the parser — pass it straight through rather than re-deriving the century.
        documentExpiry: f.passportExpiryDate ?? input.documentExpiry,
        nationality: f.nationalityCode ?? input.nationality,
        documentNumber: f.passportNumber ?? input.passportNumber,
        mrzValid: true,
      }
    }
  }
  return null
}

export async function submitKycForReview(
  profileId: string,
  accountName: string,
  input: KycSubmitInput,
  now: Date = new Date(),
): Promise<KycSubmitResult> {
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
  const doc = readDocument(input)
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
  const clash = await db.identityVerification.findFirst({
    where: { subjectHash, status: 'verified', NOT: { profileId } },
    select: { id: true, subjectHash: true },
  })
  if (clash && subjectHashEquals(clash.subjectHash, subjectHash)) return { ok: false, code: 'duplicate_identity' }

  // 6. The objective checks. `humanReview` is deliberately ABSENT: this call can only return
  //    `pending` or `rejected`, never `verified`.
  const decision = decideTierB({
    tier: 'B',
    surname: doc.surname, givenNames: doc.givenNames,
    documentExpiry: doc.documentExpiry, mrzValid: doc.mrzValid,
    accountName, now,
  })
  if (decision.status === 'rejected') return { ok: false, code: 'rejected' }

  const row = await db.identityVerification.create({
    data: {
      profileId, tier: 'B',
      method: 'passport_mrz',
      status: 'pending',
      subjectHash,
      fullName: [doc.givenNames, doc.surname].filter(Boolean).join(' ').trim() || null,
      nationality: doc.nationality ?? null,
      documentType: 'passport',
      documentExpiresAt: doc.documentExpiry ? new Date(`${doc.documentExpiry}T00:00:00+07:00`) : null,
      // ⛔ EVIDENCE, NEVER THE DOCUMENT. The images stay in the private bucket; this column holds
      // only pointers and what the checks concluded, so a database dump is not a passport dump.
      evidence: {
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
        // ⛔ THE CODE ITSELF, so the reviewer can compare it to the paper in the photo. Storing
        // only `challengeSatisfied: true` — which is what this used to do — meant nobody ever
        // checked that the handwriting matched THIS submission's code, and a year-old selfie with
        // any string on it passed. Spent at this point, so it is evidence rather than a secret.
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
