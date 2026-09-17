/**
 * MULTI-VALUED FACETS — one product, several sizes.
 *
 * ⛔ WHY THIS IS NOT IN `attributes`, WHICH IS WHERE EVERY OTHER FACET LIVES. `attributes` holds
 * `{"key":"value"}` and browse filters it with `contains '"key":"value"'` — exact, because a facet
 * has exactly one value there. A sports shoe has eight. The obvious cheap fix (a delimited token
 * string stored as one more attribute, `"_f":"|size:m|size:l|"`, matched with `contains '|size:m|'`)
 * was designed, reviewed and REJECTED by both external reviewers on the same ground: `contains`
 * scans the WHOLE column, so ANY seller-typed attribute value containing the literal `|size:m|`
 * would match the filter — a free-text attribute is 40 chars, which is plenty. A public
 * `attr__f=…` param could also address the private key directly.
 *
 * So the tokens get their OWN column, which no public write path can reach: `sanitizeAttributes()`
 * (the one route a human seller's attributes take) does not know this field exists, and neither
 * does the post wizard. Only an importer writes it, through Prisma. That makes the injection
 * impossible by construction rather than by a validation rule someone must remember.
 *
 * FORMAT — `|key:value|key:value|`, leading and trailing bars included, so a `contains` for
 * `|key:value|` can never match a PREFIX of a longer value (`|size:m|` vs `|size:m-l|`) and the key
 * is inside the token, so two facets that share a value (`size:free-size` and `shoeSize:free-size`)
 * stay separate. Values are the taxonomy's own `.value` slugs, which are `[a-z0-9-]`.
 */

/** A facet key/value pair as the taxonomy spells it. */
export type FacetPair = { key: string; value: string }

/** Only the shape the taxonomy itself produces is allowed through — a defensive echo of the
 *  taxonomy's slugs, so a bad mapper cannot write a token that changes what a filter means. */
const SAFE = /^[a-z][a-z0-9]*$/i
const SAFE_VALUE = /^[a-z0-9][a-z0-9-]*$/i

/**
 * Build the column value from a facet map. Multi-valued keys pass an array; single-valued ones a
 * string. Returns null when nothing survives, so the column stays NULL rather than holding `||`.
 *
 * ⚠️ DEDUPED AND ORDER-STABLE: four shoe sizes that all fold to `eu-44-plus` must produce ONE
 * token, or the column grows without bound on a re-import and the string stops being comparable.
 */
export function buildFacetTokens(facets: Record<string, string | string[] | null | undefined>): string | null {
  const seen = new Set<string>()
  for (const [key, raw] of Object.entries(facets)) {
    if (!SAFE.test(key)) continue
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      if (!value || !SAFE_VALUE.test(value)) continue
      seen.add(`${key}:${value}`)
    }
  }
  return seen.size ? `|${[...seen].join('|')}|` : null
}

/** The exact substring a filter for `key=value` must find. One place, so the writer and the
 *  reader can never disagree about the delimiters. */
export function facetTokenFor(key: string, value: string): string {
  return `|${key}:${value}|`
}

/** Every pair in a stored column value — for tests, admin tooling and future facet counts. */
export function parseFacetTokens(tokens: string | null | undefined): FacetPair[] {
  if (!tokens) return []
  return tokens
    .split('|')
    .filter(Boolean)
    .map((t) => {
      const i = t.indexOf(':')
      return i > 0 ? { key: t.slice(0, i), value: t.slice(i + 1) } : null
    })
    .filter((p): p is FacetPair => !!p)
}

/** Values a listing carries for one facet key (empty when it carries none). */
export function facetValues(tokens: string | null | undefined, key: string): string[] {
  return parseFacetTokens(tokens).filter((p) => p.key === key).map((p) => p.value)
}
