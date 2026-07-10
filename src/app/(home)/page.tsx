import type { Metadata } from 'next'
import { db } from '@/lib/db'
import { serializeListingCard, LISTING_CARD_SELECT } from '@/lib/serialize'
import { localizeListingTitles } from '@/lib/translate'
import { getCategoriesByDemand } from '@/lib/categories'
import type { SerializedCategory, SerializedListingCard } from '@/lib/types'
import { Header } from '@/components/marketplace/header'
import { ListingsExplorer } from '@/components/marketplace/listings-explorer'
import { Footer } from '@/components/marketplace/footer'

// ISR: near-static homepage data, refreshed at most once a minute (better LCP/TTFB).
export const revalidate = 21600 // 6h — the client explorer fetches live listings via /api/listings, so the ISR HTML is just first-paint+SEO. Home is a HOT page that regenerates per edge region, so a 6h window (vs 1h) cuts ISR writes ~6× with zero UX/speed change

// Self-canonical so Google attributes ranking signals to the no-redirect www host.
export const metadata: Metadata = { alternates: { canonical: '/' } }

async function getData(): Promise<{ categories: SerializedCategory[]; listings: SerializedListingCard[]; total: number }> {
  try {
    // verified:true AND status:'active' matches the /api/listings response (GET
    // forces verified+active-only), so this SSR data can seed React Query's
    // default-view cache exactly — and never leaks sold/hidden items on first paint.
    const [serializedCategories, listings, total] = await Promise.all([
      // Categories ordered by live DEMAND — most-wanted lead the rail + home grid.
      getCategoriesByDemand(),
      db.listing.findMany({
        where: { verified: true, status: 'active' },
        // Match /api/listings' default sort EXACTLY (the balanced rankScore blend, id
        // tiebreaker) so this SSR seed doesn't reshuffle on hydration into the client feed.
        orderBy: [{ rankScore: 'desc' }, { id: 'desc' }],
        // First page of the infinite home feed; it paginates 12 at a time on scroll.
        // Smaller first page = fewer cards hydrating on first paint (main-thread win).
        take: 12,
        select: LISTING_CARD_SELECT,
      }),
      db.listing.count({ where: { verified: true, status: 'active' } }),
    ])

    const serializedListings: SerializedListingCard[] = await localizeListingTitles(listings.map(serializeListingCard))

    return { categories: serializedCategories, listings: serializedListings, total }
  } catch {
    // DB unreachable at build → prerender empty and let ISR (revalidate) fill it
    // on the first request, so a transient build-time DB error never fails the deploy.
    return { categories: [], listings: [], total: 0 }
  }
}

export default async function Home() {
  const { categories, listings, total } = await getData()

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      {/* The hero-wordmark preload (/logo.svg) is co-located inside <LogoWordmark> (a client
          component) so it sits in the initial <head> for LCP but is auto-removed on nav away.
          A <link> here (Server Component) was hoisted to <head> and NOT cleaned up on soft
          nav, so it leaked onto non-home routes and warned "preloaded but not used". */}
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-4">
        <ListingsExplorer
          categories={categories}
          initialListings={listings}
          initialTotal={total}
          // Baked at ISR regeneration time — tells the client explorer the seed's TRUE age
          // so a 6h-old snapshot revalidates in the background instead of posing as fresh.
          initialFetchedAt={Date.now()}
        />
      </main>
      <Footer />
    </div>
  )
}
