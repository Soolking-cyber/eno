import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import { loadRentIndex, type RentIndexLookup } from '../../../hcmc-rent-index/load-rent-index'
import { publishableCells, type RentCell } from '@/lib/district-rent-cells'
import { rentIndexRetrySoon } from '@/lib/rent-index-retry'
import { formatCalendarDay } from '@/lib/calendar-day'
import { DistrictRent } from './district-rent'
import { scopedListingWhere } from '@/lib/edition-scope'
import { PLACES_KIND_PARAM, RENTAL_PLACES } from '@/lib/rental-places'
import { HOME_RENTAL_SUBCATS, HOMES_ONLY_PARAM } from '@/lib/rental-homes'
// `{ teachers: true }` on every read here: each one is pinned to ONE categoryId, so the default
// teacher exclusion (scopedListingWhere) can only ever empty /c/teachers — it hides nothing elsewhere.
import { cache } from 'react'
import { db } from '@/lib/db'
import { serializeListingCard, LISTING_CARD_SELECT } from '@/lib/serialize'
import { diverseFeedWindow } from '@/lib/feed-window'
import { diversifyBySeller, sharedSeatsFor } from '@/lib/feed-diversity'
import { localizeListingTitles } from '@/lib/translate'
import { districtScopeForSlug } from '@/lib/district-slug'
import { canonicalDistrictSlug, districtLabel, isCuratedDistrict, mergeDistrictGroups } from '@/lib/district-canonical'
import { MIN_INDEXABLE_LISTINGS, isIndexableCount } from '@/lib/index-floor'
import { staleBelowFloor } from '@/lib/stale-noindex'
import { localizedHref } from '@/lib/lang-pinned'
import { crumbNames, districtMetadata, districtRentalsHeadline, homeFacts, linkedTier, listsHomesOnly, pageLang, rentalsPlaceLabel } from '../category-copy'
import { DistrictHeading, DistrictLede, OtherRentalsLink, PlaceName, RentalsDistrictHeading, RentIndexLink } from '../category-text'
import { RentalCheckHint } from '@/components/marketplace/rental-check-toggle'
import { notFound, permanentRedirect } from 'next/navigation'
import type { Metadata } from 'next'
import { pageShare } from '@/lib/site-identity'
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
    : { categoryId: cat.id, verified: true, status: 'active' }, { teachers: true })
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
  /**
   * ⛔ ONE GROUP BY ON SUBCATEGORY, NOT A COUNT (SEO wave B, D1). Every live row falls in exactly one
   * group, the null one included, so `total` — the sum — is the count this replaced: EVERY rental in
   * scope (places only). I1's robots floor and the stale-noindex window read it, and the sibling
   * chips stay a subset of it (order rule 3). The groups also give the homes (apartments, houses,
   * rooms — HOME_RENTAL_SUBCATS) and the office count the "Also here" link names.
   */
  // edition-lint-allow: `base` IS `await scopedListingWhere(..., { teachers: true })` above, and every read on
  // this page composes it — the desk exclusion cannot be lost by an AND. The rule counts guard
  // MENTIONS against reads, so one scoped predicate feeding three reads reads as two unguarded.
  const bySubGroups = await db.listing.groupBy({ by: ['subcategorySlug'], where, _count: { _all: true } })
  const total = bySubGroups.reduce((n, g) => n + g._count._all, 0)
  if (total === 0) return null
  const bySub = Object.fromEntries(bySubGroups.map((g) => [g.subcategorySlug ?? '', g._count._all]))
  /**
   * ⛔ WHILE A RENTALS PAGE HAS HOMES, IT LISTS ONLY HOMES (D1; decisions D-a, D-b). Offices and
   * shopfronts were among the first cards and the first ItemList entries of pages titled for people
   * looking for somewhere to live; they move behind the `nofollow` "Also here" link. With no home in
   * scope the page lists every rental, as before. The grid, the ItemList and Show-more (`homes=1`,
   * feed-query.ts) all read this one `listed` scope.
   */
  const homes = placesOnly ? homeFacts(bySub) : null
  // …unless the homes alone are under the floor on an indexable page (listsHomesOnly, category-copy.ts).
  const homesOnly = listsHomesOnly(homes, total, MIN_INDEXABLE_LISTINGS)
  const listed = homesOnly ? { AND: [where, { subcategorySlug: { in: [...HOME_RENTAL_SUBCATS] } }] } : where
  /**
   * ⛔ PAGE 1 IS THE API'S OWN offset 0, NOT A PLAIN RANK ORDER. Show-more sends sort=newest, and
   * under that sort /api/listings serves `diverseFeedWindow` + `diversifyBySeller` (route.ts), not
   * `rankScore desc` — this said the two were equal, and they were not: the first Show-more continued
   * a different sequence, so rows repeated (deduped away) and rows never appeared. Same window, same
   * seat rule as the API reads it for `?category=&district=`, reorder THEN slice. Card projection:
   * the page renders <ListingCard> slots only. The window re-scopes `where` itself (feed-window.ts).
   */
  const sharedSeats = sharedSeatsFor(null, categorySlug)
  const head = await diverseFeedWindow(listed, [{ rankScore: 'desc' }, { id: 'desc' }], LISTING_CARD_SELECT, { sharedSeats })
  const rows = diversifyBySeller(head, { sharedSeats }).slice(0, DISTRICT_PAGE_SIZE)
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
    // edition-lint-allow: `where` is `{ AND: [base, scope] }`, base = scopedListingWhere(..., { teachers: true }) above.
    // By subcategory, so the homes' own tier comes from the same read (the homes lede speaks of them).
    db.listing.groupBy({ by: ['subcategorySlug'], where: { AND: [where, { affiliateUrl: { not: null } }] }, _count: { _all: true } }),
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
  const linkedAll = linked.reduce((n, g) => n + g._count._all, 0)
  const linkedHomes = linked.reduce((n, g) => n + ((HOME_RENTAL_SUBCATS as readonly (string | null)[]).includes(g.subcategorySlug) ? g._count._all : 0), 0)
  return {
    cat, matched: rows, total, linked: linkedTier(linkedAll, total), place, inHcmc: isCuratedDistrict(districtSlug), districts, noindex,
    homes: homesOnly ? homes : null,
    homesLinked: homesOnly ? linkedTier(linkedHomes, homes!.total) : ('none' as const),
    /**
     * ⚠️ THE TITLE, H1 AND DESCRIPTION NAME A RENTALS PLACE IN SEARCHERS' WORDS (D-d:
     * RENTALS_PLACE_LABEL — "District 2 (Thao Dien)", "District 9"); the breadcrumb, chips and
     * JSON-LD keep `place`, the DISTRICTS label.
     */
    searchPlace: placesOnly ? rentalsPlaceLabel(districtSlug, place) : place,
  }
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
 * `/c/electronics/thao-dien` would map to `d2`, which holds no electronics, so it 404s here
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
    {
      category: { slug: data.cat.slug, name: data.cat.name, nameVi: data.cat.nameVi }, place: data.searchPlace, inHcmc: data.inHcmc,
      total: data.total, linked: data.linked, homes: data.homes, homesLinked: data.homesLinked,
    },
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
    ...pageShare({ title, description, url: `${hostUrl}/c/${data.cat.slug}/${district}` }),
  }
}

/** How long the page body waits for the rent index before rendering the plain link instead (D2). */
const RENT_INDEX_WAIT_MS = 10_000

/**
 * THE RENT BLOCK'S DATA, OR NULL FOR THE PLAIN LINK (SEO wave B, D2) — rentals, in HCMC, on the
 * marketplace only (the index is eno.vn's and HCMC's).
 * ⛔ NEVER THROWS, AND A MISS RETRIES IN MINUTES. The snapshot is raced against 10 s; the loader keeps
 * running and fills the shared cache (its single-flight is per bundle). When the snapshot is not
 * known or the race is lost, `rentIndexRetrySoon()` lowers this ISR render's revalidate to 300 s, so
 * the fallback lasts minutes, not the page's day. A district row with no publishable cell simply has
 * no block — that is not a failure, so it keeps the day.
 * The date is the snapshot's, formatted here in Ho Chi Minh City time, so the client block has no clock.
 */
async function districtRent(slug: string): Promise<{ cells: RentCell[]; asOf: { en: string; vi: string } } | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), RENT_INDEX_WAIT_MS) })
  // loadRentIndex() already turns a failed read into `known: false`; the catch is the second belt
  // (review): nothing on this path may turn a rentals page into an error page.
  const lookup: RentIndexLookup | null = await Promise.race([loadRentIndex(), timeout]).catch(() => null)
  clearTimeout(timer)
  if (!lookup || !lookup.known) {
    await rentIndexRetrySoon().catch(() => {})
    return null
  }
  const row = lookup.index.districts.find((d) => d.slug === slug)
  const cells = row ? publishableCells(row) : []
  if (cells.length === 0) return null
  const at = lookup.index.computedAt
  return { cells, asOf: { en: formatCalendarDay(at, 'en'), vi: formatCalendarDay(at, 'vi') } }
}

export default async function CategoryDistrictPage({ params }: Props) {
  const { lang, district, data } = await resolve(params)
  const { cat, matched, total, linked, place, districts, homes, homesLinked, searchPlace } = data
  const rentals = cat.slug === 'rentals'
  const headline = rentals ? districtRentalsHeadline(homes) : null
  // What the grid lists: homes while there are any (D1), else every rental in scope.
  const listedTotal = homes ? homes.total : total
  // ⚠️ ONLY SIBLINGS AT THE FLOOR (src/lib/index-floor.ts): a chip to a `noindex` page is a followed
  // link to a page we asked Google to drop. The count is the stored-name tally (district-canonical.ts),
  // and the linked page's scope matches every spelling it merges — except one that differs from a
  // curated spelling only in case or diacritics ("Quan 1"), which district-match.ts's exact LIKE
  // misses. So a chip that passes lands on a page that passes unless such rows make the difference.
  const otherDistricts = districts.filter((d) => d.slug !== district && isIndexableCount(d.count)).slice(0, SIBLING_DISTRICTS)
  // The explorer scoped to exactly this page — the API resolves a slugified district name the same
  // way this page does (src/lib/district-slug.ts), so leaving here keeps the district.
  const scopedExplorer = `/?category=${cat.slug}&district=${district}`
  // The rent block (D2): rentals, in HCMC, on the marketplace. Otherwise, or on a miss, the plain link.
  // Started before the title localisation so a cold snapshot read overlaps it (review).
  const rentP = rentals && data.inHcmc && !IS_SERVICES ? districtRent(district) : Promise.resolve(null)
  const listings = await localizeListingTitles(matched.map(serializeListingCard))
  const rent = await rentP
  const hostUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'
  // All three crumb names follow the page's language, equal to the visible crumbs below (V2; the
  // Vietnamese rendering read Home / Rentals / Quận 1).
  const crumbs = crumbNames(cat, lang)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: crumbs.home, item: hostUrl },
          { '@type': 'ListItem', position: 2, name: crumbs.category, item: `${hostUrl}/c/${cat.slug}` },
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
              <BreadcrumbLink render={<Link href={localizedHref('/', lang)} />} className="hover:text-accent-foreground"><Tr text="Home" /></BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="text-line-strong">/</BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href={localizedHref(`/c/${cat.slug}`, lang)} />} className="hover:text-accent-foreground"><Bilingual en={cat.name} vi={cat.nameVi || cat.name} /></BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="text-line-strong">/</BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbPage className="font-medium"><PlaceName en={place.en} vi={place.vi} /></BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* English place names on English pages: "Rentals in District 2", never "Rentals in Quận 2". */}
        <h1 className="h-display text-foreground">
          {headline ? <RentalsDistrictHeading headline={headline} place={searchPlace} /> : <DistrictHeading name={cat.name} nameVi={cat.nameVi} place={searchPlace} />}
        </h1>
        {/* Measured lede — 65ch, same as the category page. */}
        <p className="mt-3 max-w-prose text-base leading-relaxed text-body">
          {/* ⚠️ THE SCOPE'S TRUE COUNT, NOT THE PAGE'S. This read `listings.length` — the survivors of
              a 600-row window — and announced them as the district's inventory. */}
          <DistrictLede
            total={total} name={cat.name} nameVi={cat.nameVi} categorySlug={cat.slug} place={searchPlace} linked={linked}
            homes={homes} homesLinked={homesLinked} slug={district}
            linkable={districts.filter((d) => isIndexableCount(d.count)).map((d) => d.slug)}
          />
        </p>
        {/* ⛔ THE CHECK THE DESCRIPTION PROMISES IS ON THE PAGE (D1, v3): "Pick up to N and eno checks
            availability for free" is in the meta description, so the hint that says how is here, in the
            HTML with JavaScript off — rentals pages only, as on /c/rentals. */}
        {rentals && <RentalCheckHint className="mt-2 max-w-prose" />}
        {/* Only for an HCMC district: the index covers Ho Chi Minh City and nothing else. The block when
            the snapshot has a figure for this district; the plain link otherwise (and on eno.forum,
            where RentIndexLink renders nothing). */}
        {rentals && data.inHcmc && (rent ? <DistrictRent place={place} slug={district} cells={rent.cells} asOf={rent.asOf} /> : <RentIndexLink />)}

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

        {/* Masthead boundary — on the content box, like the sort strip's own border (C1-HAIRLINE). */}
        <div aria-hidden className="mt-8 border-t border-border" />

        <div className="mt-6">
          {/* sr-only h2 — card titles are h3s; without this the outline jumps h1 → h3. */}
          <h2 className="sr-only"><Tr text="Listings" /></h2>
          {/* ⛔ SORT AND LOAD-MORE ARE SCOPED QUERIES. Sorting this page's 48 cards in the browser
              would answer "cheapest in this district" with the cheapest of 48 — and the district is
              carried in `params`, so no interaction can drop it. */}
          <SellerListings
            listings={listings}
            sortable={listedTotal > 1}
            serverScope={{
              params: {
                category: cat.slug, district,
                ...(rentals ? { [PLACES_KIND_PARAM.key]: PLACES_KIND_PARAM.value } : {}),
                // The same homes-only scope as `listed` in load() (D1): page 2 is homes too.
                ...(homes ? { [HOMES_ONLY_PARAM.key]: HOMES_ONLY_PARAM.value } : {}),
              },
              total: listedTotal, pageSize: DISTRICT_PAGE_SIZE,
            }}
          />
        </div>
        {homes && <OtherRentalsLink n={homes.offices} href={`/?category=rentals&district=${district}&subcategory=office-rental`} />}

        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild variant="outline" size="none" className="border-line-strong font-bold hover:bg-muted hover:text-foreground">
            <Link href={localizedHref(`/c/${cat.slug}`, lang)} className="px-5 py-2.5 text-sm">
              ← <Tr text="All" /> <Bilingual en={cat.name} vi={cat.nameVi || cat.name} />
            </Link>
          </Button>
          <Button asChild variant="cta" size="none">
            {/* ⛔ THE DISTRICT USED TO BE DROPPED HERE. This linked to `/?category=<slug>` and the
                reader landed in the whole category, one click after choosing a district. */}
            <Link href={scopedExplorer} rel="nofollow" prefetch={false} className="px-5 py-2.5">
              <Tr text="Refine in full search" /> →
            </Link>
          </Button>
        </div>
      </main>
      <Footer />
    </div>
  )
}
