import 'server-only'
import { db } from './db'
import { buildFeedFilters } from '@/app/api/listings/feed-query'

/**
 * ── WHICH BRANDS A BUYER IS OFFERED ───────────────────────────────────────────────────────────────────
 *
 * ⛔ A BRAND IS LISTED ON A BUYER-FACING SURFACE ONLY WHILE IT HAS A LIVE LISTING, AND THAT IS DECIDED
 * HERE, FROM THE LISTINGS — NEVER FROM `Brand.listingCount`. The post-deploy verify of 2026-10-04 found
 * /brands advertising 66 curated brands with nothing behind them (Casio, Adidas, Audi, BMW, Chanel…):
 * the page selected `curatedAt != null OR listingCount > 0`, so every curated brand was an "Explore"
 * tile that opened an empty explorer.
 *
 * ⚠️ WHY NOT `listingCount`, NOW THAT THE RECOUNT HAS MADE IT TRUE. It is true at the moment
 * scripts/recount-brand-listings.ts runs and drifts from the next sale. Its writers, every one of them
 * (grep `bumpBrandCount`): a publish adds one, a brand edit moves one, an owner's delete and an admin's
 * bulk delete take theirs back, an admin merge sets the live figure. NOTHING ELSE TOUCHES IT — an owner
 * marking a listing sold or hidden (core/listings.ts setStatusCore), the admin console's status changes,
 * identity holds and their release, the partner-stock cron's stock-outs (active → sold) and the
 * importers' own status writes all change `Listing.status` / `verified` and leave the count where it
 * was; importers that create rows directly never add theirs. So it overstates (sold/hidden rows still counted) and understates
 * (imported rows never counted) at once, and no schedule of recounts closes the window between two runs.
 *
 * So the rule is the FEED'S OWN DEFINITION, read live — not a restatement of it: the `where` comes from
 * `buildFeedFilters` (the builder /api/listings reads) with no parameters, plus "has a brand". That is
 * verified, active, the edition scope (marketplaceListingScope) and the teacher exclusion — the rows
 * `/?brand=<slug>` returns, so the number on a tile is the number the click shows, and the day the feed
 * gains a default filter this count gains it too (the same choice the typeahead's line rows made).
 * Curation is untouched (`curatedAt`, logos, aliases): a curated brand comes back by itself once one of
 * its listings is live — on the next read, within the windows below.
 *
 * Who reads it: /brands, the typeahead's brand chips (search/suggest) and the spell-corrector's brand
 * words. The brand rail applies the same rule per request on its own grouped read (/api/brands, "all"
 * included). ⚠️ EXEMPT, ON PURPOSE: the admin brand console, and the post
 * wizard's catalogue suggestions (/api/brands with no category) — a seller naming the brand of a NEW
 * listing is exactly when an empty curated brand's canonical spelling is worth offering, and that list
 * advertises nothing to a buyer. `listingCount` survives as their ordering hint and nothing more.
 *
 * Cost: one grouped read over the live branded rows (the `[verified, status, brandSlug, …]` indexes
 * lead with the same three columns), memoized per process for ONE MINUTE and shared in flight, so the
 * typeahead's every keystroke does not pay it. A failure is never cached. Nothing about the read depends
 * on the request (the edition is fixed at build, the scope reads the DB and env, never headers), so one
 * memo per process is correct.
 * ⚠️ IT IS EVENTUALLY CONSISTENT, BY WINDOWS STATED HERE RATHER THAN DISCOVERED — in BOTH directions: a
 * brand whose last row sells, or whose first row is published, is seen by the typeahead chips within a
 * minute (plus the response's own 10 s max-age), by the spell-corrector within eleven minutes (its
 * vocabulary's ten-minute memo on top), and by /brands when that ISR page regenerates (1h since
 * 2026-10-04, down from 6h). The minute is the trade against `listingCount`, which a publish moved
 * at once but a sale never did. (The rail reads per request; its only window is its own response's
 * s-maxage=300.)
 * Invalidating on every status write would mean hooking the same dozens of writers that left
 * `listingCount` wrong; a stale tile lands on the explorer's zero-results recovery, not an error.
 */

export type LiveBrandCounts = ReadonlyMap<string, number>

/** A grouped read's rows → slug → live count. Null slugs and empty groups are dropped. */
export function liveCountMap(groups: readonly { brandSlug: string | null; _count: { _all: number } }[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const g of groups) if (g.brandSlug && g._count._all > 0) m.set(g.brandSlug, g._count._all)
  return m
}

/**
 * The brands a buyer-facing directory shows: those with live listings, each with its live count, most
 * listings first, then by name. A brand with no live row is left out however it is curated.
 */
export function listedBrands<B extends { slug: string; name: string }>(brands: readonly B[], live: LiveBrandCounts): (B & { count: number })[] {
  return brands
    .flatMap((b) => {
      const count = live.get(b.slug) ?? 0
      return count > 0 ? [{ ...b, count }] : []
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

const TTL_MS = 60_000
let cache: { at: number; value: Promise<Map<string, number>> } | null = null

/** slug → live listing count (see the header). Memoized for a minute; a failed read rethrows and is not kept. */
export function liveBrandCounts(): Promise<LiveBrandCounts> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value
  const value = (async () => {
    const { where } = await buildFeedFilters(new URLSearchParams())
    const groups = await db.listing.groupBy({
      by: ['brandSlug'],
      // edition-lint-allow: `where` is buildFeedFilters' own, which pushes marketplaceListingScope()
      // into its AND as a separate element — the exact scope /api/listings applies to `/?brand=<slug>`.
      where: { AND: [where, { brandSlug: { not: null } }] },
      _count: { _all: true },
    })
    return liveCountMap(groups)
  })()
  const entry = { at: Date.now(), value }
  cache = entry
  value.catch(() => { if (cache === entry) cache = null })
  return value
}

/** Test seam. */
export function __resetLiveBrandCounts() {
  cache = null
}
