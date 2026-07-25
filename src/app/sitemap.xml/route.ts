import { db } from '@/lib/db'
import { slugify } from '@/lib/slug'
import { NextResponse } from 'next/server'

// Cache the generated sitemap instead of rebuilding it (DB query over all listings
// + a serverless cold start) on every request — that ~6s response was timing out
// Google's fetcher ("Couldn't fetch"). ISR revalidates every 24h in the background
// (plus a 1h CDN s-maxage below), so Google always gets a fast, already-built XML.
export const revalidate = 86400

// Stable lastmod for static pages: fixed per server instance (module init), so
// crawlers don't see a fake "changed" date on every regeneration.
const STATIC_LASTMOD = new Date()

export async function GET() {
  try {
    const [listings, categories, sellers] = await Promise.all([
      db.listing.findMany({
        where: { verified: true, status: 'active' },
        select: { id: true, updatedAt: true, district: true, sellerId: true, category: { select: { slug: true } } },
        orderBy: { updatedAt: 'desc' },
        // Sitemap protocol caps a file at 50k URLs — leave headroom for the
        // category/combo/seller/static entries above the listing block.
        take: 45000,
      }),
      db.category.findMany({ select: { slug: true } }),
      db.seller.findMany({
        where: { verifiedSeller: true },
        select: { id: true, handle: { select: { handle: true } } },
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
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
`

    // Static info pages (not data-driven → stable build-time lastmod)
    for (const p of ['about', 'safety', 'help', 'guide', 'trust', 'terms', 'privacy', 'regulations', 'prohibited', 'brands']) {
      xml += `  <url><loc>${hostUrl}/${p}</loc>${lm(STATIC_LASTMOD)}<changefreq>monthly</changefreq><priority>0.4</priority></url>\n`
    }

    // The Trip service's landing page. Its own entry rather than joining either group above:
    // it is not a static info page like /terms, and it does not funnel to a category like the
    // keyword pages — it is a service surface the owner wants promoted, so it sits between the
    // two on priority and refreshes weekly as the service changes.
    xml += `  <url><loc>${hostUrl}/itinerary</loc>${lm(STATIC_LASTMOD)}<changefreq>weekly</changefreq><priority>0.7</priority></url>\n`

    // SEO keyword landing pages (funnel to categories → track the site's freshest content)
    for (const p of [
      'housing-vietnam-expats',
      'jobs-vietnam-expats',
      'motorbikes-for-sale-vietnam',
      'moving-sales-vietnam',
      'services-for-expats-vietnam',
    ]) {
      xml += `  <url><loc>${hostUrl}/${p}</loc>${lm(siteLastmod ?? STATIC_LASTMOD)}<changefreq>weekly</changefreq><priority>0.8</priority></url>\n`
    }

    // Indexing decoupled from PRELAUNCH (owner, 2026-07-18): the full data-driven
    // sitemap ships while the MoIT test-operation notice still shows. The sitewide
    // noindex header in next.config.ts was removed the same day.
    // Faceted category pages (programmatic SEO entry points)
    for (const c of categories) {
      xml += `  <url><loc>${hostUrl}/c/${c.slug}</loc>${lm(catMax.get(c.slug))}<changefreq>daily</changefreq><priority>0.7</priority></url>\n`
    }

    // Faceted category × district pages
    for (const [combo, max] of comboMax) {
      xml += `  <url><loc>${hostUrl}/c/${combo}</loc>${lm(max)}<changefreq>daily</changefreq><priority>0.7</priority></url>\n`
    }

    // Seller profiles — the public @handle URL is canonical (sellers/[id] points its
    // canonical at /{handle}), so submit that; fall back to /sellers/{id} only for
    // handle-less sellers.
    for (const s of sellers) {
      const loc = s.handle ? `${hostUrl}/${s.handle.handle}` : `${hostUrl}/sellers/${s.id}`
      xml += `  <url><loc>${loc}</loc>${lm(sellerMax.get(s.id))}<changefreq>weekly</changefreq><priority>0.5</priority></url>\n`
    }

    for (const listing of listings) {
      xml += `  <url>
    <loc>${hostUrl}/listings/${listing.id}</loc>
    <lastmod>${iso(listing.updatedAt)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
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
