import { NextRequest, NextResponse } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { db } from '@/lib/db'
import { diversifyBySeller, diversityAppliesTo, FEED_DIVERSITY_WINDOW } from '@/lib/feed-diversity'
import { serializeListingCard, LISTING_CARD_SELECT } from '@/lib/serialize'
import { normalizePhone, containsPhoneNumber } from '@/lib/phone'
import { containsContactInfo, findBannedWord, PublishBlockedError } from '@/lib/publish-guard'
import { localizeListingTitles } from '@/lib/translate'
import { consolidateSellerHandle } from '@/lib/handle'
import { getCurrentProfileId } from '@/lib/admin'
import { postingGate } from '@/lib/enforcement'
import { rateLimit } from '@/lib/ratelimit'
import { createListingCore } from '@/lib/core/listings'
import { idsFastPath, buildFeedFilters, buildFeedOrderBy, getSubcategoryCounts } from './feed-query'
import { computeFacetCounts, subcategoryDimension, type FacetCounts } from '@/lib/facet-counts'
import { semanticRank } from './semantic-rank'
import { resolveSellerForPost } from './resolve-seller'
import { publishOutcome, recordPublishOutcome } from '@/lib/publish-funnel'

export const dynamic = 'force-dynamic'

// ⚠️ WS6 — NOT MIGRATED (GET). The public browse/search feed: no auth, no rate limit, no request
// body — all four route() options empty, which is the pure-churn shape the migration declines.
// It is also Response-shaped on every path rather than object-shaped: the `fastPath` early
// return, the histogram branch and the feed branch each carry their own Cache-Control (the
// Cloudflare s-maxage tiers below are the point of this route being fast), so every branch would
// take the wrapper's Response escape hatch and the auto-JSON that is most of its value would
// never fire. Wrapping it would add an indirection and remove nothing.
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams

  // Fast path: fetch a specific set of PUBLIC listings by id (used by /saved).
  const fastPath = await idsFastPath(searchParams)
  if (fastPath) return fastPath

  const { category, q, sort, featuredOnly, limit, offset, priceMin, priceMax, histogram, looseMatch, priorityCategory, andFilters, pgTextFilter, subcategoryFilter, where } =
    await buildFeedFilters(searchParams)

  // Histogram mode: return just the matching prices (VND) for the active filters.
  // Capped so a huge catalog stays a small payload; the client buckets them.
  if (histogram) {
    const rows = await db.listing.findMany({ where, select: { price: true }, orderBy: { price: 'asc' }, take: 5000 })
    return NextResponse.json(
      { prices: rows.map((r) => r.price) },
      // s-maxage = the CDN (Cloudflare) edge TTL, separate from the browser max-age;
      // stale-while-revalidate lets the edge serve instantly while refreshing in the
      // background → hot price-histogram queries are served from Vietnam, not origin.
      { headers: { 'Cache-Control': 'public, max-age=30, s-maxage=120, stale-while-revalidate=300' } },
    )
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
    ? computeFacetCounts({ searchParams, buildFilters: buildFeedFilters }).catch((e: unknown) => {
        facetsError = e
        return {} as FacetCounts
      })
    : Promise.resolve({})

  const orderBy = buildFeedOrderBy(sort)

  // Semantic ranking via Vertex AI Search — falls back to the keyword query in `where`.
  const { semanticListings, semanticTotal } = await semanticRank({
    q, looseMatch, featuredOnly, sort, category, priceMin, priceMax, offset, limit, andFilters, pgTextFilter, orderBy,
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
  const facetBaseFilters = andFilters.filter((f) => f !== subcategoryFilter && f !== pgTextFilter)

  let categoryTotalPromise: Promise<number> = Promise.resolve(0)
  if (category && category !== 'all') {
    categoryTotalPromise = db.listing.count({ where: { AND: facetBaseFilters } })
  }

  const promises: [
    Promise<any[]>,
    Promise<number>,
    Promise<{ slug: string; count: number }[]> | undefined
  ] = [
    semanticListings
      ? Promise.resolve(semanticListings)
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
      : diversityAppliesTo(sort) && offset < FEED_DIVERSITY_WINDOW
        ? db.listing
            /**
             * ⚠️ `max(window, offset+limit)` — A PAGE THAT STRADDLES THE WINDOW EDGE MUST STILL BE
             * FULL. This fetched exactly FEED_DIVERSITY_WINDOW rows and sliced, so a request like
             * offset=55&limit=12 came back with FIVE rows even though rows 60-66 exist. A client
             * reads a short page as "feed exhausted" and stops; one that advances by the requested
             * limit skips 60-66 entirely. codex caught it on review; the tests only covered
             * offsets 0/12/24 on a 35-row fixture, where the edge cannot occur.
             */
            .findMany({ where, orderBy, take: Math.max(FEED_DIVERSITY_WINDOW, offset + limit), skip: 0, select: LISTING_CARD_SELECT })
            /**
             * Diversify the window ONLY, then continue in natural rank order. Reordering past the
             * window would make the sequence depend on how far the reader had scrolled, and two
             * readers on different pages would disagree about what row 61 is.
             */
            .then((rows) => [
              ...diversifyBySeller(rows.slice(0, FEED_DIVERSITY_WINDOW)),
              ...rows.slice(FEED_DIVERSITY_WINDOW),
            ].slice(offset, offset + limit))
        : db.listing.findMany({
            where,
            orderBy,
            take: limit,
            skip: offset,
            select: LISTING_CARD_SELECT,
          }),
    semanticListings ? Promise.resolve(semanticTotal) : db.listing.count({ where }),
    undefined
  ]

  if (category && category !== 'all') {
    promises[2] = getSubcategoryCounts(facetBaseFilters)
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

  return NextResponse.json(
    {
      // lang comes from the QUERY (the client sends it only for non-en/vi) so the CDN cache
      // key varies with the payload — the cookie-read variant poisoned the shared edge
      // entry with whichever language hit first (audit P2).
      listings: await localizeListingTitles(ordered.map(serializeListingCard), searchParams.get('lang') || undefined),
      total,
      offset,
      limit,
      subcategoryCounts,
      categoryTotal,
      // Live counts for every chip rail — see src/lib/facet-counts.ts for the shape. `{}` on a
      // load-more page or when `facets=0` was asked for.
      facets,
    },
    {
      headers: {
        // s-maxage = Cloudflare edge TTL (the browser keeps the shorter max-age);
        // stale-while-revalidate serves the cached feed instantly from the VN edge
        // while it refreshes behind the scenes, so cache-hits never touch Cloud Run.
        'Cache-Control': 'public, max-age=15, s-maxage=60, stale-while-revalidate=300',
      },
    }
  )
}

// Create a listing from the post wizard. No auth yet → identify the seller by
// phone (Chợ Tốt / Craigslist guest-post pattern). Manual verification is gone:
// listings PUBLISH INSTANTLY (verified=true) unless the account is Restricted
// (low trust) or has no photo — see the autoPublish gate below; abuse is handled
// reactively by the trust score + reporting.
// normalizePhone is shared (src/lib/phone.ts) so the later verified-phone claim
// joins on the exact same canonical form. Image URLs validated via the shared,
// host-pinned isListingImageUrl() (our project's bucket only).

/**
 * ⚠️ THE FUNNEL COUNTER WRAPS THE HANDLER, it is not sprinkled through it.
 *
 * createListing below has eight exit points (rate limit, invalid input, contact-in-text,
 * banned words, unknown category, the seller resolver, the enforcement gate,
 * PublishBlockedError) plus success. Recording at each one guarantees that the day someone
 * adds a ninth and forgets, the funnel silently under-reports — and a missing branch reads
 * as zero, which is worse than no funnel at all. Reading the outcome off the response the
 * handler already produced makes new branches self-instrumenting.
 *
 * The body is re-read from a CLONE: Response bodies are one-shot streams, and consuming the
 * real one here would send an empty body to the client. The clone is cheap (these payloads
 * are small JSON) and the whole thing is wrapped so instrumentation can never break a
 * publish — on any failure to classify, we simply do not count.
 *
 * ⚠️ WS6 — NOT MIGRATED (POST). Three reasons, and the first is structural:
 *
 * · THE LIMITER'S BUCKET *AND* ITS strict FLAG ARE COMPUTED FROM THE CALLER. createListing picks
 *   `listing-create-user`, keyed by profile id and fail-OPEN, for a signed-in seller, or
 *   `listing-create`, keyed by IP and fail-CLOSED, for a guest — two buckets, two strictness
 *   settings, chosen after getCurrentProfileId(). route()'s `rateLimit:` is one static bucket
 *   with one strictness, applied before anything is known. No auth mode fits either: guest
 *   posting by phone IS this endpoint's contract, so 'userId'/'profile' would 401 the wizard's
 *   main path and 'public' resolves nobody, which is what makes the two-bucket choice possible.
 * · route()'s CATCH WOULD SWALLOW THE 'exception' FUNNEL BRANCH. The wrapper above counts a throw
 *   and rethrows it untouched; route() converts the same throw into {"error":"internal_error"}
 *   500, so that branch would silently stop being recorded and start counting as an ordinary
 *   failure — a change to the very numbers this instrumentation exists to produce.
 * · TWO RESPONSE SHAPES ARE NOT `{error: ApiErrorCode}`. The banned-word 400 and the
 *   PublishBlockedError reply both carry a second `detail` field (the duplicate's listing id is
 *   read by the client), and the catch-all 500 is {"error":"Failed to create listing"} — an
 *   English sentence, not a code. apiFail() can express neither, and rewording the 500 to
 *   `internal_error` would be exactly the silent wire change this migration forbids.
 *
 * ✅ SEPARATE FINDING, NOW FIXED (it was deferred here only because it is a shared-file edit and
 * other WS6 clusters were in flight): PublishBlockedError re-emits `e.code`, and 9 of the 12
 * PublishBlockCodes in src/lib/publish-guard.ts:40 were ABSENT from the ApiErrorCode union —
 * identity_unverified, identity_pending, identity_expired, identity_suspended, photo_required,
 * photos_min, contact_in_name, duplicate_listing, location_required. The harvest that built
 * src/lib/api/errors.ts greps for string LITERALS, so a code emitted through a variable was
 * invisible to it, and apiErrorCode() answered null for the most common refusal in the product.
 * All nine are in the union now, `errors.test.ts` derives them from the PublishBlockCode
 * declaration rather than exempting them, and `PublishBlockCode extends ApiErrorCode` is asserted
 * at COMPILE time in errors.ts — so a thirteenth publish code cannot repeat this.
 */
export async function POST(req: NextRequest) {
  let res: NextResponse
  try {
    res = await createListing(req)
  } catch (e) {
    // ⚠️ A THROW MUST STILL COUNT. createListing's own try/catch does not cover everything —
    // the rate-limit call and getCurrentProfileId() run BEFORE it opens — so an exception can
    // escape, and an uncounted branch reads as zero on the funnel page, which is worse than no
    // page at all. Count it, then rethrow untouched so Next's error handling is unchanged.
    void recordPublishOutcome('exception')
    throw e
  }
  try {
    // res.clone() is an independent handle: the original body is untouched and reaches the
    // client whole. Only read on a failure — a 201's body carries the created listing and no
    // error code, so parsing it would be work for nothing.
    const body = res.status >= 200 && res.status < 300 ? null : await res.clone().json().catch(() => null)
    void recordPublishOutcome(publishOutcome(res.status, (body as { error?: unknown } | null)?.error))
  } catch {
    /* never let counting a publish affect the publish */
  }
  return res
}

async function createListing(req: NextRequest) {
  // Guest posting is allowed (resolve-by-phone), and each create can fan out paid
  // translation + social syndication → throttle to cap floods. Same posture as the upload
  // routes: signed-in sellers fail OPEN (accountable account — don't block posting on a
  // Redis blip); anonymous fails CLOSED (a blip must not silently uncap guest creation of
  // public, cost-fanning content).
  const ip = clientIp(req)
  const posterId = await getCurrentProfileId()
  const rl = posterId
    ? await rateLimit('listing-create-user', posterId, 15, '1 h')
    : await rateLimit('listing-create', ip, 15, '1 h', { strict: true })
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  try {
    const body = await req.json()
    const categorySlug = String(body.categorySlug || '').trim()
    const title = String(body.title || '').trim().slice(0, 140)
    const contactPhone = normalizePhone(String(body.contactPhone || ''))
    const contactName = String(body.contactName || '').trim().slice(0, 80)
    const price = Number(body.price)

    if (!categorySlug || title.length < 3 || contactPhone.replace(/\D/g, '').length < 9 || !Number.isFinite(price) || price < 0 || price > 1e12) {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
    }

    // Keep contact info + banned content OFF the public listing — buyers reach sellers
    // in-app. Reject any phone number / email / link / social handle / street address, or
    // a banned word, up-front (before resolving a seller) so the poster can fix it. The
    // Restricted-account gate + photo check run in createListingCore (need the seller).
    for (const tx of [title, String(body.description || ''), contactName]) {
      if (containsPhoneNumber(tx) || containsContactInfo(tx)) {
        return NextResponse.json({ error: 'contact_in_text' }, { status: 400 })
      }
      const banned = findBannedWord(tx)
      if (banned) return NextResponse.json({ error: 'banned_words', detail: banned }, { status: 400 })
    }

    const category = await db.category.findUnique({ where: { slug: categorySlug } })
    if (!category) return NextResponse.json({ error: 'unknown_category' }, { status: 400 })

    // Resolve the storefront (signed-in → owned Seller; guest → by phone) — the
    // one-number-one-account claim rules live in resolveSellerForPost.
    const meId = await getCurrentProfileId()
    const seller = await resolveSellerForPost(meId, contactPhone, contactName)
    if (seller instanceof NextResponse) return seller

    // ONE public handle for the (possibly just-created) storefront so it's shareable
    // as eno.vn/<name>. Frees any handle the owner's profile held (one per account).
    // Idempotent + best-effort. Guest storefronts (no ownerId) just get a shop handle.
    await consolidateSellerHandle(seller.id, seller.name, seller.ownerId)

    // Enforcement ladder + probation (trust Phase 2): a held/suspended account can't
    // post, and a brand-new account (<30d AND <3 transactions) is capped on active
    // listings. Server-side only — guests have no Profile (no enforcement state; the
    // Restricted trust gate still applies inside createListingCore). Pre-migration
    // the gate reads default to good_standing → pure no-op.
    if (meId) {
      const gate = await postingGate(meId, seller.id)
      if (gate) return NextResponse.json(gate, { status: 403 })
    }

    // Build + create + fire side-effects in the shared core (same code path the
    // future /api/v1 create will reuse). Seller + category are already resolved.
    const result = await createListingCore({ seller, category, title, price, body, headers: req.headers })
    return NextResponse.json(result, { status: 201 })
  } catch (e) {
    // Restricted account / no photo / banned / contact-in-text / duplicate → a clear,
    // fixable code (403 for the trust gate since it isn't fixable now; 409 for a
    // duplicate of a live listing — detail carries the existing listing's id; 400 rest).
    if (e instanceof PublishBlockedError) {
      return NextResponse.json(
        { error: e.code, detail: e.detail },
        { status: e.code === 'account_restricted' ? 403 : e.code === 'duplicate_listing' ? 409 : 400 },
      )
    }
    console.error('[POST /api/listings]', e)
    return NextResponse.json({ error: 'Failed to create listing' }, { status: 500 })
  }
}
