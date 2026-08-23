import 'server-only'
import { db } from '@/lib/db'

// Rate limiting + tiny KV, backed by Supabase Postgres (Upstash Redis retired,
// owner directive 2026-07-20). The atomic semantics live in SECURITY DEFINER
// SQL functions over UNLOGGED tables (no WAL — near-Redis write cost; truncated
// on crash recovery, which is fine for throttles/caches):
//   rl_check           — Upstash-style weighted sliding window
//   rl_cooldown_claim  — one-winner escalating cooldown (row-lock serialized)
//   kv_get/set/del/incrby — Redis-shaped KV with TTL semantics
// Expiry is enforced on read AND swept by pg_cron ('rl-kv-sweep', every 15 min).
// DDL restore after a DB reset: `npm run db:setup` (scripts/rate-limit-pg.mjs).
// The forum app calls the SAME functions via supabase.rpc — keep signatures in
// sync with apps/forum/src/lib/ratelimit.ts.
//
// One deliberate divergence from @upstash/ratelimit: a DENIED attempt still
// increments the window counter, so sustained hammering extends the throttle.
// Strictly safer for abuse limits; honest clients never notice.

const WINDOW_UNIT_S: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }

export function windowSeconds(window: `${number} ${'s' | 'm' | 'h' | 'd'}`): number {
  const [n, u] = window.split(' ')
  return Number(n) * (WINDOW_UNIT_S[u] ?? 60)
}

/**
 * The wire-facing view of one limiter decision. Everything a caller needs to build the
 * `RateLimit` / `RateLimit-Policy` headers, and nothing that would let a caller accidentally
 * publish an internal counter.
 *
 * ⛔ THE HEADERS ARE `draft-ietf-httpapi-ratelimit-headers`, NOT "RFC 9331". That citation was
 * here and was simply wrong — RFC 9331 is L4S explicit congestion notification and has nothing to
 * do with HTTP rate limiting. The same wrong reference was written into src/lib/api/respond.ts in
 * the same change; both are corrected, so neither can be used to confirm the other.
 *
 * ⚠️ `resetSec` IS "WHEN THE WINDOW SLOT ADVANCES", NOT "WHEN THE QUOTA IS EMPTY AGAIN".
 * `rl_check` is a WEIGHTED sliding window (Upstash's algorithm, ported): usage decays
 * continuously as the current slot ages, so `remaining` creeps up between requests rather
 * than snapping back at a boundary. There is therefore no single instant at which the quota
 * "resets", and any number claiming to be one would be invented. What IS exactly knowable is
 * the end of the current fixed slot — `floor(now/W)*W + W` — which is what @upstash/ratelimit
 * itself reports as `reset`, so partners porting from it get the semantics they already have.
 * Treat it as "your oldest counted requests start rolling off no later than this".
 */
export type RateLimitSnapshot = {
  limit: number
  remaining: number
  /** Seconds until the current window slot advances. See the caveat above. */
  resetSec: number
  /** Window length in seconds — the `w=` of `RateLimit-Policy`. */
  windowSec: number
}

export type RateLimitResult = RateLimitSnapshot & { success: boolean }

/**
 * Returns { success } for a key under a named sliding-window limit, plus the limit/window/
 * reset a caller needs to publish rate-limit headers (see RateLimitSnapshot).
 *
 * Default: fails OPEN (success:true) when the DB call errors — a flaky backend
 * must never block legitimate use (messaging, posting). In practice the limiter
 * shares the app's Postgres, so "limiter down" usually means the route is down
 * anyway.
 *
 * Pass { strict: true } on SECURITY/PAID routes (contact-reveal, paid Gemini/
 * translate/geocode, upload) to fail CLOSED: if the backend errors the request
 * is DENIED rather than silently un-limited, so an outage can never reopen a
 * billing-drain or PII-harvest vector.
 */
export async function rateLimit(
  name: string,
  key: string,
  limit: number,
  window: `${number} s` | `${number} m` | `${number} h` | `${number} d`,
  opts?: { strict?: boolean },
): Promise<RateLimitResult> {
  const windowSec = windowSeconds(window)
  try {
    /**
     * ⚠️ `reset_sec` IS COMPUTED IN THIS STATEMENT, NOT IN JS, AND THAT IS THE WHOLE POINT.
     * `rl_check` derives its slot as `to_timestamp(floor(extract(epoch from now())/W)*W)`.
     * `now()` is `transaction_timestamp()` — one value for the whole statement, shared by the
     * function body and by this select list — so the expression below is the SAME slot the
     * limiter just counted against, to the microsecond. Computing it here from `Date.now()`
     * would instead mix the app server's clock with the database's, and a second of skew is
     * enough to publish a `reset` that has already passed (or that never arrives) on a 1-minute
     * window. It costs no extra round trip and no extra row: it is arithmetic on a value the
     * statement already has.
     *
     * `mod()` on the epoch gives seconds elapsed inside the slot; W minus that is what remains.
     * `greatest(1, ...)` because a header saying "retry in 0 seconds" invites an immediate retry
     * that is guaranteed to be refused.
     */
    const rows = await db.$queryRaw<Array<{ success: boolean; remaining: number; reset_sec: number }>>`
      select r.success,
             r.remaining,
             greatest(1, ceil(${windowSec}::int - mod(extract(epoch from now())::numeric, ${windowSec}::int)))::int as reset_sec
        from rl_check(${name}, ${key}, ${limit}::int, ${windowSec}::int) r`
    const r = rows[0]
    if (!r) throw new Error('rl_check returned no row')
    // ⚠️ `?? windowSec` IS NOT DEFENSIVE PADDING — IT IS THE CONTRACT WITH THE HEADER LAYER.
    // `resetSec` is published verbatim as the `reset=` field of the RFC rate-limit header, and an
    // `undefined` there renders as the literal string "undefined" in a response header rather than
    // throwing anywhere a test would catch. Any row shape that lacks `reset_sec` (an older
    // `rl_check`, a mocked row, a mid-migration database) therefore degrades to a full window —
    // the same bound the catch branch below uses, and the only one that cannot be too short.
    return { success: r.success, remaining: r.remaining, limit, resetSec: r.reset_sec ?? windowSec, windowSec }
  } catch (e) {
    // Transient backend error: strict routes DENY (no silent un-limiting); others allow.
    // ⚠️ The reported reset falls back to a FULL window. We genuinely do not know where in the
    // slot we are (the query that would have told us is the one that failed), and a full window
    // is the only bound that cannot be too short — a client that backs off for it is never told
    // to retry into a wall.
    console.error('[ratelimit] backend error for', name, e)
    return { success: !opts?.strict, remaining: 0, limit, resetSec: windowSec, windowSec }
  }
}

/**
 * Escalating per-key resend cooldown — the OTP industry pattern (Twilio Verify /
 * Auth0 guidance): each successive send within the window must wait longer than
 * the last (e.g. 60s → 5m → 15m → 30m cap). A real user retries once or twice;
 * a script hammers. The attempt counter resets 24h after the burst's first send.
 *
 * One-winner under concurrency (audit P2 #14): the claim is a single SQL call
 * serialized by the cooldown row's lock, so N racing requests admit exactly one
 * — the losers read the winner's fresh cooldown for an honest retry-after.
 *
 * Fails CLOSED (used only on paid-delivery security routes): if the backend
 * errors, the send is denied rather than un-throttled.
 */
export async function escalatingCooldown(
  name: string,
  key: string,
  stepsSec: number[],
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  try {
    // steps travel as a csv literal — portable across drivers, cast server-side.
    const steps = stepsSec.map((s) => Math.max(1, Math.floor(s))).join(',')
    const rows = await db.$queryRaw<Array<{ allowed: boolean; retry_after_sec: number }>>`
      select allowed, retry_after_sec from rl_cooldown_claim(${name}, ${key}, string_to_array(${steps}, ',')::int[])`
    const r = rows[0]
    if (!r) throw new Error('rl_cooldown_claim returned no row')
    return { allowed: r.allowed, retryAfterSec: r.retry_after_sec }
  } catch (e) {
    console.error('[ratelimit] cooldown backend error for', name, e)
    return { allowed: false, retryAfterSec: stepsSec[0] ?? 60 }
  }
}

/**
 * Redis-shaped KV over Postgres (UNLOGGED kv_store) for the few non-limiter
 * uses: OTP delivery-channel memos, daily spend budgets, idempotency claims,
 * transcode job leases, spam counters. Mirrors the Upstash call shapes the
 * code was written against:
 *   set(k, v, { nx, ex })  → 'OK' | null   (null = NX lost; expired keys lose)
 *   get<T>(k)              → T | null      (JSON in, JSON out)
 *   incrby(k, n, exSec?)   → number        (TTL refreshed EVERY call when given
 *                                           — the old INCR+EXPIRE pairs, fused)
 *   del(k)                 → void
 * All ops THROW on backend failure — call sites keep their own fail-open /
 * fail-closed stance, exactly as they did with Redis.
 */
export const kv = {
  async get<T = unknown>(key: string): Promise<T | null> {
    const rows = await db.$queryRaw<Array<{ v: T | null }>>`select kv_get(${key}) as v`
    return (rows[0]?.v ?? null) as T | null
  },
  async set(key: string, value: unknown, opts?: { nx?: boolean; ex?: number }): Promise<'OK' | null> {
    const rows = await db.$queryRaw<Array<{ won: boolean }>>`
      select kv_set(${key}, ${JSON.stringify(value)}::jsonb, ${opts?.ex ?? null}::int, ${opts?.nx ?? false}) as won`
    return rows[0]?.won ? 'OK' : null
  },
  async incrby(key: string, by: number, exSec?: number): Promise<number> {
    const rows = await db.$queryRaw<Array<{ v: bigint | number }>>`
      select kv_incrby(${key}, ${Math.round(by)}::bigint, ${exSec ?? null}::int) as v`
    return Number(rows[0]?.v ?? 0)
  },
  async del(key: string): Promise<void> {
    // ⚠️ $executeRaw, NOT $queryRaw. `kv_del` is declared `returns void`, and $queryRaw
    // tries to DESERIALIZE the result column — Postgres `void` has no Prisma type, so this
    // ALWAYS threw "Failed to deserialize column of type 'void'" (found 2026-07-24 probing
    // the KV primitives against the real database).
    //
    // The delete itself was fine: the statement executes and commits, and only the reply
    // parsing blows up — a probe confirmed the key is gone after the throw. Both call sites
    // wrap this in `.catch(() => {})`, so behaviour was correct by accident. It is fixed
    // anyway because a promise that always rejects is a trap for the next caller: anyone
    // who awaits it without a catch, or adds error logging, inherits a guaranteed failure.
    // $executeRaw returns a row count and deserializes nothing, which is what a
    // void-returning statement wants.
    await db.$executeRaw`select kv_del(${key})`
  },

  /**
   * Batch `get` — ONE round trip for many keys, returned as a Map of the keys that HIT
   * (misses are simply absent). Built on the same `kv_get` function as `get`, so TTL and
   * expiry semantics are identical; it is not a second implementation.
   *
   * Exists because a per-request lookup loop is fine for 1–2 keys and unacceptable for 50:
   * the live chat translator checks up to 50 message hashes on a single, latency-sensitive
   * request (src/app/api/messages/translate/route.ts).
   */
  async mget<T = unknown>(keys: string[]): Promise<Map<string, T>> {
    const out = new Map<string, T>()
    if (!keys.length) return out
    const rows = await db.$queryRaw<Array<{ k: string; v: T | null }>>`
      select k, kv_get(k) as v from unnest(${keys}::text[]) as k`
    for (const r of rows) if (r.v != null) out.set(r.k, r.v)
    return out
  },

  /**
   * Batch `set` with a shared TTL — ONE round trip. Never NX (a plain overwrite), which is
   * what a cache write wants. `entries` are [key, value] pairs; values are JSON-encoded
   * exactly as `set` does.
   */
  async mset(entries: Array<[string, unknown]>, exSec: number): Promise<void> {
    if (!entries.length) return
    const keys = entries.map(([k]) => k)
    const vals = entries.map(([, v]) => JSON.stringify(v))
    await db.$queryRaw`
      select kv_set(t.k, t.v::jsonb, ${exSec}::int, false)
        from unnest(${keys}::text[], ${vals}::text[]) as t(k, v)`
  },
}
