import type { Metadata } from 'next'
import Link from 'next/link'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Tr } from '@/context/language-context'
import { BrandLogo } from '@/components/marketplace/brand-logo'
import { db } from '@/lib/db'
import { brandIconPath } from '@/lib/brand-icons'

export const metadata: Metadata = {
  title: 'Brands | eno.vn',
  description: 'Browse listings by brand on eno.vn — phones, laptops, motorbikes, fashion and more from the brands buyers in Vietnam search for.',
}

// Brand directory refreshes hourly — the catalogue grows slowly and rankings are
// listing-count based, so first-paint can be cached aggressively.
export const revalidate = 21600 // 6h — fewer ISR writes; the catalogue grows slowly

export default async function BrandsPage() {
  // Active brands that actually have listings, most-listed first. Resolve each
  // brand's monotone logo server-side so simple-icons never reaches the client.
  // Defensive: if the catalogue table isn't reachable (e.g. pre-migration build),
  // fall back to empty rather than failing the render.
  const brands = await db.brand.findMany({
    where: { status: 'active', listingCount: { gt: 0 } },
    select: { slug: true, name: true, iconSlug: true, logoPath: true, listingCount: true },
    orderBy: [{ listingCount: 'desc' }, { name: 'asc' }],
    take: 300,
  }).catch(() => [])
  const items = brands.map((b) => ({ ...b, iconPath: brandIconPath(b) }))

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-10 pb-16">
        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
          <Tr text="Browse by brand" />
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          <Tr text="Jump straight to listings from the brands people search for most." />
        </p>

        {items.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-line-strong py-14 px-6 text-center text-sm text-muted-foreground">
            <Tr text="No brands yet — they appear as sellers post." />
          </div>
        ) : (
          <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {items.map((b) => (
              <Link
                key={b.slug}
                href={`/?brand=${encodeURIComponent(b.slug)}`}
                className="group flex flex-col items-center gap-3 rounded-2xl bg-card px-4 py-6 text-center transition-colors hover:bg-muted"
              >
                <BrandLogo name={b.name} iconPath={b.iconPath} size={44} className="transition-transform group-hover:scale-105" />
                <span className="line-clamp-1 text-sm font-semibold text-foreground">{b.name}</span>
                <span className="text-xs text-muted-foreground">
                  {b.listingCount} <Tr text="listings" />
                </span>
              </Link>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  )
}
