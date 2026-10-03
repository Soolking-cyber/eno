import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { getTrending, logSearch } from '@/lib/trending'
import { getCategoriesByDemand } from '@/lib/categories'
import { RETIRED_NAV_CATEGORIES } from '@/lib/retired-categories'
import { clientIp } from '@/lib/client-ip'
import { route } from '@/lib/api/handler'

export const runtime = 'nodejs'

// Public "Xu hướng tìm kiếm" (trending searches) feed — plus the category shortcuts — for the
// empty-focus search dropdown. Reads the Upstash-backed daily counters via getTrending() — fails
// OPEN to an empty list when Redis is unconfigured or errors, so the search UI
// simply omits the trending row rather than breaking. CDN-cached ~5min since the
// data is coarse-grained and identical for everyone.
//
// ⚠️ WS6 MIGRATION (both exports). `auth: 'public'` on each — the trending row is the empty-focus
// state of the search dropdown, which guests see first. No rate limit and no body option were
// added; neither existed.
//
// ⚠️ NO ACCEPTED WIRE CHANGE ON EITHER VERB, WHICH IS UNUSUAL AND WORTH SAYING. `getTrending()` and
// `logSearch()` are documented fail-OPEN (src/lib/trending.ts wraps every query and returns
// `[]`/void on error), and the POST adds its own total try/catch on top. So route()'s
// `internal_error` boundary is unreachable from here and all four branches are byte-identical.
/**
 * The category shortcuts under the trending chips (S-TYPEAHEAD, 2026-09-29): the first six categories
 * of the home grid's own order (getCategoriesByDemand — the owner's four pinned, then live demand),
 * only those with live listings, as `{ slug, name, nameVi }`. Edition-scoped and memoized by that
 * function, so this is the rail the visitor already sees, not a second opinion about it.
 * ⚠️ FAIL-OPEN LIKE EVERYTHING ELSE ON THIS VERB, INCLUDING A DeskResolutionError that
 * getCategoriesByDemand deliberately re-throws: that error is meant to break a PAGE loudly (the home
 * page does), not to take the trending terms down with an optional row of chips.
 */
async function shortcutCategories(): Promise<{ slug: string; name: string; nameVi: string }[]> {
  try {
    return (await getCategoriesByDemand())
      // ⛔ Not a retired shelf either (second-hand focus, 2026-10-03 — src/lib/retired-categories.ts).
      .filter((c) => c.verifiedCount > 0 && !RETIRED_NAV_CATEGORIES.has(c.slug))
      .slice(0, 6)
      .map(({ slug, name, nameVi }) => ({ slug, name, nameVi }))
  } catch {
    return []
  }
}

// ⚠️ ADDITIVE WIRE CHANGE, 2026-09-29: `categories` sits beside `trending`, which is unchanged — the
// hero panel and any native client read `trending` alone and ignore the new key. Still fail-open on
// both halves, so the `internal_error` boundary stays unreachable from this verb.
export const GET = route({ auth: 'public' }, async () => {
  const [trending, categories] = await Promise.all([getTrending(6), shortcutCategories()])
  return NextResponse.json(
    { trending, categories },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
  )
})

// Record a committed search against the trending counters. Fire-and-forget from the
// client (keepalive fetch on submit) — logSearch normalizes, no-ops when Redis is
// unconfigured, and swallows every error, so this can never break search. Always
// 204, even on a malformed body.
//
// ⛔ NO `body:` SCHEMA, DELIBERATELY. The contract is "always 204, even on a malformed body" — it is
// a keepalive fetch fired during navigation, so a truncated or absent body is a NORMAL outcome, not
// a client bug. route()'s `body:` option answers 400 on unparseable JSON, which would turn that
// normal outcome into an error the client cannot see and would not act on. The tolerant
// `try { await req.json() } catch {}` stays here verbatim, along with the `typeof q === 'string'`
// guard that is the actual validation.
//
// ⚠️ 204 HAS NO BODY, so the handler returns the `NextResponse` through route()'s escape hatch
// rather than a plain object — `NextResponse.json(data ?? {})` would make it a 200 `{}`.
export const POST = route({ auth: 'public' }, async ({ req }) => {
  try {
    const { q } = (await req.json()) as { q?: unknown }
    if (typeof q === 'string') {
      // Per-searcher dedup key = a hash of the client IP (never store the raw IP; the
      // set entry is ephemeral, ~3d TTL). One vote per IP per term per day.
      // Shared helper (audit Phase 1): the inline read skipped x-real-ip and drifted
      // from the pinned cf-connecting-ip discipline everywhere else.
      const actor = createHash('sha1').update(clientIp(req)).digest('hex').slice(0, 16)
      await logSearch(q, actor)
    }
  } catch {
    /* fail-open */
  }
  return new NextResponse(null, { status: 204 })
})
