import 'server-only'
import { db } from '@/lib/db'
import type { Prisma } from '@/generated/prisma/client'
import { recomputeVerification } from '@/lib/compliance/recompute-verification'
import { decideTierB } from '@/lib/identity/verify-decision'
import { signVerificationDoc, verificationDocExists } from '@/lib/business-verification-store'
import { provisionWithinBudget } from './on-verified'
import { logError } from '@/lib/log'
import { ownsKycPath } from './store'
import { notifyIdentityOutcome } from './notify-outcome'
// ⚠️ THE SAME HELPER THE WALLET GATE USES, deliberately. `isoNationality` carries the ICAO alias
// `D → DEU` and rejects the deliberately-unmapped `XXA`/`XXB`/`XXC`/`XXX` and `GBD`…`GBS`. Accepting
// a code here that on-verified.ts would later refuse would let a reviewer "fix" a case into a state
// that still reads `unmappable_nationality` — a correction that silently does nothing.
import { isoNationality, addressVerifyingSources } from './identity'
// ⚠️ THE RESIDENCE SIDE CHECKS ISO MEMBERSHIP DIRECTLY, on purpose — see the note at its call site.
import { ISO_ALPHA3 } from '@/lib/payments/eligibility'
// ⚠️ THE HASH-CHAINED COMPLIANCE LOG, called INSIDE the correction's own transaction exactly as its
// own header requires — a correction that commits without its audit row is the one a regulator asks
// about. It records THAT fields were corrected, by whom; deliberately not WHAT they were set to.
import { appendAudit } from '@/lib/compliance/audit'

// ── THE HUMAN HALF ──────────────────────────────────────────────────────────────────────────────
//
// A foreign seller's case sits at `pending` until a person looks at it. That person is the trust
// anchor VNPT used to be — see the `humanReview` note in verify-decision.ts — so this module is
// where a case becomes `verified`, and the only place it can.

export type KycQueueItem = {
  id: string
  profileId: string | null
  /**
   * ⚠️ 'A' = Vietnamese CCCD, 'B' = foreign passport. The reviewer must be told WHICH document they
   * are looking at before they judge it: the checks that apply differ (a CCCD has no MRZ and no
   * six-month validity rule), and a queue that showed both without saying which is which would
   * invite a reviewer to reject a perfectly valid ID card for lacking a passport's features.
   */
  tier: string
  fullName: string | null
  nationality: string | null
  /**
   * ⚠️ WHAT THE ISSUING STATE SAID, offered only when the MRZ's own nationality field was
   * unreadable. It prefills the reviewer's box so they confirm three characters rather than
   * transcribe them; it is NOT a nationality and has never been written as one.
   */
  nationalitySuggested: string | null
  /**
   * ⚠️ THREE STATES, AND COERCING THE THIRD TO `false` WOULD HAVE LIBELLED EVERY EXISTING CASE.
   * `true` = the MRZ nationality field itself was read; `false` = it was not, so the column holds
   * what the applicant typed (or, on tier A, the rule that a CCCD implies VNM); `null` = the case
   * was submitted BEFORE this was recorded and nobody knows. The first cut wrote
   * `ev.nationalityFromMrz === true`, which turned every row already in the queue into "declared by
   * the applicant — the MRZ field was unreadable" about nationalities the strip had read perfectly.
   * All three answering seats found it independently (2026-09-09). Absent is unknown, not false.
   */
  nationalityFromMrz: boolean | null
  documentExpiresAt: string | null
  submittedAt: string
  method: string
  /** Short-lived links to the two captures. Minted per request, never stored. */
  documentUrl: string | null
  selfieUrl: string | null
  /**
   * The ACCOUNT's own contact details, so a reviewer can weigh the person in the photograph against
   * the account claiming to be them without leaving the queue. Null once the profile is deleted,
   * which is also when the capture links refuse.
   */
  email: string | null
  phone: string | null
  accountName: string | null
  /** What the seller was told to write on the paper in the selfie. */
  expectedNote: string
  checksPassed: string[]
}

type Evidence = {
  documentPath?: string
  selfiePath?: string
  checksPassed?: string[]
  consentVersion?: string
  consentAt?: string
  /** The code the seller was told to write, as verified at submission. */
  challengeCode?: string
  /** MRZ issuing state, recorded at submission when the nationality field could not be read. */
  nationalitySuggested?: string
  nationalitySuggestedFrom?: string
  nationalityFromMrz?: boolean
  /** Exactly what decideTierB was given at submission — see the note in service.ts. */
  decisionInput?: {
    surname?: string
    givenNames?: string
    documentExpiry?: string | null
    mrzValid?: boolean
    accountName?: string
  }
}

const REVIEW_URL_TTL = 600

/**
 * The queue, oldest first — a seller who has waited longest is served first, and a KYC queue that
 * reorders itself is a queue nobody can be accountable for.
 *
 * ⚠️ THE IMAGE LINKS ARE MINTED HERE AND EXPIRE IN TEN MINUTES. They are never persisted and never
 * returned to anyone but an admin: a passport photo behind a durable URL is a passport photo on the
 * internet as soon as one link leaks.
 */
export async function listKycQueue(limit = 50): Promise<KycQueueItem[]> {
  const rows = await db.identityVerification.findMany({
    /**
     * ⛔ EVERY PENDING TIER, NOT JUST B. This filtered to `tier: 'B'`, which meant a Vietnamese
     * seller's CCCD submission would have been accepted, stored, and then never appeared in front
     * of a reviewer — invisible work, indistinguishable from a lost submission. Owner, 2026-08-31:
     * tier A is manual review in v1, so it belongs in the same queue an admin already works.
     */
    /**
     * ⛔ `profileId: { not: null }` OR THE QUEUE LISTS CASES NOBODY CAN EVER CLEAR. `decideOnce`
     * refuses a row whose profile is gone — that is the erasure guard, and it is right — so an
     * erased-but-pending case listed here would answer every Approve and every Reject with
     * "reload and try again", forever, with nothing to dequeue it (the Opus seat, 2026-09-09).
     * A case whose person has exercised deletion is not a case awaiting a decision: the row is kept
     * as proof a submission happened, and there is nobody left to tell the outcome to.
     */
    where: { status: 'pending', profileId: { not: null } },
    orderBy: { submittedAt: 'asc' },
    take: Math.min(limit, 200),
    select: {
      // ⚠️ `tier` IS SELECTED so the reviewer can see WHICH document they are being shown. An
      // admin deciding a CCCD by eye needs to know it is not a passport before they judge it.
      id: true, profileId: true, tier: true, fullName: true, nationality: true,
      documentExpiresAt: true, submittedAt: true, method: true, evidence: true,
      /**
       * ⚠️ THE ACCOUNT'S OWN CONTACT DETAILS, so the reviewer can tell whether the person in the
       * photograph is plausibly the account holder without leaving the queue. Owner, 2026-09-06:
       * *"show relevant infor like ohone number and email"*.
       *
       * ⚠️ ONLY email AND phone, AND ONLY THROUGH THIS RELATION. Selecting the whole Profile would
       * put every column an admin has no reason to see into the most sensitive payload the app
       * returns; a named pair is auditable at the call site.
       */
      profile: { select: { email: true, phone: true, displayName: true } },
    },
  })
  return Promise.all(rows.map(async (r) => {
    const ev = (r.evidence ?? {}) as Evidence
    return {
      id: r.id,
      tier: r.tier,
      profileId: r.profileId,
      fullName: r.fullName,
      nationality: r.nationality,
      nationalitySuggested: ev.nationalitySuggested ?? null,
      nationalityFromMrz: typeof ev.nationalityFromMrz === 'boolean' ? ev.nationalityFromMrz : null,
      // Null when the profile has been deleted (profileId is SetNull), which is also when the
      // signed links below refuse — a case with no account behind it can no longer be judged.
      email: r.profile?.email ?? null,
      phone: r.profile?.phone ?? null,
      accountName: r.profile?.displayName ?? null,
      documentExpiresAt: r.documentExpiresAt?.toISOString() ?? null,
      submittedAt: r.submittedAt.toISOString(),
      method: r.method,
      // ⛔ OWNERSHIP IS PROVEN AGAIN HERE, NOT TRUSTED FROM THE ROW. The submit path checks it, so
      // this is redundant today — and it is the redundancy that matters: this is the ONLY function
      // that turns a stored string into a readable link to a passport photo, so it must be safe
      // against a row it did not write. An external reviewer refuted the first version on exactly
      // this: any row predating the submit-side guard, or written by some future path that forgets
      // it, gets signed and shown to an admin. (Measured 2026-08-21: the table holds ZERO rows, so
      // no such row exists — this closes the class, not an incident.)
      //
      // ⚠️ A NULL profileId FAILS THE CHECK, WHICH IS THE RIGHT ANSWER. profileId is SetNull on
      // account deletion, and a deleted person's passport photo is the last thing that should
      // resolve to a link.
      documentUrl: await signOwned(r.profileId, ev.documentPath),
      selfieUrl: await signOwned(r.profileId, ev.selfiePath),
      // ⛔ THE ACTUAL CODE, AND THIS IS THE WHOLE FRESHNESS MECHANISM. It used to read "A
      // handwritten code, written for this submission" — which asked the reviewer to confirm that
      // SOME handwriting existed, not that it matched. External review pointed out the obvious
      // consequence: a selfie from last year holding any string passes, because the code in the
      // JSON and the code in the photo were never compared by anyone. The reviewer must read these
      // six characters off the paper. If they do not match, the photo predates the request.
      expectedNote: ev.challengeCode ?? '(none recorded — reject and ask for a new submission)',
      checksPassed: ev.checksPassed ?? [],
    }
  }))
}

/**
 * A stored ICT midnight back to the calendar date it represents.
 *
 * ⛔ NOT `toISOString().slice(0, 10)`. `new Date('2030-12-31T00:00:00+07:00').toISOString()` is
 * `2030-12-30T17:00:00.000Z` — the day BEFORE. Measured, not reasoned: an external reviewer flagged
 * it and the arithmetic confirms it. On a six-month validity floor that silently costs a day.
 */
function ictDate(d: Date | null): string | undefined {
  if (!d) return undefined
  return new Date(d.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * Write a decision ONLY while the case is still pending. Returns false if someone got there first.
 *
 * ⛔ THE `status: 'pending'` IN THE WHERE CLAUSE IS THE WHOLE POINT, AND THE FIRST VERSION LACKED
 * IT. The early `row.status !== 'pending'` read is a check-then-act: two admins opening the same
 * case both read `pending`, both pass, and both write. With the duplicate-passport check that is
 * worse than a double-decide — two cases holding the SAME passport both clear the clash query
 * (neither is verified yet) and both get verified, which is exactly what that check exists to
 * prevent. Postgres settles it here instead: the second updateMany matches zero rows.
 */
async function decideOnce(id: string, data: Prisma.IdentityVerificationUpdateInput): Promise<boolean> {
  /**
   * ⛔ `profileId: { not: null }` IS AN ERASURE GUARD, NOT A TIDINESS CHECK — AND IT IS THE SAME
   * RACE `correctVerifiedIdentity` SPENDS A SERIALIZABLE TRANSACTION ON. The caller reads the row's
   * `evidence`, decides, and writes a merged blob back here; `account-erasure.ts` rewrites exactly
   * that blob and nulls the identity columns WITHOUT touching `status`, so an erasure landing
   * between that read and this write still matched `status: 'pending'` — and the decision put the
   * document paths, the decision inputs and now a reviewer-asserted nationality back onto a record
   * a deletion request had just emptied. The Opus seat found the correction path hardened while its
   * twin was not (2026-09-09).
   *
   * ⚠️ ERASURE DELETES THE PROFILE IN THE SAME TRANSACTION, and the FK is `onDelete: SetNull`, so an
   * erased row's `profileId` is null the instant that commits. Pinning it non-null makes the row
   * unmatchable here — zero rows, `not_pending`, no write — which is the right answer either way: a
   * case whose person is gone is not a case anyone should be deciding.
   */
  const { count } = await db.identityVerification.updateMany({
    where: { id, status: 'pending', profileId: { not: null } },
    data: data as Prisma.IdentityVerificationUpdateManyMutationInput,
  })
  return count === 1
}

/**
 * CORRECT THE IDENTITY FIELDS ON AN ALREADY-VERIFIED RECORD, WITHOUT RE-DECIDING IT.
 *
 * ⛔ THIS IS NOT A SECOND APPROVE PATH AND MUST NEVER BECOME ONE. `decideOnce` guards on
 * `status: 'pending'` precisely so a settled case cannot be re-decided, and that guard stays exactly
 * as it is. What this does is narrower and genuinely different: a record whose DECISION was right
 * can still carry a field that was never readable — measured 2026-09-09, the only verified identity
 * in production had `nationality` NULL because the MRZ field it comes from is the one field no check
 * digit covers (mrz.ts:74 steps over it). The person is verified; three characters are missing. With
 * only the pending-guarded path, that record was uncorrectable forever and its owner's wallet was
 * permanently shut with "contact support" — support having no way to act either.
 *
 * ⛔ SO IT IS GUARDED ON `status: 'verified'`, WHICH IS THE MIRROR OF THAT DISCIPLINE, NOT A HOLE.
 * A pending row must go through review; a rejected row is not a compliance record of anyone's
 * details. Only a verified row is a standing statement of fact that can be wrong in a way worth
 * fixing. The status is never written here, so this cannot verify, un-verify or re-decide anything.
 *
 * ⚠️ RESIDENCE CARRIES ITS PROVENANCE OR IT IS NOT WRITTEN. `residenceSource` is what decides
 * whether a country counts (identity.ts), and writing the country without it would leave a value
 * that looks authoritative and is ignored — the worst of both. `admin_document_review` is INERT by
 * default: it opens nothing until `PAYMENTS_ADDRESS_SOURCES` names it, which is counsel's call.
 */
export async function correctVerifiedIdentity(input: {
  verificationId: string
  admin: string
  /** ISO/ICAO alpha-3, or `''` to clear. Omitted leaves it alone — the same three states as review. */
  nationality?: string
  /** ISO alpha-3 residence, or `''` to clear. Written with `admin_document_review` provenance. */
  residenceCountry?: string
  /** Why — recorded, because a correction to a compliance record without a reason is not one. */
  note: string
  now?: Date
}): Promise<{ ok: true; changed: boolean } | { ok: false; code: 'not_found' | 'not_verified' | 'nationality_invalid' | 'residence_invalid' | 'residence_provider_owned' | 'note_required' | 'conflict' }> {
  const now = input.now ?? new Date()
  const note = (input.note || '').trim()
  if (!note) return { ok: false, code: 'note_required' }

  /**
   * ⛔ THE READ AND THE WRITE ARE ONE SERIALIZABLE TRANSACTION, BECAUSE PINNING COLUMNS COULD NOT
   * CLOSE THIS AND THREE ROUNDS OF TRYING PROVED IT.
   *
   * `evidence` is a single JSON blob. This function reads it, spreads its own audit keys over it and
   * writes the result — so ANY concurrent rewrite of that blob is silently reverted by the write,
   * whatever the WHERE says about the other columns. `account-erasure.ts:120` rewrites exactly that
   * blob to a kept subset AND nulls `fullName`, `nationality`, `residenceCountry` and
   * `residenceSource`, all WITHOUT touching `status` — so an erasure racing a correction would end
   * with the erased identity data written back. That is a deletion request being undone, which is
   * the most serious thing in this file.
   *
   * Two earlier attempts pinned more columns in the WHERE (status; then the three identity columns;
   * then `fullName` as well). codex refuted each in turn, and the third refutation is the one that
   * ends the approach: every pinned column is NULLABLE, so a verified row whose name, nationality
   * and residence are ALREADY null — which is the exact shape of production's one verified record —
   * matches its own pins before and after an erasure, because erasure changes nothing but
   * `evidence`. No amount of further pinning fixes that; the column set is exhausted.
   *
   * ⛔ SO THE FIX IS TO STOP WRITING A BLOB THAT WAS READ OUTSIDE THE WRITE'S TRANSACTION. Prisma
   * cannot merge JSON server-side (`evidence` is written whole), so the merge has to be made atomic
   * instead: under SERIALIZABLE, Postgres aborts one of two transactions that touch the same row
   * with `40001` rather than letting the later write clobber the earlier — the correction fails
   * loudly as `conflict` and the erasure stands. An admin retrying then reads the erased row and is
   * refused by the status/pin guard, which is the correct answer.
   *
   * ⚠️ THE COLUMN PINS STAY TOO. They are free, they settle two admins correcting the same record
   * without paying a transaction abort, and a defence that rests on one mechanism is not a defence.
   */
  try {
    const out = await db.$transaction(async (t) => {
      const row = await t.identityVerification.findUnique({
        where: { id: input.verificationId },
        select: { id: true, profileId: true, status: true, fullName: true, nationality: true, residenceCountry: true, residenceSource: true, evidence: true },
      })
      if (!row) return { ok: false as const, code: 'not_found' as const }
      if (row.status !== 'verified') return { ok: false as const, code: 'not_verified' as const }
      /**
       * ⛔ AN ALREADY-ERASED RECORD IS NOT CORRECTABLE, AND THIS IS THE OTHER SIDE OF THE SAME RACE.
       * The transaction below stops an erasure that lands DURING a correction; this stops one that
       * landed BEFORE it. Erasure deletes the Profile and `onDelete: SetNull` leaves the
       * verification with `profileId: null` — the row is kept only as proof that a verification
       * happened, deliberately stripped of the person (account-erasure.ts, compliance §4.2). Writing
       * a nationality onto it would put personal data back on a record a deletion request emptied.
       * `not_found` rather than a distinct code: to anyone allowed to ask, that record is gone.
       */
      if (row.profileId === null) return { ok: false as const, code: 'not_found' as const }

      const data: Prisma.IdentityVerificationUpdateInput = {}
      const audit: Record<string, unknown> = {}

      if (input.nationality !== undefined) {
        if (input.nationality === '') {
          if (row.nationality !== null) { data.nationality = null; audit.nationalityAfter = null }
        } else {
          const iso = isoNationality(input.nationality)
          if (!iso) return { ok: false as const, code: 'nationality_invalid' as const }
          if (iso !== row.nationality) { data.nationality = iso; audit.nationalityAfter = iso }
        }
        if ('nationalityAfter' in audit) audit.nationalityBefore = row.nationality
      }

      if (input.residenceCountry !== undefined) {
        if (input.residenceCountry === '') {
          /**
           * ⛔ CLEARING CANNOT BE THE BACK DOOR THROUGH THE NO-DOWNGRADE RULE. The branch below
           * refuses to restamp a `provider_kyc` residence — and then this one nulled it outright on
           * one keystroke, since the panel advertises "empty a box to clear that field". Clear, then
           * retype the same code, and a gate-honoured provenance has become an inert one with no
           * confirmation and no undo (the Opus seat, 2026-09-09). A residence the payment provider
           * established is theirs to change; an admin who believes it is wrong needs the provider's
           * KYC to say so, not a text box.
           */
          if (addressVerifyingSources().has((row.residenceSource ?? '').trim().toLowerCase())) {
            return { ok: false as const, code: 'residence_provider_owned' as const }
          }
          // ⛔ EITHER BEING SET IS ENOUGH TO CLEAR BOTH. Keying this on the COUNTRY alone left a row
          // holding `residenceCountry: null` with a live `residenceSource` untouched — the exact
          // inconsistent state the pairing exists to prevent, surviving the operation meant to fix
          // it (codex, 2026-09-09).
          if (row.residenceCountry !== null || row.residenceSource !== null) {
            data.residenceCountry = null
            data.residenceSource = null
            audit.residenceAfter = null
          }
        } else {
          /**
           * ⚠️ ISO MEMBERSHIP DIRECTLY, NOT `isoNationality` — identity.ts records why: that helper
           * carries the MRZ alias `D → DEU`, which belongs to a passport nationality field. A
           * residence is not read off an MRZ and accepting `D` here would honour a code the contract
           * says is not one. Kept consistent with the READ side deliberately.
           */
          const c = input.residenceCountry.trim().toUpperCase()
          if (!ISO_ALPHA3.has(c)) return { ok: false as const, code: 'residence_invalid' as const }
          /**
           * ⛔ AN UNCHANGED COUNTRY NEVER RESTAMPS THE SOURCE, AND THE FIRST CUT GOT THIS BACKWARDS.
           * It wrote the source whenever it was not already `admin_document_review` — so
           * re-submitting the SAME country demoted a `provider_kyc` provenance, and `provider_kyc`
           * is the one source `PAYMENTS_ADDRESS_SOURCES` honours by default. A correction that
           * changed nothing closed the settlement rail the record already had. All three reviewer
           * seats found it independently on the finished diff (2026-09-09).
           *
           * ⚠️ THE ONE EXCEPTION IS A COUNTRY WITH NO SOURCE AT ALL — an inconsistent row that the
           * gate ignores anyway, so stamping it is a strict improvement rather than a downgrade.
           * A human read a document either way; what is refused is REPLACING a stronger claim with
           * a weaker one on the strength of a keystroke that changed nothing.
           */
          /**
           * ⚠️ THE RULE IS "NEVER DOWNGRADE", NOT "NEVER RESTAMP". Keying the skip on
           * `residenceSource === null` also froze a source that is merely UNTRUSTED — a row whose
           * provenance the gate does not honour could not be re-attested by an admin re-entering
           * the same country, so the correction reported success and changed nothing (codex, on the
           * second diff, 2026-09-09). What must be protected is a source the gate DOES honour;
           * anything else is a strict improvement to overwrite.
           */
          const sourceNow = (row.residenceSource ?? '').trim().toLowerCase()
          const write =
            c !== row.residenceCountry
              // ⚠️ ALREADY OURS AND UNCHANGED — a save that would write the same country with the
              // same source is a no-op, and treating it as a write appended a corrections entry, a
              // compliance-audit row and a provider round-trip for nothing. With
              // PAYMENTS_ADDRESS_SOURCES unset, `admin_document_review` is not in the verifying set,
              // so the trust test below said "upgrade this" about a value it had itself just
              // written (the Opus seat, on the third diff, 2026-09-09).
              ? true
              : sourceNow === 'admin_document_review'
                ? false
                // Never downgrade a source the gate honours; do replace one it does not.
                : !addressVerifyingSources().has(sourceNow)
          if (write) {
            data.residenceCountry = c
            data.residenceSource = 'admin_document_review'
            audit.residenceAfter = c
          }
        }
        if ('residenceAfter' in audit) {
          audit.residenceBefore = row.residenceCountry
          audit.residenceSourceBefore = row.residenceSource
        }
      }

      /**
       * ⚠️ `changed: false` IS NOT `ok: false` — AND THE PANEL MUST BE ABLE TO TELL THEM APART.
       * Nothing needed writing (the values already match, or a stronger residence provenance was
       * protected), which is a legitimate success — but toasting "Corrected." for it left an admin
       * looking at identical values with no audit row, unable to distinguish a save from a no-op:
       * the very confusion the throw path is careful to avoid (the Opus seat, 2026-09-09).
       */
      if (Object.keys(data).length === 0) return { ok: true as const, changed: false }

      /**
       * ⚠️ THE PINS ARE THE CHEAP HALF OF THE GUARD — the transaction above is the half that
       * actually holds. Zero matched rows here means the record stopped being the one that was read
       * a few statements ago (decided away, erased, or corrected by another admin), and the count is
       * the only way to learn that: ignoring it reported "Corrected." for a write that never
       * happened, and an admin who reloads to find the old value is worse off than one told no.
       */
      const { count } = await t.identityVerification.updateMany({
        where: {
          id: row.id,
          status: 'verified',
          profileId: row.profileId,
          fullName: row.fullName,
          nationality: row.nationality,
          residenceCountry: row.residenceCountry,
          residenceSource: row.residenceSource,
        },
        data: {
          ...data,
          /**
           * ⛔ CORRECTIONS APPEND TO A LIST; THEY DO NOT OVERWRITE FLAT KEYS. The first cut spread
           * `nationalityBefore`/`nationalityAfter`/`correctedBy`/`correctedAt`/`correctionNote`
           * straight onto the evidence, so a SECOND correction erased the first — and worse, it
           * collided with the `nationality*` keys the APPROVE path writes (`withNationality`),
           * destroying the record of what the reviewer originally read off the document. codex and
           * the Opus seat both named it on the finished diff (2026-09-09). An audit trail that
           * keeps only the latest entry is not one.
           *
           * ⚠️ CAPPED AT 20, OLDEST DROPPED. `evidence` is a JSON column written whole on every
           * correction, so an uncapped list is an unbounded row — and twenty corrections to one
           * identity is already far past the point where the question is the process, not the log.
           */
          evidence: {
            ...((row.evidence ?? {}) as Prisma.InputJsonObject),
            corrections: [
              ...priorCorrections(row.evidence),
              { ...audit, by: input.admin, at: now.toISOString(), note: note.slice(0, 500) },
            ].slice(-20),
          },
        } as Prisma.IdentityVerificationUpdateManyMutationInput,
      })
      /**
       * ⚠️ `conflict`, NOT `not_verified` — the status was checked a few statements ago inside this
       * same snapshot, so a zero here is never "it was not verified"; it is "the row stopped being
       * the one that was read". Under SERIALIZABLE a committed change raises 40001 instead, which
       * makes this nearly unreachable — but it must not tell an admin to go and look at the review
       * queue when what actually happened was a race. The Opus seat caught the wrong message.
       */
      if (count !== 1) return { ok: false as const, code: 'conflict' as const }

      /**
       * ⛔ THE DURABLE RECORD IS THE HASH CHAIN; THE `corrections` ARRAY IS A CONVENIENCE VIEW.
       * codex objected that `.slice(-20)` eventually drops the oldest entry, which is true and is
       * why the log that MATTERS is not on the row at all: complianceAudit is append-only (UPDATE
       * and DELETE are blocked by RULEs), hash-chained, uncapped and 3-year retained, and its own
       * header requires the append to share the transaction with the act it records — which this
       * one does.
       *
       * ⛔ THE DETAIL NAMES THE FIELDS AND NEVER THEIR VALUES, AND THAT IS A PRIVACY DECISION, NOT
       * AN OVERSIGHT. This chain cannot be edited or deleted by design, so anything written here
       * outlives an erasure request — putting a nationality or a free-text note in it would make
       * the compliance log the one place a deletion cannot reach. Who, when, which fields, and the
       * verification id is the whole defensible set; the values live on the row, where erasure
       * can and now does strip them.
       */
      await appendAudit(t, {
        actorType: 'admin',
        actorId: input.admin,
        action: 'identity.corrected',
        subjectType: 'profile',
        subjectId: row.profileId,
        detail: { verificationId: row.id, fields: Object.keys(data).sort() },
      })
      return { ok: true as const, changed: true, provisionFor: row.profileId }
    }, { isolationLevel: 'Serializable' })
    if (out.ok && 'provisionFor' in out && out.provisionFor) await reprovisionAfterCorrection(out.provisionFor)
    return out.ok ? { ok: true, changed: out.changed } : out
  } catch (e) {
    /**
     * ⛔ A SERIALIZATION ABORT IS THE GUARD FIRING, NOT A CRASH — REPORT IT, DO NOT SWALLOW IT.
     * Postgres raises `40001` (Prisma `P2034`) when this transaction and another touched the row;
     * the write did NOT happen, so `conflict` is the truthful answer and a retry is the admin's
     * call. Mapping it to `ok: true` would restore the exact lie the count check exists to prevent.
     * Anything else rethrows: an unknown failure must not be reported as a tidy refusal.
     */
    if (isWriteConflict(e)) return { ok: false, code: 'conflict' }
    throw e
  }
}

/**
 * ⛔ A CORRECTION THAT DOES NOT RE-DRIVE PROVISIONING HAS NOT FINISHED THE JOB IT EXISTS FOR.
 * `reviewKycCase` follows its write with `provisionWithinBudget` for exactly this reason; this path
 * was written to unblock a wallet that never opened, and returning `ok` without retrying the step
 * that was skipped would report "Corrected." while the wallet stayed shut. Two reviewer seats named
 * it on the finished diff (2026-09-09). The user's own `/api/wallet` POST re-drives it too, but
 * only when they go and look — which is not something a correction should depend on.
 *
 * ⚠️ BEST-EFFORT, EXACTLY AS AT APPROVAL. `provisionWithinBudget` is idempotent, bounded, and
 * promises never to throw; it is caught anyway (a reviewer's point at the approve site) because a
 * provider outage must not turn a committed correction into a reported failure.
 *
 * ⚠️ OUTSIDE THE TRANSACTION, DELIBERATELY. It reaches a third party over the network; holding a
 * SERIALIZABLE transaction open across that call would burn the 5s budget and widen the abort
 * window for no gain — the write is already durable by then.
 */
async function reprovisionAfterCorrection(profileId: string): Promise<void> {
  try {
    await provisionWithinBudget(profileId)
  } catch (e) {
    logError(e, { event: 'kyc.correct.provision_failed', profileId })
  }
}

/**
 * The correction log already on a record, defensively.
 *
 * ⚠️ `evidence` IS UNTYPED JSON THAT PREDATES THIS FIELD. Most rows have no `corrections` key at
 * all, and one could hold anything a past shape wrote there — so a non-array is treated as absent
 * rather than spread, which would throw and fail an unrelated correction.
 */
function priorCorrections(evidence: unknown): unknown[] {
  const v = (evidence as { corrections?: unknown } | null)?.corrections
  return Array.isArray(v) ? v : []
}

/**
 * Is this the "another transaction got there first" error, in every shape it can arrive in?
 *
 * ⚠️ IT WEARS AT LEAST THREE FACES AND MATCHING ONE OF THEM IS HOW THIS BECOMES A 500. Prisma
 * reports it as `P2034`; the raw driver reports SQLSTATE `40001`; and under the pg driver adapter a
 * driver error is frequently WRAPPED — `PrismaClientUnknownRequestError` with the real error under
 * `.cause`, where a top-level `.code` read finds nothing (antigravity named this one on the diff,
 * 2026-09-09). So the cause chain is walked, not just the outermost object.
 *
 * ⚠️ NO `instanceof` AGAINST THE GENERATED CLIENT. That is exactly the sort of identity check that
 * quietly stops holding after a `prisma generate` or a duplicated module instance, and a guard that
 * fails open here reports a race as a crash.
 *
 * ⚠️ THE CHAIN IS DEPTH-BOUNDED because `cause` can be cyclic; six links is far past any real
 * wrapping and cannot spin.
 */
function isWriteConflict(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 6; depth++) {
    const o = cur as { code?: unknown; message?: unknown; cause?: unknown }
    if (o.code === 'P2034' || o.code === '40001') return true
    if (typeof o.message === 'string' && /could not serialize|deadlock detected|write conflict/i.test(o.message)) return true
    cur = o.cause
  }
  return false
}

/** Sign a stored path only if it really belongs to the profile on the case. */
async function signOwned(profileId: string | null, path: string | undefined): Promise<string | null> {
  if (!path || !profileId || !ownsKycPath(profileId, path)) return null
  return signVerificationDoc(path, REVIEW_URL_TTL)
}

/**
 * RE-MINT THE TWO SIGNED LINKS FOR ONE CASE. `REVIEW_URL_TTL` is 600 seconds and a reviewer works a
 * queue for longer than ten minutes, so an expired capture is the NORMAL end state of a long
 * session, not an error — and before this existed the only recovery the panel could offer was
 * "reload the page", which throws away every rejection note typed into the other panels.
 *
 * ⛔ IT SIGNS BY CASE ID AND RE-PROVES OWNERSHIP, exactly like `listKycQueue`. It deliberately does
 * NOT take a path from the caller: an action that signs an arbitrary storage path on an admin's
 * behalf is a read primitive for the whole bucket, and this file's whole discipline is that
 * `signOwned` is the only door. A missing case, a deleted profile or a foreign path all return
 * nulls, which the panel already renders as "cannot judge this case".
 */
export async function resignKycCaptures(verificationId: string): Promise<{ documentUrl: string | null; selfieUrl: string | null }> {
  // ⚠️ `status: 'pending'` MIRRORS listKycQueue's OWN FILTER. Without it this mints links for any
  // verification id an admin can name — approved, rejected, or one whose retention window has
  // closed — which is strictly more than the screen it serves can already see. Widening a signing
  // primitive past its caller is how a helper becomes a bucket reader.
  const row = await db.identityVerification.findFirst({
    where: { id: verificationId, status: 'pending' },
    select: { profileId: true, evidence: true },
  })
  if (!row) return { documentUrl: null, selfieUrl: null }
  const ev = (row.evidence ?? {}) as Evidence
  return {
    documentUrl: await signOwned(row.profileId, ev.documentPath),
    selfieUrl: await signOwned(row.profileId, ev.selfiePath),
  }
}

export type ReviewDecision = 'approve' | 'reject'
export type ReviewResult =
  | { ok: true; status: 'verified' | 'rejected' }
  | { ok: false; code: 'not_found' | 'not_pending' | 'expired_at_review' | 'duplicate_identity' | 'still_pending' | 'evidence_unavailable' | 'nationality_invalid' | 'failed' }

/**
 * Approve or reject one case.
 *
 * ⛔ THE DECISION IS RE-RUN AT REVIEW TIME, NOT READ BACK. verify-decision.ts:338 requires it in as
 * many words: the six-month validity floor is measured from the day a case is ADJUDICATED, so a
 * passport with exactly six months left at submission no longer qualifies weeks later when a human
 * gets to it. Committing the stored verdict would make the manual queue the way to get a
 * non-compliant document approved — which is the opposite of what a queue is for.
 */
export async function reviewKycCase(input: {
  verificationId: string
  admin: string
  decision: ReviewDecision
  note?: string
  /**
   * ⚠️ THREE STATES, AND COLLAPSING TWO OF THEM WAS A REAL HOLE. `undefined` = the caller said
   * nothing, leave the column alone. `''` = the reviewer EMPTIED the box, meaning "the document does
   * not give an assessable nationality" — clear it. A code = set it.
   *
   * ⛔ WITHOUT THE `''` CASE A WRONG NATIONALITY IS UNFIXABLE, which codex caught on the finished
   * diff (2026-09-09). Picture a stateless holder whose OCR produced a real-looking country: the
   * reviewer cannot type `XXA` (deliberately unmapped, so `isoNationality` refuses it) and, with
   * empty folded into `undefined`, cannot clear the wrong one either — so the case is approved
   * carrying a country the document never claimed, and the wallet OPENS on it. That is the original
   * bug inverted, and worse: a NULL closes the wallet honestly, a wrong value opens it.
   *
   * Ignored on a rejection: a refused case is not a compliance record of anyone's nationality.
   */
  nationality?: string
  now?: Date
}): Promise<ReviewResult> {
  const now = input.now ?? new Date()
  const row = await db.identityVerification.findUnique({
    where: { id: input.verificationId },
    select: {
      id: true, profileId: true, status: true, tier: true, fullName: true, subjectHash: true,
      nationality: true, documentExpiresAt: true, method: true, evidence: true,
      profile: { select: { displayName: true } },
    },
  })
  if (!row) return { ok: false, code: 'not_found' }
  // ⚠️ Not an error state — two admins opening the same case is normal, and the second must be told
  // it is already decided rather than silently re-deciding it.
  if (row.status !== 'pending') return { ok: false, code: 'not_pending' }

  if (input.decision === 'reject') {
    const wrote = await decideOnce(row.id, {
      status: 'rejected', decidedAt: now, decidedBy: input.admin, rejectReason: 'manual',
      evidence: withNote(row.evidence, input.note),
    })
    if (!wrote) return { ok: false, code: 'not_pending' }
    // ⚠️ AFTER the recompute, so the hub the email links to already shows the refusal — and the
    // notice goes out even if the recompute throws: the row is already decided, and a seller left
    // untold on a page that promises they will be is worse than a stale cached status.
    if (row.profileId) await settle(row.profileId, now, () => notifyIdentityOutcome(row.profileId!, 'rejected', { reason: 'manual', note: input.note ?? null, tier: row.tier === 'A' ? 'A' : 'B' }))
    return { ok: true, status: 'rejected' }
  }

  /**
   * ⛔ AN APPROVAL NEEDS EVIDENCE THAT STILL EXISTS, AND THE DISABLED BUTTON IS NOT THE CONTROL.
   * The panel greys out Approve when a capture is missing or failed to load, and the rejection path
   * a few lines up already carries the reason that is not enough: "a disabled button in the UI is a
   * courtesy, not a control". This route is reachable by POST from anywhere once a case id is known,
   * and there is a second caller in `api/admin/identity/route.ts` that has no UI at all. Signing is
   * the same test the reviewer's screen used, so a null here means there is no recorded path, the
   * path is not the profile's, the account was deleted, or storage refused to sign — and in every
   * one of those a human is being asked to vouch for a document nobody can put in front of them.
   * ⚠️ WHAT IT DOES NOT PROVE: that the BYTES are still there. `createSignedUrl` mints a signature
   * over a path and does not fetch the object, so a purged file signs cleanly. That case is caught
   * on the screen instead — the panel gates Approve on both images having actually decoded — and
   * this gate closes the half a public endpoint can reach with no browser involved at all. Say the
   * smaller true thing here rather than the larger one the call cannot support.
   * ⚠️ REJECTION IS DELIBERATELY NOT GATED. A case whose documents cannot be produced is exactly a
   * case that should be refusable, and it already requires a written reason.
   */
  const ev = (row.evidence ?? {}) as Evidence
  /**
   * ⛔ "THERE IS NOTHING TO SHOW" AND "WE COULD NOT SIGN IT RIGHT NOW" ARE DIFFERENT ANSWERS, and
   * collapsing them is the same mistake the presence probe below already avoids. `signOwned`
   * returns null for BOTH a case with no recorded path (or a path that is not this profile's) and a
   * momentary refusal from the object store, because `signVerificationDoc` logs and returns null on
   * any storage error. Reporting the second as `evidence_unavailable` tells the reviewer to reload
   * and then "reject with a reason" — refusing somebody's identity over a signing blip. So the
   * structural question is asked FIRST, from data we already hold, and only then do we sign.
   */
  const { documentPath, selfiePath } = ev
  if (
    !row.profileId ||
    !documentPath || !selfiePath ||
    !ownsKycPath(row.profileId, documentPath) ||
    !ownsKycPath(row.profileId, selfiePath)
  ) return { ok: false, code: 'evidence_unavailable' }

  /**
   * ⛔ THE PRESENCE PROBE RUNS BEFORE SIGNING, AND THE ORDER IS THE WHOLE POINT. Measured
   * 2026-09-07 against this project's storage: `createSignedUrl` on a deleted object does NOT
   * quietly sign the path — it answers `Object not found` (status 400, statusCode "404") and
   * `signVerificationDoc` turns that into null. With signing first, a purged passport therefore
   * came out as `failed` ("nothing was changed — try again"), so the `evidence_unavailable` branch
   * built for exactly that case was unreachable in production and the reviewer would have retried
   * for ever against a file that is never coming back. A reviewer caught the premise; the probe
   * above settled it. Probing first is what lets the three outcomes stay distinct:
   *     absent  → evidence_unavailable   (reload, then reject with a reason)
   *     unknown → failed                 (storage is unwell — retry, do not refuse anyone)
   *     present → sign, and a null there is also `failed`
   */
  const presence = await Promise.all(
    [documentPath, selfiePath].map((path) => verificationDocExists(path)),
  )
  if (presence.includes('absent')) return { ok: false, code: 'evidence_unavailable' }
  if (presence.includes('unknown')) return { ok: false, code: 'failed' }

  const [docLink, selfieLink] = await Promise.all([
    signOwned(row.profileId, documentPath),
    signOwned(row.profileId, selfiePath),
  ])
  // Present, owned, recorded — and it still would not sign. That is the object store being unwell,
  // not the applicant's problem: `failed` reads "nothing was changed" and invites the retry.
  if (!docLink || !selfieLink) return { ok: false, code: 'failed' }
  /**
   * ⚠️ THIS IS A CHECK, NOT A LOCK, AND THE WINDOW IS REAL. Retention sweeps and account erasure can
   * remove a capture between this probe and the conditional write below. Nothing here can prevent
   * that — object storage has no transaction to join — so the honest statement is that this closes
   * the case where the evidence was ALREADY gone when a reviewer (or a bare POST) asked to approve,
   * which is the reachable one. A capture deleted inside the window leaves a verified row whose
   * evidence is absent; the erasure path is what must reckon with that, not this.
   */

  // ⛔ SAME HUMAN, SECOND ACCOUNT — RE-CHECKED HERE, NOT ONLY AT SUBMISSION. The submit-side clash
  // check looks for an already-VERIFIED row, so two accounts that submit the SAME passport while
  // both are still pending each pass it. Without this, an admin working the queue verifies both and
  // one person ends up running two verified seller identities — the exact thing subjectHash exists
  // to prevent. Caught by external review; the submit-time check alone was never sufficient.
  // ⚠️ EXCLUDE THE PROFILE, NOT THE ROW — and my first version excluded the row, which broke
  // renewals. A seller re-verifying the same passport (their record lapsed, or they resubmit after
  // a rejection) has their OWN earlier verified row under this subjectHash; matching on
  // `NOT: { id }` found it and refused the renewal as a duplicate. The submit-side check had it
  // right with `NOT: { profileId }`; this is the same predicate. Caught by external review.
  if (row.subjectHash && row.profileId) {
    const clash = await db.identityVerification.findFirst({
      where: { subjectHash: row.subjectHash, status: 'verified', NOT: { profileId: row.profileId } },
      select: { id: true },
    })
    if (clash) return { ok: false, code: 'duplicate_identity' }
  }

  // Re-run, with the reviewer standing in for the provider.
  //
  // ⛔ FROM THE CARRIED INPUTS, NEVER RE-DERIVED. See the note on `decisionInput` in service.ts:
  // splitting `fullName` mangled compound surnames and re-reading the stored Date lost a day to
  // the ICT→UTC boundary. The fallbacks below exist only for a row written before this field did.
  const di = ((row.evidence ?? {}) as Evidence).decisionInput
  const legacyName = row.fullName ?? ''
  const decision = decideTierB({
    // ⚠️ THE ROW'S OWN TIER. Re-deciding a tier A case as if it were a passport would apply the
    // MRZ and six-month-validity rules to a document that has neither — and this function's whole
    // purpose is to re-run the same decision the submission ran, not a different one.
    tier: row.tier === 'A' ? 'A' : 'B',
    surname: di?.surname ?? legacyName.split(' ').slice(-1)[0] ?? '',
    givenNames: di?.givenNames ?? legacyName.split(' ').slice(0, -1).join(' '),
    // ⚠️ FORMATTED IN ICT, NOT VIA toISOString(). documentExpiresAt is an ICT midnight, whose UTC
    // instant falls on the previous calendar day.
    documentExpiry: di?.documentExpiry ?? ictDate(row.documentExpiresAt),
    // The method records how the document was READ at submission; an MRZ read then is still an MRZ
    // read now, so this is not re-derived.
    mrzValid: di?.mrzValid ?? row.method === 'passport_mrz',
    accountName: di?.accountName ?? row.profile?.displayName ?? legacyName,
    humanReview: 'approved',
    now,
  })

  if (decision.status === 'rejected') {
    // ⛔ THE FLOOR MOVED WHILE THE CASE WAITED. Recorded as a rejection with its own reason, not as
    // a silent no-op: the seller can retry the moment a renewed passport lands (canSelfRetry allows
    // it), and the queue must not keep handing a reviewer a case they cannot lawfully approve.
    const wrote = await decideOnce(row.id, {
      status: 'rejected', decidedAt: now, decidedBy: input.admin,
      rejectReason: decision.rejectReason ?? 'expired',
      evidence: withNote(row.evidence, input.note),
    })
    if (!wrote) return { ok: false, code: 'not_pending' }
    // ⚠️ THE SELLER IS TOLD THE MACHINE'S REASON, not the reviewer's note: the reviewer pressed
    // Approve, and what refused the case is the six-month floor measured from today.
    if (row.profileId) await settle(row.profileId, now, () => notifyIdentityOutcome(row.profileId!, 'rejected', { reason: decision.rejectReason ?? 'expired', note: null, tier: row.tier === 'A' ? 'A' : 'B' }))
    return { ok: false, code: 'expired_at_review' }
  }

  if (decision.status !== 'verified') {
    // ⛔ A `pending` HERE IS A BUG IN THE DECISION LAYER, NOT A REJECTION, AND MUST NOT BE WRITTEN
    // AS ONE. The previous version folded this into the branch above and stamped
    // `rejectReason: 'expired'` on a passport valid for years — an unapprovable case, mislabelled.
    // With humanReview:'approved' every queue in decideTierB now yields a verdict, so reaching here
    // means the two files have drifted: leave the case PENDING and say so.
    console.error('[kyc] decideTierB returned pending under humanReview:approved', { id: row.id })
    return { ok: false, code: 'still_pending' }
  }

  /**
   * ⛔ THE NATIONALITY CORRECTION RIDES INSIDE THE SAME GUARDED UPDATE, NEVER AS ITS OWN WRITE.
   * codex refuted the first plan on this (2026-09-09): a separate `update` before `decideOnce`
   * escapes the `status: 'pending'` guard, so the admin who LOSES the race — whose decision matched
   * zero rows and who is correctly told `not_pending` — would still have rewritten the nationality
   * on a case somebody else had already decided. One conditional update, or the guard is decorative.
   *
   * ⚠️ AN UNUSABLE NATIONALITY DOES NOT BLOCK THE APPROVAL, and that separation is deliberate.
   * Requiring one would strand every stateless, refugee or unspecified holder — `XXA`/`XXB`/`XXC`/
   * `XXX` are unmapped ON PURPOSE (identity.ts), so "approve needs an ISO nationality" makes those
   * cases permanently unapprovable, which codex flagged. Identity verification and wallet
   * eligibility are different questions: the person is verified, and the wallet stays shut with the
   * honest reason `unmappable_nationality` until counsel says what those codes may do.
   */
  let nationalityWrite: string | null | undefined
  if (input.nationality !== undefined) {
    if (input.nationality === '') {
      // Emptied on purpose. Only a write when there is something to clear.
      if (row.nationality !== null) nationalityWrite = null
    } else {
      const iso = isoNationality(input.nationality)
      if (!iso) return { ok: false, code: 'nationality_invalid' }
      if (iso !== row.nationality) nationalityWrite = iso
    }
  }
  const nationalityChanged = nationalityWrite !== undefined
  /**
   * ⛔ CONFIRMING AN UNCHANGED VALUE IS ITSELF THE FACT WORTH RECORDING, AND THE FIRST CUT RECORDED
   * NOTHING FOR IT. The panel only sends this field when the reviewer touched it, so a code arriving
   * here equal to the stored one means a human looked at the passport and vouched for what was
   * already there — the single most likely outcome when the applicant's own declaration was right.
   * Writing only on a CHANGE left that record byte-identical to one nobody had checked: the evidence
   * still said `nationalityFromMrz: false`, the panel kept labelling it "declared by the applicant",
   * and the settlement gate opened on it either way. Two seats named it (2026-09-09).
   */
  const nationalityAsserted = input.nationality !== undefined && input.nationality !== ''

  const wrote = await decideOnce(row.id, {
    status: 'verified', decidedAt: now, decidedBy: input.admin,
    assuranceLevel: decision.assurance,
    ...(nationalityChanged ? { nationality: nationalityWrite ?? null } : {}),
    evidence: nationalityChanged || nationalityAsserted
      ? withNationality(
          withNote(row.evidence, input.note, decision.checksPassed),
          {
            before: row.nationality,
            // ⚠️ ON A CONFIRMATION, `after` IS THE VALUE THAT STAYS — not null. `nationalityWrite`
            // is undefined precisely because nothing needed changing, and recording "changed it to
            // nothing" would be a false statement about what the reviewer vouched for.
            after: nationalityChanged ? nationalityWrite ?? null : row.nationality,
            admin: input.admin,
            at: now,
            confirmedOnly: !nationalityChanged,
          },
        )
      : withNote(row.evidence, input.note, decision.checksPassed),
  })
  if (!wrote) return { ok: false, code: 'not_pending' }
  // ⛔ "YOU ARE VERIFIED" — AND THE WALLET — ONLY WHEN THE PROFILE NOW READS VERIFIED. A revoked
  // profile outranks a newly approved row in `deriveVerification`; telling that seller they are
  // verified, or opening them a custody wallet, would both be wrong. The recompute is awaited as
  // it always was (a throw propagates to the admin exactly as before this change — nothing new is
  // swallowed on the approve path), and what it returns decides the rest.
  const profileStatus = row.profileId ? (await recomputeVerification(row.profileId, now)).status : null
  if (row.profileId && profileStatus === 'verified') {
    await notifyIdentityOutcome(row.profileId, 'approved', { reason: null, note: null, tier: row.tier === 'A' ? 'A' : 'B' })
  }
  /**
   * ⚠️ PROVISIONING RUNS AFTER THE VERIFICATION IS DURABLE, AND CANNOT FAIL THE REVIEW. Owner,
   * 2026-08-30: a fresh KYC should auto-create the user's wallet. The approval is the fact that
   * matters and it is already written; a wallet provider failing — or NOT ANSWERING AT ALL, which
   * a try/catch here could not have stopped — must not turn an approved case into an error the
   * admin has to re-drive. `provisionWithinBudget` never throws and cannot outlast its budget, and
   * provisioning is idempotent, so a retry or a backfill converges rather than making a second wallet.
   */
  if (row.profileId && profileStatus === 'verified') {
    /**
     * ⚠️ CAUGHT HERE TOO, THOUGH `provisionWithinBudget` PROMISES NEVER TO THROW. A reviewer noted
     * this call was untested; writing the test showed the approval had come to DEPEND on that
     * promise, with nothing enforcing it from this side. The decision is already durable at this
     * point and an admin must never see it fail over a side effect, so the guarantee is asserted at
     * both ends rather than trusted across the boundary.
     */
    try {
      await provisionWithinBudget(row.profileId)
    } catch (e) {
      // ⚠️ AND THE LOGGER IS INSIDE ITS OWN GUARD. A reviewer spotted the irony: the catch existed
      // so a side effect could not fail an approval, then called a logger that can itself throw —
      // turning the rescue into the same failure it was added to prevent.
      try { logError(e, { at: 'kyc.review.provision', profileId: row.profileId }) } catch { /* ignore */ }
    }
  }
  return { ok: true, status: 'verified' }
}

/**
 * Reviewer notes JOIN the evidence rather than replacing it — the audit trail is append-only.
 *
 * ⚠️ The return type is Prisma's own JSON input type, not Record<string, unknown>. Prisma refuses
 * the looser type on purpose: `unknown` can hold a Date or a class instance that serialises to
 * something nobody intended, and this column is evidence.
 */
/**
 * REFUSALS ONLY: recompute the cached status, then tell the seller — and the second happens even
 * if the first throws. The row is already refused, and a seller left untold on a page that
 * promises they will be is worse than a stale cache (which the next status write repairs).
 */
async function settle(profileId: string, now: Date, notify: () => Promise<void>): Promise<void> {
  try {
    await recomputeVerification(profileId, now)
  } catch (e) {
    try { logError(e, { at: 'kyc.review.recompute', profileId }) } catch { /* ignore */ }
  }
  await notify()
}

function withNote(existing: unknown, note?: string, checksPassed?: string[]): Prisma.InputJsonObject {
  const base = (existing ?? {}) as Prisma.InputJsonObject
  return {
    ...base,
    ...(checksPassed ? { checksPassedAtReview: checksPassed } : {}),
    ...(note ? { reviewerNote: note.slice(0, 500) } : {}),
  }
}

/**
 * ⛔ THE MRZ NATIONALITY FIELD IS PROTECTED BY NO CHECK DIGIT AT ALL, WHICH IS WHY A REVIEWER MAY
 * OVERWRITE A NATIONALITY THAT LOOKS PERFECTLY GOOD. Read mrz.ts:74: the composite digit covers
 * `line2.slice(0,10)` + `slice(13,20)` + `slice(21,43)` and steps straight over `slice(10,13)`,
 * which is the nationality. Every other MRZ field this app trusts is checksummed; this one is not.
 * So OCR can turn `USA` into `U5A` (unmappable — surfaces as `unmappable_nationality`) or, worse,
 * into another REAL code that maps cleanly and is simply wrong. The first draft of this change said
 * "never overwrite a good MRZ value"; codex refuted it (2026-09-09) on exactly this ground — with no
 * checksum there is no such thing as a value known to be good, and the human holding the passport
 * image is a better authority than an unchecked OCR read.
 *
 * ⛔ WHAT IS RECORDED IS THE CHANGE, NOT JUST THE RESULT. `nationality` is an input to a legal gate
 * (settlement eligibility), so a compliance record that silently showed the corrected value would
 * destroy the ability to ask later what the document actually read. Both values are kept.
 */
function withNationality(
  existing: unknown,
  args: { before: string | null; after: string | null; admin: string; at: Date; confirmedOnly?: boolean },
): Prisma.InputJsonObject {
  const base = (existing ?? {}) as Prisma.InputJsonObject
  return {
    ...base,
    nationalitySource: 'reviewer',
    /**
     * ⚠️ `nationalityFromMrz` IS DELIBERATELY LEFT ALONE. It records how the value got into the
     * column at SUBMISSION, which a later human confirmation does not retroactively change — and
     * overwriting it to `true` would claim a machine read something it never read. What a reviewer
     * vouching adds is THIS block, which says a named human asserted it and when.
     */
    /** True when the reviewer confirmed the value that was already stored rather than changing it. */
    nationalityConfirmedOnly: args.confirmedOnly === true,
    nationalityBefore: args.before,
    /**
     * ⛔ THE ASSERTED VALUE IS RECORDED HERE TOO, NOT ONLY IN THE COLUMN. The first cut took
     * `after` and never wrote it — codex caught it on the finished diff (2026-09-09) — which left
     * the evidence saying "the document read NOR and a reviewer changed it" without saying what
     * they changed it TO. `nationality` is a mutable column feeding a legal gate; the moment
     * anything else writes it, an audit that kept only the old value can no longer answer what
     * this reviewer actually vouched for.
     */
    nationalityAfter: args.after,
    nationalitySetBy: args.admin,
    nationalitySetAt: args.at.toISOString(),
  }
}
