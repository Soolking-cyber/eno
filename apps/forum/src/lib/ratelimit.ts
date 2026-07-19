import 'server-only'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

// Sliding-window rate limiting + tiny KV on the shared Postgres primitives
// (rl_check / kv_incrby SECURITY DEFINER functions — Upstash Redis retired,
// owner directive 2026-07-20; DDL lives in the marketplace repo root,
// scripts/rate-limit-pg.mjs). The forum has no Prisma, so calls go through
// supabase-js RPC with the service key (EXECUTE is granted to service_role
// only). Keep signatures in sync with the main app's src/lib/ratelimit.ts.
//
// One deliberate divergence from @upstash/ratelimit: a DENIED attempt still
// increments the window counter, so sustained hammering extends the throttle.
// Strictly safer for abuse limits; honest clients never notice.

const WINDOW_UNIT_S: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }

function windowSeconds(window: string): number {
  const [n, u] = window.split(' ')
  return Number(n) * (WINDOW_UNIT_S[u] ?? 60)
}

/**
 * Returns { success } for a key under a named sliding-window limit.
 *
 * Default: fails OPEN (success:true) when the backend call errors — a flaky
 * backend must never block legitimate use.
 *
 * Pass { strict: true } on SECURITY/PAID routes (visa flows, paid Gemini/
 * translate) to fail CLOSED: if the backend is unavailable the request is
 * DENIED rather than silently un-limited, so a missing env var or outage can
 * never reopen a billing-drain vector.
 */
export async function rateLimit(
  name: string,
  key: string,
  limit: number,
  window: `${number} s` | `${number} m` | `${number} h` | `${number} d`,
  opts?: { strict?: boolean },
): Promise<{ success: boolean; remaining: number }> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc('rl_check', {
      p_name: name,
      p_key: key,
      p_limit: limit,
      p_window_sec: windowSeconds(window),
    })
    if (error) throw new Error(error.message)
    const r = (data as Array<{ success: boolean; remaining: number }> | null)?.[0]
    if (!r) throw new Error('rl_check returned no row')
    return { success: r.success, remaining: r.remaining }
  } catch (e) {
    // Backend error: strict routes DENY (no silent un-limiting); others allow.
    console.error('[ratelimit] backend error for', name, e)
    return { success: !opts?.strict, remaining: 0 }
  }
}

/**
 * Minimal KV over the shared kv_store table. incrby refreshes the TTL on every
 * call (the old INCR+EXPIRE pairs, fused server-side). THROWS on backend
 * failure — call sites keep their own fail-open / fail-closed stance.
 */
export const kv = {
  async incrby(key: string, by: number, exSec?: number): Promise<number> {
    const { data, error } = await getSupabaseAdmin().rpc('kv_incrby', {
      p_key: key,
      p_by: Math.round(by),
      p_ttl_sec: exSec ?? null,
    })
    if (error) throw new Error(error.message)
    return Number(data ?? 0)
  },
}
