import { facetsFor, freeTextAttributesFor, typesFor } from '@/lib/taxonomy'
import { UNLINKED_CATEGORIES } from '@/lib/retired-categories'

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

/**
 * WHAT A SUBCATEGORY CHANGE THROWS AWAY — pure, so it is tested without rendering the wizard
 * (post-wizard.tsx `chooseSubcategory`, the ONE path the subcategory chips and the "Gợi ý: …?"
 * suggestion both take).
 * Facets are per SUBCATEGORY (`subcats` / `excludeSubcats`), so an answer the new shelf does not ask
 * for — or a value its options do not offer — would be published invisibly with the listing: phones'
 * "128GB" riding along on a laptop. Those go; answers the new shelf asks too stay, so correcting
 * Phones & tablets → Laptops keeps "Used" and the brand but drops the storage. A free-text fact (a
 * book's author) stays only on a shelf that carries it (taxonomy.ts freeTextAttributesFor). Brand +
 * model go only when the new shelf HIDES the Brand field (a vehicle rental → an apartment); within one
 * category a brand still names the item.
 * `lost` says whether an answer the seller gave was dropped — the wizard offers Undo exactly then.
 */
export function subcategoryChangeReset<R>(
  cur: { categorySlug: string; attrs: Record<string, string>; ranges: Record<string, R>; condition: string; brand: string; model: string },
  nextSub: string,
  opts: { brandShown: boolean },
): { attrs: Record<string, string>; ranges: Record<string, R>; condition: string; brand: string; model: string; lost: boolean } {
  const facets = facetsFor(cur.categorySlug, nextSub || null)
  // A free-text fact (a book's author) stays only where the new shelf carries it — taxonomy.ts
  // freeTextAttributesFor, the same rule enrichment writes by — never as a hidden value on any shelf.
  const freeText = freeTextAttributesFor(cur.categorySlug, nextSub || null)
  const asked = (k: string, v: string) =>
    freeText.includes(k) ||
    facets.some((f) => f.key === k && f.kind !== 'range' && (f.options.length === 0 || f.options.some((o) => o.value === v)))
  const attrs = Object.fromEntries(Object.entries(cur.attrs).filter(([k, v]) => asked(k, v)))
  const ranges = Object.fromEntries(Object.entries(cur.ranges).filter(([k]) => facets.some((f) => f.key === k && f.kind === 'range'))) as Record<string, R>
  const conditionFacet = facets.find((f) => f.key === 'condition')
  const condition = cur.condition && conditionFacet?.options.some((o) => o.value === cur.condition) ? cur.condition : ''
  const brand = opts.brandShown ? cur.brand : ''
  const model = opts.brandShown ? cur.model : ''
  const lost =
    Object.entries(cur.attrs).some(([k, v]) => !!v && !(k in attrs)) ||
    Object.entries(cur.ranges).some(([k, v]) => v != null && !(k in ranges)) ||
    (!!cur.condition && !condition) ||
    (!!cur.brand.trim() && !brand) ||
    (!!cur.model.trim() && !model)
  return { attrs, ranges, condition, brand, model, lost }
}

/**
 * THE POST PICKER'S ORDER (sell-06). /post used to sort the category chips by ENGLISH name, so a
 * Vietnamese seller met "Baby & kids, Books, Community…" and the shelves eno actually trades on sat
 * wherever the alphabet put them. A curated rank leads (the second-hand focus, owner 2026-10-03:
 * second-hand goods, rentals, jobs); every other LINKED category follows alphabetically; the shelves no
 * browse surface links any more (retired-categories.ts UNLINKED_CATEGORIES) go behind "More…" — still
 * postable (blocking them is owner decision C18), just not offered first.
 * ⚠️ `moving-sale` is in UNLINKED_CATEGORIES (empty shelf) AND in the curated rank: the rank wins — a
 * moving sale is the research-backed supply path, so it is offered up front.
 */
export const POST_CATEGORY_RANK: readonly string[] = [
  'electronics', 'furniture-appliances', 'rentals', 'jobs', 'fashion-beauty', 'baby-kids', 'services', 'moving-sale',
]

export function orderPostCategories<C extends { slug: string; name: string }>(cats: readonly C[]): { primary: C[]; more: C[] } {
  const rank = (slug: string) => {
    const i = POST_CATEGORY_RANK.indexOf(slug)
    return i === -1 ? POST_CATEGORY_RANK.length : i
  }
  const sorted = [...cats].sort((a, b) => rank(a.slug) - rank(b.slug) || a.name.localeCompare(b.name, 'en'))
  const behindMore = (c: C) => UNLINKED_CATEGORIES.has(c.slug) && !POST_CATEGORY_RANK.includes(c.slug)
  return { primary: sorted.filter((c) => !behindMore(c)), more: sorted.filter(behindMore) }
}
