import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { resolveApiKey } from '@/lib/api/auth'
import { apiOk, apiAuthError } from '@/lib/api/respond'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/v1/analytics/summary — shop-level rollup: total views + leads (contactCount)
// and listing counts by status. Owner-scoped by the key's sellerId.
export async function GET(req: NextRequest) {
  const r = await resolveApiKey(req, 'analytics:read')
  if (!r.ok) return apiAuthError(r)

  const where = { sellerId: r.auth.sellerId }
  const [agg, byStatus, held] = await Promise.all([
    db.listing.aggregate({ where, _sum: { views: true, contactCount: true }, _count: { _all: true } }),
    db.listing.groupBy({ by: ['status'], where, _count: { _all: true } }),
    db.listing.count({ where: { ...where, verified: false, status: 'active' } }), // failed auto-publish
  ])
  const statusCount = (s: string) => byStatus.find((g) => g.status === s)?._count._all ?? 0

  return apiOk({
    summary: {
      total_listings: agg._count._all,
      total_views: agg._sum.views ?? 0,
      total_leads: agg._sum.contactCount ?? 0,
      active: statusCount('active'),
      sold: statusCount('sold'),
      hidden: statusCount('hidden'),
      held: held,
    },
  }, r.rate)
}
