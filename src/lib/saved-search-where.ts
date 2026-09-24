import type { Prisma } from '@/generated/prisma/client'
import { fold } from './fold'
import { districtScopeForSlug } from './district-slug'
import { hasPlainTextFallback, inferDistrictFromQuery, strippedUnderExplicitDistrict, type DistrictInference } from './district-query'
import { db } from './db'
import { scopedListingWhere } from './edition-scope'
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
  const noDistrict = !p.district || p.district === 'all'
  const parsed = p.q ? inferDistrictFromQuery(p.q) : null
  // Under an explicit district only a NUMBERED phrase leaves the words, as on the feed (buildFeedFilters).
  const phrase = parsed && (noDistrict || strippedUnderExplicitDistrict(parsed)) ? parsed : null
  // An explicit district wins; a district typed into the words is read only without one.
  const inferred = noDistrict ? phrase : null
  const slug = inferred?.slug ?? (noDistrict ? 'all' : p.district!)
  const read = await whereFor(p, phrase, slug)
  /**
   * ⛔ THE FEED'S SAFETY NET (resolveFeedFilters in src/app/api/listings/feed-query.ts): when the
   * district reading matches no live listing and the plain words match some, the feed serves the
   * plain words — so the alert watches the plain words too, or a saved "Hồi ức Phú Nhuận" (a book)
   * alerts inside a district the search never showed and never fires. Decided over every LIVE listing (the cron adds its own "new since"
   * window afterwards) and WITHOUT the price band, exactly as the feed decides (codex). Re-decided on
   * every cron run, so the day a district match goes live the alert follows the feed back.
   * ⚠️ A failed probe keeps the district reading — an alert must not error over its own safety net.
   */
  if (!inferred || !hasPlainTextFallback(inferred)) return read
  const noBand = { ...p, priceMin: undefined, priceMax: undefined }
  const anyLive = async (where: Prisma.ListingWhereInput) =>
    !!(await db.listing.findFirst({ where: await scopedListingWhere(where), select: { id: true } }))
  if (await anyLive(await whereFor(noBand, phrase, slug)).catch(() => true)) return read
  const plainHasRows = await anyLive(await whereFor(noBand, null, 'all')).catch(() => false)
  return plainHasRows ? whereFor(p, null, 'all') : read
}

/**
 * The where for `p`, with the words read through `phrase` (a district reading whose phrase is
 * stripped from the text — the district applied, or a place search under an explicit pick, which
 * wins) and the district scope `districtSlug`.
 */
async function whereFor(p: SavedSearchParams, phrase: DistrictInference | null, districtSlug: string): Promise<Prisma.ListingWhereInput> {
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
  const text = phrase ? phrase.rest : p.q
  if (text) and.push({ searchText: { contains: fold(text) } })
  const df = await districtScopeForSlug(districtSlug)
  if (df) and.push(df)
  if (p.attrs) for (const [k, v] of Object.entries(p.attrs)) and.push({ attributes: { contains: `"${k}":"${v}"` } })
  return { AND: and }
}
