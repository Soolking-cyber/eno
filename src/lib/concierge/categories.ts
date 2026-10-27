import { TAXONOMY } from '@/lib/taxonomy'
import { CATEGORY_LEAD } from '@/lib/category-lead'
import { UNLINKED_CATEGORIES } from '@/lib/retired-categories'

/**
 * The shelves the concierge may open — eno's own lead order first (category-lead.ts), then the rest of TAXONOMY in its
 * order, without the ones no browse surface links (retired-categories.ts: empty or retired shelves). Deterministic: it is
 * part of the model's cached instructions and of its answer schema, which must stay byte-identical between turns.
 */
export const CONCIERGE_CATEGORIES: readonly string[] = (() => {
  const all = TAXONOMY.map((c) => c.slug).filter((s) => !UNLINKED_CATEGORIES.has(s))
  const lead = (CATEGORY_LEAD as readonly string[]).filter((s) => all.includes(s))
  return [...lead, ...all.filter((s) => !lead.includes(s))]
})()

/**
 * Subcategories the concierge never opens or names on eno.vn: the e-Visa aisle (a visa question gets the server's fixed
 * line instead — guards.ts — and only that line may offer the aisle) and visa runs (not offered on eno.vn at all).
 */
export const CONCIERGE_HIDDEN_SUBCATEGORIES: ReadonlySet<string> = new Set(['visa-legal', 'visa-runs'])

export const isConciergeCategory = (slug: string): boolean => CONCIERGE_CATEGORIES.includes(slug)
