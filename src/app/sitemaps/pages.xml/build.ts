import { scopedListingWhere } from '@/lib/edition-scope'
import { IS_SERVICES } from '@/lib/edition'
import { db } from '@/lib/db'
// ⚠️ VIA THE ALIASED MODULE, NOT `@/lib/vietnam-evisa/links` DIRECTLY. This route compiles on BOTH
// editions, and that module is a plain `.ts` — `pageExtensions` excludes its `page.svc.tsx`
// neighbours but not it — so importing it here put every e-visa label and blurb in eno.vn's server
// bundle. The IS_SERVICES gate below stopped the URLs being emitted; it could not remove the
// strings. `@/lib/edition-services-copy` is aliased to an empty stub on a marketplace build, so the
// import is severed there. See the note on SERVICES_SITEMAP_PATHS in that module.
import { SERVICES_SITEMAP_PATHS } from '@/lib/edition-services-copy'
import { EXPAT_GUIDE_PATHS, MARKETPLACE_GUIDE_PATHS, guideDates } from '@/lib/expat-guides'
import { vehicleHubLiveCount, VEHICLE_HUB_KIND_BY_SLUG } from '@/lib/vehicle-hubs'
import { PHONE_GUIDE_PATHS } from '@/lib/phone-guides'
import { HELP_TOPIC_SLUGS } from '@/lib/help-center'
import { seoLandingWhere, type SeoLandingTarget } from '@/components/marketplace/seo-landing-where'
import { LANDING_TARGET as JOBS_TARGET } from '@/app/[lang]/jobs-vietnam-expats/landing-target'
import { LANDING_TARGET as MOTORBIKE_TARGET } from '@/app/[lang]/motorbikes-for-sale-vietnam/landing-target'
import { LANDING_TARGET as HOUSING_TARGET } from '@/app/[lang]/housing-vietnam-expats/landing-target'
import { LANDING_TARGET as MOVING_SALES_TARGET } from '@/app/[lang]/moving-sales-vietnam/landing-target'
import { LANDING_TARGET as COFFEE_TARGET } from '@/app/[lang]/wholesale-green-coffee-vietnam/landing-target'
// Read only: the model lists the iPhone pages price, so the sitemap dates the rows those pages show.
import { IPHONE_18_MODELS, IPHONE_DUO_MODEL } from '@/app/[lang]/iphone-18-vietnam/lowest-prices'
import { loadRentIndex } from '@/app/[lang]/hcmc-rent-index/load-rent-index'
import type { RentIndex } from '@/lib/rent-index'
import { publishableCells } from '@/lib/district-rent-cells'
import { canonicalDistrictSlug, districtLinkSlug, isCuratedDistrict } from '@/lib/district-canonical'
import { districtScopeForSlug } from '@/lib/district-slug'
import { RENTAL_PLACES } from '@/lib/rental-places'
import { isIndexableCount } from '@/lib/index-floor'
import { submittedListingWhere, urlsetXml, siteOrigin } from '@/lib/sitemap'
import { storefrontCanonicals } from '@/lib/storefront'

/**
 * THE BODY OF /sitemaps/pages.xml, MOVED OUT OF ITS ROUTE FILE (SEO wave B, I4) SO A SECOND CALLER CAN
 * READ IT. `route.ts` may export only handlers and route config, and the IndexNow cron
 * (src/app/api/cron/indexnow/collect.ts) needs the same document in-process — not a fetch through
 * the public host, and not the route's 24-hour ISR copy. The move changed nothing the route serves:
 * at the move, the pre-move `GET` and this builder were run side by side over every `sitemap.test.ts`
 * fixture and matched byte for byte (a one-off check, not a kept test — the route now simply calls this
 * function); the route-level tests in `sitemap.test.ts` are what keep it true.
 *
 * ⚠️ `rentIndex` IS THE ONE DIFFERENCE BETWEEN THE TWO CALLERS, AND ONLY FOR THE RENT INDEX'S OWN URLS
 * (`/hcmc-rent-index` and, since SEO wave B D3, the rentals district pages it qualifies).
 *   · `'require'` (the route): an unknown snapshot THROWS `RentIndexUnavailable` — never a document
 *     without those URLs. The route rethrows it, and Next keeps serving the last good `pages.xml`
 *     (route.ts says how, and what was measured). A partial sitemap would be cached for the route's
 *     whole day and would read to a crawler as "these pages are gone".
 *   · `'optional'` (IndexNow): an unknown snapshot FREEZES those URLs instead — they are left out of
 *     `xml` and named in `frozen`, and the diff carries their previous entries forward untouched
 *     (src/lib/indexnow-diff.ts). Emitting them without the snapshot would make the next good one read
 *     as a change; omitting them unfrozen would ping ~22 removals. Every other source failure — a
 *     database error included, here or inside the loader — still throws, in both modes.
 *   `frozen` is always `[]` in `'require'` mode, and in `'optional'` mode while the snapshot is known.
 */
export class RentIndexUnavailable extends Error {
  constructor() {
    // The cause is not carried here: `loadRentIndex()` turns a failed read into `known: false` and logs
    // it itself, as "[hcmc-rent-index] snapshot failed <error>" — then answers `known: false` without a read for a minute (FAILURE_HOLD_MS).
    super('the rent index snapshot is unavailable (the cause is the "[hcmc-rent-index] snapshot failed" line logged at most a minute before); pages.xml is not built without it')
    this.name = 'RentIndexUnavailable'
  }
}

export type RentIndexMode = 'require' | 'optional'

/**
 * What `'optional'` mode freezes when the rent snapshot is unknown: a path prefix (trailing `/`) or one
 * exact path. `/c/rentals/` covers the rentals district pages, which only the snapshot can qualify
 * (rule A's second half, below); the bare `/c/rentals` category page is not under the prefix.
 */
export const RENT_FROZEN_PATHS: readonly string[] = ['/c/rentals/', '/hcmc-rent-index']
// ⚠️ STATIC PAGES CARRY NO <lastmod> AT ALL, AND THAT IS THE FIX, NOT AN OMISSION.
//
// This used to be `const STATIC_LASTMOD = new Date()` with a comment claiming it was "stable …
// so crawlers don't see a fake changed date". Module init is per PROCESS, and this runs on Cloud
// Run with min-instances 1 and autoscaling — so every cold start restamped eleven unchanging
// pages (/about, /terms, /privacy…) as modified right now. That is precisely the fake date the
// comment set out to avoid, and Google's documented response to a lastmod it can prove wrong is
// to discount the signal SITE-WIDE, including on the listing URLs where it is real and useful.
//
// Omitting is honest and costs nothing: lastmod is optional, and these pages genuinely change so
// rarely that the crawler learning their cadence from observation is a better outcome than a
// number we cannot compute correctly at runtime. Data-driven URLs below keep a REAL lastmod.
//
// ⚠️ <changefreq> and <priority> are gone from every entry too. Google has stated for years that
// it ignores both; they were pure bytes, and the priority values here were also mutually
// inconsistent (static info pages at 0.4 while empty category pages claimed 0.7).

/** `iPhone 18 Pro` → `iphone-18-pro-vietnam`: each model page is named after the model it prices. */
const iphoneModelPath = (model: string) => `${model.toLowerCase().replace(/\s+/g, '-')}-vietnam`

/**
 * A guide's `<lastmod>` is the date its page prints as `dateModified` (seo-article.tsx: `updated ??
 * published`), from the same registry entry the page spreads (`guideDates`, SEO wave B, I3b/I3c).
 */
const guideLastmod = (slug: string) => {
  const d = guideDates(slug)
  return d.updated ?? d.published
}

/**
 * THE RENTALS DISTRICT PAGES `pages.xml` SUBMITS (rule A's second half, D3), in snapshot order. A row of
 * the rent snapshot qualifies `/c/rentals/<slug>` when ALL of these hold:
 *   1. `publishableCells(row)` is non-empty — the very list D2's block renders (district-rent-cells.ts),
 *      from the same cached snapshot (one `unstable_cache` key, load-rent-index.ts), so the sitemap and
 *      the page cannot disagree about whether the block is there.
 *   2. `isIndexableCount(row.total)`, I1's floor on the snapshot's count. While MIN_CELL_N equals N,
 *      (1) implies (2); both are checked so the two constants can diverge later.
 *   3. The slug is a curated key and its own canonical (`canonicalDistrictSlug` maps each key to
 *      itself), so the URL answers 200, never a 308. `d2`, `d9` and `thu-duc` are separate rows, each
 *      emitted once. No other rentals slug can appear: only curated HCMC districts have a row.
 *   4. ⛔ THE PAGE IS INDEXABLE BY ITS OWN SHIPPED RULE, READ LIVE: the page's own count — rentals, places
 *      only, in edition scope, over `districtScopeForSlug` (the predicate `[district]/page.tsx`'s
 *      `load()` counts as `total`, offices included, not the homes `listsHomesOnly` lists) — is at the
 *      floor. The page says `noindex` only after STALE_NOINDEX_DAYS under it (I1b, `staleBelowFloor`),
 *      so a page at the floor now is indexable now, and stays so for 14 days even if it dips — longer
 *      than this file's day. This is what closes v4's accepted gap: the snapshot can be a day old while
 *      the page decides its robots from the live count, and without this read a district that emptied
 *      after the snapshot could be submitted as `noindex`. It also keeps I1's promise that a page under
 *      its floor inside the 14 days is "indexable but unsubmitted".
 *      ⚠️ THE RESIDUAL: the page's HTML is ISR-cached for a day, so a page that had been `noindex` (14
 *      days under the floor) and has just climbed back can still serve its cached `noindex` for up to
 *      a day after this file first lists it. Rare, self-correcting, and the harmless direction.
 * One `count` per qualifying row (22 at most today), all at once; a failed one throws, and so the route
 * keeps its last good copy.
 */
async function submittedRentalsDistricts(index: RentIndex, rentalsId: string): Promise<string[]> {
  const slugs = [...new Set(
    index.districts
      .filter((r) => isCuratedDistrict(r.slug) && canonicalDistrictSlug(r.slug) === r.slug)
      .filter((r) => publishableCells(r).length > 0 && isIndexableCount(r.total))
      .map((r) => r.slug),
  )]
  const places = await scopedListingWhere({ AND: [{ categoryId: rentalsId, verified: true, status: 'active' }, RENTAL_PLACES] })
  const live = await Promise.all(slugs.map(async (slug) => {
    const scope = await districtScopeForSlug(slug)
    // edition-lint-allow: `places` IS `await scopedListingWhere(...)` just above; AND-ing the district
    // scope onto it cannot lose the edition clause.
    return scope ? db.listing.count({ where: { AND: [places, scope] } }) : 0
  }))
  return slugs.filter((_, i) => isIndexableCount(live[i]))
}

export async function buildPagesSitemap(opts: { rentIndex: RentIndexMode }): Promise<{ xml: string; frozen: string[] }> {
  const [byCategory, byCombo, bySeller, categories, helpArticles] = await Promise.all([
    /**
     * ⚠️ SCOPED HERE, ON EVERY DERIVATION, AND THAT IS THE EDITION BOUNDARY. The category maxima,
     * the category/district combos and the seller-storefront URLs below are all DERIVED from these
     * aggregates, so this one predicate drops the desk's listings, its /eno_visa storefront entry
     * and the /c/services/... combos it alone generated. Filtering at the emit loop instead would
     * leave all three behind.
     *
     * A sitemap is not a passive document — it is eno.vn actively asking Google to index these
     * URLs, which on a licensed sàn TMĐT is the most active way to advertise a service it may not
     * sell.
     *
     * ⛔ WHOLE-TABLE AGGREGATES, NOT A `take: 45000` WINDOW — THE FIX OF 2026-09-24. This used to be
     * one findMany of the newest 45,000 live rows by `updatedAt`, walked in JS to find each
     * category's, combo's and seller's freshest row. With ~98,700 live rows that window already
     * held under half the catalogue, and any bulk write that touches `updatedAt` (a 44,000-row
     * property import, an affiliate sync) filled it with its own rows: every district that only
     * older stock covers lost its combo URL and every seller whose rows were all older left the
     * storefront block — silently, with the set changing on every sync. A GROUP BY counts the whole
     * table and cannot be fooled by a cap.
     *
     * ⛔ `_max.postedAt`, NOT `updatedAt` (SEO wave B, I3c): EACH LASTMOD IS THE DATE OF WHAT THE PAGE
     * SHOWS. The home feed, a category and a district page rank by `rankScore`, whose recency term
     * is `postedAt` (src/lib/ranking-formula.ts; "confirm availability" bumps it too), so a new posting in
     * scope is what puts a new card on the page, and the newest `postedAt` is that day. `updatedAt`
     * also moves on writes no visitor sees — an import re-sync of an unchanged row, a moderation
     * flag, and until I3a every view, save and contact reveal — and dated every page by the last
     * write rather than by its content.
     *
     * ⚠️ THE KNOWN COST: IT UNDER-REPORTS SOME REAL CHANGES. A price edit or new photos on a card
     * already shown, or a card leaving (sold, expired, removed), changes the page without moving any
     * `postedAt` in scope, so the lastmod stays at the last new posting. Accepted: an early date the
     * crawler corrects by revisiting costs less than a date it can prove false.
     *
     * ⚠️ AND THE CATEGORY AGGREGATE STILL COUNTS IMPORTED STOCK, DELIBERATELY. It answers "what is
     * live here": a category with 9,726 live products is a real page with its own copy and facets.
     * The LISTING URLs, the category × district combos and — since SEO wave B, I2 — the storefront
     * URLs are narrowed to what is ours (`submittedListingWhere` in src/lib/sitemap.ts): see the
     * notes on the combo and seller aggregates.
     *
     * ⛔ WHICH CATEGORIES ACTUALLY HAVE A LIVE LISTING also comes from `byCategory`: presence of a
     * group IS "has a live listing", on the same predicate `/c/<slug>` uses to decide its own
     * `noindex` (see the category loop below). It is the old unbounded `liveByCategory` aggregate
     * with `_max` added, so the lastmod and the presence test can no longer disagree.
     */
    db.listing.groupBy({
      by: ['categoryId'],
      // Teachers included: /c/teachers is submitted like any category with a live row (2026-09-30).
      where: await scopedListingWhere({ verified: true, status: 'active' }, { teachers: true }),
      _max: { postedAt: true },
    }),
    /**
     * ⛔ THE ONE AGGREGATE THAT DOES NOT COUNT IMPORTED STOCK (lead, 2026-09-24). A category ×
     * district page is a district's worth of listings and nothing else — no editorial, no stock of
     * its own behind a storefront — so when every row under it is borrowed (a Hà Nội or Đà Nẵng
     * district that only nhatot/muaban rows reach), submitting it is asking Google to index a
     * page of someone else's catalogue: the thing the owner's 2026-09-17 rule stopped for listing
     * URLs. So it is the SUBMITTED-listing predicate, district-narrowed: verified, active, in
     * edition scope and `affiliateUrl: null`. Its lastmod is our own listing's, never an import's
     * fresher sync.
     *
     * ⛔ RULE A, THE ONE SITEMAP RULE FOR DISTRICT PAGES (SEO wave B, I1 and D3; decisions I-a, D-c).
     *   1. A category × district page is submitted only with at least MIN_INDEXABLE_LISTINGS (10) of
     *      our OWN listings, summed across every stored spelling of the place — and NEVER for
     *      `rentals` by that count. One own listing used to be enough, which submitted pages of one
     *      to nine cards (`/c/services/an-khanh`: "Crawled - currently not indexed"). `_count` is the
     *      tally; the floor is applied after the spellings are merged, in the combo loop below.
     *   2. A RENTALS district page is submitted through the rent index instead (D3, the block after
     *      the combo loop): when it carries the rent block — figures computed here, the owner's "add
     *      value then to those pages" — and passes the same floor. Marketplace only, never dated.
     * A page under the floor still answers 200 — as `noindex, follow` after 14 days below 10 listings
     * of ANY kind, indexable but unsubmitted otherwise (the page counts imports too,
     * src/lib/index-floor.ts).
     */
    // edition-lint-allow: `submittedListingWhere()` IS `scopedListingWhere(...)` AND-ed with the
    // affiliate exclusion (src/lib/sitemap.ts) — the edition scope is inside the helper.
    db.listing.groupBy({
      by: ['categoryId', 'district'],
      where: await submittedListingWhere({ district: { not: null } }),
      _max: { postedAt: true },
      _count: { _all: true },
    }),
    /**
     * ⛔ A STOREFRONT IS SUBMITTED ONLY FOR A SELLER WITH AN OWN LISTING (SEO wave B, I2). This
     * aggregate used to count imported stock like the category one, which submitted 59 storefronts
     * of which only 4 held any listing of their own (measured 2026-09-27). The other 55 were 19
     * importers (rental portals, job boards), 35 retailer and carrier feeds whose every card links
     * out, and a partner whose tickets are booked on its own site. A storefront of borrowed stock is the listing rule's case one level up — a
     * page that restates another site's catalogue — so it gets the listing rule: crawlable, linked,
     * 200, and not asked for. Its lastmod is our own listing's, never an import's fresher sync.
     */
    // edition-lint-allow: `submittedListingWhere()` IS `scopedListingWhere(...)` AND-ed with the
    // affiliate exclusion (src/lib/sitemap.ts) — the edition scope is inside the helper.
    db.listing.groupBy({
      by: ['sellerId'],
      where: await submittedListingWhere(),
      _max: { postedAt: true },
    }),
    db.category.findMany({ select: { slug: true, id: true } }),
    // The 40 help answers are the largest body of original prose on the site — more URLs than
    // there are listings — and none of them were in the sitemap: only the /help index was. They
    // are ForumPost rows scoped to the help topics, exactly as /help/[id] resolves them, so a
    // post that is unpublished or moved out of a help topic drops out of both together.
    //
    /**
     * ⚠️ `HELP_TOPIC_SLUGS` IS EDITION-SCOPED, AND THIS LINE IS HALF OF A PRODUCTION FIX — do not
     * "helpfully" swap it for `ALL_HELP_TOPIC_SLUGS`.
     *
     * Measured on the live licensed domain 2026-08-01: this file emitted
     * `<loc>https://eno.vn/help/help-vietnam-evisa-entry-basics</loc>`, and that URL returned 200.
     * eno.vn was asking Google to index an e-visa help article AND serving it.
     *
     * The article is a database row, not a file, so neither `.svc.` nor a `resolveAlias` stub can
     * touch it; the only thing the repo owns is the TOPIC it belongs to, declared in
     * src/lib/help-center.ts. Filtering here is deliberately the SAME constant `loadHelpThread`
     * filters on, so the sitemap physically cannot list a URL the route refuses to serve. A
     * sitemap-only filter would have been cosmetic — the page would still have resolved for
     * everyone who already had the link, and Google had already crawled it.
     *
     * ⚠️ NO `IS_SERVICES` GATE BESIDE IT, unlike every other block in this file, and that is not
     * an omission. The other blocks are all-or-nothing route clusters; this one is a per-ROW
     * decision that only the topic list can make, and the scoped constant already encodes the
     * edition. A gate here could only turn help articles off wholesale on eno.vn, which is the
     * opposite of what is wanted — the marketplace's own 30 answers must stay indexed.
     */
    db.forumPost.findMany({
      where: { status: 'published', communitySlug: { in: HELP_TOPIC_SLUGS } },
      select: { id: true, editedAt: true, createdAt: true },
    }),
  ])

  const hostUrl = siteOrigin()

  // Freshest content date overall + per facet — the `_max.postedAt` of each aggregate group.
  const iso = (d: Date) => d.toISOString()
  const later = (a: Date | undefined, b: Date | null | undefined) => (b && (!a || b > a) ? b : a)
  const slugById = new Map(categories.map((c) => [c.id, c.slug]))
  const catMax = new Map<string, Date>()
  let siteLastmod: Date | undefined
  for (const g of byCategory) {
    const slug = slugById.get(g.categoryId)
    const max = g._max.postedAt ?? undefined
    siteLastmod = later(siteLastmod, max)
    if (slug && max) catMax.set(slug, max)
  }
  /**
   * ⚠️ MERGED BY SLUG, NOT BY STORED NAME. Two spellings of one place ("Thao Dien" / "Thảo Điền")
   * are two groups but ONE URL; the merged lastmod is the later of the two. An empty slug is not a
   * page (`/c/<cat>/`), so it is skipped rather than submitted.
   *
   * ⚠️ THE SLUG IS THE CANONICAL ONE (district-canonical.ts), NOT `slugify(stored name)`. The
   * district page now 308s every twin spelling (`quan-2`, `huyen-cu-chi`, `tp-thu-duc`) to its
   * curated key, so a slugified stored name would submit a URL that redirects. Merging on the
   * canonical slug also folds "Quận 2" and "District 2" into the one `d2` entry.
   *
   * ⚠️ THE COUNTS ARE MERGED THE SAME WAY, BEFORE THE FLOOR (rule A, above): 6 "Thảo Điền" + 4 "Thao
   * Dien" is one page of 10, not two pages of 6 and 4. Our own rows are a subset of the page's count
   * (`data.total`), so a submitted page is an indexable one — with the one gap the chips share: a
   * stored spelling that differs from a curated one only in case or diacritics ("Quan 1") is merged
   * here by its slug but missed by the page's exact LIKE (district-match.ts). Measured 2026-09-29:
   * no live stored spelling that maps to a curated slug is missed by that slug's scope.
   *
   * ⛔ RENTALS NEVER QUALIFY BY THEIR OWN COUNT (rule A). No live rental with a district is our own
   * (measured 2026-09-29: every one carries an `affiliateUrl`), so none was ever submitted; the rule
   * makes that explicit rather than an accident of the data. The rent index's rule (D3, after the
   * combo loop) is the only way a rentals district page enters this file.
   */
  const combos = new Map<string, { max?: Date; n: number }>()
  for (const g of byCombo) {
    const slug = slugById.get(g.categoryId)
    const district = g.district ? districtLinkSlug(g.district) : ''
    if (!slug || !district || slug === 'rentals') continue
    const key = `${slug}/${district}`
    const cur = combos.get(key)
    combos.set(key, { max: later(cur?.max, g._max.postedAt), n: (cur?.n ?? 0) + g._count._all })
  }
  const sellerMax = new Map<string, Date>()
  for (const g of bySeller) if (g._max.postedAt) sellerMax.set(g.sellerId, g._max.postedAt)

  // ⚠️ NO `verifiedSeller` FILTER. It used to be `where: { verifiedSeller: true }`, and NOT ONE
  // seller in the database has ever had that flag set — so this block emitted zero URLs and the
  // sitemap contained no storefronts at all. Found 2026-07-27.
  //
  // The predicate is "has a listing of its own": exactly the sellers `sellerMax` carries, which is
  // built from the submitted-listing aggregate above (SEO wave B, I2). Reading only those ids
  // (rather than every seller in the table, as it used to) is what keeps the query and the emit
  // loop from ever disagreeing about which storefronts qualify.
  const sellers = sellerMax.size
    ? await db.seller.findMany({ where: { id: { in: [...sellerMax.keys()] } }, select: { id: true, handle: { select: { handle: true } } }, orderBy: { id: 'asc' } })
    : []
  /**
   * ⛔ EACH STOREFRONT'S <loc> IS ITS PAGE'S OWN CANONICAL — `storefrontCanonical`, the function
   * `/<handle>` puts in `<link rel="canonical">` and `og:url`, and `/sellers/<id>` points at, asked
   * here of every handle at once (`storefrontCanonicals`, the same rule in two queries).
   * Before this the loop submitted `${host}/<handle>` while `eno.vn/eno-trading`, `/gmbr` and
   * `/vinwonders` canonicalised to their subdomains, so the sitemap asked for URLs the pages
   * themselves disowned (Search Console chose eno.vn/eno-trading anyway, 2026-09-28).
   *
   * ⛔ AND A STOREFRONT WHOSE CANONICAL IS A SUBDOMAIN IS LEFT OUT (decision I-b, at its default).
   * A sitemap may list only URLs on its own host unless the Search Console property covers the
   * whole domain, and which property type eno.vn has is unconfirmed. Such a shop stays linked,
   * crawlable and canonical at its subdomain; it is only not asked for here. The path canonicals
   * (a brand-slug handle; a handle whose label another handle holds; `/sellers/<id>` for a seller
   * with no handle) are submitted. ⚠️ `sdc_store` WAS ONE UNTIL I2b: its subdomain is now
   * `sdcstore.eno.vn` (owner, 2026-09-28: the handle without underscores), so it leaves this file
   * with the other subdomain shops until I-b is answered.
   */
  // Two queries for every handle at once (`storefrontCanonicals`), never two per seller.
  const siteHost = new URL(hostUrl).host
  const canonicals = await storefrontCanonicals(sellers.flatMap((s) => (s.handle ? [s.handle.handle] : [])), hostUrl)
  const sellerLocs = new Map<string, string>()
  for (const s of sellers) {
    const loc = s.handle ? canonicals.get(s.handle.handle) : `${hostUrl}/sellers/${s.id}`
    if (loc && new URL(loc).host === siteHost) sellerLocs.set(s.id, loc)
  }
  // A Date, or a string that already IS a W3C date (a guide's `2026-09-27`, the rent index's ISO stamp).
  const lm = (d?: Date | string) => (d ? `<lastmod>${typeof d === 'string' ? d : iso(d)}</lastmod>` : '')
  const urls: string[] = []

  // Main landing page
  urls.push(`  <url><loc>${hostUrl}</loc>${lm(siteLastmod)}</url>\n`)

  // Static info pages — no lastmod, deliberately (see the note at the top of this file).
  //
  // ⚠️ 'developers' JOINED THIS LIST 2026-08-23 AND ITS ABSENCE WAS THE WHOLE BUG. /developers had
  // been live and returning 200 for months, but no sitemap entry and (until the same day) no
  // inbound link from any page — so the one URL that documents this site's API was reachable only
  // by guessing it. An agent audit duly searched for "eno" developer resources and found nothing.
  // A page a crawler is never told about is, to every machine, a page that does not exist.
  //
  // Safe on BOTH editions, which is why it sits in the shared list rather than behind a gate: the
  // Partner API, the OpenAPI spec and both .well-known documents are served identically by
  // eno.vn and eno.forum (curled, 200 on every path on both hosts, 2026-08-23). Nothing on
  // /developers names a service either edition may not offer.
  //
  // ⚠️ 'contact', 'partners' AND 'legal/ranking' JOINED 2026-09-29, for the same reason: all three are
  // live, self-canonical and indexable on both editions, and none was in this list — /contact had one
  // inbound link in the whole app (the 404 page). None names a partner or a service either edition
  // may not offer.
  for (const p of ['about', 'safety', 'help', 'guide', 'trust', 'terms', 'privacy', 'regulations', 'returns', 'prohibited', 'brands', 'developers', 'contact', 'partners', 'legal/ranking']) {
    urls.push(`  <url><loc>${hostUrl}/${p}</loc></url>\n`)
  }

  /**
   * Help answers. Their own block rather than joining the static list: these have a REAL date, so
   * unlike /terms they can honestly claim one.
   *
   * ⛔ `editedAt ?? createdAt`, NOT `updatedAt` (SEO wave B, I3c) — the date /help/[id] prints as
   * `dateModified` (help-center-data.ts, `modifiedAt`). `updatedAt` moves on every write to the row:
   * a vote's score, a comment count, a view, a re-run of the help-center sync. `editedAt` is set
   * only when the answer itself changes (the edit route, and scripts/sync-help-center.ts since I3b);
   * an answer never edited since it was seeded falls back to its `createdAt`.
   */
  for (const article of helpArticles) {
    urls.push(`  <url><loc>${hostUrl}/help/${article.id}</loc>${lm(article.editedAt ?? article.createdAt)}</url>\n`)
  }

  // The Trip service's landing page. Its own entry rather than joining either group above: it is
  // not a static info page like /terms, and it does not funnel to a category like the keyword
  // pages. (It used to carry a middling <priority> to say so; that attribute is gone, and this
  // line survives only because grouping it with /terms would misdescribe what the page is.)
  // ⚠️ SERVICES EDITION ONLY — see the note on the e-visa loop below.
  if (IS_SERVICES) urls.push(`  <url><loc>${hostUrl}/itinerary</loc></url>\n`)

  /**
   * THE KEYWORD LANDINGS, EACH DATED BY WHAT IT SHOWS (SEO wave B, I3c) — one aggregate per page.
   *
   * ⛔ THEY USED TO SHARE `siteLastmod`, THE HOME PAGE'S DATE. A fresh row in ANY category dated all
   * nine landings, so the wholesale-coffee page "changed" whenever someone posted a sofa — the same
   * fabricated date the note at the top of this file removed from the static pages, nine times
   * over. Each landing is now dated by the newest row of its OWN rail, read with the rail's own
   * predicate (`seoLandingWhere`, the function `<SeoLanding>` selects with). The iPhone pages are
   * price tables, so theirs is the last write to a row they price (`updatedAt`); I3a stopped views,
   * saves and contact reveals from moving that, so a page view no longer "changes" a price page.
   *
   * ⛔ THE TARGETS ARE IMPORTED FROM THE PAGES, NOT RETYPED HERE. Hand-copying shares the FUNCTION
   * but not the VALUE: a typo ('motorbikes' for 'motorbike') counts zero, drops the URL from the
   * sitemap permanently, and fails no test. Caught in review. The iPhone scope is the model list
   * lowest-prices.ts prices (a superset of the table and the rail: every live row of those models).
   *
   * ⚠️ `gated`: THE TWO PAGES THAT ANSWER `noindex` WHEN EMPTY ARE SUBMITTED ONLY WHILE THEY HAVE
   * INVENTORY. Each computes `robots: { index: false }` when its rail is empty
   * (seo-landing-robots.ts), and submitting a URL that answers `noindex` is the "Submitted URL marked
   * noindex" error. They share the predicate, not the clock: the sitemap rebuilds on its own
   * `revalidate` and each page bakes `robots` into ISR HTML for an hour, so the first posting can be
   * submitted up to an hour before the cached page stops saying `noindex` — briefly and
   * self-correcting, in the one direction where never submitting is worse.
   *
   * ⚠️ A FAILED READ KEEPS THE URL, WITHOUT A DATE. `Promise.allSettled` means a database hiccup
   * neither drops a real page (treating "could not look" as "empty") nor invents a date for it.
   */
  type Landing = { path: string; where: object; by: 'postedAt' | 'updatedAt'; gated?: boolean }
  const railLanding = (path: string, target: SeoLandingTarget, gated = false): Landing =>
    ({ path, where: seoLandingWhere(target), by: 'postedAt', gated })
  const priceLanding = (path: string, models: readonly string[]): Landing =>
    ({ path, where: { verified: true, status: 'active', model: { in: [...models] } }, by: 'updatedAt' })
  const LANDINGS: Landing[] = [
    railLanding('housing-vietnam-expats', HOUSING_TARGET),
    // Product pages, not category funnels — they rank for "iPhone 18 price Vietnam" and link into
    // the phone listings. Both editions: marketplace commerce copy, like the coffee page below and
    // unlike anything licensed. The hub prices both Pro models and the Duo.
    priceLanding('iphone-18-vietnam', [...IPHONE_18_MODELS, IPHONE_DUO_MODEL]),
    // One page per model so each ranks for its own query; the path is the model's own name
    // (`iPhone 18 Pro` → /iphone-18-pro-vietnam), and sitemap.test.ts pins that each page prices it.
    ...[...IPHONE_18_MODELS, IPHONE_DUO_MODEL].map((m) => priceLanding(iphoneModelPath(m), [m])),
    railLanding('jobs-vietnam-expats', JOBS_TARGET, true),
    railLanding('motorbikes-for-sale-vietnam', MOTORBIKE_TARGET, true),
    railLanding('moving-sales-vietnam', MOVING_SALES_TARGET),
    // Marketplace commerce copy, not a licensed service — both editions, no IS_SERVICES gate.
    railLanding('wholesale-green-coffee-vietnam', COFFEE_TARGET),
  ]
  const [landingReads, rentIndex] = await Promise.all([
    Promise.allSettled(
      LANDINGS.map(async (l) =>
        db.listing.aggregate({ where: await scopedListingWhere(l.where), _max: { postedAt: true, updatedAt: true }, _count: { _all: true } }),
      ),
    ),
    /**
     * ⚠️ THE RENT INDEX IS DATED BY ITS OWN SNAPSHOT (`computedAt`), the date the page prints and
     * its Dataset's `dateModified` — never a listing's. MARKETPLACE ONLY, for the reason the
     * `hcmc-rent-index` entry below gives: on the services build the route 404s, so the snapshot is
     * not even read there (order rule 4).
     * ⛔ NO TIMEOUT AND NO CATCH (D3). `loadRentIndex()` already turns a failed read into `known:
     * false`; what it does not catch is a bug, and that fails the build like any other read here. A
     * race would turn a slow snapshot into a missing one, and a missing one now throws (below).
     */
    IS_SERVICES ? null : loadRentIndex(),
  ])
  // ⛔ AN UNKNOWN SNAPSHOT: THE ROUTE THROWS, INDEXNOW FREEZES (see `rentIndex` at the top of this file).
  // Never on eno.forum, which reads none and lists none of these URLs.
  if (opts.rentIndex === 'require' && !IS_SERVICES && !rentIndex?.known) throw new RentIndexUnavailable()
  const frozen = opts.rentIndex === 'optional' && !IS_SERVICES && !rentIndex?.known ? [...RENT_FROZEN_PATHS] : []
  for (const [i, l] of LANDINGS.entries()) {
    const r = landingReads[i]
    if (r.status === 'fulfilled') {
      if (l.gated && r.value._count._all === 0) continue
      urls.push(`  <url><loc>${hostUrl}/${l.path}</loc>${lm(r.value._max[l.by] ?? undefined)}</url>\n`)
    } else {
      urls.push(`  <url><loc>${hostUrl}/${l.path}</loc></url>\n`)
    }
  }
  // ⚠️ SERVICES EDITION ONLY. Two thirds of this page is e-visa and trip-planning copy, so on the
  // licensed marketplace it must not be submitted to Google — see the note below. No date: its
  // copy is static and its rails span every desk the edition sells.
  if (IS_SERVICES) urls.push(`  <url><loc>${hostUrl}/services-for-expats-vietnam</loc></url>\n`)
  /**
   * ⚠️ THE RENT INDEX IS OUR OWN ANALYSIS, SO THE 2026-09-17 RULE DOES NOT KEEP IT OUT. That rule
   * withholds IMPORTED LISTING URLs from the sitemap — pages that restate another site's advert.
   * This page publishes statistics computed here that no source publishes, which is the kind of
   * original content the rule was protecting the domain's standing for. MARKETPLACE ONLY: the
   * route 404s on the services build (see its page.tsx), and a sitemap must not submit a 404.
   */
  // Known here unless frozen (`'optional'` mode) or eno.forum (never read): the throw above covers the route.
  if (rentIndex?.known) {
    urls.push(`  <url><loc>${hostUrl}/hcmc-rent-index</loc>${lm(rentIndex.index.computedAt)}</url>\n`)
  }

  // The e-visa cluster: the /vietnam-evisa hub and its long-tail children.
  //
  // ⚠️ IMPORTED, NOT RETYPED. The list above is hard-coded, which is exactly how a landing page
  // ships and is then never submitted — the route exists, the sitemap does not know, and nothing
  // fails. `SERVICES_SITEMAP_PATHS` re-exports the list derived from the same EVISA_CHILDREN array the hub renders
  // its links from, so adding a child adds it here too. The paths still carry `siteLastmod`, the
  // home page's date: the keyword landings above moved to their own rail's date in SEO wave B
  // (I3c), and these services-only pages have not had that change yet.
  /**
   * ⚠️ THREE SEPARATE EMISSIONS HAD TO BE GATED, NOT ONE, AND THIS IS THE ONLY OBVIOUS ONE.
   * The /itinerary line above and 'services-for-expats-vietnam' in the static array are the other
   * two; closing only this loop would leave the licensed marketplace still submitting a trip
   * service and a page that is two-thirds e-visa copy to Google.
   *
   * The sitemap is not a passive document — it is eno.vn actively ASKING Google to index these
   * URLs. On a licensed sàn TMĐT that may not offer visa services, that is the most active form of
   * advertising one on the whole site.
   */
  if (IS_SERVICES) {
    for (const path of SERVICES_SITEMAP_PATHS) {
      urls.push(`  <url><loc>${hostUrl}${path}</loc>${lm(siteLastmod)}</url>\n`)
    }
  }

  // The long-form arrival guides (/moving-to-vietnam, /first-month-in-vietnam).
  //
  // ⚠️ IMPORTED FROM A REGISTRY, FOR THE REASON THE BLOCK ABOVE SPELLS OUT — and gated for the
  // reason the e-visa block is: these are `page.svc.tsx` routes, so on a marketplace build they do
  // not exist and submitting them would be asking Google to index two 404s. `EXPAT_GUIDE_PATHS` is
  // deliberately free of services vocabulary so this shared file can import it without an alias;
  // src/lib/expat-guides.ts explains the constraint that puts on what may be written there.
  //
  // ⚠️ NEVER `siteLastmod` HERE. These are static editorial with no data behind them, so claiming
  // they changed whenever any listing did would be the same fabricated date the note at the top of
  // this file removed from the static pages. Since SEO wave B (I3c) each guide carries the date its
  // own page prints (`guideLastmod`: the registry's `updated ?? published`), and so do the two
  // blocks below.
  if (IS_SERVICES) {
    for (const path of EXPAT_GUIDE_PATHS) {
      urls.push(`  <url><loc>${hostUrl}${path}</loc>${lm(guideLastmod(path.slice(1)))}</url>\n`)
    }
  }

  // The MARKETPLACE guides, and note the missing gate: unlike the block above, these are ordinary
  // `page.tsx` routes that exist on BOTH editions, so both submit them from their own host — the same
  // arrangement the keyword landings already have. Each is dated by its own page's printed
  // `dateModified` (`guideLastmod`), never by the listings, for the reason just above.
  // ⚠️ EXCEPT A VEHICLE-HIRE HUB WITH NOTHING LIVE: it serves `noindex` then, and submitting a noindex
  // URL is a Search Console error. One count per kind; the hubs' own predicate (src/lib/vehicle-hubs.ts).
  const hubLive = new Map<string, number>()
  // ⚠️ FAIL OPEN: a failed count submits the hub rather than 500ing the whole pages sitemap — the same
  // trade seoLandingRobots makes (an outage must never silently drop every page URL).
  for (const kind of ['car', 'motorbike'] as const) hubLive.set(kind, await vehicleHubLiveCount(kind).catch(() => 1))
  for (const path of MARKETPLACE_GUIDE_PATHS) {
    const hubKind = VEHICLE_HUB_KIND_BY_SLUG[path.slice(1)]
    if (hubKind && !hubLive.get(hubKind)) continue
    // A hub prints its newest listing change as dateModified, which only its own load knows: no lastmod.
    urls.push(`  <url><loc>${hostUrl}${path}</loc>${hubKind ? '' : lm(guideLastmod(path.slice(1)))}</url>\n`)
  }

  /**
   * The bilingual phone-buying cluster. Both languages are submitted from BOTH hosts, like every
   * other `page.tsx` guide — each self-canonicalises to its own origin, and the two languages of a
   * topic declare each other with reciprocal hreflang on the pages themselves.
   *
   * ⚠️ ONE LIST, because sixteen routes across the sitemap AND the reserved-handle set is
   * thirty-two chances to forget one. Adding an entry to PHONE_GUIDES adds it to both.
   */
  for (const path of PHONE_GUIDE_PATHS) {
    urls.push(`  <url><loc>${hostUrl}/${path}</loc>${lm(guideLastmod(path))}</url>\n`)
  }

  // Indexing decoupled from PRELAUNCH (owner, 2026-07-18): the full data-driven
  // sitemap ships while the MoIT test-operation notice still shows. The sitewide
  // noindex header in next.config.ts was removed the same day.
  // Faceted category pages (programmatic SEO entry points)
  //
  // ⚠️ PRESENCE OF ANY LIVE LISTING, imports included (unlike the seller block below, which counts
  // only our own since I2): a category with no live listing is a thin page (it serves `noindex`
  // once it has been empty for 14 days — I1b), so it is not submitted, and the moment one listing
  // lands it reappears on the next revalidate.
  /**
   * ⚠️ PRESENCE, NOT A COUNT COMPARISON — `groupBy` never returns a zero-count group, so a
   * `_count._all > 0` filter would be dead code that reads like a real guard (opus).
   *
   * ⚠️ AND THE PREDICATE IS THE PAGE'S OWN, VERIFIED RATHER THAN ASSUMED. `/c/<slug>` decides
   * `robots: { index: false }` from `loadCategory`'s
   * `count({ scopedListingWhere({ categoryId, verified: true, status: 'active' }) })` being 0 (for
   * 14 days since I1b, src/lib/stale-noindex.ts). `byCategory` above is that same predicate grouped
   * instead of counted per category, so a submitted category always has a live listing and is
   * never `noindex`; an empty one inside the 14 days is indexable but unsubmitted. A stricter
   * predicate here would drop good pages; a looser one would keep submitting the dead ends.
   */
  const liveCategoryIds = new Set(byCategory.map((g) => g.categoryId))
  for (const c of categories) {
    if (!liveCategoryIds.has(c.id)) continue
    urls.push(`  <url><loc>${hostUrl}/c/${c.slug}</loc>${lm(catMax.get(c.slug))}</url>\n`)
  }

  // Faceted category × district pages — only at the floor of own listings (rule A, above).
  for (const [combo, { max, n }] of combos) {
    if (!isIndexableCount(n)) continue
    urls.push(`  <url><loc>${hostUrl}/c/${combo}</loc>${lm(max)}</url>\n`)
  }

  /**
   * ⛔ RULE A, SECOND HALF: RENTALS DISTRICT PAGES THAT CARRY THE RENT BLOCK (SEO wave B, D3; decision
   * D-c). The owner's rule for imported stock is "add value then to those pages": they stay crawlable
   * and linked, and are submitted once they carry something of our own. D2's block is that — figures
   * computed here — and it is why `/hcmc-rent-index` is already submitted above. See
   * `submittedRentalsDistricts` for the rule and what it guarantees. NO `<lastmod>`: the page shows
   * imported listings and a snapshot whose `computedAt` moves daily even when no figure does, so any
   * date would be the fabricated kind this file removed elsewhere; IndexNow then pings these only on
   * addition or removal. Marketplace only: eno.forum reads no snapshot, so `rentIndex` is null there.
   */
  const rentalsId = categories.find((c) => c.slug === 'rentals')?.id
  if (rentIndex?.known && rentalsId) {
    for (const slug of await submittedRentalsDistricts(rentIndex.index, rentalsId)) {
      urls.push(`  <url><loc>${hostUrl}/c/rentals/${slug}</loc></url>\n`)
    }
  }

  // Seller storefronts, each at its page's own canonical (`sellerLocs`, above): the handle's
  // canonical, or /sellers/{id} for a handle-less seller.
  for (const s of sellers) {
    // ⚠️ THE PREDICATE, and it is `sellerMax` rather than a flag. A storefront with no listing of its
    // own is not submitted — an empty grid, or a grid of links out (I2); the moment that seller has
    // one live listing of its own, they appear here. The query above already reads only these ids;
    // the check stays so the emit loop cannot drift from the map the lastmod comes from.
    const loc = sellerLocs.get(s.id)
    if (!loc || !sellerMax.has(s.id)) continue
    urls.push(`  <url><loc>${loc}</loc>${lm(sellerMax.get(s.id))}</url>\n`)
  }

  /**
   * ⛔ NO LISTING URLS IN THIS FILE — they live in /sitemaps/listings-<k>.xml, paged so that no
   * cap can truncate them (src/lib/sitemap.ts). The rule for WHICH listings is unchanged and is
   * `submittedListingWhere()` there; its reasoning is kept here, where it was written:
   *
   * ⛔ IMPORTED LISTINGS ARE CRAWLABLE BUT NOT SUBMITTED, AND THE NUMBERS ARE WHY. Measured
   * 2026-09-17: this file was asking Google to index 45,000 listing URLs and Search Console had
   * indexed 756 of them — 1.7%. Of the 82,130 live sale listings, 82,084 carry an `affiliateUrl`:
   * they are a third-party catalogue (Tiki, Thế Giới Di Động, CellphoneS…) republished here with
   * a link out, and eno.forum submits the SAME 44,999 ids, so the pair asked for ~90,000 URLs of
   * one borrowed catalogue. Google's spam policy names that shape directly — aggregator pages
   * that add nothing beyond the source data — and the August 2026 update moved enforcement from
   * ranking suppression to removal from the index. 756/45,117 is that policy working, not a crawl
   * bug, and it is a judgement about the WHOLE domain: the 77 listings that are genuinely ours and
   * the editorial pages pay for it too.
   *
   * ⚠️ NOT `noindex`, AND THE DIFFERENCE IS THE POINT (owner, 2026-09-17: "add value then to those
   * pages"). These pages stay 200, stay linked, stay crawlable, and stay eligible the day they
   * carry something of their own — a live floor price across every retailer that stocks the
   * model, the way /iphone-18-vietnam does. All that changes is that we stop ASKING for 45,000 of
   * them. A sitemap is a request, and this one was spending the domain's credibility on pages we
   * would not defend. The same holds for the property reference imports (Batdongsan, Rever,
   * nhatot, muaban, Honeycomb): every row carries the source's `affiliateUrl`.
   */
  return { xml: urlsetXml(urls, 'pages.xml'), frozen }
}
