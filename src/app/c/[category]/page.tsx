import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { slugify } from '@/lib/slug'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { SellerListings } from '@/components/marketplace/seller-listings'

export const revalidate = 600 // ISR

type Props = { params: Promise<{ category: string }> }

// Render on-demand (ISR), not at build — see the district page for why. Pages
// cache via `revalidate` after first request and are listed in the sitemap.
export async function generateStaticParams() {
  return []
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category } = await params
  const cat = await db.category.findUnique({ where: { slug: category } })
  if (!cat) return {}
  const hostUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'
  return {
    title: `${cat.name} in Vietnam — Verified listings | ENO`,
    description: `Browse verified ${cat.name.toLowerCase()} for expats in Vietnam. Every listing checked by an ENO agent — no fakes, no bait prices, no wasted trips.`,
    alternates: { canonical: `${hostUrl}/c/${cat.slug}` },
  }
}

export default async function CategoryPage({ params }: Props) {
  const { category } = await params
  const cat = await db.category.findUnique({ where: { slug: category } })
  if (!cat) notFound()

  const raw = await db.listing.findMany({
    where: { categoryId: cat.id, verified: true },
    include: { category: true, seller: true },
    orderBy: [{ featured: 'desc' }, { postedAt: 'desc' }],
  })
  const listings = raw.map(serializeListing)
  const districts = [...new Set(raw.map((r) => r.district).filter((d): d is string => !!d))]
  const otherCats = await db.category.findMany({ where: { NOT: { id: cat.id } }, orderBy: { name: 'asc' } })
  const hostUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: hostUrl },
          { '@type': 'ListItem', position: 2, name: cat.name, item: `${hostUrl}/c/${cat.slug}` },
        ],
      },
      {
        '@type': 'ItemList',
        itemListElement: listings.slice(0, 20).map((l, i) => ({
          '@type': 'ListItem', position: i + 1, url: `${hostUrl}/listings/${l.id}`, name: l.title,
        })),
      },
    ],
  }

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <Header />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-6 pb-12">
        <nav className="mb-4 text-sm text-[#64748b]">
          <Link href="/" className="hover:text-[#0a66c2] transition-colors">Home</Link>
          <span className="mx-1.5 text-[#cbd5e1]">/</span>
          <span className="font-medium text-[#1a202c]">{cat.name}</span>
        </nav>

        <h1 className="h-display text-[#1a202c]">{cat.name} in Vietnam</h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-[#475569]">
          Every {cat.name.toLowerCase()} listing on ENO is verified by an agent before it goes live — no fakes, no bait
          prices, no wasted trips. {listings.length} verified {listings.length === 1 ? 'listing' : 'listings'} available.
        </p>

        {districts.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            <span className="self-center text-xs font-semibold text-[#94a3b8]">By area:</span>
            {districts.map((d) => (
              <Link key={d} href={`/c/${cat.slug}/${slugify(d)}`} className="rounded-full bg-[#f1f5f9] px-3.5 py-1.5 text-xs font-semibold text-[#475569] transition-colors hover:bg-[#e8f1fb] hover:text-[#0a66c2]">
                {d}
              </Link>
            ))}
          </div>
        )}

        <div className="mt-8">
          {listings.length > 0 ? (
            <SellerListings listings={listings} />
          ) : (
            <p className="rounded-2xl border border-dashed border-[#cbd5e1] py-12 text-center text-sm text-[#64748b]">
              No verified {cat.name.toLowerCase()} yet — check back soon.
            </p>
          )}
        </div>

        <div className="mt-8">
          <Link href={`/?category=${cat.slug}`} className="inline-block rounded-full bg-[#0a66c2] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#004182]">
            Refine in full search →
          </Link>
        </div>

        <div className="mt-12 border-t border-slate-200 pt-6">
          <h2 className="h-section text-[#1a202c] mb-3">Other categories</h2>
          <div className="flex flex-wrap gap-2">
            {otherCats.map((c) => (
              <Link key={c.slug} href={`/c/${c.slug}`} className="rounded-full bg-[#f1f5f9] px-3.5 py-1.5 text-xs font-semibold text-[#475569] transition-colors hover:bg-[#e8f1fb] hover:text-[#0a66c2]">
                {c.name}
              </Link>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
