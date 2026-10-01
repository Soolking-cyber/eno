import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { updateListingCore, deleteListingCore, DELETE_HOLD_MESSAGE } from '@/lib/core/listings'
import { resolveApiKey, listingOwnedBy } from '@/lib/api/auth'
import { apiOk, apiError, apiAuthError } from '@/lib/api/respond'
import { LISTING_REMOVED } from '@/lib/listing-removed'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/v1/listings/{id} — a single listing of the authenticated shop (any status but a removed one).
// Returns 404 for ids that don't exist, belong to another shop (no cross-shop leak), or were removed.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await resolveApiKey(req, 'listings:read')
  if (!r.ok) return apiAuthError(r)

  const { id } = await params
  const listing = await db.listing.findUnique({
    where: { id },
    include: { category: true, seller: { include: { owner: { select: { accountType: true } } } } },
  })
  // ⛔ A tombstone (src/lib/listing-removed.ts) is "not found" to its own shop too — the same answer
  // listingOwnedBy gives the write paths, the list endpoint and MCP's get_listing.
  if (!listing || listing.sellerId !== r.auth.sellerId || listing.status === LISTING_REMOVED) {
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
  // Pass through the real status: 404 not-found and 409 conflict (e.g. urgent_quota —
  // a retryable state conflict) must not be flattened to 422 "invalid payload".
  if (!res.ok) return apiError(res.code === 404 ? 404 : res.code === 409 ? 409 : 422, res.error, res.error, r.rate)
  return apiOk({ ok: true }, r.rate)
}

// DELETE /api/v1/listings/{id} — remove a listing. Scope: listings:write.
// While the shop's account or the listing is under investigation the listing is HIDDEN instead of
// deleted (it stays where the review can act on it; a delete itself is a tombstone that erases no
// report or chat — src/lib/listing-removed.ts): still 200, with
// `deleted: false, hidden: true, reason, message` so an integration can tell the two apart.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await resolveApiKey(req, 'listings:write')
  if (!r.ok) return apiAuthError(r)
  const { id } = await params
  if (!(await listingOwnedBy(id, r.auth.sellerId))) return apiError(404, 'not_found', 'Listing not found.', r.rate)
  const res = await deleteListingCore(id)
  if (res.ok && !res.deleted) {
    return apiOk({ ok: true, deleted: false, hidden: true, reason: res.reason, message: DELETE_HOLD_MESSAGE[res.reason] }, r.rate)
  }
  // The held delete's hide was refused for a reason other than "already gone": say so, with its code —
  // only a 404 is the idempotent no-op below.
  if (!res.ok && res.code !== 404) return apiError(res.code, res.error, 'The listing is under review and could not be hidden; it was not deleted.', r.rate)
  return apiOk({ ok: true }, r.rate)
}
