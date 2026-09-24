import type { Prisma } from '@/generated/prisma/client'
import { fold } from './fold'
import { districtScopeForSlug } from './district-slug'
import { inferDistrictFromQuery } from './district-query'
import type { SavedSearchParams } from './saved-search'

// Build the Prisma where for a saved search — IDENTICAL semantics to the public
// feed (/api/listings) so "matches" line up with what the buyer would see.
//
// ⛔ THE DISTRICT IS THE FEED'S OWN SCOPE NOW (districtScopeForSlug), NOT A COPY OF IT. The copy
// that lived here knew only the curated keys, so a search saved from a /c/<category>/<district>
// page (`district=quan-7`) resolved to NO filter and alerted on the whole category, and `d1` still
// matched Quận 10–12. A district typed into the query ("căn hộ quận 7") is read the way the feed
// reads it too (src/lib/district-query.ts), so the alert fires for the listings the search showed.
// ⚠️ The remaining text is still matched as ONE phrase here, where the feed ANDs its words — that
// difference predates this and is left alone rather than changing every stored alert at once.
// ⚠️ ITS OWN MODULE BECAUSE IT READS THE DATABASE (district-slug resolves a landing slug against the
// stored names). ./saved-search.ts keeps the pure parsing and labelling helpers, so importing those
// can never drag Prisma along. Async since 2026-09-24; its one caller is the alert cron, which awaits it.
export async function buildListingWhere(p: SavedSearchParams): Promise<Prisma.ListingWhereInput> {
  const and: Prisma.ListingWhereInput[] = [{ verified: true }, { status: 'active' }]
  if (p.category) and.push({ category: { slug: p.category } })
  if (p.subcategory) and.push({ subcategorySlug: p.subcategory })
  if (p.brand) and.push({ brandSlug: p.brand })
  if (p.model) and.push({ model: p.model })
  if (p.listingType) and.push({ listingType: p.listingType })
  if (p.condition === 'new') and.push({ OR: [{ condition: { contains: 'new' } }, { condition: { contains: 'mới' } }] })
  else if (p.condition === 'used') and.push({ NOT: { OR: [{ condition: { contains: 'new' } }, { condition: { contains: 'mới' } }] } })
  if (typeof p.priceMin === 'number' || typeof p.priceMax === 'number') {
    const price: Prisma.FloatFilter = {}
    if (typeof p.priceMin === 'number') price.gte = p.priceMin
    if (typeof p.priceMax === 'number') price.lte = p.priceMax
    and.push({ price })
  }
  // `all` is "no district" everywhere else (the feed, the facet counts); normalizeParams never stores
  // it, but a row written before it existed could, and must not suppress the inference.
  const noDistrict = !p.district || p.district === 'all'
  const inferred = p.q && noDistrict ? inferDistrictFromQuery(p.q) : null
  const text = inferred ? inferred.rest : p.q
  if (text) and.push({ searchText: { contains: fold(text) } })
  const df = await districtScopeForSlug(inferred?.slug ?? (noDistrict ? 'all' : p.district!))
  if (df) and.push(df)
  if (p.attrs) for (const [k, v] of Object.entries(p.attrs)) and.push({ attributes: { contains: `"${k}":"${v}"` } })
  return { AND: and }
}
