import { rentalDistrictsBelowFloor } from '@/lib/rental-district-floor'
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
 * predicate (rental-district-floor.ts, shared with /housing-vietnam-expats), and one under the floor renders as
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
  const slugOf = (path: string) => RENTALS_DISTRICT.exec(path)![1]
  const below = await rentalDistrictsBelowFloor([...paths].map(slugOf), 'teach-guides')
  return new Set([...paths].filter((path) => below.has(slugOf(path))))
}
