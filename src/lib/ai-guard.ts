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
//
// ⛔ ONE SHARED POOL LET A FEW ACCOUNTS SWITCH AI OFF FOR EVERYONE (security review 2026-10-22, item 19). One account
// could take ~110 calls/hour across the authoring routes against a 2,000/day pool — ~19 accounts emptied it in an hour,
// after which classify, rephrase, visual search, the teacher bio rewrite and CV import all answered 429 until 00:00 UTC.
// Three changes, with the TOTAL daily spend ceiling unchanged at 2,000:
//   · a per-account DAILY cap per feature (AI_ACCOUNT_DAILY_LIMIT), so one account cannot spend a day's budget;
//   · a per-feature SHARE of the shared pool (AI_FEATURE_DAILY_SHARE), so one feature cannot drain the others;
//   · teacher onboarding (bio rewrite, CV import) draws on its own RESERVE (AI_TEACHER_RESERVE_DAILY), carved out of the
//     old 2,000 — so the shared pool is now 1,500 and a busy authoring day can no longer block teacher sign-up.
export const AI_GLOBAL_DAILY_LIMIT = 1500
export const AI_TEACHER_RESERVE_DAILY = 500
export const AI_FEATURE_DAILY_SHARE = 750
export const AI_ACCOUNT_DAILY_LIMIT = 150

/**
 * Charge one call against the shared daily pool, through the feature's share first. A feature that has used its share
 * is refused without touching the pool, so it cannot starve the rest. Strict: a limiter outage refuses (paid calls).
 */
export async function chargeAiGlobal(feature: string): Promise<boolean> {
  const share = await rateLimit(`ai-global-${feature}`, 'global', AI_FEATURE_DAILY_SHARE, '1 d', { strict: true })
  if (!share.success) return false
  const pool = await rateLimit('ai-global', 'global', AI_GLOBAL_DAILY_LIMIT, '1 d', { strict: true })
  return pool.success
}

/** Teacher onboarding's reserved daily budget — not the shared pool (item 19). */
export async function chargeAiTeacherReserve(): Promise<boolean> {
  return (await rateLimit('ai-global-teachers', 'global', AI_TEACHER_RESERVE_DAILY, '1 d', { strict: true })).success
}

type Gate = { ok: true; profileId: string } | { ok: false; res: NextResponse }

export async function aiGuard(name: string, hourlyLimit: number = AI_HOURLY_LIMIT, opts?: { skipGlobal?: boolean }): Promise<Gate> {
  const profileId = await getCurrentProfileId()
  if (!profileId) return { ok: false, res: NextResponse.json({ error: 'auth_required' }, { status: 401 }) }
  const limit = await rateLimit(`ai-${name}`, profileId, hourlyLimit, '1 h', { strict: true })
  if (!limit.success) return { ok: false, res: NextResponse.json({ error: 'rate_limited' }, { status: 429 }) }
  // Per-account daily cap, BEFORE the global charge, so a capped account never consumes pool slots (item 19).
  const daily = await rateLimit(`ai-${name}-day`, profileId, AI_ACCOUNT_DAILY_LIMIT, '1 d', { strict: true })
  if (!daily.success) return { ok: false, res: NextResponse.json({ error: 'rate_limited' }, { status: 429 }) }
  if (!opts?.skipGlobal) {
    if (!(await chargeAiGlobal(name))) return { ok: false, res: NextResponse.json({ error: 'rate_limited' }, { status: 429 }) }
  }
  return { ok: true, profileId }
}
