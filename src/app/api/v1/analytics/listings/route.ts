import { NextRequest } from 'next/server'
import { resolveApiKey } from '@/lib/api/auth'
import { apiOk, apiError, apiAuthError } from '@/lib/api/respond'
import { getListingAnalytics } from '@/lib/listing-analytics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/v1/analytics/listings — per-listing daily views/leads (DELTAS) over a date range,
// plus each listing's current cumulative totals. Keyset-paginated by listing. Params:
// ?from=YYYY-MM-DD & ?to=YYYY-MM-DD (default last 30 days, max 92), ?limit= & ?cursor=.
// Scope: analytics:read.
export async function GET(req: NextRequest) {
  const r = await resolveApiKey(req, 'analytics:read')
  if (!r.ok) return apiAuthError(r)

  const sp = req.nextUrl.searchParams
  const out = await getListingAnalytics(r.auth.sellerId, {
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
    limit: sp.get('limit') ?? undefined,
    cursor: sp.get('cursor') ?? undefined,
  })
  if ('error' in out) return apiError(422, out.error.code, out.error.message, r.rate)
  return apiOk(out, r.rate)
}
