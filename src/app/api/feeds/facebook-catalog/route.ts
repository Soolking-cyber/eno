import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { NextResponse } from 'next/server'

// Helper to escape CSV values according to RFC 4180
function escapeCsv(val: string): string {
  const clean = val.replace(/\r?\n|\r/g, ' ').trim()
  if (clean.includes('"') || clean.includes(',') || clean.includes(';')) {
    return `"${clean.replace(/"/g, '""')}"`
  }
  return clean
}

export async function GET() {
  try {
    const listings = await db.listing.findMany({
      where: { verified: true },
      include: { category: true, seller: true },
      orderBy: { postedAt: 'desc' },
    })

    const hostUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.eno.forum'

    // CSV Headers
    const headers = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand']
    let csv = headers.join(',') + '\n'

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

      // Format price for Facebook: numeric value + ISO currency (e.g. 5000000 VND)
      const currencyCode = listing.currency === '₫' ? 'VND' : 'USD'
      const formattedPrice = `${listing.price} ${currencyCode}`

      const row = [
        escapeCsv(listing.id),
        escapeCsv(displayTitle),
        escapeCsv(displayDesc.slice(0, 400)),
        'in stock',
        condition,
        escapeCsv(formattedPrice),
        escapeCsv(itemUrl),
        escapeCsv(imageUrl),
        'ENO',
      ]

      csv += row.join(',') + '\n'
    }

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename=facebook_catalog.csv',
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600',
      },
    })
  } catch (error) {
    console.error('Failed to generate Facebook Catalog feed:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
