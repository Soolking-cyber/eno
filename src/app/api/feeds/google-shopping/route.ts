import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { NextResponse } from 'next/server'

// Helper to escape XML special characters
function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export async function GET() {
  try {
    const listings = await db.listing.findMany({
      where: { verified: true },
      include: { category: true, seller: true },
      orderBy: { postedAt: 'desc' },
    })

    const hostUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'

    let xml = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>eno.vn — Your Trusted Vietnam Network.</title>
    <link>${hostUrl}</link>
    <description>Verified classifieds listings for expats. Moving sales, rentals, jobs and more.</description>
    <language>vi-vn</language>
`

    for (const l of listings) {
      const listing = serializeListing(l)
      const displayTitle = listing.titleVi || listing.title
      const displayDesc = listing.description
      const itemUrl = `${hostUrl}/listings/${listing.id}`
      const imageUrl = listing.images[0] || `${hostUrl}/placeholder.png`
      
      // Determine condition
      let condition = 'used'
      if (listing.condition === 'new' || listing.condition?.toLowerCase().includes('mới')) {
        condition = 'new'
      }

      // Format price for Google: numeric value + ISO currency (e.g. 5000000 VND)
      const currencyCode = listing.currency === '₫' ? 'VND' : 'USD'
      const formattedPrice = `${listing.price} ${currencyCode}`

      xml += `    <item>
      <g:id>${escapeXml(listing.id)}</g:id>
      <g:title>${escapeXml(displayTitle)}</g:title>
      <g:description>${escapeXml(displayDesc.slice(0, 500))}</g:description>
      <g:link>${escapeXml(itemUrl)}</g:link>
      <g:image_link>${escapeXml(imageUrl)}</g:image_link>
      <g:condition>${condition}</g:condition>
      <g:price>${formattedPrice}</g:price>
      <g:availability>in_stock</g:availability>
      <g:brand>eno.vn</g:brand>
      <g:identifier_exists>no</g:identifier_exists>
      <g:product_type>${escapeXml(listing.category.name)}</g:product_type>
    </item>
`
    }

    xml += `  </channel>
</rss>`

    return new Response(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600',
      },
    })
  } catch (error) {
    console.error('Failed to generate Google Shopping feed:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
