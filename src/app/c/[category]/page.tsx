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
import { ArrowRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Mascot } from '@/components/marketplace/mascot'
import { SellerListings } from '@/components/marketplace/seller-listings'
import { Tr } from '@/context/language-context'

export const revalidate = 21600 // 6h — client fetches live listings; ISR HTML is first-paint+SEO only

type Props = { params: Promise<{ category: string }> }

// Render on-demand (ISR), not at build — see the district page for why. Pages
// cache via `revalidate` after first request and are listed in the sitemap.
export async function generateStaticParams() {
  return []
}

/**
 * The category and how many live listings it actually has.
 *
 * `cache()` dedupes this between generateMetadata and the page render within one request — the
 * same idiom the sibling district page uses and for the same reason. Without it, adding the count
 * to the metadata would mean a second COUNT per render purely to decide a robots tag.
 */
const loadCategory = cache(async (slug: string) => {
  const cat = await db.category.findUnique({ where: { slug } })
  if (!cat) return null
  const live = await db.listing.count({ where: await scopedListingWhere({ categoryId: cat.id, verified: true, status: 'active' }) })
  return { cat, live }
})

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category } = await params
  const loaded = await loadCategory(category)
  // ⚠️ NOT A "REAL 404", and the old comment here said it was. Next 15.2+ streams metadata, so by
  // the time notFound() runs the response has already committed 200 — the page renders the
  // not-found boundary (which does inject its own noindex) but the STATUS is 200. Left as-is
  // deliberately: it was measured, the boundary's noindex is what actually keeps these out of the
  // index, and every alternative fix regressed something real (deleting loading.tsx trades a
  // verified CLS of 0 for a status byte; force-dynamic reimposes a Singapore DB hit on every view).
  // The comment is corrected rather than the code, so the next reader is not misled into "fixing"
  // an invariant that has not held since the Next upgrade.
  if (!loaded) notFound()
  const { cat, live } = loaded
  const hostUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'
  const title = `${cat.name} in Vietnam — Trusted listings | ${SITE_NAME}`
  const description = `Browse ${cat.name.toLowerCase()} for expats in Vietnam. Every seller has a public trust score and bad listings get reported — fewer fakes, fewer bait prices.`
  return {
    title,
    description,
    alternates: { canonical: `${hostUrl}/c/${cat.slug}` },
    // ⚠️ AN EMPTY CATEGORY DE-INDEXES ITSELF. Eight of the fifteen categories currently hold zero
    // live listings, and such a page is ~40 unique words wrapped around "No listings here yet" —
    // thin content, repeated eight times, on a domain with nothing else to show. `follow: true` is
    // deliberate: the page still carries real internal links to sibling categories, and we want
    // those crawled. It lifts ITSELF the moment somebody posts, with no list to maintain, which is
    // why this is computed rather than hard-coded — a hard-coded list would go stale silently and
    // keep suppressing a category that had filled up.
    ...(live === 0 ? { robots: { index: false, follow: true } } : {}),
    // Mirror the page's own title/description/canonical into OG — without this the
    // page inherits the generic homepage OG tags in link unfurls.
    openGraph: { title, description, url: `${hostUrl}/c/${cat.slug}` },
  }
}

export default async function CategoryPage({ params }: Props) {
  const { category } = await params
  // Same cached loader generateMetadata used, so within this request the category lookup and the
  // live count are each done once — `total` below IS the number the robots decision was made on,
  // which is what stops the page claiming a count its own indexing directive disagrees with.
  const loaded = await loadCategory(category)
  if (!loaded) notFound()
  const { cat, live: total } = loaded

  // Cap the landing to a page of listings (was unbounded — fetched the entire
  // category each ISR render). Independent queries run in parallel; the
  // distinct districts come from a light separate query so the "by area" chips
  // still reflect the whole category.
  const PAGE_SIZE = 48
  const where = { categoryId: cat.id, verified: true, status: 'active' as const }
  /**
   * ⚠️ SCOPED COPIES, NOT A MUTATED `where`. The district query below SPREADS this same const, and
   * spreading an exclusion fragment beside other keys is exactly the collision trap
   * edition-scope.ts exists to prevent. Hoisted out of the Promise.all so the grid and the district
   * facet are built from predicates that cannot disagree.
   */
  const scopedWhere = await scopedListingWhere(where)
  const scopedDistrictWhere = await scopedListingWhere({ ...where, district: { not: null } })
  const [raw, otherCats, districtRows] = await Promise.all([
    db.listing.findMany({
      where: scopedWhere,
      // Card projection: this page only renders <ListingCard> slots — the full row
      // (description, attributes, searchText, whole Seller) tripled the ISR payload.
      select: LISTING_CARD_SELECT,
      orderBy: [{ rankScore: 'desc' }, { id: 'desc' }], // balanced blend — matches /api/listings so the explorer doesn't reshuffle on hydrate
      take: PAGE_SIZE,
    }),
    db.category.findMany({ where: { NOT: { id: cat.id } }, orderBy: { name: 'asc' } }),
    db.listing.findMany({ where: scopedDistrictWhere, select: { district: true }, distinct: ['district'], take: 80 }),
  ])
  const listings = await localizeListingTitles(raw.map(serializeListingCard))
  const districts = [...new Set(districtRows.map((r) => r.district).filter((d): d is string => !!d))]
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
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        <Breadcrumb className="mb-4">
          <BreadcrumbList>
            <BreadcrumbItem>
              {/* Base UI render prop (never asChild) — keeps the Next.js client-side nav. */}
              <BreadcrumbLink render={<Link href="/" />} className="hover:text-accent-foreground"><Tr text="Home" /></BreadcrumbLink>
            </BreadcrumbItem>
            {/* Literal "/" separator, and the colour stays pinned to --line-strong: the
                primitive's default is a chevron in text-muted-foreground. */}
            <BreadcrumbSeparator className="text-line-strong">/</BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbPage className="font-medium"><Tr text={cat.name} /></BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <h1 className="h-display text-foreground"><Tr text={cat.name} /> <Tr text="in Vietnam" /></h1>
        {/* Measured lede — max-w-prose (65ch) keeps the reading measure inside the craft floor's
            65–75ch band; max-w-2xl ran ~80ch at text-base. */}
        <p className="mt-3 max-w-prose text-base leading-relaxed text-body">
          <Tr text="Every" /> <Tr text={cat.name.toLowerCase()} /> <Tr text="listing on eno.vn comes from a seller with a public trust score, and bad listings get reported — fewer fakes, fewer bait prices." />
          {/* "0 listings available." read broken on empty categories — only count when there ARE listings. */}
          {total > 0 && <> {total} {total === 1 ? <Tr text="listing" /> : <Tr text="listings" />} <Tr text="available." /></>}
        </p>

        {districts.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2">
            <span className="self-center text-xs font-semibold text-ink-4"><Tr text="By area:" /></span>
            {districts.map((d) => (
              <Badge key={d} size="md" interactive render={<Link href={`/c/${cat.slug}/${slugify(d)}`} />} className="px-3.5 py-1.5 font-semibold text-body hover:bg-accent hover:text-accent-foreground">
                <Tr text={d} />
              </Badge>
            ))}
          </div>
        )}

        {/* Masthead boundary — full-bleed to the page frame's px-3/6/8 (the same negative-margin
            coupling the sort strip below uses), so the two hairlines framing the toolbar align. */}
        <div aria-hidden className="mt-8 -mx-3 border-t border-border sm:-mx-6 lg:-mx-8" />

        {listings.length > 0 ? (
          <>
            <div className="mt-6">
              {/* sr-only h2: the card titles below are h3s, and without this the outline
                  jumps h1 → h3 (detector-confirmed skip; same fix as the home feed header). */}
              <h2 className="sr-only"><Tr text="Listings" /></h2>
              {/* A sort strip over a single card reads absurd — the tablist earns its row
                  only once there is something to reorder. */}
              <SellerListings listings={listings} sortable={listings.length > 1} />
            </div>
            <div className="mt-8">
              {/* Real ArrowRight at h-4, not a literal '→' — the SEO-landing CTAs already
                  use the lucide arrow, and one page family should speak one arrow language.
                  gap-1.5 on the BUTTON (asChild concatenates the child's className). */}
              <Button asChild variant="cta" size="none" className="gap-1.5">
                <Link href={`/?category=${cat.slug}`} className="px-5 py-2.5">
                  <Tr text="Refine in full search" /> <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
            <section className="mt-12 border-t border-border pt-8">
              <h2 className="h-section text-foreground"><Tr text="Other categories" /></h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {otherCats.map((c) => (
                  <Badge key={c.slug} size="md" interactive render={<Link href={`/c/${c.slug}`} />} className="px-3.5 py-1.5 font-semibold text-body hover:bg-accent hover:text-accent-foreground">
                    <Tr text={c.name} />
                  </Badge>
                ))}
              </div>
            </section>
          </>
        ) : (
          /* Supply-side zero state: the visitor most likely to land on an empty category is
             someone with that item to SELL — convert them instead of dead-ending. The sibling
             chips live INSIDE this state (not in a separate tail section) so the empty page has
             exactly one recovery surface — and they stay real <a> links, which the noindex/
             follow:true decision in generateMetadata depends on. */
          <EmptyState
            tone="bare"
            size="lg"
            media={<Mascot name="search" className="h-40 w-40" />}
            title={<Tr text="No listings here yet — be the first to post one." />}
            subtitle={<Tr text="Your listing goes live in minutes and reaches buyers across Vietnam." />}
            action={
              <div className="flex max-w-2xl flex-col items-center gap-6">
                <div className="flex flex-col items-center gap-3">
                  <Button asChild variant="cta" size="none">
                    <Link href="/post" className="px-5 py-2.5">
                      <Tr text="Post a listing" />
                    </Link>
                  </Button>
                  {/* The anchor names what the LINK does (browse) and only promises the alert as
                      a step there — same honest-anchor rule as the SEO landings. */}
                  <Link href={`/?category=${cat.slug}`} className="text-sm font-semibold text-accent-foreground hover:underline">
                    <Tr text="Or browse the category — you can set an alert there" />
                  </Link>
                </div>
                {otherCats.length > 0 && (
                  <div className="flex flex-col items-center gap-3">
                    <span className="text-xs font-semibold text-ink-4"><Tr text="Explore other categories" /></span>
                    <div className="flex flex-wrap justify-center gap-2">
                      {otherCats.map((c) => (
                        <Badge key={c.slug} size="md" interactive render={<Link href={`/c/${c.slug}`} />} className="px-3.5 py-1.5 font-semibold text-body hover:bg-accent hover:text-accent-foreground">
                          <Tr text={c.name} />
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            }
          />
        )}
      </main>
      <Footer />
    </div>
  )
}
