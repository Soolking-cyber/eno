import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { NextResponse } from 'next/server'
import { FEED_CATEGORIES, GOOGLE_PRODUCT_CATEGORY, isMockImages, feedAuthError, feedCacheHeaders } from '@/lib/product-feed'

// Meta/Facebook commerce catalog feed (Commerce Manager CSV format). Powers the
// Facebook/Instagram Shop + Advantage+ catalog (DPA) ads — each item links back to
// its eno.vn listing (off-site checkout). PHYSICAL PRODUCTS only (sell intent, retail
// categories); rentals/jobs/services/events/property go in their own vertical feeds.

// RFC-4180 CSV escaping. A field with a comma/quote/newline is wrapped in quotes
// (also lets additional_image_link carry a comma-separated URL list in one cell).
function escapeCsv(val: string): string {
  const clean = val.replace(/\r?\n|\r/g, ' ').trim()
  if (clean.includes('"') || clean.includes(',') || clean.includes(';')) {
    return `"${clean.replace(/"/g, '""')}"`
  }
  return clean
}

export async function GET(req: Request) {
  // Block anonymous scrapers once FEED_USER/FEED_PASSWORD are set (Meta sends them via
  // the catalog's "login details"). Open until configured, so import never breaks.
  const authError = feedAuthError(req)
  if (authError) return authError

  try {
    // Exclude seeded mock listings from a live (ad-spending) feed: append ?exclude_mock=1
    // to the feed URL, or set CATALOG_EXCLUDE_MOCK=true. Default OFF so the first import works.
    const excludeMock =
      new URL(req.url).searchParams.get('exclude_mock') === '1' ||
      process.env.CATALOG_EXCLUDE_MOCK === 'true'

    const listings = await db.listing.findMany({
      // Only items actually FOR SALE, in product categories — everything else isn't
      // catalog-eligible and would flag the feed.
      where: {
        verified: true,
        status: 'active',
        listingType: 'sell',
        category: { slug: { in: FEED_CATEGORIES } },
      },
      include: { category: true, seller: true },
      orderBy: { postedAt: 'desc' },
    })

    // Resolve real brand names (one query) — a real brand beats the marketplace
    // fallback for catalog matching + dynamic-ad relevance.
    const brandSlugs = Array.from(new Set(listings.map((l) => l.brandSlug).filter(Boolean))) as string[]
    const brandRows = brandSlugs.length
      ? await db.brand.findMany({ where: { slug: { in: brandSlugs } }, select: { slug: true, name: true } })
      : []
    const brandName = new Map(brandRows.map((b) => [b.slug, b.name]))

    const hostUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'

    const headers = [
      'id', 'title', 'description', 'availability', 'condition', 'price', 'link',
      'image_link', 'brand', 'google_product_category', 'product_type', 'additional_image_link',
    ]
    let csv = headers.join(',') + '\n'

    for (const l of listings) {
      const listing = serializeListing(l)
      if (excludeMock && isMockImages(listing.images)) continue

      // Lead the title with the real brand for stronger matching (avoid duplication).
      const baseTitle = listing.titleVi || listing.title
      const bName = l.brandSlug ? brandName.get(l.brandSlug) ?? null : null
      const title = bName && !baseTitle.toLowerCase().includes(bName.toLowerCase())
        ? `${bName} ${baseTitle}`
        : baseTitle

      // UTM-tag the link so catalog/Shop clicks attribute to Meta in our first-touch CAC.
      const itemUrl = `${hostUrl}/listings/${listing.id}?utm_source=facebook&utm_medium=catalog`
      const imageUrl = listing.images[0] || `${hostUrl}/placeholder.png`
      const additionalImages = listing.images.slice(1, 11).join(',') // comma-list in one cell

      // Condition → Meta's allowed values (new | used | refurbished).
      const c = listing.condition?.toLowerCase() || ''
      const condition = listing.condition === 'new' || c.includes('mới') ? 'new'
        : c.includes('refurb') ? 'refurbished' : 'used'

      const currencyCode = listing.currency === '₫' ? 'VND' : 'USD'
      const formattedPrice = `${listing.price} ${currencyCode}` // Meta: "5000000 VND"
      const gpc = GOOGLE_PRODUCT_CATEGORY[l.category.slug] || ''

      const row = [
        escapeCsv(listing.id),
        escapeCsv(title.slice(0, 150)),
        escapeCsv(listing.description.slice(0, 400)),
        'in stock',
        condition,
        escapeCsv(formattedPrice),
        escapeCsv(itemUrl),
        escapeCsv(imageUrl),
        escapeCsv(bName || 'eno.vn'),
        escapeCsv(gpc),
        escapeCsv(listing.category.name),
        escapeCsv(additionalImages),
      ]

      csv += row.join(',') + '\n'
    }

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename=facebook_catalog.csv',
        ...feedCacheHeaders(),
      },
    })
  } catch (error) {
    console.error('Failed to generate Facebook Catalog feed:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
