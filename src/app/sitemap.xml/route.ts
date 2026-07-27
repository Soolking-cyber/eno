import { db } from '@/lib/db'
import { VIETNAM_EVISA_PATHS } from '@/app/vietnam-evisa/links'
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
    const [listings, categories, sellers, helpArticles] = await Promise.all([
      db.listing.findMany({
        where: { verified: true, status: 'active' },
        select: { id: true, updatedAt: true, district: true, sellerId: true, category: { select: { slug: true } } },
        orderBy: { updatedAt: 'desc' },
        // Sitemap protocol caps a file at 50k URLs — leave headroom for the
        // category/combo/seller/static entries above the listing block.
        take: 45000,
      }),
      db.category.findMany({ select: { slug: true } }),
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
    for (const p of ['about', 'safety', 'help', 'guide', 'trust', 'terms', 'privacy', 'regulations', 'prohibited', 'brands']) {
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
    xml += `  <url><loc>${hostUrl}/itinerary</loc></url>\n`

    // SEO keyword landing pages (funnel to categories → track the site's freshest content)
    for (const p of [
      'housing-vietnam-expats',
      'jobs-vietnam-expats',
      'motorbikes-for-sale-vietnam',
      'moving-sales-vietnam',
      'services-for-expats-vietnam',
    ]) {
      xml += `  <url><loc>${hostUrl}/${p}</loc>${lm(siteLastmod)}</url>\n`
    }

    // The e-visa cluster: the /vietnam-evisa hub and its long-tail children.
    //
    // ⚠️ IMPORTED, NOT RETYPED. The list above is hard-coded, which is exactly how a landing page
    // ships and is then never submitted — the route exists, the sitemap does not know, and nothing
    // fails. `VIETNAM_EVISA_PATHS` is derived from the same EVISA_CHILDREN array the hub renders
    // its links from, so adding a child adds it here too. The paths carry `siteLastmod` for the
    // same reason the block above does: their listing rails track the site's freshest content.
    for (const path of VIETNAM_EVISA_PATHS) {
      xml += `  <url><loc>${hostUrl}${path}</loc>${lm(siteLastmod)}</url>\n`
    }

    // Indexing decoupled from PRELAUNCH (owner, 2026-07-18): the full data-driven
    // sitemap ships while the MoIT test-operation notice still shows. The sitewide
    // noindex header in next.config.ts was removed the same day.
    // Faceted category pages (programmatic SEO entry points)
    for (const c of categories) {
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

    for (const listing of listings) {
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
