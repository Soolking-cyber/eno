import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { resolveApiKey } from '@/lib/api/auth'
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
