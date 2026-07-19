import 'server-only'
import { fold } from '@/lib/fold'
import { db } from '@/lib/db'

// Trending-search infrastructure on Postgres (search_trend / search_trend_seen
// tables + trend_log / trend_top functions — see scripts/rate-limit-pg.mjs).
// One row per (UTC day, term); `logSearch` bumps a query's daily counter with
// per-actor dedup, `getTrending` sums the last couple of days and returns the
// hottest terms.
//
// EVERYTHING here fails OPEN: if the DB call throws, logging is a silent no-op
// and reads return []. Search must NEVER break because trending is unavailable.

const DAYS_TO_UNION = 2 // today + yesterday form the trending window
const MIN_COUNT = 3 // don't surface a term until it has a little real volume
const MAX_QUERY_LEN = 60
const CACHE_TTL_MS = 60 * 1000 // short in-process cache to spare the DB on hot reads

// Never promote noise / navigational junk as "trending".
const DENYLIST = new Set(['test', 'asdf', 'aaa', 'xxx', 'abc', 'undefined', 'null'])

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
 * Fire-and-forget: callers need not await. Swallows every error so it can
 * never break the search request.
 *
 * Anti-injection: when an actor is known, trend_log counts each (actor, term)
 * at most once per UTC day — so MIN_COUNT means that many DISTINCT searchers,
 * not one actor spamming a term into the public "trending" row.
 */
export async function logSearch(raw: string, actor?: string): Promise<void> {
  const member = normalizeQuery(raw)
  if (!member) return
  try {
    await db.$queryRaw`select trend_log(${member}, ${actor ?? null})`
  } catch {
    /* fail-open: trending logging must never surface an error to search */
  }
}

let cache: { at: number; items: string[] } | null = null

/**
 * Top trending normalized queries across the last ~2 days, most-searched first,
 * filtered to a small minimum count. Returns [] on any error. Result is
 * memoized in-process for CACHE_TTL_MS.
 */
export async function getTrending(limit = 6): Promise<string[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.items.slice(0, limit)
  }
  try {
    // Over-fetch: the live-hit filter below may drop some candidates.
    const rows = await db.$queryRaw<Array<{ term: string }>>`
      select term from trend_top(${DAYS_TO_UNION}::int, ${MIN_COUNT}::int, ${limit * 3}::int)`
    const candidates = rows.map((r) => r.term)

    // Only surface terms that actually RETURN RESULTS right now. A trending chip is the
    // first tap we suggest — if it lands on the empty state it burns trust AND re-logs
    // itself on tap (a self-reinforcing dead end). Members are already folded, so mirror
    // the search API's token-AND against the folded searchText blob. Cheap: runs at most
    // once per CACHE_TTL_MS per instance, and the route is CDN-cached ~5 min.
    const hits = await Promise.all(
      candidates.map(async (term) => {
        try {
          const tokens = term.split(/\s+/).filter((t) => t.length >= 2).slice(0, 6)
          const clauses = (tokens.length ? tokens : [term]).map((t) => ({ searchText: { contains: t } }))
          const n = await db.listing.count({ where: { AND: [{ verified: true }, { status: 'active' }, ...clauses] } })
          return n > 0
        } catch {
          return true // DB blip → keep the term rather than blanking the whole row
        }
      }),
    )
    const items = candidates.filter((_, i) => hits[i])
    cache = { at: Date.now(), items }
    return items.slice(0, limit)
  } catch {
    return []
  }
}
