import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { VERIFICATION_CONSENT_VERSION } from '@/lib/business-verification'
import { loadOwnVerification, ownVerificationView, submitVerification } from '@/lib/core/business-verification-service'
import { ApiError, route } from '@/lib/api/handler'
import { personBeforeBusinessEnforced, ownerPersonVerified } from '@/lib/kyc/person-gate'

// The applicant's own verification surface.
//   GET  → their current case status + which documents are present (no signed URLs — the
//          applicant sees only that a doc exists, never re-downloads it).
//   POST → submit the draft for review (freezes evidence + the identity hash; requires the
//          consent flag, logged for PDPL).
//
// ⚠️ WS6 MIGRATION. GET takes the auth preamble; POST takes auth + the strict limiter. Codes are
// unchanged: 401 `auth_required`, 429 `rate_limited`, 403 `no_storefront`, 400 `consent_required`,
// and submitVerification's own `{status, error}` pairs.
//
// ⚠️ `auth: 'userId'` ON BOTH — this is the mode the old code already used (`getCurrentProfileId()`),
// which verifies the JWT locally with no auth-server round trip and no Profile read. Nothing here
// touches the Profile row; the ownership check is a Seller lookup by `ownerId`.
//
// ⚠️ POST ORDER IS PRESERVED: limiter BEFORE the storefront lookup, which is the order route() runs
// its options in — so a seller-less caller hammering this still gets 429 before 403, exactly as
// before. (Had the original checked ownership first, the limiter could not have been hoisted.)
//
// ⚠️ NO `body:` SCHEMA. The old parse was `try { … } catch { body = {} }`, so a MISSING or MALFORMED
// body falls through to `consent_required` 400 — not `bad_request`. A schema would change that code.
//
// ⚠️ submitVerification's failures stay a raw Response: its vocabulary (`no_seller`,
// `nothing_to_submit`, `missing_identity_doc`, `missing_bank_doc`, `missing_legal_fields`,
// `already_open`, `duplicate_tax`) is absent from errors.ts. Forwarding the string keeps the wire
// identical rather than forcing a rename. Reported, not added.
//
// ⚠️ ONE BRANCH IS NOT BYTE-IDENTICAL on both verbs: the service calls were unwrapped, so a DB
// rejection was an unhandled throw answered by Next's default 500. route() now catches it and
// returns `{"error":"internal_error"}` 500 — an improvement, but a wire change on the failure path.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function ownSellerId(userId: string): Promise<string | null> {
  const seller = await db.seller.findUnique({ where: { ownerId: userId }, select: { id: true } })
  return seller?.id ?? null
}

export const GET = route({ auth: 'userId' }, async ({ userId }) => {
  const sellerId = await ownSellerId(userId)
  if (!sellerId) throw new ApiError('no_storefront', 403)
  /**
   * ⚠️ THE PERSON'S STATUS TRAVELS WITH THE BUSINESS CASE, so the panel can render step 1 as a
   * locked prerequisite instead of opening straight into uploads and refusing at the end. The
   * refusal itself lives in `submitVerification` and `approveVerification`; this is only what the
   * applicant is SHOWN, and it must never be mistaken for the gate.
   * ⚠️ `gate` IS SENT TOO. Without it the panel cannot tell "you must verify yourself first" from
   * "this rule is not switched on here", and would draw a lock that does not exist — on eno.forum,
   * where the sequencing deliberately does not apply, that lock would be a lie.
   */
  const gate = personBeforeBusinessEnforced()
  const [caseRow, view, personVerified] = await Promise.all([
    loadOwnVerification(sellerId),
    ownVerificationView(sellerId),
    gate ? ownerPersonVerified(userId) : Promise.resolve(true),
  ])
  return {
    personGate: gate,
    personVerified,
    // The LIVE badge state (verified/expired/pending/rejected/…) — NOT the raw case status,
    // so a badge dropped by an identity edit or expiry shows "re-verify", never stale "verified".
    view,
    case: caseRow
      ? {
        status: caseRow.status,
        // Kinds present, never the paths — the applicant never re-fetches their own docs.
        documentKinds: [...new Set(caseRow.documents.map((d) => d.kind))],
        submittedAt: caseRow.submittedAt,
        reviewedAt: caseRow.reviewedAt,
        note: caseRow.status === 'rejected' ? caseRow.note : null,
      }
      : null,
  }
})

export const POST = route(
  {
    auth: 'userId',
    rateLimit: { bucket: 'business-verif-submit', limit: 10, window: '1 h', strict: true },
  },
  async ({ req, userId }) => {
    const sellerId = await ownSellerId(userId)
    if (!sellerId) throw new ApiError('no_storefront', 403)

    // Explicit consent to processing the sensitive documents (PDPL Decree 13/2023) — logged.
    let body: { consent?: unknown }
    try { body = (await req.json()) as { consent?: unknown } } catch { body = {} }
    if (body.consent !== true) throw new ApiError('consent_required', 400)

    const res = await submitVerification(sellerId, VERIFICATION_CONSENT_VERSION)
    if (!res.ok) {
      const status = res.error === 'duplicate_tax' ? 409 : res.error === 'no_seller' ? 403 : 400
      return NextResponse.json({ error: res.error }, { status })
    }
    return { ok: true }
  },
)
