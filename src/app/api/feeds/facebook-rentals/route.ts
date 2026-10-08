import { scopedListingWhere } from '@/lib/edition-scope'
import { db } from '@/lib/db'
import { RENTAL_FEED_SELECT, serializeRentalFeedListing } from '@/lib/serialize'
import { NextResponse } from 'next/server'
import { feedAuthError, feedCacheHeaders } from '@/lib/product-feed'
import { RENTAL_FEED_HEADERS, rentalFeedRow } from '@/lib/rentals-feed'

// Meta catalogue feed for APARTMENT RENTALS (products CSV) — the "Products" row under the rentals video
// ad (owner, 2026-10-07). Its own catalogue, fetched hourly as a full replace; the rules for each row
// live in src/lib/rentals-feed.ts. The goods feed (facebook-catalog) stays physical products only.
//
// ⚠️ NOT ON THE API WRAPPER, for the reasons written out on facebook-catalog/route.ts: Basic-auth or
// `?key=` checked by `feedAuthError` ahead of everything, a text/csv body with its own cache headers,
// and a prose 500.
export async function GET(req: Request) {
  const authError = feedAuthError(req)
  if (authError) return authError

  try {
    const listings = await db.listing.findMany({
      /**
       * ⛔ THE LISTING PAGE'S OWN RULE FOR A 200: verified and active (get-listing.ts,
       * `listingIsViewable` — sold is viewable but not advertisable). Anything looser sends paid
       * clicks to a 404; anything stricter delists flats that are on the site.
       * ⛔ NEVER `feedCategories()` / `feedListingTypes()`: they are the goods feeds' guards, and rentals
       * are deliberately outside them (rentals-feed.ts says why).
       * No try/catch around `scopedListingWhere`: a DeskResolutionError must 500, never emit an
       * unscoped feed.
       */
      where: await scopedListingWhere({
        verified: true,
        status: 'active',
        listingType: 'rent',
        category: { slug: 'rentals' },
        subcategorySlug: 'apartment-rental',
      }),
      // ⚠️ No `take`: a full-replace feed DELISTS every row it omits (LISTING_FEED_SELECT's note).
      select: RENTAL_FEED_SELECT,
      orderBy: { postedAt: 'desc' },
    })

    const host = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'
    let csv = RENTAL_FEED_HEADERS.join(',') + '\n'
    // Counted, not silent, and logged with its denominator — the goods route's note on X-Feed-Excluded.
    const excluded: Record<string, number> = {}
    for (const l of listings) {
      const r = rentalFeedRow(serializeRentalFeedListing(l), host)
      if ('excluded' in r) { excluded[r.excluded] = (excluded[r.excluded] ?? 0) + 1; continue }
      csv += r.row.join(',') + '\n'
    }
    if (Object.keys(excluded).length) console.info('facebook-rentals: withheld %o of %d eligible rows', excluded, listings.length)

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename=facebook_rentals.csv',
        'X-Feed-Excluded': JSON.stringify(excluded),
        ...feedCacheHeaders(),
      },
    })
  } catch (error) {
    console.error('Failed to generate Facebook rentals feed:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
