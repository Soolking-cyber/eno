import 'server-only'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// Sliding-window rate limiting backed by Upstash Redis. In-memory limiting is a
// no-op on Vercel serverless (each invocation is a fresh process), so Redis is
// effectively required in production. If Upstash env vars are absent (e.g. local
// dev), limiting is DISABLED (always allowed) with a one-time warning — never an
// error — so the app keeps working.

const url = process.env.UPSTASH_REDIS_REST_URL
const token = process.env.UPSTASH_REDIS_REST_TOKEN

let redis: Redis | null = null
if (url && token) {
  redis = new Redis({ url, token })
} else if (process.env.NODE_ENV === 'production') {
  console.warn('[ratelimit] UPSTASH_REDIS_REST_URL/TOKEN not set — rate limiting is DISABLED.')
}

const limiters = new Map<string, Ratelimit>()

/**
 * Returns { success } for a key under a named sliding-window limit. No-ops
 * (success:true) when Redis isn't configured.
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
