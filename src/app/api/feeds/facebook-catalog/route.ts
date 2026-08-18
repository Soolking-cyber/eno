import { scopedListingWhere } from '@/lib/edition-scope'
import { db } from '@/lib/db'
import { LISTING_FEED_SELECT, serializeFeedListing } from '@/lib/serialize'
import { NextResponse } from 'next/server'
import { feedCategories, feedListingTypes, GOOGLE_PRODUCT_CATEGORY, isMockImages, feedAuthError, feedCacheHeaders } from '@/lib/product-feed'

// Meta/Facebook commerce catalog feed (Commerce Manager CSV format). Powers the
// Facebook/Instagram Shop + Advantage+ catalog (DPA) ads — each item links back to
// its eno.vn listing (off-site checkout). PHYSICAL PRODUCTS only (sell intent, retail
// categories); rentals/jobs/services/events/property go in their own vertical feeds.

// RFC-4180 CSV escaping. A field with a comma/quote/newline is wrapped in quotes
// (also lets additional_image_link carry a comma-separated URL list in one cell).
function escapeCsv(val: string): string {
  let clean = val.replace(/\r?\n|\r/g, ' ').trim()
  // CSV formula-injection guard: neutralize a leading =, +, - or @ so a listing title
  // can't execute as a formula when the feed is opened in a spreadsheet.
  if (/^[=+\-@]/.test(clean)) clean = `'${clean}`
  if (clean.includes('"') || clean.includes(',') || clean.includes(';')) {
    return `"${clean.replace(/"/g, '""')}"`
  }
  return clean
}

// ⚠️ WS6 — NOT MIGRATED. This is a protocol endpoint for Meta's fetcher, not a first-party JSON
// API, and nothing about it fits the wrapper (WS6 audit, 2026-08-06):
//   · THE AUTH IS HTTP BASIC AND IT RESOLVES THE CALLER ITSELF. `feedAuthError()` answers a PROSE
//     401 — the body is the literal text `Unauthorized`, not JSON — with `WWW-Authenticate: Basic
//     realm="eno-feeds"`, `Cache-Control: no-store` and `Vary: Authorization`. That challenge
//     header is what makes a scheduled fetch able to authenticate at all. `auth:` knows only
//     Supabase sessions and `apiFail()` writes `{"error":"auth_required"}` with no headers, so
//     `auth` must stay `'public'` and the check must stay where it is, ahead of everything.
//   · IT IS OFF BY DEFAULT. With FEED_USER/FEED_PASSWORD unset the feed is deliberately OPEN so the
//     platforms' first import cannot break — a guest gets 200 and a catalog. Any authed mode 401s
//     that caller.
//   · THE SUCCESS BODY IS text/csv WITH HEADERS: `Content-Type`, a `Content-Disposition` filename,
//     and `feedCacheHeaders()` (`no-store` + `Vary: Authorization`) whose whole purpose is stopping
//     a shared CDN serving an authed copy to an anonymous request. A plain-object return carries
//     none of them.
//   · THE 500 IS NOT AN ApiErrorCode. The catch emits `{"error":"Internal Server Error"}` — prose
//     with spaces and capitals — where the wrapper's unhandled path emits
//     `{"error":"internal_error"}`.
// With auth, rate limit and body all necessarily empty, the wrapper would buy nothing here even if
// the headers could be carried by returning a Response.
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
      // ⚠️ DEFENCE IN DEPTH. This feed is clean TODAY only by accident of taxonomy — FEED_CATEGORIES
      // omits 'services' and the desk's rows are listingType 'service'. Re-categorise ONE product
      // and eno's e-Visa service enters the licensed company's live Merchant Center / Meta ad
      // catalog. The accident becomes a guarantee here.
      //
      // No try/catch around this: a DeskResolutionError must 500 rather than emit an unfiltered
      // feed, because a bad feed is a licensing breach that nobody notices.
      where: await scopedListingWhere({
        verified: true,
        status: 'active',
        listingType: { in: feedListingTypes() },
        category: { slug: { in: feedCategories() } },
      }),
      /**
       * ⚠️ `select`, NOT `include`, AND AN EXPLICIT `take`. This was
       * `include: { category: true, seller: true }` with no limit, on a URL Google Merchant and Meta
       * fetch UNATTENDED. The include joined every Seller scalar — phone and email — into a feed
       * that reads NOT ONE field from it; before this change the only occurrence of that relation in
       * the whole file WAS the include. PII was loaded, held in memory and discarded.
       *
       * ⚠️ STILL NO `take`, DELIBERATELY. Bounding this query was tried and reverted — see the note
       * on LISTING_FEED_SELECT in src/lib/serialize.ts. Truncating an authoritative catalog feed
       * DELISTS the omitted items from Google Shopping and Meta, which is worse than the unbounded
       * read it was meant to fix. Streaming is the real answer and is not done yet.
       */
      select: LISTING_FEED_SELECT,
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
      const listing = serializeFeedListing(l)
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
