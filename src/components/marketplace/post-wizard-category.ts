import { typesFor } from '@/lib/taxonomy'

/**
 * WHAT A CATEGORY CHANGE IN THE POST WIZARD THROWS AWAY — pure, so it can be tested without
 * rendering the wizard (post-wizard.tsx `chooseCategory`).
 *
 * ⚠️ BRAND AND MODEL ARE ALWAYS CLEARED. They used to be cleared only when the NEW category had no
 * brand field, so Electronics → Vehicles (both branded) kept "Apple / iPhone" and published it on a
 * motorbike. A brand belongs to the item, and a new category means a different item.
 */
export type CategoryAnswers = {
  categorySlug: string
  subcategorySlug: string
  condition: string
  attrs: Record<string, string>
  ranges: Record<string, unknown>
  brand: string
  model: string
}

/** The fields a switch to `slug` resets. */
export function categoryChangeReset(slug: string) {
  return {
    categorySlug: slug,
    subcategorySlug: '',
    attrs: {} as Record<string, string>,
    ranges: {},
    condition: '',
    brand: '',
    model: '',
    listingType: typesFor(slug)[0] ?? 'sell',
  }
}

/** Whether switching away from `cur` loses an answer worth an Undo toast (a first pick loses nothing). */
export function categoryChangeLosesAnswers(cur: CategoryAnswers): boolean {
  if (!cur.categorySlug) return false
  return !!(
    cur.subcategorySlug ||
    cur.condition ||
    Object.values(cur.attrs).some(Boolean) ||
    Object.values(cur.ranges).some((v) => v != null) ||
    cur.brand.trim() ||
    cur.model.trim()
  )
}
