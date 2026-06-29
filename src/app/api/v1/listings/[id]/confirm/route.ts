import { NextRequest } from 'next/server'
import { confirmCore } from '@/lib/core/listings'
import { resolveApiKey, listingOwnedBy } from '@/lib/api/auth'
import { apiOk, apiError, apiAuthError } from '@/lib/api/respond'

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
  return apiOk({ ok: true, bumped: res.bumped }, r.rate)
}
