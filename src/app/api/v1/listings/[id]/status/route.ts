import { NextRequest } from 'next/server'
import { setStatusCore } from '@/lib/core/listings'
import { resolveApiKey, listingOwnedBy } from '@/lib/api/auth'
import { apiOk, apiError, apiAuthError } from '@/lib/api/respond'

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
  if (!res.ok) return apiError(422, res.error, 'status must be one of: active, sold, hidden.', r.rate)
  return apiOk({ ok: true, status: res.status }, r.rate)
}
