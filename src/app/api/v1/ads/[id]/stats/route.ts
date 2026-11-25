import { NextRequest } from 'next/server'
import { resolveApiKey } from '@/lib/api/auth'
import { apiAuthError, apiError, apiOk } from '@/lib/api/respond'
import { logError } from '@/lib/log'
import { shopAdFigures } from '@/lib/ads/stats'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * ── GET /api/v1/ads/{id}/stats — one of the shop's ads, its figures LIVE (owner 2026-11-25: "realtime stats … to industry
 * standard"; src/lib/ads/stats.ts): viewable impressions, clicks, CTR, invalid traffic, reach, frequency, spend pro rata,
 * eCPM, eCPC, and the hourly series (UTC, with the hour in Vietnam). The booking shop's Bearer credential only (scope
 * analytics:read); another shop's ad is a 404. Never cached: the figures include what this server counted seconds ago.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const r = await resolveApiKey(req, 'analytics:read')
  if (!r.ok) return apiAuthError(r)
  const { id } = await ctx.params
  try {
    const figures = await shopAdFigures(id, r.auth.sellerId)
    if (!figures) return apiError(404, 'not_found', 'Ad not found in this shop.', r.rate)
    const res = apiOk({ stats: figures }, r.rate)
    res.headers.set('Cache-Control', 'private, no-store')
    return res
  } catch (e) {
    if (e instanceof Error && /42P01|42703|does not exist/.test(e.message)) return apiError(503, 'ads_unavailable', 'Ad figures are not available yet.', r.rate)
    logError(e, { op: 'ads.stats' })
    return apiError(500, 'internal', 'Something went wrong.', r.rate)
  }
}
