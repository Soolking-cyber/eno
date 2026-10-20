import { db } from '@/lib/db'
import { districtPageRows } from '@/lib/district-page-base'
import { districtScopeForSlug } from '@/lib/district-slug'
import { scopedListingWhere } from '@/lib/edition-scope'
import { isIndexableCount } from '@/lib/index-floor'
import { inlineHrefs } from './inline'
import { forEachInline, type TeachGuide } from './schema'

const RENTALS_DISTRICT = /^\/c\/rentals\/([a-z0-9-]+)$/

/**
 * ⛔ A GUIDE LINKS A DISTRICT RENTALS PAGE ONLY WHILE THAT PAGE IS AT THE INDEXING FLOOR (teacher visibility plan B4;
 * commit-gate review, 2026-10-20). `/c/rentals/<district>` is a real 404 while its district has no place to rent
 * ([district]/page.tsx: `load()` returns null, `resolve` calls notFound()), and inventory moves every day — d2, d9,
 * can-gio, cu-chi and hoc-mon were empty on 2026-10-20, and a district a guide was approved with can empty later.
 * TEACH_SITE_PATHS (registry.ts) can only prove the route exists, so the guide page asks the data: each district path the
 * guide links (only key points and sections carry links; intro and FAQs are plain text) is counted with that page's own
 * predicate (district-page-base.ts — one definition — AND `districtScopeForSlug`), and one under the floor renders as
 * plain text, exactly like a link to a guide that is not released yet (`isLiveHref`).
 * WHY THE FLOOR AND NOT "NOT EMPTY": it is the rule pages.xml submits a district page by (build.ts rule 4, the live count
 * at `isIndexableCount`), and its margin keeps the two pages' caches from disagreeing in practice. The guide and the
 * district page each cache their own answer — the guide for its ISR hour, the district page for its ISR day — so a
 * change of state is always seen by one before the other. With the floor, a stale link needs at least
 * MIN_INDEXABLE_LISTINGS places to leave one district inside the guide's hour (it then links a fresh 404 until the guide
 * regenerates), or a district to go from empty to the floor while its page still serves the 404 it cached when empty
 * (until that page regenerates). Both are rare and end by themselves; neither can be closed without the two pages sharing
 * one cache.
 *
 * Returns the paths to render as text. A guide that links no district reads nothing.
 * ⛔ FAILS CLOSED: if the read fails, every district link the guide holds renders as text for that render — a guide
 * without the link is fine; a link to a 404 is what this exists to prevent.
 */
export async function districtLinksAsText(g: Pick<TeachGuide, 'keyPoints' | 'sections'>): Promise<Set<string>> {
  const paths = new Set<string>()
  forEachInline(g, (src) => {
    for (const { href, external } of inlineHrefs(src)) {
      const path = href.split('#')[0]
      if (!external && RENTALS_DISTRICT.test(path)) paths.add(path)
    }
  })
  if (!paths.size) return paths
  try {
    const cat = await db.category.findUnique({ where: { slug: 'rentals' }, select: { id: true, slug: true } })
    if (!cat) return paths
    // `{ teachers: true }` as the district page reads it ([district]/page.tsx `load()`).
    const base = await scopedListingWhere(districtPageRows(cat), { teachers: true })
    const counts = await Promise.all(
      [...paths].map(async (path) => {
        const scope = await districtScopeForSlug(RENTALS_DISTRICT.exec(path)![1])
        // edition-lint-allow: `base` IS `await scopedListingWhere(...)` just above; AND-ing the district scope onto it
        // cannot lose the edition clause.
        return scope ? db.listing.count({ where: { AND: [base, scope] } }) : 0
      }),
    )
    return new Set([...paths].filter((_, i) => !isIndexableCount(counts[i])))
  } catch (err) {
    console.warn('[teach-guides] district link check failed; district links render as text this time', err)
    return paths
  }
}
