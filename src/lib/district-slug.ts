import { db } from '@/lib/db'
import { scopedListingWhere } from '@/lib/edition-scope'
import { slugify } from '@/lib/slug'
import type { Prisma } from '@/generated/prisma/client'
import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'

/**
 * RESOLVES A SEO DISTRICT SLUG BACK TO THE DISTRICT VALUES LISTINGS ACTUALLY CARRY.
 *
 * ⛔ TWO DIFFERENT SLUG SPACES SHARE ONE URL PARAM, AND ONLY ONE OF THEM WAS UNDERSTOOD. The
 * explorer's `?district=` takes a key out of `DISTRICTS` (`d1`, `binh-thanh`) with its own list of
 * spellings to match. The `/c/<category>/<district>` landing pages take `slugify(listing.district)`
 * — the FREE-TEXT value a seller typed, slugified (`district-1`, `thao-dien`). They coincide often
 * enough to look like one scheme and diverge often enough to lose the scope: a district page's
 * "Refine in full search" handed the explorer a slug it could not resolve, and `buildDistrictFilter`
 * answered `undefined`, which means NO FILTER — so leaving a district page for the full catalogue
 * silently dropped the district and returned the whole category.
 *
 * ⚠️ A SLUG THAT RESOLVES TO NOTHING MUST MATCH NOTHING. The old fall-through returned every
 * listing for an unknown value, so `?district=anything` read as `?district=all`. A filter that
 * cannot be satisfied is an empty result, never an unfiltered one.
 *
 * ⚠️ THE LIST IS AGGREGATED, NOT SCANNED. `groupBy` is one GROUP BY over the district column; the
 * page that used to do this filtered 600 fetched rows in JavaScript, which both missed districts
 * past the cap and reported the cap as the district's inventory.
 */

/** How long a resolved district list stays usable. Districts change when listings are posted. */
const TTL = 5 * 60_000
/** Districts are a small, slow-moving vocabulary — a few hundred strings for the whole catalogue. */
const MAX_DISTRICTS = 2000

let cached: { at: number; names: string[] } | null = null

/** Every distinct district value the PUBLIC catalogue currently carries, briefly memoized. */
export async function allDistrictNames(): Promise<string[]> {
  if (cached && Date.now() - cached.at < TTL) return cached.names
  const groups = await db.listing.groupBy({
    by: ['district'],
    // ⚠️ EDITION-SCOPED LIKE EVERY OTHER LISTING READ. A district that only a hidden desk seller
    // uses must not resolve on the marketplace — its page would then 404, which is the right
    // answer there. The build is one edition, so this stays a single cache.
    where: await scopedListingWhere({ verified: true, status: 'active', district: { not: null } }),
    orderBy: { district: 'asc' },
    take: MAX_DISTRICTS,
  })
  const names = groups.map((g) => g.district).filter((d): d is string => !!d)
  // ⛔ A SILENT TRUNCATION HERE 404s A REAL DISTRICT. The cap is a sanity bound, not a policy: if
  // the catalogue ever carries more distinct free-text districts than it, the tail is dropped
  // ALPHABETICALLY and every page under those names answers "no such district" for the whole TTL,
  // with nothing in the logs. Say so instead (external review).
  if (groups.length >= MAX_DISTRICTS) {
    console.error(`[district-slug] district vocabulary hit the ${MAX_DISTRICTS} cap — names past it are unresolvable; raise MAX_DISTRICTS`)
  }
  cached = { at: Date.now(), names }
  return names
}

/**
 * The stored district names whose slug is `slug` — usually one, occasionally several when two
 * spellings ("Thao Dien" / "Thảo Điền") slugify the same way and must be treated as one place.
 * Empty when nothing matches, which callers must read as "no such district", never as "no filter".
 */
export async function districtNamesForSlug(slug: string): Promise<string[]> {
  const wanted = slug.trim()
  if (!wanted) return []
  return (await allDistrictNames()).filter((n) => slugify(n) === wanted)
}

/** Test seam: forget the memoized district list. */
export function resetDistrictNameCache(): void {
  cached = null
}


/**
 * THE ONE DEFINITION OF "LISTINGS IN THIS DISTRICT" — used by the landing page AND by the feed.
 *
 * ⛔ TWO RESOLVERS MEANT TWO SCOPES FOR THE SAME URL, AND IT AFFECTED MORE THAN HALF OF THEM.
 * `/c/<cat>/binh-thanh` counted and rendered `district IN ('Bình Thạnh')` — exact stored names —
 * while every sort, search and Show-more from that page sent `district=binh-thanh` to the feed,
 * which matched the CURATED entry and filtered `district LIKE '%Binh Thanh%' OR location LIKE …`.
 * A broader set. So the first interaction on the page silently changed both the total and which
 * listings were in scope. Measured 2026-09-06: **12 of the 23 curated slugs are exactly what a
 * stored district name slugifies to**, so this was the common case, not the edge.
 *
 * The precedence is the feed's long-standing one, because the explorer's chips have always meant
 * the curated match: a curated entry with spellings wins, and anything else falls back to the
 * stored names that slugify to this value. `null` means "no district scope" — the `all` case.
 * Callers must read an empty match as "no such district", never as "no filter".
 */
export async function districtScopeForSlug(slug: string): Promise<Prisma.ListingWhereInput | null> {
  const value = slug.trim()
  if (!value || value === 'all') return null
  const curated = DISTRICTS.find((d) => d.slug === value)
  if (curated?.match?.length) {
    const OR: Prisma.ListingWhereInput[] = []
    for (const m of curated.match) OR.push({ district: { contains: m } }, { location: { contains: m } })
    return { OR }
  }
  return { district: { in: await districtNamesForSlug(value) } }
}

/** The name to show for a district slug: the curated label when there is one. */
export function curatedDistrictName(slug: string, lang?: string): string | null {
  const d = DISTRICTS.find((x) => x.slug === slug.trim())
  if (!d || d.slug === 'all') return null
  return lang === 'vi' ? d.name : d.nameEn
}
