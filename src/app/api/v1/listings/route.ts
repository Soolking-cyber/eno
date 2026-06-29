import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { resolveApiKey } from '@/lib/api/auth'
import { apiOk, apiAuthError } from '@/lib/api/respond'
import { parsePageParams, pageQuery, buildPage } from '@/lib/api/pagination'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/v1/listings — the authenticated shop's OWN listings, ALL statuses (active,
// sold, hidden, held). Keyset-paginated (?limit, ?cursor). Owner-scoped by the key's
// sellerId — a key can never read another shop's inventory.
export async function GET(req: NextRequest) {
  const r = await resolveApiKey(req, 'listings:read')
  if (!r.ok) return apiAuthError(r)

  const { limit, cursorId } = parsePageParams(req.nextUrl.searchParams)
  const rows = await db.listing.findMany({
    where: { sellerId: r.auth.sellerId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { category: true, seller: { include: { owner: { select: { accountType: true } } } } },
    ...pageQuery(limit, cursorId),
  })
  const { items, nextCursor } = buildPage(rows, limit)
  return apiOk({ listings: items.map(serializeListing), next_cursor: nextCursor }, r.rate)
}
