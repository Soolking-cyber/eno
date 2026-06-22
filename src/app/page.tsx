import type { Metadata } from 'next'
import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import type { SerializedCategory, SerializedListing } from '@/lib/types'
import { Header } from '@/components/marketplace/header'
import { ListingsExplorer } from '@/components/marketplace/listings-explorer'
import { Footer } from '@/components/marketplace/footer'

// ISR: near-static homepage data, refreshed at most once a minute (better LCP/TTFB).
export const revalidate = 60

// Self-canonical so Google attributes ranking signals to the no-redirect www host.
export const metadata: Metadata = { alternates: { canonical: '/' } }

async function getData(): Promise<{ categories: SerializedCategory[]; listings: SerializedListing[]; total: number }> {
  try {
    // verified:true AND status:'active' matches the /api/listings response (GET
    // forces verified+active-only), so this SSR data can seed React Query's
    // default-view cache exactly — and never leaks sold/hidden items on first paint.
    const [categories, listings, total] = await Promise.all([
      db.category.findMany({
        orderBy: { name: 'asc' },
        include: { _count: { select: { listings: { where: { verified: true, status: 'active' } } } } },
      }),
      db.listing.findMany({
        where: { verified: true, status: 'active' },
        orderBy: [{ featured: 'desc' }, { postedAt: 'desc' }],
        take: 24,
        include: { category: true, seller: { include: { owner: { select: { accountType: true } } } } },
      }),
      db.listing.count({ where: { verified: true, status: 'active' } }),
    ])

    const serializedCategories: SerializedCategory[] = categories.map((c) => ({
      id: c.id,
      name: c.name,
      nameVi: c.nameVi,
      slug: c.slug,
      icon: c.icon,
      color: c.color as SerializedCategory['color'],
      description: c.description,
      verifiedCount: c._count.listings,
    }))

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
