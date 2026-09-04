import { z } from 'zod'
import { route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { kycSubmitSchema, submitKycForReview, type KycSubmitError } from '@/lib/kyc/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * ⚠️ EVERY CODE NEEDS BILINGUAL COPY AT THE CALL SITE. These are the seller's whole explanation of
 * why they cannot sell yet, and a bare code renders as a dead end. `document_unreadable` in
 * particular must say "retake the data page", not "invalid" — it is the one a real seller with a
 * glare band on their passport will hit.
 */
const STATUS: Record<KycSubmitError, number> = {
  challenge_missing: 400,
  challenge_expired: 400,
  challenge_mismatch: 400,
  // 403, not 400: the paths are well-formed, they just are not this seller's. The only client that
  // can produce this is one that did not get them from /api/seller/identity/documents.
  path_not_owned: 403,
  identity_hashing_unavailable: 503, // config, not the seller's fault — never blame them with a 400
  document_unreadable: 422,
  // 422 and its OWN code: the number is the wrong shape. Never `document_unreadable`, whose copy
  // tells the seller to photograph the card again — advice about a field they typed.
  document_number_invalid: 422,
  // 400: the REQUEST contradicts itself — a CCCD claim carrying passport MRZ lines. It is a client
  // bug or a probe, never something a seller can act on, so it is not a 422 "fix your document".
  tier_mismatch: 400,
  already_pending: 409,
  duplicate_identity: 409,
  rejected: 422,
}

// Submit a foreign seller's passport for review. Decree 248/2026 Art 18.1(b) prescribes exactly
// this for a foreign seller, which is why this path is legally sound while the Vietnamese-seller
// path is not — see src/lib/kyc/service.ts.
//
// ⛔ THIS CAN ONLY EVER CREATE A **PENDING** CASE. Approval is a separate, human act.
export const POST = route(
  {
    auth: 'userId',
    body: kycSubmitSchema as unknown as z.ZodTypeAny,
    invalidBodyCode: 'invalid_body',
    // strict: PII-adjacent, so a limiter outage fails CLOSED rather than waving submissions through.
    rateLimit: { bucket: 'identity-submit', limit: 5, window: '1 d', strict: true },
  },
  async ({ userId, body }) => {
    // The account name the passport is checked against. `namesCorrespond` is deliberately lenient,
    // so a transliteration or a married name goes to a human rather than bouncing.
    const profile = await db.profile.findUnique({ where: { id: userId }, select: { displayName: true } })
    const result = await submitKycForReview(userId, profile?.displayName ?? '', body as never)

    if (!result.ok) {
      return Response.json({ error: result.code }, { status: STATUS[result.code], headers: { 'cache-control': 'no-store' } })
    }
    return Response.json(
      { status: result.status, verificationId: result.verificationId },
      { status: 201, headers: { 'cache-control': 'no-store' } },
    )
  },
)
