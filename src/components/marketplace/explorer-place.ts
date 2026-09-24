import { inferDistrictFromQuery, isPlaceSearch, strippedUnderExplicitDistrict } from '@/lib/district-query'
import { DISTRICTS_PROVINCE_CODE } from './listings-explorer.constants'

/**
 * THE EXPLORER'S "A PLACE REPLACES A PLACE" RULES FOR THE SEARCH BOX — pure, so they can be tested
 * without mounting the 3,500-line explorer that applies them.
 *
 * The Area panel's half of the rule (a district pick drops the ward and the radius; a ward or radius
 * drops the district) lives in facet-bar.tsx and listings-explorer.constants.ts (districtSurvivesArea).
 * This is the half that involves a district TYPED into the box.
 */

type Setters<G extends { code: string }> = {
  setDistrict: (slug: string) => void
  setWard: (ward: null) => void
  setNearby: (nearby: null) => void
  setProvince: (next: (p: G | null) => G | null) => void
}

/**
 * ⛔ A DISTRICT TYPED INTO THE BOX REPLACES THE PLACE ALREADY PICKED (verifier, 2026-09-24). An
 * explicit `?district=` wins on the server, so a stale pick silently overrode the words: from a
 * /c/<category>/quan-7 page's "Refine in full search", typing "Quận 1" answered 2,493 rows, all in
 * Quận 7. So when the words name a district (the parser the server runs), the new search clears the
 * picked district — the way it already clears a stale brand, model and subcategory — and with it
 * the ward and the "near you" radius, which would AND with the typed district into an empty feed,
 * and a province outside HCMC. HCMC itself contains every curated district and stays.
 * Returns whether it cleared anything.
 */
/*
 * ⚠️ IT DECIDES ON THE PARSER'S READING, BEFORE THE SERVER HAS ANSWERED, SO IT ONLY GOES AS FAR AS
 * THE READING IS SURE (codex, twice). The picked DISTRICT always goes: it is an explicit
 * `?district=`, which wins on the server and strips the typed phrase — kept, it would turn "Quận 1"
 * into Quận 7 and "Hồi ức Phú Nhuận" (a book) into "Hồi ức" inside Quận 7. The ward, the radius and a
 * province outside HCMC go only when the words are a PLACE search (isPlaceSearch). Beside product
 * words the feed may serve them as plain text, and a reader who chose Hà Nội and searches a book
 * title keeps Hà Nội — the server's safety net answers within it.
 */
export function clearPlaceForTypedDistrict<G extends { code: string }>(typed: string, set: Setters<G>): boolean {
  const inferred = inferDistrictFromQuery(typed)
  if (!inferred) return false
  set.setDistrict('all')
  if (!isPlaceSearch(inferred)) return true
  set.setWard(null)
  set.setNearby(null)
  set.setProvince((p) => (p && p.code !== DISTRICTS_PROVINCE_CODE ? null : p))
  return true
}

/**
 * The search words with the district THE SERVER read out of them removed — what the box should hold
 * once a place picked in the Area panel replaces that district — or null when the server applied no
 * district from the words (then there is nothing to remove, whatever the parser would read: the feed
 * may have served them as plain words, and a product search must keep its words).
 * The same words the district chip's own "clear" leaves (queryChips).
 */
export function queryWithoutTypedDistrict(typed: string, serverInferred: string | null): string | null {
  if (!serverInferred) return null
  const inferred = inferDistrictFromQuery(typed)
  // ⚠️ Only when this parser reads the same district: across a deploy it may not, and then the words
  // cannot be told from the phrase — leave them rather than wipe the box (opus).
  return inferred?.slug === serverInferred ? inferred.rest : null
}

/**
 * What the box holds after the Area panel applies `pickedSlug` (a district, or 'all' when a ward, a
 * radius or another province displaced the district). `live` is what the box holds now, `debounced`
 * the words the last server answer (`serverInferred`) was for.
 *
 * ⛔ A PICKED DISTRICT REPLACES A DISTRICT TYPED INTO THE BOX — read by the parser from the LIVE text
 * (no server answer needed; agy: words typed inside the debounce window), so the text chip never
 * claims a district phrase the pick overrides. Product words that merely contain a district name
 * ("Hồi ức Phú Nhuận") keep it, and the server searches them whole under the pick.
 * With no district picked the server reads the words itself, so only a district IT applied from
 * them is removed (queryWithoutTypedDistrict) — and only while the box still holds the words that
 * answer was for (codex): newer typing is left alone, and the server will read it afresh.
 */
export function queryAfterAreaPick(live: string, debounced: string, pickedSlug: string, serverInferred: string | null): string {
  if (pickedSlug !== 'all') {
    // A place replaces a place: a typed PLACE search loses its phrase, and so does any numbered
    // phrase the server would strip under the pick anyway; a product title stays whole.
    const inferred = inferDistrictFromQuery(live)
    return inferred && (isPlaceSearch(inferred) || strippedUnderExplicitDistrict(inferred)) ? inferred.rest : live
  }
  if (live.trim() !== debounced.trim()) return live
  return queryWithoutTypedDistrict(debounced, serverInferred) ?? live
}

/**
 * The words to put in the box for a URL that carries `?district=` and `?q=` together (a shared link,
 * a saved search). The server strips a district phrase from the words whenever an explicit district
 * is sent, so the box shows what it searches rather than a phrase it ignores.
 */
export function queryForExplicitDistrict(typed: string, district: string | null): string {
  if (!district || district === 'all') return typed
  const inferred = inferDistrictFromQuery(typed)
  return inferred && strippedUnderExplicitDistrict(inferred) ? inferred.rest : typed
}
