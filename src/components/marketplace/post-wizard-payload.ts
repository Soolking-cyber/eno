import type { RangeMeta } from '@/lib/taxonomy'

/**
 * The precise numeric specs (range facets → their dedicated columns: year, mileageKm, engineL, areaM2,
 * salaryM…) a post-wizard submit sends. Pure, so the rule below is tested rather than re-derived.
 *
 * ⚠️ ON AN EDIT, A SPEC THE SELLER CLEARED IS SENT AS null — the edit path is sparse (an omitted
 * column is left alone), so dropping it kept the old value: clearing a job's salary to "Negotiable"
 * left the stored 45 tr/tháng, and the price derived from it, in place. Only a column the listing HAD
 * at open is nulled, never one this form simply did not load.
 * ⛔ …EXCEPT A JOB'S SALARY (`alwaysOnEdit`), WHICH AN EDIT ALWAYS SENDS (null = "Negotiable"). The
 * salary IS the job's pay, and the server re-derives the price only from an edit that sends it: an
 * older job stored at a typed price with no salary (e.g. "20,000 đ / month") opened as "Negotiable",
 * was saved as "Negotiable", and kept printing its old price (review, 2026-10-01).
 * ⚠️ NEVER A null ON CREATE: the create path reads every declared range column (non-sparse), where a
 * null is Number(null) = 0 — a "Negotiable" job would be stored with a 0 salary instead of none.
 */
export function rangeColumnsPayload(
  facets: readonly { key: string; range: RangeMeta }[],
  ranges: Record<string, number | null | undefined>,
  edit: Record<string, unknown> | null | undefined,
  alwaysOnEdit?: RangeMeta['column'],
): Record<string, number | null> {
  return Object.fromEntries(
    facets
      .filter((f) => ranges[f.key] != null || (!!edit && (f.range.column === alwaysOnEdit || edit[f.range.column] != null)))
      .map((f) => [f.range.column, ranges[f.key] ?? null]),
  )
}

/**
 * Brand + model as a post-wizard submit sends them. Pure, so the edit rules below are tested.
 *
 * ⛔ A HIDDEN FIELD IS NOT SENT ON AN EDIT THAT KEPT ITS SUBCATEGORY. Rentals is a brand category on
 * the server (categoryHasBrand('rentals'), core/listings.ts updateListingCore), but the wizard shows
 * the Brand field only for a VEHICLE rental (A5, 2026-10-04) — so an edit of an apartment that sent
 * `brand: null` would CLEAR the brand it already had and move its brand count. The edit path is sparse
 * (an omitted key is left alone), so a field the seller cannot see is omitted, never nulled.
 * ⛔ …BUT AN EDIT THAT MOVED THE LISTING TO A SUBCATEGORY WITHOUT ONE CLEARS IT. A scooter rental
 * re-filed as an apartment: the form already dropped the brand (subcategoryChangeReset), and omitting
 * it would leave "Honda" on the apartment server-side. `subcategoryChanged` = the subcategory differs
 * from the one the listing was STORED with.
 * A NEW post sends null for a hidden field: nothing is stored to lose, and a brand typed under a
 * vehicle subcategory and then hidden by a switch to an apartment must not travel with the post.
 */
export function brandModelPayload(i: { showBrand: boolean; brand: string; model: string; edit: boolean; subcategoryChanged?: boolean }): { brand?: string | null; model?: string | null } {
  if (i.showBrand) return { brand: i.brand.trim() || null, model: i.model.trim() || null }
  return !i.edit || i.subcategoryChanged ? { brand: null, model: null } : {}
}

/**
 * Whether the form holds work worth keeping as a DRAFT (the autosave) — typed work only: a title, a
 * price, or a description the seller wrote. Clicking around the form is not a draft.
 * ⚠️ `carriedDescription` — the moving-sale context "List another item" carries into the next item
 * (pickup window, why everything goes) is NOT typed work on its own. Counted as content, it was saved
 * the instant the success screen closed, under a fresh draftId, so a seller who simply left came back
 * to "Draft restored" over an empty item. It counts again the moment the seller types anything.
 */
export function draftHasContent(f: { title: string; description: string; price: string }, carriedDescription = ''): boolean {
  return !!(f.title.trim() || f.price || (f.description.trim() && f.description !== carriedDescription))
}
