import type { Prisma } from '@/generated/prisma/client'
import { RENTAL_PLACES } from '@/lib/rental-places'

/**
 * THE ROWS A `/c/<category>/<district>` PAGE COUNTS, BEFORE ITS EDITION AND DISTRICT SCOPES ([district]/page.tsx
 * `load()`): the category's live rows, and for rentals the places to rent only (rental-places.ts; the page's comments say
 * why). The page runs it through `scopedListingWhere(…, { teachers: true })` (district-status-contract.test.ts pins that
 * every read there says so), AND-s `districtScopeForSlug` onto it and answers a real 404 when the total is 0.
 * ⛔ ONE DEFINITION, because a second reader decides from the same count whether to link that page: a teach guide
 * renders a link to a district page under the indexing floor as plain text (teach-guides/district-links.ts). A copy of
 * the predicate there could count a row the page does not.
 * ⚠️ Unscoped on purpose: every caller applies `scopedListingWhere` itself, at the read, where edition-lint can see it.
 */
export function districtPageRows(cat: { id: string; slug: string }): Prisma.ListingWhereInput {
  return cat.slug === 'rentals'
    ? { AND: [{ categoryId: cat.id, verified: true, status: 'active' }, RENTAL_PLACES] }
    : { categoryId: cat.id, verified: true, status: 'active' }
}
