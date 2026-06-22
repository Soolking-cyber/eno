import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { Prisma } from '@prisma/client'
import { SUBCATEGORIES } from '@/lib/subcategories'
import { fold, buildSearchText } from '@/lib/fold'
import { warmTranslations } from '@/lib/translate'
import { normalizePhone, containsPhoneNumber } from '@/lib/phone'
import { isListingImageUrl } from '@/lib/listing-image'
import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'

export const dynamic = 'force-dynamic'

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
      include: { category: true, seller: true },
    })
    const byId = new Map(rows.map((r) => [r.id, serializeListing(r)]))
    const listings = ids.map((id) => byId.get(id)).filter(Boolean)
    return NextResponse.json({ listings, total: listings.length })
  }

  const category = searchParams.get('category') || undefined // slug
  const subcategory = searchParams.get('subcategory') || undefined // slug
  const district = searchParams.get('district') || undefined
  const condition = searchParams.get('condition') || undefined
  const q = searchParams.get('q')?.trim() || undefined
  const sort = searchParams.get('sort') || 'newest'
  const verifiedParam = searchParams.get('verified') // 'true' | 'false' | 'all'
  const featuredOnly = searchParams.get('featured') === 'true'
  const limit = Math.min(parseInt(searchParams.get('limit') || '24', 10) || 24, 100)
  const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0)
  const priceMin = parseInt(searchParams.get('priceMin') || '', 10)
  const priceMax = parseInt(searchParams.get('priceMax') || '', 10)

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
  if (!Number.isNaN(priceMin) || !Number.isNaN(priceMax)) {
    const price: Prisma.FloatFilter = {}
    if (!Number.isNaN(priceMin)) price.gte = priceMin
    if (!Number.isNaN(priceMax)) price.lte = priceMax
    andFilters.push({ price })
  }
  if (category && category !== 'all') {
    andFilters.push({ category: { slug: category } })
  }
  if (condition && condition !== 'all') {
    if (condition === 'new') {
      andFilters.push({
        OR: [
          { condition: { contains: 'new' } },
          { condition: { contains: 'mới' } }
        ]
      })
    } else if (condition === 'used') {
      andFilters.push({
        NOT: {
          OR: [
            { condition: { contains: 'new' } },
            { condition: { contains: 'mới' } }
          ]
        }
      })
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
    andFilters.push({ searchText: { contains: fold(q) } })
  }

  if (subcategory && subcategory !== 'all' && category && category !== 'all') {
    const subcats = SUBCATEGORIES[category]
    const subcat = subcats?.find((s) => s.slug === subcategory)
    if (subcat) {
      const subcatKeywordOrs: Prisma.ListingWhereInput[] = subcat.keywords.flatMap((kw) => [
        { title: { contains: kw } },
        { titleVi: { contains: kw } },
        { description: { contains: kw } }
      ])

      if (category === 'house-rentals') {
        if (subcategory === 'studio') {
          andFilters.push({
            OR: [
              { attributes: { contains: '"bedrooms":0' } },
              { attributes: { contains: '"bedrooms": 0' } }
            ]
          })
        } else if (subcategory === '1br') {
          andFilters.push({
            OR: [
              { attributes: { contains: '"bedrooms":1' } },
              { attributes: { contains: '"bedrooms": 1' } }
            ]
          })
        } else if (subcategory === '2br') {
          andFilters.push({
            OR: [
              { attributes: { contains: '"bedrooms":2' } },
              { attributes: { contains: '"bedrooms": 2' } }
            ]
          })
        } else if (subcategory === '3br') {
          andFilters.push({
            OR: [
              { attributes: { contains: '"bedrooms":3' } },
              { attributes: { contains: '"bedrooms": 3' } },
              { attributes: { contains: '"bedrooms":4' } },
              { attributes: { contains: '"bedrooms": 4' } },
              { attributes: { contains: '"bedrooms":5' } },
              { attributes: { contains: '"bedrooms": 5' } },
              ...subcatKeywordOrs
            ]
          })
        } else {
          andFilters.push({ OR: subcatKeywordOrs })
        }
      } else {
        andFilters.push({ OR: subcatKeywordOrs })
      }
    }
  }
  
  // Custom category-specific attributes filtering (SQLite text contains queries)
  const attrKeys = Array.from(searchParams.keys()).filter((k) => k.startsWith('attr_'))
  for (const k of attrKeys) {
    const attrName = k.replace('attr_', '')
    const attrVal = searchParams.get(k)
    if (attrVal && attrVal !== 'all') {
      if (attrName === 'transmission') {
        if (attrVal === 'automatic') {
          andFilters.push({
            attributes: { contains: '"transmission":"Automatic"' }
          })
        } else if (attrVal === 'manual') {
          andFilters.push({
            OR: [
              { attributes: { contains: '"transmission":"Manual"' } },
              { attributes: { contains: '"transmission":"Manual 6-speed"' } }
            ]
          })
        }
      } else if (attrName === 'cc') {
        if (attrVal === '110-125') {
          andFilters.push({
            OR: [
              { attributes: { contains: '"cc":110' } },
              { attributes: { contains: '"cc": 110' } },
              { attributes: { contains: '"cc":125' } },
              { attributes: { contains: '"cc": 125' } }
            ]
          })
        } else if (attrVal === '150-up') {
          andFilters.push({
            OR: [
              { attributes: { contains: '"cc":150' } },
              { attributes: { contains: '"cc": 150' } },
              { attributes: { contains: '"cc":155' } },
              { attributes: { contains: '"cc": 155' } },
              { attributes: { contains: '"cc":160' } },
              { attributes: { contains: '"cc": 160' } }
            ]
          })
        }
      } else if (attrName === 'bedrooms') {
        const num = parseInt(attrVal, 10)
        if (!isNaN(num)) {
          andFilters.push({
            OR: [
              { attributes: { contains: `"bedrooms":${num}` } },
              { attributes: { contains: `"bedrooms": ${num}` } }
            ]
          })
        }
      } else if (attrName === 'furnishing') {
        if (attrVal === 'fully') {
          andFilters.push({
            OR: [
              { condition: { contains: 'Furnished' } },
              { attributes: { contains: '"condition":"Furnished"' } },
              { description: { contains: 'fully furnished' } }
            ]
          })
        } else if (attrVal === 'partly') {
          andFilters.push({
            OR: [
              { condition: { contains: 'Partly furnished' } },
              { attributes: { contains: '"condition":"Partly furnished"' } },
              { description: { contains: 'partly furnished' } }
            ]
          })
        }
      } else if (attrName === 'material') {
        if (attrVal === 'wood') {
          andFilters.push({
            OR: [
              { attributes: { contains: 'oak' } },
              { attributes: { contains: 'teak' } },
              { attributes: { contains: 'wood' } },
              { title: { contains: 'wooden' } },
              { titleVi: { contains: 'gỗ' } },
              { description: { contains: 'wood' } }
            ]
          })
        } else if (attrVal === 'fabric') {
          andFilters.push({
            OR: [
              { attributes: { contains: 'fabric' } },
              { attributes: { contains: 'cushion' } },
              { description: { contains: 'fabric' } }
            ]
          })
        }
      } else if (attrName === 'brand') {
        if (attrVal === 'apple') {
          andFilters.push({
            OR: [
              { title: { contains: 'MacBook' } },
              { title: { contains: 'iPhone' } },
              { title: { contains: 'iPad' } },
              { description: { contains: 'Apple' } }
            ]
          })
        } else if (attrVal === 'sony') {
          andFilters.push({
            OR: [
              { title: { contains: 'Sony' } },
              { description: { contains: 'Sony' } }
            ]
          })
        }
      } else if (attrName === 'warranty') {
        if (attrVal === 'yes') {
          andFilters.push({
            OR: [
              { attributes: { contains: 'warranty":"until' } },
              { description: { contains: 'warranty' } }
            ]
          })
          andFilters.push({
            NOT: {
              description: { contains: 'warranty: expired' }
            }
          })
        }
      } else if (attrName === 'english') {
        if (attrVal === 'required') {
          andFilters.push({
            OR: [
              { attributes: { contains: '"english":"Required"' } },
              { description: { contains: 'English-speaking' } },
              { description: { contains: 'English required' } }
            ]
          })
        }
      }
    }
  }

  const where: Prisma.ListingWhereInput = andFilters.length > 0 ? { AND: andFilters } : {}

  let orderBy: Prisma.ListingOrderByWithRelationInput | Prisma.ListingOrderByWithRelationInput[] = { postedAt: 'desc' }
  switch (sort) {
    case 'price-low':
      orderBy = { price: 'asc' }
      break
    case 'price-high':
      orderBy = { price: 'desc' }
      break
    case 'popular':
      orderBy = { views: 'desc' }
      break
    case 'verified-first':
      orderBy = [{ verified: 'desc' }, { postedAt: 'desc' }]
      break
    case 'newest':
    default:
      orderBy = { postedAt: 'desc' }
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
      include: { category: true, seller: true },
    }),
    db.listing.count({ where }),
    undefined
  ]

  if (category && category !== 'all') {
    const subcats = SUBCATEGORIES[category] || []
    promises[2] = Promise.all(
      subcats.map(async (sub) => {
        const subFilters: Prisma.ListingWhereInput[] = [
          { verified: verifiedFilter !== undefined ? verifiedFilter : true },
          { status: 'active' },
        ]

        subFilters.push({ category: { slug: category } })
        
        const distFilter = buildDistrictFilter(district || 'all')
        if (distFilter) {
          subFilters.push(distFilter)
        }

        const subcatKeywordOrs = sub.keywords.flatMap((kw) => [
          { title: { contains: kw } },
          { titleVi: { contains: kw } },
          { description: { contains: kw } }
        ])

        if (category === 'house-rentals') {
          if (sub.slug === 'studio') {
            subFilters.push({ OR: [{ attributes: { contains: '"bedrooms":0' } }, { attributes: { contains: '"bedrooms": 0' } }] })
          } else if (sub.slug === '1br') {
            subFilters.push({ OR: [{ attributes: { contains: '"bedrooms":1' } }, { attributes: { contains: '"bedrooms": 1' } }] })
          } else if (sub.slug === '2br') {
            subFilters.push({ OR: [{ attributes: { contains: '"bedrooms":2' } }, { attributes: { contains: '"bedrooms": 2' } }] })
          } else if (sub.slug === '3br') {
            subFilters.push({
              OR: [
                { attributes: { contains: '"bedrooms":3' } },
                { attributes: { contains: '"bedrooms": 3' } },
                { attributes: { contains: '"bedrooms":4' } },
                { attributes: { contains: '"bedrooms": 4' } },
                { attributes: { contains: '"bedrooms":5' } },
                { attributes: { contains: '"bedrooms": 5' } },
                ...subcatKeywordOrs
              ]
            })
          } else {
            subFilters.push({ OR: subcatKeywordOrs })
          }
        } else {
          subFilters.push({ OR: subcatKeywordOrs })
        }

        const count = await db.listing.count({ where: { AND: subFilters } })
        return { slug: sub.slug, count }
      })
    )
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

  return NextResponse.json(
    {
      listings: listings.map(serializeListing),
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

    // Reuse an existing seller on phone match WITHOUT renaming it (an unauthenticated
    // request must never overwrite another seller's identity). Name set on create only.
    const existing = await db.seller.findUnique({ where: { phone: contactPhone } })
    const seller = existing
      ? existing
      : await db.seller.create({
          data: {
            name: contactName || 'eno.vn seller',
            phone: contactPhone,
            verifiedSeller: false,
            rating: 0,
            reviewCount: 0,
            responseRate: 100,
          },
        })

    const images: string[] = Array.isArray(body.images)
      ? body.images.filter(isListingImageUrl).slice(0, 8)
      : []
    const district = body.district ? String(body.district).trim().slice(0, 80) : null

    // Automated publish gate (manual per-listing verification removed — no
    // manpower). Listings go LIVE instantly; the reactive control is the trust
    // score + reporting, not a human reviewing each one. We only HOLD a listing
    // when the account is Restricted (trust < 60) or it has no photo. Phone text
    // is already blocked above (`no_phone_in_listing`).
    const autoPublish = images.length >= 1 && seller.trustTier !== 'restricted'

    const listing = await db.listing.create({
      data: {
        title,
        description: String(body.description || '').trim().slice(0, 5000),
        price,
        priceUnit: 'VND',
        currency: '₫',
        negotiable: false,
        location: district || 'Ho Chi Minh City',
        district,
        city: 'Ho Chi Minh City',
        condition: body.condition ? String(body.condition).trim() : null,
        images: JSON.stringify(images),
        searchText: buildSearchText([title, String(body.description || ''), district, category.name, category.nameVi]),
        categoryId: category.id,
        sellerId: seller.id,
        verified: autoPublish,
      },
    })

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

    return NextResponse.json({ id: listing.id, verified: autoPublish }, { status: 201 })
  } catch (e) {
    console.error('[POST /api/listings]', e)
    return NextResponse.json({ error: 'Failed to create listing' }, { status: 500 })
  }
}
