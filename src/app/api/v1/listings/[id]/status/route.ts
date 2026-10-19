import { NextRequest } from 'next/server'
import { setStatusCore } from '@/lib/core/listings'
import { resolveApiKey, listingOwnedBy } from '@/lib/api/auth'
import { apiOk, apiError, apiAuthError } from '@/lib/api/respond'
import { isIdentityBlockCode, publishBlockedV1, PUBLISH_BLOCKED_STATUS } from '@/lib/compliance/publish-block-response'
import { RELEASED_CHARGE_CAP_MESSAGE } from '@/lib/released-charge-copy'
import { LICENCE_CHECK_REQUIRED_COPY } from '@/lib/licence-check-copy'
import { isJobTextBlockCode } from '@/lib/publish-guard'
import { JOB_TEXT_REFUSAL } from '@/lib/job-listing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/v1/listings/{id}/status — set availability: active | sold | hidden.
// Body: { "status": "sold" }. Scope: listings:write. Idempotent.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await resolveApiKey(req, 'listings:write')
  if (!r.ok) return apiAuthError(r)
  const { id } = await params
  if (!(await listingOwnedBy(id, r.auth.sellerId))) return apiError(404, 'not_found', 'Listing not found.', r.rate)

  let body: { status?: string }
  try { body = await req.json() } catch { return apiError(400, 'bad_request', 'Invalid JSON body.', r.rate) }
  const res = await setStatusCore(id, String(body.status || ''))
  // A relist the identity gate refused (gate on only) — NOT a bad status value, so it must not fall
  // into the 422 below, whose message would tell the partner their `status` was malformed.
  if (!res.ok && isIdentityBlockCode(res.error)) return apiOk(publishBlockedV1(res.error), r.rate, PUBLISH_BLOCKED_STATUS)
  // A relist refused because the shop's account is held or suspended (the hold leak — setStatusCore):
  // the same 403 and codes as a blocked create, and NOT the 422 below, whose message would tell the
  // partner their `status` was malformed.
  if (!res.ok && (res.error === 'account_held' || res.error === 'account_suspended')) {
    return apiError(403, res.error, 'This account is held or suspended, so its listings cannot be put back on sale right now.', r.rate)
  }
  // A relist refused by the released-scam-charge cap (setStatusCore): an account limit, the 403 a
  // blocked create answers — not the 422 below either.
  if (!res.ok && res.error === 'released_charge_listing_cap') return apiError(403, res.error, RELEASED_CHARGE_CAP_MESSAGE, r.rate)
  // A relist of an e-Visa / Legal & permits listing eno has not checked (2026-10-14): the 409 setStatusCore answers — a
  // state the listing is in until eno's approval, not a malformed `status`, so never the 422 below.
  if (!res.ok && res.error === 'licence_check_required') return apiError(409, res.error, LICENCE_CHECK_REQUIRED_COPY.en, r.rate)
  // A relist of a hiring post whose stored text the job-text screen refuses (2026-10-19): its rule's sentence and `detail`
  // '<field>:<snippet>' in the error envelope (as PATCH answers an edit's) — never the malformed-`status` line below.
  if (!res.ok && isJobTextBlockCode(res.error)) return apiOk({ error: { code: res.error, message: JOB_TEXT_REFUSAL[res.error].en, ...(res.detail ? { detail: res.detail } : {}) } }, r.rate, 422)
  if (!res.ok) return apiError(422, res.error, 'status must be one of: active, sold, hidden.', r.rate)
  return apiOk({ ok: true, status: res.status }, r.rate)
}
