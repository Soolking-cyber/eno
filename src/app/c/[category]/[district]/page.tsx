import { cache } from 'react'
import { db } from '@/lib/db'
import { serializeListingCard, LISTING_CARD_SELECT } from '@/lib/serialize'
import { localizeListingTitles } from '@/lib/translate'
import { slugify } from '@/lib/slug'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { SellerListings } from '@/components/marketplace/seller-listings'
import { Button } from '@/components/ui/button'
import { Tr } from '@/context/language-context'

export const revalidate = 604800 // 7d — long-tail SEO combo (category×district = many pages); client fetches live, so weekly regen is plenty + far fewer ISR writes

type Props = { params: Promise<{ category: string; district: string }> }

// Render district pages on-demand (ISR), NOT at build. Prerendering all
// district combos in parallel during the Vercel build bursts the pooled
// Supabase connection (PrismaClientKnownRequestError on prerender). On-demand
// rendering does one query per request, caches via `revalidate`, and the pages
// are still discoverable via the sitemap. dynamicParams defaults to true.
export async function generateStaticParams() {
  return []
}

// `cache()` dedupes this between generateMetadata and the page render (same request)
// so the category is scanned ONCE per request, not twice. District is free text and
// the slug match must run in JS (Postgres can't reproduce slugify), so we bound the
// scan with a take cap: an SEO page only needs the top-ranked listings, and weekly
// ISR makes the rare deep-tail miss immaterial. Order stays trust-first.
const load = cache(async (categorySlug: string, districtSlug: string) => {
  const cat = await db.category.findUnique({ where: { slug: categorySlug } })
  if (!cat) return null
  const raw = await db.listing.findMany({
    where: { categoryId: cat.id, verified: true, status: 'active', NOT: { district: null } },
    // Card projection: the page renders <ListingCard> slots only, and the JS-side district
    // slug filter just needs `district` (included in the select). The full row × take 600
    // dragged descriptions/searchText/whole-Seller through Postgres for nothing.
    select: LISTING_CARD_SELECT,
    orderBy: [{ rankScore: 'desc' }, { id: 'desc' }], // balanced blend — consistent with the feed
    take: 600,
  })
  const matched = raw.filter((r) => r.district && slugify(r.district) === districtSlug)
  if (matched.length === 0) return null
  return { cat, matched, districtName: matched[0].district as string }
})

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category, district } = await params
  const data = await load(category, district)
  // Real 404 (not soft-404) for an unknown category/district — before streaming.
  if (!data) notFound()
  const hostUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'
  return {
    title: `${data.cat.name} in ${data.districtName} — Trusted | eno.vn`,
    description: `${data.cat.name} in ${data.districtName}. Every seller has a public trust score and bad listings get reported — fewer fakes, fewer bait prices.`,
    alternates: { canonical: `${hostUrl}/c/${data.cat.slug}/${district}` },
  }
}

export default async function CategoryDistrictPage({ params }: Props) {
  const { category, district } = await params
  const data = await load(category, district)
  if (!data) notFound()
  const { cat, matched, districtName } = data
  const listings = await localizeListingTitles(matched.map(serializeListingCard))
  const hostUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: hostUrl },
          { '@type': 'ListItem', position: 2, name: cat.name, item: `${hostUrl}/c/${cat.slug}` },
          { '@type': 'ListItem', position: 3, name: districtName, item: `${hostUrl}/c/${cat.slug}/${district}` },
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
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        <nav className="mb-4 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-accent-foreground transition-colors"><Tr text="Home" /></Link>
          <span className="mx-1.5 text-line-strong">/</span>
          <Link href={`/c/${cat.slug}`} className="hover:text-accent-foreground transition-colors"><Tr text={cat.name} /></Link>
          <span className="mx-1.5 text-line-strong">/</span>
          <span className="font-medium text-foreground"><Tr text={districtName} /></span>
        </nav>

        <h1 className="h-display text-foreground"><Tr text={cat.name} /> <Tr text="in" /> <Tr text={districtName} /></h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-body">
          {listings.length} <Tr text={cat.name.toLowerCase()} /> {listings.length === 1 ? <Tr text="listing" /> : <Tr text="listings" />} <Tr text="in" /> <Tr text={districtName} />,{' '}
          <Tr text="each from a seller with a public trust score — fewer fakes, fewer bait prices." />
        </p>

        <div className="mt-8">
          <SellerListings listings={listings} sortable />
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href={`/c/${cat.slug}`} className="inline-block rounded-xl border border-line-strong px-5 py-2.5 text-sm font-bold text-foreground transition-colors hover:bg-muted">
            ← <Tr text="All" /> <Tr text={cat.name} />
          </Link>
          <Button asChild variant="cta" size="none">
            <Link href={`/?category=${cat.slug}`} className="px-5 py-2.5">
              <Tr text="Refine in full search" /> →
            </Link>
          </Button>
        </div>
      </main>
      <Footer />
    </div>
  )
}
