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
import { PHONE_GUIDE_PATHS } from '@/lib/phone-guides'
import { HELP_TOPIC_SLUGS } from '@/lib/help-center'
import { slugify } from '@/lib/slug'
import { NextResponse } from 'next/server'

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
    const [listings, ownListings, categories, liveByCategory, sellers, helpArticles] = await Promise.all([
      /**
       * ⚠️ SCOPED HERE AND NOWHERE ELSE, DELIBERATELY. The category maxima, the category/district
       * combos and the seller-storefront URLs further down are all DERIVED from exactly these rows,
       * so this one predicate drops the desk's 15 listings, its /eno_visa storefront entry and the
       * /c/services/... combos it alone generated. Filtering at the emit loop instead would leave
       * all three behind.
       *
       * A sitemap is not a passive document — it is eno.vn actively asking Google to index these
       * URLs, which on a licensed sàn TMĐT is the most active way to advertise a service it may not
       * sell.
       */
      db.listing.findMany({
        where: await scopedListingWhere({ verified: true, status: 'active' }),
        select: { id: true, updatedAt: true, district: true, sellerId: true, category: { select: { slug: true } } },
        orderBy: { updatedAt: 'desc' },
        // Sitemap protocol caps a file at 50k URLs — leave headroom for the
        // category/combo/seller/static entries above the listing block.
        take: 45000,
      }),
      /**
       * ⛔ A SECOND QUERY, NOT A FILTER OVER THE FIRST — all three reviewers refused the filter and
       * they were right. The row above is capped at 45,000 and ordered `updatedAt: 'desc'`, and
       * 82,084 of the 82,130 live sale listings are imported: one affiliate sync that touches
       * `updatedAt` fills the whole window, and an in-memory `continue` would then emit ZERO of our
       * own listings while reporting nothing wrong. The 37 that survive today do so by luck of
       * ordering, which is not a property to ship.
       * ⚠️ IT IS A DIFFERENT QUESTION FROM THE ONE ABOVE, WHICH IS WHY IT IS A DIFFERENT QUERY. That
       * row answers "what is live here" and feeds the category maxima, the district combos and the
       * storefront URLs — all of which SHOULD count imported stock, because a category with 9,726
       * live products is a real page. This row answers "what do we ask Google to index", and the
       * answer is only what is ours. Same scope predicate, so the edition boundary holds on both.
       */
      db.listing.findMany({
        /**
         * ⚠️ NESTED IN AN `AND`, NOT SPREAD ALONGSIDE — two reviewers asked whether the extra key
         * could overwrite part of the edition scope, and the honest answer is "not today".
         * `scopedListingWhere` returns either the bare `where` or `{ AND: [where, { sellerId }] }`,
         * so a spread happens to be safe right now; it stops being safe the day that helper grows a
         * key this one also sets. Wrapping cannot collide whatever it returns, and it costs nothing.
         */
        where: { AND: [await scopedListingWhere({ verified: true, status: 'active' }), { affiliateUrl: null }] },
        select: { id: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 45000,
      }),
      db.category.findMany({ select: { slug: true, id: true } }),
      /**
       * ⛔ WHICH CATEGORIES ACTUALLY HAVE A LIVE LISTING — ITS OWN UNBOUNDED AGGREGATE, NOT A READ
       * OF `catMax`. `/c/<slug>` serves `noindex, follow` when its category is empty, so submitting
       * one asks Google to index a page that tells it not to. Measured in Search Console: the four
       * empty categories (`property`, `moving-sale`, `jobs`, `community-events`) were drawing 80
       * impressions across 27 submitted URLs, all of them dead ends.
       *
       * ⚠️ IT CANNOT BE DERIVED FROM `catMax`, AND THAT IS THE WHOLE REASON THIS QUERY EXISTS. The
       * row above is capped at `take: 45000` over ~98,700 live listings ordered by `updatedAt desc`,
       * so a small, rarely-touched category (books-stationery is 426 listings) can fall entirely
       * outside the window — and a guard reading that map would then drop a perfectly good category
       * page from the sitemap, silently, with the set changing on every affiliate sync. A `groupBy`
       * counts the whole table and cannot be fooled by the cap.
       */
      db.listing.groupBy({
        by: ['categoryId'],
        where: await scopedListingWhere({ verified: true, status: 'active' }),
        _count: { _all: true },
      }),
      // ⚠️ NO `verifiedSeller` FILTER. It used to be `where: { verifiedSeller: true }`, and NOT ONE
      // seller in the database has ever had that flag set — so this block emitted zero URLs and the
      // sitemap contained no storefronts at all. The visible cost was concrete: /eno_visa, which
      // holds 14 of the 34 live listings, was in no sitemap and (until the footer fix in this same
      // change) behind no working link either. Found 2026-07-27.
      //
      // The right predicate is "has something to show", which is decided below against `sellerMax`
      // — a set built from the EXACT listing rows this sitemap emits. Deriving it from that set
      // rather than re-querying is what keeps the two blocks from ever disagreeing about which
      // listings are live.
      db.seller.findMany({ select: { id: true, handle: { select: { handle: true } } } }),
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

    const hostUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'

    // Freshest content date overall + per facet. Listings are ordered updatedAt
    // desc, so the FIRST time we see a key, that's its max — use it as <lastmod>.
    const iso = (d: Date) => d.toISOString()
    const siteLastmod = listings[0]?.updatedAt
    const catMax = new Map<string, Date>()
    const comboMax = new Map<string, Date>()
    const sellerMax = new Map<string, Date>()
    for (const l of listings) {
      if (!catMax.has(l.category.slug)) catMax.set(l.category.slug, l.updatedAt)
      if (l.district) {
        const combo = `${l.category.slug}/${slugify(l.district)}`
        if (!comboMax.has(combo)) comboMax.set(combo, l.updatedAt)
      }
      if (!sellerMax.has(l.sellerId)) sellerMax.set(l.sellerId, l.updatedAt)
    }
    const lm = (d?: Date) => (d ? `<lastmod>${iso(d)}</lastmod>` : '')

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <!-- Main landing page -->
  <url>
    <loc>${hostUrl}</loc>
    ${siteLastmod ? `<lastmod>${iso(siteLastmod)}</lastmod>` : ''}
  </url>
`

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
      xml += `  <url><loc>${hostUrl}/${p}</loc></url>\n`
    }

    // Help answers. Their own block rather than joining the static list: these have a REAL
    // updatedAt, so unlike /terms they can honestly claim one.
    for (const article of helpArticles) {
      xml += `  <url><loc>${hostUrl}/help/${article.id}</loc>${lm(article.updatedAt)}</url>\n`
    }

    // The Trip service's landing page. Its own entry rather than joining either group above: it is
    // not a static info page like /terms, and it does not funnel to a category like the keyword
    // pages. (It used to carry a middling <priority> to say so; that attribute is gone, and this
    // line survives only because grouping it with /terms would misdescribe what the page is.)
    // ⚠️ SERVICES EDITION ONLY — see the note on the e-visa loop below.
    if (IS_SERVICES) xml += `  <url><loc>${hostUrl}/itinerary</loc></url>\n`

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
      'jobs-vietnam-expats',
      'motorbikes-for-sale-vietnam',
      'moving-sales-vietnam',
      // Marketplace commerce copy, not a licensed service — it ships on BOTH editions like any
      // other listing surface, so no IS_SERVICES gate here.
      'wholesale-green-coffee-vietnam',
      // ⚠️ SERVICES EDITION ONLY. Two thirds of this page is e-visa and trip-planning copy, so on
      // the licensed marketplace it must not be submitted to Google — see the note below.
      ...(IS_SERVICES ? ['services-for-expats-vietnam'] : []),
    ]) {
      xml += `  <url><loc>${hostUrl}/${p}</loc>${lm(siteLastmod)}</url>\n`
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
        xml += `  <url><loc>${hostUrl}${path}</loc>${lm(siteLastmod)}</url>\n`
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
        xml += `  <url><loc>${hostUrl}${path}</loc></url>\n`
      }
    }

    // The MARKETPLACE guides, and note the missing gate: unlike the block above, these are ordinary
    // `page.tsx` routes that exist on BOTH editions, so both submit them from their own host — the same
    // arrangement the five keyword landings already have. No lastmod, for the reason just above: they
    // are static editorial with no data behind them.
    for (const path of MARKETPLACE_GUIDE_PATHS) {
      xml += `  <url><loc>${hostUrl}${path}</loc></url>\n`
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
      xml += `  <url><loc>${hostUrl}/${path}</loc></url>\n`
    }

    // Indexing decoupled from PRELAUNCH (owner, 2026-07-18): the full data-driven
    // sitemap ships while the MoIT test-operation notice still shows. The sitewide
    // noindex header in next.config.ts was removed the same day.
    // Faceted category pages (programmatic SEO entry points)
    //
    // ⚠️ THE PREDICATE MIRRORS THE SELLER BLOCK BELOW, deliberately: a category with no live
    // listing is a thin page that serves `noindex`, so it is not submitted, and the moment one
    // listing lands it reappears on the next revalidate. Same shape, same reasoning.
    /**
     * ⚠️ PRESENCE, NOT A COUNT COMPARISON — `groupBy` never returns a zero-count group, so a
     * `_count._all > 0` filter would be dead code that reads like a real guard (opus).
     *
     * ⚠️ AND THE PREDICATE IS THE PAGE'S OWN, VERIFIED RATHER THAN ASSUMED. `/c/<slug>` decides
     * `robots: { index: false }` from `load-category.ts:37` —
     * `count({ scopedListingWhere({ categoryId, verified: true, status: 'active' }) }) === 0`.
     * The aggregate above is that same predicate grouped instead of counted per category, so the
     * sitemap and the page cannot disagree about which categories are indexable. A stricter
     * predicate here would drop good pages; a looser one would keep submitting the dead ends.
     */
    const liveCategoryIds = new Set(liveByCategory.map((g) => g.categoryId))
    for (const c of categories) {
      if (!liveCategoryIds.has(c.id)) continue
      xml += `  <url><loc>${hostUrl}/c/${c.slug}</loc>${lm(catMax.get(c.slug))}</url>\n`
    }

    // Faceted category × district pages
    for (const [combo, max] of comboMax) {
      xml += `  <url><loc>${hostUrl}/c/${combo}</loc>${lm(max)}</url>\n`
    }

    // Seller profiles — the public @handle URL is canonical (sellers/[id] points its
    // canonical at /{handle}), so submit that; fall back to /sellers/{id} only for
    // handle-less sellers.
    for (const s of sellers) {
      // ⚠️ THE PREDICATE, and it is `sellerMax` rather than a flag or a second query. A storefront
      // with no live listing is a thin page — a name and an empty grid — so it is not submitted;
      // the moment that seller has one listing in the block below, they appear here. Reading it
      // off the same map the lastmod comes from means the two can never disagree.
      if (!sellerMax.has(s.id)) continue
      const loc = s.handle ? `${hostUrl}/${s.handle.handle}` : `${hostUrl}/sellers/${s.id}`
      xml += `  <url><loc>${loc}</loc>${lm(sellerMax.get(s.id))}</url>\n`
    }

    /**
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
     * would not defend.
     *
     * ⚠️ THE SPLIT IS TWO QUERIES AND NOT ONE FILTER — see the note on `ownListings` above for the
     * starvation that made it so. The derivation rows must keep carrying imported stock:
     * /c/electronics and a merchant's storefront are real pages worth indexing, and they are real
     * precisely BECAUSE that stock sits behind them. Narrow the FIRST query and the categories lose
     * their lastmod and 25 storefronts leave the sitemap with them.
     */
    for (const listing of ownListings) {
      xml += `  <url>
    <loc>${hostUrl}/listings/${listing.id}</loc>
    <lastmod>${iso(listing.updatedAt)}</lastmod>
  </url>
`
    }
    xml += `</urlset>`

    return new Response(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600',
      },
    })
  } catch (error) {
    console.error('Failed to generate sitemap.xml:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
