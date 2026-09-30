import { marketplaceListingScope, teacherExclusion } from '@/lib/edition-scope'
import 'server-only'
import { fold } from '@/lib/fold'
import { db } from '@/lib/db'
import { textClauses } from '@/lib/search-match'

// Trending-search infrastructure on Postgres (search_trend / search_trend_seen
// tables + trend_log / trend_top functions — see scripts/rate-limit-pg.mjs).
// One row per (UTC day, term); `logSearch` bumps a query's daily counter with
// per-actor dedup, `getTrending` sums the last four days and returns the
// hottest terms.
//
// EVERYTHING here fails OPEN: if the DB call throws, logging is a silent no-op
// and reads return []. Search must NEVER break because trending is unavailable.

/**
 * The trending window, in UTC days including today. ⚠️ 4 IS THE CEILING, NOT A CHOICE: rl_sweep
 * (scripts/rate-limit-pg.mjs) deletes `search_trend` rows older than today − 3, so a longer window
 * would silently read the same four days. Widened from 2 on 2026-09-29 (S-TYPEAHEAD): two days of
 * current traffic cleared MIN_COUNT for ONE term ("iphone"), so the empty-focus panel's trending row
 * was a single chip.
 * ⚠️ WHAT THE WIDER WINDOW COSTS THE GUARD BELOW, STATED RATHER THAN DISCOVERED. trend_log dedupes an
 * (actor, term) pair PER UTC DAY, so the sum over the window counts distinct searcher-DAYS. At two
 * days one hashed IP could contribute at most 2 — below MIN_COUNT on its own. At four it can
 * contribute 4, so one person repeating a term on three separate days now reaches the row. Kept at
 * 3 regardless, because the row was never proof against that: three IPs in ONE day always reached
 * it (one phone toggling mobile data is three IPs), and what can surface is bounded by the live-hit
 * filter in getTrending — only a term that matches live, verified listings is ever shown. Raising
 * MIN_COUNT to 5 restores the one-actor bound, at the cost of the row this change exists to fill.
 */
// ⛔ BACK TO 2 (codex + Opus, gate 2026-09-30): at 4 days one hashed IP searching a term on 3 days reached
// MIN_COUNT alone and could put any live-matching term in the PUBLIC trending row. 2 days keeps the
// one-actor bound (max 2 < 3); the empty-focus panel still has recents and category shortcuts.
const DAYS_TO_UNION = 2
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
 * at most once per UTC day — so MIN_COUNT means that many distinct searcher-DAYS
 * (see DAYS_TO_UNION for what that allows), not one actor spamming a term into
 * the public "trending" row within a day.
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
 * Top trending normalized queries across the last 4 days, most-searched first,
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
    // the search API's text filter (src/lib/search-match.ts — the same units, word starts and
    // synonyms) against the folded searchText blob. Cheap: runs at most once per
    // CACHE_TTL_MS per instance, and the route is CDN-cached ~5 min.
    /**
     * ⚠️ RESOLVED ONCE, ABOVE THE Promise.all, BECAUSE OF THE catch BELOW. Each term's callback ends
     * in `catch { return true }` — a DB blip keeps the term rather than blanking the row. If the
     * scope were resolved INSIDE that callback, a DeskResolutionError would be swallowed by exactly
     * that catch and every term would silently survive unfiltered. Out here it propagates.
     */
    const editionScope = await marketplaceListingScope()
    const teacherScope = await teacherExclusion() // a person's profile is not a trending product
    const hits = await Promise.all(
      candidates.map(async (term) => {
        try {
          const clauses = textClauses(term)
          const n = await db.listing.count({ where: { AND: [{ verified: true }, { status: 'active' }, ...(editionScope.sellerId ? [{ sellerId: editionScope.sellerId }] : []), ...(teacherScope ? [teacherScope] : []), ...clauses] } })
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
