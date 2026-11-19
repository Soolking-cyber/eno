import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { currencyCode } from '@/lib/analytics'
import { teacherExclusion } from '@/lib/edition-scope'
import { TEACHER_LISTING_TYPE } from '@/lib/teachers/constants'
import { listingJsonLd } from '@/lib/listing-jsonld'
import { feedIdentifiers } from '@/lib/product-feed'
import { safeParse } from '@/lib/serialize'
import { siteOrigin, submittedListingWhere } from '@/lib/sitemap'
import { listedAt } from '@/lib/stale'

/**
 * NLWEB SCHEMA FEEDS (owner 2026-11-18, ora.ai's 'nlweb-schema-feeds' check) — the spec is the Schema Feeds draft v0.1,
 * github.com/nlweb-ai/website SCHEMA_SPEC.md: robots.txt names a Schema Map (`schemamap:`; ⛔ NOT on eno.vn since 2026-11-19 —
 * Lighthouse fails robots.txt on the unknown line, so /llms.txt links the map instead), the Schema Map is a sitemap-
 * shaped <urlset> whose entries carry `sf:contentType`, and a `structuredData/schema.org` feed is JSON Lines — one schema.org
 * JSON-LD object per line, each with `@context` and `@type`, SHOULD with `url`.
 *
 * ⛔ THE FEED IS THE LISTING PAGES' OWN JSON-LD, NOTHING ELSE. The spec (§7.1) requires feed data to match the pages' markup,
 * so every line is `listingJsonLd` — the builder the PDP calls — fed the same fields the PDP feeds it, and a listing whose
 * page publishes no item (a job, a wanted post, an event, a short stay, vehicle hire) publishes no line.
 * ⛔ THE ROWS ARE THE SITEMAP'S, MINUS EVERY TEACHER. `submittedListingWhere()` is what this site asks Google to index:
 * verified + active (no held, licence-held or hidden row — the PDP's own noindex rule), the edition scope (never eno's visa
 * desk, HIDDEN_DESK_OWNER_EMAILS), no imported/affiliate row. Its teacher profiles are taken back out: a profile is a person
 * (name, photo, rates), and a bulk download of people is not what this feed is for.
 * ⚠️ BOUNDED AND CACHED: the newest SCHEMA_FEED_CAP rows, one query per revalidate window (the route's ISR), so no request
 * rate reaches the database. Not the Google/Meta feeds either: those are HTTP-Basic gated on purpose and stay so.
 */

export const SCHEMA_FEED_PATH = '/schema-feed.jsonl'
// 1,000, not 5,000: the full 5,000 measured 80 s and 6.9 MB to build (2026-11-19) — too slow for one request.
export const SCHEMA_FEED_CAP = 1_000

/** Only what `listingJsonLd` reads. ⛔ No seller contact: the seller's name and two flags, as the page states them. */
const SCHEMA_FEED_SELECT = {
  id: true, title: true, description: true, images: true, price: true, currency: true, priceUnit: true, listingType: true,
  subcategorySlug: true, condition: true, status: true, sellerId: true, brandSlug: true, model: true, attributes: true,
  areaM2: true, district: true, city: true, postedAt: true, createdAt: true,
  category: { select: { slug: true, name: true } },
  seller: { select: { name: true, ownerId: true, officialPartner: true, owner: { select: { accountType: true } } } },
} as const satisfies Prisma.ListingSelect

export type SchemaFeedRow = Prisma.ListingGetPayload<{ select: typeof SCHEMA_FEED_SELECT }>

/** One row → its page's JSON-LD item plus `url` (Product has none of its own), or null when the page publishes none. */
export function schemaFeedItem(row: SchemaFeedRow, brandName: string | null, origin: string): Record<string, unknown> | null {
  const url = `${origin}/listings/${row.id}`
  const attributes = safeParse<Record<string, unknown> | null>(row.attributes, null)
  const images = safeParse<unknown>(row.images, [])
  const ids = feedIdentifiers({ model: row.model, attributes, brandSlug: row.brandSlug, condition: row.condition })
  const ld = listingJsonLd({
    id: row.id, url, title: row.title, description: row.description,
    images: Array.isArray(images) ? images.filter((s): s is string => typeof s === 'string') : [],
    price: row.price, currency: currencyCode(row.currency), priceUnit: row.priceUnit, listingType: row.listingType,
    categorySlug: row.category.slug, categoryName: row.category.name, subcategorySlug: row.subcategorySlug,
    condition: row.condition, status: row.status, sellerId: row.sellerId, sellerName: row.seller.name,
    sellerHasOwner: row.seller.ownerId != null, sellerIsBusiness: row.seller.owner?.accountType === 'business',
    // The PDP's three link-derived inputs, for a row with no affiliateUrl (the where): the partner flag as stored
    // (partnerShown), not imported, not a booking.
    sellerOfficialPartner: row.seller.officialPartner === true, imported: false, isBooking: false,
    brandName, gtin: ids.gtin, mpn: ids.mpn, areaM2: row.areaM2, attributes, district: row.district, city: row.city,
    postedAt: listedAt(row).toISOString(),
  })
  return ld && { ...ld, url }
}

/** The JSON Lines body: newest first, capped, one object per `\n`-terminated line. */
export async function schemaFeedBody(): Promise<string> {
  const noTeachers = await teacherExclusion()
  // ⛔ No row of a TEACHER'S SHOP at all (the .md twin's rule, src/app/md/twin/route.ts): an owner with a teacher profile, or a
  // shop with any teacher row — a person's profile, not only the teacher category. Read FIRST as a short id list (~200 shops):
  // as two NOT-relation filters inside the sorted, limited query Postgres checked them row by row — 81 s (measured 2026-11-19);
  // this way the whole read is under a second.
  // edition-lint-allow: a refusal-only read of shop ids, never rendered.
  const teacherShops = (await db.seller.findMany({
    where: { OR: [{ owner: { teacherProfile: { isNot: null } } }, { listings: { some: { listingType: TEACHER_LISTING_TYPE } } }] },
    select: { id: true },
  })).map((s) => s.id)
  const rows = await db.listing.findMany({
    // edition-lint-allow: `submittedListingWhere()` IS `scopedListingWhere(...)` AND-ed with the sitemap's rules
    // (src/lib/sitemap.ts) — the edition scope is inside the helper.
    where: { AND: [await submittedListingWhere(), ...(noTeachers ? [noTeachers] : []), { sellerId: { notIn: teacherShops } }] },
    select: SCHEMA_FEED_SELECT,
    orderBy: [{ postedAt: 'desc' }, { id: 'desc' }],
    take: SCHEMA_FEED_CAP,
  })
  const slugs = [...new Set(rows.flatMap((r) => (r.brandSlug ? [r.brandSlug] : [])))]
  const brands = slugs.length ? await db.brand.findMany({ where: { slug: { in: slugs } }, select: { slug: true, name: true } }) : []
  const brandName = new Map(brands.map((b) => [b.slug, b.name]))
  const origin = siteOrigin()
  return rows.flatMap((r) => {
    const item = schemaFeedItem(r, (r.brandSlug && brandName.get(r.brandSlug)) || null, origin)
    return item ? [`${JSON.stringify(item)}\n`] : []
  }).join('')
}

/** The Schema Map (spec §4): one feed. No <lastmod> — it is OPTIONAL, and the feed rebuilds every 10 minutes. */
export function schemamapXml(origin: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:sf="http://schema.org/schemas/schemafeed/0.1">
  <url>
    <loc>${origin}${SCHEMA_FEED_PATH}</loc>
    <sf:contentType>structuredData/schema.org</sf:contentType>
  </url>
</urlset>
`
}
