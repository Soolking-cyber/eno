import { SITE_NAME } from '@/lib/edition'
import { scopedListingWhere } from '@/lib/edition-scope'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
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
    // scopedListingWhere composes through AND, so the existing NOT survives untouched. This fixes
    // the visible grid and the ItemList JSON-LD together — they read the same rows.
    where: await scopedListingWhere({ categoryId: cat.id, verified: true, status: 'active', NOT: { district: null } }),
    // Card projection: the page renders <ListingCard> slots only, and the JS-side district
    // slug filter just needs `district` (included in the select). The full row × take 600
    // dragged descriptions/searchText/whole-Seller through Postgres for nothing.
    select: LISTING_CARD_SELECT,
    orderBy: [{ rankScore: 'desc' }, { id: 'desc' }], // balanced blend — consistent with the feed
    take: 600,
  })
  const matched = raw.filter((r) => r.district && slugify(r.district) === districtSlug)
  if (matched.length === 0) return null
  // Sibling districts come for free from the same bounded scan — the "By area" chip row costs
  // no extra query. Deduped on the display name; the current district is excluded at render.
  const districts = [...new Set(raw.map((r) => r.district).filter((d): d is string => !!d))]
  return { cat, matched, districtName: matched[0].district as string, districts }
})

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category, district } = await params
  const data = await load(category, district)
  // Real 404 (not soft-404) for an unknown category/district — before streaming.
  if (!data) notFound()
  const hostUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'
  const title = `${data.cat.name} in ${data.districtName} — Trusted | ${SITE_NAME}`
  const description = `${data.cat.name} in ${data.districtName}. Every seller has a public trust score and bad listings get reported — fewer fakes, fewer bait prices.`
  return {
    title,
    description,
    alternates: { canonical: `${hostUrl}/c/${data.cat.slug}/${district}` },
    // Mirror the page's own title/description/canonical into OG — without this the
    // page inherits the generic homepage OG tags in link unfurls.
    openGraph: { title, description, url: `${hostUrl}/c/${data.cat.slug}/${district}` },
  }
}

export default async function CategoryDistrictPage({ params }: Props) {
  const { category, district } = await params
  const data = await load(category, district)
  if (!data) notFound()
  const { cat, matched, districtName, districts } = data
  const otherDistricts = districts.filter((d) => slugify(d) !== district)
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
        {/* Same Breadcrumb primitive as the sibling category page (was a hand-rolled <nav>) —
            the family's statement header opens identically on every browse surface. */}
        <Breadcrumb className="mb-4">
          <BreadcrumbList>
            <BreadcrumbItem>
              {/* Base UI render prop (never asChild) — keeps the Next.js client-side nav. */}
              <BreadcrumbLink render={<Link href="/" />} className="hover:text-accent-foreground"><Tr text="Home" /></BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="text-line-strong">/</BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href={`/c/${cat.slug}`} />} className="hover:text-accent-foreground"><Tr text={cat.name} /></BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="text-line-strong">/</BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbPage className="font-medium"><Tr text={districtName} /></BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <h1 className="h-display text-foreground"><Tr text={cat.name} /> <Tr text="in" /> <Tr text={districtName} /></h1>
        {/* Measured lede — 65ch, same as the category page. */}
        <p className="mt-3 max-w-prose text-base leading-relaxed text-body">
          {listings.length} <Tr text={cat.name.toLowerCase()} /> {listings.length === 1 ? <Tr text="listing" /> : <Tr text="listings" />} <Tr text="in" /> <Tr text={districtName} />,{' '}
          <Tr text="each from a seller with a public trust score — fewer fakes, fewer bait prices." />
        </p>

        {otherDistricts.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2">
            <span className="self-center text-xs font-semibold text-ink-4"><Tr text="By area:" /></span>
            {otherDistricts.map((d) => (
              <Badge key={d} size="md" interactive render={<Link href={`/c/${cat.slug}/${slugify(d)}`} />} className="px-3.5 py-1.5 font-semibold text-body hover:bg-accent hover:text-accent-foreground">
                <Tr text={d} />
              </Badge>
            ))}
          </div>
        )}

        {/* Masthead boundary — full-bleed hairline, aligned with the sort strip's own border. */}
        <div aria-hidden className="mt-8 -mx-3 border-t border-border sm:-mx-6 lg:-mx-8" />

        <div className="mt-6">
          {/* sr-only h2 — card titles are h3s; without this the outline jumps h1 → h3. */}
          <h2 className="sr-only"><Tr text="Listings" /></h2>
          <SellerListings listings={listings} sortable={listings.length > 1} />
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild variant="outline" size="none" className="border-line-strong font-bold hover:bg-muted hover:text-foreground">
            <Link href={`/c/${cat.slug}`} className="px-5 py-2.5 text-sm">
              ← <Tr text="All" /> <Tr text={cat.name} />
            </Link>
          </Button>
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
