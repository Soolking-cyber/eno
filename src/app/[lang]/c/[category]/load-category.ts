import { cache } from 'react'
import { db } from '@/lib/db'
import { scopedListingWhere } from '@/lib/edition-scope'

/**
 * The category row, looked up once per render by slug — shared by `layout.tsx`'s 404 guard,
 * `(index)/layout.tsx` (the breadcrumb and H1) and `loadCategory` below.
 *
 * ⚠️ ONE `findUnique` PER RENDER, NOT TWO. `categoryExists` and `loadCategory` each ran their own
 * lookup by slug until SEO wave B, H1b; the memo is keyed on the slug string, so every caller in one
 * render shares it.
 *
 * ⛔ THE LAYOUTS ABOVE THE LOADING BOUNDARY AWAIT THIS AND NOTHING THAT COUNTS. Whatever a layout
 * awaits delays the whole first chunk — the Header, the CSS, the H1 and the skeleton — and, because
 * the `[category]` param changes, every soft navigation from one category to another. This is one
 * indexed lookup on a unique column. The COUNT is `loadCategory`'s, below the `(index)` boundary.
 */
export const getCategoryRow = cache(async (slug: string) => db.category.findUnique({ where: { slug } }))

/**
 * Does this category exist? For `layout.tsx`'s 404 guard.
 *
 * ⚠️ EXISTENCE IS THE WHOLE RULE HERE, on purpose. An EMPTY category is a valid 200 page that
 * de-indexes itself (see `(index)/page.tsx`); it must not 404.
 */
export const categoryExists = cache(async (slug: string) => !!(await getCategoryRow(slug)))

/**
 * The category and how many live listings it actually has — shared by `generateMetadata`, the page
 * body and `CategoryLedeBlock` (`(index)/category-lede-block.tsx`).
 *
 * ⚠️ `cache()`-WRAPPED, WHICH IS WHY EVERY CALLER IN ONE RENDER COSTS ONE COUNT. It lived inside
 * `page.tsx` until the 404 fix needed it from the layout too; a page module is the wrong thing to
 * import from, since Next treats `page.tsx` as a route entry rather than a module.
 *
 * ⚠️ THE COUNT IS PART OF THE MEMO ON PURPOSE. `generateMetadata` decides the auto-noindex from
 * `live === 0` and the page renders that same number, so they cannot disagree about how full the
 * category is. Splitting the count out would mean a second COUNT per render purely to decide a
 * robots tag.
 *
 * ⛔ NOT FROM A LAYOUT: the COUNT runs over the whole category (25,502 rows on /c/rentals). No layout
 * calls this; `CategoryLedeBlock` does, and where that block renders is decision H-c (see there).
 */
export const loadCategory = cache(async (slug: string) => {
  const cat = await getCategoryRow(slug)
  if (!cat) return null
  const live = await db.listing.count({ where: await scopedListingWhere({ categoryId: cat.id, verified: true, status: 'active' }) })
  return { cat, live }
})
