import { db } from '@/lib/db'
import { route } from '@/lib/api/handler'
import { deriveVerification } from '@/lib/compliance/recompute-verification'
import { personBeforeBusinessEnforced } from '@/lib/kyc/person-gate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * WHERE THIS PERSON STANDS ON STAGE 1 — the read the verification hub renders from.
 *
 * ⛔ DERIVED, NOT READ OFF THE CACHED COLUMN. `Profile.verificationStatus` is written by
 * `recomputeVerification` and nothing sweeps it on a schedule, so a lapsed document still reads
 * `verified` there until something happens to recompute. `deriveVerification` evaluates expiry
 * against today and lets `revoked` outrank everything — which is the difference between a page that
 * tells someone they are verified and a page that is right.
 *
 * ⚠️ IT RETURNS A STATUS, NOT AN IDENTITY. No name, no nationality, no document number crosses to
 * the client: the page only needs to know which of two steps to open. `readVerifiedIdentity` would
 * have answered the same question while shipping the person's details to render a tick.
 */
const SELLER_FACING_REASONS = new Set(['manual', 'expired', 'document_expires_soon', 'document_expiry_unreadable'])

export const GET = route({ auth: 'userId' }, async ({ userId }) => {
  const rows = await db.identityVerification.findMany({
    where: { profileId: userId },
    select: {
      id: true, status: true, decidedAt: true, documentExpiresAt: true, tier: true, method: true, assuranceLevel: true,
      rejectReason: true, evidence: true,
    },
  })

  const derived = deriveVerification(rows, new Date())
  /**
   * ⛔ WHY, NOT JUST WHAT. A refused seller was told "that did not pass, try a clearer photograph"
   * whatever the reviewer had actually written — the note was recorded on the case as
   * `evidence.reviewerNote` and shown to nobody, and a passport refused for being inside the
   * six-month floor got advice about photography. Only for the row the derived status came FROM,
   * and only when that status is a refusal: nothing about a superseded or pending case crosses.
   * The note is the reviewer's own words about THIS seller's document, written to be read by them.
   */
  const source = derived.status === 'rejected' ? derived.source : null
  const evidence = (source?.evidence ?? null) as { reviewerNote?: unknown } | null
  // ⚠️ THE NOTE TRAVELS ONLY WITH A MANUAL REFUSAL. An approve refused at review by the six-month
  // floor stores whatever the reviewer typed while approving ("looks fine"); showing that under
  // "could not accept your document" would contradict the machine reason the email carries.
  const manual = source?.rejectReason === 'manual'
  const note = manual && typeof evidence?.reviewerNote === 'string' ? evidence.reviewerNote.slice(0, 500) : null
  // ⚠️ ALLOW-LISTED. Only reasons the hub has words for cross; anything else — a future code, a
  // bad write — is `null`, which the hub renders as the generic line.
  const reason = source?.rejectReason && SELLER_FACING_REASONS.has(source.rejectReason) ? source.rejectReason : null

  return Response.json(
    {
      // ⚠️ NO ROWS IS `unverified`, NOT AN ERROR — `deriveVerification` returns exactly that for an
      // empty list. It is the ordinary state of every account that has never started, which today
      // is all of them (measured 2026-08-31: the table holds zero rows).
      // ⚠️ `now` IS PASSED EXPLICITLY — the function takes it rather than reading the clock, because
      // expiry uses startOfDay leniency in ICT and a hidden clock would make that untestable.
      status: derived.status,
      ...(source ? { reason, note } : {}),
      /**
       * ⚠️ THE GATE TRAVELS TOO, so the hub can dim step 2 only where the sequencing is actually
       * enforced. It is marketplace-only and behind its own env switch; on eno.forum a lock would
       * be describing a rule that does not apply there.
       */
      gate: personBeforeBusinessEnforced(),
    },
    { headers: { 'cache-control': 'no-store' } },
  )
})
