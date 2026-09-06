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
    where: { status: 'pending' },
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
  const { count } = await db.identityVerification.updateMany({
    where: { id, status: 'pending' },
    data: data as Prisma.IdentityVerificationUpdateManyMutationInput,
  })
  return count === 1
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
  | { ok: false; code: 'not_found' | 'not_pending' | 'expired_at_review' | 'duplicate_identity' | 'still_pending' | 'evidence_unavailable' | 'failed' }

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

  const wrote = await decideOnce(row.id, {
    status: 'verified', decidedAt: now, decidedBy: input.admin,
    assuranceLevel: decision.assurance,
    evidence: withNote(row.evidence, input.note, decision.checksPassed),
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
