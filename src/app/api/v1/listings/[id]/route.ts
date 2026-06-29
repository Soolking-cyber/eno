import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { updateListingCore, deleteListingCore } from '@/lib/core/listings'
import { resolveApiKey, listingOwnedBy } from '@/lib/api/auth'
import { apiOk, apiError, apiAuthError } from '@/lib/api/respond'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/v1/listings/{id} — a single listing of the authenticated shop (any status).
// Returns 404 for ids that don't exist OR belong to another shop (no cross-shop leak).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await resolveApiKey(req, 'listings:read')
  if (!r.ok) return apiAuthError(r)

  const { id } = await params
  const listing = await db.listing.findUnique({
    where: { id },
    include: { category: true, seller: { include: { owner: { select: { accountType: true } } } } },
  })
  if (!listing || listing.sellerId !== r.auth.sellerId) {
    return apiError(404, 'not_found', 'Listing not found.', r.rate)
  }
  return apiOk({ listing: serializeListing(listing) }, r.rate)
}

// PATCH /api/v1/listings/{id} — edit a listing (sparse; only present fields change).
// Same validation + republish gate + reindex as the dashboard edit (updateListingCore).
// Scope: listings:write. Naturally idempotent (same body → same result).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await resolveApiKey(req, 'listings:write')
  if (!r.ok) return apiAuthError(r)
  const { id } = await params
  if (!(await listingOwnedBy(id, r.auth.sellerId))) return apiError(404, 'not_found', 'Listing not found.', r.rate)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return apiError(400, 'bad_request', 'Invalid JSON body.', r.rate) }
  const res = await updateListingCore(id, body)
  if (!res.ok) return apiError(res.code === 404 ? 404 : 422, res.error, res.error, r.rate)
  return apiOk({ ok: true }, r.rate)
}

// DELETE /api/v1/listings/{id} — remove a listing. Scope: listings:write.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await resolveApiKey(req, 'listings:write')
  if (!r.ok) return apiAuthError(r)
  const { id } = await params
  if (!(await listingOwnedBy(id, r.auth.sellerId))) return apiError(404, 'not_found', 'Listing not found.', r.rate)
  await deleteListingCore(id)
  return apiOk({ ok: true }, r.rate)
}
