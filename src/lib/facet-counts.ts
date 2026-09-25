import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { DeskResolutionError, scopedListingWhere } from '@/lib/edition-scope'
import { CATEGORY_BY_SLUG, LISTING_TYPES, categoryHasBrand, facetsFor, rangeFacetsFor, typesFor, type FacetDef } from '@/lib/taxonomy'
import { attrFiltersFrom, attrMatcher, viewScope } from '@/lib/attr-match'
import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'
import { matchesProvinceRow } from '@/lib/province-match'
import { districtTextMatches, longerDistrictSpellings } from '@/lib/district-match'
import { inferDistrictFromQuery } from '@/lib/district-query'

/**
 * LIVE CHIP COUNTS — "how many results do I get if I tap this?", for every rail in the feed.
 *
 * ⚠️ THE COUNTS ARE CONDITIONAL, NEVER GLOBAL, AND THAT IS THE WHOLE POINT OF THE MODULE. A count
 * beside "Honda" must mean "how many results if I tap Honda, GIVEN everything else I have already
 * chosen". A global count lies at exactly the moment it is supposed to help: it says 40, the tap
 * returns 2, and the four-tap path (category → subcategory → brand → model) still dead-ends in an
 * empty page — which is the bug the chip counts exist to prevent.
 *
 * The standard shape, one rule for every dimension: COUNT WITH EVERY OTHER DIMENSION APPLIED AND
 * THIS ONE RELEASED. That is implemented by `releasedParams()` below, which deletes the dimension's
 * own query params from a CLONE of the request's params and hands the clone back to the feed's own
 * `buildFeedFilters()`.
 *
 * ⚠️ IT RE-RUNS THE FEED'S OWN FILTER BUILDER INSTEAD OF REBUILDING THE PREDICATES HERE, AND THAT IS
 * A CORRECTNESS DECISION, NOT A CONVENIENCE. A second, parallel implementation of "what does
 * ?condition=used mean" would drift from the real one on the first edit, and a count computed from a
 * predicate the click does not use is precisely a lying count. Re-invoking the builder makes drift
 * structurally impossible: whatever the feed filters on, the counts filter on. The builder is pure
 * parameter parsing apart from one `marketplaceListingScope()` call, which React-`cache`s per
 * request, so calling it eight times costs eight object allocations and zero extra queries —
 * measured, see PERFORMANCE below.
 *
 * ⚠️ THE FREE-TEXT QUERY IS DROPPED FROM EVERY BASE. Inherited deliberately from the facet base the
 * route already used for the subcategory counts, whose comment records why: on a semantic-only
 * search the literal keyword AND-match matches nothing, so keeping it would zero every chip on the
 * one screen where the rails matter most. The consequence is stated rather than hidden — with `?q=`
 * active the chips answer "given your STRUCTURAL chips", not "given your structural chips and your
 * search words". Every dimension here uses the same base, so at least they cannot disagree with each
 * other or with `subcategoryCounts`.
 *
 * PERFORMANCE — MEASURED, on the real dev database (Supabase ap-southeast-1 via the transaction
 * pooler, 48 public listings), not reasoned about. At that catalogue size the wall clock is almost
 * entirely ROUND TRIPS, ~55ms each, which is exactly the cost this shape exists to control:
 *
 *   feed response, facets OFF   45–56ms median (5 samples × four filter combinations)
 *   feed response, facets ON    53–56ms median                → +0 to +9ms, +0 to +2ms warm pool
 *   facet counts alone, cold    59–71ms / 5–6 SQL statements
 *   facet counts, memo hit      0.1ms / 0 statements
 *   8 concurrent DISTINCT filter sets   24 statements, not 48 — the ceiling shed the other four
 *
 * A few ms rather than +60ms because the route fires this INSIDE the same `Promise.all` as the feed's
 * own findMany + count: the aggregates overlap the query that was going to be waited on anyway, so
 * the cost to the response is max(feed, facets) − feed, never their sum. What makes that possible:
 *  · ONE `groupBy` PER DIMENSION GROUP, never one query per chip. Seven rails cost at most six
 *    queries, because brand+model come out of one grouping and district+province out of another,
 *    and each `all` ("this rail's own All chip") is the SUM of that same groupBy's buckets rather
 *    than a COUNT of its own.
 *  · CALLERS ASK FOR THE DIMENSIONS THEY WILL RENDER (`dimensions`), so a category with no brand
 *    rail and no year facet never pays for one — 5 statements on the all-categories feed, 6 inside
 *    a brand category.
 *  · A 60s memo keyed on the `where` CLAUSES themselves (same TTL and eviction as the
 *    subcategory-count cache in feed-query.ts) takes a repeated filter combination to zero — and,
 *    because the key is the predicates rather than the query string, an unknown param appended to
 *    the URL cannot force a miss.
 *  · The route does not call this for `offset > 0`: a load-more page re-renders no rail, so an
 *    infinite scroll pays nothing after its first page.
 *
 * ⚠️ 2026-09-25 ADDED TWO AGGREGATES, BOTH ONLY WHERE THEY ARE DRAWN: `deal` (one small groupBy on
 * `marketPosition`, every browse state — the Good-price toggle is always on screen) and `attr` (one
 * groupBy on the raw `attributes`+`facetTokens` columns, only in a view whose Filter panel has chips
 * or sliders; ≤2,899 groups, measured). Timed through the tunnel against production the same day,
 * first page with facets, cold memo: no measurable change against the previous revision (the noise
 * between two runs of the same code was larger). The note below about the pool still stands.
 *
 * ⚠️ THE ONE COST THAT IS NOT FREE IS POOL CONCURRENCY, and it is worth knowing before the catalogue
 * grows. node-postgres defaults to 10 connections (src/lib/db.ts sets no `max`), and a cold first
 * page inside a category now wants 10 or 11 at once: feed rows, the total, the subcategory groupBy,
 * the category total, six aggregates, and — once every five minutes — the category id→slug read.
 * That is at or just over the ceiling, so the last one or two queue rather than fail. Acceptable
 * because the memo and the `offset > 0` gate make a fully cold first page the exception, but if a
 * later change adds another parallel read to this route, shorten the dimension list rather than
 * adding a twelfth.
 */

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * PUBLIC SHAPE — what the UI consumes. Designed so a rail can render straight from it: no
 * summing, no keying by anything but the value the chip already puts in the URL.
 * ───────────────────────────────────────────────────────────────────────────────────────────── */

/** One rail's counts. */
export type DimensionCounts = {
  /**
   * The rail's "All" chip: results with this dimension released entirely, every other filter
   * applied. Always the sum of `values` PLUS the rows that fall in no bucket (no brand set, no
   * year set, condition null…), which is exactly what tapping "All" returns.
   */
  all: number
  /**
   * count per option, keyed by the EXACT search-param value the chip sets — `values['honda']` for
   * `?brand=honda`, `values['2022-2027']` for `?range_year=2022-2027`. A missing key means zero;
   * every dimension with a known, static option list is pre-seeded with zeros so the UI can render
   * `values[slug]` directly and still show an honest 0 on a chip nothing matches.
   *
   * ⚠️ LOOK COUNTS UP HERE; DO NOT BUILD THE RAIL FROM `Object.keys(values)`. This record is a
   * lookup table, not a chip list. It reports a count for any value the DATA carries, including
   * ones the taxonomy does not list — a category row that exists only in the database, a legacy
   * `rent` listing in a category that is now buy-sell-only. Reporting them is the honest answer,
   * because those chips would genuinely return those rows and hiding real inventory is its own
   * lie; rendering them is not, because the rail's options are a reviewed product decision that
   * lives in src/lib/taxonomy.ts. Iterate the taxonomy, index into this.
   */
  values: Record<string, number>
}

/**
 * The rails this module can count. `type` is the intent axis (`?type=`), `area` is the location
 * rail (`?district=` / `?province=`), which is one dimension because picking a place REPLACES the
 * previous place.
 */
export type FacetDimension = 'category' | 'subcategory' | 'brand' | 'model' | 'condition' | 'type' | 'year' | 'area' | 'attr' | 'deal'

/**
 * The payload. A dimension is ABSENT when it was not requested or could not apply (no brand rail
 * outside the brand categories, no model rail until a brand is chosen) — absent means "render no
 * counts", never "zero".
 */
export type FacetCounts = {
  category?: DimensionCounts
  /** keyed by `subcategorySlug` */
  subcategory?: DimensionCounts
  /** keyed by `brandSlug` — data-driven, so a brand absent from the catalogue is simply absent */
  brand?: DimensionCounts
  /**
   * keyed by the exact `Listing.model` display string; only present once a brand is selected.
   *
   * Free text, so this one is not seeded and its size is data-driven — bounded in practice by the
   * models of ONE brand inside the current filters, which is why the rail is gated on a chosen
   * brand rather than offered across the whole catalogue.
   */
  model?: DimensionCounts
  /** keyed by `'new'` / `'used'` */
  condition?: DimensionCounts
  /**
   * keyed by `listingType`, seeded from the active category's own `types` (the whole enum when no
   * category is chosen).
   *
   * ⚠️ A VALUE OUTSIDE THAT SEED STILL APPEARS IF ROWS CARRY IT — e.g. a legacy `rent` listing left
   * in Vehicles after rentals became its own category. Reporting it is the honest answer, because
   * such a chip WOULD return those rows; suppressing it would hide real inventory. So the rail must
   * be rendered from the taxonomy (`typesFor(category)`) and look its counts up here, NOT built
   * from `Object.keys(values)` — otherwise one stray row grows a chip the category does not offer.
   */
  type?: DimensionCounts
  /** keyed by the `range_year` param value, e.g. `'2022-2027'` — see `yearBands()` */
  year?: DimensionCounts
  /** keyed by `DISTRICTS[].slug` (the `?district=` value) */
  area?: DimensionCounts
  /** keyed by the exact `?province=` values the caller passed in `provinceValues` */
  province?: DimensionCounts
  /**
   * The Filter panel's chips: one rail per attribute facet the view offers, keyed by the facet's
   * `key`, each with its options' counts keyed by the exact `attr_<key>` value the chip sets.
   * Counted like every other rail — THIS facet released, every other filter applied, the other
   * `attr_*` filters included — from one grouped query (see `attrView`).
   * ⚠️ ONLY ABOUT `attrScope`. The facets differ per (category, subcategory), so a payload held over
   * a subcategory tap describes the previous view's facets; a reader must check the scope first.
   */
  attr?: Record<string, DimensionCounts>
  /** `${category}/${subcategory || 'all'}` — the view `attr` and `rangePresent` were counted for. */
  attrScope?: string
  /**
   * Rows in the view that carry a value in each range facet's column (`year`, `areaM2`…), keyed by
   * column. A slider over a column no row fills can only ever empty the feed — any move filters out
   * the nulls — so the panel hides it at 0 (vehicles: `year` is set on 0 of 100 rows).
   */
  rangePresent?: Record<string, number>
  /** "Good price" (`?deal=good`): `values.good` rows priced below their market band, `all` without it. */
  deal?: DimensionCounts
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * YEAR BANDS — chips over a column the feed filters as a RANGE.
 * ───────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The oldest year a band may reach. Mirrors the `year` range facet's declared `min` in
 * src/lib/taxonomy.ts — a band that started below the slider's own domain would offer a chip the
 * slider cannot express. `facet-counts.test.ts` asserts the two still agree, so the taxonomy can
 * move it without this file silently disagreeing.
 */
export const YEAR_BAND_MIN = 1990

/**
 * Year chips, newest first, as `{ key, min, max }` where `key` is EXACTLY the `range_year` param
 * value the chip sets (`min-max`, either side omissible — the same `split('-')` the feed parses).
 *
 * ⚠️ RELATIVE TO THE CURRENT YEAR, NOT A FROZEN LIST. Hardcoded year bands rot silently: "2020+"
 * stops meaning "recent" and nobody notices, because a stale band is still a valid filter that
 * still returns rows. `now` is injectable so the test can pin a year.
 */
export function yearBands(now: Date = new Date()): { key: string; min: number; max: number }[] {
  const y = now.getFullYear()
  // The newest band reaches y+1 for the same reason the taxonomy's slider does: dealers list
  // next-year models.
  const spans: [number, number][] = [
    [y - 4, y + 1],
    [y - 9, y - 5],
    [y - 14, y - 10],
    [YEAR_BAND_MIN, y - 15],
  ]
  return spans
    .filter(([min, max]) => max >= min && max >= YEAR_BAND_MIN)
    .map(([min, max]) => ({ key: `${Math.max(min, YEAR_BAND_MIN)}-${max}`, min: Math.max(min, YEAR_BAND_MIN), max }))
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE CLASSIFIERS — pure mirrors of predicates that live in the feed's filter builder.
 *
 * ⚠️ EACH ONE IS A HAND-WRITTEN COPY OF A PRISMA PREDICATE AND MUST STAY EXACT, INCLUDING ITS
 * WARTS. These exist because the predicates are `contains` matches over free-text columns, which a
 * `groupBy` cannot express — so the grouping is done on the raw column and bucketed here. If a
 * classifier is "tidier" than the predicate it mirrors, the count stops matching the click, which
 * is the one failure this module exists to prevent. They are pure and unit-tested for that reason.
 * ───────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Mirrors the condition predicate in `buildFeedFilters`: NEWISH is a case-INSENSITIVE `contains`
 * of 'new' or 'mới'; `used` is "has a condition set AND is not NEWISH"; an unset condition is
 * NEITHER chip (it is still in `all`, because clearing the chip returns it).
 */
export function conditionBucket(condition: string | null | undefined): 'new' | 'used' | null {
  if (condition === null || condition === undefined) return null
  const c = condition.toLowerCase()
  return c.includes('new') || c.includes('mới') ? 'new' : 'used'
}

/**
 * Mirrors `buildDistrictFilter`: for each district, a `contains` over BOTH `district` and
 * `location`.
 *
 * ⚠️ CASE-SENSITIVE ON PURPOSE. Prisma's `contains` without `mode: 'insensitive'` compiles to
 * `LIKE '%x%'` on Postgres, and the district filter passes no mode. `toLowerCase()` here would
 * count rows the tap does not return.
 *
 * ⚠️ A ROW CAN STILL LAND IN TWO DISTRICTS AND THAT IS FAITHFUL (a location naming a ward that
 * shares a district's name). What no longer happens is 'District 1' claiming 'District 10': the
 * filter matches a numbered spelling only at a number boundary (src/lib/district-match.ts), and
 * this mirrors it through the same module, so the count still equals the tap.
 */
export function districtSlugsFor(row: { district?: string | null; location?: string | null }): string[] {
  const hay = [row.district ?? '', row.location ?? '']
  const out: string[] = []
  for (const d of DISTRICTS) {
    if (!d.match?.length) continue // 'all' carries no match list — it is the released state
    if (!d.match.some((m) => hay.some((h) => districtTextMatches(h, m)))) continue
    // The feed's second guard (district-slug.ts): the canonical column may not name a longer district.
    if (longerDistrictSpellings(d.slug).some((l) => (row.district ?? '').includes(l))) continue
    out.push(d.slug)
  }
  return out
}

/**
 * Mirrors the province predicate (src/lib/province-match.ts): `contains` over `city` OR `location`,
 * case-sensitive, plus the province's other spellings over `city` only.
 */
export function matchesProvince(row: { city?: string | null; location?: string | null }, province: string): boolean {
  return matchesProvinceRow(row, province)
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * RELEASE — which params a dimension drops before its own count is taken.
 * ───────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Params that describe the PAGE rather than the result set. Stripped from every count base so that
 * paging, the response language and the sort do not multiply the memo key, and — the one that is
 * load-bearing — so `histogram=1` cannot reach the builder, where it suppresses the price filter
 * and would silently widen every count.
 */
const PRESENTATION_PARAMS = ['offset', 'limit', 'lang', 'sort', 'histogram', 'priorityCategory', 'ids']

/**
 * The free-text search, stripped from every base along with the presentation params.
 *
 * ⚠️ DELETING THE PARAM, NOT JUST DROPPING THE CLAUSE, AND THE DIFFERENCE IS A DENIAL OF SERVICE.
 * The counts already ignore the query (see the module header), and the first version achieved that
 * by filtering `pgTextFilter` out of the builder's output — correct numbers, but `q` was still in
 * the params, so it was still in the MEMO KEY. Instant search debounces at 150ms, so typing
 * "macbook" produces up to seven distinct keys whose answers are byte-identical, each one a memo
 * miss costing six aggregates. A bot appending a random `?q=` would miss it every single time.
 * Deleting the param instead means the builder never produces a text clause at all: same numbers,
 * one cache entry, and the key can no longer be inflated from outside. `match` goes with it —
 * it exists only to switch that clause between AND and OR.
 */
const TEXT_PARAMS = ['q', 'match']

/**
 * A clone of `searchParams` with `dimension`'s own selection removed.
 *
 * ⚠️ `category` RELEASES ITS WHOLE CASCADE, and the category rail MUST clear the same params when a
 * chip is tapped or the count lies. A subcategory slug is category-scoped, a `brandSlug` only
 * exists in the brand categories, and `attr_*` / `range_*` are per-category facet keys — so
 * counting other categories while still filtering on THIS category's subcategory would report the
 * inventory of a combination that cannot exist, i.e. mostly zeros. The contract for the UI is:
 * tapping a category chip sets `category` and deletes `subcategory`, `brand`, `model`, every
 * `attr_*` and every `range_*`.
 *
 * ⚠️ `subcategory` RELEASES ONLY ITSELF — deliberately narrower than `category`. Its counts are the
 * ones the route already publishes as `subcategoryCounts`, whose comment records the bug that
 * produced the rule ("a count said 12 but clicking yielded 2"): releasing MORE than the dimension
 * itself makes the number bigger than the tap returns. Brand survives a subcategory tap because
 * `brandSlug` is category-level, not subcategory-level.
 *
 * ⚠️ KNOWN LIMIT OF THAT CHOICE, STATED RATHER THAN DISCOVERED LATER: `attr_*` and `range_*` ARE
 * subcategory-scoped — `facetsFor(category, subcategory)` and `rangeFacetsFor(category,
 * subcategory)` in taxonomy.ts narrow by subcategory — so with `subcategory=motorbikes` and a
 * motorbike-only attribute set, the "cars" chip is counted with an attribute cars do not have and
 * reads 0. ⛔ THE FEED ROUTE NO LONGER HAS THAT LIMIT (2026-09-25): when such a filter is active it
 * counts each sibling with exactly the params THAT sibling's tap keeps (`subcategoryDropPlan`
 * below), because hiding zero chips made the wrong 0 hide a real aisle. This dimension — which only
 * a caller other than the route asks for by name — still releases the subcategory alone.
 *
 * ⚠️ `brand` AND `model` SHARE A RELEASE, so one groupBy answers both: brand counts need the model
 * released (choosing a different brand cannot keep the old brand's model), and the model counts are
 * then read back out of the same buckets, restricted to the selected brand.
 *
 * ⚠️ `area` RELEASES ALL THREE LOCATION PARAMS because a place REPLACES a place. `district`,
 * `province` and `ward` are three expressions of one choice, so a district count computed with the
 * previous province still applied would answer a question nobody asked.
 */
export function releasedParams(
  searchParams: URLSearchParams,
  dimension: FacetDimension,
  /**
   * The district the feed read out of `q` and APPLIED — the response's `inferredDistrict`, after
   * resolveFeedFilters. Omitted (a caller with no feed decision to hand over), the words are read
   * here the way buildFeedFilters reads them.
   */
  inferredDistrict?: string | null,
): URLSearchParams {
  const p = new URLSearchParams(searchParams)
  switch (dimension) {
    case 'category':
      p.delete('category')
      p.delete('subcategory')
      p.delete('brand')
      p.delete('model')
      // ⛔ THE PRICE RANGE GOES TOO, BECAUSE THE TAP CLEARS IT. `handleCategorySelect` in
      // listings-explorer.tsx also does `setPriceRange('all')` — "price brackets are
      // category-specific" — so a category count computed WITH the current price band answers a
      // question the tap will never ask. Measured shape of the lie: a buyer browsing Electronics
      // under 5,000,000 ₫ saw "Vehicles · 0", because almost no motorbike is under 5M; tapping it
      // would have reset the band and returned hundreds. That is off by two orders of magnitude in
      // the direction that SUPPRESSES a tap which would have worked — the inverse of the dead end
      // and the same class of lie. A released dimension must match what the handler actually
      // clears; if that handler ever stops clearing the price, this line comes out with it.
      p.delete('priceMin')
      p.delete('priceMax')
      // Snapshot the keys first — deleting while iterating a live URLSearchParams skips entries.
      for (const k of [...p.keys()]) if (k.startsWith('attr_') || k.startsWith('range_')) p.delete(k)
      break
    case 'subcategory':
      p.delete('subcategory')
      break
    case 'brand':
    case 'model':
      p.delete('brand')
      p.delete('model')
      break
    case 'condition':
      p.delete('condition')
      break
    case 'type':
      p.delete('type')
      break
    case 'year':
      p.delete('range_year')
      break
    case 'area':
      p.delete('district')
      p.delete('province')
      p.delete('ward')
      break
    // ⚠️ EVERY `attr_*` AT ONCE, NOT ONE FACET: one grouped query answers every attribute rail, and
    // each rail re-applies the OTHER attribute filters in memory (attrMatcher, the feed's own needles).
    // `range_*` stays in the base — a range filter narrows the attribute chips like any other filter.
    case 'attr':
      for (const k of [...p.keys()]) if (k.startsWith('attr_')) p.delete(k)
      break
    case 'deal':
      p.delete('deal')
      break
  }
  /**
   * ⛔ A DISTRICT READ OUT OF THE QUERY SURVIVES THE TEXT BEING DROPPED. The feed turns "căn hộ quận
   * 7" into the d7 scope plus the text "căn hộ" (src/lib/district-query.ts); deleting `q` below
   * would drop the scope with the words, and every chip would count the whole city while the grid
   * showed Quận 7 — a count the tap does not return. So the inferred slug is written back as the
   * `district` param it is equivalent to, from the ORIGINAL request, exactly when the feed would
   * infer it (no explicit district). The `area` rail is the one dimension that releases it: it
   * counts "if you pick THIS place instead". The inference reads the words alone, so every chip —
   * each a different category — would read them the same way the tap does.
   * ⚠️ The memo key stays bounded: a slug out of `DISTRICTS`, never the free text.
   * ⛔ IT IS THE FEED'S DECISION THAT IS WRITTEN BACK, NOT A FRESH PARSE. When the district reading
   * finds nothing and the plain words find something, the feed serves the plain words and applies no
   * district (resolveFeedFilters); counting the chips inside that district would then report zeros
   * for a grid that is full. The route passes its `inferredDistrict`, null in that case.
   */
  const explicit = searchParams.get('district')
  if (dimension !== 'area' && (!explicit || explicit === 'all')) {
    const slug = inferredDistrict !== undefined ? inferredDistrict : inferDistrictFromQuery(searchParams.get('q'))?.slug
    if (slug) p.set('district', slug)
  }
  for (const k of [...PRESENTATION_PARAMS, ...TEXT_PARAMS]) p.delete(k)
  return p
}

/**
 * ⛔ WHAT A SUBCATEGORY TAP DROPS, PER TARGET — for the subcategory rail's counts while a
 * SUBCATEGORY-SCOPED filter is active (bedrooms, storage, shoe size, area…).
 *
 * Measured on production 2026-09-25: Rentals › Apartment › 2 BR showed "Office · 0", and tapping
 * Office returned 2,270 — every office. The rail counted Office WITH `attr_bedrooms=2` applied (a
 * facet offices do not have), while the tap dropped it, so the chip said 0 for a full aisle. Hiding
 * zero chips on top of that would have hidden a real sibling. The explorer now prunes a filter the
 * new subcategory does not offer (it used to keep it on screen as a chip that filtered nothing), and
 * this is the same rule stated for the counter: for each target — '' for the "All" chip, else a
 * subcategory slug — the `attr_*` / `range_*` params of this category's facets that
 * `facetsFor(category, target)` does not offer. A filter the target DOES offer is kept, so Apartment
 * › 2 BR → House still counts two-bedroom houses (401), exactly as the tap returns them.
 *
 * Null when no target drops anything — the common case, where one base serves every chip.
 * ⚠️ A param that is not one of this category's facets at all is never dropped: the feed applies it,
 * so every count must too (the explorer never sends one).
 */
export function subcategoryDropPlan(searchParams: URLSearchParams, category: string): Map<string, string[]> | null {
  const cat = CATEGORY_BY_SLUG[category]
  if (!cat) return null
  const attrKeys = new Set(cat.facets.filter((f) => f.kind !== 'range').map((f) => f.key))
  const rangeCols = new Set(cat.facets.flatMap((f) => (f.kind === 'range' && f.range ? [f.range.column as string] : [])))
  const scoped: { param: string; attr: boolean; id: string }[] = []
  for (const k of new Set(searchParams.keys())) {
    const v = searchParams.get(k)
    if (!v || v === 'all') continue
    if (k.startsWith('attr_')) {
      const key = k.slice('attr_'.length).replace(/[^a-z0-9_]/gi, '')
      if (attrKeys.has(key)) scoped.push({ param: k, attr: true, id: key })
    } else if (k.startsWith('range_')) {
      const col = k.slice('range_'.length)
      if (rangeCols.has(col)) scoped.push({ param: k, attr: false, id: col })
    }
  }
  if (!scoped.length) return null
  const plan = new Map<string, string[]>()
  let dropsAny = false
  for (const target of ['', ...cat.subcategories.map((sc) => sc.slug)]) {
    const fs = facetsFor(category, target || null)
    const keys = new Set(fs.filter((f) => f.kind !== 'range').map((f) => f.key))
    const cols = new Set(fs.flatMap((f) => (f.kind === 'range' && f.range ? [f.range.column as string] : [])))
    const drop = scoped.filter((x) => (x.attr ? !keys.has(x.id) : !cols.has(x.id))).map((x) => x.param)
    if (drop.length) dropsAny = true
    plan.set(target, drop)
  }
  return dropsAny ? plan : null
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * COMPUTE
 * ───────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The feed's own filter builder, injected.
 *
 * ⚠️ INJECTED RATHER THAN IMPORTED so `src/lib` does not reach into `src/app`, and so the unit test
 * can drive the release semantics with a builder it controls. The route passes `buildFeedFilters`
 * from `src/app/api/listings/feed-query.ts` — there is exactly one implementation.
 */
export type FeedFilterBuilder = (params: URLSearchParams) => Promise<{
  andFilters: Prisma.ListingWhereInput[]
  pgTextFilter: Prisma.ListingWhereInput | null
}>

export type FacetCountOptions = {
  /** The request's params, untouched — this module clones before it edits. */
  searchParams: URLSearchParams
  /** `buildFeedFilters` from the feed route. */
  buildFilters: FeedFilterBuilder
  /**
   * The district the feed read out of `q` and applied (its response's `inferredDistrict`), so every
   * chip is counted inside the scope the grid shows — see releasedParams. Omitted, it is re-read
   * from the words.
   */
  inferredDistrict?: string | null
  /**
   * Which rails to count. Omit to let `defaultDimensions()` pick from the active category — which
   * is what the route does, and what keeps a category with no brand rail from paying for one.
   */
  dimensions?: FacetDimension[]
  /**
   * Candidate `?province=` values to count, e.g. `['Ho Chi Minh City', 'Hanoi']`. The province
   * options come from /api/geo at runtime, so this module cannot enumerate them; a caller that
   * renders province chips passes the ones it renders. Omit and the `province` dimension is absent.
   */
  provinceValues?: string[]
  /** Test seam for the year bands. */
  now?: Date
}

/**
 * What the Filter panel shows for the request's view: its attribute facets (chips — condition is its
 * own dimension) and the columns of its range facets. Mirrors the explorer, which reads
 * `facetsFor(activeCategory, activeSubcategory)`; `priorityCategory` stands in for `category` for
 * the reason `defaultDimensions` gives. Null when the view has neither.
 */
export function attrView(searchParams: URLSearchParams): { scope: string; facets: FacetDef[]; rangeColumns: string[] } | null {
  const category = searchParams.get('category') || searchParams.get('priorityCategory') || ''
  if (!category || category === 'all' || !CATEGORY_BY_SLUG[category]) return null
  const sub = searchParams.get('subcategory') || ''
  const all = facetsFor(category, sub && sub !== 'all' ? sub : null)
  const facets = all.filter((f) => f.kind !== 'range' && f.key !== 'condition' && f.options.length > 0)
  const rangeColumns = all.flatMap((f) => (f.kind === 'range' && f.range ? [f.range.column] : []))
  if (!facets.length && !rangeColumns.length) return null
  return { scope: viewScope(category, sub), facets, rangeColumns }
}

/**
 * The rails worth counting for the active category — see `FacetCountOptions.dimensions`.
 *
 * ⚠️ `subcategory` IS DELIBERATELY NOT IN HERE, THOUGH IT IS A REAL DIMENSION THIS MODULE CAN
 * COMPUTE. The feed route has already run that exact groupBy (`getSubcategoryCounts`, memoized in
 * feed-query.ts) plus its "All" total by the time it calls in, and it publishes both as the
 * long-standing top-level `subcategoryCounts` / `categoryTotal` keys — including on load-more
 * pages, where no rail is re-rendered and no facet counts are computed at all. Repeating it here
 * would buy a duplicate query and a second source of truth. The route fills `counts.subcategory`
 * from what it already holds; a DIFFERENT caller with no such data can ask for it by name.
 */
export function defaultDimensions(searchParams: URLSearchParams): FacetDimension[] {
  // ⛔ `priorityCategory` COUNTS AS A CATEGORY SIGNAL HERE, AND MISSING THAT KILLED TAPS 3 AND 4.
  // The explorer does NOT send `category` once a brand is chosen without a model — it sends
  // `priorityCategory` instead (listings-explorer.tsx: `else if (activeCategory !== 'all')
  // params.set('priorityCategory', activeCategory)`). Reading only `category` therefore returned
  // ['category','condition','type','area'] the instant someone tapped a brand, and since an ABSENT
  // dimension means "render no counts", the brand rail went dark at exactly the tap that opens it
  // and the MODEL rail — tap four, the one this whole module exists for — could only ever get
  // counts after a model was already picked. The four-tap dead end was unguarded precisely where
  // it is most likely.
  // It stays a PRESENTATION_PARAM for the count BASES (it is a ranking hint, not a filter, so it
  // must not narrow a count); this reads it only to decide WHICH RAILS EXIST.
  const category = searchParams.get('category') || searchParams.get('priorityCategory') || undefined
  const subcategory = searchParams.get('subcategory') || undefined
  // `deal` everywhere: the Good-price toggle sits in the sort strip on every browse state.
  const dims: FacetDimension[] = ['category', 'condition', 'type', 'area', 'deal']
  if (category && category !== 'all' && CATEGORY_BY_SLUG[category]) {
    if (attrView(searchParams)) dims.push('attr')
    // The brand rail is a property of the CATEGORY (BRAND_CATEGORY_SLUGS in taxonomy.ts); the
    // model rail lives under a chosen brand, so it cannot exist before one is chosen; the year
    // rail exists only where the category (narrowed by subcategory) declares a `year` range facet.
    if (categoryHasBrand(category)) {
      dims.push('brand')
      if ((searchParams.get('brand') || '') !== '') dims.push('model')
    }
    if (rangeFacetsFor(category, subcategory).some((f) => f.range.column === 'year')) dims.push('year')
  }
  return dims
}

/**
 * Category id → slug, memoized. Categories are seed data: 15 rows that do not change at runtime, so
 * a per-request query for them would be a round trip spent on a constant. The TTL exists only so a
 * reseed is picked up without a redeploy.
 *
 * ⚠️ TRANSLATION ONLY — THE CHIP LIST IS SEEDED FROM THE TAXONOMY, NOT FROM THIS QUERY. `groupBy`
 * can only return `categoryId`, so the map is needed to name the buckets; but seeding the rail from
 * whatever rows the table happens to hold would publish any category that exists in the database
 * and not in `TAXONOMY`. Measured 2026-08-11: the two agree exactly (15 slugs, same set), so this
 * costs nothing today — it is the day they DISAGREE that matters, and on that day the canonical,
 * edition-reviewed list is the one in src/lib/taxonomy.ts. A category that is in the table and not
 * in the taxonomy still gets its real count reported (hiding inventory would be its own lie); it
 * just does not get a seeded chip.
 */
const CATEGORY_MAP_TTL = 5 * 60_000
let categoryMap: { at: number; byId: Map<string, string> } | null = null
async function categoryIdToSlug(): Promise<Map<string, string>> {
  if (categoryMap && Date.now() - categoryMap.at < CATEGORY_MAP_TTL) return categoryMap.byId
  const rows = await db.category.findMany({ select: { id: true, slug: true } })
  categoryMap = { at: Date.now(), byId: new Map(rows.map((r) => [r.id, r.slug])) }
  return categoryMap.byId
}

/**
 * The subcategory rail, built from counts the CALLER already has.
 *
 * Exported because the feed route holds those numbers before it calls in — its own memoized
 * `getSubcategoryCounts` groupBy and the matching "All" total, both over the identical facet base —
 * and re-querying them here would be a duplicate round trip. What it must NOT do is hand-assemble
 * the shape: every other rail seeds its known options with zero so an empty chip renders an honest
 * 0 rather than vanishing, and a rail that skipped that step would be the one dimension whose
 * `values[slug]` is `undefined`. One function, so both paths produce the same object.
 */
export function subcategoryDimension(categorySlug: string, all: number, counts: Record<string, number>): DimensionCounts {
  const values: Record<string, number> = Object.fromEntries(
    (CATEGORY_BY_SLUG[categorySlug]?.subcategories ?? []).map((s) => [s.slug, 0]),
  )
  for (const [slug, n] of Object.entries(counts)) values[slug] = n
  return { all, values }
}

/**
 * Memo for a whole payload, keyed on the exact question asked. Same TTL and eviction shape as the
 * subcategory-count cache in feed-query.ts, for the same reason: these numbers change slowly, the
 * rails are re-rendered on every filter change, and a warm instance should not re-run six
 * aggregates per second for the same filter combination.
 */
const FACET_TTL = 60_000
const FACET_CACHE_MAX = 500
const facetCache = new Map<string, { at: number; data: FacetCounts }>()

/**
 * In-flight computations, and the ceiling on how many may run at once.
 *
 * ⚠️ THE MEMO ALONE DOES NOT BOUND THIS, AND SAYING "THE KEY CANNOT BE FORGED" WAS ONLY HALF TRUE.
 * Keying on the predicates stops an IGNORED param (`?nocache=1`) from splitting the cache — but
 * `?priceMin=1`, `?priceMin=2`, `?priceMin=3` are params the feed HONOURS, so each is a genuinely
 * different question, a genuine miss, and now six aggregates instead of the two the feed used to
 * cost. On an unauthenticated GET behind an edge cache that keys on the URL, that amplification is
 * reachable from a browser address bar, and 500 distinct values also evict every legitimate entry.
 *
 * Two bounds, both of which fail toward "no numbers on the chips" and never toward "no feed":
 *  · SINGLE-FLIGHT. Concurrent requests asking the identical question share one computation instead
 *    of each running its own fan-out — the case a plain results cache cannot help with, because
 *    nothing is cached until the first one finishes.
 *  · A HARD CEILING on distinct concurrent computations. Past it, this returns `{}` immediately.
 *    The arithmetic that picks the number: node-postgres allows 10 connections, the feed itself
 *    wants about four of them, and each computation wants up to six — so four in flight is roughly
 *    two round trips of queueing, which the pool absorbs. Beyond that the queue grows faster than
 *    it drains and the FEED starts timing out, which is a far worse outcome than a rail rendering
 *    without counts for a moment.
 */
const FACET_MAX_CONCURRENT = 4
const inFlight = new Map<string, Promise<FacetCounts>>()

/** Test seam: the memo is process-wide, so a test that asserts query counts must be able to clear it. */
export function __clearFacetCountCache() {
  facetCache.clear()
  inFlight.clear()
  categoryMap = null
}

/**
 * Live counts for every requested rail.
 *
 * ⚠️ FAILS SOFT — EXCEPT ON THE EDITION BOUNDARY. Chip counts are a nicety and this runs on the
 * busiest route in the app: a Postgres hiccup must degrade the rails to "no numbers", not 500 the
 * feed. `DeskResolutionError` is the one error that must still propagate, because it means the
 * visa/trip desk could not be excluded, and the whole point of `edition-scope.ts` is that this
 * condition fails LOUD rather than quietly publishing e-Visa SKUs on the licensed marketplace.
 */
export async function computeFacetCounts(opts: FacetCountOptions): Promise<FacetCounts> {
  const { searchParams, buildFilters, provinceValues, now, inferredDistrict } = opts
  const dimensions = opts.dimensions ?? defaultDimensions(searchParams)

  /** Every filter for `dimension`'s count: the feed's own AND-array minus the free-text clause. */
  const baseFor = async (dimension: FacetDimension): Promise<Prisma.ListingWhereInput[]> => {
    const { andFilters, pgTextFilter } = await buildFilters(releasedParams(searchParams, dimension, inferredDistrict))
    return andFilters.filter((f) => f !== pgTextFilter)
  }

  const want = new Set(dimensions)
  const out: FacetCounts = {}

  try {
    /**
     * Build every `where` FIRST. This is pure parameter parsing (the one lookup inside the builder
     * and inside `scopedListingWhere` is the same React-cached desk resolution), so it costs no
     * round trip — and resolving them up front is what lets the aggregates below start together
     * instead of each waiting on the previous `await`.
     *
     * ⚠️ `scopedListingWhere()` IS WRITTEN OUT ONCE PER BASE INSTEAD OF BEING FOLDED INTO `baseFor`,
     * WHICH IS NOT AN OVERSIGHT. Rule A of scripts/edition-lint.mjs counts guards against reads in
     * each file precisely so that a single guard cannot appear to cover N reads it does not — "five
     * reads and one guard is now four reported, not zero", as that script puts it. A helper here
     * would pass a rule that is trying to protect the highest-leverage exclusion in the app, and it
     * would keep passing on the day someone adds an eighth aggregate and forgets. The repetition is
     * the check. `buildFeedFilters` also pushes this exclusion, so the operand appears twice and
     * Postgres flattens it — cheaper than a leak.
     */
    const view = want.has('attr') ? attrView(searchParams) : null
    const [catBase, subBase, brandBase, condBase, typeBase, yearBase, areaBase, attrBase, dealBase] = await Promise.all([
      want.has('category') ? baseFor('category').then((b) => scopedListingWhere({ AND: b })) : null,
      want.has('subcategory') ? baseFor('subcategory').then((b) => scopedListingWhere({ AND: b })) : null,
      want.has('brand') || want.has('model') ? baseFor('brand').then((b) => scopedListingWhere({ AND: b })) : null,
      want.has('condition') ? baseFor('condition').then((b) => scopedListingWhere({ AND: b })) : null,
      want.has('type') ? baseFor('type').then((b) => scopedListingWhere({ AND: b })) : null,
      want.has('year') ? baseFor('year').then((b) => scopedListingWhere({ AND: b })) : null,
      want.has('area') ? baseFor('area').then((b) => scopedListingWhere({ AND: b })) : null,
      view ? baseFor('attr').then((b) => scopedListingWhere({ AND: b })) : null,
      want.has('deal') ? baseFor('deal').then((b) => scopedListingWhere({ AND: b })) : null,
    ])
    /** The request's own `attr_*` filters — released from `attrBase`, re-applied per rail in memory. */
    const activeAttrs = attrFiltersFrom(searchParams)
    /**
     * ⛔ THE MODEL CHIPS ARE COUNTED INSIDE THE CATEGORY THEIR TAP APPLIES. With a brand and no model
     * the explorer sends `priorityCategory` (a soft boost), so the brand base spans every category
     * — but tapping a model sets `category` hard (listings-explorer.tsx). Counted across categories,
     * a model chip overstated its tap (production, 2026-09-25: MacBook Pro 63 → 52, iPhone 17 Pro
     * Max 60 → 55), and a model sold only elsewhere drew a non-zero chip whose tap returned nothing.
     * The brand groupBy then also groups by category, and only the model buckets are narrowed; the
     * brand tiles and the model rail's "All" keep the soft scope their own taps use.
     */
    const selectedBrand = searchParams.get('brand')?.trim() || ''
    const modelCategory = want.has('model') && selectedBrand && selectedBrand !== 'all' && !searchParams.get('category')
      ? searchParams.get('priorityCategory')?.trim() || ''
      : ''
    const modelInCategory = !!modelCategory && modelCategory !== 'all'
    /**
     * ⚠️ ONE QUERY FOR THE INTENT MENU AND THE GOOD-PRICE TOGGLE WHEN THEIR BASES ARE THE SAME — which
     * is whenever neither `type` nor `deal` is set, i.e. almost every page. Each base releases only
     * its own param, so with both unset they are the identical `where`, and grouping it by both
     * columns answers both rails. The `deal` rail then costs no extra connection on a pool the note
     * at the top of this file already calls tight (a reviewer's point, 2026-09-25).
     */
    const typeAndDeal = !!typeBase && !!dealBase && JSON.stringify(typeBase) === JSON.stringify(dealBase)

    /**
     * ⚠️ THE MEMO IS KEYED ON THE `where` CLAUSES, NOT ON THE QUERY STRING, AND THAT IS WHAT MAKES
     * IT UNBUSTABLE FROM OUTSIDE. Keying on params — even params minus a denylist — means any
     * unknown key an attacker or a stray analytics tag appends (`?nocache=…`, `?utm_source=…`) is a
     * fresh key for an identical answer: a guaranteed miss, six aggregates, on the busiest route,
     * repeatable as fast as requests can be made. An allowlist of "params that matter" fails the
     * other way and worse — the day someone adds a filter param to buildFeedFilters and not to the
     * list, the memo starts serving CONFIDENTLY WRONG counts. The predicates the queries are about
     * to run are the exact identity of the answer: a param the builder ignores cannot change them,
     * and a param it honours always does. Building them first costs no round trip (pure parameter
     * parsing over a React-cached desk lookup), which is why this can sit after them.
     *
     * ⚠️ THE THREE THINGS THAT SHAPE THE OUTPUT WITHOUT SHAPING A BASE HAVE TO BE ADDED BY HAND.
     * The selected brand narrows the MODEL buckets but is released from every base, so two brands
     * inside one category would otherwise share a key and swap model rails; the selected category
     * chooses the type/subcategory seed; and the year bands move with the calendar.
     * ⚠️ AND THE ATTRIBUTE RAILS ADD TWO MORE: the active `attr_*` filters are released from
     * `attrBase` and re-applied in memory, and the facet list follows the view (`view.scope`, which
     * reads `priorityCategory` — a param every base strips).
     */
    const cacheKey = JSON.stringify([
      dimensions,
      provinceValues ?? null,
      searchParams.get('brand') ?? null,
      searchParams.get('category') ?? null,
      (now ?? new Date()).getFullYear(),
      view?.scope ?? null,
      activeAttrs,
      modelInCategory ? modelCategory : null,
      catBase, subBase, brandBase, condBase, typeBase, yearBase, areaBase, attrBase, dealBase,
    ])
    const hit = facetCache.get(cacheKey)
    if (hit && Date.now() - hit.at < FACET_TTL) return hit.data

    // Someone is already asking this exact question — wait for their answer rather than doubling
    // the load to compute the same numbers twice.
    const running = inFlight.get(cacheKey)
    if (running) return await running
    // Too many DIFFERENT questions at once: shed this one. Chips lose their numbers for a beat;
    // the feed keeps its connections. See FACET_MAX_CONCURRENT.
    if (inFlight.size >= FACET_MAX_CONCURRENT) return {}

    // Registered BEFORE the first await below, so a sibling request arriving in the same tick sees
    // it and joins instead of starting a second identical fan-out.
    const work = aggregate()
    inFlight.set(cacheKey, work)
    try {
      return await work
    } finally {
      inFlight.delete(cacheKey)
    }


    async function aggregate(): Promise<FacetCounts> {
    // Fired together: each groupBy is an independent aggregate on its own pooled connection, so
    // six of them cost ~one round trip rather than six. Grouped by SHARED BASE, not by rail —
    // brand+model come out of one query, and so do the district and province rails.
    const [categoryGroups, categoryNames, subRes, brandRes, conditionRes, typeRes, yearRes, areaRes, attrRes, dealRes] = await Promise.all([
      catBase ? db.listing.groupBy({ by: ['categoryId'], where: catBase, _count: { _all: true } }) : null,
      catBase || modelInCategory ? categoryIdToSlug() : null,
      subBase ? db.listing.groupBy({ by: ['subcategorySlug'], where: subBase, _count: { _all: true } }) : null,
      // ⚠️ ONE groupBy CALL PER BASE, the grouping columns chosen inside it: edition-lint's Rule A
      // counts reads against scope guards per file, and a ternary of two calls over one scoped base
      // would read as an unguarded read. (The cast keeps the result type; `categoryId` is read below.)
      brandBase
        ? db.listing.groupBy({ by: (modelInCategory ? ['brandSlug', 'model', 'categoryId'] : ['brandSlug', 'model']) as ['brandSlug', 'model'], where: brandBase, _count: { _all: true } })
        : null,
      condBase ? db.listing.groupBy({ by: ['condition'], where: condBase, _count: { _all: true } }) : null,
      typeBase
        ? db.listing.groupBy({ by: (typeAndDeal ? ['listingType', 'marketPosition'] : ['listingType']) as ['listingType'], where: typeBase, _count: { _all: true } })
        : null,
      yearBase ? db.listing.groupBy({ by: ['year'], where: yearBase, _count: { _all: true } }) : null,
      areaBase
        ? db.listing.groupBy({
            // `location` and `city` ride along because the district and province predicates match
            // them as well as `district` — grouping on `district` alone would miss every row whose
            // area is only in its location string, and under-report a chip against its own tap.
            // Measured on the dev catalogue: 10 distinct combinations for 48 public listings,
            // because `location` carries the ward/district label, not a street address.
            by: ['district', 'location', 'city'],
            where: areaBase,
            _count: { _all: true },
          })
        : null,
      /**
       * ⚠️ GROUPED ON THE RAW COLUMNS, CLASSIFIED IN MEMORY — the attribute predicates are `contains`
       * matches over a JSON string, which a groupBy cannot bucket. Measured on production
       * 2026-09-25: the widest view (sports, whole category) is 2,899 distinct (attributes,
       * facetTokens) pairs over 5,591 rows; every other category is under 500. The range columns
       * ride along as NON-NULL counts (`_count.<col>`), which is all `rangePresent` needs.
       */
      attrBase && view
        ? db.listing.groupBy({
            by: ['attributes', 'facetTokens'],
            where: attrBase,
            _count: { _all: true, ...Object.fromEntries(view.rangeColumns.map((c) => [c, true])) } as Prisma.ListingCountAggregateInputType,
          })
        : null,
      dealBase && !typeAndDeal ? db.listing.groupBy({ by: ['marketPosition'], where: dealBase, _count: { _all: true } }) : null,
    ])
    const categoryRes = categoryGroups && categoryNames ? { grouped: categoryGroups, byId: categoryNames } : null

    if (categoryRes) {
      // Seeded from the TAXONOMY, so an empty category renders an honest 0 instead of vanishing and
      // a row that exists only in the database cannot invent a chip — see categoryIdToSlug().
      const values: Record<string, number> = Object.fromEntries(Object.keys(CATEGORY_BY_SLUG).map((s) => [s, 0]))
      let all = 0
      for (const g of categoryRes.grouped) {
        const slug = categoryRes.byId.get(g.categoryId)
        all += g._count._all
        if (slug) values[slug] = (values[slug] ?? 0) + g._count._all
      }
      out.category = { all, values }
    }

    if (subRes) {
      // Rows with no subcategorySlug land in `all` only — which is right: clearing the rail
      // returns them. Assembled through the same helper the feed route uses, so the seeded shape
      // cannot differ between the two paths.
      const counts: Record<string, number> = {}
      let all = 0
      for (const g of subRes) {
        all += g._count._all
        if (g.subcategorySlug) counts[g.subcategorySlug] = (counts[g.subcategorySlug] ?? 0) + g._count._all
      }
      out.subcategory = subcategoryDimension(searchParams.get('category') || '', all, counts)
    }

    if (brandRes) {
      const brandValues: Record<string, number> = {}
      const modelValues: Record<string, number> = {}
      const modelCategoryId = modelInCategory && categoryNames
        ? [...categoryNames].find(([, slug]) => slug === modelCategory)?.[0] ?? null
        : null
      let all = 0
      let modelAll = 0
      for (const g of brandRes as { brandSlug: string | null; model: string | null; categoryId?: string; _count: { _all: number } }[]) {
        all += g._count._all
        if (g.brandSlug) brandValues[g.brandSlug] = (brandValues[g.brandSlug] ?? 0) + g._count._all
        // The model rail lives UNDER the chosen brand, so its buckets are this same base narrowed
        // to that brand — read back out of the rows we already have rather than re-queried.
        if (selectedBrand && selectedBrand !== 'all' && g.brandSlug === selectedBrand) {
          modelAll += g._count._all
          const inScope = !modelInCategory || g.categoryId === modelCategoryId
          if (g.model && inScope) modelValues[g.model] = (modelValues[g.model] ?? 0) + g._count._all
        }
      }
      if (want.has('brand')) out.brand = { all, values: brandValues }
      if (want.has('model') && selectedBrand && selectedBrand !== 'all') out.model = { all: modelAll, values: modelValues }
    }

    if (conditionRes) {
      const values: Record<string, number> = { new: 0, used: 0 }
      let all = 0
      for (const g of conditionRes) {
        all += g._count._all
        const bucket = conditionBucket(g.condition)
        if (bucket) values[bucket] += g._count._all
      }
      out.condition = { all, values }
    }

    if (typeRes) {
      const category = searchParams.get('category') || undefined
      const seed = category && category !== 'all' && CATEGORY_BY_SLUG[category] ? typesFor(category) : LISTING_TYPES.map((t) => t.value)
      const values: Record<string, number> = Object.fromEntries(seed.map((t) => [t, 0]))
      let all = 0
      for (const g of typeRes) {
        all += g._count._all
        values[g.listingType] = (values[g.listingType] ?? 0) + g._count._all
      }
      out.type = { all, values }
    }

    if (yearRes) {
      const bands = yearBands(now)
      const values: Record<string, number> = Object.fromEntries(bands.map((b) => [b.key, 0]))
      let all = 0
      for (const g of yearRes) {
        all += g._count._all
        if (g.year === null) continue // no year set — in `all`, in no band, exactly like the filter
        for (const b of bands) if (g.year >= b.min && g.year <= b.max) values[b.key] += g._count._all
      }
      out.year = { all, values }
    }

    if (areaRes) {
      const values: Record<string, number> = Object.fromEntries(DISTRICTS.filter((d) => d.match?.length).map((d) => [d.slug, 0]))
      const provinces: Record<string, number> = Object.fromEntries((provinceValues ?? []).map((p) => [p, 0]))
      let all = 0
      for (const g of areaRes) {
        all += g._count._all
        for (const slug of districtSlugsFor(g)) values[slug] += g._count._all
        for (const p of provinceValues ?? []) if (matchesProvince(g, p)) provinces[p] += g._count._all
      }
      out.area = { all, values }
      if (provinceValues?.length) out.province = { all, values: provinces }
    }

    if (attrRes && view) {
      type Bucket = { attributes: string | null; facetTokens: string | null; n: number; cols: Record<string, number> }
      const buckets: Bucket[] = attrRes.map((g) => {
        const c = g._count as unknown as Record<string, number>
        return { attributes: g.attributes, facetTokens: g.facetTokens, n: c._all ?? 0, cols: c }
      })
      const actives = activeAttrs.map((a) => ({ key: a.key, test: attrMatcher(a.key, a.value) }))
      // Does a bucket pass every active attribute filter — except `skipKey`'s own, for that facet's rail?
      const survives = (b: Bucket, skipKey: string | null) => actives.every((a) => a.key === skipKey || a.test(b))
      const attr: Record<string, DimensionCounts> = {}
      for (const f of view.facets) {
        const options = f.options.map((o) => ({ value: o.value, test: attrMatcher(f.key, o.value) }))
        const values: Record<string, number> = Object.fromEntries(options.map((o) => [o.value, 0]))
        let all = 0
        for (const b of buckets) {
          if (!survives(b, f.key)) continue
          all += b.n
          for (const o of options) if (o.test(b)) values[o.value] += b.n
        }
        attr[f.key] = { all, values }
      }
      const present: Record<string, number> = Object.fromEntries(view.rangeColumns.map((c) => [c, 0]))
      for (const b of buckets) {
        if (!survives(b, null)) continue
        for (const col of view.rangeColumns) present[col] += b.cols[col] ?? 0
      }
      out.attr = attr
      out.attrScope = view.scope
      out.rangePresent = present
    }

    const dealRows = dealRes ?? (typeAndDeal ? (typeRes as { marketPosition: string | null; _count: { _all: number } }[] | null) : null)
    if (dealRows) {
      let all = 0
      let good = 0
      for (const g of dealRows) {
        all += g._count._all
        // Mirrors the feed's `deal=good` clause exactly: `marketPosition: 'low'`.
        if (g.marketPosition === 'low') good += g._count._all
      }
      out.deal = { all, values: { good } }
    }

    /**
     * ⚠️ FROZEN BEFORE IT IS CACHED, BECAUSE THE MEMO HANDS OUT THE SAME OBJECT TO EVERY REQUEST
     * FOR 60 SECONDS. A hit returns `hit.data` by reference — not a copy — so one consumer doing
     * `facets.category.values[slug] = 0` to tidy a rail would not tidy its own response, it would
     * rewrite the cached answer for everyone until the TTL expires, which is a wrong number served
     * to strangers and no way to reproduce it. Freezing costs one pass over ~9 small objects and
     * turns that into an immediate TypeError at the mutating line (modules are strict mode). Deep
     * enough to matter: the nested `values` records are what a caller would reach for.
     */
    const freezeDim = (dim: DimensionCounts | undefined) => { if (dim) Object.freeze(Object.freeze(dim).values) }
    for (const [k, dim] of Object.entries(out)) {
      if (k === 'attr') for (const d of Object.values(dim as Record<string, DimensionCounts>)) freezeDim(d)
      if (k === 'attr' || k === 'rangePresent') Object.freeze(dim)
      else if (k !== 'attrScope') freezeDim(dim as DimensionCounts)
    }
    Object.freeze(out)
    if (facetCache.size >= FACET_CACHE_MAX) facetCache.delete(facetCache.keys().next().value!) // evict oldest (insertion order)
    facetCache.set(cacheKey, { at: Date.now(), data: out })
    return out
    }
  } catch (e) {
    if (e instanceof DeskResolutionError) throw e
    // Not cached: a transient failure must not pin "no counts" for a minute.
    console.error('[facet-counts]', e)
    return {}
  }
}
