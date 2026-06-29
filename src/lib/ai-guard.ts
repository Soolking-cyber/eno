import { NextResponse } from 'next/server'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'

// Single gate for every paid AI endpoint (concierge, classify, rephrase, visual-search).
// AI is LOGIN-ONLY + a hard per-account hourly cap so a bad actor (or a bot crawling the
// concierge) can't drain the Vertex/Gemini credits. Keyed on the Profile id, not the IP —
// once login is required the account is the accountable unit, and per-IP is spoofable
// behind the edge anyway. STRICT (fail-closed): if Redis is unreachable we DENY rather
// than let paid calls through. The global daily budget breakers inside each route are the
// second line of defence (total spend ceiling regardless of how many accounts pile on).
//
// Default 10/h fits the DISCOVERY routes (concierge, visual-search) — the open-ended
// credit-drain surface. The post-wizard AUTHORING routes pass their own higher limits
// (classify 40, rephrase 60) since a seller legitimately polishes/classifies many items.
export const AI_HOURLY_LIMIT = 10

type Gate = { ok: true; profileId: string } | { ok: false; res: NextResponse }

export async function aiGuard(name: string, hourlyLimit: number = AI_HOURLY_LIMIT): Promise<Gate> {
  const profileId = await getCurrentProfileId()
  if (!profileId) return { ok: false, res: NextResponse.json({ error: 'auth_required' }, { status: 401 }) }
  const limit = await rateLimit(`ai-${name}`, profileId, hourlyLimit, '1 h', { strict: true })
  if (!limit.success) return { ok: false, res: NextResponse.json({ error: 'rate_limited' }, { status: 429 }) }
  return { ok: true, profileId }
}
