import { SITE_NAME } from '@/lib/edition'
import { scopedListingWhere } from '@/lib/edition-scope'
import { cache } from 'react'
import { db } from '@/lib/db'
import { serializeListingCard, LISTING_CARD_SELECT } from '@/lib/serialize'
import { localizeListingTitles } from '@/lib/translate'
import { slugify } from '@/lib/slug'
import { districtScopeForSlug, curatedDistrictName } from '@/lib/district-slug'
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

/** Cards rendered into the HTML. Everything past it is reachable through the scoped query below. */
const DISTRICT_PAGE_SIZE = 48
/** Sibling "By area" chips. A category can carry hundreds of districts; a chip row cannot. */
const SIBLING_DISTRICTS = 24

/**
 * `cache()` dedupes this between generateMetadata and the page render (same request) so the
 * category is aggregated ONCE per request, not twice.
 *
 * ⛔ THE DISTRICT IS SELECTED IN THE DATABASE NOW, AND THE OLD SHAPE COULD 404 A REAL DISTRICT.
 * District is free text and `slugify` has no Postgres equivalent, so this used to fetch the
 * category's top 600 listings and filter them in JavaScript. Three things followed, all invisible:
 * a district whose listings all rank below 600 in its own category returned NO rows and the page
 * answered 404 for a place that exists; the heading counted the survivors of that 600-row window
 * and reported them as the district's inventory; and the "By area" chips were whichever districts
 * happened to appear in it. A category with more than 600 active listings — one import already
 * produced 9,726 — hit all three at once.
 *
 * ⚠️ ONE GROUP BY ANSWERS ALL OF IT. Every district in the category with its true count: the slug
 * match runs over that vocabulary (a few hundred strings) instead of over listings, the count is
 * the count, the chips are the real siblings ordered by size, and 404 now means the aggregate has
 * no such district — which is the only honest reason to say so.
 */
const load = cache(async (categorySlug: string, districtSlug: string) => {
  const cat = await db.category.findUnique({ where: { slug: categorySlug } })
  if (!cat) return null
  // scopedListingWhere composes through AND, so the existing NOT survives untouched. This scopes
  // the visible grid and the ItemList JSON-LD together — they read the same rows.
  /**
   * ⛔ EXACTLY THE FEED'S PREDICATE, WITH NO EXTRA CLAUSE. This carried `NOT: { district: null }`,
   * which `/api/listings` does not — and a curated slug's scope is an OR across `district` AND
   * `location`, so a row with a null district but a matching LOCATION is in the feed's set and was
   * out of this page's. The page then announced one total while the first sort showed a larger one
   * and Show-more paged over rows the page had never counted (external review).
   */
  const base = await scopedListingWhere({ categoryId: cat.id, verified: true, status: 'active' })
  /**
   * ⛔ THE SAME SCOPE THE FEED WILL USE, RESOLVED ONCE. This page used to select districts by exact
   * stored name while every sort and Show-more from it sent the slug to /api/listings, which
   * matched the CURATED spellings instead — a broader set. 12 of the 23 curated slugs are exactly
   * what a stored name slugifies to, so on most district pages the first interaction silently
   * changed both the total and the membership. `districtScopeForSlug` is now the only definition.
   */
  const scope = await districtScopeForSlug(districtSlug)
  if (!scope) return null
  const where = { AND: [base, scope] }
  // edition-lint-allow: `base` IS `await scopedListingWhere(...)` five lines up, and every read on
  // this page composes it — the desk exclusion cannot be lost by an AND. The rule counts guard
  // MENTIONS against reads, so one scoped predicate feeding three reads reads as two unguarded.
  const total = await db.listing.count({ where })
  if (total === 0) return null
  // edition-lint-allow: same `where` as the count above, built from scopedListingWhere.
  const rows = await db.listing.findMany({
    where,
    // Card projection: the page renders <ListingCard> slots only. The full row dragged
    // descriptions/searchText/whole-Seller through Postgres for nothing.
    select: LISTING_CARD_SELECT,
    // ⚠️ MUST EQUAL buildFeedOrderBy('newest'), which is what Show-more sends — otherwise page 2
    // comes from a different ordering than page 1.
    orderBy: [{ rankScore: 'desc' }, { id: 'desc' }],
    take: DISTRICT_PAGE_SIZE,
  })
  if (rows.length === 0) return null
  // Sibling chips come from one aggregate over the whole category.
  const groups = await db.listing.groupBy({
    by: ['district'],
    // ⚠️ THIS one keeps the null exclusion: a chip needs a district name to be a chip.
    where: { AND: [base, { NOT: { district: null } }] },
    _count: { _all: true },
    orderBy: { _count: { district: 'desc' } },
  })
  const districtName = curatedDistrictName(districtSlug) || (rows[0].district as string)
  /**
   * ⚠️ DEDUPED BY SLUG, NOT BY NAME. Two stored spellings of one place ("Thao Dien" / "Thảo Điền")
   * are two rows in the aggregate but ONE destination, so listing both drew two chips to the same
   * URL. Keeps the first, which is the busiest because the aggregate is ordered by count.
   */
  const seenSlugs = new Set<string>()
  const districts = groups
    .map((g) => g.district)
    .filter((d): d is string => !!d)
    .filter((d) => { const k = slugify(d); if (seenSlugs.has(k)) return false; seenSlugs.add(k); return true })
  return { cat, matched: rows, total, districtName, districts }
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
  const { cat, matched, total, districtName, districts } = data
  const otherDistricts = districts.filter((d) => slugify(d) !== district).slice(0, SIBLING_DISTRICTS)
  // The explorer scoped to exactly this page — the API resolves a slugified district name the same
  // way this page does (src/lib/district-slug.ts), so leaving here keeps the district.
  const scopedExplorer = `/?category=${cat.slug}&district=${district}`
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
          {/* ⚠️ THE SCOPE'S TRUE COUNT, NOT THE PAGE'S. This read `listings.length` — the survivors of
              a 600-row window — and announced them as the district's inventory. */}
          {total} <Tr text={cat.name.toLowerCase()} /> {total === 1 ? <Tr text="listing" /> : <Tr text="listings" />} <Tr text="in" /> <Tr text={districtName} />,{' '}
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
          {/* ⛔ SORT AND LOAD-MORE ARE SCOPED QUERIES. Sorting this page's 48 cards in the browser
              would answer "cheapest in this district" with the cheapest of 48 — and the district is
              carried in `params`, so no interaction can drop it. */}
          <SellerListings
            listings={listings}
            sortable={total > 1}
            serverScope={{ params: { category: cat.slug, district }, total, pageSize: DISTRICT_PAGE_SIZE }}
          />
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild variant="outline" size="none" className="border-line-strong font-bold hover:bg-muted hover:text-foreground">
            <Link href={`/c/${cat.slug}`} className="px-5 py-2.5 text-sm">
              ← <Tr text="All" /> <Tr text={cat.name} />
            </Link>
          </Button>
          <Button asChild variant="cta" size="none">
            {/* ⛔ THE DISTRICT USED TO BE DROPPED HERE. This linked to `/?category=<slug>` and the
                reader landed in the whole category, one click after choosing a district. */}
            <Link href={scopedExplorer} className="px-5 py-2.5">
              <Tr text="Refine in full search" /> →
            </Link>
          </Button>
        </div>
      </main>
      <Footer />
    </div>
  )
}
