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
// One GLOBAL daily ceiling shared by the DIRECT-Gemini routes (classify, rephrase,
// visual-search). Per-account caps bound one account; many OTP-verified accounts could
// still aggregate real Gemini spend — this bounds the total regardless of account count.
// The per-account check runs FIRST so a capped account never consumes global slots.
// Concierge OPTS OUT ({ skipGlobal }): it has its own daily breakers with a GRACEFUL
// degrade (heuristic answers instead of a 429), and charging it here would both hard-fail
// chat at the cap and let a chatty day switch off the sellers' authoring AI.
export const AI_GLOBAL_DAILY_LIMIT = 2000

type Gate = { ok: true; profileId: string } | { ok: false; res: NextResponse }

export async function aiGuard(name: string, hourlyLimit: number = AI_HOURLY_LIMIT, opts?: { skipGlobal?: boolean }): Promise<Gate> {
  const profileId = await getCurrentProfileId()
  if (!profileId) return { ok: false, res: NextResponse.json({ error: 'auth_required' }, { status: 401 }) }
  const limit = await rateLimit(`ai-${name}`, profileId, hourlyLimit, '1 h', { strict: true })
  if (!limit.success) return { ok: false, res: NextResponse.json({ error: 'rate_limited' }, { status: 429 }) }
  if (!opts?.skipGlobal) {
    const global = await rateLimit('ai-global', 'global', AI_GLOBAL_DAILY_LIMIT, '1 d', { strict: true })
    if (!global.success) return { ok: false, res: NextResponse.json({ error: 'rate_limited' }, { status: 429 }) }
  }
  return { ok: true, profileId }
}
