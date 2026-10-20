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
 * So the tokens get their OWN column, which no FREE TEXT can reach: `sanitizeAttributes()` (the one
 * route a human seller's attributes take) never writes it, and drops every multi facet's key from
 * `attributes` as well. Importers write it through Prisma; the teacher publish core writes a teacher's.
 *
 * ⛔ ONE PUBLIC WRITER, SAFE BY CONSTRUCTION (owner, 2026-10-20: "also add those filter chips when someone
 * posts in our app" — the apartment amenities). A seller's picks of a multi facet the post form asks reach
 * this column ONLY through multi-facet.ts `sellerFacetTokens`, from createListingCore / updateListingCore
 * (the web wizard and the apps' webview of it, /api/v1's create and edit — MCP and a partner sync send no
 * attributes). Its tokens are built from the TAXONOMY'S OWN option values for that listing's (category,
 * subcategory) — the seller's input only decides which of them are in — so not one seller-typed character
 * can become a token, and a value can never carry a `|` or `:`. It replaces only that facet's tokens
 * (`replaceFacetTokens` below) and keeps every other one: a teacher's coverArea/workIn, an importer's sizes
 * or rental periods. The injection the reviewers rejected stays impossible by construction, not by a rule
 * someone must remember.
 * ⚠️ prisma/schema.prisma's note on the column ("only importers write it") predates this writer, and THIS header is the
 * rule. It is left as it was on purpose: eno-deploy.sh refuses any prisma/ change without SCHEMA_OK, comment or not —
 * reword it with the next real schema change, never in a commit of its own.
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

/**
 * `stored` with every token of `keys` taken out and `next`'s values for those keys put in — ⛔ EVERY OTHER TOKEN KEPT,
 * in its order: a teacher's coverArea/workIn and an importer's sizes or rental periods are not the caller's to touch.
 * The new values go through buildFacetTokens' own shape check; a key with no (valid) value left carries no token.
 * Null when nothing at all is left, so the column holds NULL rather than `||`.
 */
export function replaceFacetTokens(
  stored: string | null | undefined,
  keys: readonly string[],
  next: Readonly<Record<string, readonly string[]>>,
): string | null {
  const replaced = new Set(keys)
  const kept = parseFacetTokens(stored).filter((p) => !replaced.has(p.key)).map((p) => `${p.key}:${p.value}`)
  const added = parseFacetTokens(buildFacetTokens(Object.fromEntries(keys.map((k) => [k, [...(next[k] ?? [])]]))))
    .map((p) => `${p.key}:${p.value}`)
  const all = [...new Set([...kept, ...added])]
  return all.length ? `|${all.join('|')}|` : null
}

/** Whether two stored values carry the same tokens, whatever their order — so a save that re-sends the same picks writes
 *  nothing new. */
export function sameFacetTokens(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = new Set(parseFacetTokens(a).map((p) => `${p.key}:${p.value}`))
  const y = new Set(parseFacetTokens(b).map((p) => `${p.key}:${p.value}`))
  return x.size === y.size && [...x].every((t) => y.has(t))
}
