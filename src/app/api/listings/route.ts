import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { Prisma } from '@/generated/prisma/client'
import { suggestSubcategory, typesFor, subcategoriesFor, rangeFacetsFor, isRangeColumn } from '@/lib/taxonomy'
import { fold, buildSearchText } from '@/lib/fold'
import { warmTranslations } from '@/lib/translate'
import { syndicateListing } from '@/lib/syndicate'
import { normalizePhone, containsPhoneNumber } from '@/lib/phone'
import { phoneTakenByOther } from '@/lib/phone-unique'
import { categoryHasBrand, resolveBrand, bumpBrandCount } from '@/lib/brand'
import { isListingImageUrl } from '@/lib/listing-image'
import { getCurrentProfileId } from '@/lib/admin'
import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'

export const dynamic = 'force-dynamic'

// Subcategory facet counts are expensive (one multi-LIKE COUNT per subcategory)
// and change slowly. Memoize per filter-signature with a short TTL so the fan-out
// runs at most once per minute per (category, district, verified) on a warm
// instance, instead of on every cache miss.
const SUBCOUNT_TTL = 60_000
const subCountCache = new Map<string, { at: number; data: { slug: string; count: number }[] }>()

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams

  // Fast path: fetch a specific set of verified listings by id (used by /saved).
  // Returns exactly the requested rows, never leaking unverified ones.
  const idsParam = searchParams.get('ids')
  if (idsParam) {
    const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200)
    if (ids.length === 0) return NextResponse.json({ listings: [], total: 0 })
    const rows = await db.listing.findMany({
      where: { id: { in: ids }, verified: true },
      include: { category: true, seller: { include: { owner: { select: { accountType: true } } } } },
    })
    const byId = new Map(rows.map((r) => [r.id, serializeListing(r)]))
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
  if (q) {
    // Accent-insensitive + cross-language: match the folded query against the
    // pre-folded searchText blob (covers EN title + VI titleVi + desc + location).
    // AND each ≥2-char token so multi-word queries NARROW: "honda red" must match a
    // row containing both tokens (any order/field), not the literal substring.
    const qTokens = fold(q).split(/\s+/).filter((t) => t.length >= 2).slice(0, 6)
    andFilters.push(qTokens.length ? { AND: qTokens.map((t) => ({ searchText: { contains: t } })) } : { searchText: { contains: fold(q) } })
  }

  // Subcategory + intent (listingType) filter on dedicated columns now —
  // taxonomy-aligned, replacing the old per-category keyword heuristics.
  if (subcategory && subcategory !== 'all') {
    andFilters.push({ subcategorySlug: subcategory })
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

  const where: Prisma.ListingWhereInput = andFilters.length > 0 ? { AND: andFilters } : {}

  // Histogram mode: return just the matching prices (VND) for the active filters.
  // Capped so a huge catalog stays a small payload; the client buckets them.
  if (histogram) {
    const rows = await db.listing.findMany({ where, select: { price: true }, orderBy: { price: 'asc' }, take: 5000 })
    return NextResponse.json(
      { prices: rows.map((r) => r.price) },
      { headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=120' } },
    )
  }

  // Every branch ends with { id: 'desc' } — a UNIQUE, monotonic tiebreaker. Without
  // it, rows tied on the sort key (e.g. the many accounts at trustScore=100, or any
  // single-column sort) get no stable order across independent LIMIT/OFFSET queries,
  // so listings appear on two pages AND others are silently skipped as you paginate.
  // Seller trust is a ranking signal on EVERY sort — higher trust ranks above lower.
  // It's the primary factor on the default/relevance sorts and a tiebreaker on the
  // explicit price/popular sorts (so a chosen price order is still honored, but ties
  // and near-ties favour trusted sellers). Most accounts sit at 100, so among the
  // bulk the secondary key (recency/price) still decides; Exceptional float up,
  // Restricted sink.
  const TRUST: Prisma.ListingOrderByWithRelationInput = { seller: { trustScore: 'desc' } }
  let orderBy: Prisma.ListingOrderByWithRelationInput[]
  switch (sort) {
    case 'price-low':
      orderBy = [{ price: 'asc' }, TRUST, { id: 'desc' }]
      break
    case 'price-high':
      orderBy = [{ price: 'desc' }, TRUST, { id: 'desc' }]
      break
    case 'popular':
      orderBy = [{ views: 'desc' }, TRUST, { id: 'desc' }]
      break
    case 'verified-first':
      orderBy = [{ verified: 'desc' }, TRUST, { postedAt: 'desc' }, { id: 'desc' }]
      break
    case 'newest':
    default:
      // Default ("Recommended"): TRUST is the dominant signal — a higher-trust seller
      // outranks a lower-trust one even with nothing filtered, so a low-trust listing
      // never floats to the top of an unfiltered feed. featured + recency only break
      // ties among equal trust. (Most accounts sit at 100, so recency still decides
      // among the bulk; Exceptional float up, Restricted sink. Filters are a separate
      // WHERE clause — selecting a location/category still narrows, then this ranks.)
      orderBy = [TRUST, { featured: 'desc' }, { postedAt: 'desc' }, { id: 'desc' }]
  }

  // Parallel fetch: Listings, total count, and subcategory counts (if category is set)
  let subcategoryCounts: Record<string, number> = {}
  
  let categoryTotalPromise: Promise<number> = Promise.resolve(0)
  if (category && category !== 'all') {
    const allFilters: Prisma.ListingWhereInput[] = [
      { verified: verifiedFilter !== undefined ? verifiedFilter : true },
      { status: 'active' },
    ]
    allFilters.push({ category: { slug: category } })
    const distFilter = buildDistrictFilter(district || 'all')
    if (distFilter) {
      allFilters.push(distFilter)
    }
    categoryTotalPromise = db.listing.count({ where: { AND: allFilters } })
  }

  const promises: [
    Promise<any[]>,
    Promise<number>,
    Promise<{ slug: string; count: number }[]> | undefined
  ] = [
    db.listing.findMany({
      where,
      orderBy,
      take: limit,
      skip: offset,
      include: { category: true, seller: { include: { owner: { select: { accountType: true } } } } },
    }),
    db.listing.count({ where }),
    undefined
  ]

  if (category && category !== 'all') {
    const cacheKey = `${category}|${district || 'all'}|${verifiedFilter}`
    const cached = subCountCache.get(cacheKey)
    if (cached && Date.now() - cached.at < SUBCOUNT_TTL) {
      promises[2] = Promise.resolve(cached.data)
    } else {
      // One grouped query over the subcategorySlug column (taxonomy-aligned),
      // replacing the old per-subcategory keyword count fan-out.
      const subWhere: Prisma.ListingWhereInput[] = [
        { verified: verifiedFilter !== undefined ? verifiedFilter : true },
        { status: 'active' },
        { category: { slug: category } },
      ]
      const distFilter = buildDistrictFilter(district || 'all')
      if (distFilter) subWhere.push(distFilter)
      promises[2] = db.listing
        .groupBy({ by: ['subcategorySlug'], where: { AND: subWhere }, _count: { _all: true } })
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
      listings: ordered.map(serializeListing),
      total,
      offset,
      limit,
      subcategoryCounts,
      categoryTotal,
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=15, stale-while-revalidate=45',
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

    // Keep contact info OFF the public listing — buyers reach sellers in-app, so
    // sellers must log in to reply (and refresh availability). Reject any phone
    // number embedded in the public text fields (the seller's real number lives
    // in contactPhone, revealed only in-chat after they reply).
    if (containsPhoneNumber(title) || containsPhoneNumber(String(body.description || '')) || containsPhoneNumber(contactName)) {
      return NextResponse.json({ error: 'no_phone_in_listing' }, { status: 400 })
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
        // Backfill a missing contact phone on their storefront — but never one that
        // already belongs to another account (any format → normalized key).
        if (!owned.phone && contactPhone) {
          if (await phoneTakenByOther(contactPhone, meId)) return NextResponse.json({ error: 'phone_taken' }, { status: 409 })
          try { seller = await db.seller.update({ where: { id: owned.id }, data: { phone: contactPhone } }) } catch { /* phone taken elsewhere */ }
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

    const images: string[] = Array.isArray(body.images)
      ? body.images.filter(isListingImageUrl).slice(0, 8)
      : []
    const district = body.district ? String(body.district).trim().slice(0, 80) : null
    const city = body.city ? String(body.city).trim().slice(0, 80) : 'Ho Chi Minh City'
    const location = body.location ? String(body.location).trim().slice(0, 120) : (district || city)
    // Optional precise pin from "use my current location" (validated to plausible ranges).
    const latNum = Number(body.lat), lngNum = Number(body.lng)
    const lat = Number.isFinite(latNum) && latNum >= -90 && latNum <= 90 ? latNum : null
    const lng = Number.isFinite(lngNum) && lngNum >= -180 && lngNum <= 180 ? lngNum : null

    // Automated publish gate (manual per-listing verification removed — no
    // manpower). Listings go LIVE instantly; the reactive control is the trust
    // score + reporting, not a human reviewing each one. We only HOLD a listing
    // when the account is Restricted (trust < 60) or it has no photo. Phone text
    // is already blocked above (`no_phone_in_listing`).
    const autoPublish = images.length >= 1 && seller.trustTier !== 'restricted'

    // Intent + subcategory from the taxonomy. listingType must be valid for the
    // category (else its primary type); subcategory falls back to keyword-suggest.
    const allowedTypes = typesFor(categorySlug) as string[]
    const reqType = String(body.listingType || '').trim()
    const listingType = allowedTypes.includes(reqType) ? reqType : allowedTypes[0]
    const subs = subcategoriesFor(categorySlug)
    let subcategorySlug: string | null = String(body.subcategorySlug || '').trim()
    if (!subs.some((s) => s.slug === subcategorySlug)) {
      subcategorySlug = suggestSubcategory(categorySlug, `${title} ${body.description || ''}`) || (subs[0]?.slug ?? null)
    }
    // Price unit follows the intent (monthly for rent/job, per-service for service).
    const priceUnit = listingType === 'rent' || listingType === 'job' ? 'VND/month'
      : listingType === 'service' ? 'VND/service (from)' : 'VND'
    // Whitelisted, stringly-typed attribute facets (taxonomy values).
    let attributes: string | null = null
    if (body.attributes && typeof body.attributes === 'object' && !Array.isArray(body.attributes)) {
      const clean: Record<string, string> = {}
      for (const [k, v] of Object.entries(body.attributes as Record<string, unknown>)) {
        if (typeof v === 'string' && v && /^[a-z0-9_]+$/i.test(k)) clean[k] = v.slice(0, 40)
      }
      if (Object.keys(clean).length) attributes = JSON.stringify(clean)
    }

    // Structured numeric specs (range facets) → dedicated columns, each clamped to
    // the category's declared range so out-of-range/garbage can't be stored. Engine
    // keeps one decimal (litres); year/mileage are integers.
    const rangeData: Record<string, number> = {}
    for (const f of rangeFacetsFor(categorySlug, subcategorySlug)) {
      const raw = Number((body as Record<string, unknown>)[f.range.column])
      if (!Number.isFinite(raw)) continue
      const clamped = Math.min(Math.max(raw, f.range.min), f.range.max)
      rangeData[f.range.column] = f.range.column === 'engineL' ? Math.round(clamped * 10) / 10 : Math.round(clamped)
    }

    // Brand (product categories only): canonicalize + typo-dedupe into the catalogue,
    // growing it on first sight. Never blocks the post if resolution fails.
    let brandSlug: string | null = null
    if (categoryHasBrand(categorySlug) && body.brand) {
      try { brandSlug = await resolveBrand(String(body.brand)) } catch { brandSlug = null }
    }
    // Specific model — only kept alongside a resolved brand (powers the brand rail's
    // model expansion). Free display string; grouped distinct in the catalogue.
    const model = brandSlug && body.model ? (String(body.model).trim().slice(0, 60) || null) : null

    const listing = await db.listing.create({
      data: {
        title,
        description: String(body.description || '').trim().slice(0, 5000),
        price,
        priceUnit,
        currency: '₫',
        negotiable: Boolean(body.negotiable),
        location,
        district,
        city,
        lat,
        lng,
        condition: body.condition ? String(body.condition).trim() : null,
        images: JSON.stringify(images),
        searchText: buildSearchText([title, String(body.description || ''), district, category.name, category.nameVi, brandSlug, model]),
        categoryId: category.id,
        subcategorySlug,
        listingType,
        attributes,
        ...rangeData,
        brandSlug,
        model,
        sellerId: seller.id,
        verified: autoPublish,
      },
    })
    if (brandSlug) after(() => bumpBrandCount(brandSlug!))

    // Pre-translate every user-authored text field into ALL supported languages
    // so the listing renders from cache (no provider round-trip) in any
    // visitor's language. Runs after the response flushes — never delays the post.
    const attrValues: string[] = (() => {
      try {
        const a = listing.attributes ? JSON.parse(listing.attributes) : {}
        return Object.values(a).map((v) => String(v))
      } catch { return [] }
    })()
    const warmFields = [listing.title, listing.description, listing.location, ...attrValues].filter(Boolean)
    after(() => warmTranslations(warmFields))

    // Auto cross-post to the platform's social channels — only when the listing is
    // actually live (not held/restricted). Best-effort, after the response flushes.
    if (autoPublish) {
      after(() => syndicateListing({
        id: listing.id,
        title: listing.title,
        price: listing.price,
        currency: listing.currency,
        location: listing.location,
        district: listing.district,
        image: images[0] || null,
        categoryName: category.name,
      }))
    }

    return NextResponse.json({ id: listing.id, verified: autoPublish }, { status: 201 })
  } catch (e) {
    console.error('[POST /api/listings]', e)
    return NextResponse.json({ error: 'Failed to create listing' }, { status: 500 })
  }
}
