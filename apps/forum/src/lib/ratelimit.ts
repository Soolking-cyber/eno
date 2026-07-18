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

/** Raw client for the few non-limiter uses (e.g. remembering which channel an
 *  OTP was delivered on). Null when Upstash is unconfigured — callers degrade. */
export const getRedis = () => redis

const limiters = new Map<string, Ratelimit>()

/**
 * Returns { success } for a key under a named sliding-window limit.
 *
 * Default: fails OPEN (success:true) when Redis is unconfigured or errors — a missing/
 * flaky Redis must never block legitimate use (messaging, posting).
 *
 * Pass { strict: true } on SECURITY/PAID routes (contact-reveal, paid Gemini/translate/
 * geocode, upload) to fail CLOSED: if Redis is unavailable the request is DENIED rather
 * than silently un-limited, so a missing env var or Redis outage can never reopen a
 * billing-drain or PII-harvest vector.
 */
export async function rateLimit(
  name: string,
  key: string,
  limit: number,
  window: `${number} s` | `${number} m` | `${number} h` | `${number} d`,
  opts?: { strict?: boolean },
): Promise<{ success: boolean; remaining: number }> {
  if (!redis) return { success: !opts?.strict, remaining: opts?.strict ? 0 : limit }
  let limiter = limiters.get(name)
  if (!limiter) {
    limiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(limit, window), prefix: `rl:${name}` })
    limiters.set(name, limiter)
  }
  try {
    const { success, remaining } = await limiter.limit(key)
    return { success, remaining }
  } catch (e) {
    // Redis transient error: strict routes DENY (no silent un-limiting); others allow.
    console.error('[ratelimit] backend error for', name, e)
    return { success: !opts?.strict, remaining: 0 }
  }
}

/**
 * Escalating per-key resend cooldown — the OTP industry pattern (Twilio Verify /
 * Auth0 guidance): each successive send within the window must wait longer than
 * the last (e.g. 60s → 5m → 15m → 30m cap). A real user retries once or twice;
 * a script hammers. The attempt counter resets after 24h of quiet.
 *
 * Fails CLOSED (used only on paid-delivery security routes): if Redis is down,
 * the send is denied rather than un-throttled.
 */
export async function escalatingCooldown(
  name: string,
  key: string,
  stepsSec: number[],
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  if (!redis) return { allowed: false, retryAfterSec: stepsSec[0] ?? 60 }
  const untilKey = `cd:${name}:${key}:until`
  const countKey = `cd:${name}:${key}:n`
  try {
    // Atomic claim (audit P2 #14): the old ttl-check → set was a race — N concurrent
    // requests all saw ttl<=0 and were ALL admitted (N paid deliveries). SET NX is the
    // one-winner gate; the loser reads the ttl for an honest retry-after.
    const claimed = await redis.set(untilKey, '1', { nx: true, ex: stepsSec[0] ?? 60 })
    if (claimed === null) {
      const ttl = await redis.ttl(untilKey)
      return { allowed: false, retryAfterSec: ttl > 0 ? ttl : (stepsSec[0] ?? 60) }
    }
    const n = await redis.incr(countKey)
    if (n === 1) await redis.expire(countKey, 86400)
    const cooldown = stepsSec[Math.min(n - 1, stepsSec.length - 1)] ?? 60
    // Stretch the claim to this attempt's real step length (NX seeded the first step).
    if (cooldown !== (stepsSec[0] ?? 60)) await redis.expire(untilKey, cooldown)
    return { allowed: true, retryAfterSec: 0 }
  } catch (e) {
    console.error('[ratelimit] cooldown backend error for', name, e)
    return { allowed: false, retryAfterSec: stepsSec[0] ?? 60 }
  }
}
