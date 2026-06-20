import { db } from '@/lib/db'
import { slugify } from '@/lib/slug'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const listings = await db.listing.findMany({
      where: { verified: true },
      select: { id: true, updatedAt: true, district: true, category: { select: { slug: true } } },
      orderBy: { updatedAt: 'desc' },
    })
    const categories = await db.category.findMany({ select: { slug: true } })
    const sellers = await db.seller.findMany({ where: { verifiedSeller: true }, select: { id: true } })

    const hostUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.eno.forum'

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <!-- Main landing page -->
  <url>
    <loc>${hostUrl}</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
`

    // Static info pages
    for (const p of ['about', 'safety', 'help']) {
      xml += `  <url><loc>${hostUrl}/${p}</loc><changefreq>monthly</changefreq><priority>0.4</priority></url>\n`
    }

    // Faceted category pages (programmatic SEO entry points)
    for (const c of categories) {
      xml += `  <url><loc>${hostUrl}/c/${c.slug}</loc><changefreq>daily</changefreq><priority>0.7</priority></url>\n`
    }

    // Faceted category × district pages
    const combos = new Set<string>()
    for (const l of listings) {
      if (l.district) combos.add(`${l.category.slug}/${slugify(l.district)}`)
    }
    for (const combo of combos) {
      xml += `  <url><loc>${hostUrl}/c/${combo}</loc><changefreq>daily</changefreq><priority>0.7</priority></url>\n`
    }

    // Seller profiles
    for (const s of sellers) {
      xml += `  <url><loc>${hostUrl}/sellers/${s.id}</loc><changefreq>weekly</changefreq><priority>0.5</priority></url>\n`
    }

    for (const listing of listings) {
      const lastmod = listing.updatedAt.toISOString()
      xml += `  <url>
    <loc>${hostUrl}/listings/${listing.id}</loc>
    <lastmod>${lastmod}</lastmod>
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
