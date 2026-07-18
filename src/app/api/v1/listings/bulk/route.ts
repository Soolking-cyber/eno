import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { bulkImportCore, BULK_MAX_ROWS, type BulkRow } from '@/lib/core/bulk'
import { postingGate } from '@/lib/enforcement'
import { dispatchListingEventsBatch } from '@/lib/webhooks'
import { resolveApiKey } from '@/lib/api/auth'
import { apiOk, apiAuthError } from '@/lib/api/respond'
import { withIdempotency } from '@/lib/api/idempotency'
import { after } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Map one partner-friendly JSON item → the BulkRow shape bulkImportCore expects.
function toBulkRow(x: Record<string, unknown>): BulkRow {
  const imgs = Array.isArray(x.images) ? x.images.map((u) => String(u).trim()).filter(Boolean) : []
  return {
    category_slug: x.categorySlug != null ? String(x.categorySlug) : x.category_slug != null ? String(x.category_slug) : undefined,
    title: x.title != null ? String(x.title) : undefined,
    description: x.description != null ? String(x.description) : undefined,
    price: x.price,
    district: x.district != null ? String(x.district) : undefined,
    condition: x.condition != null ? String(x.condition) : undefined,
    image_urls: imgs.length ? imgs.join('|') : x.image_urls != null ? String(x.image_urls) : undefined,
    external_id: x.externalId != null ? String(x.externalId) : x.external_id != null ? String(x.external_id) : undefined,
  }
}

// POST /api/v1/listings/bulk — create up to BULK_MAX_ROWS listings in one call. Each row is
// independent (one bad row never aborts the batch); remote image URLs are re-hosted. Send an
// Idempotency-Key so a retry replays the first result instead of importing twice.
// Scope: listings:write. Returns per-row results.
export async function POST(req: NextRequest) {
  const r = await resolveApiKey(req, 'listings:write')
  if (!r.ok) return apiAuthError(r)

  return withIdempotency(req, r.auth.keyId, r.rate, async () => {
    let body: { listings?: unknown[]; rows?: unknown[] }
    try { body = await req.json() } catch { return { status: 400, body: { error: { code: 'bad_request', message: 'Invalid JSON body.' } } } }

    const raw = Array.isArray(body.listings) ? body.listings : Array.isArray(body.rows) ? body.rows : null
    if (!raw || raw.length === 0) return { status: 422, body: { error: { code: 'invalid_input', message: 'Provide a non-empty `listings` array.' } } }
    if (raw.length > BULK_MAX_ROWS) return { status: 422, body: { error: { code: 'too_many_rows', message: `At most ${BULK_MAX_ROWS} listings per call.` } } }

    const seller = await db.seller.findUnique({ where: { id: r.auth.sellerId }, select: { id: true, ownerId: true, trustTier: true, trustScore: true } })
    if (!seller) return { status: 404, body: { error: { code: 'not_found', message: 'Shop not found.' } } }

    // Enforcement ladder — the same gate single-listing POST runs (audit P0 #3: without
    // it a held/suspended seller could mass-restore their pulled catalog via the API).
    if (seller.ownerId) {
      const gate = await postingGate(seller.ownerId, seller.id)
      if (gate) return { status: 403, body: { error: { code: gate.error, message: 'Posting is blocked for this account right now.' } } }
    }

    const rows = raw.map((x) => toBulkRow((x ?? {}) as Record<string, unknown>))
    const result = await bulkImportCore(seller, rows)

    const createdIds = result.results.filter((x) => x.id).map((x) => x.id!) // notify partner webhooks for the live imports
    if (createdIds.length) after(() => dispatchListingEventsBatch('listing.created', createdIds, seller.id))

    return {
      status: 200,
      body: {
        created: result.created,
        failed: result.failed,
        image_budget_reached: result.imageBudgetReached,
        results: result.results.map((x) => ({ row: x.row, id: x.id ?? null, external_id: x.external_id ?? null, error: x.error ?? null })),
      },
    }
  })
}
