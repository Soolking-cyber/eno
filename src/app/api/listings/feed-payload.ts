import 'server-only'
import { db } from '@/lib/db'
import { diversityAppliesTo, goodsSeatsFor, sharedSeatsFor } from '@/lib/feed-diversity'
import { diverseFeedHead, feedPagePlan } from '@/lib/feed-window'
import { scopedListingWhere } from '@/lib/edition-scope'
import { serializeListingCard, LISTING_CARD_SELECT } from '@/lib/serialize'
import { localizeListingTitles } from '@/lib/translate'
import { buildFeedFilters, resolveFeedFilters, buildFeedOrderBy, getSubcategoryCounts, countListingsCached } from './feed-query'
import { computeFacetCounts, releasedParams, subcategoryDimension, subcategoryDropPlan, type FacetCounts } from '@/lib/facet-counts'
import { PROVINCE_NAMES_EN } from '@/lib/province-match'
import { semanticRank } from './semantic-rank'
import { keywordRank } from './keyword-rank'
import type { MatchClass } from '@/lib/text-relevance'
import { buildHistogram } from '@/lib/price-histogram'

/**
 * THE BROWSE FEED'S ONE BUILDER — `GET /api/listings` (route.ts) answers through it, and so does the voice concierge's
 * page reader (src/lib/concierge/page-state.ts), so the count the avatar speaks is the count the page shows.
 * ⚠️ MOVED HERE FROM route.ts UNCHANGED (2026-10-27): Next lets a route file export only its handlers and its config,
 * so a second caller could not import it from there. The function below is the route's, byte for byte, apart from the
 * two notes on its unscoped-looking reads that the edition lint needs now that it no longer lives in route.ts.
 *
 * The feed (or, with `histogram=1`, its price distribution) for one set of params, as a body plus
 * the Cache-Control it is served with. Split out of GET so a zero-result search can be asked again
 * with its corrected spelling (route.ts, GET) through exactly the same code.
 */
export async function buildFeedPayload(searchParams: URLSearchParams, opts: { noAi?: boolean } = {}): Promise<{ body: { total: number } & Record<string, unknown>; cacheControl: string; histogram: boolean }> {
  // ⚠️ RESOLVED, not merely built: a district read out of `q` that would find nothing where the plain
  // words find something is dropped here (resolveFeedFilters), and every figure below — rows, total,
  // histogram, facet counts — follows that one decision.
  // ONE reference instant for the grid AND every count below, so a time-window filter (Posted) cannot
  // put the chips and the results on opposite sides of a 5-minute step (src/lib/posted-filter.ts).
  const now = new Date()
  const { category, q, inferredDistrict, sort, featuredOnly, limit, offset, priceMin, priceMax, histogram, looseMatch, priorityCategory, andFilters, pgTextFilter, saleScopeFromWords, subcategoryFilter, where, teachersIn } =
    await resolveFeedFilters(searchParams, { now })

  /**
   * HISTOGRAM MODE — the price distribution of EVERY listing matching the active filters, as nice
   * log-spaced bins (src/lib/price-histogram.ts). `where` already omits the price clause itself
   * (feed-query suppresses it under `histogram=1`; see facet-counts.ts), so the panel shows the whole
   * market around the user's range rather than only what is already inside it.
   *
   * ⚠️ AGGREGATED IN SQL, NOT SHIPPED AS ROWS. This used to be `findMany … orderBy price asc take
   * 5000` — a truncation to the 5,000 CHEAPEST prices, not a sample — and the panel read its first
   * and last entries as the full range. On production (98,755 public listings, 0 → 1.45B VND) that
   * cut the range off far below the real max, clamped typed maxima, hid the upper presets and capped
   * "{n} available" at 5,000. `GROUP BY price` over all public rows is 9,758 groups and measured
   * 153 ms, so the full distribution is affordable; the payload is a few hundred numbers.
   *
   * `where` is `{ AND: andFilters }`, and the text and subcategory clauses are IN `andFilters` (they
   * are returned separately only so other paths can drop them) — so this is the keyword feed's set
   * exactly, minus price (feed-query.histogram.test.ts). ⚠️ ONE GAP, NOT SQL-EXPRESSIBLE: when
   * `semanticRank` fires (q ≥ 3 chars, default sort, Vertex configured and answering) the feed is
   * Vertex's ≤120 ranked ids ∪ these keyword matches, and Vertex is queried WITH the price band, so
   * its half has no price-free form to aggregate. Here the count is then a lower bound, short by at
   * most the ranked ids the keywords miss.
   */
  if (histogram) {
    // edition-lint-allow: `where` is resolveFeedFilters' own, which already ANDs marketplaceListingScope() (feed-query.ts).
    const groups = await db.listing.groupBy({ by: ['price'], where, _count: { _all: true } })
    return {
      body: buildHistogram(groups.map((g) => ({ price: g.price, count: g._count._all }))),
      // s-maxage = the CDN (Cloudflare) edge TTL, separate from the browser max-age;
      // stale-while-revalidate lets the edge serve instantly while refreshing in the
      // background → hot price-histogram queries are served from Vietnam, not origin.
      cacheControl: 'public, max-age=30, s-maxage=120, stale-while-revalidate=300',
      histogram: true,
    }
  }

  /**
   * EVERY CHIP CARRIES ITS LIVE COUNT — one count per rail, each computed with every OTHER filter
   * applied and its own released (src/lib/facet-counts.ts explains the rule, and why a global count
   * would be worse than no count at all).
   *
   * ⚠️ STARTED HERE, ABOVE `semanticRank`, AND NOT AWAITED UNTIL THE Promise.all BELOW. The
   * aggregates depend on nothing either the semantic path or the feed query produces, so kicking
   * them off first lets them run under whatever those cost — including a Vertex call that is
   * allowed up to 2.5s. Awaiting the promise where it is created would turn a few milliseconds into
   * a full round trip added to every search.
   *
   * ⚠️ FIRST PAGE ONLY. A load-more request re-renders no rail, so `offset > 0` must not pay for
   * six aggregates — that is what keeps this off the hot path of an infinite scroll. The
   * long-standing `subcategoryCounts` / `categoryTotal` keys are NOT gated this way and still ship
   * on every page; `facets.subcategory` below is filled from those same two values rather than from
   * a second query.
   *
   * `facets=0` is an explicit opt-out for a caller that only wants rows. It is a query param, so
   * the CDN keys on it and the two payload shapes cannot share one edge cache entry.
   */
  const wantFacets = offset === 0 && searchParams.get('facets') !== '0'
  /**
   * ⚠️ THE `.catch()` IS ATTACHED AT CREATION, NOT LEFT TO THE `Promise.all`, AND IT IS THE
   * DIFFERENCE BETWEEN A 500 AND A DEAD WORKER. Node has terminated the process on an unhandled
   * rejection since v15. A promise that rejects while nothing is listening — and nothing is, for as
   * long as the `await semanticRank(...)` below takes, which is up to 2.5s on a Vertex call — fires
   * `unhandledRejection` before the `Promise.all` ever gets to catch it. Verified by running that
   * exact shape (reject at t≈0, attach the handler after an awaited timer): the process exits 9.
   * computeFacetCounts is deliberately fail-soft, but it re-throws `DeskResolutionError`, which is
   * precisely the misconfiguration most likely to hit every request at once — so the loud failure
   * this route wants would arrive as a crash loop instead of an error. Capture here, re-throw after
   * the join, and the behaviour is the intended one: the request 500s, the worker lives.
   */
  let facetsError: unknown = null
  const facetsPromise: Promise<FacetCounts> = wantFacets
    /**
     * `provinceValues`: EVERY province the Area panel lists (the same 34 /api/geo serves), so the panel
     * can drop the ones with nothing in them — measured 2026-09-25, 27 of 34 had no public row at all.
     * They are counted out of the `area` groupBy the rail already runs; no extra query.
     */
    ? computeFacetCounts({ searchParams, buildFilters: buildFeedFilters, inferredDistrict, saleScopeFromWords, provinceValues: PROVINCE_NAMES_EN, now }).catch((e: unknown) => {
        facetsError = e
        return {} as FacetCounts
      })
    : Promise.resolve({})

  const orderBy = buildFeedOrderBy(sort)

  // Semantic ranking via Vertex AI Search — falls back to the keyword query in `where`.
  const { semanticListings, semanticTotal, aiSkipped } = await semanticRank({
    q, looseMatch, featuredOnly, sort, category, priceMin, priceMax, offset, limit, andFilters, pgTextFilter, orderBy,
    noAi: opts.noAi, teachers: teachersIn,
  })

  // Parallel fetch: Listings, total count, and subcategory counts (if category is set)
  let subcategoryCounts: Record<string, number> = {}

  // Facet base for the subcategory counts + their "All" total: every active filter
  // EXCEPT the subcategory selection (a facet must not constrain its own option counts)
  // and the free-text query. Dropping the query keeps counts from zeroing out on a
  // semantic-only search (literal keyword AND-match would match nothing) while still
  // respecting the structural chips — condition, type, brand, model, price, district —
  // which is the actual bug: a count said "12" but clicking yielded 2 because those
  // were ignored. Counts now match what the click returns.
  // ⚠️ A QUERY OF CONDITION WORDS ONLY ("second hand", "đồ cũ") IS THE SALE SCOPE (feed-query.ts,
  // `saleScopeFromWords`): its `listingType: 'sell'` clause is structural and stays in this base, and
  // releasedParams writes it back as `type=sell` into the bases computeFacetCounts builds without `q`.
  const facetBaseFilters = andFilters.filter((f) => f !== subcategoryFilter && f !== pgTextFilter)
  /**
   * A catalogue sold by many storefronts (Services › eSIM: nine carriers; the job boards) shares ONE
   * seat in the default feed — except inside its aisle, where they are the variety (feed-diversity.ts).
   * ⚠️ The home page and the storefront rails pass the same rule for an unfiltered feed; the SSR head
   * and this API's head must agree or the feed reshuffles on hydration.
   */
  // The migrated request parameters, not a cast into the Prisma filter: the rule must follow the
  // subcategory (and category) the reader chose, whatever shape the filter that implements it takes.
  const sharedSeats = sharedSeatsFor(searchParams.get('subcategory'), searchParams.get('category'))
  /**
   * THE GOODS SEATS — at least two of the first four cards and four of the first twelve are second-hand
   * goods (feed-diversity.ts GOODS_SEATS) — ONLY when this request IS the home page's default feed: no
   * category, filter, words or sort (goodsSeatsFor, an allow-list of the parameters that change nothing).
   * ⚠️ The home render passes HOME_FEED_SEATS for the same feed; the explorer's page 2 is cut from this
   * head, so the two must agree or page 2 repeats a server-rendered card and skips another.
   */
  const goodsSeats = goodsSeatsFor(searchParams)

  /**
   * ⛔ A SUBCATEGORY-SCOPED FILTER IS COUNTED THE WAY EACH SIBLING'S TAP APPLIES IT. `facetBaseFilters`
   * keeps every `attr_*`/`range_*`, which is right for siblings that offer the facet and wrong for
   * the ones that do not: Rentals › Apartment › 2 BR counted "Office · 0" while tapping Office
   * returned all 2,270 offices (production, 2026-09-25), because the tap drops a filter the new
   * subcategory does not offer. `subcategoryDropPlan` says, per target, which params its tap drops;
   * targets are grouped by that set and each group is counted over its own base — one more memoized
   * groupBy per distinct set (in practice one), and only while such a filter is active. The "All"
   * chip, and `categoryTotal`, is the '' target: every subcategory-scoped facet goes with the
   * subcategory.
   * ⚠️ THE BASES ARE BUILT HERE, BEFORE ANY COUNT QUERY IS FIRED. Awaiting them after the queries
   * below exist would leave those promises without a handler across an await — the unhandled-
   * rejection crash the note on `facetsPromise` describes.
   */
  const dropPlan = category && category !== 'all' ? subcategoryDropPlan(searchParams, category) : null
  let subPlans: { targets: string[]; base: typeof facetBaseFilters }[] | null = null
  if (dropPlan) {
    const groups = new Map<string, { drop: string[]; targets: string[] }>()
    for (const [target, drop] of dropPlan) {
      const sig = JSON.stringify(drop)
      const g = groups.get(sig) ?? { drop, targets: [] }
      g.targets.push(target)
      groups.set(sig, g)
    }
    // ⚠️ EVERY GROUP IS BUILT THE SAME WAY — the one that drops nothing too — so the chips of one
    // response come from one construction (a reviewer's point: two constructions could drift apart
    // and make siblings incomparable). `releasedParams(…, 'subcategory')` + the feed's own builder is
    // the path computeFacetCounts uses for every rail; with nothing dropped it is `facetBaseFilters`.
    subPlans = await Promise.all([...groups.values()].map(async (g) => {
      const p = releasedParams(searchParams, 'subcategory', inferredDistrict, saleScopeFromWords)
      for (const k of g.drop) p.delete(k)
      return { targets: g.targets, base: (await buildFeedFilters(p, { now })).andFilters }
    }))
  }

  // Both totals go through the count cache (feed-query.ts, audit M2): a load-more page within the
  // minute takes the number page 1 already paid for instead of re-scanning for it.
  let categoryTotalPromise: Promise<number> = Promise.resolve(0)
  if (category && category !== 'all') {
    categoryTotalPromise = countListingsCached({ AND: subPlans?.find((pl) => pl.targets.includes(''))?.base ?? facetBaseFilters })
  }

  /**
   * Set when the lexical ranker answered this page: 'title' / 'aside' per row (keyword-rank.ts,
   * text-relevance.ts MatchClass), for the explorer to say where the strong matches end (B1). Absent on
   * browse, an explicit sort and the semantic path — the field is then simply not on the rows.
   * ⚠️ WIRE CONTRACT: 'aside' means "not in the ranked title tier", NOT "the title does not match" —
   * rows outside the ranker's candidate pools (best 600 + 300 title/aisle hits) are 'aside' too, even
   * when their titles name every word (types.ts SerializedListingCard.matchClass).
   */
  let matchClassOf: ((id: string) => MatchClass) | undefined
  const promises: [
    Promise<any[]>,
    Promise<number>,
    Promise<{ slug: string; count: number }[]> | undefined
  ] = [
    semanticListings
      ? Promise.resolve(semanticListings)
      /**
       * ⛔ A TEXT QUERY'S ORDER IS THE RELEVANCE ANSWER ON BOTH PATHS — Vertex's above, the lexical
       * ranker's here (keyword-rank.ts), which answers every default-sort search the semantic path
       * does not. The seller round-robin below is a BROWSE rule, and on a search it was lifting one
       * description-only match per seller to the top: measured 2026-09-29, q=iphone gave a Viettel
       * eSIM at #1 and an Under Armour tote bag at #2. keywordRank answers null — and the feed below
       * runs exactly as before — for browse, an explicit sort, `match=any` and featured-only, and
       * when its own read fails. The row set is the same `where` either way, so `total` is unchanged.
       * ⚠️ Created here, inside the array the Promise.all below joins, with no await in between — the
       * unhandled-rejection note on `facetsPromise` applies to any promise left unwatched.
       */
      : keywordRank({ q, looseMatch, featuredOnly, sort, offset, limit, where, orderBy, teachers: teachersIn }).then(({ keywordListings, matchClassOf: classOf }) => {
        matchClassOf = classOf
        return keywordListings
      }).then((keywordListings) => keywordListings ?? (
      /**
       * ⚠️ INSIDE THE DIVERSITY WINDOW THE PAGE IS SLICED FROM A REORDERED WINDOW, NOT FROM SQL.
       * One seller's fourteen near-identical e-visa SKUs held positions 0-13 of this feed on
       * production, so the entire first screen was one catalogue (see src/lib/feed-diversity.ts).
       * The fix is an ORDERING, applied to a bounded window, and pagination stays coherent because
       * every page inside the window slices the SAME reordered sequence rather than re-running a
       * skip/take against a different order.
       *
       * ⚠️ IT MUST MATCH `(home)/page.tsx` EXACTLY — same window, same function. That file's comment
       * explains why: it server-renders the first twelve cards and this route feeds the client
       * explorer, so any disagreement reshuffles the feed under the reader on hydration.
       *
       * ⛔ SEMANTIC RESULTS ARE UNTOUCHED (the branch above). Their order IS the relevance answer;
       * interleaving it by seller would be overruling the ranking with a merchandising rule.
       */
      /**
       * ⛔ AND ONLY ON THE DEFAULT SORT. On an explicit "Cheapest first" the round-robin zips two
       * individually-sorted seller lists together, so the feed is NOT in price order even though
       * every row is — measured on production 2026-08-24 as 0, 30k, 790k, 50k, 1.24M, 60k.
       * See diversityAppliesTo() for why this is the same rule the semantic branch above follows.
       */
      /**
       * ⛔ NO `offset < FEED_DIVERSITY_WINDOW` GUARD, AND THAT GUARD IS WHAT RE-SERVED ROWS. With
       * it, only the first page took this branch and every later page fell through to the plain
       * `findMany` below — natural rank order, NO exclusion — handing back the very rows the
       * window had pulled UP from below rank 60. Measured on four pages of the live feed with the
       * guard in place: 240 rows holding 217 distinct listings, i.e. 23 repeats and 23 listings
       * never shown, with the overlap between page 1 and pages 3-4 rather than between adjacent
       * pages (page 2 happened to be clean, which is exactly how this hid). The diverse path must
       * own EVERY offset once diversityAppliesTo(sort) is true, so the same `notIn head` applies
       * all the way down.
       */
      diversityAppliesTo(sort)
        // `teachers: true`: `where` already carries buildFeedFilters' teacher decision (as the tail below).
        // The head is the window dealt by the seat rules — the same function the home render slices its
        // twelve from (feed-window.ts diverseFeedHead), so page 2 continues exactly where they stop.
        ? diverseFeedHead(where, orderBy, LISTING_CARD_SELECT, { sharedSeats, goodsSeats, teachers: true })
            /**
             * ⛔ ROWS PAST THE WINDOW MUST EXCLUDE WHAT THE WINDOW ALREADY SERVED. The window no
             * longer contains the natural top 60 — it contains each seller's best — so continuing
             * in plain rank order past row 60 re-serves the rows the fan-out pulled UP and skips
             * the ones it pushed down. Measured before this `notIn`: four pages returned 240 rows
             * holding 217 distinct listings, i.e. 23 repeats and 23 listings never shown.
             *
             * ⚠️ THE WINDOW IS A FIXED 60 — plus, on the home feed only, the few goods rows the goods
             * seats may append (feed-window.ts withGoodsCandidates) — so the exclusion list stays
             * bounded however deep the reader scrolls, and the window query itself is the same bounded
             * read on every page — one extra query past the head, not a growing one.
             */
            .then(async (head) => {
              const plan = feedPagePlan(head.length, offset, limit)
              /**
               * ⛔ THE TAIL IS FETCHED WITH `skip` ALREADY APPLIED, so it must NOT then be indexed
               * as if it began at row 0 of the feed. The first cut did exactly that —
               * `[...head, ...tail].slice(offset, …)` after fetching the tail at `skip: offset-60`
               * — which counts the offset twice and serves rows 120-179 where 60-119 belong.
               * Measured both before and after that attempt: 240 rows holding 217 distinct
               * listings, 23 repeats, unchanged. Two index spaces, and only one of them may carry
               * the offset.
               */
              const fromHead = plan.fromHead ? head.slice(plan.fromHead.start, plan.fromHead.end) : []
              if (plan.tailTake <= 0) return fromHead
              const tail = await db.listing.findMany({
                // `teachersIn`: the decision `where` carries (buildFeedFilters) — the default exclusion here
                // would drop every /c/teachers row past the head window.
                where: { AND: [await scopedListingWhere(where, { teachers: teachersIn }), { id: { notIn: head.map((r) => r.id) } }] },
                orderBy, skip: plan.tailSkip, take: plan.tailTake, select: LISTING_CARD_SELECT,
              })
              return [...fromHead, ...tail]
            })
        // edition-lint-allow: the same `where`, edition scope included (resolveFeedFilters → marketplaceListingScope).
        : db.listing.findMany({
            where,
            orderBy,
            take: limit,
            skip: offset,
            select: LISTING_CARD_SELECT,
          }))),
    semanticListings ? Promise.resolve(semanticTotal) : countListingsCached(where),
    undefined
  ]

  if (category && category !== 'all') {
    const plans = subPlans
    promises[2] = plans
      // Each target's count comes from ITS group's base; Promise.all attaches to every query at once.
      ? Promise.all(plans.map((pl) => getSubcategoryCounts(pl.base))).then((all) =>
          all.flatMap((rows, i) => rows.filter((r) => plans[i].targets.includes(r.slug))))
      : getSubcategoryCounts(facetBaseFilters)
  }

  const [listings, total, subCounts, categoryTotal, facetCounts] = await Promise.all([
    promises[0],
    promises[1],
    promises[2] || Promise.resolve([]),
    categoryTotalPromise,
    facetsPromise,
  ])

  // Re-throw what the facet promise caught at creation (see above). Same outcome as never having
  // caught it — a 500 on the feed — minus the window in which nobody was listening.
  if (facetsError) throw facetsError

  if (subCounts && subCounts.length > 0) {
    subCounts.forEach((c) => {
      subcategoryCounts[c.slug] = c.count
    })
  }

  /**
   * Fold the subcategory rail into the one object the UI reads every rail from, so no consumer has
   * to know that this one dimension arrives by a different route.
   *
   * The two numbers come from two queries — `getSubcategoryCounts` for the buckets, a COUNT for the
   * "All" — but from the IDENTICAL `facetBaseFilters`, which is what makes them consistent: the
   * buckets sum to `categoryTotal` minus the rows carrying no subcategorySlug, exactly as
   * `DimensionCounts` documents. Assembled through `subcategoryDimension()` rather than by hand so
   * the zero-seeding is the same here as in facet-counts.ts; a rail that skipped it would be the
   * one dimension whose `values[slug]` is undefined instead of 0.
   *
   * Gated on `wantFacets` AND the same `category` test that decides whether the groupBy ran at
   * all, so `facets` either carries the rail or stays empty — never a fabricated one on a page that
   * computed nothing. Note the asymmetry that follows, and it is deliberate: with `facets=0` (or on
   * a load-more page) `subcategoryCounts` and `categoryTotal` still ship at the top level, but
   * `facets` is `{}`. A consumer that reads rails only from `facets` must therefore ask for facets;
   * the top-level keys remain the compatibility surface they have always been.
   */
  const facets: FacetCounts = wantFacets && category && category !== 'all'
    ? { ...facetCounts, subcategory: subcategoryDimension(category, categoryTotal, subcategoryCounts) }
    : facetCounts

  // Hierarchy for a brand search: keep the trust/recency order the DB returned, but
  // stable-promote the active category's items to the front (current category first,
  // then the rest of the brand across other categories).
  let ordered = listings
  if (priorityCategory && priorityCategory !== 'all') {
    ordered = [...listings].sort((a, b) => {
      const ap = a.category?.slug === priorityCategory ? 0 : 1
      const bp = b.category?.slug === priorityCategory ? 0 : 1
      return ap - bp // stable: ties keep the DB (trust→recency) order
    })
  }

  return {
    body: {
      // lang comes from the QUERY (the client sends it only for non-en/vi) so the CDN cache
      // key varies with the payload — the cookie-read variant poisoned the shared edge
      // entry with whichever language hit first (audit P2).
      listings: await localizeListingTitles(
        ordered.map((l) => (matchClassOf ? { ...serializeListingCard(l), matchClass: matchClassOf(l.id) } : serializeListingCard(l))),
        searchParams.get('lang') || undefined,
      ),
      total,
      offset,
      limit,
      subcategoryCounts,
      categoryTotal,
      // Live counts for every chip rail — see src/lib/facet-counts.ts for the shape. `{}` on a
      // load-more page or when `facets=0` was asked for.
      facets,
      /**
       * The `DISTRICTS` slug the text query was read as AND APPLIED ("căn hộ quận 7" → `d7`), or null
       * — the scope is already in `listings` and `total`. ⛔ THE EXPLORER'S DISTRICT CHIP READS THIS
       * FIELD and never re-runs the parser for it: null also when an explicit `?district=` won, or
       * when the district reading found nothing and the plain words were served instead
       * (resolveFeedFilters). The native apps and any other client read it for the same reason.
       */
      inferredDistrict,
    },
    // s-maxage = Cloudflare edge TTL (the browser keeps the shorter max-age);
    // stale-while-revalidate serves the cached feed instantly from the VN edge
    // while it refreshes behind the scenes, so cache-hits never touch Cloud Run.
    // ⚠️ EXCEPT an app's keyword-only answer to a search a browser would have had ranked by Vertex (`aiSkipped`,
    // App Store gate `app-ai-notice`): the edge keys on the URL alone, so caching it would hand that answer to browsers.
    cacheControl: aiSkipped ? 'private, no-store' : 'public, max-age=15, s-maxage=60, stale-while-revalidate=300',
    histogram: false,
  }
}
