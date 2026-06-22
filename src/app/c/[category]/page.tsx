import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { slugify } from '@/lib/slug'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { SellerListings } from '@/components/marketplace/seller-listings'
import { Tr } from '@/context/language-context'

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
    title: `${cat.name} in Vietnam — Verified listings | eno.vn`,
    description: `Browse verified ${cat.name.toLowerCase()} for expats in Vietnam. Every listing checked by an eno.vn agent — no fakes, no bait prices, no wasted trips.`,
    alternates: { canonical: `${hostUrl}/c/${cat.slug}` },
  }
}

export default async function CategoryPage({ params }: Props) {
  const { category } = await params
  const cat = await db.category.findUnique({ where: { slug: category } })
  if (!cat) notFound()

  const raw = await db.listing.findMany({
    where: { categoryId: cat.id, verified: true, status: 'active' },
    include: { category: true, seller: { include: { owner: { select: { accountType: true } } } } },
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
      <main className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        <nav className="mb-4 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-accent-foreground transition-colors"><Tr text="Home" /></Link>
          <span className="mx-1.5 text-line-strong">/</span>
          <span className="font-medium text-foreground"><Tr text={cat.name} /></span>
        </nav>

        <h1 className="h-display text-foreground"><Tr text={cat.name} /> <Tr text="in Vietnam" /></h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-body">
          <Tr text="Every" /> <Tr text={cat.name.toLowerCase()} /> <Tr text="listing on eno.vn is verified by an agent before it goes live — no fakes, no bait prices, no wasted trips." />{' '}
          {listings.length} <Tr text="verified" /> {listings.length === 1 ? <Tr text="listing" /> : <Tr text="listings" />} <Tr text="available." />
        </p>

        {districts.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            <span className="self-center text-xs font-semibold text-ink-4"><Tr text="By area:" /></span>
            {districts.map((d) => (
              <Link key={d} href={`/c/${cat.slug}/${slugify(d)}`} className="rounded-full bg-tint px-3.5 py-1.5 text-xs font-semibold text-body transition-colors hover:bg-accent hover:text-accent-foreground">
                <Tr text={d} />
              </Link>
            ))}
          </div>
        )}

        <div className="mt-8">
          {listings.length > 0 ? (
            <SellerListings listings={listings} />
          ) : (
            <p className="rounded-2xl border border-dashed border-line-strong py-12 text-center text-sm text-muted-foreground">
              <Tr text="No verified" /> <Tr text={cat.name.toLowerCase()} /> <Tr text="yet — check back soon." />
            </p>
          )}
        </div>

        <div className="mt-8">
          <Link href={`/?category=${cat.slug}`} className="inline-block rounded-xl bg-[#0a66c2] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#004182]">
            <Tr text="Refine in full search" /> →
          </Link>
        </div>

        <div className="mt-12 border-t border-border pt-6">
          <h2 className="h-section text-foreground mb-3"><Tr text="Other categories" /></h2>
          <div className="flex flex-wrap gap-2">
            {otherCats.map((c) => (
              <Link key={c.slug} href={`/c/${c.slug}`} className="rounded-full bg-tint px-3.5 py-1.5 text-xs font-semibold text-body transition-colors hover:bg-accent hover:text-accent-foreground">
                <Tr text={c.name} />
              </Link>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
