import { NextRequest, NextResponse } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { db } from '@/lib/db'
import { serializeListingCard, LISTING_CARD_SELECT } from '@/lib/serialize'
import { Prisma } from '@/generated/prisma/client'
import { isRangeColumn } from '@/lib/taxonomy'
import { fold } from '@/lib/fold'
import { normalizePhone, containsPhoneNumber } from '@/lib/phone'
import { containsContactInfo, findBannedWord, PublishBlockedError } from '@/lib/publish-guard'
import { localizeListingTitles } from '@/lib/translate'
import { consolidateSellerHandle } from '@/lib/handle'
import { phoneTakenByOther } from '@/lib/phone-unique'
import { getCurrentProfileId } from '@/lib/admin'
import { postingGate } from '@/lib/enforcement'
import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'
import { rateLimit } from '@/lib/ratelimit'
import { vertexSearchListingIds, vertexConfigured } from '@/lib/vertex-search'
import { searchScore, relevanceFromPosition } from '@/lib/ranking'
import { createListingCore } from '@/lib/core/listings'

export const dynamic = 'force-dynamic'

// Subcategory facet counts are expensive (one multi-LIKE COUNT per subcategory)
// and change slowly. Memoize per filter-signature with a short TTL so the fan-out
// runs at most once per minute per (category, district, verified) on a warm
// instance, instead of on every cache miss.
const SUBCOUNT_TTL = 60_000
const subCountCache = new Map<string, { at: number; data: { slug: string; count: number }[] }>()

// Vertex ranked-ID cache (keyed by the exact Vertex args: q + category + price band).
// Pagination MUST use one ranked set across pages — re-querying Vertex per page can
// return a slightly different order (rows duplicated on one page, skipped on the next)
// AND spends the credit on every page. Cache the ranked list for 60s: a search session
// pages through a stable set at the cost of one Vertex call per (query, filter band).
const RANK_TTL = 60_000
const RANK_CACHE_MAX = 200
const rankCache = new Map<string, { at: number; ids: string[] }>()

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams

  // Fast path: fetch a specific set of PUBLIC listings by id (used by /saved).
  // Must match the public invariant everywhere else (verified + active) — without
  // status:'active' a saved listing the seller hid or sold would still leak its full
  // payload (title/price/images/coords) to anyone holding the id.
  const idsParam = searchParams.get('ids')
  if (idsParam) {
    const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200)
    if (ids.length === 0) return NextResponse.json({ listings: [], total: 0 })
    const rows = await db.listing.findMany({
      where: { id: { in: ids }, verified: true, status: 'active' },
      select: LISTING_CARD_SELECT,
    })
    const byId = new Map(rows.map((r) => [r.id, serializeListingCard(r)]))
    const listings = ids.map((id) => byId.get(id)).filter(Boolean)
    return NextResponse.json({ listings, total: listings.length })
  }

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

  // Every branch ends with { id: 'desc' } — a UNIQUE, monotonic tiebreaker. Without it,
  // rows tied on the sort key get no stable order across independent LIMIT/OFFSET queries,
  // so listings appear on two pages AND others are silently skipped as you paginate.
  // RANK = the BOUNDED trust⊕recency blend (rankScore, src/lib/ranking.ts) — trust is a
  // weighted edge, not a lexicographic override. It's the SOLE key on the default feed and
  // the tiebreaker on the explicit price/popular sorts (so a chosen price order is honored,
  // but ties favour trusted-and-fresh listings). Restricted sinks, Exceptional floats —
  // without burying a fresh, relevant listing under a higher-trust seller's whole catalog.
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

  // Semantic ranking: for a text query on the default sort, rank results via Vertex AI
  // Search (semantic + multilingual + typo-tolerant) — which draws the credit — instead
  // of literal keyword AND-match. We re-apply every STRUCTURAL filter on the DB side as
  // a safety net (dropping only the keyword tokens) and restore Vertex's relevance order.
  // Falls back to the keyword query already in `where` when Vertex is unconfigured, empty,
  // or slow — so this is a pure ranking upgrade with no regression risk.
  let semanticListings: any[] | null = null
  let semanticTotal = 0
  if (q && !looseMatch && !featuredOnly && sort === 'newest' && vertexConfigured()) {
    const minP = Number.isNaN(priceMin) ? null : priceMin
    const maxP = Number.isNaN(priceMax) ? null : priceMax
    const catArg = category && category !== 'all' ? category : null
    // Reuse one ranked set across pages: key on the exact Vertex args (structural
    // filters like district/condition aren't sent to Vertex — they're applied in the
    // DB below — so two pages differing only in those still share the ranked order).
    const rankKey = JSON.stringify({ q, catArg, minP, maxP })
    let ids: string[] | null = null
    const hit = rankCache.get(rankKey)
    if (hit && Date.now() - hit.at < RANK_TTL) {
      // Reuse the cached DECISION — a ranked id list, OR [] meaning "Vertex missed here".
      // Reusing the miss too is what stops the visible re-sort: once a query falls back to
      // keyword/rankScore order, a refetch within the window won't suddenly flip to a
      // (now-warm) Vertex ranking — and a cached hit likewise stays put. The order for a
      // given query is fixed for RANK_TTL instead of depending on Vertex warmth/timing.
      ids = hit.ids
    } else {
      ids = await Promise.race([
        vertexSearchListingIds(q, { categorySlug: catArg, minPriceVnd: minP, maxPriceVnd: maxP, take: 120 }).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)), // never hang a search on Vertex
      ])
      // Cache the decision EITHER WAY — a ranking or a miss ([]) — so it's stable for the window.
      if (rankCache.size >= RANK_CACHE_MAX) rankCache.delete(rankCache.keys().next().value!) // evict oldest (insertion order)
      rankCache.set(rankKey, { at: Date.now(), ids: ids && ids.length ? ids : [] })
    }
    if (ids && ids.length) {
      const structural = andFilters.filter((f) => f !== pgTextFilter)
      // Rank over 3 fields only — the old full-include here dragged ≤120 complete
      // rows (searchText, description, Seller) through Postgres to serve 24.
      const rows = await db.listing.findMany({
        where: { AND: [...structural, { id: { in: ids } }] },
        select: { id: true, sellerTrustScore: true, postedAt: true },
      })
      const byId = new Map(rows.map((r) => [r.id, r]))
      const vertexOrder = ids.map((id) => byId.get(id)).filter((r): r is (typeof rows)[number] => !!r)
      // Blend Vertex relevance with the bounded trust⊕recency edge (relevance-led 0.6/0.3/
      // 0.1). Vertex's clearly-best matches keep the top (steep position decay), but a
      // trusted, fresher seller outranks an equally-relevant standard one — so trust counts
      // in search too, not just browse. Re-rank the WHOLE ≤120 set, then page over it.
      const nowTs = Date.now()
      const ranked = vertexOrder
        .map((r, i) => ({ r, _s: searchScore({ relevance: relevanceFromPosition(i), sellerTrustScore: r.sellerTrustScore, postedAt: r.postedAt }, nowTs) }))
        .sort((a, b) => b._s - a._s)
        .map((x) => x.r)
      const rankedIds = ranked.map((r) => r.id)
      const R = ranked.length
      // True total: relevance-ranked set (top ≤120) + literal keyword matches NOT already
      // ranked. So deep pages of a popular query (>120 matches) keep loading instead of
      // capping at 120, and the displayed result count is honest. `total` always equals
      // the paginable count, so the client's load-more (listings.length < total) terminates.
      const tailWhere: Prisma.ListingWhereInput = { AND: [...andFilters, { id: { notIn: rankedIds } }] }
      const tailTotal = await db.listing.count({ where: tailWhere })
      semanticTotal = R + tailTotal
      // Fetch card rows for THIS page's ranked slice only, restoring rank order.
      const pageIds = ranked.slice(offset, offset + limit).map((r) => r.id)
      const pageRows = pageIds.length
        ? await db.listing.findMany({ where: { id: { in: pageIds } }, select: LISTING_CARD_SELECT })
        : []
      const pageById = new Map(pageRows.map((r) => [r.id, r]))
      const aPart = pageIds.map((id) => pageById.get(id)).filter((r): r is (typeof pageRows)[number] => !!r)
      if (aPart.length < limit && offset + limit > R && tailTotal > 0) {
        // This page reaches past the ranked set — fill the remainder from rankScore-ordered
        // results (the same blend), excluding the ids already shown in the ranked portion.
        const tailRows = await db.listing.findMany({
          where: tailWhere,
          orderBy,
          skip: Math.max(0, offset - R),
          take: limit - aPart.length,
          select: LISTING_CARD_SELECT,
        })
        semanticListings = [...aPart, ...tailRows]
      } else {
        semanticListings = aPart
      }
    }
  }

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
    // Key on the FULL facet base so a change to ANY active filter (not just
    // category/district) invalidates the cached counts.
    const cacheKey = JSON.stringify(facetBaseFilters)
    const cached = subCountCache.get(cacheKey)
    if (cached && Date.now() - cached.at < SUBCOUNT_TTL) {
      promises[2] = Promise.resolve(cached.data)
    } else {
      // One grouped query over the subcategorySlug column (taxonomy-aligned),
      // respecting every active filter except the subcategory selection itself.
      promises[2] = db.listing
        .groupBy({ by: ['subcategorySlug'], where: { AND: facetBaseFilters }, _count: { _all: true } })
        .then((grouped) => {
          const data = grouped
            .filter((g) => g.subcategorySlug)
            .map((g) => ({ slug: g.subcategorySlug as string, count: g._count._all }))
          subCountCache.set(cacheKey, { at: Date.now(), data })
          return data
        })
    }
  }

  const [listings, total, subCounts, categoryTotal] = await Promise.all([
    promises[0],
    promises[1],
    promises[2] || Promise.resolve([]),
    categoryTotalPromise,
  ])

  if (subCounts && subCounts.length > 0) {
    subCounts.forEach((c) => {
      subcategoryCounts[c.slug] = c.count
    })
  }

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
      listings: await localizeListingTitles(ordered.map(serializeListingCard), req.cookies.get('lang')?.value),
      total,
      offset,
      limit,
      subcategoryCounts,
      categoryTotal,
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

export async function POST(req: NextRequest) {
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
      return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 })
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
    if (!category) return NextResponse.json({ error: 'Unknown category' }, { status: 400 })

    // Resolve the storefront this listing belongs to. CRITICAL: a SIGNED-IN poster's
    // listing must attach to THEIR Profile-owned Seller (ownerId) — otherwise it
    // won't show in their dashboard and buyer messages (conversation.sellerProfileId
    // = seller.ownerId) never reach them. Guests still resolve/create by phone.
    const meId = await getCurrentProfileId()
    let seller
    if (meId) {
      const owned = await db.seller.findUnique({ where: { ownerId: meId } })
      if (owned) {
        seller = owned
        // Set OR update the contact phone on their storefront (the post wizard's inline
        // quick-edit) — but never one that already belongs to another account (any
        // format → normalized key).
        if (contactPhone && contactPhone !== owned.phone) {
          if (await phoneTakenByOther(contactPhone, meId)) return NextResponse.json({ error: 'phone_taken' }, { status: 409 })
          try {
            seller = await db.seller.update({ where: { id: owned.id }, data: { phone: contactPhone } })
          } catch {
            // Lost a race for the number (unique constraint) → surface it; never post
            // with the stale phone (which would also send the wrong CAPI/contact data).
            return NextResponse.json({ error: 'phone_taken' }, { status: 409 })
          }
        }
      } else {
        // A number identifies ONE account. If this one is already another account's
        // (their verified profile phone OR an owned storefront), reject — never
        // silently attach this listing to someone else's storefront.
        if (contactPhone && await phoneTakenByOther(contactPhone, meId)) {
          return NextResponse.json({ error: 'phone_taken' }, { status: 409 })
        }
        const byPhone = await db.seller.findUnique({ where: { phone: contactPhone } })
        if (byPhone && !byPhone.ownerId) {
          // Claim the unowned guest storefront for this account.
          seller = await db.seller.update({ where: { id: byPhone.id }, data: { ownerId: meId } })
        } else {
          seller = await db.seller.create({
            data: { name: contactName || 'eno.vn seller', phone: contactPhone, ownerId: meId, verifiedSeller: false, rating: 0, reviewCount: 0, responseRate: 100 },
          })
        }
      }
    } else {
      // Guest post (not signed in): a number already tied to a real account can't be
      // reused by an anonymous poster (impersonation / cross-account dupe).
      if (contactPhone && await phoneTakenByOther(contactPhone, null)) {
        return NextResponse.json({ error: 'phone_taken' }, { status: 409 })
      }
      const existing = await db.seller.findUnique({ where: { phone: contactPhone } })
      seller = existing
        ? existing
        : await db.seller.create({
            data: { name: contactName || 'eno.vn seller', phone: contactPhone, verifiedSeller: false, rating: 0, reviewCount: 0, responseRate: 100 },
          })
    }

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
