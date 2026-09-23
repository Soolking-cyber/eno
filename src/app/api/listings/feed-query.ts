// GET /api/listings query machinery: the ids fast-path, filter/where building from
// search params, the orderBy branches, and the subcategory facet-count cache.
// Extracted verbatim from route.ts — the route keeps the exported handlers only.
import { marketplaceListingScope, scopedListingWhere } from '@/lib/edition-scope'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { serializeListingCard, LISTING_CARD_SELECT } from '@/lib/serialize'
import { Prisma } from '@/generated/prisma/client'
import { isRangeColumn } from '@/lib/taxonomy'
import { facetTokenFor } from '@/lib/facet-tokens'
import { fold } from '@/lib/fold'
import { aliasesFor } from '@/generated/model-lineage'
import { localizeListingTitles } from '@/lib/translate'
import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'
// The cap lives in a client-safe module because the browser has to chunk to the same number.
import { IDS_FAST_PATH_MAX } from '@/lib/listing-ids'
import { districtScopeForSlug } from '@/lib/district-slug'
import { conditionWhere } from '@/lib/listing-condition'

// Subcategory facet counts are expensive (one multi-LIKE COUNT per subcategory)
// and change slowly. Memoize per filter-signature with a short TTL so the fan-out
// runs at most once per minute per (category, district, verified) on a warm
// instance, instead of on every cache miss.
const SUBCOUNT_TTL = 60_000
const SUBCOUNT_CACHE_MAX = 500
const subCountCache = new Map<string, { at: number; data: { slug: string; count: number }[] }>()

/**
 * ⛔ THE FEED'S TOTAL WAS THE MOST EXPENSIVE STATEMENT IN THE DATABASE (audit M2 + #362). Measured
 * on production, 2026-09-20 → 09-23: `SELECT COUNT(*) … WHERE verified AND status AND sellerId NOT
 * IN (desk)` was 13% of ALL database time — 7,332 calls at 139 ms, each a sequential scan of the
 * 366 MB heap (the desk exclusion is not in any index, so no count could stay index-only). The
 * facet and subcategory counts beside it were already memoized; the two totals were not, and they
 * ran on every infinite-scroll page for a number the client already had.
 *
 * Same shape as the two caches above: keyed by the full `where`, 60 s fresh — the same minute the
 * response itself promises (`s-maxage=60`), so a total can already be that stale at the edge — and
 * one addition: CONCURRENT IDENTICAL COUNTS SHARE ONE QUERY, as the facet cache does, because the
 * unfiltered home feed is one key for every visitor. Load-more pages hit it too: `total` on page 7
 * is page 1's number, asked for again within the minute. The field is still ALWAYS a number — the
 * explorer, the storefront and the native apps all read it, so dropping it past page 1 would be a
 * contract change, not an optimisation.
 * A failed count is not cached — the next request asks again.
 */
const COUNT_TTL = 60_000
const COUNT_CACHE_MAX = 500
const countCache = new Map<string, { at: number; n: number }>()
const countInFlight = new Map<string, Promise<number>>()

/** `db.listing.count({ where })` through the cache above. */
export function countListingsCached(where: Prisma.ListingWhereInput): Promise<number> {
  const key = JSON.stringify(where)
  const hit = countCache.get(key)
  if (hit && Date.now() - hit.at < COUNT_TTL) {
    // LRU on READ, not just on write: the unfiltered home-feed total is the hottest key by far, and
    // a burst of distinct filtered searches must not push it out while it is being served.
    countCache.delete(key)
    countCache.set(key, hit)
    return Promise.resolve(hit.n)
  }
  const running = countInFlight.get(key)
  if (running) return running
  const work = db.listing
    .count({ where })
    .then((n) => {
      countCache.delete(key) // re-inserted below, so a refreshed key moves to the young end
      if (countCache.size >= COUNT_CACHE_MAX) countCache.delete(countCache.keys().next().value!) // evict oldest
      countCache.set(key, { at: Date.now(), n })
      return n
    })
    .finally(() => countInFlight.delete(key))
  countInFlight.set(key, work)
  return work
}

/**
 * Fast path: fetch a specific set of PUBLIC listings by id (used by /saved).
 *
 * Must match the public invariant everywhere else (verified + active) — without status:'active' a
 * saved listing the seller hid or sold would still leak its full payload (title/price/images/
 * coords) to anyone holding the id.
 *
 * ⛔ THE RESPONSE SAYS WHICH IDS IT ACTUALLY LOOKED AT, AND IT MUST KEEP DOING SO. This endpoint
 * used to `.slice(0, 200)` the caller's ids and answer as though that were the whole question. The
 * caller — FavoritesContext — reads a requested id missing from `listings` as "this listing is
 * gone" and DELETES it from the device's saved set. So a device with 201 saved listings lost the
 * 201st permanently on the next load of /saved, silently, with a 200 OK: the id was never
 * evaluated, only truncated away. `evaluated` is the fix and the contract — the exact ids this
 * response is an answer about. Anything outside it is unanswered, never absent, and pruning
 * outside it is data loss. `complete` says whether the caller's list fit; a caller with more must
 * chunk (`IDS_FAST_PATH_MAX`) rather than assume one round trip covered it.
 */
export async function idsFastPath(searchParams: URLSearchParams): Promise<NextResponse | null> {
  const idsParam = searchParams.get('ids')
  // ⚠️ ABSENT AND EMPTY ARE DIFFERENT QUESTIONS. No `ids` at all is a browse request and belongs to
  // the feed below; `?ids=` is a caller asking about an empty set, and answering that with the
  // whole catalog would hand a hydration call every listing on the site.
  if (idsParam === null) return null
  // Dedupe before the cap: a repeated id used to eat one of the 200 slots and push a real
  // one past the edge, which is the same silent loss this whole contract exists to stop.
  const requested = [...new Set(idsParam.split(',').map((s) => s.trim()).filter(Boolean))]
  const ids = requested.slice(0, IDS_FAST_PATH_MAX)
  if (ids.length === 0) return NextResponse.json({ listings: [], total: 0, evaluated: [], complete: true })
  const rows = await db.listing.findMany({
    where: await scopedListingWhere({ id: { in: ids }, verified: true, status: 'active' }),
    select: LISTING_CARD_SELECT,
  })
  const byId = new Map(rows.map((r) => [r.id, serializeListingCard(r)]))
  const listings = ids.map((id) => byId.get(id)).filter((l): l is NonNullable<typeof l> => !!l)
  return NextResponse.json({
    listings: await localizeListingTitles(listings, searchParams.get('lang') || undefined),
    total: listings.length,
    // ⛔ `evaluated` IS THE WHOLE POINT OF THIS RESPONSE SHAPE — see the block comment above.
    evaluated: ids,
    complete: requested.length === ids.length,
  })
}

/** Parse the feed's search params and build the Prisma where clause + the tracked sub-filters. */
export async function buildFeedFilters(searchParams: URLSearchParams) {
  const category = searchParams.get('category') || undefined // slug
  const subcategory = searchParams.get('subcategory') || undefined // slug
  const district = searchParams.get('district') || undefined
  const condition = searchParams.get('condition')?.trim().toLowerCase() || undefined
  const q = searchParams.get('q')?.trim() || undefined
  const sort = searchParams.get('sort') || 'newest'
  const verifiedParam = searchParams.get('verified') // 'true' | 'false' | 'all'
  const featuredOnly = searchParams.get('featured') === 'true'
  const limit = Math.min(parseInt(searchParams.get('limit') || '24', 10) || 24, 100)
  const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0)
  const priceMin = parseInt(searchParams.get('priceMin') || '', 10)
  const priceMax = parseInt(searchParams.get('priceMax') || '', 10)
  // Price-histogram mode: return the price distribution for the CURRENT filters
  // (excluding the price range itself) so the slider can show where the user's
  // range sits in the available inventory.
  const histogram = searchParams.get('histogram') === '1'

  // SECURITY: public callers ALWAYS get verified-only. The `verified` param is
  // ignored here (no auth yet) so the pending moderation queue + the raw
  // guest-submitted phone numbers can never be scraped via ?verified=false/all.
  void verifiedParam
  const verifiedFilter = true

  const andFilters: Prisma.ListingWhereInput[] = []

  andFilters.push({ verified: verifiedFilter })
  // Public feed shows only AVAILABLE listings — sold/hidden stay in the seller's
  // dashboard, out of the browse feed.
  andFilters.push({ status: 'active' })
  /**
   * ⚠️ THE SINGLE HIGHEST-LEVERAGE EXCLUSION IN THE APP. eno.vn is a licensed sàn TMĐT and may not
   * offer e-visa or itinerary services — but those are ORDINARY `Listing` rows owned by one desk
   * seller, so nothing here greps for "visa" and nothing looks wrong. `andFilters` is what the main
   * feed, the total count, the price histogram, the facet base, the subcategory groupBy and both
   * semantic-search paths are all built from, so one push closes browse AND search at once.
   *
   * ⚠️ PUSHED AS ITS OWN ARRAY ELEMENT, never spread into a sibling object. This is the documented
   * "caller composes its own AND array" case: a separate element cannot collide with another
   * filter's keys, whereas `{ ...scope, sellerId: x }` would silently drop the exclusion.
   *
   * No try/catch: `marketplaceListingScope()` throws when the desk cannot be resolved, and a 500 on
   * the feed is the correct outcome. An unfiltered feed is a licensing breach nobody notices.
   */
  const editionScope = await marketplaceListingScope()
  if (editionScope.sellerId) andFilters.push({ sellerId: editionScope.sellerId })
  /**
   * STOREFRONT SCOPE — `?seller=<id>`, sent by every query a shop's subdomain makes.
   *
   * ⚠️ ITS OWN AND ELEMENT, BESIDE THE EDITION'S, FOR THE REASON THE NOTE ABOVE GIVES. Two
   * independent `sellerId` conditions in one AND array is exactly right: on the services edition
   * both are present and Postgres intersects them, so a storefront can never widen past the desk
   * scope. Merged into one object, the second would overwrite the first and do precisely that.
   *
   * ⛔ IT IS A FILTER, NOT AN AUTHORISATION. Anyone may pass any seller id here and get that
   * shop's PUBLIC listings — which is no more than `eno.vn/<handle>` has always shown, and the
   * clause below still restricts the result to active, publicly visible rows. What decides whether
   * a shop gets a subdomain at all is `storefront.ts`, on the render path; nothing here is load-
   * bearing for that and this must not be mistaken for it.
   */
  const sellerParam = searchParams.get('seller')?.trim()
  if (sellerParam) andFilters.push({ sellerId: sellerParam })
  /**
   * THE INVERSE, for the "more on eno" grid a storefront renders UNDER its own listings: everything
   * except this shop. Owner, 2026-09-15: a seller page should "show all shops products first then
   * other products" — and eno.vn/vinwonders dead-ended at its 17th card with nothing below it.
   *
   * ⚠️ ITS OWN AND ELEMENT TOO, and for the reason spelled out above rather than by imitation. On
   * the services edition `editionScope.sellerId` pins the feed to the desk; merging this exclusion
   * into that object would overwrite the pin and widen the result past the edition scope, which is
   * a licensing boundary, not a preference. As a separate condition Postgres intersects them, so
   * the worst this can do is return nothing.
   *
   * ⚠️ IT DOES NOT PAIR WITH `seller`. Passing both asks for "this shop and not this shop"; that is
   * an empty set by construction and is left to behave that way rather than being special-cased —
   * a caller doing it has a bug, and silently picking one of the two would hide it.
   */
  const excludeSellerParam = searchParams.get('excludeSeller')?.trim()
  if (excludeSellerParam) andFilters.push({ sellerId: { not: excludeSellerParam } })
  if (featuredOnly) {
    andFilters.push({ featured: true })
  }
  if (!histogram && (!Number.isNaN(priceMin) || !Number.isNaN(priceMax))) {
    const price: Prisma.FloatFilter = {}
    if (!Number.isNaN(priceMin)) price.gte = priceMin
    if (!Number.isNaN(priceMax)) price.lte = priceMax
    andFilters.push({ price })
  }
  if (category && category !== 'all') {
    andFilters.push({ category: { slug: category } })
  }
  // Case-INSENSITIVE and bilingual: stored condition values are inconsistently cased
  // (new/New/Like new/used/Used/Good/mới). "new" matches anything new-ish; "used" is
  // everything else that HAS a condition set — the null guard stops a service or a job
  // counting as used merely by being not-new.
  //
  // ⚠️ THE PREDICATE MOVED TO @/lib/listing-condition AND DID NOT CHANGE. It now has a second
  // caller: the SEO landing rail (seo-landing.tsx). seo-landing-href.ts requires that a landing
  // page's CTA link to exactly the set its rail displayed, and that page links here — so the two
  // must share one definition of "used" or the invariant breaks while both pages still look full.
  {
    const w = conditionWhere(condition as 'new' | 'used' | 'all' | undefined)
    if (w) andFilters.push(w)
  }
  /**
   * Generic district filter driven by DISTRICTS[].match (EN + VI variants), matched against both
   * the `district` and `location` fields.
   *
   * ⛔ AND, FAILING THAT, THE SEO LANDING PAGES' OWN SLUG SPACE. `/c/<category>/<district>` slugifies
   * the free-text district a seller typed, which is a DIFFERENT vocabulary from these curated keys
   * — `district-1`, not `d1`. Handing one of those to the explorer used to fall through to
   * `undefined`, and an undefined filter is NO filter: "Refine in full search" from a district page
   * returned the whole category with the district silently dropped. See src/lib/district-slug.ts.
   *
   * ⚠️ AN UNRESOLVABLE DISTRICT NOW MATCHES NOTHING, WHICH IS A DELIBERATE CHANGE. `?district=junk`
   * used to return the entire catalogue. A scope the caller asked for and the server cannot honour
   * is an empty result, not an unscoped one.
   */
  const districtFilter = await districtScopeForSlug(district || 'all')
  if (districtFilter) {
    andFilters.push(districtFilter)
  }

  /**
   * BUILDING (project) narrowing — the map's "show me this tower's units" filter.
   *
   * ⛔ IT MUST LIVE HERE, IN THE SHARED BUILDER, so the left-hand list and the pin count come from
   * one `where`. /api/listings/buildings calls this same function; the day the two derive their
   * filters separately, a pin says 40 and opens a list of 12. Both plan reviewers raised it.
   * ⚠️ An unknown key yields an EMPTY result, never an unscoped one — same rule the district scope
   * above follows. Silence is recoverable; quietly showing every listing in the city is not.
   */
  const building = searchParams.get('building')?.trim() || undefined
  if (building) andFilters.push({ buildingKey: building })

  // New area model (province → ward). Province matches the listing city (the only
  // level the current listings carry); ward is best-effort against district/location
  // (won't hit pre-2025 listings until they're re-tagged with wards).
  const province = searchParams.get('province')?.trim()
  if (province) {
    andFilters.push({ OR: [{ city: { contains: province } }, { location: { contains: province } }] })
  }
  const ward = searchParams.get('ward')?.trim()
  if (ward) {
    andFilters.push({ OR: [{ district: { contains: ward } }, { location: { contains: ward } }] })
  }
  // Default AND narrows ("honda red" needs both). Visual search (and any "loose"
  // caller) passes match=any → match ANY token, so a descriptive phrase like
  // "blue pen" still surfaces the closest items ("pen") instead of returning nothing.
  const looseMatch = searchParams.get('match') === 'any'
  // The keyword filter is tracked separately (pgTextFilter) so the semantic path can
  // drop it — but it's still pushed into andFilters, so the keyword/fallback path and
  // facet counts behave exactly as before when semantic ranking isn't used.
  let pgTextFilter: Prisma.ListingWhereInput | null = null
  if (q) {
    // Accent-insensitive + cross-language: match the folded query against the
    // pre-folded searchText blob (covers EN title + VI titleVi + desc + location).
    // AND each ≥2-char token so multi-word queries NARROW: "honda red" must match a
    // row containing both tokens (any order/field), not the literal substring.
    const qTokens = fold(q).split(/\s+/).filter((t) => t.length >= 2).slice(0, 6)
    const tokenClauses = qTokens.map((t) => ({ searchText: { contains: t } }))
    pgTextFilter = qTokens.length ? (looseMatch ? { OR: tokenClauses } : { AND: tokenClauses }) : { searchText: { contains: fold(q) } }
    andFilters.push(pgTextFilter)
  }

  // Subcategory + intent (listingType) filter on dedicated columns now —
  // taxonomy-aligned, replacing the old per-category keyword heuristics. Tracked
  // separately so the subcategory FACET counts can drop just this clause (a facet's
  // own selection must not constrain its own option counts).
  let subcategoryFilter: Prisma.ListingWhereInput | null = null
  if (subcategory && subcategory !== 'all') {
    subcategoryFilter = { subcategorySlug: subcategory }
    andFilters.push(subcategoryFilter)
  }
  const listingType = searchParams.get('type')?.trim()
  if (listingType && listingType !== 'all') {
    andFilters.push({ listingType })
  }
  // Brand filter — canonical slug on the dedicated column (catalogue-aligned).
  const brand = searchParams.get('brand')?.trim()
  if (brand && brand !== 'all') {
    andFilters.push({ brandSlug: brand })
  }
  // Model filter — exact display string (chips carry the catalogue's own value).
  const model = searchParams.get('model')?.trim()
  if (model && model !== 'all') {
    /**
     * ⛔ ONE PRODUCT MEANS ALL ITS SPELLINGS. Measured: the cascade's "Apple Watch Series 8" cell
     * counts 26 — because the count folds aliases — while `?model=Apple Watch Series 8` returned
     * 24. The two "Apple Watch S8" rows are the same watch and were silently missing from a click
     * on the number that promised them.
     *
     * ⚠️ THIS IS NOT THE PREFIX WIDENING THE REVIEWERS REFUSED. `?model=` still names exactly ONE
     * product; it just no longer depends on which of its spellings the importer happened to use.
     * A prefix would have swept in "iPhone 17 Pro Max" under "iPhone 17 Pro", which is a different
     * phone — that is the distinction, and it is why the leaf does not use `?line=`.
     */
    const spellings = [model]
    if (brand && brand !== 'all') {
      for (const [raw, canon] of Object.entries(aliasesFor(brand))) {
        if (canon === model) spellings.push(raw)
      }
    }
    andFilters.push(spellings.length > 1 ? { model: { in: spellings } } : { model })
  }
  /**
   * `line` — a model PREFIX, for the brand cascade's line and generation cells: `?line=iPhone`
   * covers every iPhone, `?line=iPhone+17` every 17 including Pro and Pro Max.
   *
   * ⛔ A PREFIX, NOT A LIST, AND THAT WAS A CORRECTION. The first version passed every matching
   * model string in a `models=a,b,c` param — but Apple's "iPhone" line covers ~200 catalogue
   * strings, which is a URL nobody can share and a query nobody can read. Reviewers flagged both
   * the length and a 60-entry cap that silently truncated the selection. A prefix says the same
   * thing in twelve characters.
   *
   * ⛔ AND `?model=` IS UNTOUCHED. It still means ONE exact string, as every shared link, indexed
   * URL and model facet count already assumes. The cascade's leaf writes `model`; only its line
   * and generation levels write `line`.
   */
  // ⚠️ Capped: the param is user-editable and lands in a LIKE pattern. Prisma parameterises and
  // escapes it, but an unbounded string is still free work for the database from a query string.
  const line = searchParams.get('line')?.trim().slice(0, 120)
  if (line && line !== 'all') {
    /**
     * ⚠️ THE BOUNDARY MATTERS: a bare `startsWith` makes `iPhone 17` swallow `iPhone 17e`, which
     * is a different phone the catalogue really stocks (15 of them). So it is the exact string OR
     * the string followed by a space — never an open-ended prefix.
     */
    const or: Prisma.ListingWhereInput[] = [
      { model: line },
      { model: { startsWith: `${line} ` } },
    ]
    /**
     * ⚠️ ALIASES HAVE TO BE ADDED BACK BY HAND. "Apple Watch S8" is the same watch as "Apple Watch
     * Series 8", but it does not START with "Apple Watch Series", so a prefix match alone would
     * drop it — and the count beside the cell, which folds aliases, would then overstate what the
     * click returns. `brand` is in scope here, which is what makes the lookup possible.
     */
    if (brand && brand !== 'all') {
      for (const [raw, canon] of Object.entries(aliasesFor(brand))) {
        if (canon === line || canon.startsWith(`${line} `)) or.push({ model: raw })
      }
    }
    andFilters.push({ OR: or })
  }

  /**
   * "Good price" — only listings priced below their market band (Listing.marketPosition = 'low', set by
   * the nightly price-stats cron against brand + model + shelf + condition). Owner, 2026-09-15: "tap good
   * price will show prices that are good in that subcategory model or generally all good prices across
   * the app when category brand not chosen" — which is exactly an AND with whatever else is chosen.
   *
   * ⚠️ A FILTER, NOT A SORT VALUE, AND THE DIFFERENCE IS WHERE IT IS HONOURED. It changes WHICH rows
   * exist, and `sort` is a presentation param: facet-counts.ts strips it before counting, the price
   * histogram ignores it, and the explorer's landing gate and empty state treat a sort tap as "not a
   * search". As its own param in `andFilters` it reaches findMany, the total, the sub-category counts,
   * the facet counts and the semantic path's structural filters without any of them knowing about it.
   * Only the literal 'good' is accepted — anything else is no filter, never an error.
   * Measured 2026-09-15 on production: 4.7ms for the first page unfiltered, 25ms for Apple › phones,
   * 216ms for the bare count — no index needed at 76k rows.
   */
  if (searchParams.get('deal') === 'good') andFilters.push({ marketPosition: 'low' })

  // Soft hierarchy: a brand search spans ALL categories, but the category the user
  // was browsing is surfaced FIRST (then the rest of the brand). Not a hard filter.
  const priorityCategory = searchParams.get('priorityCategory')?.trim()

  // Category-specific attribute facets. Both the seed and the post wizard store
  // attributes as JSON using the taxonomy facet `.value` strings, so a generic
  // `"key":"value"` contains-match is exact — no per-category special-casing.
  const attrKeys = Array.from(searchParams.keys()).filter((k) => k.startsWith('attr_'))
  for (const k of attrKeys) {
    const attrName = k.replace('attr_', '').replace(/[^a-z0-9_]/gi, '')
    const attrVal = searchParams.get(k)
    if (attrName && attrVal && attrVal !== 'all') {
      /**
       * ⚠️ TWO PLACES A FACET VALUE CAN LIVE, AND A FILTER MUST ACCEPT EITHER. Everything a human
       * posts answers each facet ONCE and lives in `attributes` ({"size":"m"}). An imported product
       * sold in eight sizes cannot say that, so multi-valued facets live in `facetTokens`
       * (`|size:m|size:l|`, src/lib/facet-tokens.ts) — a column no public write path reaches, which
       * is what makes matching it with a `contains` safe.
       * ⚠️ `facetTokenFor` builds the needle, bars included, so a filter for `size=m` cannot match a
       * row whose size is `m-l`. Single-valued rows are matched by the first branch exactly as
       * before — this adds a way to match, it changes nothing about the existing one.
       */
      /**
       * ⚠️ ONLY A TAXONOMY-SHAPED VALUE BUILDS A TOKEN NEEDLE. Facet values are slugs (`eu-44-plus`,
       * `xs-s`); without this check `?attr_size=m|sport:running` assembles `|size:m|sport:running|`,
       * a cross-facet needle no chip can express. It reads nothing it should not — the column is
       * public data either way — but "impossible by construction" has to mean it (a reviewer's catch).
       */
      const tokenable = /^[a-z0-9][a-z0-9-]*$/i.test(attrVal)
      andFilters.push({ OR: [
        { attributes: { contains: `"${attrName}":"${attrVal}"` } },
        ...(tokenable ? [{ facetTokens: { contains: facetTokenFor(attrName, attrVal) } }] : []),
      ] })
    }
  }

  // Numeric range facets (year/mileage/engine) live on dedicated columns and filter
  // as a min–max range: `range_<column>=min-max` (either side may be empty/open).
  // The column is allow-listed so a caller can't probe an arbitrary field.
  for (const key of Array.from(searchParams.keys())) {
    if (!key.startsWith('range_')) continue
    const col = key.slice('range_'.length)
    if (!isRangeColumn(col)) continue
    const [mnStr = '', mxStr = ''] = (searchParams.get(key) || '').split('-')
    const filter: Prisma.FloatFilter = {}
    const mn = Number(mnStr), mx = Number(mxStr)
    if (mnStr !== '' && Number.isFinite(mn)) filter.gte = mn
    if (mxStr !== '' && Number.isFinite(mx)) filter.lte = mx
    if (filter.gte !== undefined || filter.lte !== undefined) andFilters.push({ [col]: filter })
  }

  // Video feed (4th view): only listings that carry a clip. Pushed into andFilters so it
  // threads through both the keyword and semantic ranking paths (both build from andFilters).
  if (searchParams.get('hasVideo') === '1') andFilters.push({ video: { not: null } })

  const where: Prisma.ListingWhereInput = andFilters.length > 0 ? { AND: andFilters } : {}

  return {
    category,
    q,
    sort,
    featuredOnly,
    limit,
    offset,
    priceMin,
    priceMax,
    histogram,
    looseMatch,
    priorityCategory,
    andFilters,
    pgTextFilter,
    subcategoryFilter,
    where,
  }
}

// Every branch ends with { id: 'desc' } — a UNIQUE, monotonic tiebreaker. Without it,
// rows tied on the sort key get no stable order across independent LIMIT/OFFSET queries,
// so listings appear on two pages AND others are silently skipped as you paginate.
// RANK = the BOUNDED trust⊕recency blend (rankScore, src/lib/ranking.ts) — trust is a
// weighted edge, not a lexicographic override. It's the SOLE key on the default feed and
// the tiebreaker on the explicit price/popular sorts (so a chosen price order is honored,
// but ties favour trusted-and-fresh listings). Restricted sinks, Exceptional floats —
// without burying a fresh, relevant listing under a higher-trust seller's whole catalog.
export function buildFeedOrderBy(sort: string): Prisma.ListingOrderByWithRelationInput[] {
  const RANK: Prisma.ListingOrderByWithRelationInput = { rankScore: 'desc' }
  let orderBy: Prisma.ListingOrderByWithRelationInput[]
  switch (sort) {
    case 'recent':
      // TRUE recency (the results strip's "Mới nhất" tab): pure postedAt, no rank
      // blend. Deliberately a NEW value — the legacy 'newest' keeps its long-standing
      // meaning as the DEFAULT balanced blend (old URLs/params + the semantic-search
      // gate below both key on 'newest'), so nothing pre-existing changes behavior.
      orderBy = [{ postedAt: 'desc' }, { id: 'desc' }]
      break
    case 'price-low':
      orderBy = [{ price: 'asc' }, RANK, { id: 'desc' }]
      break
    case 'price-high':
      orderBy = [{ price: 'desc' }, RANK, { id: 'desc' }]
      break
    case 'popular':
      // "Được quan tâm" / "Most contacted": lead with contactCount (the same demand
      // signal now shown on the card as "Đã liên hệ N"), then views, so the tab's
      // label and its ordering agree. Was views-only, which read as "Most viewed".
      orderBy = [{ contactCount: 'desc' }, { views: 'desc' }, RANK, { id: 'desc' }]
      break
    case 'verified-first':
      orderBy = [{ verified: 'desc' }, RANK, { id: 'desc' }]
      break
    case 'newest':
    default:
      // Default ("Recommended"): the balanced blend, a single scalar sort. featured +
      // recency now live INSIDE rankScore, so this is paging-stable and re-decays daily.
      // Filters are a separate WHERE clause — a location/category narrows, then this ranks.
      orderBy = [RANK, { id: 'desc' }]
  }
  return orderBy
}

/** Subcategory facet counts for the facet base, memoized in the module-level cache above. */
export function getSubcategoryCounts(facetBaseFilters: Prisma.ListingWhereInput[]): Promise<{ slug: string; count: number }[]> {
  // Key on the FULL facet base so a change to ANY active filter (not just
  // category/district) invalidates the cached counts.
  const cacheKey = JSON.stringify(facetBaseFilters)
  const cached = subCountCache.get(cacheKey)
  if (cached && Date.now() - cached.at < SUBCOUNT_TTL) {
    return Promise.resolve(cached.data)
  }
  // One grouped query over the subcategorySlug column (taxonomy-aligned),
  // respecting every active filter except the subcategory selection itself.
  return db.listing
    .groupBy({ by: ['subcategorySlug'], where: { AND: facetBaseFilters }, _count: { _all: true } })
    .then((grouped) => {
      const data = grouped
        .filter((g) => g.subcategorySlug)
        .map((g) => ({ slug: g.subcategorySlug as string, count: g._count._all }))
      if (subCountCache.size >= SUBCOUNT_CACHE_MAX) subCountCache.delete(subCountCache.keys().next().value!) // evict oldest (insertion order)
      subCountCache.set(cacheKey, { at: Date.now(), data })
      return data
    })
}
