// GET /api/listings query machinery: the ids fast-path, filter/where building from
// search params, the orderBy branches, and the subcategory facet-count cache.
// Extracted verbatim from route.ts — the route keeps the exported handlers only.
import { marketplaceListingScope, scopedListingWhere } from '@/lib/edition-scope'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { serializeListingCard, LISTING_CARD_SELECT } from '@/lib/serialize'
import { Prisma } from '@/generated/prisma/client'
import { isRangeColumn } from '@/lib/taxonomy'
import { fold } from '@/lib/fold'
import { localizeListingTitles } from '@/lib/translate'
import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'

// Subcategory facet counts are expensive (one multi-LIKE COUNT per subcategory)
// and change slowly. Memoize per filter-signature with a short TTL so the fan-out
// runs at most once per minute per (category, district, verified) on a warm
// instance, instead of on every cache miss.
const SUBCOUNT_TTL = 60_000
const SUBCOUNT_CACHE_MAX = 500
const subCountCache = new Map<string, { at: number; data: { slug: string; count: number }[] }>()

// Fast path: fetch a specific set of PUBLIC listings by id (used by /saved).
// Must match the public invariant everywhere else (verified + active) — without
// status:'active' a saved listing the seller hid or sold would still leak its full
// payload (title/price/images/coords) to anyone holding the id.
export async function idsFastPath(searchParams: URLSearchParams): Promise<NextResponse | null> {
  const idsParam = searchParams.get('ids')
  if (!idsParam) return null
  const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200)
  if (ids.length === 0) return NextResponse.json({ listings: [], total: 0 })
  const rows = await db.listing.findMany({
    where: await scopedListingWhere({ id: { in: ids }, verified: true, status: 'active' }),
    select: LISTING_CARD_SELECT,
  })
  const byId = new Map(rows.map((r) => [r.id, serializeListingCard(r)]))
  const listings = ids.map((id) => byId.get(id)).filter((l): l is NonNullable<typeof l> => !!l)
  return NextResponse.json({
    listings: await localizeListingTitles(listings, searchParams.get('lang') || undefined),
    total: listings.length,
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
  if (condition && condition !== 'all') {
    // Case-INSENSITIVE: stored condition values are inconsistently cased
    // (new/New/Like new/used/Used/Good…). "new" matches anything new-ish; "used"
    // is everything else that has a condition set (exclude the null/unset rows so a
    // non-physical/blank item isn't wrongly counted as used).
    const NEWISH = { OR: [{ condition: { contains: 'new', mode: 'insensitive' as const } }, { condition: { contains: 'mới', mode: 'insensitive' as const } }] }
    if (condition === 'new') {
      andFilters.push(NEWISH)
    } else if (condition === 'used') {
      andFilters.push({ AND: [{ condition: { not: null } }, { NOT: NEWISH }] })
    }
  }
  // Generic district filter driven by DISTRICTS[].match (EN + VI variants), matched
  // against both the `district` and `location` fields.
  const buildDistrictFilter = (districtVal: string): Prisma.ListingWhereInput | undefined => {
    if (!districtVal || districtVal === 'all') return undefined
    const def = DISTRICTS.find((d) => d.slug === districtVal)
    if (!def?.match?.length) return undefined
    const OR: Prisma.ListingWhereInput[] = []
    for (const m of def.match) {
      OR.push({ district: { contains: m } }, { location: { contains: m } })
    }
    return { OR }
  }

  const districtFilter = buildDistrictFilter(district || 'all')
  if (districtFilter) {
    andFilters.push(districtFilter)
  }

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
    andFilters.push({ model })
  }
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
      andFilters.push({ attributes: { contains: `"${attrName}":"${attrVal}"` } })
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
