/**
 * WHAT AN `attr_<key>=<value>` FILTER MATCHES — the one definition the feed and the chip counts share.
 *
 * ⛔ THE FEED FILTERS WITH A PRISMA `contains` AND THE CHIP COUNTS CLASSIFY GROUPED ROWS IN JS, AND
 * THEY MUST AGREE BYTE FOR BYTE. Both are built from `attrNeedles` below: the feed ORs one
 * `contains` per needle (`attrWhere`), the counter asks whether the row's column `includes` any of
 * the same needles (`attrRowMatches`). Prisma's `contains` without `mode` compiles to a
 * case-sensitive `LIKE '%needle%'` with the needle's own `%`/`_` escaped, which is exactly
 * `String.prototype.includes`, so a count computed here is what the tap returns.
 *
 * Three shapes of value, one function:
 *  · THE DEFAULT — `"key":"value"` in `attributes` (every facet a human posts, stored once) OR the
 *    `|key:value|` token in `facetTokens` (a multi-valued import, src/lib/facet-tokens.ts).
 *  · AN OPEN-ENDED TOP BUCKET (`orMore` in the taxonomy, e.g. bedrooms "6+") — its own stored
 *    value AND every larger count up to `OR_MORE_CEILING`, so "6+" is ≥6 whatever a writer stored.
 *    A hand-written `3+` / `3plus` on the same facet means ≥3 the same way (old "3+" links).
 *  · ALIASED VALUES (compatibleWith) — the stored vocabulary is not the chip's: see
 *    COMPAT_DISPLAY_PREFIXES in electronics-specs.ts for the 2,638 rows that store a display string.
 */
import type { Prisma } from '@/generated/prisma/client'
import { TAXONOMY } from '@/lib/taxonomy'
import { facetTokenFor } from '@/lib/facet-tokens'
import { COMPAT_DISPLAY_PREFIXES } from '@/lib/electronics-specs'
import { POSTED_FACET_KEY, postedCutoff } from '@/lib/posted-filter'

/**
 * The largest count an open-ended bucket enumerates. A bound, because `attributes` is a JSON STRING
 * and "≥6" has to be spelled as one `LIKE` per count; 30 bedrooms is past any home in the catalogue
 * (the largest measured on 2026-09-25 was a 10+-room boarding house), and writers clamp at the top
 * bucket anyway (`roomCountValue`), so this only ever catches a legacy or foreign writer.
 */
export const OR_MORE_CEILING = 30

/** `key` → the numeric floor of its open-ended option, from the taxonomy. */
const OR_MORE: Map<string, number> = (() => {
  const m = new Map<string, number>()
  for (const c of TAXONOMY) {
    for (const f of c.facets) {
      for (const o of f.options) {
        if (!o.orMore) continue
        const n = Number(o.value)
        // Two categories declaring different floors for one key would make "6+" mean two things;
        // keep the lowest so the filter is never NARROWER than any chip that uses the key.
        if (Number.isInteger(n)) m.set(f.key, Math.min(m.get(f.key) ?? n, n))
      }
    }
  }
  return m
})()

/** A facet value a token needle may be built from — the taxonomy's own slug shape (see feed-query). */
const TOKENABLE = /^[a-z0-9][a-z0-9-]*$/i

/** The floor an `N+` / `Nplus` / top-bucket value means on an open-ended facet, else null. */
function orMoreFloor(key: string, value: string): number | null {
  const top = OR_MORE.get(key)
  if (top === undefined) return null
  // A literal `+` in a query string decodes to a SPACE, so `?attr_bedrooms=3+` arrives as "3 ".
  const m = /^(\d{1,2})(?:\+|plus|\s)$/i.exec(value)
  if (m) return Number(m[1])
  return value === String(top) ? top : null
}

export type AttrNeedles = {
  /** substrings of `Listing.attributes`, any of which matches */
  attributes: string[]
  /** substrings of `Listing.facetTokens`, any of which matches */
  tokens: string[]
}

/** Every substring that makes a row match `attr_<key>=<value>`. `key` must already be sanitised. */
export function attrNeedles(key: string, value: string): AttrNeedles {
  const floor = orMoreFloor(key, value)
  if (floor !== null) {
    const attributes: string[] = []
    for (let n = floor; n <= OR_MORE_CEILING; n++) attributes.push(`"${key}":"${n}"`)
    // A row stored under the literal top-bucket spelling (a URL value typed into the wizard's shape).
    if (!/^\d+$/.test(value)) attributes.push(`"${key}":"${value}"`)
    return { attributes, tokens: [] }
  }
  /**
   * ⛔ "THEO TUẦN" MEANS "CAN BE RENTED FOR A WEEK" (owner, 2026-10-05: "if only for rentals motorbikes or cars yes
   * include"). It matched only rows that list a weekly RATE (20 bikes of one shop, via facetTokens), so every
   * daily-priced bike and car — which can be rented for a week — vanished from a weekly search. Weekly now also
   * matches daily-priced rows. Measured read-only 2026-10-05: only vehicles are priced per day (6,258 cars, 69
   * motorbikes); no apartment, house, room or office is priced by the day or the week.
   * ⚠️ NOT SCOPED TO VEHICLES IN CODE, on purpose (gate, 2026-10-05): the Filter panel's counts group rows by
   * (attributes, facetTokens) with no subcategory, so a vehicle-only clause in SQL would make a chip's count and
   * its results disagree; and scoping the facet to vehicles would take "Theo ngày" away from a short-stay room
   * posting. A room ever priced per day can be rented for a week too — the same rule, honestly applied.
   */
  if (key === 'rentalPeriod' && value === 'weekly') {
    return {
      attributes: [`"${key}":"weekly"`, `"${key}":"daily"`],
      tokens: [facetTokenFor(key, 'weekly'), facetTokenFor(key, 'daily')],
    }
  }
  const attributes = [`"${key}":"${value}"`]
  const prefixes = key === 'compatibleWith' ? COMPAT_DISPLAY_PREFIXES[value] : undefined
  // ⚠️ A PREFIX, CLOSED ON THE LEFT BY THE KEY: `"compatibleWith":"iPhone 14` matches "iPhone 14",
  // "iPhone 14 Pro Max" and "iPhone 14Pro" — never "Galaxy Tab … iPhone 14", and never another key.
  if (prefixes) for (const p of prefixes) attributes.push(`"${key}":"${p}`)
  return { attributes, tokens: TOKENABLE.test(value) ? [facetTokenFor(key, value)] : [] }
}

/** The feed's WHERE clause for one attribute filter. */
export function attrWhere(key: string, value: string, now?: Date): Prisma.ListingWhereInput {
  // ⚠️ `posted` is a facet in the taxonomy and a COLUMN here (src/lib/posted-filter.ts): it filters
  // `postedAt`, never `attributes`. An unknown window is no filter at all, never an error.
  if (key === POSTED_FACET_KEY) {
    // `now`: the request's ONE reference instant, so the grid and every count share a cutoff.
    const cutoff = postedCutoff(value, now)
    return cutoff ? { postedAt: { gte: cutoff } } : {}
  }
  const n = attrNeedles(key, value)
  return {
    OR: [
      ...n.attributes.map((c) => ({ attributes: { contains: c } })),
      ...n.tokens.map((c) => ({ facetTokens: { contains: c } })),
    ],
  }
}

type AttrRow = { attributes?: string | null; facetTokens?: string | null }

/**
 * The same test in memory, for rows (or groupBy buckets) the chip counter already holds. Returns a
 * predicate so the needles are built once per chip, not once per row.
 */
export function attrMatcher(key: string, value: string): (row: AttrRow) => boolean {
  // `posted` cannot be tested on a grouped (attributes, facetTokens) row — it is a column. Its counts
  // keep it IN the database `where` instead (facet-counts.ts), so in memory it passes every row.
  if (key === POSTED_FACET_KEY) return () => true
  const n = attrNeedles(key, value)
  return (row) => {
    const a = row.attributes ?? ''
    const t = row.facetTokens ?? ''
    return n.attributes.some((c) => a.includes(c)) || n.tokens.some((c) => t.includes(c))
  }
}

/** One-off form of `attrMatcher`. */
export function attrRowMatches(row: AttrRow, key: string, value: string): boolean {
  return attrMatcher(key, value)(row)
}

/**
 * The view a Filter-panel count payload is about: `${category}/${subcategory || 'all'}`. Client-safe
 * (the counter in src/lib/facet-counts.ts is server-only), so the panel builds the identical string
 * when it checks whether a held payload still describes the facets on screen.
 */
export function viewScope(category: string, subcategory: string | null | undefined): string {
  return `${category}/${subcategory && subcategory !== 'all' ? subcategory : 'all'}`
}

/**
 * The `attr_*` filters a request carries, exactly as the feed reads them: the key stripped to
 * `[a-z0-9_]`, the literal `all` meaning "no filter". Shared so the counter applies the same set.
 */
export function attrFiltersFrom(searchParams: URLSearchParams): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = []
  for (const k of Array.from(searchParams.keys())) {
    if (!k.startsWith('attr_')) continue
    const key = k.replace('attr_', '').replace(/[^a-z0-9_]/gi, '')
    const value = searchParams.get(k)
    if (key && value && value !== 'all') out.push({ key, value })
  }
  return out
}
