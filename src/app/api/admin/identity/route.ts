import { z } from 'zod'
import { route, ApiError } from '@/lib/api/handler'
import { listKycQueue, reviewKycCase } from '@/lib/kyc/review'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The foreign-seller KYC review queue, and the decision on one case.
//
// ⛔ ADMIN ONLY, AND THE RESPONSE CARRIES SIGNED LINKS TO PASSPORT PHOTOS. `auth: 'admin'` is doing
// real work here: this is the most sensitive payload any route in the app returns.
export const GET = route({ auth: 'admin' }, async () => {
  const items = await listKycQueue()
  // ⛔ no-store: the body holds live signed URLs to identity documents. A cached copy anywhere —
  // a proxy, a browser back-button, a shared screen recording — outlives the ten-minute TTL that
  // is supposed to bound their exposure.
  return Response.json({ items }, { headers: { 'cache-control': 'no-store' } })
})

const bodySchema = z.object({
  verificationId: z.string().min(1).max(60),
  decision: z.enum(['approve', 'reject']),
  note: z.string().max(500).optional(),
})

export const POST = route(
  { auth: 'admin', body: bodySchema, invalidBodyCode: 'invalid_body' },
  async ({ admin, body }) => {
    const result = await reviewKycCase({
      verificationId: body.verificationId,
      // Never null on an admin route — the wrapper resolves the email before the handler runs.
      admin: admin ?? 'unknown',
      decision: body.decision,
      note: body.note,
    })
    if (!result.ok) {
      if (result.code === 'not_found') throw new ApiError('not_found', 404)
      if (result.code === 'not_pending') throw new ApiError('already_reviewed', 409)
      // ⚠️ 409, NOT 500. `expired_at_review` means the case WAS decided — as a rejection, because
      // the six-month floor moved while it waited — so the reviewer needs to see what happened
      // rather than a failure they might retry.
      if (result.code === 'expired_at_review') throw new ApiError('document_expired', 409)
      // ⛔ THE SAME PASSPORT IS ALREADY VERIFIED ON ANOTHER ACCOUNT. Only reachable at review time:
      // two accounts can both be PENDING on one passport, since the submit-side check looks for an
      // already-verified row. 409 — the reviewer must see it, not retry it.
      if (result.code === 'duplicate_identity') throw new ApiError('duplicate_identity', 409)
      // A decision layer that still says `pending` under an explicit approval is drift between two
      // files, not a reviewer error. 500 is right: nothing the admin did caused it, and it needs a
      // developer. The case stays pending and re-appears in the queue.
      // ⛔ THE CAPTURES CANNOT BE PRODUCED, SO NOBODY CAN VOUCH FOR THEM. 409, not 500: the case is
      // untouched and still pending, and this is a state the reviewer must see rather than retry.
      if (result.code === 'evidence_unavailable') throw new ApiError('evidence_unavailable', 409)
      if (result.code === 'still_pending') throw new ApiError('internal_error', 500)
      throw new ApiError('internal_error', 500)
    }
    return Response.json({ status: result.status }, { headers: { 'cache-control': 'no-store' } })
  },
)
