import { NextRequest } from 'next/server'
import { confirmCore } from '@/lib/core/listings'
import { resolveApiKey, listingOwnedBy } from '@/lib/api/auth'
import { apiOk, apiError, apiAuthError } from '@/lib/api/respond'
import { isIdentityBlockCode, publishBlockedV1, PUBLISH_BLOCKED_STATUS } from '@/lib/compliance/publish-block-response'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/v1/listings/{id}/confirm — "still available" bump (refreshes feed recency,
// stamps availability, marks active). Rate-limited to one bump per cooldown server-side.
// Scope: listings:write.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await resolveApiKey(req, 'listings:write')
  if (!r.ok) return apiAuthError(r)
  const { id } = await params
  if (!(await listingOwnedBy(id, r.auth.sellerId))) return apiError(404, 'not_found', 'Listing not found.', r.rate)
  const res = await confirmCore(id, r.auth.profileId)
  // A confirm that would revive a sold/hidden listing, refused by the identity gate (gate on only).
  if (!res.ok && isIdentityBlockCode(res.error)) return apiOk(publishBlockedV1(res.error), r.rate, PUBLISH_BLOCKED_STATUS)
  // Refused because the shop's account is held or suspended (confirmCore) — a 403 with its own code,
  // never the 404 below: the listing exists, the account may not re-offer it right now.
  if (!res.ok && (res.error === 'account_held' || res.error === 'account_suspended')) {
    return apiError(403, res.error, 'This account is held or suspended, so its listings cannot be confirmed or put back on sale right now.', r.rate)
  }
  if (!res.ok) return apiError(404, 'not_found', 'Listing not found.', r.rate)
  return apiOk({ ok: true, bumped: res.bumped }, r.rate)
}
