import 'server-only'
import { getRedis } from '@/lib/ratelimit'
import { fold } from '@/lib/fold'

// Trending-search infrastructure backed by Upstash Redis sorted sets, one per
// UTC day (`trending:{yyyymmdd}`). `logSearch` bumps a query's daily counter;
// `getTrending` unions the last couple of days and returns the hottest terms.
//
// EVERYTHING here fails OPEN: if Redis is unconfigured (getRedis() === null) or
// any call throws, logging is a silent no-op and reads return []. Search must
// NEVER break because trending is unavailable.

const DAY_KEY_PREFIX = 'trending:'
const KEY_TTL_SEC = 3 * 24 * 60 * 60 // keep ~3 days of daily buckets, then expire
const DAYS_TO_UNION = 2 // union today + yesterday for the trending window
const MIN_COUNT = 3 // don't surface a term until it has a little real volume
const MAX_QUERY_LEN = 60
const CACHE_TTL_MS = 60 * 1000 // short in-process cache to spare Redis on hot reads

// Never promote noise / navigational junk as "trending".
const DENYLIST = new Set(['test', 'asdf', 'aaa', 'xxx', 'abc', 'undefined', 'null'])

function dayKey(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${DAY_KEY_PREFIX}${y}${m}${day}`
}

/** Normalize a raw query into the canonical counter member, or null to skip. */
export function normalizeQuery(raw: string): string | null {
  if (!raw) return null
  const q = fold(raw).slice(0, MAX_QUERY_LEN).trim()
  if (q.length < 2) return null
  if (DENYLIST.has(q)) return null
  return q
}

/**
 * Record a submitted search query against today's trending counter.
 * Fire-and-forget: callers need not await. No-op when Redis is unconfigured;
 * swallows every error so it can never break the search request.
 */
export async function logSearch(raw: string, actor?: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  const member = normalizeQuery(raw)
  if (!member) return
  const key = dayKey(new Date())
  try {
    // Anti-injection: count each (actor, term) at most once per day, so MIN_COUNT means
    // that many DISTINCT searchers — not one actor spamming a term into the public
    // "trending" row. When no actor is known, fall through to a raw increment.
    if (actor) {
      const seenKey = `${key}:seen`
      const added = await redis.sadd(seenKey, `${actor}:${member}`)
      await redis.expire(seenKey, KEY_TTL_SEC)
      if (!added) return // this searcher already counted this term today
    }
    await redis.zincrby(key, 1, member)
    // Bound retention — refresh the bucket's TTL on write so old days self-expire.
    await redis.expire(key, KEY_TTL_SEC)
  } catch {
    /* fail-open: trending logging must never surface an error to search */
  }
}

let cache: { at: number; items: string[] } | null = null

/**
 * Top trending normalized queries across the last ~2 days, most-searched first,
 * filtered to a small minimum count. Returns [] when Redis is unconfigured or on
 * any error. Result is memoized in-process for CACHE_TTL_MS.
 */
export async function getTrending(limit = 6): Promise<string[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.items.slice(0, limit)
  }
  const redis = getRedis()
  if (!redis) return []
  try {
    // Merge daily counters in JS (avoids a ZUNIONSTORE write + cleanup).
    const now = new Date()
    const totals = new Map<string, number>()
    for (let i = 0; i < DAYS_TO_UNION; i++) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
      // Pull a bounded top slice per day (withScores) — plenty to rank a top-6.
      const rows = (await redis.zrange(dayKey(d), 0, 49, {
        rev: true,
        withScores: true,
      })) as (string | number)[]
      for (let j = 0; j < rows.length; j += 2) {
        const member = String(rows[j])
        const score = Number(rows[j + 1]) || 0
        totals.set(member, (totals.get(member) ?? 0) + score)
      }
    }
    const items = [...totals.entries()]
      .filter(([, c]) => c >= MIN_COUNT)
      .sort((a, b) => b[1] - a[1])
      .map(([member]) => member)
    cache = { at: Date.now(), items }
    return items.slice(0, limit)
  } catch {
    return []
  }
}
