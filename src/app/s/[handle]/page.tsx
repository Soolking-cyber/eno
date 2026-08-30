import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { scopedListingWhere } from '@/lib/edition-scope'
import { serializeListingCard, LISTING_CARD_SELECT } from '@/lib/serialize'
import { localizeListingTitles } from '@/lib/translate'
import { getCategoriesByDemand } from '@/lib/categories'
import type { SerializedCategory, SerializedListingCard } from '@/lib/types'
import { Header } from '@/components/marketplace/header'
import { ListingsExplorer } from '@/components/marketplace/listings-explorer'
import { Footer } from '@/components/marketplace/footer'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Store } from '@/components/ui/icons'
import { Tr } from '@/context/language-context'
import Link from 'next/link'
import { StorefrontBanner } from '@/components/marketplace/storefront-banner'
import { storefrontByHandle } from '@/lib/storefront'
import { storefrontUrl } from '@/lib/storefront-host'
import { SITE_NAME } from '@/lib/edition'

/**
 * A SHOP'S OWN STOREFRONT — the home page, scoped to one seller.
 *
 * Reached by HOST, not by path: `proxy.ts` rewrites `apple.eno.vn/` to `/s/apple`. Owner,
 * 2026-08-30: a second-hand shop gets a subdomain it can hand out as its own shopfront, and what
 * it serves should be eno's home page carrying only that shop's stock.
 *
 * ⛔ THIS ROUTE IS NOT LINKED AND MUST NOT BE. `/s/<handle>` is the rewrite TARGET, an internal
 * address; the public URLs are `apple.eno.vn` (subdomain) and `eno.vn/apple` (the long-standing
 * path storefront in `src/app/[handle]`). Two public URLs for one page would split the ranking,
 * which is why `alternates.canonical` below points at the subdomain and never at this path.
 *
 * ⚠️ IT IS DELIBERATELY THE SAME `<ListingsExplorer>` AS THE HOME PAGE. The whole proposition is
 * "use our platform as your storefront" — a shop that gets a lesser page than the marketplace has
 * been given a brochure, not a shopfront. Search, facets, rails, the view switcher and the card
 * grid are all the real ones; the only difference is the scope of what they search.
 */

/**
 * ⛔ DYNAMIC, AND `revalidate = 3600` WAS WRITTEN HERE FIRST AND CONTRADICTED THIS FEATURE'S OWN
 * SECURITY ARGUMENT. Two reviewers caught it in the same round. `storefront.ts` says at length
 * that eligibility is a LIVE test — that a lapsed verification, a revoked tax registration or a
 * rename to a brand takes the subdomain down on the next read — and then this line cached the
 * answer for an hour. An hour of a revoked shop still serving under eno's own domain is precisely
 * the exposure the verification gate exists to prevent, and the inverse is just as bad: a shop
 * that verifies at 10:01 staring at a cached 404 until 11:00.
 * ⚠️ THE COST IS A POSTGRES ROUND TRIP PER STOREFRONT VIEW, and it is accepted. The apex home page
 * keeps its 6h ISR because nothing about it is a permission; this page IS one. If storefront
 * traffic ever justifies caching, cache the LISTINGS and keep `storefrontByHandle` live — never
 * the other way round.
 */
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ handle: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params
  const shop = await storefrontByHandle(handle)
  if (!shop) return { title: 'Not found', robots: { index: false, follow: false } }
  const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'
  return {
    title: `${shop.name} — ${SITE_NAME}`,
    description: `Browse everything ${shop.name} has for sale on ${SITE_NAME}.`,
    /**
     * ⚠️ ABSOLUTE, AND POINTING AT THE SUBDOMAIN. Everywhere else in this app a canonical is the
     * relative `'/'` because there is one host; here the page answers on `apple.eno.vn` while
     * living at `/s/apple`, so a relative canonical would resolve against whichever host served it
     * and hand the shop's ranking to an internal path. `storefrontUrl` also knows the fallback for
     * a handle that cannot be a host.
     */
    alternates: { canonical: storefrontUrl(shop.handle, origin) },
  }
}

async function getData(sellerId: string): Promise<{
  categories: SerializedCategory[]
  listings: SerializedListingCard[]
  total: number
}> {
  /**
   * ⚠️ THE SHOP FILTER GOES *THROUGH* `scopedListingWhere`, NEVER AROUND IT. That helper returns
   * either the where-clause or `{ AND: [where, editionExclusion] }`, so spreading a `sellerId` onto
   * its result would drop the exclusion on exactly the shape where it exists — the failure
   * `feed-query.ts` documents in its own words. Passing the filter IN means the two compose.
   */
  const where = await scopedListingWhere({ sellerId, verified: true, status: 'active' })
  const [allCategories, rows, total, ownCategories] = await Promise.all([
    getCategoriesByDemand(),
    db.listing.findMany({
      where,
      select: LISTING_CARD_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 24,
    }),
    db.listing.count({ where }),
    /**
     * ⛔ THE CATEGORY RAIL IS THE SHOP'S, NOT THE MARKETPLACE'S. Owner, 2026-08-30: *"storefront
     * should show only relevant parts for that store whatever products they have"* — sent with a
     * screenshot of VinWonders' storefront offering Electronics, Fashion, Home, Food and Hobbies
     * for a shop that sells amusement-park tickets. Every one of those chips led to an empty feed,
     * because the rail was marketplace-wide while the feed beside it was scoped.
     * ⚠️ A `groupBy` OVER THE SHOP'S OWN LISTINGS, reusing the same `where` the feed uses, so the
     * two can never disagree about what this shop sells.
     */
    // edition-lint-allow: this read carries the SAME `where` the feed above uses — the one
    // built by scopedListingWhere at the top of this function — so it inherits the edition
    // exclusion rather than needing its own. Sharing one predicate across the feed, the count
    // and this grouping is what stops the rail and the results disagreeing about the catalogue;
    // three separate calls would be three chances to drift.
    db.listing.groupBy({ by: ['categoryId'], where }),
  ])
  /**
   * ⚠️ FILTERED FROM THE FULL LIST RATHER THAN REBUILT, so the chips keep the demand ORDER, the
   * artwork and the serialization the home rail already has. Only the membership changes.
   * ⚠️ A SHOP WITH NOTHING IN ANY CATEGORY GETS AN EMPTY RAIL, which is correct — an empty shop
   * should not advertise categories it cannot fill.
   */
  const ownIds = new Set(ownCategories.map((g) => g.categoryId))
  const serializedCategories = allCategories.filter((c) => ownIds.has(c.id))
  /**
   * ⚠️ NO `diversifyBySeller` HERE, AND ITS ABSENCE IS THE POINT. The home feed interleaves sellers
   * so one shop's catalogue cannot hold the top of the page. On a shop's OWN storefront every row
   * is that shop, so the same call would be a no-op that reads like a bug to the next person.
   */
  return {
    categories: serializedCategories,
    listings: await localizeListingTitles(rows.map(serializeListingCard)),
    total,
  }
}

export default async function Storefront({ params }: Props) {
  const { handle } = await params
  const shop = await storefrontByHandle(handle)
  /**
   * ⛔ 404 RATHER THAN A REDIRECT, AND FOR AN UNVERIFIED SHOP TOO. `storefrontByHandle` returns
   * null both when nobody holds the handle and when the holder is not verified TODAY — see
   * `storefront.ts` for why that is a live test. Bouncing to `eno.vn/<handle>` instead would be
   * friendlier and wrong: it would confirm to anyone probing subdomains exactly which handles
   * exist, and it would give a shop whose verification lapsed a working subdomain that quietly
   * stopped being theirs to control.
   */
  if (!shop) notFound()
  const { categories, listings, total } = await getData(shop.sellerId)

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-4">
        {/**
          * THE SHOP'S OWN BANNER — one slot, theirs, above their stock. Owner, 2026-08-30: a shop
          * gets one banner for its store, set from its store profile.
          *
          * ⛔ AND IT IS THE ONLY BANNER ON THIS PAGE. eno's own `<PromoBanner>` is suppressed
          * inside `<ListingsExplorer>` whenever `sellerId` is set — same instruction, other half.
          * A shop's storefront carrying eno's partner advertising would put a competitor's
          * creative above that shop's own products, on a domain the shop hands out as its own.
          *
          * ⚠️ ABSENT IS THE COMMON CASE and renders nothing — no placeholder, no reserved strip.
          * `<StorefrontBanner>` already owns that decision for the `eno.vn/<handle>` page; reusing
          * it here means the two storefront surfaces cannot drift on sizing, art direction or the
          * mobile fallback (`bannerMobileUrl` null falls back to the wide one).
          */}
        <StorefrontBanner url={shop.bannerUrl} mobileUrl={shop.bannerMobileUrl} />
        {total === 0 ? (
          /**
           * A SHOP WITH NOTHING IN IT GETS A WELCOME, NOT AN EMPTY MARKETPLACE. Owner, 2026-08-30:
           * *"friendly message guiding to post products"*. Before this, an empty storefront rendered
           * the full explorer — a search box, a sort strip and a lone "All" chip over nothing — which
           * reads as broken rather than new, on the page a shop hands out.
           *
           * ⛔ THE COPY CANNOT ASSUME THE READER IS THE OWNER, AND THAT IS A FACT ABOUT THIS HOST
           * RATHER THAN A STYLE CHOICE. The session cookie is scoped to `eno.vn`, so on
           * `<handle>.eno.vn` there is no session at all and the server cannot tell the shopkeeper
           * from a shopper. "Post your first listing" would therefore greet strangers as the owner.
           * So it states the fact — nothing listed yet — and offers the action, which is true for
           * whoever is reading: on a marketplace, a visitor can post too.
           *
           * ⚠️ THE EXPLORER IS REPLACED, NOT HIDDEN. Rendering it with `initialTotal = 0` would still
           * mount the search box, facet bar and view switcher, all of which query and all of which
           * can only ever answer nothing here.
           */
          <div className="py-10 sm:py-16">
            <EmptyState
              size="lg"
              icon={Store}
              title={<Tr text="Nothing listed yet" />}
              /**
               * ⚠️ NO INTERPOLATION IN A TRANSLATED SENTENCE. `<Tr>` resolves against the generated
               * string table, and `gen-ui-strings.mjs` scrapes LITERALS — a template carrying the
               * shop's name would never be scraped, so it would ship untranslated on a Vietnamese
               * marketplace. The shop is already named by the page title, the banner and the header.
               */
              subtitle={<Tr text="Anything this shop posts shows up here automatically." />}
              action={
                /**
                 * ⚠️ ABSOLUTE, TO THE CANONICAL HOST. Posting is a WRITE, and writes are pinned to
                 * the canonical origin — a relative `/post` would keep the visitor on the shop's
                 * subdomain, where the sign-in they need cannot complete. See proxy.ts.
                 */
                <Button variant="cta" asChild>
                  <Link href={`${process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'}/post`}>
                    <Tr text="Post a listing" />
                  </Link>
                </Button>
              }
            />
          </div>
        ) : (
        <ListingsExplorer
          categories={categories}
          initialListings={listings}
          initialTotal={total}
          initialFetchedAt={Date.now()}
          /**
           * ⚠️ THE SCOPE TRAVELS WITH EVERY CLIENT FETCH, not just this first paint. The explorer
           * re-queries `/api/listings` on search, facet, sort and infinite scroll; without the
           * seller carried through, the second page of a shop's storefront would be the whole
           * marketplace. `sellerId` is the shop's own id and is public information (it keys every
           * listing card), so passing it to the client leaks nothing the page does not already show.
           */
          sellerId={shop.sellerId}
        />
        )}
      </main>
      <Footer />
    </div>
  )
}
