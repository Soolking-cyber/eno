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

// Google Merchant Center accepts physical PRODUCTS only. Rentals, jobs, services,
// events, tickets and property aren't products — feeding them gets the whole feed
// flagged. Restrict to the sellable product categories.
const FEED_CATEGORIES = ['electronics', 'fashion-beauty', 'vehicles', 'furniture-appliances', 'baby-kids', 'hobbies-sports', 'pets', 'food-drink', 'moving-sale']

// Map our top-level categories → Google product taxonomy IDs (broad + safe; Google
// refines from title/description). Omitted categories let Google auto-categorize.
const GOOGLE_PRODUCT_CATEGORY: Record<string, string> = {
  electronics: '222',            // Electronics
  'fashion-beauty': '166',       // Apparel & Accessories
  vehicles: '888',               // Vehicles & Parts
  'furniture-appliances': '536', // Home & Garden
  'baby-kids': '537',            // Baby & Toddler
  'hobbies-sports': '988',       // Sporting Goods
  pets: '1',                     // Animals & Pet Supplies
  'food-drink': '422',           // Food, Beverages & Tobacco
}

export async function GET() {
  try {
    const listings = await db.listing.findMany({
      // Only items actually FOR SALE (not rent/wanted/job/service/free/event) and
      // only in product categories — everything else isn't Shopping-eligible.
      where: {
        verified: true,
        status: 'active',
        listingType: 'sell',
        category: { slug: { in: FEED_CATEGORIES } },
      },
      include: { category: true, seller: true },
      orderBy: { postedAt: 'desc' },
    })

    // Resolve real product brands (one query) so each item carries its own brand,
    // not a placeholder — placeholder brands break Merchant matching + policy.
    const brandSlugs = Array.from(new Set(listings.map((l) => l.brandSlug).filter(Boolean))) as string[]
    const brandRows = brandSlugs.length
      ? await db.brand.findMany({ where: { slug: { in: brandSlugs } }, select: { slug: true, name: true } })
      : []
    const brandName = new Map(brandRows.map((b) => [b.slug, b.name]))

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
      const baseTitle = listing.titleVi || listing.title
      const displayDesc = listing.description
      const itemUrl = `${hostUrl}/listings/${listing.id}`
      const imageUrl = listing.images[0] || `${hostUrl}/placeholder.png`
      const extraImages = listing.images.slice(1, 11)

      // Real brand for this item (canonical catalogue name), if known.
      const bName = l.brandSlug ? brandName.get(l.brandSlug) ?? null : null
      // Lead the title with the brand for stronger matching (avoid duplication).
      const title = bName && !baseTitle.toLowerCase().includes(bName.toLowerCase())
        ? `${bName} ${baseTitle}`
        : baseTitle

      // Condition
      let condition = 'used'
      if (listing.condition === 'new' || listing.condition?.toLowerCase().includes('mới')) {
        condition = 'new'
      }

      const currencyCode = listing.currency === '₫' ? 'VND' : 'USD'
      const formattedPrice = `${listing.price} ${currencyCode}`
      const gpc = GOOGLE_PRODUCT_CATEGORY[l.category.slug]

      xml += `    <item>
      <g:id>${escapeXml(listing.id)}</g:id>
      <g:title>${escapeXml(title.slice(0, 150))}</g:title>
      <g:description>${escapeXml(displayDesc.slice(0, 500))}</g:description>
      <g:link>${escapeXml(itemUrl)}</g:link>
      <g:image_link>${escapeXml(imageUrl)}</g:image_link>
${extraImages.map((img) => `      <g:additional_image_link>${escapeXml(img)}</g:additional_image_link>`).join('\n')}${extraImages.length ? '\n' : ''}      <g:condition>${condition}</g:condition>
      <g:price>${formattedPrice}</g:price>
      <g:availability>in_stock</g:availability>
      <g:product_type>${escapeXml(listing.category.name)}</g:product_type>
${gpc ? `      <g:google_product_category>${gpc}</g:google_product_category>\n` : ''}${bName ? `      <g:brand>${escapeXml(bName)}</g:brand>\n` : `      <g:identifier_exists>no</g:identifier_exists>\n`}    </item>
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
