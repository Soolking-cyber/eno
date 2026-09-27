import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import { CategoryLede } from '@/components/marketplace/category-lede'
import { scopedListingWhere } from '@/lib/edition-scope'
import { loadCategory } from '../load-category'
import { loadDistrictChips, loadLinkedCount, loadRentalsFacts } from '../category-data'
import { categoryMetadata, linkedTier, pageLang, rentalsMetadata } from '../category-copy'
import { CategoryGuides, PlaceName, RentIndexLink, RentalsDistricts, RentalsHeading, RentalsLede } from '../category-text'
import { guidesForCategory } from '@/lib/category-guides'
import { db } from '@/lib/db'
import { serializeListingCard, LISTING_CARD_SELECT } from '@/lib/serialize'
import { localizeListingTitles } from '@/lib/translate'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from '@/components/ui/icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Mascot } from '@/components/marketplace/mascot'
import { SellerListings } from '@/components/marketplace/seller-listings'
import { RentalCheckHint } from '@/components/marketplace/rental-check-toggle'
import { Tr } from '@/context/language-context'

export const revalidate = 21600 // 6h — client fetches live listings; ISR HTML is first-paint+SEO only

type Props = { params: Promise<{ lang: string; category: string }> }

/** "By area" chips on the category page — every canonical place, busiest first. */
const DISTRICT_CHIPS = 80

/**
 * ⛔ THIS PAGE LIVES IN THE `(index)` ROUTE GROUP, WITH ITS `loading.tsx`, SO THAT THE SKELETON DOES
 * NOT WRAP `[district]`. A `loading.tsx` wraps its own segment's page AND every child segment in a
 * Suspense boundary; at `c/[category]/loading.tsx` it sat above `/c/<cat>/<district>`, so every
 * `notFound()` there went out as 200 + noindex (live 2026-09-27: /c/rentals/thao-dien, /tay-ho,
 * /phu-my-hung, /district-2, /thanh-pho-thu-duc) and a 308 could never have been a 308. The group
 * changes no URL; this page keeps its skeleton; `[district]` now renders with no boundary above it,
 * so its 404 and 308 set the real status (guarded by district-status-contract.test.ts).
 * ⚠️ THE GROUP IS IN THIS PAGE'S CACHE TAG (`_N_T_/[lang]/c/[category]/(index)/page`). Nothing purges
 * it by pattern today; if something ever does, purge `'/c/[category]', 'layout'` — see the (pdp) note
 * in listings/[id]/(pdp)/layout.tsx for the same trap.
 */

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
// The loader moved to ../load-category so `../layout.tsx` shares the same cache() memo — see there.

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, category } = await params
  const loaded = await loadCategory(category)
  // ⚠️ THIS *IS* A REAL 404 AGAIN, SINCE 2026-09-07 — and this comment has now been wrong in both
  // directions, so trust the code and the test, not the prose. It first claimed a real 404 when the
  // status was 200; it was then corrected to say the soft-404 was unavoidable and should be left
  // alone, because "every alternative fix regressed something real (deleting loading.tsx trades a
  // verified CLS of 0 for a status byte; force-dynamic reimposes a Singapore DB hit on every view)".
  // Both of those judgements were right. The diagnosis underneath them was not: the trigger is this
  // segment's `loading.tsx`, not Next 15.2+ metadata streaming — proven by moving the file out of
  // the tree and rebuilding (404), then putting it back (200). A loading boundary makes Next flush
  // the shell, status included, before this notFound() is reached.
  // The fix is `../layout.tsx`: App Router nests layout → loading → page, so a guard in the layout
  // runs above this segment's boundary while the status can still be set, and loading.tsx is left
  // untouched. Neither the CLS nor the ISR trade-off is taken. This notFound() stays as the
  // defence-in-depth copy — it is what still runs if the layout is ever removed.
  if (!loaded) notFound()
  const { cat, live } = loaded
  const hostUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'
  /**
   * ⛔ RENTALS SAYS WHAT ITS STOCK IS, FROM THE STOCK. It was "Rentals in Vietnam — Trusted listings"
   * over 25,502 rentals that were all in Ho Chi Minh City and all linked from other portals — no
   * page answered "apartments for rent in Ho Chi Minh City" (~720 searches/month) while this one
   * held the inventory for it. category-copy.ts words it from live counts; every other category
   * keeps the generic copy (categoryMetadata) — with its "Trusted" claim only while nothing is linked.
   */
  const rentals = cat.slug === 'rentals' && live > 0 ? rentalsMetadata(await loadRentalsFacts(cat.id, live), pageLang(lang), SITE_NAME) : null
  // Every other category keeps its old wording only while none of its stock is linked (category-copy.ts).
  const { title, description } = rentals ?? categoryMetadata(cat, live > 0 ? linkedTier(await loadLinkedCount(cat.id), live) : 'none', SITE_NAME)
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
  const { lang, category } = await params
  // Same cached loader generateMetadata used, so within this request the category lookup and the
  // live count are each done once — `total` below IS the number the robots decision was made on,
  // which is what stops the page claiming a count its own indexing directive disagrees with.
  const loaded = await loadCategory(category)
  if (!loaded) notFound()
  const { cat, live: total } = loaded

  // Cap the landing to a page of listings (was unbounded — fetched the entire
  // category each ISR render). Independent queries run in parallel; the
  // districts come from a light separate aggregate so the "by area" chips
  // still reflect the whole category.
  const PAGE_SIZE = 48
  /**
   * ⚠️ THE SAME PREDICATE AS load-category.ts AND category-data.ts (verified, active, this category),
   * each scoped on its own rather than one mutated `where` spread with extra keys — spreading an
   * exclusion fragment beside other keys is the collision trap edition-scope.ts exists to prevent.
   */
  const scopedWhere = await scopedListingWhere({ categoryId: cat.id, verified: true, status: 'active' })
  const [raw, otherCats, chips, rentals, linkedCount] = await Promise.all([
    db.listing.findMany({
      where: scopedWhere,
      // Card projection: this page only renders <ListingCard> slots — the full row
      // (description, attributes, searchText, whole Seller) tripled the ISR payload.
      select: LISTING_CARD_SELECT,
      orderBy: [{ rankScore: 'desc' }, { id: 'desc' }], // balanced blend — matches /api/listings so the explorer doesn't reshuffle on hydrate
      take: PAGE_SIZE,
    }),
    db.category.findMany({ where: { NOT: { id: cat.id } }, orderBy: { name: 'asc' } }),
    // ⚠️ CANONICAL CHIPS (category-data.ts): one per place, linking the one URL that place has — the
    // stored spellings (`quan-2`, `huyen-cu-chi`) now 308 there instead of standing beside it.
    loadDistrictChips(cat.id),
    // The same cached call generateMetadata made — one set of counts per render.
    cat.slug === 'rentals' && total > 0 ? loadRentalsFacts(cat.id, total) : null,
    // The same cached count generateMetadata read: it decides whether CategoryLede keeps its trust claim.
    cat.slug !== 'rentals' && total > 0 ? loadLinkedCount(cat.id) : 0,
  ])
  const listings = await localizeListingTitles(raw.map(serializeListingCard))
  const districts = chips.slice(0, DISTRICT_CHIPS)
  // Registry-driven (src/lib/category-guides.ts) and only over real stock: a guide rail under an
  // empty category is a signpost to nothing, which is why it lives in the non-empty branch below.
  // ⚠️ MARKETPLACE ONLY: on eno.forum these links would promote its self-canonical COPIES of eno.vn's
  // guides before the owner decides the cross-host canonicals — /llms.txt and the footer omit them there.
  const guides = total > 0 && !IS_SERVICES ? guidesForCategory(cat.slug, pageLang(lang)) : []
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

        <h1 className="h-display text-foreground">
          {rentals ? <RentalsHeading allHcmc={rentals.allHcmc} kinds={rentals.kinds} /> : <><Tr text={cat.name} /> <Tr text="in Vietnam" /></>}
        </h1>
        {/* Measured lede — max-w-prose (65ch) keeps the reading measure inside the craft floor's
            65–75ch band; max-w-2xl ran ~80ch at text-base.
            ⚠️ Rentals replaces CategoryLede, whose "every listing comes from a seller with a public
            trust score" is not true of stock linked from other portals; every other category passes
            its linked tier, and CategoryLede keeps that sentence only where the tier is 'none'. */}
        <p className="mt-3 max-w-prose text-base leading-relaxed text-body">
          {rentals ? (
            <RentalsLede total={rentals.total} allHcmc={rentals.allHcmc} kinds={rentals.kinds} linked={rentals.linked} />
          ) : (
            <>
              <CategoryLede name={cat.name} nameVi={cat.nameVi} slug={cat.slug} linked={linkedTier(linkedCount, total)} />
              {/* "0 listings available." read broken on empty categories — only count when there ARE listings. */}
              {total > 0 && <> {total} {total === 1 ? <Tr text="listing" /> : <Tr text="listings" />} <Tr text="available." /></>}
            </>
          )}
        </p>
        {/* The availability check is invisible until something says it exists — one line, rentals only. */}
        {cat.slug === 'rentals' && <RentalCheckHint className="mt-2 max-w-prose" />}
        {cat.slug === 'rentals' && <RentIndexLink />}

        {districts.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2">
            <span className="self-center text-xs font-semibold text-ink-4"><Tr text="By area:" /></span>
            {districts.map((d) => (
              <Badge key={d.slug} size="md" interactive render={<Link href={`/c/${cat.slug}/${d.slug}`} />} className="px-3.5 py-1.5 font-semibold text-body hover:bg-accent hover:text-accent-foreground">
                {/* English place names on English pages ("District 2", not "Quận 2"). */}
                <PlaceName en={d.label.en} vi={d.label.vi} />
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
              {/* ⛔ A SORT LEAVES THIS PAGE. These are the top 48 by relevance of a category that may
                  hold thousands; sorting them in memory (the previous behaviour) reordered the same
                  48 ids and could never surface a cheaper or newer item outside the window. Each
                  sort is a LINK into the explorer's full, paginated query for this category with
                  the sort in the URL (`sortBase` is a string: this is a Server → Client boundary),
                  and the strip says what the 48 are. `sortable` keys off `total`, not the preview:
                  one card shown of two hundred still needs the links to reach the other 199. */}
              <SellerListings
                listings={listings}
                sortable={total > 1}
                sortBase={`/?category=${encodeURIComponent(cat.slug)}`}
                scope={{ shown: listings.length, total }}
              />
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
            {rentals && <RentalsDistricts allHcmc={rentals.allHcmc} top={rentals.top} />}
            <CategoryGuides guides={guides} />
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
