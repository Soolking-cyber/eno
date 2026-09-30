import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import { scopedListingWhere } from '@/lib/edition-scope'
import { provinceWhere } from '@/lib/province-match'
import { computeRentIndex, dedupeCandidateIds, RENT_INDEX_RULES_VERSION, type RentIndex } from '@/lib/rent-index'

/**
 * The one read behind /hcmc-rent-index AND /hcmc-rent-index.csv.
 *
 * ⛔ ONE CACHED SNAPSHOT, TWO READERS, AND NEITHER ROUTE IS ISR. Both routes are rendered per request
 * and both read this entry, so the table and the file are the same numbers from the same moment. An
 * ISR page beside an ISR route would each regenerate on its own clock and hold different snapshots for
 * up to a day (both plan reviewers, independently). The window left is the refresh itself: after
 * the entry expires, the first request is still served the old snapshot while a new one is computed
 * (stale-while-revalidate), so a page load and a CSV fetch straddling that moment can differ by one
 * day. The page's Dataset `dateModified` and every CSV row carry the snapshot time, so that cannot
 * pass silently (opus, diff review).
 *
 * ⛔ A FAILED READ IS NEVER CACHED. The query throws inside the cached function, so `unstable_cache`
 * stores nothing and the next request tries again; only the caller's catch turns it into
 * `known: false`. Caching the failure would publish "figures unavailable" for a whole day.
 *
 * ⚠️ THE WHERE IS DELIBERATELY WIDE — the whole rentals category, not just the three residential
 * shelves — so the rules in src/lib/rent-index.ts see every row and the exclusion counts the page
 * publishes are the true counts, not counts of what survived a narrower query (opus, plan review).
 */
export type RentIndexLookup = { known: true; index: RentIndex } | { known: false }

/**
 * ⛔ THE CACHE KEY MUST NOT DEPEND ON THE BUNDLE, AND BY DEFAULT IT DOES. `unstable_cache` keys an
 * entry on `cb.toString()` plus `keyParts` (next/dist/server/web/spec-extension/unstable-cache.js,
 * `fixedKey`). This module is compiled once into the page's bundle and once into the CSV route's, the
 * minifier names the imports differently in each, so the two sources differ and so did the keys —
 * MEASURED on the scratch build: the page and the CSV each held their own snapshot, 214 ms apart,
 * i.e. exactly the disagreement this loader exists to prevent. Pinning `toString` makes the key the
 * `keyParts` alone, which both bundles spell identically.
 * ⚠️ WHAT THAT GIVES UP, AND WHY IT IS SAFE HERE: a changed `compute` no longer changes the key by
 * itself. A deploy still does — cache-handler.cjs prefixes every key with the BUILD ID — so no
 * snapshot computed by old code survives into a new build. Bump
 * RENT_INDEX_RULES_VERSION anyway when a rule changes; it is printed in the key and says why.
 */
/**
 * ⛔ TWO PHASES, SO ONLY CANDIDATES' PHOTOS ARE READ (SEO wave B, R1). v3 proves a cross-post by
 * shared photos (rent-index.ts), and a listing's `images` is its heaviest column. Phase 1 reads every
 * row's small fields; `dedupeCandidateIds` names the rows that share a type, a district and an exact
 * price with another seller (14,502 of 31,890 on 2026-09-30); phase 2 reads `images` for those only.
 * ⚠️ CHUNKS OF 5,000 IDS: one `IN` list per query, well inside Postgres' bind-parameter limit (65,535)
 * however large the candidate set grows.
 * ⚠️ PHASE 2 IS SCOPED LIKE PHASE 1 (`scopedListingWhere`), so the edition rule is applied to every
 * read even though the ids already came from a scoped query. That scope is the edition's seller rule
 * only, not `status`, so a row that went inactive between the two reads still returns its photos; it
 * is already in phase 1's rows, which decide what is counted. The two reads are not one transaction:
 * a photo edited in the few hundred milliseconds between them is read as edited — accepted.
 */
const PHOTO_CHUNK = 5_000

function parseImages(json: string | null): string[] {
  try {
    const a: unknown = JSON.parse(json || '[]')
    return Array.isArray(a) ? a.filter((u): u is string => typeof u === 'string') : []
  } catch {
    return []
  }
}

const compute = async (): Promise<RentIndex> => {
  const started = Date.now()
  const rows = await db.listing.findMany({
    where: await scopedListingWhere({
      category: { slug: 'rentals' },
      status: 'active',
      verified: true,
      ...provinceWhere('Ho Chi Minh'),
    }),
    select: {
      id: true, price: true, priceUnit: true, currency: true, listingType: true, subcategorySlug: true,
      district: true, areaM2: true, sellerId: true, attributes: true,
    },
    // ⚠️ A FIXED ORDER, because which of two cross-posted rows is kept depends on which comes first;
    // without it the counts could move between refreshes with no change in the data (opus).
    orderBy: { id: 'asc' },
  })
  const candidates = dedupeCandidateIds(rows)
  const photos = new Map<string, string[]>()
  for (let i = 0; i < candidates.length; i += PHOTO_CHUNK) {
    const chunk = await db.listing.findMany({
      where: await scopedListingWhere({ id: { in: candidates.slice(i, i + PHOTO_CHUNK) } }),
      select: { id: true, images: true },
    })
    for (const r of chunk) photos.set(r.id, parseImages(r.images))
  }
  const index = computeRentIndex(rows, photos)
  // One line per computed snapshot: how long a cold one takes is what H4's warm-up and D3 budget for.
  console.info(`[hcmc-rent-index] snapshot v${index.rulesVersion}: ${rows.length} rows, ${candidates.length} photo candidates, ${index.excluded.crossPosted} cross-posts, ${Date.now() - started} ms`)
  return index
}
compute.toString = () => 'hcmc-rent-index-snapshot'

const snapshot = unstable_cache(
  compute,
  ['hcmc-rent-index', `rules-v${RENT_INDEX_RULES_VERSION}`],
  { revalidate: 86400, tags: ['hcmc-rent-index'] },
)

/**
 * ⚠️ ONE QUERY AT A TIME, AND A FAILURE HOLDS FOR A MINUTE. `unstable_cache` neither merges concurrent
 * misses nor (by design, above) remembers a failure, so while the database is slow every page view and
 * every CSV fetch would start its own 25,000-row read — a few curl loops against the CSV turning a slow
 * database into a down one (opus, diff review). Concurrent callers share one in-flight read, and
 * after a failure callers get `known: false` for FAILURE_HOLD_MS without touching the database.
 * ⚠️ PER BUNDLE, NOT PER PROCESS: the page and the CSV route each compile their own copy of this
 * module, so each keeps its own flag — at worst two reads at once, never one per request (agy).
 * Nothing about the failure is written to the shared cache.
 * ⚠️ WHAT THIS DOES NOT COVER: the daily refresh. Once the entry is stale, `unstable_cache` returns it
 * at once and recomputes in the background, deduped only within one request (`pendingRevalidates` in
 * next/dist/server/web/spec-extension/unstable-cache.js), so requests arriving during that one read
 * can each start another. Accepted: the read is at most a few seconds once a day on a page with
 * modest traffic (v3's two phases plus the rules: 2.6–2.8 s on a local build reading production over
 * an SSH tunnel, 2026-09-30; v2 was 0.77 s cold on the box); a lock shared by both bundles would need
 * the database or the cache handler (opus).
 */
const FAILURE_HOLD_MS = 60_000
let inflight: Promise<RentIndexLookup> | null = null
let failedAt = 0

export async function loadRentIndex(): Promise<RentIndexLookup> {
  if (Date.now() - failedAt < FAILURE_HOLD_MS) return { known: false }
  inflight ??= snapshot()
    .then((index): RentIndexLookup => ({ known: true, index }))
    .catch((e): RentIndexLookup => {
      failedAt = Date.now()
      console.error('[hcmc-rent-index] snapshot failed', e)
      return { known: false }
    })
    .finally(() => { inflight = null })
  return inflight
}
