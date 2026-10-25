import { db } from '@/lib/db'
import { districtPageRows } from '@/lib/district-page-base'
import { districtScopeForSlug } from '@/lib/district-slug'
import { scopedListingWhere } from '@/lib/edition-scope'
import { isIndexableCount } from '@/lib/index-floor'

/**
 * ⛔ WHICH `/c/rentals/<slug>` PAGES MUST NOT BE LINKED RIGHT NOW — the slugs whose page is under the indexing floor.
 * A district rentals page with no place to rent is a real 404 ([district]/page.tsx: `load()` returns null, `resolve`
 * calls notFound()), and inventory moves every day: d2, d9, can-gio, cu-chi and hoc-mon were empty on 2026-10-20, and
 * on 2026-10-22 /housing-vietnam-expats still linked "District 2 (Thu Duc)" to the /c/rentals/d2 404 (live sweep).
 * Each slug is counted with that page's own predicate (district-page-base.ts — one definition — AND
 * `districtScopeForSlug`), so a link and the page it opens cannot disagree about what is there. Why the floor and not
 * "not empty", and how the two pages' caches can still briefly differ: teach-guides/district-links.ts.
 * ⛔ FAILS CLOSED: if the read fails, every slug asked about comes back — a sentence without the link is fine; a link
 * to a 404 is what this exists to prevent. `who` names the caller in that warning.
 */
export async function rentalDistrictsBelowFloor(slugs: Iterable<string>, who: string): Promise<Set<string>> {
  const asked = new Set(slugs)
  if (!asked.size) return asked
  try {
    const cat = await db.category.findUnique({ where: { slug: 'rentals' }, select: { id: true, slug: true } })
    if (!cat) return asked
    // `{ teachers: true }` as the district page reads it ([district]/page.tsx `load()`).
    const base = await scopedListingWhere(districtPageRows(cat), { teachers: true })
    const list = [...asked]
    const counts = await Promise.all(
      list.map(async (slug) => {
        const scope = await districtScopeForSlug(slug)
        // edition-lint-allow: `base` IS `await scopedListingWhere(...)` just above; AND-ing the district scope onto it
        // cannot lose the edition clause.
        return scope ? db.listing.count({ where: { AND: [base, scope] } }) : 0
      }),
    )
    return new Set(list.filter((_, i) => !isIndexableCount(counts[i])))
  } catch (err) {
    console.warn(`[${who}] district link check failed; district links render as text this time`, err)
    return asked
  }
}
