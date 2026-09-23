import { NextRequest } from 'next/server'
import { setStatusCore } from '@/lib/core/listings'
import { resolveApiKey, listingOwnedBy } from '@/lib/api/auth'
import { apiOk, apiError, apiAuthError } from '@/lib/api/respond'
import { isIdentityBlockCode, publishBlockedV1, PUBLISH_BLOCKED_STATUS } from '@/lib/compliance/publish-block-response'

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
  if (!res.ok) return apiError(422, res.error, 'status must be one of: active, sold, hidden.', r.rate)
  return apiOk({ ok: true, status: res.status }, r.rate)
}
