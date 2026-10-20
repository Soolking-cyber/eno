/**
 * THE ONE READING OF A MULTI-SELECT FACET'S VALUE — `attr_amenities=no-landlord,car-alley` (GoPlus partnership, owner
 * 2026-10-19: "add more filter chips so they can search one with no landlord, with car access etc").
 *
 * ⛔ A MULTI FACET'S URL VALUE IS A LIST, AND EVERY READER MUST SPLIT IT THE SAME WAY. The feed and the saved-search
 * alert (attr-match.ts attrWhere), the chip counts (attrMatcher, facet-counts.ts), the Filter panel's toggles
 * (facet-bar.tsx), the explorer's URL round-trip (explorer-url.ts) and its active chips (listings-explorer.tsx) all call
 * these functions, so a value cannot mean "both amenities" to the grid and "neither" to the count beside the chip.
 *
 * THE RULES, each for a reason:
 *  · AND, NOT OR. A renter picking "No live-in landlord" and "Car access" wants a room with both — GoPlus's own
 *    amenity filter (`ti=a,b`) narrows the same way. OR would make every extra pick WIDEN the feed, which no chip row
 *    on this site does.
 *  · CANONICAL ORDER = TAXONOMY ORDER, deduplicated. `car-alley,no-landlord` and `no-landlord,car-alley` are one
 *    search, so they must be one URL, one memo key in facet-counts.ts and one saved-search row.
 *  · UNKNOWN PARTS ARE DROPPED, NEVER AN ERROR. A stale link (an option renamed), a hand-typed value or a saved search
 *    truncated by an older build keeps the parts that still mean something; a list with nothing left is NO FILTER —
 *    never a clause that matches nothing, which would empty the feed with no chip to explain it.
 *  · ONLY TAXONOMY VALUES, so a value can never smuggle a token delimiter into a `facetTokens` needle
 *    (attr-match.ts TOKENABLE has the same job for single facets).
 *
 * ⛔ AND THE SELLER'S SIDE OF THE SAME FACET (owner, 2026-10-20: "also add those filter chips when someone posts in our app").
 * The post form asks a multi facet that is not `derived` (amenities on rentals › apartment-rental, of a `rent` ad) as
 * toggle chips, and the picks are stored as `facetTokens` by `sellerFacetTokens` below — THE ONE PUBLIC WRITER of that
 * column (facet-tokens.ts). Its rules, each for a reason:
 *  · ONLY AN AD THAT OFFERS THE PLACE ANSWERS IT — `rent`, never "Looking to rent" (`sellerMultiFacets` below).
 *  · THE LISTING'S OWN FACET, NOT THE UNION. A pick is kept only when it is an option of the multi facet the listing's
 *    (category, subcategory) declares — `multiFacetPicks` matches against that facet's options and returns THEIR values,
 *    so the input only decides membership and no seller-typed character can reach a token.
 *  · ONLY WHAT THE BODY NAMES. A multi facet is replaced only when the `attributes` bag carries its key (an array or a
 *    comma list; empty = none). An API client that edits a title, or sends attributes that never mention amenities, leaves
 *    the stored picks alone — so the post form sends the key on every save, empty when the seller un-picked them all.
 *  · ONLY ITS OWN TOKENS. Every other token is kept (facet-tokens.ts replaceFacetTokens) — an importer's sizes, rental
 *    periods or a teacher's places are never the seller form's to touch.
 *  · A MOVE drops the picks a shelf no longer asks (an apartment re-filed as a house) and keeps, of a shelf that asks the
 *    same facet, only what its options offer.
 *  · A ROW THAT DOES NOT ANSWER A FACET ITS SHELF HAS (a Wanted ad) CARRIES NONE OF IT: any save empties it, and the edit
 *    screen never opens on it (codex, 2026-10-20 — none can be written today, but a legacy one would filter as a fact).
 *
 * Client-safe on purpose: the Filter panel, the explorer and the post form import it.
 */
import { TAXONOMY, askableFacetsFor, type FacetDef } from '@/lib/taxonomy'
import { facetValues, replaceFacetTokens, sameFacetTokens } from '@/lib/facet-tokens'
import { VIDEO_FACET_KEY, VIDEO_FACET_ON, videoFilterOn } from '@/lib/video-filter'

/** The separator inside a multi facet's value. A comma: URL-safe once encoded, and never inside a taxonomy slug. */
export const MULTI_SEP = ','

/** key → its option values in taxonomy order, for every facet declared `multi`. */
const MULTI_OPTIONS: ReadonlyMap<string, readonly string[]> = (() => {
  const m = new Map<string, string[]>()
  for (const c of TAXONOMY) {
    for (const f of c.facets) {
      if (!f.multi) continue
      // Two categories declaring the same multi key would share one URL param; the union keeps either's value valid.
      const prev = m.get(f.key) ?? []
      m.set(f.key, [...prev, ...f.options.map((o) => o.value).filter((v) => !prev.includes(v))])
    }
  }
  return m
})()

/** Whether `key` is a multi-select facet anywhere in the taxonomy. */
export function isMultiFacetKey(key: string): boolean {
  return MULTI_OPTIONS.has(key)
}

/**
 * The picked values of multi facet `key`, in canonical order: the comma list split, trimmed, deduplicated and filtered to
 * the taxonomy's options. Empty for a value with nothing valid in it, for `'all'`, and for a key that is not multi.
 */
export function multiFacetValues(key: string, raw: string | null | undefined): string[] {
  const options = MULTI_OPTIONS.get(key)
  if (!options || !raw) return []
  const picked = new Set(raw.split(MULTI_SEP).map((s) => s.trim()).filter(Boolean))
  return options.filter((o) => picked.has(o))
}

/** The canonical value for a set of picks of multi facet `key`, or null when none is valid (= no filter). */
export function multiFacetValue(key: string, values: Iterable<string>): string | null {
  const list = multiFacetValues(key, [...values].join(MULTI_SEP))
  return list.length ? list.join(MULTI_SEP) : null
}

/** `raw` with `value` added when absent, removed when present — the toggle a chip tap performs. Null = nothing left. */
export function toggleMultiFacetValue(key: string, raw: string | null | undefined, value: string): string | null {
  const now = multiFacetValues(key, raw)
  return multiFacetValue(key, now.includes(value) ? now.filter((v) => v !== value) : [...now, value])
}

/**
 * A filter value as the explorer keeps it: a multi facet's list canonicalised (null when nothing valid is left, so the
 * filter is dropped rather than kept as a chip that filters nothing), any other facet's value as given.
 */
export function canonicalFacetValue(key: string, raw: string): string | null {
  // ⚠️ "Has video" has ONE meaningful value, and anything else is NO FILTER in the feed (attr-match.ts) — so a stale or
  // hand-typed `attr_hasVideo=maybe` is dropped here too, never kept as a chip (or a saved alert) that filters nothing.
  if (key === VIDEO_FACET_KEY) return videoFilterOn(raw) ? VIDEO_FACET_ON : null
  return isMultiFacetKey(key) ? multiFacetValue(key, raw.split(MULTI_SEP)) : raw
}

/** `raw` with `value` taken out — IDEMPOTENT, unlike the toggle: an active chip's ✕ delivered twice must never put the
 *  pick back. Null = nothing left (no filter). */
export function removeMultiFacetValue(key: string, raw: string | null | undefined, value: string): string | null {
  return multiFacetValue(key, multiFacetValues(key, raw).filter((v) => v !== value))
}

// ── The seller's side: the post form's chips and the one public writer of `facetTokens` (2026-10-20) ─────────────────

/** The multi-select facets the post form has on this SHELF, whatever the ad's intent — `multi` and askable (never
 *  `derived`: those only an importer or the app itself writes). Amenities on rentals › apartment-rental; empty elsewhere. */
function shelfMultiFacets(categorySlug: string, subcategorySlug: string | null | undefined): FacetDef[] {
  return askableFacetsFor(categorySlug, subcategorySlug || null).filter((f) => f.multi)
}

/**
 * The multi-select facets a SELLER answers on this shelf, for an ad of this intent: the shelf's, on a `rent` ad only.
 * ⛔ NEVER A "LOOKING TO RENT" (`wanted`) AD (reviewer's catch, 2026-10-20). An amenity is a fact about the place on offer,
 * and a Wanted ad's poster is the one looking (taxonomy.ts LISTING_TYPES) — its picks would be wishes, yet browse would
 * match them as facts (the feed has no default intent, so a renter's "Pool" chip found a looking-for ad) and its page would
 * never say so: the listing page lists amenities on a `rent` ad only (rental-facts.ts rentalFactsApply). So a non-rent ad
 * is a shelf that does not ask the facet — the form hides it, a create stores none, an edit to Wanted drops the picks.
 * ⚠️ A seller multi facet on another kind of ad needs a page that lists it first: multi-facet.test.ts pins "asked ⇒ listed".
 */
export function sellerMultiFacets(categorySlug: string, subcategorySlug: string | null | undefined, listingType: string | null | undefined): FacetDef[] {
  return listingType === 'rent' ? shelfMultiFacets(categorySlug, subcategorySlug) : []
}

/**
 * Picks of multi facet `f` — an array or a comma list — as THAT FACET'S OWN option values: each part trimmed, kept when it
 * is one of `f.options`, deduplicated, in taxonomy order. Anything else (another shelf's option, free text, a number, an
 * object, a token delimiter) is dropped, never an error. ⛔ THE RESULT IS DRAWN FROM THE TAXONOMY, NOT FROM THE INPUT.
 */
export function multiFacetPicks(f: Pick<FacetDef, 'options'>, raw: unknown): string[] {
  const parts: unknown[] = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(MULTI_SEP) : []
  const picked = new Set(parts.filter((p): p is string => typeof p === 'string').map((p) => p.trim()))
  return f.options.map((o) => o.value).filter((v) => picked.has(v))
}

/**
 * The attributes the EDIT screen opens the post form on: the listing's stored answers, and each multi facet the ad
 * answers (sellerMultiFacets — a `rent` ad's) as the picks its `facetTokens` hold — the canonical comma list the form
 * keeps, read through `multiFacetPicks` like the save, so an untouched form saves back exactly what it opened on. ⚠️ The
 * form sends that facet on every save and the server REPLACES it, so a form opened without the tokens would save an
 * apartment's amenities (an importer's too) away. ⛔ NEVER ON A WANTED AD (codex, 2026-10-20): a looking-for ad's picks
 * are wishes, and a legacy one switched to Rent would have them pressed as facts nobody re-chose — it opens with none.
 * ⛔ A VALID PICK LEFT IN `attributes` BY AN OLDER WRITE (a client's `"amenities":"pool"`, before sanitizeAttributes dropped
 * the key) IS CARRIED TOO (reviewer's catch, 2026-10-20 — none on production that day, measured read-only): browse
 * matched it there (attr-match.ts reads both columns), so the first save moves it into `facetTokens` instead of saving
 * it away. A stored value that is not a JSON object (a literal `null`) opens as no answers, never a crash.
 */
export function editFormAttributes(
  attributes: Record<string, string> | null | undefined,
  facetTokens: string | null | undefined,
  categorySlug: string,
  subcategorySlug: string | null | undefined,
  listingType: string | null | undefined,
): Record<string, string> {
  const bag: Record<string, string> = attributes && typeof attributes === 'object' && !Array.isArray(attributes) ? attributes : {}
  const out: Record<string, string> = Object.fromEntries(Object.entries(bag).filter(([k]) => !isMultiFacetKey(k)))
  for (const f of sellerMultiFacets(categorySlug, subcategorySlug, listingType)) {
    const picks = multiFacetPicks(f, [...facetValues(facetTokens, f.key), ...multiFacetPicks(f, bag[f.key])])
    if (picks.length) out[f.key] = picks.join(MULTI_SEP)
  }
  return out
}

/** Where a listing is, for `sellerFacetTokens`: its category, subcategory and intent (`listingType`). */
export type SellerFacetPlace = { categorySlug: string; subcategorySlug: string | null | undefined; listingType: string | null | undefined }

/**
 * ⛔ THE ONE PUBLIC WRITER OF `facetTokens` (facet-tokens.ts): what a create or an edit stores for a seller's multi-select
 * picks — `stored` is the row's value now (null on a create), `attributes` the body's bag as sent, `place` where the row
 * WILL be (shelf and intent) and `was` where it is (omitted on a create: the same). The rules are in this file's header.
 * Returns `undefined` when the column is to be left exactly as it is — nothing named, nothing moved, or the same picks
 * re-sent.
 */
export function sellerFacetTokens(
  stored: string | null | undefined,
  attributes: unknown,
  place: SellerFacetPlace,
  was: Omit<SellerFacetPlace, 'categorySlug'> = place,
): string | null | undefined {
  // The bag sanitizeAttributes reads: a plain object. Anything else names no facet (and replaces nothing here).
  const bag = attributes && typeof attributes === 'object' && !Array.isArray(attributes) ? (attributes as Record<string, unknown>) : null
  // On the shelf AND the intent: a Wanted ad answers none (sellerMultiFacets), so a Wanted create stores none, whatever it sends.
  const now = sellerMultiFacets(place.categorySlug, place.subcategorySlug, place.listingType)
  // Every multi facet either SHELF has, whatever the intent: what the row will not answer is emptied below.
  const shelves = [...shelfMultiFacets(place.categorySlug, was.subcategorySlug), ...shelfMultiFacets(place.categorySlug, place.subcategorySlug)]
  const moved = (place.subcategorySlug || null) !== (was.subcategorySlug || null)
  // What the row ANSWERED before this save (its stored shelf and intent) — only those picks are answers to carry.
  const answered = sellerMultiFacets(place.categorySlug, was.subcategorySlug, was.listingType)
  const next: Record<string, string[]> = {}
  for (const f of now) {
    if (bag && Object.hasOwn(bag, f.key)) next[f.key] = multiFacetPicks(f, bag[f.key])
    // ⛔ Not named, and not an answer before (a legacy Wanted ad turned Rent by an API edit that never mentions it — a
    // reviewer's catch, 2026-10-20): what it holds are wishes, never facts — emptied.
    else if (!answered.some((g) => g.key === f.key)) next[f.key] = []
    // Not named, but the row moves between two shelves that both ask it: what it held, as far as the new shelf offers.
    else if (moved) next[f.key] = multiFacetPicks(f, facetValues(stored, f.key))
  }
  // A facet the row's shelf has but the row will not answer — it moves to a shelf without it, turns Rent → Wanted, or is a
  // Wanted ad still carrying some (a legacy row): its picks go (nobody could edit them there, and no page would list them).
  // Nothing to empty → the same tokens → no write (below).
  for (const f of shelves) if (!now.some((g) => g.key === f.key)) next[f.key] = []
  const keys = Object.keys(next)
  if (!keys.length) return undefined
  const out = replaceFacetTokens(stored, keys, next)
  return sameFacetTokens(out, stored) ? undefined : out
}
