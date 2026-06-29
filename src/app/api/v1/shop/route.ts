import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { resolveApiKey } from '@/lib/api/auth'
import { apiOk, apiError, apiAuthError } from '@/lib/api/respond'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/v1/shop — the authenticated shop's public storefront profile + trust + a
// live listing count. The identity behind the API key.
export async function GET(req: NextRequest) {
  const r = await resolveApiKey(req, 'listings:read')
  if (!r.ok) return apiAuthError(r)

  const s = await db.seller.findUnique({
    where: { id: r.auth.sellerId },
    select: {
      id: true, name: true, bio: true, location: true, phone: true, avatarUrl: true,
      trustScore: true, trustTier: true, responseRate: true, memberSince: true,
      _count: { select: { listings: { where: { verified: true, status: 'active' } } } },
    },
  })
  if (!s) return apiError(404, 'not_found', 'Shop not found.', r.rate)

  return apiOk({
    shop: {
      id: s.id,
      name: s.name,
      bio: s.bio,
      location: s.location,
      phone: s.phone,
      avatar_url: s.avatarUrl,
      trust_score: s.trustScore,
      trust_tier: s.trustTier,
      response_rate: s.responseRate,
      member_since: s.memberSince,
      active_listings: s._count.listings,
    },
  }, r.rate)
}
