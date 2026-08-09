import { DeskResolutionError, scopedListingWhere } from '@/lib/edition-scope'
import type { Metadata } from 'next'
import { db } from '@/lib/db'
import { serializeListingCard, LISTING_CARD_SELECT } from '@/lib/serialize'
import { localizeListingTitles } from '@/lib/translate'
import { getCategoriesByDemand } from '@/lib/categories'
import { topBusinessListings } from '@/lib/core/business-rail'
import { trendingRailListings } from '@/lib/core/trending-rail'
import type { SerializedCategory, SerializedListingCard } from '@/lib/types'
import { ListingsExplorer } from '@/components/marketplace/listings-explorer'

// ISR: near-static homepage data, refreshed at most once a minute (better LCP/TTFB).
export const revalidate = 21600 // 6h — the client explorer fetches live listings via /api/listings, so the ISR HTML is just first-paint+SEO. Home is a HOT page that regenerates per edge region, so a 6h window (vs 1h) cuts ISR writes ~6× with zero UX/speed change

// Self-canonical so Google attributes ranking signals to the no-redirect www host.
export const metadata: Metadata = { alternates: { canonical: '/' } }

async function getData(): Promise<{ categories: SerializedCategory[]; listings: SerializedListingCard[]; total: number; businesses: Awaited<ReturnType<typeof topBusinessListings>>; trending: Awaited<ReturnType<typeof trendingRailListings>> }> {
  try {
    // verified:true AND status:'active' matches the /api/listings response (GET
    // forces verified+active-only), so this SSR data can seed React Query's
    // default-view cache exactly — and never leaks sold/hidden items on first paint.
    const [serializedCategories, listings, total, businesses, trending] = await Promise.all([
      // Categories ordered by live DEMAND — most-wanted lead the rail + home grid.
      getCategoriesByDemand(),
      db.listing.findMany({
        // ⚠️ EDITION-SCOPED. eno.vn is a licensed sàn TMĐT; the e-visa SKUs are ordinary Listing
        // rows and they rank into this feed. This is the ISR-baked HTML of the root URL, served
        // from disk to every anonymous visitor and every crawler — the most-seen leak there was.
        where: await scopedListingWhere({ verified: true, status: 'active' }),
        // Match /api/listings' default sort EXACTLY (the balanced rankScore blend, id
        // tiebreaker) so this SSR seed doesn't reshuffle on hydration into the client feed.
        orderBy: [{ rankScore: 'desc' }, { id: 'desc' }],
        // First page of the infinite home feed; it paginates 12 at a time on scroll.
        // Smaller first page = fewer cards hydrating on first paint (main-thread win).
        take: 12,
        select: LISTING_CARD_SELECT,
      }),
      // MUST match the findMany predicate exactly: this seeds the client explorer's `initialTotal`,
      // which terminates its load-more (`listings.length < total`). A count that disagrees with the
      // cards either stops the infinite feed 14 items early or never lets it finish.
      db.listing.count({ where: await scopedListingWhere({ verified: true, status: 'active' }) }),
      // Outstanding-businesses rail, server-known (perf Phase 1): the rail's
      // presence/geometry is decided at first paint — the client fetch's
      // skeleton→empty collapse was the homepage's dominant CLS (0.142).
      topBusinessListings().catch(() => []),
      // "Trending now" seed for the ForYouRail — same server-known-geometry fix
      // (the client's empty thin-catalog answer collapsed the SSR'd skeletons).
      trendingRailListings().catch(() => []),
    ])

    const serializedListings: SerializedListingCard[] = await localizeListingTitles(listings.map(serializeListingCard))

    return { categories: serializedCategories, listings: serializedListings, total, businesses, trending }
  } catch (e) {
    /**
     * ⚠️ A DESK-RESOLUTION FAILURE MUST NOT BE SWALLOWED HERE. This catch exists so a transient
     * database blip renders an empty home page rather than a 500 — sensible for a marketplace. But
     * `scopedListingWhere` throws DeskResolutionError precisely when it CANNOT prove which sellers
     * to exclude, and swallowing that would prerender an empty page into a 6-hour ISR window while
     * hiding the one error an operator needs to see. Re-thrown so it surfaces.
     */
    if (e instanceof DeskResolutionError) throw e
    // DB unreachable at build → prerender empty and let ISR (revalidate) fill it
    // on the first request, so a transient build-time DB error never fails the deploy.
    return { categories: [], listings: [], total: 0, businesses: [], trending: [] }
  }
}

export default async function Home() {
  const { categories, listings, total, businesses, trending } = await getData()

  // Chrome (the wrapper, <Header/>, <main> and <Footer/>) lives in ./layout.tsx so it renders
  // OUTSIDE this route's Suspense boundary and is not duplicated into loading.tsx's fallback.
  return (
    <ListingsExplorer
      categories={categories}
      initialListings={listings}
      initialTotal={total}
      // Baked at ISR regeneration time — tells the client explorer the seed's TRUE age
      // so a 6h-old snapshot revalidates in the background instead of posing as fresh.
      initialFetchedAt={Date.now()}
      initialBusinesses={businesses}
      initialTrending={trending}
    />
  )
}
