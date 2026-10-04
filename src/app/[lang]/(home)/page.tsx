import { DeskResolutionError, scopedListingWhere } from '@/lib/edition-scope'
import { HOME_FEED_SEATS } from '@/lib/feed-diversity'
import { diverseFeedHead } from '@/lib/feed-window'
import type { Metadata } from 'next'
import { db } from '@/lib/db'
import { serializeListingCard, LISTING_CARD_SELECT } from '@/lib/serialize'
import { localizeListingTitles } from '@/lib/translate'
import { getCategoriesByDemand } from '@/lib/categories'
import { topBusinessListings } from '@/lib/core/business-rail'
import { trendingRailListings } from '@/lib/core/trending-rail'
import type { SerializedCategory, SerializedListingCard } from '@/lib/types'
import { ListingsExplorer } from '@/components/marketplace/listings-explorer'
import { homeMetadata } from './home-metadata'

// ISR: near-static homepage data, refreshed at most once a minute (better LCP/TTFB).
export const revalidate = 21600 // 6h — the client explorer fetches live listings via /api/listings, so the ISR HTML is just first-paint+SEO. Home is a HOT page that regenerates per edge region, so a 6h window (vs 1h) cuts ISR writes ~6× with zero UX/speed change

// Self-canonical, plus the Vietnamese title and description on the marketplace's `vi` variant (SEO wave
// B, V2) — home-metadata.ts has the rules.
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params
  return homeMetadata(lang)
}

async function getData(): Promise<{ categories: SerializedCategory[]; listings: SerializedListingCard[]; total: number; businesses: Awaited<ReturnType<typeof topBusinessListings>>; trending: Awaited<ReturnType<typeof trendingRailListings>> }> {
  try {
    // verified:true AND status:'active' matches the /api/listings response (GET
    // forces verified+active-only), so this SSR data can seed React Query's
    // default-view cache exactly — and never leaks sold/hidden items on first paint.
    /**
     * ⛔ THE SCOPE IS RESOLVED BEFORE THE ARRAY, NOT INSIDE IT. It used to be `await
     * scopedListingWhere(...)` written as an ARGUMENT to two of the entries below — and an array
     * literal evaluates left to right, so that await suspended CONSTRUCTION of the array. The count,
     * the businesses rail and the trending rail were not merely awaited later, they had not been
     * STARTED: `Promise.all` cannot run what does not exist yet. Only `getCategoriesByDemand()`
     * overlapped it. Hoisting it means all five actually begin together, which is what this
     * `Promise.all` was always meant to say.
     *
     * ⚠️ The cost was bounded because `scopedListingWhere`'s seller lookups are `cache()`d, so this
     * was one desk-seller round trip rather than four — but it sat in front of the home page's
     * entire server render, which is the one place a round trip is least affordable.
     */
    /**
     * ⚠️ AND THE ONE QUERY THAT DOES NOT NEED THE SCOPE IS STARTED BEFORE IT (reviewer). Hoisting
     * the await alone would have made this measurably SLOWER, not faster: `getCategoriesByDemand()`
     * used to overlap the scope lookup, and putting the await first serialised it behind. Kicking it
     * off without awaiting keeps that overlap while the other four still begin together — strictly
     * better than either arrangement.
     */
    const categoriesPromise = getCategoriesByDemand()
    /**
     * ⛔ MARKED HANDLED THE INSTANT IT IS CREATED (reviewer). Between this line and the `Promise.all`
     * below there is an `await`; if THAT throws, the function unwinds before `Promise.all` ever
     * adopts this promise — leaving a rejected floating promise with no handler, i.e. an
     * `unhandledRejection` from the most-requested route in the app. Attaching a no-op catch marks
     * the original as observed without changing what `Promise.all` sees: it still receives the
     * original promise and still rejects on it.
     */
    categoriesPromise.catch(() => {})
    const publicScope = await scopedListingWhere({ verified: true, status: 'active' })

    const firstPagePromise = diverseFeedHead(
      // ⚠️ EDITION-SCOPED. eno.vn is a licensed sàn TMĐT; the e-visa SKUs are ordinary Listing
      // rows and they rank into this feed. This is the ISR-baked HTML of the root URL, served
      // from disk to every anonymous visitor and every crawler — the most-seen leak there was.
      publicScope,
      // Match /api/listings' default sort EXACTLY (the balanced rankScore blend, id
      // tiebreaker) so this SSR seed doesn't reshuffle on hydration into the client feed.
      [{ rankScore: 'desc' }, { id: 'desc' }],
      LISTING_CARD_SELECT,
      // The rules /api/listings derives for the explorer's default request (sharedSeatsFor with nothing
      // chosen + goodsSeatsFor): one seat per shared catalogue, and the goods seats — at least two of the
      // first four cards and four of the first twelve are second-hand goods (feed-diversity.ts GOODS_SEATS).
      // Any other rule here and page 2 repeats or skips a card.
      HOME_FEED_SEATS,
    )
      // The head is the window dealt by the seat rules — the SAME function /api/listings cuts its pages
      // from (feed-window.ts diverseFeedHead). Slicing AFTER the deal is the whole point: slicing first
      // would hand the reorder the same monopolised twelve rows.
      .then((head) => head.slice(0, 12))

    const [serializedCategories, firstPage, total, businesses, trending] = await Promise.all([
      // Categories ordered by live DEMAND — most-wanted lead the rail + home grid. Already in
      // flight, above.
      categoriesPromise,
      // Joined here, so its rejection is observed (the trending rail below only derives from it).
      firstPagePromise,
      // MUST match the findMany predicate exactly: this seeds the client explorer's `initialTotal`,
      // which terminates its load-more (`listings.length < total`). A count that disagrees with the
      // cards either stops the infinite feed 14 items early or never lets it finish.
      // Same object as the findMany above, so the two cannot drift — which is the invariant the
      // comment demands and which two separate `await` calls only happened to satisfy.
      db.listing.count({ where: publicScope }),
      // Outstanding-businesses rail, server-known (perf Phase 1): the rail's
      // presence/geometry is decided at first paint — the client fetch's
      // skeleton→empty collapse was the homepage's dominant CLS (0.142).
      topBusinessListings().catch(() => []),
      // "Trending now" seed for the ForYouRail — same server-known-geometry fix
      // (the client's empty thin-catalog answer collapsed the SSR'd skeletons).
      // ⛔ NOT THE FEED'S OWN CARDS (home-07): Trending opened on the feed's first card, two rows
      // above it. The first page's ids leave the rail's 96-row pool before it chooses its 16
      // (trending-rail.ts POOL); its narrow read still runs alongside the feed window — only its
      // choosing step waits for the ids. For a visitor without personalisation signals (every first
      // visit) the client keeps this seed (for-you-rail.tsx skips the fetch), so this exclusion is
      // what they see, not a first paint that hydration replaces.
      trendingRailListings({ excludeIds: firstPagePromise.then((rows) => rows.map((r) => r.id)) }).catch(() => []),
    ])

    const serializedListings: SerializedListingCard[] = await localizeListingTitles(firstPage.map(serializeListingCard))

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
  /**
   * ⛔ NO SEPARATE PARTNER BANNER STRIP HERE — <PromoBanner> INSIDE ListingsExplorer IS THE ONE
   * BANNER SLOT, and a second one above it would stack two banners over the feed. The strip built
   * on 2026-08-24 was superseded within the day by putting VinWonders into promo-slides.ts beside
   * VietKite and GMBR, which was already the tuned path: art direction, avif+webp, a measured LCP
   * story, and the "Quảng cáo · <partner>" disclosure chip that a bare <img> would not carry.
   * The strip, its edition-scoped query and its tests were REMOVED rather than left unused: dead
   * code with a passing suite still reads as a live feature to the next person. It is in git at
   * 8f78172 if a data-driven strip is ever wanted — the part worth re-reading there is that the
   * deny-list and allow-list must be one `id` object, not two spreads that overwrite each other.
   */
  const { categories, listings, total, businesses, trending } = await getData()

  /**
   * ⛔ THE WRAPPER, HEADER, `<main>`, H1 AND FOOTER ARE IN `(home)/layout.tsx` SINCE SEO WAVE B, H1c,
   * above this route's loading boundary, where crawlers can read them. This page renders only the feed,
   * which the skeleton stands in for. `siteHeading={false}` because the layout owns the one H1; the
   * explorer's own copy is for `/s/[handle]`, which has none.
   */
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
      siteHeading={false}
    />
  )
}
