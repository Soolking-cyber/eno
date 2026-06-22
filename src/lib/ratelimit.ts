import 'server-only'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// Sliding-window rate limiting backed by Upstash Redis. In-memory limiting is a
// no-op on Vercel serverless (each invocation is a fresh process), so Redis is
// effectively required in production. If Upstash env vars are absent in LOCAL DEV,
// limiting is DISABLED (always allowed) so the app keeps working. In PRODUCTION a
// missing Redis fails CLOSED (the limited action is denied) — a misconfiguration
// must never silently turn off PII/abuse protection.

const url = process.env.UPSTASH_REDIS_REST_URL
const token = process.env.UPSTASH_REDIS_REST_TOKEN

const IS_PROD = process.env.NODE_ENV === 'production'

let redis: Redis | null = null
if (url && token) {
  redis = new Redis({ url, token })
} else if (IS_PROD) {
  console.error('[ratelimit] UPSTASH_REDIS_REST_URL/TOKEN not set in production — rate-limited actions will be DENIED (fail-closed).')
}

const limiters = new Map<string, Ratelimit>()

/**
 * Returns { success } for a key under a named sliding-window limit. When Redis
 * isn't configured: fails OPEN in local dev (success:true) but CLOSED in
 * production (success:false) so protection can't be silently lost.
 */
export async function rateLimit(
  name: string,
  key: string,
  limit: number,
  window: `${number} s` | `${number} m` | `${number} h` | `${number} d`,
): Promise<{ success: boolean; remaining: number }> {
  if (!redis) return { success: !IS_PROD, remaining: IS_PROD ? 0 : limit }
  let limiter = limiters.get(name)
  if (!limiter) {
    limiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(limit, window), prefix: `rl:${name}` })
    limiters.set(name, limiter)
  }
  const { success, remaining } = await limiter.limit(key)
  return { success, remaining }
}
