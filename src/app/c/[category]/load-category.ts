import { cache } from 'react'
import { db } from '@/lib/db'
import { scopedListingWhere } from '@/lib/edition-scope'

/**
 * The category page's one lookup — the row plus its live count — shared by `layout.tsx`,
 * `generateMetadata` and the page body.
 *
 * ⚠️ `cache()`-WRAPPED, WHICH IS WHY THREE CALLERS COST ONE PAIR OF QUERIES. It lived inside
 * `page.tsx` until the 404 fix needed it from the layout too; a page module is the wrong thing to
 * import from, since Next treats `page.tsx` as a route entry rather than a module. Behaviour is
 * unchanged — the callers are identical.
 *
 * ⚠️ THE COUNT IS PART OF THE MEMO ON PURPOSE. `generateMetadata` decides the auto-noindex from
 * `live === 0` and the page renders that same number, so they cannot disagree about how full the
 * category is. Splitting the count out would mean a second COUNT per render purely to decide a
 * robots tag.
 */
/**
 * Does this category exist? One indexed lookup, for `layout.tsx`'s 404 guard.
 *
 * ⛔ SEPARATE FROM `loadCategory` BECAUSE THE LAYOUT RENDERS ABOVE THE LOADING BOUNDARY, so
 * whatever it awaits delays the skeleton. `loadCategory` also runs a COUNT over the whole category
 * to decide the auto-noindex; making the shell wait on that would trade one defect for a slower
 * first paint. The count still happens below, where `loading.tsx` covers it.
 *
 * ⚠️ EXISTENCE IS THE WHOLE RULE HERE, on purpose. An EMPTY category is a valid 200 page that
 * de-indexes itself (see `page.tsx`); it must not 404.
 */
export const categoryExists = cache(async (slug: string) =>
  !!(await db.category.findUnique({ where: { slug }, select: { slug: true } })),
)

export const loadCategory = cache(async (slug: string) => {
  const cat = await db.category.findUnique({ where: { slug } })
  if (!cat) return null
  const live = await db.listing.count({ where: await scopedListingWhere({ categoryId: cat.id, verified: true, status: 'active' }) })
  return { cat, live }
})
