import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import { scopedListingWhere } from '@/lib/edition-scope'
import { PLACES_KIND_PARAM, RENTAL_PLACES } from '@/lib/rental-places'
import { HOME_RENTAL_SUBCATS, HOMES_ONLY_PARAM } from '@/lib/rental-homes'
// `{ teachers: true }` on every read here: each one is pinned to ONE categoryId, so the default
// teacher exclusion (scopedListingWhere) can only ever empty /c/teachers — it hides nothing elsewhere.
import { loadCategory } from '../load-category'
import { loadDistrictChips, loadLinkedCount, loadRentalsFacts, loadRentalsHeadline } from '../category-data'
import { byAreaChips, categoryMetadata, crumbNames, linkedTier, pageLang, rentalsMetadata } from '../category-copy'
import { CategoryGuides, OtherRentalsLink, PlaceName, RentalsDistricts } from '../category-text'
import { CategoryFiltersLink } from '../category-filters-link'
import { CategoryLedeBlock } from './category-lede-block'
import { LEDE_PLACEMENT } from './lede-placement'
import { guidesForCategory } from '@/lib/category-guides'
import { MIN_CATEGORY_LISTINGS } from '@/lib/index-floor'
import { staleBelowFloor } from '@/lib/stale-noindex'
import { db } from '@/lib/db'
import { diverseFeedWindow } from '@/lib/feed-window'
import { diversifyBySeller, sharedSeatsFor } from '@/lib/feed-diversity'
import { serializeListingCard, LISTING_CARD_SELECT } from '@/lib/serialize'
import { localizeListingTitles } from '@/lib/translate'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { pageShare } from '@/lib/site-identity'
import { langAlternates, localizedHref } from '@/lib/lang-pinned'
import Link from 'next/link'
import { ArrowRight } from '@/components/ui/icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Mascot } from '@/components/marketplace/mascot'
import { SellerListings } from '@/components/marketplace/seller-listings'
import { Bilingual } from '@/components/marketplace/bilingual'
import { Tr } from '@/context/language-context'

export const revalidate = 21600 // 6h — client fetches live listings; ISR HTML is first-paint+SEO only

type Props = { params: Promise<{ lang: string; category: string }> }

/** "By area" chips on the category page — every canonical place at the indexing floor, busiest first. */
const DISTRICT_CHIPS = 80

/**
 * ⛔ THIS PAGE LIVES IN THE `(index)` ROUTE GROUP, WITH ITS `loading.tsx`, SO THAT THE SKELETON DOES
 * NOT WRAP `[district]`. A `loading.tsx` wraps its own segment's page AND every child segment in a
 * Suspense boundary; at `c/[category]/loading.tsx` it sat above `/c/<cat>/<district>`, so every
 * `notFound()` there went out as 200 + noindex (live 2026-09-27: /c/rentals/thao-dien, /tay-ho,
 * /phu-my-hung, /district-2, /thanh-pho-thu-duc) and a 308 could never have been a 308. The group
 * changes no URL; `[district]` renders with no boundary above it, so its 404 and 308 set the real
 * status (guarded by district-status-contract.test.ts).
 *
 * ⛔ EVERYTHING THIS PAGE RETURNS IS UNDER THAT BOUNDARY, SO FOR A CRAWLER IT IS HIDDEN. React moves the
 * finished boundary into `<div hidden id="S:0">` (the rule is in crawler-visible-html-contract.test.ts),
 * which is why the Header, `<main>`, breadcrumb, H1 and Footer moved to `(index)/layout.tsx` (SEO wave B,
 * H1b) and this page returns a fragment inside that `<main>`: the JSON-LD, the chips, the grid and
 * the links under it (and the lede, only if `LEDE_PLACEMENT` says 'page'). The grid keeps its skeleton
 * on purpose (owner's hybrid). Anything a crawler must read goes in the layout, and what the layout
 * waits on is rationed and measured (see there). No `<Suspense>` here either (contract test).
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
  // ⚠️ THIS notFound() DOES NOT MAKE THE 404 BY ITSELF — trust the code and the test, not the prose;
  // this comment has been wrong in both directions before. The trigger for the old soft-404 was this
  // segment's `loading.tsx`, not Next 15.2+ metadata streaming (moving the file out and rebuilding
  // gave a 404; putting it back gave 200): a loading boundary makes Next flush the shell, status
  // included, before this is reached. The 404 is made above the boundary, by `../layout.tsx`'s guard
  // and, second, by `(index)/layout.tsx` (App Router nests layout → loading → page). This copy stays
  // as defence in depth.
  if (!loaded) notFound()
  const { cat, live } = loaded
  const hostUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'
  /**
   * ⛔ RENTALS SAYS WHAT ITS STOCK IS, FROM THE STOCK. It was "Rentals in Vietnam — Trusted listings"
   * over 25,502 rentals that were all in Ho Chi Minh City and all linked from other portals — no
   * page answered "apartments for rent in Ho Chi Minh City" (~720 searches/month) while this one
   * held the inventory for it. category-copy.ts words it from live counts; every other category
   * keeps the generic copy (categoryMetadata) — its trust sentence only while nothing is linked.
   * Both follow the page's language (SEO wave B, V2; CS-3): a Vietnamese reader got the English title.
   */
  // ⚠️ THE TITLE NAMES THE CACHED VARIANT THE H1 PRINTS (`(index)/layout.tsx`), so the two cannot
  // disagree; the description is built from this render's live counts. No variant = no live rental
  // when the cache was filled: then the H1 and the title both keep the generic wording.
  const headline = cat.slug === 'rentals' ? await loadRentalsHeadline(cat.id) : null
  const facts = headline ? await loadRentalsFacts(cat.id, live) : null
  const rentals = headline && facts ? rentalsMetadata(facts, pageLang(lang), SITE_NAME, headline) : null
  // Every other category keeps its old wording only while none of its stock is linked (category-copy.ts).
  const { title, description } = rentals ?? categoryMetadata(cat, live > 0 ? linkedTier(await loadLinkedCount(cat.id), live) : 'none', SITE_NAME, pageLang(lang))
  // Empty, and empty for the whole window (src/lib/stale-noindex.ts). Queries only when `live` is 0.
  const emptyForTheWindow = await staleBelowFloor({ where: { categoryId: cat.id }, live, floor: MIN_CATEGORY_LISTINGS })
  /**
   * ⛔ THE `/vi` PILOT (SEO wave B, V3b — dormant until V5 lists `/c/furniture-appliances`, marketplace
   * only): the plain URL is the English variant and `/vi/c/<slug>` the Vietnamese one, each self-canonical,
   * with reciprocal hreflang (V-g) and a share card whose og:url is that canonical. Off the list (every
   * category today, and /c/rentals always) `pilot` is null and the head is exactly V2's.
   */
  const pilot = langAlternates(`/c/${cat.slug}`, pageLang(lang), hostUrl)
  const url = pilot?.canonical ?? `${hostUrl}/c/${cat.slug}`
  return {
    title,
    description,
    alternates: pilot ? { canonical: pilot.canonical, languages: pilot.languages } : { canonical: url },
    // ⚠️ AN EMPTY CATEGORY DE-INDEXES ITSELF. Eight of the fifteen categories currently hold zero
    // live listings, and such a page is ~40 unique words wrapped around "No listings here yet" —
    // thin content, repeated eight times, on a domain with nothing else to show. `follow: true` is
    // deliberate: the page still carries real internal links to sibling categories, and we want
    // those crawled. It lifts ITSELF the moment somebody posts, with no list to maintain, which is
    // why this is computed rather than hard-coded — a hard-coded list would go stale silently and
    // keep suppressing a category that had filled up.
    // ⛔ BUT ONLY ONCE IT HAS BEEN EMPTY FOR 14 DAYS (SEO wave B, I1b; decision I-g). It used to be
    // `live === 0`: Google crawled these while they were empty and kept the tag for weeks after
    // they filled — /c/vehicles, /c/baby-kids, /c/hobbies-sports, /c/pets and /c/food-drink (URL
    // Inspection, 2026-09-28), as /c/rentals before them. Inside the window an empty category stays indexable
    // and is simply out of the sitemap (pages.xml submits only categories with a live listing).
    ...(emptyForTheWindow ? { robots: { index: false, follow: true } } : {}),
    // Mirror the page's own title/description/canonical into OG — without this the
    // page inherits the generic homepage OG tags in link unfurls.
    ...pageShare({ title, description, url }),
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
   * ⛔ THE FIRST PAGE IS /api/listings AT offset 0, NOT A PLAIN RANK ORDER. Sort and Show-more are
   * scoped API queries now (`serverScope` below), and under DEFAULT_FEED_SORT the API serves
   * `diverseFeedWindow` + `diversifyBySeller` (route.ts) — so a plain `rankScore` page 1 made the first
   * Show-more continue a DIFFERENT sequence: rows repeated (deduped away) and rows never appeared. The
   * same window, the same seat rule (`sharedSeatsFor`, as the API reads it for `?category=` alone) and
   * the same reorder-then-slice as seller-storefront.tsx and the home page.
   */
  const sharedSeats = sharedSeatsFor(null, cat.slug)
  /**
   * ⚠️ THE SAME PREDICATE AS load-category.ts AND category-data.ts (verified, active, this category),
   * each scoped on its own rather than one mutated `where` spread with extra keys — spreading an
   * exclusion fragment beside other keys is the collision trap edition-scope.ts exists to prevent.
   */
  const base = { categoryId: cat.id, verified: true, status: 'active' as const }
  /**
   * ⛔ /c/rentals SHOWS PLACES, NOT VEHICLE HIRE (src/lib/rental-places.ts). Its H1 answers "apartments
   * for rent in …" and its lede counts places; ~6,400 imported cars and motorbikes share the category
   * (scripts/import-vehicle-rentals.ts) and would otherwise fill its first 48 cards. The lede links
   * them into the explorer's car / motorbike views instead; the strip's Filters link and "Refine in
   * full search" still open the whole category there. Sort and Show-more stay on this page since
   * C1-DEADEND, so they page over PLACES too (`kind=places` in `serverScope` below — one scope).
   * ONLY WHILE A PLACE IS LIVE — with none, the facts are null, the page keeps the generic copy and
   * shows whatever rentals exist, never an empty grid.
   * Wrapped in AND, never spread beside the scoped keys (edition-scope.ts's collision trap).
   */
  const rentalsFacts = cat.slug === 'rentals' && total > 0 ? await loadRentalsFacts(cat.id, total) : null
  /**
   * ⛔ AND WHILE ANY HOME IS LIVE, THE PREVIEW IS HOMES (SEO wave B, D1b; decision D-e). Its first
   * "relevance" cards were offices (peer finding 2b), under an H1 for people looking for somewhere to
   * live. The ItemList reads the same rows; Show-more sends `homes=1`; the strip's total is the homes
   * count, the same number the description and the lede lead with. Offices move to the nofollow
   * "Also here" link below the grid. Composed through AND, like RENTAL_PLACES.
   */
  const homes = rentalsFacts?.homes && rentalsFacts.homes.total > 0 ? rentalsFacts.homes : null
  const scopedWhere = await scopedListingWhere(
    homes ? { AND: [base, RENTAL_PLACES, { subcategorySlug: { in: [...HOME_RENTAL_SUBCATS] } }] }
    : rentalsFacts ? { AND: [base, RENTAL_PLACES] } : base, { teachers: true })
  const [raw, otherCats, chips, rentals] = await Promise.all([
    // Card projection: this page only renders <ListingCard> slots — the full row (description,
    // attributes, searchText, whole Seller) tripled the ISR payload. The order is buildFeedOrderBy('newest').
    diverseFeedWindow(scopedWhere, [{ rankScore: 'desc' }, { id: 'desc' }], LISTING_CARD_SELECT, { sharedSeats }),
    db.category.findMany({ where: { NOT: { id: cat.id } }, orderBy: { name: 'asc' } }),
    // ⚠️ CANONICAL CHIPS (category-data.ts): one per place, linking the one URL that place has — the
    // stored spellings (`quan-2`, `huyen-cu-chi`) now 308 there instead of standing beside it — and
    // only places at the indexing floor (SEO wave B, I1), so no chip links a `noindex` page.
    // ⚠️ PLACES-ONLY ON RENTALS ALWAYS, not only while the grid is: /c/rentals/<district> counts places
    // whatever this page shows, so a chip tallied over vehicle hire (the no-place fallback) would link
    // a 404. Same arguments as loadRentalsFacts' call, so the two share one cache() entry.
    loadDistrictChips(cat.id, cat.slug === 'rentals'),
    // The same cached call generateMetadata and the lede make — one set of counts per render. The
    // page reads only `top` from it (RentalsDistricts); the linked count is the lede's alone.
    rentalsFacts,
  ])
  // Reorder THEN slice (the window's fallback paths hand back a plain top-N nobody interleaved).
  const listings = await localizeListingTitles(diversifyBySeller(raw, { sharedSeats }).slice(0, PAGE_SIZE).map(serializeListingCard))
  // ⚠️ "BY AREA" ONLY WHERE THERE ARE AREAS TO BROWSE (byAreaChips: three places with five or more).
  const districts = byAreaChips(chips, DISTRICT_CHIPS)
  // Registry-driven (src/lib/category-guides.ts) and only over real stock: a guide rail under an
  // empty category is a signpost to nothing, which is why it lives in the non-empty branch below.
  // ⚠️ MARKETPLACE ONLY: on eno.forum these links would promote its self-canonical COPIES of eno.vn's
  // guides before the owner decides the cross-host canonicals — /llms.txt and the footer omit them there.
  const guides = total > 0 && !IS_SERVICES ? guidesForCategory(cat.slug, pageLang(lang)) : []
  const hostUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'
  // The crumb names follow the page's language, equal to the visible crumbs in `(index)/layout.tsx` (V2).
  const crumbs = crumbNames(cat, pageLang(lang))

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: crumbs.home, item: hostUrl },
          { '@type': 'ListItem', position: 2, name: crumbs.category, item: `${hostUrl}/c/${cat.slug}` },
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
    <>
      {/* The lede renders here, under the skeleton, only if LEDE_PLACEMENT says 'page'; since H1b it says
          'layout' and the lede is in (index)/layout.tsx, under the H1 (decision H-c, lede-placement.ts). */}
      {LEDE_PLACEMENT === 'page' && <CategoryLedeBlock slug={cat.slug} />}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />

      {/* ⚠️ ONE SWIPE ROW ON A PHONE, WRAPPING FROM sm (C1-FOLD, 2026-09-29). Every canonical place is
          a chip, and at 390px the 29 on /c/rentals wrapped into ~9 rows that pushed the first card to
          1018px. Every chip stays a server-rendered <a> — nothing is hidden from a crawler or put
          behind a drawer. `py-1` is room for the chips' 3px focus ring inside the scroller, which
          clips at its padding box; `overflow-y-hidden` keeps it a one-axis scroller, so a vertical
          drag that starts on a chip still scrolls the page (explorer-toolbar.tsx measured that trap). */}
      {districts.length > 0 && (
        <div className="scrollbar-none mt-3 flex flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain py-1 sm:mt-6 sm:flex-wrap sm:overflow-visible sm:py-0">
          <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-ink-4"><Tr text="By area:" /></span>
          {districts.map((d) => (
            <Badge key={d.slug} size="md" interactive render={<Link href={`/c/${cat.slug}/${d.slug}`} />} className="shrink-0 whitespace-nowrap px-3.5 py-1.5 font-semibold text-body hover:bg-accent hover:text-accent-foreground">
              {/* English place names on English pages ("District 2", not "Quận 2"). */}
              <PlaceName en={d.label.en} vi={d.label.vi} />
            </Badge>
          ))}
        </div>
      )}

      {/* Masthead boundary — on the content box, like the sort strip's own hairline below and the
          home toolbar's (C1-HAIRLINE); it used to bleed to the page frame with negative margins.
          Tighter on a phone, where the fold is the budget (C1-FOLD). */}
      <div aria-hidden className="mt-4 border-t border-border sm:mt-8" />

      {listings.length > 0 ? (
        <>
          <div className="mt-4 sm:mt-6">
            {/* sr-only h2: the card titles below are h3s, and without this the outline
                jumps h1 → h3 (detector-confirmed skip; same fix as the home feed header). */}
            <h2 className="sr-only"><Tr text="Listings" /></h2>
            {/* A sort strip over a single card reads absurd — the tablist earns its row
                only once there is something to reorder. */}
            {/* ⛔ SORT AND SHOW-MORE ARE SCOPED QUERIES OVER THE WHOLE CATEGORY, IN PLACE (C1-DEADEND,
                2026-09-29). This strip used to be links into the explorer — a sort LEFT the page, into
                a URL canonicalised to / — because the page held a 48-card preview and sorting it in
                memory could never reach a cheaper item outside it. `serverScope` makes every sort and
                page a /api/listings query with the category in `params`, as the district pages and
                storefronts already do; the first page above is that query's own offset 0. The
                explorer's facets are one tap away in the strip (`stripEnd`). `sortable` keys off
                `total`, not the page: one card shown of two hundred still needs a sort.
                ⛔ `serverScope.params` AND `scopedWhere` ARE ONE SCOPE, CHANGED TOGETHER OR NOT AT ALL
                (scope-parity-contract.test.ts): while /c/rentals narrows to places (`rentalsFacts` →
                `RENTAL_PLACES`), the params carry `kind=places` under the SAME condition and the total
                is the places total (`rentals` IS `rentalsFacts`); while homes are live (D1b), `homes=1` and
                the homes total, beside the homes-only `scopedWhere`. */}
            <SellerListings
              listings={listings}
              serverScope={{
                params: {
                  category: cat.slug,
                  ...(rentalsFacts ? { [PLACES_KIND_PARAM.key]: PLACES_KIND_PARAM.value } : {}),
                  ...(homes ? { [HOMES_ONLY_PARAM.key]: HOMES_ONLY_PARAM.value } : {}),
                },
                total: homes?.total ?? rentals?.total ?? total,
                pageSize: PAGE_SIZE,
              }}
              stripEnd={<CategoryFiltersLink slug={cat.slug} />}
              priceLabel={cat.slug === 'jobs' ? 'salary' : 'price'}
              sortable={(homes?.total ?? total) > 1}
            />
          </div>
          {homes && <OtherRentalsLink n={homes.offices} href="/?category=rentals&subcategory=office-rental" />}
          <div className="mt-8">
            {/* Real ArrowRight at h-4, not a literal '→' — the SEO-landing CTAs already
                use the lucide arrow, and one page family should speak one arrow language.
                gap-1.5 on the BUTTON (asChild concatenates the child's className). */}
            {/* nofollow + no prefetch: /?category= is canonicalised to /, and a prefetch would render
                the full explorer for everyone who scrolls this far (as the strip's Filters link). */}
            <Button asChild variant="cta" size="none" className="gap-1.5">
              <Link href={`/?category=${cat.slug}`} rel="nofollow" prefetch={false} className="px-5 py-2.5">
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
                <Badge key={c.slug} size="md" interactive render={<Link href={localizedHref(`/c/${c.slug}`, pageLang(lang))} />} className="px-3.5 py-1.5 font-semibold text-body hover:bg-accent hover:text-accent-foreground">
                  <Bilingual en={c.name} vi={c.nameVi || c.name} />
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
                <Link href={`/?category=${cat.slug}`} rel="nofollow" prefetch={false} className="text-sm font-semibold text-accent-foreground hover:underline">
                  <Tr text="Or browse the category — you can set an alert there" />
                </Link>
              </div>
              {otherCats.length > 0 && (
                <div className="flex flex-col items-center gap-3">
                  <span className="text-xs font-semibold text-ink-4"><Tr text="Explore other categories" /></span>
                  <div className="flex flex-wrap justify-center gap-2">
                    {otherCats.map((c) => (
                      <Badge key={c.slug} size="md" interactive render={<Link href={localizedHref(`/c/${c.slug}`, pageLang(lang))} />} className="px-3.5 py-1.5 font-semibold text-body hover:bg-accent hover:text-accent-foreground">
                        <Bilingual en={c.name} vi={c.nameVi || c.name} />
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          }
        />
      )}
    </>
  )
}
