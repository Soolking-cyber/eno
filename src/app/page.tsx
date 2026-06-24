import type { Metadata } from 'next'
import ReactDOM from 'react-dom'
import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { getCategoriesByDemand } from '@/lib/categories'
import type { SerializedCategory, SerializedListing } from '@/lib/types'
import { Header } from '@/components/marketplace/header'
import { ListingsExplorer } from '@/components/marketplace/listings-explorer'
import { Footer } from '@/components/marketplace/footer'

// ISR: near-static homepage data, refreshed at most once a minute (better LCP/TTFB).
export const revalidate = 3600 // 1h — the client explorer fetches live listings via /api/listings, so the ISR HTML is just first-paint+SEO; longer interval = far fewer writes, same speed

// Self-canonical so Google attributes ranking signals to the no-redirect www host.
export const metadata: Metadata = { alternates: { canonical: '/' } }

async function getData(): Promise<{ categories: SerializedCategory[]; listings: SerializedListing[]; total: number }> {
  try {
    // verified:true AND status:'active' matches the /api/listings response (GET
    // forces verified+active-only), so this SSR data can seed React Query's
    // default-view cache exactly — and never leaks sold/hidden items on first paint.
    const [serializedCategories, listings, total] = await Promise.all([
      // Categories ordered by live DEMAND — most-wanted lead the rail + home grid.
      getCategoriesByDemand(),
      db.listing.findMany({
        where: { verified: true, status: 'active' },
        // Match /api/listings' default sort EXACTLY (trust-first, then featured, then
        // recency, id tiebreaker) so this SSR seed doesn't reshuffle on hydration.
        orderBy: [{ seller: { trustScore: 'desc' } }, { featured: 'desc' }, { postedAt: 'desc' }, { id: 'desc' }],
        // First page of the infinite home feed; it paginates 24 at a time on scroll.
        take: 24,
        include: { category: true, seller: { include: { owner: { select: { accountType: true } } } } },
      }),
      db.listing.count({ where: { verified: true, status: 'active' } }),
    ])

    const serializedListings: SerializedListing[] = listings.map(serializeListing)

    return { categories: serializedCategories, listings: serializedListings, total }
  } catch {
    // DB unreachable at build → prerender empty and let ISR (revalidate) fill it
    // on the first request, so a transient build-time DB error never fails the deploy.
    return { categories: [], listings: [], total: 0 }
  }
}

export default async function Home() {
  const { categories, listings, total } = await getData()

  // Preload the hero wordmark — the landing LCP element — at high priority, but
  // ONLY here (it's unused on other routes, where a global preload warned). Next
  // emits this as a <link rel="preload"> in <head>.
  ReactDOM.preload('/logo.svg', { as: 'image', fetchPriority: 'high' })

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-4">
        <ListingsExplorer
          categories={categories}
          initialListings={listings}
          initialTotal={total}
          initialFetchedAt={Date.now()}
        />
      </main>
      <Footer />
    </div>
  )
}
