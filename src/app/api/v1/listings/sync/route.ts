import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { syncListingsCore, SYNC_MAX_ROWS, type SyncRow } from '@/lib/core/sync'
import { postingGate } from '@/lib/enforcement'
import { resolveApiKey } from '@/lib/api/auth'
import { apiOk, apiError, apiAuthError } from '@/lib/api/respond'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST /api/v1/listings/sync — upsert your catalogue by externalId (your own SKU). Each
// listing maps to one externalId, unique per shop. mode "partial" (default) only touches
// the rows you send; mode "full" also retires (hides) any active listing whose externalId
// is NOT in this payload — keep your storefront a mirror of your system in one call.
// Naturally idempotent (re-sending updates in place), so no Idempotency-Key needed.
// Scope: listings:write.
export async function POST(req: NextRequest) {
  const r = await resolveApiKey(req, 'listings:write')
  if (!r.ok) return apiAuthError(r)

  let body: { listings?: unknown[]; mode?: unknown }
  try { body = await req.json() } catch { return apiError(400, 'bad_request', 'Invalid JSON body.', r.rate) }

  const raw = Array.isArray(body.listings) ? body.listings : null
  if (!raw || raw.length === 0) return apiError(422, 'invalid_input', 'Provide a non-empty `listings` array, each with an externalId.', r.rate)
  if (raw.length > SYNC_MAX_ROWS) return apiError(422, 'too_many_rows', `At most ${SYNC_MAX_ROWS} listings per sync call.`, r.rate)
  const mode = body.mode === 'full' ? 'full' : 'partial'

  const seller = await db.seller.findUnique({ where: { id: r.auth.sellerId }, select: { id: true, ownerId: true, trustTier: true, trustScore: true } })
  if (!seller) return apiError(404, 'not_found', 'Shop not found.', r.rate)

  // Enforcement ladder — sync can CREATE and re-activate listings, so it runs the same
  // gate as single-listing POST (audit P0 #3: a held seller's pulled catalog must not
  // be restorable through a sync call).
  if (seller.ownerId) {
    const gate = await postingGate(seller.ownerId, seller.id)
    if (gate) return apiError(403, gate.error, 'Posting is blocked for this account right now.', r.rate)
  }

  const out = await syncListingsCore(seller, raw as SyncRow[], mode)
  return apiOk({
    mode,
    created: out.created,
    updated: out.updated,
    retired: out.retired,
    failed: out.failed,
    results: out.results,
  }, r.rate)
}
