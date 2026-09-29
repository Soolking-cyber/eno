import { SITE_NAME } from '@/lib/edition'
import { scopedListingWhere } from '@/lib/edition-scope'
import { PLACES_KIND_PARAM, RENTAL_PLACES } from '@/lib/rental-places'
import { cache } from 'react'
import { db } from '@/lib/db'
import { serializeListingCard, LISTING_CARD_SELECT } from '@/lib/serialize'
import { localizeListingTitles } from '@/lib/translate'
import { districtScopeForSlug } from '@/lib/district-slug'
import { canonicalDistrictSlug, districtLabel, isCuratedDistrict, mergeDistrictGroups } from '@/lib/district-canonical'
import { MIN_INDEXABLE_LISTINGS, isIndexableCount } from '@/lib/index-floor'
import { staleBelowFloor } from '@/lib/stale-noindex'
import { districtMetadata, linkedTier, pageLang } from '../category-copy'
import { DistrictHeading, DistrictLede, PlaceName, RentIndexLink } from '../category-text'
import { notFound, permanentRedirect } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { SellerListings } from '@/components/marketplace/seller-listings'
import { Bilingual } from '@/components/marketplace/bilingual'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Tr } from '@/context/language-context'

/**
 * 1 day. It was 7 days ("long-tail combo, client fetches live, weekly regen is plenty") until the page's
 * ROBOTS tag started to depend on its count (SEO wave B, I1): a district that crosses the indexing
 * floor (src/lib/index-floor.ts) in either direction must say so within the sitemap's own daily
 * revalidate, not a week after the sitemap has started or stopped submitting it.
 */
export const revalidate = 86400

type Props = { params: Promise<{ lang: string; category: string; district: string }> }

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
  /**
   * ⛔ FOR RENTALS, PLACES ONLY (src/lib/rental-places.ts) — the lede says "N places for rent … every
   * one links to its original listing on a partner property portal", which is untrue of a Mioto car.
   * The same clause rides every sort and Show-more as `kind=places` (feed-query.ts), so the feed's
   * predicate and this page's stay the same set.
   */
  const placesOnly = categorySlug === 'rentals'
  const base = await scopedListingWhere(placesOnly
    ? { AND: [{ categoryId: cat.id, verified: true, status: 'active' }, RENTAL_PLACES] }
    : { categoryId: cat.id, verified: true, status: 'active' })
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
  const [groups, linked, noindex] = await Promise.all([
    // Sibling chips come from one aggregate over the whole category.
    db.listing.groupBy({
      by: ['district'],
      // ⚠️ THIS one keeps the null exclusion: a chip needs a district name to be a chip.
      where: { AND: [base, { NOT: { district: null } }] },
      _count: { _all: true },
      orderBy: { _count: { district: 'desc' } },
    }),
    /**
     * ⚠️ HOW MUCH OF THIS SCOPE IS LINKED FROM ANOTHER PORTAL — it decides whether the page may keep
     * its "each from a seller with a public trust score" sentence (category-copy.ts). Every rental in
     * the 2026-09-27 supply sample (1,510 listings across categories) was an import, and a trust
     * score says nothing about a listing copied from another portal.
     */
    // edition-lint-allow: `where` is `{ AND: [base, scope] }`, base = scopedListingWhere(...) above.
    db.listing.count({ where: { AND: [where, { affiliateUrl: { not: null } }] } }),
    /**
     * ⛔ `noindex` ONLY AFTER 14 DAYS UNDER THE FLOOR (SEO wave B, I1b; decision I-g;
     * src/lib/stale-noindex.ts). The scope is this page's without its liveness clause — the same
     * category, places-only on rentals, the same place — so a listing that left inside the window
     * is counted toward what the page may have held. At or over the floor it runs no query.
     */
    staleBelowFloor({
      where: { AND: [placesOnly ? { AND: [{ categoryId: cat.id }, RENTAL_PLACES] } : { categoryId: cat.id }, scope] },
      live: total,
      floor: MIN_INDEXABLE_LISTINGS,
    }),
  ])
  /**
   * ⚠️ MERGED BY CANONICAL SLUG (district-canonical.ts). Two stored spellings of one place ("Quận Củ
   * Chi" / "Huyện Củ Chi", "Thao Dien" / "Thảo Điền") are two rows in the aggregate but ONE
   * destination; this used to dedupe by `slugify(name)`, which still drew both Củ Chi chips and
   * linked every numbered district as `quan-N` beside its curated `dN`.
   */
  const districts = mergeDistrictGroups(groups.map((g) => ({ district: g.district, count: g._count._all })))
  // A curated place is named from DISTRICTS; anything else from a stored spelling in scope.
  const place = districtLabel(districtSlug, rows.find((r) => r.district)?.district ?? null)
  return { cat, matched: rows, total, linked: linkedTier(linked, total), place, inHcmc: isCuratedDistrict(districtSlug), districts, noindex }
})

/**
 * THE ONE URL THIS PLACE LIVES AT, OR NO PAGE AT ALL — resolved before anything renders.
 *
 * ⛔ ONE PLACE HAD TWO OR THREE LIVE URLS. `/c/rentals/quan-2` and `/c/rentals/d2` both answered 200,
 * self-canonical, with the same 3,741 listings; "Huyện Củ Chi" and "Quận Củ Chi" split one district
 * into two pages; `/c/rentals/thao-dien`, `/phu-my-hung`, `/district-2` and `/thanh-pho-thu-duc`
 * answered 200 + "Page not found" (measured 2026-09-27). Now the request is mapped to its canonical
 * slug (district-canonical.ts); that slug's scope is counted IN THIS CATEGORY; empty is a real 404,
 * and a twin that is not the canonical spelling is a 308 to it.
 *
 * ⚠️ THE COUNT HAPPENS BEFORE THE REDIRECT, on the canonical scope, so a 308 never lands on a 404:
 * `/c/electronics/thao-dien` would map to `thu-duc`, which holds no electronics, so it 404s here
 * instead of redirecting to an empty page. The canonical scope contains every row the old spelling
 * showed (pinned per alias in district-canonical.test.ts), so a non-empty source always redirects.
 *
 * ⚠️ BOTH ANSWERS ARE REAL STATUSES ONLY BECAUSE NO `loading.tsx` SITS ABOVE THIS SEGMENT — the
 * category skeleton lives in `../(index)/`. Guarded by district-status-contract.test.ts.
 *
 * ⚠️ THE QUERY STRING IS DROPPED ON THE 308. Reading `searchParams` would opt this ISR page into
 * per-request rendering; a twin URL carrying one is not worth that.
 */
async function resolve(params: Props['params']) {
  const { lang, category, district } = await params
  let raw = district
  try {
    raw = decodeURIComponent(district)
  } catch {
    // A malformed escape is not a place; canonicalDistrictSlug slugifies what arrived.
  }
  const canonical = canonicalDistrictSlug(raw)
  const data = canonical ? await load(category, canonical) : null
  // Real 404 (not soft-404) for an unknown category/district — before streaming.
  if (!data) notFound()
  if (canonical !== district) permanentRedirect(`/c/${data.cat.slug}/${canonical}`)
  return { lang: pageLang(lang), district: canonical, data }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, district, data } = await resolve(params)
  const hostUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'
  // ⚠️ "— Trusted" IS GONE from the title: over linked stock it was a claim the page cannot make.
  const { title, description } = districtMetadata(
    { category: { slug: data.cat.slug, name: data.cat.name, nameVi: data.cat.nameVi }, place: data.place, inHcmc: data.inHcmc, total: data.total, linked: data.linked },
    lang,
    SITE_NAME,
  )
  return {
    title,
    description,
    alternates: { canonical: `${hostUrl}/c/${data.cat.slug}/${district}` },
    /**
     * ⛔ BELOW THE FLOOR, `noindex, follow` (SEO wave B, I1; src/lib/index-floor.ts). A district page of
     * one to nine cards is thin — `/c/rentals/can-gio` held one rental — and it answered 200 with no
     * robots directive at all. `data.total` is the page's full count (imports included, places only on
     * rentals), the number its own lede prints. `follow` keeps its cards and chips crawlable. No
     * chip, sibling chip or rent-index row links a page under the floor, so it is reachable only by
     * its URL.
     * ⛔ AND ONLY ONCE IT HAS BEEN UNDER THE FLOOR FOR 14 DAYS (I1b, decision I-g): `data.noindex`,
     * computed in load(). A dip of days stays indexable, unlinked and unsubmitted.
     */
    ...(data.noindex ? { robots: { index: false, follow: true } } : {}),
    // Mirror the page's own title/description/canonical into OG — without this the
    // page inherits the generic homepage OG tags in link unfurls.
    openGraph: { title, description, url: `${hostUrl}/c/${data.cat.slug}/${district}` },
  }
}

export default async function CategoryDistrictPage({ params }: Props) {
  const { lang, district, data } = await resolve(params)
  const { cat, matched, total, linked, place, districts } = data
  // ⚠️ ONLY SIBLINGS AT THE FLOOR (src/lib/index-floor.ts): a chip to a `noindex` page is a followed
  // link to a page we asked Google to drop. The count is the stored-name tally (district-canonical.ts),
  // and the linked page's scope matches every spelling it merges — except one that differs from a
  // curated spelling only in case or diacritics ("Quan 1"), which district-match.ts's exact LIKE
  // misses. So a chip that passes lands on a page that passes unless such rows make the difference.
  const otherDistricts = districts.filter((d) => d.slug !== district && isIndexableCount(d.count)).slice(0, SIBLING_DISTRICTS)
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
          { '@type': 'ListItem', position: 3, name: place[lang], item: `${hostUrl}/c/${cat.slug}/${district}` },
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
              <BreadcrumbLink render={<Link href={`/c/${cat.slug}`} />} className="hover:text-accent-foreground"><Bilingual en={cat.name} vi={cat.nameVi || cat.name} /></BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="text-line-strong">/</BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbPage className="font-medium"><PlaceName en={place.en} vi={place.vi} /></BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* English place names on English pages: "Rentals in District 2", never "Rentals in Quận 2". */}
        <h1 className="h-display text-foreground"><DistrictHeading name={cat.name} nameVi={cat.nameVi} place={place} /></h1>
        {/* Measured lede — 65ch, same as the category page. */}
        <p className="mt-3 max-w-prose text-base leading-relaxed text-body">
          {/* ⚠️ THE SCOPE'S TRUE COUNT, NOT THE PAGE'S. This read `listings.length` — the survivors of
              a 600-row window — and announced them as the district's inventory. */}
          <DistrictLede total={total} name={cat.name} nameVi={cat.nameVi} categorySlug={cat.slug} place={place} linked={linked} />
        </p>
        {/* Only for an HCMC district: the index covers Ho Chi Minh City and nothing else. */}
        {cat.slug === 'rentals' && data.inHcmc && <RentIndexLink />}

        {otherDistricts.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2">
            <span className="self-center text-xs font-semibold text-ink-4"><Tr text="By area:" /></span>
            {otherDistricts.map((d) => (
              <Badge key={d.slug} size="md" interactive render={<Link href={`/c/${cat.slug}/${d.slug}`} />} className="px-3.5 py-1.5 font-semibold text-body hover:bg-accent hover:text-accent-foreground">
                <PlaceName en={d.label.en} vi={d.label.vi} />
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
            serverScope={{
              params: { category: cat.slug, district, ...(cat.slug === 'rentals' ? { [PLACES_KIND_PARAM.key]: PLACES_KIND_PARAM.value } : {}) },
              total, pageSize: DISTRICT_PAGE_SIZE,
            }}
          />
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild variant="outline" size="none" className="border-line-strong font-bold hover:bg-muted hover:text-foreground">
            <Link href={`/c/${cat.slug}`} className="px-5 py-2.5 text-sm">
              ← <Tr text="All" /> <Bilingual en={cat.name} vi={cat.nameVi || cat.name} />
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
