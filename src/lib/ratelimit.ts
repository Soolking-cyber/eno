import 'server-only'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// Sliding-window rate limiting backed by Upstash Redis. In-memory limiting is a
// no-op on Vercel serverless (each invocation is a fresh process), so Redis is
// effectively required for real limits. If Upstash env vars are absent, limiting
// is DISABLED (fails OPEN — always allowed) so the app keeps working; a missing
// Redis must never block real users (e.g. sending messages). Set UPSTASH_REDIS_*
// in prod to actually enable abuse/PII-reveal protection.

// Accept BOTH the native Upstash names and the names Vercel's Marketplace/KV
// integration injects (KV_REST_API_*) — the #1 reason "I added Upstash but limiting
// still doesn't work" is a name mismatch between those two conventions.
const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN

let redis: Redis | null = null
if (url && token) {
  redis = new Redis({ url, token })
} else if (process.env.NODE_ENV === 'production') {
  console.warn('[ratelimit] No Upstash credentials (UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN) — rate limiting is DISABLED. Set them (Production scope) and redeploy to enable it.')
}

const limiters = new Map<string, Ratelimit>()

/**
 * Returns { success } for a key under a named sliding-window limit. No-ops
 * (success:true) when Redis isn't configured — fails OPEN so it can never block
 * legitimate use; configure Upstash to turn protection on.
 */
export async function rateLimit(
  name: string,
  key: string,
  limit: number,
  window: `${number} s` | `${number} m` | `${number} h` | `${number} d`,
): Promise<{ success: boolean; remaining: number }> {
  if (!redis) return { success: true, remaining: limit }
  let limiter = limiters.get(name)
  if (!limiter) {
    limiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(limit, window), prefix: `rl:${name}` })
    limiters.set(name, limiter)
  }
  const { success, remaining } = await limiter.limit(key)
  return { success, remaining }
}
