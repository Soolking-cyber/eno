import { scopedListingWhere } from '@/lib/edition-scope'
import { IS_SERVICES } from '@/lib/edition'
import { db } from '@/lib/db'
// ⚠️ VIA THE ALIASED MODULE, NOT `@/app/[lang]/vietnam-evisa/links` DIRECTLY. This route compiles on BOTH
// editions, and that module is a plain `.ts` — `pageExtensions` excludes its `page.svc.tsx`
// neighbours but not it — so importing it here put every e-visa label and blurb in eno.vn's server
// bundle. The IS_SERVICES gate below stopped the URLs being emitted; it could not remove the
// strings. `@/lib/edition-services-copy` is aliased to an empty stub on a marketplace build, so the
// import is severed there. See the note on SERVICES_SITEMAP_PATHS in that module.
import { SERVICES_SITEMAP_PATHS } from '@/lib/edition-services-copy'
import { EXPAT_GUIDE_PATHS, MARKETPLACE_GUIDE_PATHS } from '@/lib/expat-guides'
import { vehicleHubLiveCount, VEHICLE_HUB_KIND_BY_SLUG } from '@/lib/vehicle-hubs'
import { PHONE_GUIDE_PATHS } from '@/lib/phone-guides'
import { HELP_TOPIC_SLUGS } from '@/lib/help-center'
import { seoLandingWhere } from '@/components/marketplace/seo-landing-where'
import { LANDING_TARGET as JOBS_TARGET } from '@/app/[lang]/jobs-vietnam-expats/landing-target'
import { LANDING_TARGET as MOTORBIKE_TARGET } from '@/app/[lang]/motorbikes-for-sale-vietnam/landing-target'
import { districtLinkSlug } from '@/lib/district-canonical'
import { isIndexableCount } from '@/lib/index-floor'
import { submittedListingWhere, urlsetXml, xmlResponse, siteOrigin } from '@/lib/sitemap'
import { storefrontCanonicals } from '@/lib/storefront'
import { NextResponse } from 'next/server'

/**
 * /sitemaps/pages.xml — EVERY SUBMITTED URL THAT IS NOT A LISTING. It was the body of /sitemap.xml
 * until 2026-09-24, when that became a sitemap INDEX (src/lib/sitemap.ts says why). The listing URLs
 * moved to /sitemaps/listings-<k>.xml; everything else is here, with one real change: the category
 * lastmods, the category × district combos and the storefront URLs are derived from whole-table
 * GROUP BYs instead of the newest 45,000 rows, so a bulk import can no longer push older stock's
 * districts and sellers out of the sitemap.
 */

// Cache the generated sitemap instead of rebuilding it (DB query over all listings
// + a serverless cold start) on every request — that ~6s response was timing out
// Google's fetcher ("Couldn't fetch"). ISR revalidates every 24h in the background
// (plus a 1h CDN s-maxage below), so Google always gets a fast, already-built XML.
export const revalidate = 86400

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

export async function GET() {
  try {
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
       * table and cannot be fooled by a cap; `_max.updatedAt` is exactly the "first row seen in
       * updatedAt-desc order" the old loop computed.
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
        where: await scopedListingWhere({ verified: true, status: 'active' }),
        _max: { updatedAt: true },
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
       * ⛔ RULE A, THE ONE SITEMAP RULE FOR DISTRICT PAGES (SEO wave B, I1; decision I-a): a
       * category × district page is submitted only with at least MIN_INDEXABLE_LISTINGS (10) of our
       * OWN listings, summed across every stored spelling of the place, and NEVER for `rentals` by
       * that count. One own listing used to be enough, which submitted pages of one to nine cards
       * (`/c/services/an-khanh`: "Crawled - currently not indexed"). `_count` is the tally; the
       * floor is applied after the spellings are merged, in the combo loop below. A page under the
       * floor still answers 200 — as `noindex, follow` after 14 days below 10 listings of ANY kind,
       * indexable but unsubmitted otherwise (the page counts imports too, src/lib/index-floor.ts).
       */
      // edition-lint-allow: `submittedListingWhere()` IS `scopedListingWhere(...)` AND-ed with the
      // affiliate exclusion (src/lib/sitemap.ts) — the edition scope is inside the helper.
      db.listing.groupBy({
        by: ['categoryId', 'district'],
        where: await submittedListingWhere({ district: { not: null } }),
        _max: { updatedAt: true },
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
        _max: { updatedAt: true },
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
        select: { id: true, updatedAt: true },
      }),
    ])

    const hostUrl = siteOrigin()

    // Freshest content date overall + per facet — the `_max.updatedAt` of each aggregate group.
    const iso = (d: Date) => d.toISOString()
    const later = (a: Date | undefined, b: Date | null | undefined) => (b && (!a || b > a) ? b : a)
    const slugById = new Map(categories.map((c) => [c.id, c.slug]))
    const catMax = new Map<string, Date>()
    let siteLastmod: Date | undefined
    for (const g of byCategory) {
      const slug = slugById.get(g.categoryId)
      const max = g._max.updatedAt ?? undefined
      siteLastmod = later(siteLastmod, max)
      if (slug && max) catMax.set(slug, max)
    }
    /**
     * ⚠️ MERGED BY SLUG, NOT BY STORED NAME. Two spellings of one place ("Thao Dien" / "Thảo Điền")
     * are two groups but ONE URL; the merged lastmod is the later of the two, which is what the old
     * first-seen-in-updatedAt-desc walk produced. An empty slug is not a page (`/c/<cat>/`), so it is
     * skipped rather than submitted.
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
     * makes that explicit rather than an accident of the data, before the first own rentals in one
     * district would submit a page the rent index's rule (SEO wave B, D3) is meant to decide.
     */
    const combos = new Map<string, { max?: Date; n: number }>()
    for (const g of byCombo) {
      const slug = slugById.get(g.categoryId)
      const district = g.district ? districtLinkSlug(g.district) : ''
      if (!slug || !district || slug === 'rentals') continue
      const key = `${slug}/${district}`
      const cur = combos.get(key)
      combos.set(key, { max: later(cur?.max, g._max.updatedAt), n: (cur?.n ?? 0) + g._count._all })
    }
    const sellerMax = new Map<string, Date>()
    for (const g of bySeller) if (g._max.updatedAt) sellerMax.set(g.sellerId, g._max.updatedAt)

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
     * (`sdc_store`, whose underscore cannot be a host label; a brand-slug handle; `/sellers/<id>`
     * for a seller with no handle) are submitted.
     */
    // Two queries for every handle at once (`storefrontCanonicals`), never two per seller.
    const siteHost = new URL(hostUrl).host
    const canonicals = await storefrontCanonicals(sellers.flatMap((s) => (s.handle ? [s.handle.handle] : [])), hostUrl)
    const sellerLocs = new Map<string, string>()
    for (const s of sellers) {
      const loc = s.handle ? canonicals.get(s.handle.handle) : `${hostUrl}/sellers/${s.id}`
      if (loc && new URL(loc).host === siteHost) sellerLocs.set(s.id, loc)
    }
    const lm = (d?: Date) => (d ? `<lastmod>${iso(d)}</lastmod>` : '')
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
    for (const p of ['about', 'safety', 'help', 'guide', 'trust', 'terms', 'privacy', 'regulations', 'returns', 'prohibited', 'brands', 'developers']) {
      urls.push(`  <url><loc>${hostUrl}/${p}</loc></url>\n`)
    }

    // Help answers. Their own block rather than joining the static list: these have a REAL
    // updatedAt, so unlike /terms they can honestly claim one.
    for (const article of helpArticles) {
      urls.push(`  <url><loc>${hostUrl}/help/${article.id}</loc>${lm(article.updatedAt)}</url>\n`)
    }

    // The Trip service's landing page. Its own entry rather than joining either group above: it is
    // not a static info page like /terms, and it does not funnel to a category like the keyword
    // pages. (It used to carry a middling <priority> to say so; that attribute is gone, and this
    // line survives only because grouping it with /terms would misdescribe what the page is.)
    // ⚠️ SERVICES EDITION ONLY — see the note on the e-visa loop below.
    if (IS_SERVICES) urls.push(`  <url><loc>${hostUrl}/itinerary</loc></url>\n`)

    /**
     * WHICH KEYWORD LANDINGS CURRENTLY HAVE NOTHING TO SHOW.
     *
     * ⚠️ IT MIRRORS EACH PAGE'S OWN `robots` DECISION rather than re-deriving one — the same
     * narrowing, through `seoLandingWhere`, so the two cannot disagree about WHICH listings count.
     *
     * ⛔ THEY SHARE THE PREDICATE, NOT THE CLOCK, AND AN EARLIER DRAFT OF THIS COMMENT CLAIMED
     * OTHERWISE. This sitemap is rebuilt on its own `revalidate`; each page bakes its `robots` tag
     * into ISR HTML with `revalidate = 3600`. So when the first motorbike is posted the sitemap can
     * start submitting the URL while the cached page still answers `noindex` for up to an hour —
     * the "Submitted URL marked noindex" warning, briefly and self-correcting, in the ONE direction
     * where the alternative (never submitting) is worse. Both reviewers caught the overclaim.
     *
     * ⚠️ A FAILED COUNT SUBMITS THE PAGE. `Promise.allSettled` and the `?? 1` below mean a database
     * hiccup leaves the URL in the sitemap, which is the pre-existing behaviour; treating "could not
     * look" as "empty" would silently drop real pages out of the index on one bad build.
     */
    const GATED_LANDINGS = [
      // ⛔ THE TARGETS ARE IMPORTED FROM THE PAGES, NOT RETYPED HERE. Hand-copying shares the
      // FUNCTION but not the VALUE: a typo ('motorbikes' for 'motorbike') counts zero, drops the
      // URL from the sitemap permanently, and fails no test. Caught in review.
      { path: 'jobs-vietnam-expats', target: JOBS_TARGET },
      { path: 'motorbikes-for-sale-vietnam', target: MOTORBIKE_TARGET },
    ]
    const landingCounts = await Promise.allSettled(
      GATED_LANDINGS.map(async (l) =>
        db.listing.count({ where: await scopedListingWhere(seoLandingWhere(l.target)) }),
      ),
    )
    const emptyLandings = new Set(
      GATED_LANDINGS.filter((l, i) => {
        const r = landingCounts[i]
        return (r.status === 'fulfilled' ? r.value : 1) === 0
      }).map((l) => l.path),
    )

    // SEO keyword landing pages (funnel to categories → track the site's freshest content)
    for (const p of [
      'housing-vietnam-expats',
      // A product page, not a category funnel — it ranks for "iPhone 18 price Vietnam" and links
      // into the phone listings. Both editions: it is marketplace commerce copy, like the coffee
      // page below and unlike anything licensed.
      'iphone-18-vietnam',
      // Per-model siblings of the page above — same reasoning, one page per variant so each ranks
      // for its own query rather than three of them competing inside one document.
      'iphone-18-pro-vietnam',
      'iphone-18-pro-max-vietnam',
      'iphone-duo-vietnam',
      /**
       * ⛔ THESE TWO ARE SUBMITTED ONLY WHILE THEY HAVE INVENTORY — see `emptyLandings` above.
       * Each computes `robots: { index: false }` when its rail is empty (seo-landing-robots.ts), and
       * submitting a URL that answers `noindex` is the "Submitted URL marked noindex" error this
       * same file just stopped producing for empty CATEGORIES. Measured 2026-09-23: `jobs` holds 0
       * listings and `vehicles/motorbike` holds 0, so both are suppressed today and both return the
       * moment somebody posts.
       */
      ...(emptyLandings.has('jobs-vietnam-expats') ? [] : ['jobs-vietnam-expats']),
      ...(emptyLandings.has('motorbikes-for-sale-vietnam') ? [] : ['motorbikes-for-sale-vietnam']),
      'moving-sales-vietnam',
      // Marketplace commerce copy, not a licensed service — it ships on BOTH editions like any
      // other listing surface, so no IS_SERVICES gate here.
      'wholesale-green-coffee-vietnam',
      // ⚠️ SERVICES EDITION ONLY. Two thirds of this page is e-visa and trip-planning copy, so on
      // the licensed marketplace it must not be submitted to Google — see the note below.
      ...(IS_SERVICES ? ['services-for-expats-vietnam'] : []),
      /**
       * ⚠️ THE RENT INDEX IS OUR OWN ANALYSIS, SO THE 2026-09-17 RULE DOES NOT KEEP IT OUT. That rule
       * withholds IMPORTED LISTING URLs from the sitemap — pages that restate another site's advert.
       * This page publishes statistics computed here that no source publishes, which is the kind of
       * original content the rule was protecting the domain's standing for. MARKETPLACE ONLY: the
       * route 404s on the services build (see its page.tsx), and a sitemap must not submit a 404.
       */
      ...(IS_SERVICES ? [] : ['hcmc-rent-index']),
    ]) {
      urls.push(`  <url><loc>${hostUrl}/${p}</loc>${lm(siteLastmod)}</url>\n`)
    }

    // The e-visa cluster: the /vietnam-evisa hub and its long-tail children.
    //
    // ⚠️ IMPORTED, NOT RETYPED. The list above is hard-coded, which is exactly how a landing page
    // ships and is then never submitted — the route exists, the sitemap does not know, and nothing
    // fails. `SERVICES_SITEMAP_PATHS` re-exports the list derived from the same EVISA_CHILDREN array the hub renders
    // its links from, so adding a child adds it here too. The paths carry `siteLastmod` for the
    // same reason the block above does: their listing rails track the site's freshest content.
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
    // ⚠️ NO `siteLastmod` HERE, unlike the e-visa paths. Those carry it because their listing rails
    // track the site's freshest content; these are static editorial with no data behind them, so
    // claiming they changed whenever any listing did would be the same fabricated date the note at
    // the top of this file removed from the static pages.
    if (IS_SERVICES) {
      for (const path of EXPAT_GUIDE_PATHS) {
        urls.push(`  <url><loc>${hostUrl}${path}</loc></url>\n`)
      }
    }

    // The MARKETPLACE guides, and note the missing gate: unlike the block above, these are ordinary
    // `page.tsx` routes that exist on BOTH editions, so both submit them from their own host — the same
    // arrangement the five keyword landings already have. No lastmod, for the reason just above: they
    // are static editorial with no data behind them.
    // ⚠️ EXCEPT A VEHICLE-HIRE HUB WITH NOTHING LIVE: it serves `noindex` then, and submitting a noindex
    // URL is a Search Console error. One count per kind; the hubs' own predicate (src/lib/vehicle-hubs.ts).
    const hubLive = new Map<string, number>()
    // ⚠️ FAIL OPEN: a failed count submits the hub rather than 500ing the whole pages sitemap — the same
    // trade seoLandingRobots makes (an outage must never silently drop every page URL).
    for (const kind of ['car', 'motorbike'] as const) hubLive.set(kind, await vehicleHubLiveCount(kind).catch(() => 1))
    for (const path of MARKETPLACE_GUIDE_PATHS) {
      const hubKind = VEHICLE_HUB_KIND_BY_SLUG[path.slice(1)]
      if (hubKind && !hubLive.get(hubKind)) continue
      urls.push(`  <url><loc>${hostUrl}${path}</loc></url>\n`)
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
      urls.push(`  <url><loc>${hostUrl}/${path}</loc></url>\n`)
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
    return xmlResponse(urlsetXml(urls, 'pages.xml'))
  } catch (error) {
    console.error('Failed to generate sitemaps/pages.xml:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
